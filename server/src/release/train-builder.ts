// Release-train builder per Phase-13 §train-builder.
// Groups feature keys ready_to_promote into one or more "trains" (release groups
// that ship together) using a deterministic strategy. Persists the chosen group
// only in non-dryRun mode.

import { releaseTrains, type createDb } from "@paperclipai/db";

export type TrainsDb = ReturnType<typeof createDb>;

export type CandidateFeature = {
  key: string;
  /** Hint for grouping: features sharing the same train_hint go together. */
  trainHint?: string;
  /** Risk band: low/medium/high — high-risk features get their own train. */
  risk?: "low" | "medium" | "high";
};

export type ProposedTrain = {
  tag: string;
  featureKeys: string[];
  rationale: string;
};

export type RunResult = {
  proposedTrains: ProposedTrain[];
  persistedCount: number;
};

const MAX_FEATURES_PER_TRAIN = 4;

function todayTag(d: Date, idx: number): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `train-${yyyy}-${mm}-${dd}-${idx}`;
}

export class TrainBuilder {
  constructor(private readonly db: TrainsDb, private readonly now: () => Date = () => new Date()) {}

  /**
   * Group candidates into trains. Strategy:
   * - high-risk features: each gets its own train ("solo" rationale)
   * - others grouped by trainHint, falling back to a default bucket
   * - cap at MAX_FEATURES_PER_TRAIN per group; overflow goes into a follow-up train
   */
  plan(candidates: readonly CandidateFeature[]): ProposedTrain[] {
    const buckets = new Map<string, CandidateFeature[]>();
    const solo: ProposedTrain[] = [];
    const at = this.now();

    let soloIdx = 0;
    for (const c of candidates) {
      if (c.risk === "high") {
        solo.push({
          tag: todayTag(at, 100 + soloIdx++),
          featureKeys: [c.key],
          rationale: `solo train for high-risk feature ${c.key}`,
        });
        continue;
      }
      const hint = c.trainHint ?? "default";
      const list = buckets.get(hint) ?? [];
      list.push(c);
      buckets.set(hint, list);
    }

    const trains: ProposedTrain[] = [...solo];
    let groupIdx = 0;
    for (const [hint, list] of buckets) {
      for (let i = 0; i < list.length; i += MAX_FEATURES_PER_TRAIN) {
        const slice = list.slice(i, i + MAX_FEATURES_PER_TRAIN);
        trains.push({
          tag: todayTag(at, ++groupIdx),
          featureKeys: slice.map((c) => c.key),
          rationale: `group=${hint} (${slice.length} features)`,
        });
      }
    }

    // Stable order: by tag.
    trains.sort((a, b) => a.tag.localeCompare(b.tag));
    return trains;
  }

  async run(opts: {
    companyId: string;
    candidates: readonly CandidateFeature[];
    dryRun?: boolean;
    mintedBy?: string;
  }): Promise<RunResult> {
    const proposed = this.plan(opts.candidates);

    if (opts.dryRun || proposed.length === 0) {
      return { proposedTrains: proposed, persistedCount: 0 };
    }

    const persisted = await this.db
      .insert(releaseTrains)
      .values(
        proposed.map((p) => ({
          companyId: opts.companyId,
          tag: p.tag,
          featureKeys: p.featureKeys,
          rationale: p.rationale,
          mintedBy: opts.mintedBy ?? "auto",
        })),
      )
      .returning({ id: releaseTrains.id });

    return { proposedTrains: proposed, persistedCount: persisted.length };
  }
}
