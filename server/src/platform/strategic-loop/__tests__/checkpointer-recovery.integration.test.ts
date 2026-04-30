// TC-INT-CHECKPOINT-01: mission graph checkpointer crash recovery.
// Uses MemorySaver from @langchain/langgraph as the checkpointer; the postgres
// variant is a drop-in replacement (BaseCheckpointSaver) once
// @langchain/langgraph-checkpoint-postgres is wired in ops.
// What we verify here is the contract: checkpoint after each node,
// resume-from-last on restart, no double-side-effects across resume.

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Annotation, MemorySaver, StateGraph, END } from "@langchain/langgraph";

type SideEffectLog = string[];

const TestState = Annotation.Root({
  step: Annotation<number>({
    reducer: (_p, n) => n,
    default: () => 0,
  }),
  log: Annotation<SideEffectLog>({
    reducer: (prev, next) => prev.concat(next),
    default: () => [] as SideEffectLog,
  }),
  crashAtStep: Annotation<number | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
});

type TestStateValue = typeof TestState.State;

function buildGraph(opts: { sideEffectCounter: { count: number } }) {
  // Each node logs a side effect once. After resume, side-effect-bearing nodes
  // already executed before the crash are skipped because the saver replays
  // the snapshot from after node N, not before.
  function makeNode(name: string) {
    return (state: TestStateValue) => {
      if (state.crashAtStep !== null && state.step + 1 === state.crashAtStep) {
        throw new Error(`crash at step ${state.crashAtStep}`);
      }
      opts.sideEffectCounter.count += 1;
      return {
        ...state,
        step: state.step + 1,
        log: [name],
      };
    };
  }

  return new StateGraph(TestState)
    .addNode("n1", makeNode("n1"))
    .addNode("n2", makeNode("n2"))
    .addNode("n3", makeNode("n3"))
    .addNode("n4", makeNode("n4"))
    .addEdge("__start__", "n1")
    .addEdge("n1", "n2")
    .addEdge("n2", "n3")
    .addEdge("n3", "n4")
    .addEdge("n4", END);
}

describe("LangGraph mission checkpointer — TC-INT-CHECKPOINT-01", () => {
  it("crash mid-graph then resume from saved checkpoint — no double side effects", async () => {
    const counter = { count: 0 };
    const saver = new MemorySaver();
    const graph = buildGraph({ sideEffectCounter: counter }).compile({ checkpointer: saver });
    const threadId = randomUUID();

    // First run: crash at step 3 (entering n3 after n1,n2 finished).
    await expect(
      graph.invoke(
        { step: 0, log: [], crashAtStep: 3 },
        { configurable: { thread_id: threadId } },
      ),
    ).rejects.toThrow(/crash at step 3/);

    // Two side effects ran: n1, n2.
    expect(counter.count).toBe(2);

    // State at the time of crash: persisted snapshot has step=2 with log=[n1,n2].
    const snapAfterCrash = await graph.getState({ configurable: { thread_id: threadId } });
    expect(snapAfterCrash.values.step).toBe(2);
    expect(snapAfterCrash.values.log).toEqual(["n1", "n2"]);

    // Update saved state to clear crashAtStep, then resume with null input.
    await graph.updateState(
      { configurable: { thread_id: threadId } },
      { crashAtStep: null },
    );
    const resumed = await graph.invoke(null, { configurable: { thread_id: threadId } });

    // Final state: step=4, log=[n1,n2,n3,n4]. Side-effect count = 4 total
    // (n1, n2 from first run + n3, n4 from resume) — proves no double-fire on n1/n2.
    expect(resumed.step).toBe(4);
    expect(resumed.log).toEqual(["n1", "n2", "n3", "n4"]);
    expect(counter.count).toBe(4);
  });

  it("crash at step 4 (last node) — resume picks up just n4 without re-running n1..n3", async () => {
    const counter = { count: 0 };
    const saver = new MemorySaver();
    const graph = buildGraph({ sideEffectCounter: counter }).compile({ checkpointer: saver });
    const threadId = randomUUID();

    await expect(
      graph.invoke({ step: 0, log: [], crashAtStep: 4 }, { configurable: { thread_id: threadId } }),
    ).rejects.toThrow();
    expect(counter.count).toBe(3); // n1,n2,n3 ran

    await graph.updateState(
      { configurable: { thread_id: threadId } },
      { crashAtStep: null },
    );
    const resumed = await graph.invoke(null, { configurable: { thread_id: threadId } });
    expect(resumed.step).toBe(4);
    expect(counter.count).toBe(4); // only n4 ran on resume
  });

  it("multi-thread isolation — two missions don't share checkpoints", async () => {
    const counter = { count: 0 };
    const saver = new MemorySaver();
    const graph = buildGraph({ sideEffectCounter: counter }).compile({ checkpointer: saver });

    const t1 = randomUUID();
    const t2 = randomUUID();

    await graph.invoke({ step: 0, log: [], crashAtStep: null }, { configurable: { thread_id: t1 } });
    expect(counter.count).toBe(4);

    // Second thread starts fresh, should run all 4 nodes independently.
    await graph.invoke({ step: 0, log: [], crashAtStep: null }, { configurable: { thread_id: t2 } });
    expect(counter.count).toBe(8);

    const s1 = await graph.getState({ configurable: { thread_id: t1 } });
    const s2 = await graph.getState({ configurable: { thread_id: t2 } });
    expect(s1.values.step).toBe(4);
    expect(s2.values.step).toBe(4);
    expect(s1.values.log).toEqual(["n1", "n2", "n3", "n4"]);
    expect(s2.values.log).toEqual(["n1", "n2", "n3", "n4"]);
  });

  it("non-crash run completes through all 4 nodes — baseline path", async () => {
    const counter = { count: 0 };
    const saver = new MemorySaver();
    const graph = buildGraph({ sideEffectCounter: counter }).compile({ checkpointer: saver });
    const threadId = randomUUID();

    const result = await graph.invoke(
      { step: 0, log: [], crashAtStep: null },
      { configurable: { thread_id: threadId } },
    );
    expect(result.step).toBe(4);
    expect(counter.count).toBe(4);
  });
});
