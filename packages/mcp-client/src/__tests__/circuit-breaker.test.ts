import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "../circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("starts closed and allows attempts", () => {
    const b = new CircuitBreaker();
    expect(b.canAttempt()).toBe(true);
    expect(b.currentState).toBe("closed");
  });

  it("opens after threshold consecutive failures", () => {
    const b = new CircuitBreaker({ failureThreshold: 3, resetAfterMs: 10_000 });
    b.recordFailure();
    b.recordFailure();
    expect(b.canAttempt()).toBe(true);
    b.recordFailure();
    expect(b.currentState).toBe("open");
    expect(b.canAttempt()).toBe(false);
  });

  it("resets to closed on success", () => {
    const b = new CircuitBreaker({ failureThreshold: 2, resetAfterMs: 10_000 });
    b.recordFailure();
    b.recordSuccess();
    b.recordFailure();
    expect(b.canAttempt()).toBe(true);
  });

  it("transitions to half-open after reset window", async () => {
    const b = new CircuitBreaker({ failureThreshold: 1, resetAfterMs: 5 });
    b.recordFailure();
    expect(b.canAttempt()).toBe(false);
    await new Promise((r) => setTimeout(r, 10));
    expect(b.currentState).toBe("half-open");
    expect(b.canAttempt()).toBe(true);
  });

  it("manual reset clears state", () => {
    const b = new CircuitBreaker({ failureThreshold: 1, resetAfterMs: 10_000 });
    b.recordFailure();
    expect(b.canAttempt()).toBe(false);
    b.reset();
    expect(b.canAttempt()).toBe(true);
  });
});
