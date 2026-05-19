import { Router } from "express";
import { buildVersionPayload, readDeploymentManifest } from "../deploymentManifest.js";

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

    const queueHealth = await getWaitingCountSafe();
    const redisHealth = getRedisRuntimeStatus();
    const dbHealth = testDbConnection
      ? await testDbConnection()
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

    res.json({
      ok: true,
      service: "http_generic_api_connector",
      status: dependencyStatus,
      version: SERVICE_VERSION,
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
