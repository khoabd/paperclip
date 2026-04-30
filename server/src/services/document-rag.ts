import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { documentEmbeddings, documents } from "@paperclipai/db";
import { embedDocument, embedText, cosineSimilarity } from "./embeddings.js";

const EMBED_MODEL = process.env.EMBED_MODEL ?? "all-minilm";

export function documentRagService(db: Db) {
  return {
    indexDocument: async (documentId: string, companyId: string, body: string): Promise<void> => {
      console.log("[document-rag] indexDocument start", { documentId, bodyLen: body.length });
      await db
        .delete(documentEmbeddings)
        .where(and(eq(documentEmbeddings.documentId, documentId), eq(documentEmbeddings.companyId, companyId)));

      const chunks = await embedDocument(documentId, body);
      console.log("[document-rag] chunks ready", { documentId, count: chunks.length });
      if (chunks.length === 0) return;

      // Drizzle real[] needs plain JS number arrays — insert one at a time to avoid batch serialization issues
      for (const chunk of chunks) {
        await db.insert(documentEmbeddings).values({
          documentId,
          companyId,
          model: EMBED_MODEL,
          chunkIndex: chunk.chunkIndex,
          chunkText: chunk.chunkText,
          embedding: chunk.embedding,
        });
      }
      console.log("[document-rag] indexDocument done", { documentId, chunks: chunks.length });
    },

    searchDocuments: async (
      companyId: string,
      query: string,
      topK = 5,
    ): Promise<{ documentId: string; chunkText: string; score: number; chunkIndex: number }[]> => {
      const queryEmbedding = await embedText(query);

      // Load embeddings for the company — cap at 500 chunks to bound memory usage
      const rows = await db
        .select({
          documentId: documentEmbeddings.documentId,
          chunkIndex: documentEmbeddings.chunkIndex,
          chunkText: documentEmbeddings.chunkText,
          embedding: documentEmbeddings.embedding,
        })
        .from(documentEmbeddings)
        .where(eq(documentEmbeddings.companyId, companyId))
        .limit(500);

      // Score each chunk
      const scored = rows.map((row) => ({
        documentId: row.documentId,
        chunkIndex: row.chunkIndex,
        chunkText: row.chunkText,
        score: cosineSimilarity(queryEmbedding, row.embedding as number[]),
      }));

      // Sort descending and return top-K
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, topK);
    },

    getDocumentsForRag: async (
      companyId: string,
      documentIds: string[],
    ): Promise<{ id: string; title: string | null; body: string }[]> => {
      if (documentIds.length === 0) return [];

      const rows = await db
        .select({
          id: documents.id,
          title: documents.title,
          body: documents.latestBody,
        })
        .from(documents)
        .where(
          and(
            eq(documents.companyId, companyId),
            inArray(documents.id, documentIds),
          ),
        );

      return rows;
    },
  };
}

export type DocumentRagService = ReturnType<typeof documentRagService>;

export function triggerDocumentIndexing(
  ragService: DocumentRagService,
  documentId: string,
  companyId: string,
  body: string,
): void {
  ragService.indexDocument(documentId, companyId, body).catch((err: unknown) => {
    console.error("[document-rag] Failed to index document", { documentId, err });
  });
}
