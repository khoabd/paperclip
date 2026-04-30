// DesignDocService: persists design doc CRUD, revision history, and state transitions.
// Emits a BrainStore insight when a doc reaches 'live'.
// Per Phase-7-Development-Flow-Feature-Flags §7.2.

import { and, eq, max } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { designDocs, designDocRevisions } from "@paperclipai/db";
import type { BrainStore } from "../../platform/strategic-loop/brain-store.js";
import {
  canTransitionDesignDoc,
  type DesignDocActor,
  type DesignDocStatus,
  type DesignDocTransitionVerdict,
} from "./design-doc-state-machine.js";

export interface CreateDesignDocInput {
  companyId: string;
  projectId?: string | null;
  key: string;
  title: string;
  body: string;
  createdByUserId?: string | null;
}

export interface ReviseDesignDocInput {
  designDocId: string;
  body: string;
  changeSummary?: string | null;
  createdByUserId?: string | null;
}

export interface TransitionDesignDocInput {
  designDocId: string;
  to: DesignDocStatus;
  actor: DesignDocActor;
  ctx: {
    noOpenConflicts: boolean;
    featureFlagLive: boolean;
  };
  companyId: string;
}

export class DesignDocService {
  constructor(
    private readonly db: Db,
    private readonly brain: BrainStore,
  ) {}

  async create(input: CreateDesignDocInput): Promise<string> {
    const [doc] = await this.db
      .insert(designDocs)
      .values({
        companyId: input.companyId,
        projectId: input.projectId ?? null,
        key: input.key,
        title: input.title,
        body: input.body,
        status: "proposed",
      })
      .returning({ id: designDocs.id });

    if (!doc) throw new Error("insert design_docs returned no row");

    // Write revision 1.
    await this.db.insert(designDocRevisions).values({
      designDocId: doc.id,
      revisionNumber: 1,
      body: input.body,
      changeSummary: "initial",
      createdByUserId: input.createdByUserId ?? null,
    });

    return doc.id;
  }

  async revise(input: ReviseDesignDocInput): Promise<void> {
    // Get current max revision number.
    const [row] = await this.db
      .select({ maxRev: max(designDocRevisions.revisionNumber) })
      .from(designDocRevisions)
      .where(eq(designDocRevisions.designDocId, input.designDocId));

    const nextRev = (row?.maxRev ?? 0) + 1;

    await this.db.insert(designDocRevisions).values({
      designDocId: input.designDocId,
      revisionNumber: nextRev,
      body: input.body,
      changeSummary: input.changeSummary ?? null,
      createdByUserId: input.createdByUserId ?? null,
    });

    await this.db
      .update(designDocs)
      .set({ body: input.body, updatedAt: new Date() })
      .where(eq(designDocs.id, input.designDocId));
  }

  async transition(input: TransitionDesignDocInput): Promise<DesignDocTransitionVerdict> {
    const [doc] = await this.db
      .select({ status: designDocs.status, title: designDocs.title })
      .from(designDocs)
      .where(
        and(eq(designDocs.id, input.designDocId), eq(designDocs.companyId, input.companyId)),
      )
      .limit(1);

    if (!doc) return { ok: false, reason: "design doc not found" };

    const verdict = canTransitionDesignDoc({
      from: doc.status as DesignDocStatus,
      to: input.to,
      actor: input.actor,
      ctx: input.ctx,
    });

    if (!verdict.ok) return verdict;

    await this.db
      .update(designDocs)
      .set({ status: input.to, updatedAt: new Date() })
      .where(eq(designDocs.id, input.designDocId));

    // Emit brain insight when a doc goes live.
    if (input.to === "live") {
      await this.brain.appendInsight({
        workspaceId: input.companyId,
        kind: "design.live",
        body: `Design doc '${doc.title}' transitioned to live.`,
      });
    }

    return { ok: true };
  }

  async getById(
    companyId: string,
    designDocId: string,
  ): Promise<(typeof designDocs.$inferSelect) | undefined> {
    const [doc] = await this.db
      .select()
      .from(designDocs)
      .where(and(eq(designDocs.id, designDocId), eq(designDocs.companyId, companyId)))
      .limit(1);
    return doc;
  }

  async listRevisions(
    designDocId: string,
  ): Promise<(typeof designDocRevisions.$inferSelect)[]> {
    return this.db
      .select()
      .from(designDocRevisions)
      .where(eq(designDocRevisions.designDocId, designDocId))
      .orderBy(designDocRevisions.revisionNumber);
  }
}
