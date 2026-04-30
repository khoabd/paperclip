import type {
  InvocationRecorder,
  McpServerKind,
  McpServerRegistration,
} from "./types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { McpClient, type McpClientOptions } from "./client.js";

export interface RegistryLoader {
  list(filter?: { companyId?: string | null; kind?: McpServerKind }): Promise<McpServerRegistration[]>;
  get(id: string): Promise<McpServerRegistration | null>;
}

export class StaticRegistryLoader implements RegistryLoader {
  constructor(private readonly registrations: McpServerRegistration[]) {}

  async list(filter?: { companyId?: string | null; kind?: McpServerKind }): Promise<McpServerRegistration[]> {
    return this.registrations.filter((r) => {
      if (filter?.kind && r.kind !== filter.kind) return false;
      if (filter?.companyId !== undefined && r.companyId !== filter.companyId) return false;
      return true;
    });
  }

  async get(id: string): Promise<McpServerRegistration | null> {
    return this.registrations.find((r) => r.id === id) ?? null;
  }
}

export interface McpRegistryOptions {
  loader: RegistryLoader;
  transportFactory: (registration: McpServerRegistration) => Promise<Transport> | Transport;
  recorder?: InvocationRecorder;
  clientOptions?: Pick<McpClientOptions, "retryPolicy" | "breakerOptions" | "clientName" | "clientVersion">;
}

export class McpRegistry {
  private readonly clients = new Map<string, McpClient>();

  constructor(private readonly options: McpRegistryOptions) {}

  async resolveClient(registrationId: string): Promise<McpClient> {
    const cached = this.clients.get(registrationId);
    if (cached) return cached;
    const registration = await this.options.loader.get(registrationId);
    if (!registration) throw new Error(`MCP server not found: ${registrationId}`);
    const client = new McpClient({
      registration,
      transportFactory: this.options.transportFactory,
      recorder: this.options.recorder,
      ...this.options.clientOptions,
    });
    this.clients.set(registrationId, client);
    return client;
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled(Array.from(this.clients.values()).map((c) => c.close()));
    this.clients.clear();
  }
}
