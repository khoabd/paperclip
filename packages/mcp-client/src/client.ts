import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from "./circuit-breaker.js";
import {
  DEFAULT_RETRY_POLICY,
  type InvocationRecorder,
  type McpBreakerOptions,
  type McpRetryPolicy,
  type McpServerRegistration,
  type McpToolCallResult,
} from "./types.js";

export interface McpClientCallContext {
  agentId?: string | null;
  missionId?: string | null;
}

export interface McpClientOptions {
  registration: McpServerRegistration;
  transportFactory: (registration: McpServerRegistration) => Promise<Transport> | Transport;
  recorder?: InvocationRecorder;
  retryPolicy?: Partial<McpRetryPolicy>;
  breakerOptions?: Partial<McpBreakerOptions>;
  clientName?: string;
  clientVersion?: string;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const utf8Encoder = new TextEncoder();
function summariseResponse(content: unknown): { ok: boolean; status: string; byteSize: number } {
  let byteSize = 0;
  try {
    byteSize = utf8Encoder.encode(JSON.stringify(content ?? null)).length;
  } catch {
    byteSize = 0;
  }
  return { ok: true, status: "ok", byteSize };
}

function extractToolError(content: unknown): string {
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item && typeof item === "object" && "text" in item && typeof (item as { text?: unknown }).text === "string") {
        return (item as { text: string }).text;
      }
    }
  }
  return "MCP tool returned isError=true";
}

function redactRequest(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const cloned = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  for (const key of Object.keys(cloned)) {
    if (/token|secret|password|apiKey/i.test(key)) {
      cloned[key] = "[redacted]";
    }
  }
  return cloned;
}

export class McpClient {
  private readonly client: Client;
  private readonly breaker: CircuitBreaker;
  private readonly retry: McpRetryPolicy;
  private readonly opts: McpClientOptions;
  private connected = false;
  private transport: Transport | null = null;

  constructor(opts: McpClientOptions) {
    this.opts = opts;
    this.client = new Client(
      {
        name: opts.clientName ?? "paperclip-mcp-client",
        version: opts.clientVersion ?? "0.1.0",
      },
      {
        capabilities: {},
      },
    );
    this.breaker = new CircuitBreaker(opts.breakerOptions);
    this.retry = { ...DEFAULT_RETRY_POLICY, ...(opts.retryPolicy ?? {}) };
  }

  get registration(): McpServerRegistration {
    return this.opts.registration;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.transport = await this.opts.transportFactory(this.opts.registration);
    await this.client.connect(this.transport);
    this.connected = true;
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.connected = false;
    this.transport = null;
  }

  async listTools(): Promise<{ name: string; description?: string }[]> {
    await this.connect();
    const result = await this.client.listTools();
    return result.tools.map((t) => ({ name: t.name, description: t.description }));
  }

  async health(): Promise<{ ok: true; tools: number } | { ok: false; error: string }> {
    try {
      const tools = await this.listTools();
      return { ok: true, tools: tools.length };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    ctx: McpClientCallContext = {},
  ): Promise<McpToolCallResult> {
    if (!this.breaker.canAttempt()) {
      throw new CircuitBreakerOpenError(this.opts.registration.id);
    }
    await this.connect();

    const start = Date.now();
    let attempt = 0;
    let lastError: unknown;

    while (attempt < this.retry.maxAttempts) {
      attempt += 1;
      try {
        const response = await this.client.callTool({ name: toolName, arguments: args });
        if (response.isError) {
          throw new Error(extractToolError(response.content));
        }
        const durationMs = Date.now() - start;
        this.breaker.recordSuccess();
        const summary = summariseResponse(response.content);
        await this.recordInvocation({
          toolName,
          args,
          summary,
          durationMs,
          error: null,
          ctx,
        });
        return { ok: true, content: response.content, durationMs };
      } catch (error) {
        lastError = error;
        const isLast = attempt >= this.retry.maxAttempts;
        if (isLast) break;
        const delay = Math.min(
          this.retry.maxDelayMs,
          this.retry.baseDelayMs * 2 ** (attempt - 1),
        );
        await (this.opts.sleep ?? defaultSleep)(delay);
      }
    }

    const durationMs = Date.now() - start;
    this.breaker.recordFailure();
    const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
    await this.recordInvocation({
      toolName,
      args,
      summary: { ok: false, status: "error" },
      durationMs,
      error: errMsg,
      ctx,
    });
    return { ok: false, content: null, durationMs, error: errMsg };
  }

  private async recordInvocation(input: {
    toolName: string;
    args: Record<string, unknown>;
    summary: { ok: boolean; status: string; byteSize?: number };
    durationMs: number;
    error: string | null;
    ctx: McpClientCallContext;
  }): Promise<void> {
    if (!this.opts.recorder) return;
    if (!this.opts.registration.companyId) return;
    try {
      await this.opts.recorder.record({
        mcpServerId: this.opts.registration.id,
        companyId: this.opts.registration.companyId,
        agentId: input.ctx.agentId ?? null,
        missionId: input.ctx.missionId ?? null,
        toolName: input.toolName,
        request: redactRequest(input.args),
        responseSummary: input.summary,
        durationMs: input.durationMs,
        error: input.error,
        occurredAt: new Date(),
      });
    } catch {
      // recorder failures must never break the call site
    }
  }
}
