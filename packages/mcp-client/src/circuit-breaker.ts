import { DEFAULT_BREAKER_OPTIONS, type McpBreakerOptions } from "./types.js";

export type BreakerState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private state: BreakerState = "closed";
  private failures = 0;
  private nextAttemptAt = 0;
  private readonly options: McpBreakerOptions;

  constructor(options: Partial<McpBreakerOptions> = {}) {
    this.options = { ...DEFAULT_BREAKER_OPTIONS, ...options };
  }

  get currentState(): BreakerState {
    if (this.state === "open" && Date.now() >= this.nextAttemptAt) {
      this.state = "half-open";
    }
    return this.state;
  }

  canAttempt(): boolean {
    return this.currentState !== "open";
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = "closed";
    this.nextAttemptAt = 0;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.options.failureThreshold) {
      this.state = "open";
      this.nextAttemptAt = Date.now() + this.options.resetAfterMs;
    }
  }

  reset(): void {
    this.failures = 0;
    this.state = "closed";
    this.nextAttemptAt = 0;
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(serverId: string) {
    super(`Circuit breaker is open for MCP server ${serverId}`);
    this.name = "CircuitBreakerOpenError";
  }
}
