import { Router } from "express";
import { buildVersionPayload, readDeploymentManifest } from "../deploymentManifest.js";

const DEFAULT_HEALTH_DEPENDENCY_TIMEOUT_MS = 1500;
const MIN_HEALTH_DEPENDENCY_TIMEOUT_MS = 250;
const MAX_HEALTH_DEPENDENCY_TIMEOUT_MS = 5000;

function boundedHealthTimeoutMs(env = process.env) {
  const parsed = Number(env.HEALTH_DEPENDENCY_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_HEALTH_DEPENDENCY_TIMEOUT_MS;
  return Math.min(
    MAX_HEALTH_DEPENDENCY_TIMEOUT_MS,
    Math.max(MIN_HEALTH_DEPENDENCY_TIMEOUT_MS, Math.floor(parsed)),
  );
}

async function runBoundedHealthProbe(probe, { timeoutMs, timeoutCode }) {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(probe),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`Health dependency probe timed out after ${timeoutMs}ms.`);
          error.code = timeoutCode;
          reject(error);
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safeRedisStatus(getRedisRuntimeStatus) {
  try {
    return typeof getRedisRuntimeStatus === "function"
      ? getRedisRuntimeStatus()
      : { status: "unavailable", connected: false };
  } catch (error) {
    return {
      status: "error",
      connected: false,
      error: { code: error?.code || "redis_status_failed" },
    };
  }
}

export function buildHealthRoutes(deps) {
  const {
    jobRepository,
    normalizeJobStatus,
    getWaitingCountSafe,
    getRedisRuntimeStatus,
    getSqlCacheRuntimeStatus,
    testDbConnection,
    SERVICE_VERSION,
    QUEUE_WORKER_ENABLED
  } = deps;

  const router = Router();

  router.get("/health", async (_req, res) => {
    const counts = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      retrying: 0,
      cancelled: 0
    };
    for (const job of jobRepository.values()) {
      const status = normalizeJobStatus(job.status);
      if (Object.prototype.hasOwnProperty.call(counts, status)) {
        counts[status] += 1;
      }
    }

    const dependencyTimeoutMs = boundedHealthTimeoutMs();
    const queueHealth = await runBoundedHealthProbe(
      () => getWaitingCountSafe(),
      { timeoutMs: dependencyTimeoutMs, timeoutCode: "queue_health_timeout" },
    ).catch((error) => ({
      ok: false,
      count: 0,
      error: { code: error?.code || "queue_health_failed" },
    }));
    const redisHealth = safeRedisStatus(getRedisRuntimeStatus);
    const sqlCacheHealth = typeof getSqlCacheRuntimeStatus === "function"
      ? getSqlCacheRuntimeStatus()
      : { enabled: false, available: false, skipped: true };
    const dbHealth = testDbConnection
      ? await runBoundedHealthProbe(
        () => testDbConnection(),
        { timeoutMs: dependencyTimeoutMs, timeoutCode: "db_health_timeout" },
      )
        .then(() => ({ connected: true }))
        .catch((err) => ({
          connected: false,
          error: err?.code || err?.message || "db_connection_failed"
        }))
      : { connected: null, skipped: true };
    const queueDisabledByConfig = !QUEUE_WORKER_ENABLED
      && redisHealth?.status === "disabled"
      && queueHealth?.error?.code === "queue_disabled";
    const queueDependencyHealthy = queueDisabledByConfig || (redisHealth.connected && queueHealth.ok);
    const dependencyStatus = queueDependencyHealthy && dbHealth.connected !== false
      ? "healthy"
      : "degraded";

    res.status(200).json({
      ok: true,
      service: "http_generic_api_connector",
      status: dependencyStatus,
      version: SERVICE_VERSION,
      health_probe_timeout_ms: dependencyTimeoutMs,
      jobs: {
        total: jobRepository.size(),
        queued_buffer_size: queueHealth.count,
        statuses: counts
      },
      dependencies: {
        redis: redisHealth,
        queue: queueHealth.ok
          ? { connected: true }
          : {
              connected: false,
              error: queueHealth.error
            },
        worker: {
          enabled: QUEUE_WORKER_ENABLED
        },
        sql_cache: sqlCacheHealth,
        db: {
          connected: dbHealth.connected,
          ...(dbHealth.error ? { error: dbHealth.error } : {}),
          ...(dbHealth.skipped ? { skipped: true } : {})
        }
      },
      timestamp: new Date().toISOString()
    });
  });

  router.get("/deployment-manifest", async (_req, res) => {
    const manifestResult = readDeploymentManifest();
    return res.status(200).json({
      ok: manifestResult.ok,
      ...manifestResult,
    });
  });

  router.get("/version", async (_req, res) => {
    return res.status(200).json(buildVersionPayload({ serviceVersion: SERVICE_VERSION }));
  });

  return router;
}

export const _testingHealthRoutes = {
  boundedHealthTimeoutMs,
  runBoundedHealthProbe,
};
