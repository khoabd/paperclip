// Seeds the 7 greenfield_stages rows for a newly-created intake.
// Called once per intake before the first tick.

import type { Db } from "@paperclipai/db";
import { greenfieldStages } from "@paperclipai/db";
import { STAGE_SEQUENCE } from "./greenfield-state-machine.js";

export class GreenfieldStageSeeder {
  constructor(private readonly db: Db) {}

  async seed(intakeId: string): Promise<void> {
    const rows = STAGE_SEQUENCE.map((stageName, idx) => ({
      intakeId,
      stageName,
      sequence: idx,
      status: "pending" as const,
      inputs: {},
      outputs: {},
    }));
    await this.db.insert(greenfieldStages).values(rows);
  }
}
