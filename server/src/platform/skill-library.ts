// Skill resolution with deterministic canary routing.
// A workspace either gets pinned, gets canary (if their hash falls under canary_pct),
// or falls through to the latest stable version.
// Per Phase-2-Platform-Workspace-Mission-Layer §2.3 (skill versioning + canary).

import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { platformSkills, skillVersions, workspaceSkillPins } from "@paperclipai/db";

export type SkillResolution =
  | { kind: "pinned"; version: string; codePath: string; reason?: string | null }
  | { kind: "canary"; version: string; codePath: string }
  | { kind: "stable"; version: string; codePath: string }
  | { kind: "missing"; reason: string };

export class SkillLibrary {
  constructor(private readonly db: Db) {}

  async resolve(skillKey: string, workspaceId: string): Promise<SkillResolution> {
    const skill = (
      await this.db.select().from(platformSkills).where(eq(platformSkills.key, skillKey)).limit(1)
    )[0];
    if (!skill) return { kind: "missing", reason: `unknown skill key: ${skillKey}` };

    const pin = (
      await this.db
        .select()
        .from(workspaceSkillPins)
        .where(
          and(
            eq(workspaceSkillPins.companyId, workspaceId),
            eq(workspaceSkillPins.skillId, skill.id),
          ),
        )
        .limit(1)
    )[0];
    if (pin) {
      const pinned = (
        await this.db
          .select()
          .from(skillVersions)
          .where(and(eq(skillVersions.skillId, skill.id), eq(skillVersions.version, pin.pinnedVersion)))
          .limit(1)
      )[0];
      if (pinned) {
        return { kind: "pinned", version: pinned.version, codePath: pinned.codePath, reason: pin.reason };
      }
    }

    const canaryPct = skill.canaryPct ?? 0;
    if (canaryPct > 0 && hashWorkspaceToBucket(workspaceId, skill.key) < canaryPct) {
      const canary = (
        await this.db
          .select()
          .from(skillVersions)
          .where(and(eq(skillVersions.skillId, skill.id), eq(skillVersions.status, "canary")))
          .orderBy(desc(skillVersions.createdAt))
          .limit(1)
      )[0];
      if (canary) return { kind: "canary", version: canary.version, codePath: canary.codePath };
    }

    const stable = (
      await this.db
        .select()
        .from(skillVersions)
        .where(and(eq(skillVersions.skillId, skill.id), eq(skillVersions.status, "stable")))
        .orderBy(desc(skillVersions.releasedAt), desc(skillVersions.createdAt))
        .limit(1)
    )[0];
    if (stable) return { kind: "stable", version: stable.version, codePath: stable.codePath };

    return { kind: "missing", reason: `no stable or canary version registered for skill ${skillKey}` };
  }
}

/**
 * FNV-1a 32-bit -> bucket [0,100). Deterministic, no crypto, stable across processes.
 */
export function hashWorkspaceToBucket(workspaceId: string, salt: string): number {
  const input = `${workspaceId}:${salt}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 10000) / 100;
}
