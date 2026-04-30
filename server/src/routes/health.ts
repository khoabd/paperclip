import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { Db, MigrationState } from "@paperclipai/db";
import { and, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { heartbeatRuns, instanceUserRoles, invites } from "@paperclipai/db";
import type { DeploymentExposure, DeploymentMode } from "@paperclipai/shared";
import { readPersistedDevServerStatus, toDevServerHealthStatus } from "../dev-server-status.js";
import { logger } from "../middleware/logger.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { serverVersion } from "../version.js";

function shouldExposeFullHealthDetails(
  actorType: "none" | "board" | "agent" | null | undefined,
  deploymentMode: DeploymentMode,
) {
  if (deploymentMode !== "authenticated") return true;
  return actorType === "board" || actorType === "agent";
}

function hasDevServerStatusToken(providedToken: string | undefined) {
  const expectedToken = process.env.PAPERCLIP_DEV_SERVER_STATUS_TOKEN?.trim();
  const token = providedToken?.trim();
  if (!expectedToken || !token) return false;

  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(token);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "unknown_error";
}

type SmokeMigrationSignal = {
  status: "pass" | "fail";
  source: "live_probe" | "startup_summary";
  summary: string;
  pendingMigrations: string[];
  reason: string | null;
  checkedAt: string;
};

type SmokeAuthSignal = {
  status: "pass" | "fail";
  deploymentMode: DeploymentMode;
  authReady: boolean;
  bootstrapStatus: "ready" | "bootstrap_pending";
  bootstrapInviteActive: boolean;
  probe: "session_resolver" | "not_required";
  reason: string | null;
  checkedAt: string;
};

function migrationSignalFromStartupSummary(
  summary: string | undefined,
  checkedAt: string,
): SmokeMigrationSignal {
  const migrationSummary = (summary ?? "unknown").trim();
  const passSummaries = new Set<string>([
    "already applied",
    "applied (empty database)",
    "applied (pending migrations)",
  ]);
  const isPass = passSummaries.has(migrationSummary);
  return {
    status: isPass ? "pass" : "fail",
    source: "startup_summary",
    summary: migrationSummary,
    pendingMigrations: [],
    reason: isPass ? null : "startup_migration_summary_not_ready",
    checkedAt,
  };
}

async function resolveBootstrapState(db: Db, deploymentMode: DeploymentMode): Promise<{
  bootstrapStatus: "ready" | "bootstrap_pending";
  bootstrapInviteActive: boolean;
}> {
  if (deploymentMode !== "authenticated") {
    return {
      bootstrapStatus: "ready",
      bootstrapInviteActive: false,
    };
  }

  const roleCount = await db
    .select({ count: count() })
    .from(instanceUserRoles)
    .where(sql`${instanceUserRoles.role} = 'instance_admin'`)
    .then((rows) => Number(rows[0]?.count ?? 0));
  const bootstrapStatus = roleCount > 0 ? "ready" : "bootstrap_pending";

  if (bootstrapStatus !== "bootstrap_pending") {
    return {
      bootstrapStatus,
      bootstrapInviteActive: false,
    };
  }

  const now = new Date();
  const inviteCount = await db
    .select({ count: count() })
    .from(invites)
    .where(
      and(
        eq(invites.inviteType, "bootstrap_ceo"),
        isNull(invites.revokedAt),
        isNull(invites.acceptedAt),
        gt(invites.expiresAt, now),
      ),
    )
    .then((rows) => Number(rows[0]?.count ?? 0));

  return {
    bootstrapStatus,
    bootstrapInviteActive: inviteCount > 0,
  };
}

export function healthRoutes(
  db?: Db,
  opts: {
    deploymentMode: DeploymentMode;
    deploymentExposure: DeploymentExposure;
    authReady: boolean;
    companyDeletionEnabled: boolean;
    migrationSummary?: string;
    inspectMigrationState?: () => Promise<MigrationState>;
    probeAuthSession?: () => Promise<void>;
  } = {
    deploymentMode: "local_trusted",
    deploymentExposure: "private",
    authReady: true,
    companyDeletionEnabled: true,
    migrationSummary: undefined,
    inspectMigrationState: undefined,
    probeAuthSession: undefined,
  },
) {
  const router = Router();

  router.get("/", async (req, res) => {
    const actorType = "actor" in req ? req.actor?.type : null;
    const exposeFullDetails = shouldExposeFullHealthDetails(
      actorType,
      opts.deploymentMode,
    );
    const exposeDevServerDetails =
      exposeFullDetails || hasDevServerStatusToken(req.get("x-paperclip-dev-server-status-token"));

    if (!db) {
      res.json(
        exposeFullDetails
          ? { status: "ok", version: serverVersion }
          : { status: "ok", deploymentMode: opts.deploymentMode },
      );
      return;
    }

    try {
      await db.execute(sql`SELECT 1`);
    } catch (error) {
      logger.warn({ err: error }, "Health check database probe failed");
      res.status(503).json({
        status: "unhealthy",
        version: serverVersion,
        error: "database_unreachable"
      });
      return;
    }

    const { bootstrapStatus, bootstrapInviteActive } = await resolveBootstrapState(db, opts.deploymentMode);

    const persistedDevServerStatus = readPersistedDevServerStatus();
    let devServer: ReturnType<typeof toDevServerHealthStatus> | undefined;
    if (exposeDevServerDetails && persistedDevServerStatus && typeof (db as { select?: unknown }).select === "function") {
      const instanceSettings = instanceSettingsService(db);
      const experimentalSettings = await instanceSettings.getExperimental();
      const activeRunCount = await db
        .select({ count: count() })
        .from(heartbeatRuns)
        .where(inArray(heartbeatRuns.status, ["queued", "running"]))
        .then((rows) => Number(rows[0]?.count ?? 0));

      devServer = toDevServerHealthStatus(persistedDevServerStatus, {
        autoRestartEnabled: experimentalSettings.autoRestartDevServerWhenIdle ?? false,
        activeRunCount,
      });
    }

    if (!exposeFullDetails) {
      res.json({
        status: "ok",
        deploymentMode: opts.deploymentMode,
        bootstrapStatus,
        bootstrapInviteActive,
        ...(devServer ? { devServer } : {}),
      });
      return;
    }

    res.json({
      status: "ok",
      version: serverVersion,
      deploymentMode: opts.deploymentMode,
      deploymentExposure: opts.deploymentExposure,
      authReady: opts.authReady,
      bootstrapStatus,
      bootstrapInviteActive,
      features: {
        companyDeletionEnabled: opts.companyDeletionEnabled,
      },
      ...(devServer ? { devServer } : {}),
    });
  });

  router.get("/smoke", async (req, res) => {
    const actorType = "actor" in req ? req.actor?.type : null;
    const exposeFullDetails = shouldExposeFullHealthDetails(
      actorType,
      opts.deploymentMode,
    );
    if (!exposeFullDetails) {
      res.status(403).json({
        error: "smoke health details require board or agent auth in authenticated mode",
      });
      return;
    }

    if (!db) {
      const checkedAt = new Date().toISOString();
      res.json({
        status: "ok",
        deploymentMode: opts.deploymentMode,
        checks: {
          auth: {
            status: opts.authReady ? "pass" : "fail",
            deploymentMode: opts.deploymentMode,
            authReady: opts.authReady,
            bootstrapStatus: "ready",
            bootstrapInviteActive: false,
            probe: opts.deploymentMode === "authenticated" ? "session_resolver" : "not_required",
            reason: opts.authReady ? null : "auth_not_ready",
            checkedAt,
          },
          migrations: migrationSignalFromStartupSummary(opts.migrationSummary, checkedAt),
        },
      });
      return;
    }

    try {
      await db.execute(sql`SELECT 1`);
    } catch (error) {
      logger.warn({ err: error }, "Smoke health database probe failed");
      res.status(503).json({
        status: "unhealthy",
        version: serverVersion,
        error: "database_unreachable"
      });
      return;
    }

    const checkedAt = new Date().toISOString();
    const { bootstrapStatus, bootstrapInviteActive } = await resolveBootstrapState(db, opts.deploymentMode);

    let migrationSignal: SmokeMigrationSignal;
    if (opts.inspectMigrationState) {
      try {
        const state = await opts.inspectMigrationState();
        migrationSignal =
          state.status === "upToDate"
            ? {
                status: "pass",
                source: "live_probe",
                summary: "up_to_date",
                pendingMigrations: [],
                reason: null,
                checkedAt,
              }
            : {
                status: "fail",
                source: "live_probe",
                summary: "needs_migrations",
                pendingMigrations: state.pendingMigrations,
                reason: state.reason,
                checkedAt,
              };
      } catch (error) {
        migrationSignal = {
          status: "fail",
          source: "live_probe",
          summary: "probe_error",
          pendingMigrations: [],
          reason: toErrorMessage(error),
          checkedAt,
        };
      }
    } else {
      migrationSignal = migrationSignalFromStartupSummary(opts.migrationSummary, checkedAt);
    }

    let authSignal: SmokeAuthSignal;
    if (opts.deploymentMode === "local_trusted") {
      authSignal = {
        status: opts.authReady ? "pass" : "fail",
        deploymentMode: opts.deploymentMode,
        authReady: opts.authReady,
        bootstrapStatus,
        bootstrapInviteActive,
        probe: "not_required",
        reason: opts.authReady ? null : "auth_not_ready",
        checkedAt,
      };
    } else if (!opts.authReady) {
      authSignal = {
        status: "fail",
        deploymentMode: opts.deploymentMode,
        authReady: false,
        bootstrapStatus,
        bootstrapInviteActive,
        probe: "session_resolver",
        reason: "auth_not_ready",
        checkedAt,
      };
    } else if (!opts.probeAuthSession) {
      authSignal = {
        status: "fail",
        deploymentMode: opts.deploymentMode,
        authReady: true,
        bootstrapStatus,
        bootstrapInviteActive,
        probe: "session_resolver",
        reason: "auth_probe_unavailable",
        checkedAt,
      };
    } else {
      try {
        await opts.probeAuthSession();
        authSignal = {
          status: "pass",
          deploymentMode: opts.deploymentMode,
          authReady: true,
          bootstrapStatus,
          bootstrapInviteActive,
          probe: "session_resolver",
          reason: null,
          checkedAt,
        };
      } catch (error) {
        authSignal = {
          status: "fail",
          deploymentMode: opts.deploymentMode,
          authReady: true,
          bootstrapStatus,
          bootstrapInviteActive,
          probe: "session_resolver",
          reason: toErrorMessage(error),
          checkedAt,
        };
      }
    }

    res.json({
      status: "ok",
      deploymentMode: opts.deploymentMode,
      checks: {
        auth: authSignal,
        migrations: migrationSignal,
      },
    });
  });

  return router;
}
