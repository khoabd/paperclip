// Per-workspace Brain stored as a `documents` row with key='brain' (per ADR-0007).
// Mission-scoped subdocs use key='brain/missions/<missionId>'.
// Provides round-trip read/write + insight append, persisting a new document_revisions row.

import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { documents, documentRevisions } from "@paperclipai/db";

export interface Brain {
  documentId: string;
  body: string;
  revisionNumber: number;
  revisionId: string | null;
}

export interface InsightInput {
  workspaceId: string;
  kind: string;
  body: string;
  actorAgentId?: string | null;
  actorUserId?: string | null;
  changeSummary?: string | null;
}

export class BrainStore {
  constructor(private readonly db: Db) {}

  async getBrain(workspaceId: string): Promise<Brain> {
    return this.getOrCreate(workspaceId, "brain", "Workspace Brain");
  }

  async getMissionBrain(workspaceId: string, missionId: string): Promise<Brain> {
    return this.getOrCreate(
      workspaceId,
      `brain/missions/${missionId}`,
      `Mission Brain ${missionId}`,
    );
  }

  async appendInsight(input: InsightInput): Promise<Brain> {
    return this.appendSection({
      workspaceId: input.workspaceId,
      key: "brain",
      title: "Workspace Brain",
      heading: "## Insights",
      kind: input.kind,
      body: input.body,
      actorAgentId: input.actorAgentId ?? null,
      actorUserId: input.actorUserId ?? null,
      changeSummary: input.changeSummary ?? `insight:${input.kind}`,
    });
  }

  async appendMissionNote(input: InsightInput & { missionId: string }): Promise<Brain> {
    return this.appendSection({
      workspaceId: input.workspaceId,
      key: `brain/missions/${input.missionId}`,
      title: `Mission Brain ${input.missionId}`,
      heading: "## Notes",
      kind: input.kind,
      body: input.body,
      actorAgentId: input.actorAgentId ?? null,
      actorUserId: input.actorUserId ?? null,
      changeSummary: input.changeSummary ?? `mission-note:${input.kind}`,
    });
  }

  // -----------------------------------------------------------------------
  // Greenfield-specific sub-documents (ADR-0007 keys)
  // -----------------------------------------------------------------------

  async setPersonaDoc(workspaceId: string, slug: string, body: string): Promise<Brain> {
    const key = `persona/${slug}`;
    const title = `Persona: ${slug}`;
    const existing = (
      await this.db
        .select()
        .from(documents)
        .where(and(eq(documents.companyId, workspaceId), eq(documents.key, key)))
        .limit(1)
    )[0];
    if (!existing) {
      const inserted = (
        await this.db
          .insert(documents)
          .values({ companyId: workspaceId, key, title, format: "markdown", latestBody: body, latestRevisionNumber: 1 })
          .returning()
      )[0]!;
      const revision = (
        await this.db
          .insert(documentRevisions)
          .values({ companyId: workspaceId, documentId: inserted.id, revisionNumber: 1, title, format: "markdown", body, changeSummary: "greenfield-persona-init" })
          .returning()
      )[0]!;
      await this.db.update(documents).set({ latestRevisionId: revision.id, updatedAt: new Date() }).where(eq(documents.id, inserted.id));
      return { documentId: inserted.id, body, revisionNumber: 1, revisionId: revision.id };
    }
    // update existing
    const nextNumber = existing.latestRevisionNumber + 1;
    const revision = (
      await this.db
        .insert(documentRevisions)
        .values({ companyId: workspaceId, documentId: existing.id, revisionNumber: nextNumber, title, format: "markdown", body, changeSummary: "greenfield-persona-update" })
        .returning()
    )[0]!;
    await this.db.update(documents).set({ latestBody: body, latestRevisionNumber: nextNumber, latestRevisionId: revision.id, updatedAt: new Date() }).where(eq(documents.id, existing.id));
    return { documentId: existing.id, body, revisionNumber: nextNumber, revisionId: revision.id };
  }

  async setMarketResearch(workspaceId: string, intakeId: string, body: string): Promise<Brain> {
    return this.upsertDoc(workspaceId, `market_research/${intakeId}`, `Market Research ${intakeId}`, body, "greenfield-market-research");
  }

  async setStackDoc(workspaceId: string, intakeId: string, body: string): Promise<Brain> {
    return this.upsertDoc(workspaceId, `stack/${intakeId}`, `Stack ${intakeId}`, body, "greenfield-stack");
  }

  async setGreenfieldBrain(workspaceId: string, intakeId: string, body: string): Promise<Brain> {
    return this.upsertDoc(workspaceId, `brain/greenfield/${intakeId}`, `Greenfield Brain ${intakeId}`, body, "greenfield-brain");
  }

  private async upsertDoc(workspaceId: string, key: string, title: string, body: string, changeSummary: string): Promise<Brain> {
    const existing = (
      await this.db
        .select()
        .from(documents)
        .where(and(eq(documents.companyId, workspaceId), eq(documents.key, key)))
        .limit(1)
    )[0];
    if (!existing) {
      const inserted = (
        await this.db
          .insert(documents)
          .values({ companyId: workspaceId, key, title, format: "markdown", latestBody: body, latestRevisionNumber: 1 })
          .returning()
      )[0]!;
      const revision = (
        await this.db
          .insert(documentRevisions)
          .values({ companyId: workspaceId, documentId: inserted.id, revisionNumber: 1, title, format: "markdown", body, changeSummary })
          .returning()
      )[0]!;
      await this.db.update(documents).set({ latestRevisionId: revision.id, updatedAt: new Date() }).where(eq(documents.id, inserted.id));
      return { documentId: inserted.id, body, revisionNumber: 1, revisionId: revision.id };
    }
    const nextNumber = existing.latestRevisionNumber + 1;
    const revision = (
      await this.db
        .insert(documentRevisions)
        .values({ companyId: workspaceId, documentId: existing.id, revisionNumber: nextNumber, title, format: "markdown", body, changeSummary })
        .returning()
    )[0]!;
    await this.db.update(documents).set({ latestBody: body, latestRevisionNumber: nextNumber, latestRevisionId: revision.id, updatedAt: new Date() }).where(eq(documents.id, existing.id));
    return { documentId: existing.id, body, revisionNumber: nextNumber, revisionId: revision.id };
  }

  private async getOrCreate(workspaceId: string, key: string, title: string): Promise<Brain> {
    const existing = (
      await this.db
        .select()
        .from(documents)
        .where(and(eq(documents.companyId, workspaceId), eq(documents.key, key)))
        .limit(1)
    )[0];
    if (existing) {
      return {
        documentId: existing.id,
        body: existing.latestBody,
        revisionNumber: existing.latestRevisionNumber,
        revisionId: existing.latestRevisionId ?? null,
      };
    }
    const seedBody = `# ${title}\n\n## Insights\n\n## Notes\n`;
    const inserted = (
      await this.db
        .insert(documents)
        .values({
          companyId: workspaceId,
          key,
          title,
          format: "markdown",
          latestBody: seedBody,
          latestRevisionNumber: 1,
        })
        .returning()
    )[0]!;
    const revision = (
      await this.db
        .insert(documentRevisions)
        .values({
          companyId: workspaceId,
          documentId: inserted.id,
          revisionNumber: 1,
          title,
          format: "markdown",
          body: seedBody,
          changeSummary: "init",
        })
        .returning()
    )[0]!;
    await this.db
      .update(documents)
      .set({ latestRevisionId: revision.id, updatedAt: new Date() })
      .where(eq(documents.id, inserted.id));
    return {
      documentId: inserted.id,
      body: seedBody,
      revisionNumber: 1,
      revisionId: revision.id,
    };
  }

  private async appendSection(opts: {
    workspaceId: string;
    key: string;
    title: string;
    heading: string;
    kind: string;
    body: string;
    actorAgentId: string | null;
    actorUserId: string | null;
    changeSummary: string;
  }): Promise<Brain> {
    const current = await this.getOrCreate(opts.workspaceId, opts.key, opts.title);
    const block = `\n- **${opts.kind}** (${new Date().toISOString()}): ${opts.body}`;
    const next = appendUnderHeading(current.body, opts.heading, block);
    const nextNumber = current.revisionNumber + 1;
    const revision = (
      await this.db
        .insert(documentRevisions)
        .values({
          companyId: opts.workspaceId,
          documentId: current.documentId,
          revisionNumber: nextNumber,
          title: opts.title,
          format: "markdown",
          body: next,
          changeSummary: opts.changeSummary,
          createdByAgentId: opts.actorAgentId,
          createdByUserId: opts.actorUserId,
        })
        .returning()
    )[0]!;
    await this.db
      .update(documents)
      .set({
        latestBody: next,
        latestRevisionNumber: nextNumber,
        latestRevisionId: revision.id,
        updatedByAgentId: opts.actorAgentId,
        updatedByUserId: opts.actorUserId,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, current.documentId));
    return {
      documentId: current.documentId,
      body: next,
      revisionNumber: nextNumber,
      revisionId: revision.id,
    };
  }
}

function appendUnderHeading(body: string, heading: string, block: string): string {
  if (!body.includes(heading)) {
    return `${body.endsWith("\n") ? body : body + "\n"}${heading}\n${block}\n`;
  }
  const lines = body.split("\n");
  const idx = lines.findIndex((l) => l.trim() === heading);
  if (idx === -1) return `${body}\n${heading}\n${block}\n`;
  // Find next heading at the same level (## ...) — insertion point is just before it.
  let insertAt = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i]!)) {
      insertAt = i;
      break;
    }
  }
  const before = lines.slice(0, insertAt).join("\n");
  const after = lines.slice(insertAt).join("\n");
  const trimmedBefore = before.replace(/\n+$/, "");
  return `${trimmedBefore}${block}\n${after.length ? "\n" + after : ""}`;
}
