export type McpServerKind = "gitlab" | "opensearch" | "research" | "runner" | "custom";
export type McpTransportKind = "stdio" | "http+sse" | "websocket" | "in-memory";
export type McpServerStatus = "enabled" | "disabled" | "degraded";

export interface McpServerRegistration {
  id: string;
  companyId: string | null;
  name: string;
  kind: McpServerKind;
  transport: McpTransportKind;
  endpoint: string;
  authToken: string | null;
  status: McpServerStatus;
  config: Record<string, unknown>;
}

export interface McpInvocationRecord {
  mcpServerId: string;
  companyId: string;
  agentId?: string | null;
  missionId?: string | null;
  toolName: string;
  request: unknown;
  responseSummary: { ok: boolean; status: string; byteSize?: number };
  durationMs: number;
  error?: string | null;
  occurredAt: Date;
}

export interface InvocationRecorder {
  record(record: McpInvocationRecord): Promise<void> | void;
}

export interface McpToolCallResult {
  ok: boolean;
  content: unknown;
  durationMs: number;
  error?: string;
}

export interface McpRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: McpRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
};

export interface McpBreakerOptions {
  failureThreshold: number;
  resetAfterMs: number;
}

export const DEFAULT_BREAKER_OPTIONS: McpBreakerOptions = {
  failureThreshold: 5,
  resetAfterMs: 30_000,
};
