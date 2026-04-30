import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  McpClient,
  InMemoryInvocationRecorder,
  type McpServerRegistration,
} from "@paperclipai/mcp-client";
import { GitlabMcpAdapter } from "../index.js";

interface FakeStore {
  branches: Map<string, Set<string>>;
  files: Map<string, Map<string, { content: string; branch: string }>>;
  mrs: Map<string, Array<{ iid: number; source: string; target: string; title: string; state: string }>>;
  nextMrIid: number;
}

function makeStore(): FakeStore {
  return {
    branches: new Map(),
    files: new Map(),
    mrs: new Map(),
    nextMrIid: 1,
  };
}

function ensureProject(store: FakeStore, projectId: string) {
  if (!store.branches.has(projectId)) store.branches.set(projectId, new Set(["main"]));
  if (!store.files.has(projectId)) store.files.set(projectId, new Map());
  if (!store.mrs.has(projectId)) store.mrs.set(projectId, []);
}

async function startFakeGitlab(store: FakeStore): Promise<{ transport: InMemoryTransport; close: () => Promise<void> }> {
  const server = new McpServer({ name: "fake-gitlab", version: "0.0.1" });

  server.tool(
    "gitlab.createBranch",
    {
      projectId: z.string(),
      branch: z.string(),
      sourceBranch: z.string(),
    },
    async ({ projectId, branch, sourceBranch }) => {
      ensureProject(store, projectId);
      const branches = store.branches.get(projectId)!;
      if (!branches.has(sourceBranch)) {
        return {
          content: [{ type: "text", text: `unknown source branch ${sourceBranch}` }],
          isError: true,
        };
      }
      branches.add(branch);
      return { content: [{ type: "text", text: JSON.stringify({ created: branch, from: sourceBranch }) }] };
    },
  );

  server.tool(
    "gitlab.commitFile",
    {
      projectId: z.string(),
      branch: z.string(),
      path: z.string(),
      content: z.string(),
      encoding: z.enum(["text", "base64"]),
      commitMessage: z.string(),
    },
    async ({ projectId, branch, path, content, commitMessage }) => {
      ensureProject(store, projectId);
      const branches = store.branches.get(projectId)!;
      if (!branches.has(branch)) {
        return { content: [{ type: "text", text: `branch missing ${branch}` }], isError: true };
      }
      const files = store.files.get(projectId)!;
      files.set(`${branch}::${path}`, { content, branch });
      return { content: [{ type: "text", text: JSON.stringify({ committed: path, message: commitMessage }) }] };
    },
  );

  server.tool(
    "gitlab.openMergeRequest",
    {
      projectId: z.string(),
      sourceBranch: z.string(),
      targetBranch: z.string(),
      title: z.string(),
      draft: z.boolean(),
      removeSourceOnMerge: z.boolean(),
    },
    async ({ projectId, sourceBranch, targetBranch, title }) => {
      ensureProject(store, projectId);
      const mrs = store.mrs.get(projectId)!;
      const iid = store.nextMrIid;
      store.nextMrIid += 1;
      mrs.push({ iid, source: sourceBranch, target: targetBranch, title, state: "opened" });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ iid, web_url: `https://gitlab.example/${projectId}/-/merge_requests/${iid}` }),
          },
        ],
      };
    },
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  return {
    transport: clientTransport,
    close: () => server.close(),
  };
}

function fakeRegistration(): McpServerRegistration {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    companyId: "00000000-0000-0000-0000-000000000001",
    name: "fake-gitlab",
    kind: "gitlab",
    transport: "in-memory",
    endpoint: "memory://gitlab",
    authToken: null,
    status: "enabled",
    config: {},
  };
}

describe("GitlabMcpAdapter (against fake MCP server)", () => {
  let store: FakeStore;
  let close: () => Promise<void>;
  let adapter: GitlabMcpAdapter;
  let client: McpClient;
  let recorder: InMemoryInvocationRecorder;

  beforeEach(async () => {
    store = makeStore();
    const started = await startFakeGitlab(store);
    close = started.close;
    recorder = new InMemoryInvocationRecorder();
    client = new McpClient({
      registration: fakeRegistration(),
      transportFactory: () => started.transport,
      recorder,
      retryPolicy: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 5 },
      sleep: () => Promise.resolve(),
    });
    adapter = new GitlabMcpAdapter(client);
  });

  afterEach(async () => {
    await client.close();
    await close();
  });

  it("creates a branch end-to-end and records an invocation", async () => {
    const result = await adapter.createBranch({
      projectId: "demo",
      branch: "feature/x",
      sourceBranch: "main",
    });
    expect(Array.isArray(result)).toBe(true);
    expect(store.branches.get("demo")!.has("feature/x")).toBe(true);
    expect(recorder.records).toHaveLength(1);
    expect(recorder.records[0]!.toolName).toBe("gitlab.createBranch");
  });

  it("performs the full createBranch + commitFile + openMR flow", async () => {
    await adapter.createBranch({ projectId: "demo", branch: "feat/welcome", sourceBranch: "main" });
    await adapter.commitFile({
      projectId: "demo",
      branch: "feat/welcome",
      path: "README.md",
      content: "# hello",
      encoding: "text",
      commitMessage: "init",
    });
    const mr = await adapter.openMergeRequest({
      projectId: "demo",
      sourceBranch: "feat/welcome",
      targetBranch: "main",
      title: "feat: welcome",
      draft: false,
      removeSourceOnMerge: true,
    });

    expect(mr).toBeDefined();
    const recorded = store.files.get("demo")!;
    expect(recorded.get("feat/welcome::README.md")?.content).toBe("# hello");
    const mrs = store.mrs.get("demo")!;
    expect(mrs).toHaveLength(1);
    expect(mrs[0]!.title).toBe("feat: welcome");
    expect(recorder.records.map((r) => r.toolName)).toEqual([
      "gitlab.createBranch",
      "gitlab.commitFile",
      "gitlab.openMergeRequest",
    ]);
  });

  it("surfaces server errors as adapter rejection", async () => {
    await expect(
      adapter.createBranch({ projectId: "demo", branch: "feature/y", sourceBranch: "ghost" }),
    ).rejects.toThrow(/createBranch failed/);
  });
});
