import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

export type IssueType =
  | "backend_bug"
  | "frontend_bug"
  | "design_task"
  | "qa_task"
  | "devops_task"
  | "product_task"
  | "architecture"
  | "data_task"
  | "security_task"
  | "infra_task"
  | "unknown";

// Last-write-wins reducer — always take the incoming update value
function replace<T>(_prev: T, next: T): T {
  return next;
}

export const IssueWorkflowAnnotation = Annotation.Root({
  issueId: Annotation<string>(),
  companyId: Annotation<string>(),
  title: Annotation<string>(),
  description: Annotation<string>(),
  issueType: Annotation<IssueType>({
    reducer: replace<IssueType>,
    default: () => "unknown" as IssueType,
  }),
  candidateAgents: Annotation<Array<{ id: string; name: string }>>({
    reducer: replace<Array<{ id: string; name: string }>>,
    default: () => [],
  }),
  assignedAgentId: Annotation<string | null>({
    reducer: replace<string | null>,
    default: () => null,
  }),
  assignedAgentName: Annotation<string | null>({
    reducer: replace<string | null>,
    default: () => null,
  }),
  currentRunId: Annotation<string | null>({
    reducer: replace<string | null>,
    default: () => null,
  }),
  runStatus: Annotation<"pending" | "running" | "done" | "failed" | null>({
    reducer: replace<"pending" | "running" | "done" | "failed" | null>,
    default: () => null,
  }),
  retryCount: Annotation<number>({
    reducer: replace<number>,
    default: () => 0,
  }),
  lastError: Annotation<string | null>({
    reducer: replace<string | null>,
    default: () => null,
  }),
  adapterFailed: Annotation<boolean>({
    reducer: replace<boolean>,
    default: () => false,
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

export type IssueWorkflowState = typeof IssueWorkflowAnnotation.State;
