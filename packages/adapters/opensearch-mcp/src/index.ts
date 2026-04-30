import { z } from "zod";
import type { McpClient, McpClientCallContext } from "@paperclipai/mcp-client";

export const queryLogsInput = z.object({
  index: z.string().min(1),
  query: z.string().min(1),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  size: z.number().int().min(1).max(1000).default(50),
  fields: z.array(z.string()).optional(),
});
export type QueryLogsInput = z.infer<typeof queryLogsInput>;

export const evaluateAlertRuleInput = z.object({
  ruleId: z.string().min(1),
  windowMinutes: z.number().int().min(1).max(1440).default(15),
});
export type EvaluateAlertRuleInput = z.infer<typeof evaluateAlertRuleInput>;

export const aggregationsInput = z.object({
  index: z.string().min(1),
  field: z.string().min(1),
  aggregation: z.enum(["count", "sum", "avg", "min", "max", "percentiles"]),
  filter: z.string().optional(),
  windowMinutes: z.number().int().min(1).max(1440 * 7).default(60),
});
export type AggregationsInput = z.infer<typeof aggregationsInput>;

export class OpensearchMcpAdapter {
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
      throw new Error(`opensearch.${toolName} failed: ${result.error ?? "unknown"}`);
    }
    return result.content;
  }

  queryLogs(input: QueryLogsInput, ctx?: McpClientCallContext) {
    return this.invoke(queryLogsInput, "opensearch.queryLogs", input, ctx);
  }
  evaluateAlertRule(input: EvaluateAlertRuleInput, ctx?: McpClientCallContext) {
    return this.invoke(evaluateAlertRuleInput, "opensearch.evaluateAlertRule", input, ctx);
  }
  aggregations(input: AggregationsInput, ctx?: McpClientCallContext) {
    return this.invoke(aggregationsInput, "opensearch.aggregations", input, ctx);
  }
}

export const OPENSEARCH_TOOL_NAMES = [
  "opensearch.queryLogs",
  "opensearch.evaluateAlertRule",
  "opensearch.aggregations",
] as const;
