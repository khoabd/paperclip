// ContractRegistry — tracks contract evolution (register, deprecate, findActive).
// Phase 12 §Services.2.

import { eq, and, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { contractVersions } from "@paperclipai/db/schema/contract_versions";

export interface RegisterContractInput {
  companyId: string;
  repoId?: string;
  kind: "api" | "event" | "schema" | "protocol";
  name: string;
  version: string;
  schemaHash?: string;
}

export interface ContractRow {
  id: string;
  companyId: string;
  repoId: string | null;
  kind: string;
  name: string;
  version: string;
  schemaHash: string | null;
  deprecatedAt: Date | null;
  deprecatedFor: string | null;
  createdAt: Date;
}

export class ContractRegistry {
  constructor(private readonly db: Db) {}

  /**
   * Registers a new contract version. Idempotent — if the (company, kind, name, version)
   * combination already exists the existing row is returned unchanged.
   */
  async register(input: RegisterContractInput): Promise<ContractRow> {
    const existing = await this.db
      .select()
      .from(contractVersions)
      .where(
        and(
          eq(contractVersions.companyId, input.companyId),
          eq(contractVersions.kind, input.kind),
          eq(contractVersions.name, input.name),
          eq(contractVersions.version, input.version),
        ),
      );

    if (existing.length > 0) {
      return existing[0] as ContractRow;
    }

    const [row] = await this.db
      .insert(contractVersions)
      .values({
        companyId: input.companyId,
        repoId: input.repoId ?? null,
        kind: input.kind,
        name: input.name,
        version: input.version,
        schemaHash: input.schemaHash ?? null,
        createdAt: new Date(),
      })
      .returning();

    return row as ContractRow;
  }

  /**
   * Marks a contract version as deprecated, recording the replacement name.
   * Throws if the contract id is not found.
   */
  async deprecate(id: string, replacementName: string): Promise<ContractRow> {
    const rows = await this.db
      .update(contractVersions)
      .set({ deprecatedAt: new Date(), deprecatedFor: replacementName })
      .where(eq(contractVersions.id, id))
      .returning();

    if (rows.length === 0) {
      throw new Error(`ContractVersion ${id} not found`);
    }

    return rows[0] as ContractRow;
  }

  /**
   * Returns all active (non-deprecated) versions of a contract by kind + name.
   */
  async findActive(kind: string, name: string): Promise<ContractRow[]> {
    const rows = await this.db
      .select()
      .from(contractVersions)
      .where(
        and(
          eq(contractVersions.kind, kind),
          eq(contractVersions.name, name),
          isNull(contractVersions.deprecatedAt),
        ),
      );

    return rows as ContractRow[];
  }
}
