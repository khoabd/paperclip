// MCP InvocationRecorder per ADR-0010 / Phase-4-MCP §audit-trail.
// Persists every MCP tool call into `mcp_tool_invocations` with secret redaction
// applied to both request and response payloads. Tracks status via the `error`
// column (null = success, "timeout" / message text = failure).

import { mcpToolInvocations, type createDb } from "@paperclipai/db";

export type McpDb = ReturnType<typeof createDb>;

const REDACTED = "[REDACTED]";

// Default secret-bearing key fragments. Match is case-insensitive on the JSON path.
export const DEFAULT_SECRET_KEY_PATTERNS = [
  /token/i,
  /api[-_]?key/i,
  /secret/i,
  /password/i,
  /bearer/i,
  /authorization/i,
  /credential/i,
] as const;

// Heuristic body patterns to redact when the value is a string that *contains* a secret-like token.
// Stays conservative to avoid corrupting legitimate response data.
export const DEFAULT_SECRET_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._\-]+/g,
  /sk-[A-Za-z0-9]{16,}/g,
  /xoxb-[A-Za-z0-9-]+/g,
  /AKIA[0-9A-Z]{16}/g,
] as const;

export type RedactionConfig = {
  keyPatterns?: readonly RegExp[];
  valuePatterns?: readonly RegExp[];
};

export function redactJson(input: unknown, config: RedactionConfig = {}): unknown {
  const keyPatterns = config.keyPatterns ?? DEFAULT_SECRET_KEY_PATTERNS;
  const valuePatterns = config.valuePatterns ?? DEFAULT_SECRET_VALUE_PATTERNS;

  function shouldRedactKey(key: string): boolean {
    return keyPatterns.some((re) => re.test(key));
  }

  function redactString(value: string): string {
    let out = value;
    for (const re of valuePatterns) {
      out = out.replace(re, REDACTED);
    }
    return out;
  }

  function walk(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return redactString(value);
    if (typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(walk);

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (shouldRedactKey(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = walk(v);
      }
    }
    return out;
  }

  return walk(input);
}

export type InvocationStatus = "success" | "timeout" | "error";

export type RecordInvocationInput = {
  mcpServerId: string;
  companyId: string;
  agentId?: string | null;
  missionId?: string | null;
  toolName: string;
  request: unknown;
  response?: unknown;
  durationMs: number;
  status?: InvocationStatus;
  errorMessage?: string;
};

export type RecordedInvocation = {
  id: string;
  toolName: string;
  status: InvocationStatus;
  durationMs: number;
  requestRedacted: unknown;
  responseRedacted: unknown;
};

export class InvocationRecorder {
  constructor(private readonly db: McpDb, private readonly config: RedactionConfig = {}) {}

  async record(input: RecordInvocationInput): Promise<RecordedInvocation> {
    const status: InvocationStatus = input.status ?? (input.errorMessage ? "error" : "success");
    const requestRedacted = redactJson(input.request, this.config);
    const responseRedacted = input.response === undefined
      ? {}
      : redactJson(input.response, this.config);

    const errorText = input.errorMessage
      ? redactString(input.errorMessage, this.config)
      : status === "timeout"
        ? "timeout"
        : null;

    const [row] = await this.db
      .insert(mcpToolInvocations)
      .values({
        mcpServerId: input.mcpServerId,
        companyId: input.companyId,
        agentId: input.agentId ?? null,
        missionId: input.missionId ?? null,
        toolName: input.toolName,
        requestJson: requestRedacted as Record<string, unknown>,
        responseSummary: responseRedacted as Record<string, unknown>,
        durationMs: Math.max(0, Math.floor(input.durationMs)),
        error: errorText,
      })
      .returning();

    return {
      id: row.id,
      toolName: row.toolName,
      status,
      durationMs: row.durationMs,
      requestRedacted: row.requestJson,
      responseRedacted: row.responseSummary,
    };
  }
}

function redactString(input: string, config: RedactionConfig): string {
  const patterns = config.valuePatterns ?? DEFAULT_SECRET_VALUE_PATTERNS;
  let out = input;
  for (const re of patterns) {
    out = out.replace(re, REDACTED);
  }
  return out;
}
