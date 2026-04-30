import { z } from "zod";
import type { McpClient, McpClientCallContext } from "@paperclipai/mcp-client";

export const tavilySearchInput = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().min(1).max(20).default(5),
  searchDepth: z.enum(["basic", "advanced"]).default("basic"),
  includeDomains: z.array(z.string()).optional(),
  excludeDomains: z.array(z.string()).optional(),
});
export type TavilySearchInput = z.infer<typeof tavilySearchInput>;

export const arxivSearchInput = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().min(1).max(50).default(10),
  category: z.string().optional(),
  sortBy: z.enum(["relevance", "lastUpdatedDate", "submittedDate"]).default("relevance"),
});
export type ArxivSearchInput = z.infer<typeof arxivSearchInput>;

export const fetchPaperInput = z.object({
  arxivId: z.string().min(1),
  format: z.enum(["abstract", "full"]).default("abstract"),
});
export type FetchPaperInput = z.infer<typeof fetchPaperInput>;

export class ResearchMcpAdapter {
  constructor(private readonly client: McpClient) {}

  get serverId(): string {
    return this.client.registration.id;
  }

  private async invoke<T extends z.ZodTypeAny>(
    schema: T,
    toolName: string,
    input: z.infer<T>,
    ctx?: McpClientCallContext,
  ): Promise<unknown> {
    const parsed = schema.parse(input);
    const result = await this.client.callTool(toolName, parsed as Record<string, unknown>, ctx);
    if (!result.ok) {
      throw new Error(`research.${toolName} failed: ${result.error ?? "unknown"}`);
    }
    return result.content;
  }

  tavilySearch(input: TavilySearchInput, ctx?: McpClientCallContext) {
    return this.invoke(tavilySearchInput, "research.tavilySearch", input, ctx);
  }
  arxivSearch(input: ArxivSearchInput, ctx?: McpClientCallContext) {
    return this.invoke(arxivSearchInput, "research.arxivSearch", input, ctx);
  }
  fetchPaper(input: FetchPaperInput, ctx?: McpClientCallContext) {
    return this.invoke(fetchPaperInput, "research.fetchPaper", input, ctx);
  }
}

export const RESEARCH_TOOL_NAMES = [
  "research.tavilySearch",
  "research.arxivSearch",
  "research.fetchPaper",
] as const;
