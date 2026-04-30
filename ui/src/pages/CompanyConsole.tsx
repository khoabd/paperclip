import { useEffect, useCallback, useState, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { RefreshCw, Zap, Activity } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { routinesApi } from "@/api/routines";
import { agentsApi } from "@/api/agents";
import { issuesApi } from "@/api/issues";
import { consolePreferencesApi, type ConsoleLayout } from "@/api/consolePreferences";
import { useNavigate } from "@/lib/router";

// ─── Department definitions ───────────────────────────────────────────────────
const DEPARTMENTS = [
  { id: "management", label: "Management",    color: "#7c3aed", keywords: ["ceo","project manager","engineering manager","scrum master","hr"], col: 0 },
  { id: "product",    label: "Product",        color: "#2563eb", keywords: ["product manager","system designer","cto","ui/ux","ux researcher","product owner"], col: 1 },
  { id: "engineering",label: "Engineering",    color: "#0891b2", keywords: ["backend","frontend","full stack","data engineer","ai/ml"], col: 2 },
  { id: "quality",    label: "Quality",        color: "#16a34a", keywords: ["qa engineer","compliance"], col: 3 },
  { id: "devops",     label: "DevOps / Infra", color: "#d97706", keywords: ["devops","site reliability","database admin","security"], col: 4 },
  { id: "gtm",        label: "GTM",            color: "#db2777", keywords: ["marketing","sales","growth","customer success","support","legal","finance","risk"], col: 5 },
] as const;

// Named workflow connections: [from-keyword, to-keyword, label]
const NAMED_FLOWS: [string, string, string][] = [
  ["ceo",              "cto",              "directs"],
  ["ceo",              "product manager",  "directs"],
  ["product manager",  "system designer",  "spec →"],
  ["system designer",  "cto",              "→ review"],
  ["cto",              "backend engineer", "approves"],
  ["cto",              "frontend engineer","approves"],
  ["backend engineer", "qa engineer",      "→ QA"],
  ["frontend engineer","qa engineer",      "→ QA"],
  ["qa engineer",      "devops engineer",  "→ deploy"],
];

// ─── Layout constants ──────────────────────────────────────────────────────────
const COL_W = 230;
const COL_GAP = 20;
const AGENT_H = 90;
const AGENT_GAP = 8;
const DEPT_PAD_TOP = 44;
const DEPT_PAD_X = 12;
const DEPT_PAD_BOT = 16;
const ROUTINE_Y = 28;
const DEPT_Y = 210;
const ISSUE_Y_BASE = 620;

function agentGlow(status: string) {
  if (status === "error")   return "#ef4444";
  if (status === "running") return "#34d399";
  return "#60a5fa";
}
function routineGlow(status: string) { return status === "active" ? "#22c55e" : "#475569"; }
function issueGlow(status: string) {
  if (status === "in_progress") return "#fbbf24";
  if (status === "blocked")     return "#f87171";
  if (status === "in_review")   return "#a78bfa";
  return "#64748b";
}

// ─── Custom nodes ──────────────────────────────────────────────────────────────
function AgentChipNode({ data }: NodeProps) {
  const d = data as { label: string; role: string; status: string; adapter: string; activeCount: number; queueCount: number; activeIssue: string | null; onClick: () => void };
  const glow = agentGlow(d.status);
  const isRunning = d.status === "running";
  const isError   = d.status === "error";
  const adapterColor = d.adapter === "claude_local" ? "#f97316" : "#8b5cf6";
  const adapterBadge = d.adapter === "claude_local" ? "Claude" : "Kimi";
  return (
    <div onClick={d.onClick} className="cursor-pointer select-none rounded-lg border" style={{ background: "#0d1b2e", borderColor: isRunning ? glow : isError ? "#ef4444" : "#1e3a5f", boxShadow: (isRunning || isError) ? `0 0 12px ${glow}40` : "none", width: COL_W - DEPT_PAD_X * 2 - 4, minHeight: AGENT_H, padding: "8px 10px" }}>
      <Handle type="target" position={Position.Left}  style={{ background: glow, width: 6, height: 6, border: "none" }} />
      <Handle type="source" position={Position.Right} style={{ background: glow, width: 6, height: 6, border: "none" }} />
      <Handle type="target" position={Position.Top}   id="top"    style={{ background: glow, width: 6, height: 6, border: "none" }} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ background: glow, width: 6, height: 6, border: "none" }} />
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={isRunning ? "animate-pulse" : ""} style={{ color: glow, fontSize: 8 }}>●</span>
          <span className="font-semibold text-white truncate" style={{ fontSize: 11 }}>{d.label}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {d.activeCount > 0 && <span className="rounded-full px-1.5 py-0.5 font-bold" style={{ background: "#fbbf24", color: "#000", fontSize: 9 }}>{d.activeCount}▶</span>}
          {d.queueCount  > 0 && <span className="rounded-full px-1.5 py-0.5 font-bold" style={{ background: "#1e3a5f", color: "#94a3b8", fontSize: 9 }}>{d.queueCount}⏳</span>}
          <span className="rounded px-1 py-0.5 font-medium" style={{ background: adapterColor + "22", color: adapterColor, fontSize: 8 }}>{adapterBadge}</span>
        </div>
      </div>
      <div className="mt-0.5" style={{ color: "#64748b", fontSize: 9 }}>{d.role || d.label}</div>
      {d.activeIssue
        ? <div className="mt-1.5 rounded px-1.5 py-1 truncate" style={{ background: "#fbbf2415", borderLeft: "2px solid #fbbf24", color: "#fbbf24", fontSize: 9 }}>▶ {d.activeIssue}</div>
        : <div className="mt-1.5" style={{ color: "#334155", fontSize: 9 }}>— idle —</div>
      }
    </div>
  );
}

function DeptGroupNode({ data }: NodeProps) {
  const d = data as { label: string; color: string; agentCount: number };
  return (
    <div className="rounded-xl border-2" style={{ borderColor: d.color + "60", background: d.color + "08", width: "100%", height: "100%", position: "relative" }}>
      <div className="absolute left-3 -top-3 rounded px-2 py-0.5 font-bold uppercase tracking-widest" style={{ background: d.color, color: "#fff", fontSize: 9 }}>
        {d.label} {d.agentCount > 0 && <span className="opacity-70">({d.agentCount})</span>}
      </div>
    </div>
  );
}

function RoutineSourceNode({ data }: NodeProps) {
  const d = data as { label: string; status: string; lastRun: string; onClick: () => void };
  const glow = routineGlow(d.status);
  return (
    <div onClick={d.onClick} className="cursor-pointer select-none rounded-lg border px-2 py-1.5" style={{ background: "#0d1b2e", borderColor: glow, boxShadow: d.status === "active" ? `0 0 8px ${glow}40` : "none", minWidth: 130, maxWidth: 160 }}>
      <Handle type="source" position={Position.Bottom} style={{ background: glow, width: 6, height: 6, border: "none" }} />
      <div className="flex items-center gap-1.5">
        <Zap style={{ width: 9, height: 9, color: d.status === "active" ? "#4ade80" : "#475569" }} />
        <span className="font-semibold text-white truncate" style={{ fontSize: 10 }}>{d.label}</span>
      </div>
      <div style={{ color: glow, fontSize: 9 }}>{d.status} · {d.lastRun}</div>
    </div>
  );
}

function IssueSignalNode({ data }: NodeProps) {
  const d = data as { label: string; status: string; priority: string; phase: string; onClick: () => void };
  const glow = issueGlow(d.status);
  const active = d.status === "in_progress";
  return (
    <div onClick={d.onClick} className="cursor-pointer select-none rounded-lg border px-2 py-1.5" style={{ background: "#0d1b2e", borderColor: glow, boxShadow: active ? `0 0 10px ${glow}50` : "none", minWidth: 200, maxWidth: 220 }}>
      <Handle type="target" position={Position.Top}    style={{ background: glow, width: 6, height: 6, border: "none" }} />
      <Handle type="source" position={Position.Bottom} style={{ background: glow, width: 6, height: 6, border: "none" }} />
      <div className="flex items-center gap-1.5">
        <Activity className={active ? "animate-pulse" : ""} style={{ width: 9, height: 9, color: glow }} />
        <span className="font-medium text-white truncate" style={{ fontSize: 10 }}>{d.label}</span>
      </div>
      <div className="flex items-center gap-1.5 mt-0.5">
        <span style={{ color: glow, fontSize: 8 }}>{d.status}</span>
        {d.phase && <span style={{ color: "#475569", fontSize: 8 }}>· {d.phase}</span>}
      </div>
    </div>
  );
}

const nodeTypes = { agentChip: AgentChipNode, deptGroup: DeptGroupNode, routineSource: RoutineSourceNode, issueSignal: IssueSignalNode };

// ─── Data types ───────────────────────────────────────────────────────────────
interface AgentData   { id: string; name: string; role: string; status: string; adapterType: string; title: string | null }
interface RoutineData { id: string; title: string; status: string; lastTriggeredAt: string | null; assigneeAgentId: string | null }
interface IssueData   { id: string; title: string; status: string; priority: string; assigneeAgentId: string | null }

// ─── Graph builder ─────────────────────────────────────────────────────────────
function buildGraph(
  routines: RoutineData[], agents: AgentData[], issues: IssueData[],
  savedLayout: ConsoleLayout,
  navigate: (p: string) => void,
): { nodes: Node[]; edges: Edge[]; issueAgentMap: Map<string, string> } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const issueAgentMap = new Map<string, string>(); // issueNodeId → agentNodeId

  function deptPos(id: string, defaultX: number, defaultY: number): { x: number; y: number } {
    return savedLayout[id] ?? { x: defaultX, y: defaultY };
  }

  function agentPos(id: string, idx: number): { x: number; y: number } {
    return savedLayout[id] ?? { x: DEPT_PAD_X, y: DEPT_PAD_TOP + idx * (AGENT_H + AGENT_GAP) };
  }

  function pos(id: string, defaultX: number, defaultY: number): { x: number; y: number } {
    return savedLayout[id] ?? { x: defaultX, y: defaultY };
  }

  // Per-agent task counts
  const activeByAgent = new Map<string, string>();
  const queueByAgent  = new Map<string, number>();
  for (const issue of issues) {
    if (!issue.assigneeAgentId) continue;
    if (issue.status === "in_progress") {
      if (!activeByAgent.has(issue.assigneeAgentId))
        activeByAgent.set(issue.assigneeAgentId, issue.title.replace(/\[Phase \d+\]\s*/i, "").slice(0, 40));
    } else if (issue.status !== "done" && issue.status !== "cancelled") {
      queueByAgent.set(issue.assigneeAgentId, (queueByAgent.get(issue.assigneeAgentId) ?? 0) + 1);
    }
  }

  // Assign agents to departments
  const deptAgents = new Map<string, AgentData[]>();
  for (const d of DEPARTMENTS) deptAgents.set(d.id, []);
  for (const agent of agents) {
    const name = agent.name.toLowerCase();
    let matched = false;
    for (const dept of DEPARTMENTS) {
      if (dept.keywords.some((k) => name.includes(k))) { deptAgents.get(dept.id)!.push(agent); matched = true; break; }
    }
    if (!matched) deptAgents.get("engineering")!.push(agent);
  }

  // Department group nodes
  for (const dept of DEPARTMENTS) {
    const dAgents = deptAgents.get(dept.id) ?? [];
    if (dAgents.length === 0) continue;
    const deptH = DEPT_PAD_TOP + dAgents.length * (AGENT_H + AGENT_GAP) - AGENT_GAP + DEPT_PAD_BOT;
    const defaultX = dept.col * (COL_W + COL_GAP);
    nodes.push({
      id: `dept-${dept.id}`, type: "deptGroup",
      position: deptPos(`dept-${dept.id}`, defaultX, DEPT_Y),
      data: { label: dept.label, color: dept.color, agentCount: dAgents.length },
      style: { width: COL_W, height: deptH },
      draggable: true,
    });

    dAgents.forEach((agent, idx) => {
      nodes.push({
        id: `agent-${agent.id}`, type: "agentChip",
        position: agentPos(`agent-${agent.id}`, idx),
        parentId: `dept-${dept.id}`,
        extent: "parent" as const,
        data: {
          label: agent.name, role: agent.title ?? agent.role,
          status: agent.status, adapter: agent.adapterType,
          activeCount: activeByAgent.has(agent.id) ? 1 : 0,
          queueCount: queueByAgent.get(agent.id) ?? 0,
          activeIssue: activeByAgent.get(agent.id) ?? null,
          onClick: () => navigate(`/agents/${agent.id}`),
        },
      });
    });
  }

  // Build agent lookup by name keyword for named flows
  const agentByKeyword = (keyword: string): AgentData | undefined =>
    agents.find((a) => a.name.toLowerCase().includes(keyword));

  // Named workflow edges (circuit traces)
  for (const [fromKey, toKey, label] of NAMED_FLOWS) {
    const fromAgent = agentByKeyword(fromKey);
    const toAgent   = agentByKeyword(toKey);
    if (!fromAgent || !toAgent) continue;
    const fromStatus = fromAgent.status;
    const isActive = fromStatus === "running" || activeByAgent.has(fromAgent.id);
    const fromColor = agentGlow(fromStatus);
    edges.push({
      id: `flow-${fromAgent.id}-${toAgent.id}`,
      source: `agent-${fromAgent.id}`,
      target: `agent-${toAgent.id}`,
      label,
      animated: isActive,
      labelStyle: { fill: "#475569", fontSize: 8 },
      labelBgStyle: { fill: "#060d1a", fillOpacity: 0.8 },
      style: { stroke: isActive ? fromColor : fromColor + "40", strokeWidth: isActive ? 2 : 1, strokeDasharray: "5 3" },
      markerEnd: { type: MarkerType.ArrowClosed, color: fromColor + "80", width: 12, height: 12 },
    });
  }

  // Routine source nodes
  routines.filter((r) => r.status === "active").forEach((r, idx) => {
    const defaultRx = 30 + idx * 175;
    const lastRun = r.lastTriggeredAt
      ? (() => { const m = Math.floor((Date.now() - new Date(r.lastTriggeredAt).getTime()) / 60000); return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`; })()
      : "never";
    nodes.push({
      id: `routine-${r.id}`, type: "routineSource",
      position: pos(`routine-${r.id}`, defaultRx, ROUTINE_Y),
      data: { label: r.title.replace(/weekly|bi-weekly|monthly/gi, "").trim().slice(0, 22), status: r.status, lastRun, onClick: () => navigate(`/routines/${r.id}`) },
    });
    if (r.assigneeAgentId) {
      edges.push({
        id: `e-routine-${r.id}`,
        source: `routine-${r.id}`, target: `agent-${r.assigneeAgentId}`,
        animated: true,
        style: { stroke: "#22c55e", strokeWidth: 1.5, opacity: 0.7 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#22c55e80" },
      });
    }
  });

  // Issue signal nodes
  issues.filter((i) => i.status !== "done" && i.status !== "cancelled").slice(0, 8).forEach((issue, idx) => {
    const phase = issue.title.match(/\[Phase (\d+)\]/i)?.[1];
    const defaultIx = 30 + idx * 235;
    nodes.push({
      id: `issue-${issue.id}`, type: "issueSignal",
      position: pos(`issue-${issue.id}`, defaultIx, ISSUE_Y_BASE),
      data: {
        label: issue.title.replace(/\[Phase \d+\]\s*/i, "").slice(0, 32),
        status: issue.status, priority: (issue as { priority?: string }).priority ?? "medium",
        phase: phase ? `P${phase}` : "",
        onClick: () => navigate(`/issues/${issue.id}`),
      },
    });
    if (issue.assigneeAgentId) {
      issueAgentMap.set(`issue-${issue.id}`, `agent-${issue.assigneeAgentId}`);
      edges.push({
        id: `e-issue-${issue.id}`,
        source: `agent-${issue.assigneeAgentId}`, target: `issue-${issue.id}`,
        animated: issue.status === "in_progress",
        style: { stroke: issueGlow(issue.status), strokeWidth: issue.status === "in_progress" ? 2 : 1, opacity: 0.7 },
        markerEnd: { type: MarkerType.ArrowClosed, color: issueGlow(issue.status) },
      });
    }
  });

  return { nodes, edges, issueAgentMap };
}

// ─── Main component ─────────────────────────────────────────────────────────────
const POLL_MS = 7000;
const SAVE_DEBOUNCE_MS = 800;

export function CompanyConsole() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading]   = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [stats, setStats] = useState({ agents: 0, active: 0, issues: 0, routines: 0 });

  // Refs for drag persistence
  const savedLayoutRef   = useRef<ConsoleLayout>({});
  const issueAgentMapRef = useRef<Map<string, string>>(new Map());
  const prevPosRef       = useRef<Map<string, { x: number; y: number }>>(new Map());
  const saveTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setBreadcrumbs([{ label: "Console" }]); }, [setBreadcrumbs]);

  // Save layout to server (debounced)
  const persistLayout = useCallback((layout: ConsoleLayout) => {
    if (!selectedCompanyId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      consolePreferencesApi.save(selectedCompanyId, layout).catch(() => {/* silent */});
    }, SAVE_DEBOUNCE_MS);
  }, [selectedCompanyId]);

  const refresh = useCallback(async () => {
    if (!selectedCompanyId) return;
    try {
      const [routinesRaw, agentsRaw, issuesRaw] = await Promise.all([
        routinesApi.list(selectedCompanyId),
        agentsApi.list(selectedCompanyId),
        issuesApi.list(selectedCompanyId, { limit: 80 }),
      ]);
      const routines: RoutineData[] = routinesRaw.map((r) => ({
        id: r.id, title: r.title, status: r.status,
        lastTriggeredAt: (r as { lastTriggeredAt?: string | null }).lastTriggeredAt ?? null,
        assigneeAgentId: (r as { assigneeAgentId?: string | null }).assigneeAgentId ?? null,
      }));
      const agents: AgentData[] = agentsRaw.map((a) => ({
        id: a.id, name: a.name, role: a.role, status: a.status, adapterType: a.adapterType,
        title: (a as { title?: string | null }).title ?? null,
      }));
      const issues: IssueData[] = issuesRaw.map((i) => ({
        id: i.id, title: i.title, status: i.status,
        priority: (i as { priority?: string }).priority ?? "medium",
        assigneeAgentId: (i as { assigneeAgentId?: string | null }).assigneeAgentId ?? null,
      }));
      const { nodes: n, edges: e, issueAgentMap } = buildGraph(routines, agents, issues, savedLayoutRef.current, navigate);
      issueAgentMapRef.current = issueAgentMap;
      setNodes(n);
      setEdges(e);
      setLastRefresh(new Date());
      setStats({
        agents: agents.length,
        active: agents.filter((a) => a.status === "running").length,
        issues: issues.filter((i) => i.status === "in_progress").length,
        routines: routines.filter((r) => r.status === "active").length,
      });
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, setNodes, setEdges, navigate]);

  // Initial load: fetch saved layout first, then build graph
  useEffect(() => {
    if (!selectedCompanyId) return;
    consolePreferencesApi.get(selectedCompanyId)
      .then((layout) => { savedLayoutRef.current = layout ?? {}; })
      .catch(() => {})
      .finally(() => refresh());
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [selectedCompanyId, refresh]);

  // Tick for "X seconds ago" display
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const onNodeDragStart = useCallback((_evt: React.MouseEvent, node: Node) => {
    prevPosRef.current.set(node.id, { ...node.position });
  }, []);

  const onNodeDragStop = useCallback((_evt: React.MouseEvent, node: Node) => {
    const prev = prevPosRef.current.get(node.id);
    if (!prev) return;
    const dx = node.position.x - prev.x;
    const dy = node.position.y - prev.y;

    setNodes((nds) => {
      const updated = nds.map((n) => {
        // Issues (no parentId) follow their assigned agent using absolute delta
        if (node.type === "agentChip" && issueAgentMapRef.current.get(n.id) === node.id) {
          return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } };
        }
        return n;
      });

      // Persist positions: dept groups store absolute pos; agents store relative pos within group
      const newLayout: ConsoleLayout = { ...savedLayoutRef.current };
      for (const n of updated) {
        if (n.type === "deptGroup") {
          newLayout[n.id] = n.position;
        } else if (n.type === "agentChip") {
          newLayout[n.id] = n.position; // relative to parent
        } else if (!n.parentId) {
          newLayout[n.id] = n.position; // routines, issues — absolute
        }
      }
      savedLayoutRef.current = newLayout;
      persistLayout(newLayout);

      return updated;
    });
  }, [setNodes, persistLayout]);

  const secAgo = lastRefresh ? Math.floor((Date.now() - lastRefresh.getTime()) / 1000) : null;

  if (!selectedCompanyId) return <div className="flex h-full items-center justify-center text-muted-foreground">Select a company</div>;

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-4 py-2 shrink-0" style={{ background: "#060d1a", borderBottom: "1px solid #1e293b" }}>
        <div className="flex items-center gap-4">
          <span className="font-bold tracking-wider" style={{ color: "#38bdf8", fontSize: 12 }}>⬡ COMPANY CONSOLE</span>
          {[
            { label: "AGENTS",    value: stats.agents,   color: "#60a5fa" },
            { label: "RUNNING",   value: stats.active,   color: "#34d399" },
            { label: "IN FLIGHT", value: stats.issues,   color: "#fbbf24" },
            { label: "ROUTINES",  value: stats.routines, color: "#22c55e" },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center gap-1.5 rounded px-2 py-0.5" style={{ background: color + "15" }}>
              <span style={{ color, fontSize: 9, fontWeight: 700 }}>{label}</span>
              <span style={{ color, fontSize: 13, fontWeight: 800, fontFamily: "monospace" }}>{value}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5" style={{ fontSize: 9, color: "#475569" }}>
            {[["#22c55e","Routine"],["#60a5fa","Idle"],["#34d399","Running"],["#ef4444","Error"],["#fbbf24","In flight"]].map(([c,l]) => (
              <span key={l} className="flex items-center gap-1">
                <span style={{ background: c, width: 6, height: 6, borderRadius: "50%", display: "inline-block", boxShadow: `0 0 4px ${c}` }} />{l}
              </span>
            ))}
          </div>
          <button onClick={refresh} className="flex items-center gap-1 rounded px-2 py-1" style={{ background: "#0f172a", border: "1px solid #1e293b", color: "#64748b", fontSize: 10 }}>
            <RefreshCw style={{ width: 10, height: 10 }} />
            {secAgo !== null ? `${secAgo}s` : "…"}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1" style={{ background: "#060d1a" }}>
        {loading ? (
          <div className="flex h-full items-center justify-center" style={{ color: "#1e3a5f", fontSize: 13 }}>Loading circuit…</div>
        ) : (
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onNodeDragStart={onNodeDragStart} onNodeDragStop={onNodeDragStop}
            nodeTypes={nodeTypes}
            fitView fitViewOptions={{ padding: 0.1 }}
            minZoom={0.2} maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#0f2040" />
            <Controls style={{ background: "#0f172a", border: "1px solid #1e293b" }} showInteractive={false} />
            <MiniMap
              style={{ background: "#060d1a", border: "1px solid #1e293b" }}
              nodeColor={(n) => {
                if (n.type === "agentChip")     return agentGlow((n.data as { status: string }).status);
                if (n.type === "routineSource") return routineGlow((n.data as { status: string }).status);
                if (n.type === "issueSignal")   return issueGlow((n.data as { status: string }).status);
                if (n.type === "deptGroup")     return (n.data as { color: string }).color;
                return "#0f172a";
              }}
              maskColor="#06090d90"
            />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
