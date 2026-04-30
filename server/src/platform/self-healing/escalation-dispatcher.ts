// Escalation dispatcher for kill-switch level=global (TC-CHAOS-07).
// In-memory channels for tests; production wires real PagerDuty/email/Slack adapters
// behind the same NotificationChannel interface so swapping providers is a config flip.

export type Severity = "info" | "warning" | "critical" | "page";

export interface EscalationEvent {
  id: string;
  severity: Severity;
  title: string;
  body: string;
  meta: Record<string, unknown>;
  occurredAt: Date;
}

export interface NotificationChannel {
  readonly name: string;
  send(event: EscalationEvent): Promise<void>;
}

export class InMemoryChannel implements NotificationChannel {
  public readonly delivered: EscalationEvent[] = [];
  constructor(public readonly name: string) {}
  async send(event: EscalationEvent): Promise<void> {
    this.delivered.push(event);
  }
}

export class FailingChannel implements NotificationChannel {
  constructor(public readonly name: string) {}
  async send(_event: EscalationEvent): Promise<void> {
    throw new Error(`channel ${this.name} unavailable`);
  }
}

export interface DispatcherStats {
  attempted: number;
  delivered: number;
  failed: number;
  perChannel: Record<string, { delivered: number; failed: number }>;
}

export class EscalationDispatcher {
  private readonly channels: NotificationChannel[];
  private stats: DispatcherStats = {
    attempted: 0,
    delivered: 0,
    failed: 0,
    perChannel: {},
  };

  constructor(channels: NotificationChannel[]) {
    this.channels = channels;
    for (const c of channels) this.stats.perChannel[c.name] = { delivered: 0, failed: 0 };
  }

  async fire(event: EscalationEvent): Promise<DispatcherStats> {
    for (const channel of this.channels) {
      this.stats.attempted += 1;
      try {
        await channel.send(event);
        this.stats.delivered += 1;
        this.stats.perChannel[channel.name]!.delivered += 1;
      } catch {
        this.stats.failed += 1;
        this.stats.perChannel[channel.name]!.failed += 1;
      }
    }
    return { ...this.stats, perChannel: { ...this.stats.perChannel } };
  }

  snapshot(): DispatcherStats {
    return { ...this.stats, perChannel: { ...this.stats.perChannel } };
  }
}
