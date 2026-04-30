import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { projectDocsApi, type ProjectDoc, type DocSearchResult } from "../api/projectDocs";
import { MarkdownBody } from "./MarkdownBody";
import { relativeTime } from "../lib/utils";

interface ProjectDocsTabProps {
  companyId: string;
  projectId: string;
}

function DocCard({
  doc,
  highlighted,
}: {
  doc: ProjectDoc;
  highlighted: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`rounded-lg border p-3 cursor-pointer transition-colors ${
        highlighted
          ? "border-blue-500/60 bg-blue-500/5"
          : "border-border bg-background hover:bg-accent/40"
      }`}
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] rounded-full border border-border px-2 py-0.5 text-muted-foreground shrink-0">
            {doc.key}
          </span>
          {doc.title && (
            <span className="text-sm font-medium text-foreground truncate">{doc.title}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {doc.hasEmbedding ? (
            <span className="h-2 w-2 rounded-full bg-green-500" title="Indexed" />
          ) : (
            <span className="inline-flex items-center rounded-full border border-orange-500/40 bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-400">
              Not indexed
            </span>
          )}
        </div>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>{doc.issueName}</span>
        <span>&middot;</span>
        <span>{relativeTime(doc.updatedAt)}</span>
      </div>

      {expanded && (
        <div
          className="mt-3 border-t border-border pt-3"
          onClick={(e) => e.stopPropagation()}
        >
          <MarkdownBody className="text-sm">{doc.body}</MarkdownBody>
        </div>
      )}
    </div>
  );
}

export function ProjectDocsTab({ companyId, projectId }: ProjectDocsTabProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  const { data: docs, isLoading } = useQuery({
    queryKey: ["project-docs", companyId, projectId],
    queryFn: () => projectDocsApi.list(companyId, projectId),
    enabled: Boolean(companyId && projectId),
  });

  const { data: searchResults } = useQuery({
    queryKey: ["project-docs-search", companyId, projectId, debouncedQuery],
    queryFn: () => projectDocsApi.search(companyId, debouncedQuery, projectId),
    enabled: Boolean(companyId && debouncedQuery.length > 0),
  });

  const highlightedIds = new Set<string>(
    debouncedQuery && searchResults
      ? searchResults.map((r: DocSearchResult) => r.documentId)
      : [],
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-border p-3 animate-pulse">
            <div className="h-4 bg-accent rounded w-1/3" />
            <div className="mt-2 h-3 bg-accent rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  const hasDocs = docs && docs.length > 0;

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search documents..."
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />

      {!hasDocs ? (
        <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
          No documents yet. Agents will create documents here as they work on issues.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((doc: ProjectDoc) => (
            <DocCard
              key={doc.id}
              doc={doc}
              highlighted={debouncedQuery.length > 0 && highlightedIds.has(doc.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
