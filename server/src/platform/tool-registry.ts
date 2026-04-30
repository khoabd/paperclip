// Look up registered platform tools by key. Bridges to mcp_servers via mcp_server_id.
// Per Phase-2-Platform-Workspace-Mission-Layer §2.1 (tool registry).

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { platformTools } from "@paperclipai/db";

export interface RegisteredTool {
  id: string;
  key: string;
  name: string;
  mcpServerId: string | null;
  toolName: string;
  schemaJson: unknown;
  status: string;
  description: string | null;
}

export class ToolRegistry {
  constructor(private readonly db: Db) {}

  async getByKey(key: string): Promise<RegisteredTool | null> {
    const row = (
      await this.db.select().from(platformTools).where(eq(platformTools.key, key)).limit(1)
    )[0];
    if (!row) return null;
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      mcpServerId: row.mcpServerId,
      toolName: row.toolName,
      schemaJson: row.schemaJson,
      status: row.status,
      description: row.description,
    };
  }

  async listActive(): Promise<RegisteredTool[]> {
    const rows = await this.db
      .select()
      .from(platformTools)
      .where(eq(platformTools.status, "active"));
    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      mcpServerId: row.mcpServerId,
      toolName: row.toolName,
      schemaJson: row.schemaJson,
      status: row.status,
      description: row.description,
    }));
  }
}
