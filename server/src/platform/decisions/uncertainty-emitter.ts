// Emits agent uncertainty events to agent_uncertainty_events.
// Used by any agent phase that encounters ambiguous classifications, conflicting
// evidence, or unknown decision classes.
// Per Phase 9 spec §Services.3.

import type { Db } from "@paperclipai/db";
import { agentUncertaintyEvents } from "@paperclipai/db";

export type UncertaintyKind =
  | "low_confidence"
  | "conflicting_signals"
  | "stale_data"
  | "disputed_outcome"
  | "unknown_class";

export class UncertaintyEmitter {
  constructor(private readonly db: Db) {}

  async emit(
    agentId: string,
    kind: UncertaintyKind,
    payload?: Record<string, unknown>,
    missionId?: string | null,
  ): Promise<{ id: string }> {
    const rows = await this.db
      .insert(agentUncertaintyEvents)
      .values({
        agentId,
        missionId: missionId ?? null,
        kind,
        observedAt: new Date(),
        payload: payload ?? {},
      })
      .returning({ id: agentUncertaintyEvents.id });

    return { id: rows[0].id };
  }
}
