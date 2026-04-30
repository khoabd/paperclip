import { z } from "zod";
import type { McpClient, McpClientCallContext } from "@paperclipai/mcp-client";

export const createBranchInput = z.object({
  projectId: z.string().min(1),
  branch: z.string().min(1),
  sourceBranch: z.string().min(1).default("main"),
});
export type CreateBranchInput = z.infer<typeof createBranchInput>;

export const commitFileInput = z.object({
  projectId: z.string().min(1),
  branch: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
  encoding: z.enum(["text", "base64"]).default("text"),
  commitMessage: z.string().min(1),
  authorName: z.string().optional(),
  authorEmail: z.string().email().optional(),
});
export type CommitFileInput = z.infer<typeof commitFileInput>;

export const openMergeRequestInput = z.object({
  projectId: z.string().min(1),
  sourceBranch: z.string().min(1),
  targetBranch: z.string().min(1).default("main"),
  title: z.string().min(1),
  description: z.string().optional(),
  draft: z.boolean().default(false),
  removeSourceOnMerge: z.boolean().default(true),
});
export type OpenMergeRequestInput = z.infer<typeof openMergeRequestInput>;

export const closeMergeRequestInput = z.object({
  projectId: z.string().min(1),
  mergeRequestIid: z.number().int().positive(),
});
export type CloseMergeRequestInput = z.infer<typeof closeMergeRequestInput>;

export const commentOnMrInput = z.object({
  projectId: z.string().min(1),
  mergeRequestIid: z.number().int().positive(),
  body: z.string().min(1),
});
export type CommentOnMrInput = z.infer<typeof commentOnMrInput>;

export const pipelineStatusInput = z.object({
  projectId: z.string().min(1),
  ref: z.string().min(1),
  pipelineId: z.number().int().positive().optional(),
});
export type PipelineStatusInput = z.infer<typeof pipelineStatusInput>;

export const listFilesInput = z.object({
  projectId: z.string().min(1),
  ref: z.string().min(1).default("main"),
  path: z.string().optional(),
  recursive: z.boolean().default(false),
});
export type ListFilesInput = z.infer<typeof listFilesInput>;

export const readFileInput = z.object({
  projectId: z.string().min(1),
  ref: z.string().min(1).default("main"),
  path: z.string().min(1),
});
export type ReadFileInput = z.infer<typeof readFileInput>;

export const listProjectsInput = z.object({
  visibility: z.enum(["private", "internal", "public"]).optional(),
  search: z.string().optional(),
  perPage: z.number().int().min(1).max(100).default(20),
});
export type ListProjectsInput = z.infer<typeof listProjectsInput>;

export const getMergeRequestInput = z.object({
  projectId: z.string().min(1),
  mergeRequestIid: z.number().int().positive(),
});
export type GetMergeRequestInput = z.infer<typeof getMergeRequestInput>;

export class GitlabMcpAdapter {
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
      throw new Error(`gitlab.${toolName} failed: ${result.error ?? "unknown"}`);
    }
    return result.content;
  }

  createBranch(input: CreateBranchInput, ctx?: McpClientCallContext) {
    return this.invoke(createBranchInput, "gitlab.createBranch", input, ctx);
  }
  commitFile(input: CommitFileInput, ctx?: McpClientCallContext) {
    return this.invoke(commitFileInput, "gitlab.commitFile", input, ctx);
  }
  openMergeRequest(input: OpenMergeRequestInput, ctx?: McpClientCallContext) {
    return this.invoke(openMergeRequestInput, "gitlab.openMergeRequest", input, ctx);
  }
  closeMergeRequest(input: CloseMergeRequestInput, ctx?: McpClientCallContext) {
    return this.invoke(closeMergeRequestInput, "gitlab.closeMergeRequest", input, ctx);
  }
  commentOnMergeRequest(input: CommentOnMrInput, ctx?: McpClientCallContext) {
    return this.invoke(commentOnMrInput, "gitlab.commentOnMergeRequest", input, ctx);
  }
  pipelineStatus(input: PipelineStatusInput, ctx?: McpClientCallContext) {
    return this.invoke(pipelineStatusInput, "gitlab.pipelineStatus", input, ctx);
  }
  listFiles(input: ListFilesInput, ctx?: McpClientCallContext) {
    return this.invoke(listFilesInput, "gitlab.listFiles", input, ctx);
  }
  readFile(input: ReadFileInput, ctx?: McpClientCallContext) {
    return this.invoke(readFileInput, "gitlab.readFile", input, ctx);
  }
  listProjects(input: ListProjectsInput = {} as ListProjectsInput, ctx?: McpClientCallContext) {
    return this.invoke(listProjectsInput, "gitlab.listProjects", input, ctx);
  }
  getMergeRequest(input: GetMergeRequestInput, ctx?: McpClientCallContext) {
    return this.invoke(getMergeRequestInput, "gitlab.getMergeRequest", input, ctx);
  }
}

export const GITLAB_TOOL_NAMES = [
  "gitlab.createBranch",
  "gitlab.commitFile",
  "gitlab.openMergeRequest",
  "gitlab.closeMergeRequest",
  "gitlab.commentOnMergeRequest",
  "gitlab.pipelineStatus",
  "gitlab.listFiles",
  "gitlab.readFile",
  "gitlab.listProjects",
  "gitlab.getMergeRequest",
] as const;
