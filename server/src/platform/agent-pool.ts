// Lookup of platform-level agent catalog (role -> default model + prompt template).
// Per Phase-2-Platform-Workspace-Mission-Layer §2.1 (agent catalog).

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { platformAgents } from "@paperclipai/db";

export interface PlatformAgentRecord {
  id: string;
  name: string;
  role: string;
  defaultModel: string;
  promptTemplateKey: string | null;
  status: string;
  description: string | null;
}

export class AgentPool {
  constructor(private readonly db: Db) {}

  async getByName(name: string): Promise<PlatformAgentRecord | null> {
    const row = (
      await this.db.select().from(platformAgents).where(eq(platformAgents.name, name)).limit(1)
    )[0];
    return row ? toRecord(row) : null;
  }

  async listByRole(role: string): Promise<PlatformAgentRecord[]> {
    const rows = await this.db.select().from(platformAgents).where(eq(platformAgents.role, role));
    return rows.map(toRecord);
  }

  async listActive(): Promise<PlatformAgentRecord[]> {
    const rows = await this.db
      .select()
      .from(platformAgents)
      .where(eq(platformAgents.status, "active"));
    return rows.map(toRecord);
  }
}

function toRecord(row: typeof platformAgents.$inferSelect): PlatformAgentRecord {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    defaultModel: row.defaultModel,
    promptTemplateKey: row.promptTemplateKey,
    status: row.status,
    description: row.description,
  };
}
