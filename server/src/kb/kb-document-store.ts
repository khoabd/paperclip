// KBDocumentStore — CRUD for kb_documents, kb_chunks, kb_doc_staleness.

import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { kbDocuments } from "@paperclipai/db/schema/kb_documents";
import { kbChunks } from "@paperclipai/db/schema/kb_chunks";
import { TreeSitterChunker } from "./tree-sitter-chunker.js";

export interface CreateDocInput {
  companyId: string;
  repoId: string;
  kind: string;
  path: string;
  language?: string | null;
  sha?: string | null;
  body?: string | null;
  summary?: string | null;
  lastModifiedAt?: Date | null;
  status?: string;
}

export class KBDocumentStore {
  private readonly chunker = new TreeSitterChunker();

  constructor(private readonly db: Db) {}

  async createDoc(input: CreateDocInput): Promise<string> {
    const now = new Date();
    const rows = await this.db
      .insert(kbDocuments)
      .values({
        companyId: input.companyId,
        repoId: input.repoId,
        kind: input.kind,
        path: input.path,
        language: input.language ?? null,
        sha: input.sha ?? null,
        body: input.body ?? null,
        summary: input.summary ?? null,
        lastModifiedAt: input.lastModifiedAt ?? null,
        status: input.status ?? "fresh",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [kbDocuments.repoId, kbDocuments.path],
        set: {
          kind: input.kind,
          sha: input.sha ?? null,
          body: input.body ?? null,
          summary: input.summary ?? null,
          lastModifiedAt: input.lastModifiedAt ?? null,
          status: input.status ?? "fresh",
          updatedAt: now,
        },
      })
      .returning({ id: kbDocuments.id });
    return rows[0]!.id;
  }

  async getByRepoAndPath(repoId: string, path: string) {
    return (
      await this.db
        .select()
        .from(kbDocuments)
        .where(
          and(eq(kbDocuments.repoId, repoId), eq(kbDocuments.path, path)),
        )
        .limit(1)
    )[0];
  }

  async listByRepo(repoId: string) {
    return this.db
      .select()
      .from(kbDocuments)
      .where(eq(kbDocuments.repoId, repoId));
  }

  /**
   * chunk — runs TreeSitterChunker on the document content and persists kb_chunks rows.
   * Existing chunks for the same documentId are deleted first (full re-chunk).
   */
  async chunk(
    documentId: string,
    content: string,
    language = "unknown",
  ): Promise<number> {
    // Delete old chunks so re-indexing is idempotent.
    await this.db
      .delete(kbChunks)
      .where(eq(kbChunks.documentId, documentId));

    const symbols = this.chunker.chunk(content, language);
    if (symbols.length === 0) return 0;

    await this.db.insert(kbChunks).values(
      symbols.map((s, idx) => ({
        documentId,
        chunkIndex: idx,
        body: s.body,
        symbol: s.symbol,
        language: language,
        tokenCount: Math.ceil(s.body.length / 4), // rough 4-chars-per-token estimate
        createdAt: new Date(),
      })),
    );
    return symbols.length;
  }

  async markStale(repoId: string, path: string): Promise<void> {
    await this.db
      .update(kbDocuments)
      .set({ status: "stale", updatedAt: new Date() })
      .where(
        and(eq(kbDocuments.repoId, repoId), eq(kbDocuments.path, path)),
      );
  }

  async linkEmbedding(
    chunkId: string,
    embeddingId: string,
  ): Promise<void> {
    await this.db
      .update(kbChunks)
      .set({ embeddingId })
      .where(eq(kbChunks.id, chunkId));
  }

  async listChunks(documentId: string) {
    return this.db
      .select()
      .from(kbChunks)
      .where(eq(kbChunks.documentId, documentId));
  }
}
