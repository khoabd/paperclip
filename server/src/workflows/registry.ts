/**
 * Module-level orchestrator registry.
 * Allows routes to fire-and-forget without changing function signatures.
 */
import type { IssueOrchestrator } from "./orchestrator.js";

let _orchestrator: IssueOrchestrator | null = null;

export function registerOrchestrator(o: IssueOrchestrator): void {
  _orchestrator = o;
}

export function getOrchestrator(): IssueOrchestrator | null {
  return _orchestrator;
}
