// Orphan tracker for in-flight side effects during emergency kill (TC-CHAOS-07).
// Side effects (DB writes, API calls) register a token; on kill we sweep tokens that
// have not been completed and emit them as orphans for downstream cleanup. Best-effort
// — production replaces this with the audit ledger; tests use the in-memory map.

export type SideEffectKind = "db_write" | "external_api" | "fs_write" | "queue_publish";

export interface SideEffectToken {
  token: string;
  kind: SideEffectKind;
  description: string;
  startedAt: Date;
  completed: boolean;
  completedAt: Date | null;
  meta: Record<string, unknown>;
}

export interface OrphanReport {
  totalRegistered: number;
  totalCompleted: number;
  orphans: SideEffectToken[];
}

export class OrphanTracker {
  private readonly tokens = new Map<string, SideEffectToken>();
  private nextId = 0;

  register(input: { kind: SideEffectKind; description: string; meta?: Record<string, unknown> }): string {
    const token = `sx_${++this.nextId}`;
    this.tokens.set(token, {
      token,
      kind: input.kind,
      description: input.description,
      startedAt: new Date(),
      completed: false,
      completedAt: null,
      meta: input.meta ?? {},
    });
    return token;
  }

  complete(token: string): boolean {
    const t = this.tokens.get(token);
    if (!t) return false;
    t.completed = true;
    t.completedAt = new Date();
    return true;
  }

  /** Mark all in-flight tokens as orphans and return the report. */
  sweep(): OrphanReport {
    const all = Array.from(this.tokens.values());
    const orphans = all.filter((t) => !t.completed);
    return {
      totalRegistered: all.length,
      totalCompleted: all.length - orphans.length,
      orphans,
    };
  }

  size(): number {
    return this.tokens.size;
  }
}
