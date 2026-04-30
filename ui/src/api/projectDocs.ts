import { api } from "../api/client";

export type ProjectDoc = {
  id: string;
  key: string;
  title: string | null;
  body: string; // truncated 500 chars from server
  issueId: string;
  issueName: string;
  updatedAt: string;
  hasEmbedding: boolean;
};

export type DocSearchResult = {
  documentId: string;
  chunkText: string;
  score: number;
};

export type AskResult = {
  answer: string;
  sources: { documentId: string; chunkText: string; score: number }[];
};

export const projectDocsApi = {
  list: (companyId: string, projectId: string) =>
    api.get<ProjectDoc[]>(`/companies/${companyId}/projects/${projectId}/documents`),

  search: (companyId: string, query: string, projectId?: string) =>
    api.post<DocSearchResult[]>(`/companies/${companyId}/documents/search`, { query, projectId }),

  ask: (companyId: string, projectId: string, question: string) =>
    api.post<AskResult>(`/companies/${companyId}/projects/${projectId}/ask`, { question }),
};
