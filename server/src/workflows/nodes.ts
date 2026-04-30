import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { eq, and, isNull, ilike } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, issues, heartbeatRuns } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { queueIssueAssignmentWakeup } from "../services/issue-assignment-wakeup.js";
import { classifyByKeywords, ROLE_PRIORITY } from "./role-map.js";
import type { IssueType, IssueWorkflowState } from "./state.js";

type HeartbeatDep = {
  wakeup: (
    agentId: string,
    opts: {
      source?: "timer" | "assignment" | "on_demand" | "automation";
      triggerDetail?: "manual" | "ping" | "callback" | "system";
      reason?: string | null;
      payload?: Record<string, unknown> | null;
      requestedByActorType?: "user" | "agent" | "system";
      requestedByActorId?: string | null;
      contextSnapshot?: Record<string, unknown>;
    },
  ) => Promise<unknown>;
};

const VALID_ISSUE_TYPES = new Set<IssueType>([
  "backend_bug",
  "frontend_bug",
  "design_task",
  "qa_task",
  "devops_task",
  "product_task",
  "architecture",
  "data_task",
  "security_task",
  "infra_task",
  "unknown",
]);

function toIssueType(raw: string): IssueType {
  const normalized = raw.trim().toLowerCase() as IssueType;
  return VALID_ISSUE_TYPES.has(normalized) ? normalized : "unknown";
}

// ── Classify Node ────────────────────────────────────────────────────────────

export async function classifyNode(
  state: IssueWorkflowState,
  _db: Db,
): Promise<Partial<IssueWorkflowState>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (apiKey) {
    try {
      const model = new ChatAnthropic({
        model: "claude-haiku-4-5-20251001",
        apiKey,
        maxTokens: 32,
      });

      const response = await model.invoke([
        new SystemMessage(
          "Classify this issue into exactly one of: backend_bug, frontend_bug, design_task, qa_task, devops_task, product_task, architecture, data_task, security_task, infra_task, unknown. Reply with just the type, nothing else.",
        ),
        new HumanMessage(`Title: ${state.title}\nDescription: ${state.description ?? ""}`),
      ]);

      const content = typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content) && response.content.length > 0
          ? String((response.content[0] as { text?: string }).text ?? "")
          : "";

      const issueType = toIssueType(content);
      logger.info({ issueId: state.issueId, issueType, source: "claude" }, "issue classified");
      return { issueType };
    } catch (err) {
      logger.warn({ err, issueId: state.issueId }, "claude classification failed, falling back to keywords");
    }
  }

  const issueType = classifyByKeywords(state.title, state.description ?? "");
  logger.info({ issueId: state.issueId, issueType, source: "keywords" }, "issue classified");
  return { issueType };
}

// ── Route Node ───────────────────────────────────────────────────────────────

export async function routeNode(
  state: IssueWorkflowState,
  db: Db,
): Promise<Partial<IssueWorkflowState>> {
  const priorities = ROLE_PRIORITY[state.issueType] ?? ROLE_PRIORITY.unknown;

  for (const roleName of priorities) {
    const matches = await db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, state.companyId),
          ilike(agents.name, `%${roleName}%`),
        ),
      )
      .limit(5);

    if (matches.length > 0) {
      // Filter out already-tried agents from previous retries
      const triedIds = new Set(
        state.candidateAgents.map((a) => a.id),
      );
      const fresh = matches.filter((a) => !triedIds.has(a.id));
      const pick = fresh[0] ?? matches[0];

      const allCandidates = [
        ...state.candidateAgents,
        ...matches.filter(
          (m) => !state.candidateAgents.some((c) => c.id === m.id),
        ),
      ];

      logger.info(
        { issueId: state.issueId, agentId: pick.id, agentName: pick.name, roleName },
        "agent routed",
      );

      return {
        candidateAgents: allCandidates,
        assignedAgentId: pick.id,
        assignedAgentName: pick.name,
      };
    }
  }

  logger.warn({ issueId: state.issueId, issueType: state.issueType }, "no agent found for issue type");
  return { candidateAgents: [], assignedAgentId: null, assignedAgentName: null };
}

// ── Assign Node ──────────────────────────────────────────────────────────────

export async function assignNode(
  state: IssueWorkflowState,
  db: Db,
  heartbeat: HeartbeatDep,
): Promise<Partial<IssueWorkflowState>> {
  if (!state.assignedAgentId) {
    return { runStatus: "failed", lastError: "No agent to assign" };
  }

  await db
    .update(issues)
    .set({
      assigneeAgentId: state.assignedAgentId,
      status: "todo",
      updatedAt: new Date(),
    })
    .where(eq(issues.id, state.issueId));

  await queueIssueAssignmentWakeup({
    heartbeat,
    issue: { id: state.issueId, assigneeAgentId: state.assignedAgentId, status: "todo" },
    reason: "workflow_assigned",
    mutation: "assign",
    contextSource: "issue-workflow",
    requestedByActorType: "system",
  });

  logger.info(
    { issueId: state.issueId, agentId: state.assignedAgentId, agentName: state.assignedAgentName },
    "issue assigned",
  );

  return { runStatus: "pending" };
}

// ── Monitor Node ─────────────────────────────────────────────────────────────

export async function monitorNode(
  state: IssueWorkflowState,
  db: Db,
): Promise<Partial<IssueWorkflowState>> {
  // Poll interval — avoid spinning
  await new Promise<void>((r) => setTimeout(r, 15_000));

  // Get the current run ids from the issue row (executionRunId or checkoutRunId)
  const issueRows = await db
    .select({
      executionRunId: issues.executionRunId,
      checkoutRunId: issues.checkoutRunId,
    })
    .from(issues)
    .where(eq(issues.id, state.issueId))
    .limit(1);

  const issueRow = issueRows[0];
  if (!issueRow) {
    return { runStatus: "failed", lastError: "Issue not found during monitoring" };
  }

  const activeRunId = issueRow.executionRunId ?? issueRow.checkoutRunId ?? null;

  if (!activeRunId) {
    // No run attached yet — stay pending
    return { currentRunId: null, runStatus: "pending" };
  }

  const runRows = await db
    .select({ id: heartbeatRuns.id, status: heartbeatRuns.status, errorCode: heartbeatRuns.errorCode })
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.id, activeRunId))
    .limit(1);

  const run = runRows[0];
  if (!run) {
    return { currentRunId: activeRunId, runStatus: "pending" };
  }

  let runStatus: "pending" | "running" | "done" | "failed";
  if (run.status === "completed") {
    runStatus = "done";
  } else if (run.status === "failed" || run.status === "error") {
    runStatus = "failed";
  } else if (run.status === "queued") {
    runStatus = "pending";
  } else {
    runStatus = "running";
  }

  const adapterFailed =
    runStatus === "failed" &&
    (run.errorCode === "adapter_failed" || run.errorCode === "process_lost");

  logger.info({ issueId: state.issueId, runId: run.id, runStatus, errorCode: run.errorCode }, "monitor poll");
  return { currentRunId: run.id, runStatus, ...(adapterFailed ? { adapterFailed: true } : {}) };
}

// ── Recover Node ─────────────────────────────────────────────────────────────

export async function recoverNode(
  state: IssueWorkflowState,
  db: Db,
  heartbeat: HeartbeatDep,
): Promise<Partial<IssueWorkflowState>> {
  const retryCount = state.retryCount + 1;

  // Adapter-level failure: skip same-provider candidates, switch to claude_local
  if (state.adapterFailed) {
    logger.info({ issueId: state.issueId, retryCount }, "adapter_failed: finding claude_local fallback agent");
    const claudeRows = await db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, state.companyId),
          eq(agents.adapterType, "claude_local"),
        ),
      )
      .limit(1);

    const claudeAgent = claudeRows[0];
    if (claudeAgent) {
      logger.info({ issueId: state.issueId, agentId: claudeAgent.id, retryCount }, "switching to claude_local fallback");
      return {
        assignedAgentId: claudeAgent.id,
        assignedAgentName: claudeAgent.name,
        retryCount,
        runStatus: null,
        adapterFailed: false,
      };
    }
    logger.warn({ issueId: state.issueId }, "no claude_local agent found, falling through to normal recovery");
  }

  if (state.retryCount < 2) {
    // Try next candidate agent
    const tried = new Set<string>(
      state.assignedAgentId ? [state.assignedAgentId] : [],
    );
    const nextAgent = state.candidateAgents.find((a) => !tried.has(a.id)) ?? null;

    if (nextAgent) {
      logger.info(
        { issueId: state.issueId, nextAgentId: nextAgent.id, retryCount },
        "recovering: trying next candidate agent",
      );
      return { assignedAgentId: nextAgent.id, assignedAgentName: nextAgent.name, retryCount, runStatus: null };
    }

    // No more candidates — escalate to CTO
    const ctoRows = await db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, state.companyId),
          ilike(agents.name, "%CTO%"),
        ),
      )
      .limit(1);

    const cto = ctoRows[0];
    if (cto) {
      logger.info({ issueId: state.issueId, ctoId: cto.id, retryCount }, "recovering: escalating to CTO");
      return { assignedAgentId: cto.id, assignedAgentName: cto.name, retryCount, runStatus: null };
    }

    logger.warn({ issueId: state.issueId, retryCount }, "recovering: no CTO found, giving up");
    return { retryCount, runStatus: "failed", lastError: "No recovery agent available" };
  }

  // Max retries reached — force-assign CTO and mark done
  const ctoRows = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(
      and(
        eq(agents.companyId, state.companyId),
        ilike(agents.name, "%CTO%"),
      ),
    )
    .limit(1);

  const cto = ctoRows[0];
  if (cto) {
    await db
      .update(issues)
      .set({ assigneeAgentId: cto.id, status: "todo", updatedAt: new Date() })
      .where(eq(issues.id, state.issueId));

    await queueIssueAssignmentWakeup({
      heartbeat,
      issue: { id: state.issueId, assigneeAgentId: cto.id, status: "todo" },
      reason: "workflow_escalated_max_retries",
      mutation: "escalate",
      contextSource: "issue-workflow-recovery",
      requestedByActorType: "system",
    });

    logger.info({ issueId: state.issueId, ctoId: cto.id, retryCount }, "max retries: escalated to CTO, terminating");
    return { assignedAgentId: cto.id, assignedAgentName: cto.name, retryCount, runStatus: "done" };
  }

  logger.warn({ issueId: state.issueId, retryCount }, "max retries reached, no CTO found");
  return { retryCount, runStatus: "done" };
}

export type { HeartbeatDep };
