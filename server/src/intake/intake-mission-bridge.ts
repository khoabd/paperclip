// Bridges an approved intake to a Phase-4 mission.
// Per Phase-5-Human-Intake-Hub §5.2 + Phase-4 mission shape.

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { intakeItems, intakeSolutions, missions } from "@paperclipai/db";
import { IntakeStore } from "./intake-store.js";

export interface SpawnMissionInput {
  intakeId: string;
  /** Title override; falls back to intake.title or "Intake <type>". */
  missionTitle?: string;
  /** Goal override; falls back to intake.spec or intake.rawText. */
  missionGoal?: string;
}

export interface SpawnMissionResult {
  missionId: string;
  intakeId: string;
}

export class IntakeMissionBridge {
  constructor(
    private readonly db: Db,
    private readonly store: IntakeStore,
  ) {}

  async spawn(input: SpawnMissionInput): Promise<SpawnMissionResult> {
    const intake = (
      await this.db
        .select()
        .from(intakeItems)
        .where(eq(intakeItems.id, input.intakeId))
        .limit(1)
    )[0];
    if (!intake) throw new Error(`intake not found: ${input.intakeId}`);
    if (intake.missionId) {
      return { missionId: intake.missionId, intakeId: intake.id };
    }

    const selectedSolution = (
      await this.db
        .select()
        .from(intakeSolutions)
        .where(eq(intakeSolutions.intakeId, intake.id))
        .limit(50)
    ).find((s) => s.selected);

    const goal =
      input.missionGoal ??
      intake.spec ??
      (selectedSolution ? `${selectedSolution.title}\n\n${intake.rawText}` : intake.rawText);
    const title = input.missionTitle ?? intake.title ?? `Intake ${intake.type}`;

    const inserted = (
      await this.db
        .insert(missions)
        .values({
          companyId: intake.companyId,
          title,
          goal,
          status: "intake",
        })
        .returning({ id: missions.id })
    )[0]!;

    await this.store.setMissionId(intake.id, inserted.id);
    return { missionId: inserted.id, intakeId: intake.id };
  }
}
