import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, AlertTriangle, XCircle, RefreshCw, Unlock, Activity } from "lucide-react";
import { projectHealthApi, type ProjectHealthData } from "../api/projectHealth";
import { Button } from "@/components/ui/button";

interface Props {
  companyId: string;
  projectId: string;
}

const STATUS_COLOR: Record<string, string> = {
  in_progress: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  in_review: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  blocked: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  done: "bg-green-500/15 text-green-300 border-green-500/30",
  todo: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  backlog: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  cancelled: "bg-red-500/10 text-red-400 border-red-500/20",
};

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_COLOR[status] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function SummaryCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4 flex flex-col gap-1">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold ${color ?? "text-foreground"}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

export function ProjectHealthTab({ companyId, projectId }: Props) {
  const qc = useQueryClient();
  const [unblockResult, setUnblockResult] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery<ProjectHealthData>({
    queryKey: ["project-health", companyId, projectId],
    queryFn: () => projectHealthApi.get(companyId, projectId),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const unblockMut = useMutation({
    mutationFn: () => projectHealthApi.unblockStale(companyId, projectId),
    onSuccess: (result) => {
      setUnblockResult(`Removed ${result.removedRelations} stale blocker(s), reset ${result.resetIssues} issue(s) to "todo"`);
      void qc.invalidateQueries({ queryKey: ["project-health", companyId, projectId] });
    },
  });

  const cancelMut = useMutation({
    mutationFn: () => projectHealthApi.cancelSentinels(companyId, projectId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["project-health", companyId, projectId] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load project health data.
      </div>
    );
  }

  const { summary, active, staleBlockers, failedRuns } = data;
  const pctDone = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0;
  const activeCount = summary.in_progress + summary.in_review;

  // Deduplicate stale blockers by blocked issue id
  const uniqueBlocked = new Map<string, typeof staleBlockers[0]>();
  for (const b of staleBlockers) {
    if (!uniqueBlocked.has(b.id)) uniqueBlocked.set(b.id, b);
  }
  const blockedIssues = [...uniqueBlocked.values()];

  // Deduplicate failed runs by issue id (keep latest)
  const uniqueFailed = new Map<string, typeof failedRuns[0]>();
  for (const r of failedRuns) {
    const key = r.issue_id ?? r.run_id;
    if (!uniqueFailed.has(key)) uniqueFailed.set(key, r);
  }
  const failedIssues = [...uniqueFailed.values()];

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          Project Health
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs text-muted-foreground"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard
          label="Overall Progress"
          value={`${pctDone}%`}
          sub={`${summary.done} / ${summary.total} tasks done`}
          color={pctDone >= 80 ? "text-green-400" : pctDone >= 50 ? "text-yellow-400" : "text-foreground"}
        />
        <SummaryCard
          label="Active Now"
          value={activeCount}
          sub={`${summary.in_progress} running · ${summary.in_review} in review`}
          color={activeCount > 0 ? "text-blue-400" : "text-muted-foreground"}
        />
        <SummaryCard
          label="Blocked"
          value={blockedIssues.length}
          sub="stale dependency relations"
          color={blockedIssues.length > 0 ? "text-orange-400" : "text-muted-foreground"}
        />
        <SummaryCard
          label="Failed Runs"
          value={failedIssues.length}
          sub="adapter/process failures (7d)"
          color={failedIssues.length > 0 ? "text-red-400" : "text-muted-foreground"}
        />
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Done</span>
          <span>{summary.done} / {summary.total}</span>
        </div>
        <div className="h-2 rounded-full bg-accent overflow-hidden">
          <div
            className="h-full rounded-full bg-green-500 transition-all duration-500"
            style={{ width: `${pctDone}%` }}
          />
        </div>
        <div className="flex gap-3 text-[11px] text-muted-foreground flex-wrap">
          {summary.in_progress > 0 && <span className="text-blue-400">{summary.in_progress} in progress</span>}
          {summary.in_review > 0 && <span className="text-purple-400">{summary.in_review} in review</span>}
          {summary.todo > 0 && <span>{summary.todo} todo</span>}
          {summary.backlog > 0 && <span>{summary.backlog} backlog</span>}
          {summary.blocked > 0 && <span className="text-orange-400">{summary.blocked} blocked</span>}
          {summary.cancelled > 0 && <span className="text-muted-foreground/60">{summary.cancelled} cancelled</span>}
        </div>
      </div>

      {/* Active Work */}
      <Section title={`Active Work (${active.length})`}>
        {active.length === 0 ? (
          <Empty label="No tasks currently running" />
        ) : (
          <div className="space-y-2">
            {active.map((issue) => (
              <div key={issue.id} className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">{issue.identifier}</span>
                    <span className="text-sm text-foreground truncate">{issue.title}</span>
                  </div>
                  {issue.agentName && (
                    <p className="text-xs text-muted-foreground mt-0.5">{issue.agentName}</p>
                  )}
                </div>
                <StatusChip status={issue.status} />
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Stale Blockers */}
      <Section
        title={`Stuck Issues — Stale Blockers (${blockedIssues.length})`}
        action={
          blockedIssues.length > 0 ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => cancelMut.mutate()}
                disabled={cancelMut.isPending}
                className="text-xs h-7"
              >
                {cancelMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Cancel Sentinels
              </Button>
              <Button
                size="sm"
                onClick={() => { setUnblockResult(null); unblockMut.mutate(); }}
                disabled={unblockMut.isPending}
                className="text-xs h-7 bg-orange-600 hover:bg-orange-500 text-white"
              >
                {unblockMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Unlock className="h-3 w-3 mr-1" />}
                Unblock All
              </Button>
            </div>
          ) : null
        }
      >
        {unblockResult && (
          <div className="rounded border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-300 flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            {unblockResult}
          </div>
        )}
        {blockedIssues.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-6 text-center">
            <CheckCircle2 className="h-5 w-5 text-green-400 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No stale blocking relations</p>
          </div>
        ) : (
          <div className="space-y-2">
            {blockedIssues.map((issue) => (
              <div key={issue.id} className="rounded-lg border border-orange-500/20 bg-orange-500/5 px-3 py-2.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-orange-400 shrink-0" />
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">{issue.identifier}</span>
                  <span className="text-sm text-foreground truncate">{issue.title}</span>
                  <StatusChip status={issue.status} />
                </div>
                <div className="pl-5 text-xs text-muted-foreground">
                  Blocked by{" "}
                  <span className="font-mono text-[10px] border border-border rounded px-1 py-0.5 mr-1">{issue.blocker_identifier}</span>
                  <span className="text-foreground/70">{issue.blocker_title}</span>
                  {" — "}
                  <StatusChip status={issue.blocker_status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Failed Runs */}
      <Section title={`Recent Adapter Failures (${failedIssues.length})`}>
        {failedIssues.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-6 text-center">
            <CheckCircle2 className="h-5 w-5 text-green-400 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No adapter failures in the last 7 days</p>
          </div>
        ) : (
          <div className="space-y-2">
            {failedIssues.map((run) => (
              <div key={run.run_id} className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5 space-y-1">
                <div className="flex items-center gap-2">
                  <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                  {run.issue_identifier && (
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">{run.issue_identifier}</span>
                  )}
                  <span className="text-sm text-foreground truncate">{run.issue_title ?? "(no issue)"}</span>
                  {run.issue_status && <StatusChip status={run.issue_status} />}
                </div>
                <div className="pl-5 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{run.agent_name ?? "Unknown agent"}</span>
                  <span className="rounded border border-red-500/30 bg-red-500/10 text-red-400 px-1.5 py-0.5 text-[10px] font-mono">{run.error_code}</span>
                  <span>{new Date(run.finished_at).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {failedIssues.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            Tip: Go to the Issues tab, filter by "blocked", then use Resume to retry individual agents. The workflow will auto-fallback to claude_local on adapter failures.
          </p>
        )}
      </Section>
    </div>
  );
}
