import { api } from "./client";

export interface HealthSummary {
  total: number;
  done: number;
  in_progress: number;
  in_review: number;
  blocked: number;
  todo: number;
  backlog: number;
  cancelled: number;
}

export interface ActiveIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  agentName: string | null;
}

export interface StaleBlocker {
  id: string;
  identifier: string;
  title: string;
  status: string;
  agent_name: string | null;
  blocker_id: string;
  blocker_identifier: string;
  blocker_title: string;
  blocker_status: string;
  relation_id: string;
}

export interface FailedRun {
  run_id: string;
  error_code: string;
  error: string | null;
  finished_at: string;
  agent_id: string;
  agent_name: string | null;
  issue_id: string | null;
  issue_identifier: string | null;
  issue_title: string | null;
  issue_status: string | null;
}

export interface ProjectHealthData {
  summary: HealthSummary;
  active: ActiveIssue[];
  staleBlockers: StaleBlocker[];
  failedRuns: FailedRun[];
}

export const projectHealthApi = {
  get: (companyId: string, projectId: string): Promise<ProjectHealthData> =>
    api.get(`/companies/${companyId}/projects/${projectId}/health`),

  unblockStale: (companyId: string, projectId: string): Promise<{ removedRelations: number; resetIssues: number }> =>
    api.post(`/companies/${companyId}/projects/${projectId}/health/unblock-stale`, {}),

  cancelSentinels: (companyId: string, projectId: string): Promise<{ cancelled: number; sentinels: string[] }> =>
    api.post(`/companies/${companyId}/projects/${projectId}/health/cancel-sentinels`, {}),
};
