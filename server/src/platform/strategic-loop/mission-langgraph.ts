// LangGraph wrapper around the mission state machine per ADR-0002.
// Mirrors mission-state-machine.ts allowed transitions onto a StateGraph so we
// inherit LangGraph's conditional-edge wiring + future checkpointer hooks.
// Pure topology: no I/O lives in the nodes; runners attach side effects via
// .addNode replacements at compile time.

import { StateGraph, END, Annotation } from "@langchain/langgraph";
import type { MissionStatus } from "./mission-state-machine.js";

export type ReflectorVerdict = "replan" | "done" | "blocked";

export const MissionStateAnnotation = Annotation.Root({
  status: Annotation<MissionStatus>({
    reducer: (_prev, next) => next,
    default: () => "intake" as MissionStatus,
  }),
  queuedSteps: Annotation<number>({
    reducer: (_p, n) => n,
    default: () => 0,
  }),
  runningSteps: Annotation<number>({
    reducer: (_p, n) => n,
    default: () => 0,
  }),
  failedSteps: Annotation<number>({
    reducer: (_p, n) => n,
    default: () => 0,
  }),
  reflectorVerdict: Annotation<ReflectorVerdict | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
});

export type MissionState = typeof MissionStateAnnotation.State;

export function buildMissionGraph() {
  const graph = new StateGraph(MissionStateAnnotation)
    .addNode("intake", (state) => ({ ...state, status: "planning" as MissionStatus }))
    .addNode("planning", (state) => ({
      ...state,
      status: "executing" as MissionStatus,
    }))
    .addNode("executing", (state) => {
      // Drain one step per tick — keeps the graph deterministic for tests.
      // Real runners replace this node with one that consults workers + DB.
      if (state.queuedSteps > 0) {
        return { ...state, queuedSteps: state.queuedSteps - 1, runningSteps: 0 };
      }
      return state;
    })
    .addNode("reflecting", (state) => state)
    .addNode("blocked", (state) => state)
    .addEdge("__start__", "intake")
    .addEdge("intake", "planning")
    .addConditionalEdges("planning", (state) => {
      // Without queued/pending steps, mission is done planning but cannot execute.
      // Allow runner to bail out by routing back to intake (re-plan) only if reflector signaled it.
      return state.queuedSteps > 0 ? "executing" : "blocked";
    })
    .addConditionalEdges("executing", (state) => {
      if (state.failedSteps > 0) return "blocked";
      if (state.queuedSteps + state.runningSteps === 0) return "reflecting";
      return "executing";
    })
    .addConditionalEdges("reflecting", (state) => {
      if (state.reflectorVerdict === "replan") return "planning";
      if (state.reflectorVerdict === "done") return END;
      if (state.reflectorVerdict === "blocked") return "blocked";
      // No verdict yet → wait (route back to reflecting).
      return "reflecting";
    })
    .addEdge("blocked", END);

  return graph.compile();
}

// Helper: collect every node reachable from __start__ via BFS over outgoing edges.
// Use the compiled graph object's exposed nodes/edges where available; otherwise
// the topology is implicit in buildMissionGraph(), so we mirror it here for tests.
export const MISSION_NODE_NAMES = [
  "intake",
  "planning",
  "executing",
  "reflecting",
  "blocked",
] as const;

export type MissionNodeName = (typeof MISSION_NODE_NAMES)[number];
