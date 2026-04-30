import { StateGraph, END } from "@langchain/langgraph";
import type { Db } from "@paperclipai/db";
import { IssueWorkflowAnnotation } from "./state.js";
import type { HeartbeatDep } from "./nodes.js";
import { classifyNode, routeNode, assignNode, monitorNode, recoverNode } from "./nodes.js";

export function buildIssueWorkflowGraph(db: Db, heartbeat: HeartbeatDep) {
  const graph = new StateGraph(IssueWorkflowAnnotation)
    .addNode("classify", (state) => classifyNode(state, db))
    .addNode("route", (state) => routeNode(state, db))
    .addNode("assign", (state) => assignNode(state, db, heartbeat))
    .addNode("monitor", (state) => monitorNode(state, db))
    .addNode("recover", (state) => recoverNode(state, db, heartbeat))
    .addEdge("__start__", "classify")
    .addEdge("classify", "route")
    .addConditionalEdges("route", (state) =>
      state.assignedAgentId ? "assign" : END,
    )
    .addEdge("assign", "monitor")
    .addConditionalEdges("monitor", (state) => {
      if (state.runStatus === "done") return END;
      if (state.runStatus === "failed") return "recover";
      return "monitor"; // loop while running or pending
    })
    .addConditionalEdges("recover", (state) =>
      state.retryCount < 3 ? "assign" : END,
    );

  return graph.compile();
}
