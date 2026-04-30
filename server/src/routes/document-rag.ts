import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { documents, issueDocuments, issues, documentEmbeddings } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { documentRagService } from "../services/document-rag.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL ?? "deepseek-v4-flash:cloud";
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY ?? "504f1361036b40f19bd695c12c96fda1.JKio7ksINzfBlGsX1Y8b93Dn";

export function documentRagRoutes(db: Db) {
  const router = Router();
  const ragService = documentRagService(db);

  /**
   * GET /companies/:companyId/projects/:projectId/documents
   * List all documents across all issues in the project.
   */
  router.get("/companies/:companyId/projects/:projectId/documents", async (req, res) => {
    const companyId = req.params.companyId as string;
    const projectId = req.params.projectId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);

    try {
      // Join: issue_documents -> issues where issues.projectId = projectId
      const rows = await db
        .select({
          id: documents.id,
          key: issueDocuments.key,
          title: documents.title,
          latestBody: documents.latestBody,
          issueId: issues.id,
          issueName: issues.title,
          updatedAt: documents.updatedAt,
          embeddingDocumentId: documentEmbeddings.documentId,
        })
        .from(issueDocuments)
        .innerJoin(issues, eq(issueDocuments.issueId, issues.id))
        .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
        .leftJoin(documentEmbeddings, eq(documentEmbeddings.documentId, documents.id))
        .where(
          and(
            eq(issues.projectId, projectId),
            eq(issueDocuments.companyId, companyId),
          ),
        );

      // Deduplicate by document id (leftJoin can produce multiple rows per doc)
      const seen = new Set<string>();
      const result = [];
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        result.push({
          id: row.id,
          key: row.key,
          title: row.title,
          latestBody: row.latestBody ? row.latestBody.slice(0, 500) : null,
          issueId: row.issueId,
          issueName: row.issueName,
          updatedAt: row.updatedAt,
          hasEmbedding: row.embeddingDocumentId !== null,
        });
      }

      res.json(result);
    } catch (err) {
      console.error("[document-rag] GET documents error", err);
      res.status(500).json({ error: "Failed to list project documents" });
    }
  });

  /**
   * POST /companies/:companyId/projects/:projectId/documents/index
   * Index (embed) all documents in the project. Fire-and-forget, returns immediately.
   */
  router.post("/companies/:companyId/projects/:projectId/documents/index", async (req, res) => {
    const companyId = req.params.companyId as string;
    const projectId = req.params.projectId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);

    try {
      const rows = await db
        .select({ id: documents.id, latestBody: documents.latestBody })
        .from(issueDocuments)
        .innerJoin(issues, eq(issueDocuments.issueId, issues.id))
        .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
        .where(and(eq(issues.projectId, projectId), eq(issueDocuments.companyId, companyId)));

      const toIndex = rows.filter((r) => r.latestBody && r.latestBody.trim().length > 0);

      // Run synchronously so errors surface in response
      const results: { id: string; chunks: number; error?: string }[] = [];
      for (const doc of toIndex) {
        try {
          await ragService.indexDocument(doc.id, companyId, doc.latestBody!);
          const [{ count }] = await db
            .select({ count: documentEmbeddings.id })
            .from(documentEmbeddings)
            .where(and(eq(documentEmbeddings.documentId, doc.id), eq(documentEmbeddings.companyId, companyId)));
          results.push({ id: doc.id, chunks: count ? 1 : 0 });
        } catch (err) {
          results.push({ id: doc.id, chunks: 0, error: String(err) });
        }
      }
      res.json({ indexed: results.length, results });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * POST /companies/:companyId/documents/search
   * Semantic search over document chunks.
   * Body: { query: string, projectId?: string }
   */
  router.post("/companies/:companyId/documents/search", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);

    const { query, projectId } = req.body as { query?: string; projectId?: string };
    if (!query || typeof query !== "string" || query.trim() === "") {
      res.status(400).json({ error: "query is required" });
      return;
    }

    try {
      let results = await ragService.searchDocuments(companyId, query.trim(), 5);

      // If projectId is provided, filter results to documents in that project
      if (projectId && results.length > 0) {
        const docIds = [...new Set(results.map((r) => r.documentId))];
        const projectDocRows = await db
          .select({ documentId: issueDocuments.documentId })
          .from(issueDocuments)
          .innerJoin(issues, eq(issueDocuments.issueId, issues.id))
          .where(
            and(
              eq(issues.projectId, projectId),
              eq(issueDocuments.companyId, companyId),
              inArray(issueDocuments.documentId, docIds),
            ),
          );
        const projectDocSet = new Set(projectDocRows.map((r) => r.documentId));
        results = results.filter((r) => projectDocSet.has(r.documentId));
      }

      res.json(results);
    } catch (err) {
      console.error("[document-rag] search error", err);
      res.status(503).json({ error: "Embedding service unavailable. Please ensure Ollama is running." });
    }
  });

  /**
   * POST /companies/:companyId/projects/:projectId/ask
   * RAG-based Q&A over project documents.
   * Body: { question: string }
   */
  router.post("/companies/:companyId/projects/:projectId/ask", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);

    const { question } = req.body as { question?: string };
    if (!question || typeof question !== "string" || question.trim() === "") {
      res.status(400).json({ error: "question is required" });
      return;
    }

    try {
      // 1. Search top-5 relevant chunks
      const chunks = await ragService.searchDocuments(companyId, question.trim(), 5);

      // 2. Build context string from chunks
      const contextText = chunks.map((c) => c.chunkText).join("\n\n---\n\n");
      const prompt = `Answer based on context:\n<context>\n${contextText}\n</context>\n\nQuestion: ${question.trim()}`;

      // 3. Generate answer via Ollama cloud (deepseek-v4-flash:cloud) — streaming to avoid RAM buffering
      let answer: string;
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (OLLAMA_API_KEY) headers["Authorization"] = `Bearer ${OLLAMA_API_KEY}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60_000);
        const ollamaRes = await fetch(`${OLLAMA_URL}/api/generate`, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: OLLAMA_CHAT_MODEL, prompt, stream: true }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!ollamaRes.ok || !ollamaRes.body) throw new Error(`Ollama generate failed: ${ollamaRes.status}`);

        const parts: string[] = [];
        const reader = ollamaRes.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of decoder.decode(value).split("\n").filter(Boolean)) {
            try {
              const chunk = JSON.parse(line) as { response?: string };
              if (chunk.response) parts.push(chunk.response);
            } catch { /* skip malformed */ }
          }
        }
        answer = parts.join("");
      } catch {
        res.json({ answer: "AI service unavailable. Please ensure Ollama is running with cloud model access." });
        return;
      }

      res.json({ answer, sources: chunks.map((c) => ({ documentId: c.documentId, chunkIndex: c.chunkIndex, score: c.score })) });
    } catch (err) {
      console.error("[document-rag] ask error", err);
      res.json({ answer: "Embedding service unavailable. Please ensure Ollama is running." });
    }
  });

  return router;
}
