import type { InvocationRecorder, McpInvocationRecord } from "./types.js";

export class InMemoryInvocationRecorder implements InvocationRecorder {
  readonly records: McpInvocationRecord[] = [];

  record(record: McpInvocationRecord): void {
    this.records.push(record);
  }

  reset(): void {
    this.records.length = 0;
  }
}

export class NoopInvocationRecorder implements InvocationRecorder {
  record(): void {
    /* drop */
  }
}
