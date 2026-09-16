import { Router } from "express";
import { buildVersionPayload, readDeploymentManifest } from "../deploymentManifest.js";
import { buildTrustedIngressReadiness } from "../trustedIngressContract.js";

function exactText(value, expected) {
  return String(value || "").trim() === expected;
}

export function buildStagingRecoveryTrustedIngressHealth(env = process.env) {
  const readiness = buildTrustedIngressReadiness(env);
  if (readiness.environment !== "staging") return null;

  const expectedDeploymentSha = String(env?.REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA || "").trim().toLowerCase();
  const keyId = String(env?.REMOTE_MCP_TRUSTED_INGRESS_KEY_ID || "").trim();
  const replayDirectory = String(env?.RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY || "").trim();
  const canonicalHosts = Array.isArray(readiness?.canonical_host_policy?.hosts)
    ? readiness.canonical_host_policy.hosts
    : [];
  const canonicalHostExact = readiness?.canonical_host_policy?.valid === true
    && canonicalHosts.length === 1
    && canonicalHosts[0] === "activation-dev.mad4b.com";
  const audienceExact = exactText(env?.REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE, "https://dev.mad4b.com");
  const issuerExact = exactText(env?.REMOTE_MCP_TRUSTED_INGRESS_ISSUER, "https://activation-dev.mad4b.com");
  const keyIdConfigured = /^[A-Za-z0-9._:-]{16,128}$/u.test(keyId);
  const expectedDeploymentShaValid = /^[0-9a-f]{40}$/u.test(expectedDeploymentSha);
  const replayDirectoryExact = replayDirectory === "/app/data/recovery-ingress";

  const ready = readiness.runtime_identity_ok === true
    && readiness.attestation_mode === "signature"
    && readiness.proxy_headers_enabled === true
    && readiness.caller_headers_stripped === true
    && readiness.signed_attestation_configured === true
    && canonicalHostExact
    && audienceExact
    && issuerExact
    && keyIdConfigured
    && expectedDeploymentShaValid
    && replayDirectoryExact;

  return {
    contract: "mad4b.staging-recovery-trusted-ingress-health.v1",
    environment: "staging",
    ready,
    runtime_identity_ok: readiness.runtime_identity_ok === true,
    attestation_mode: readiness.attestation_mode,
    proxy_headers_enabled: readiness.proxy_headers_enabled === true,
    caller_headers_stripped: readiness.caller_headers_stripped === true,
    signed_attestation_configured: readiness.signed_attestation_configured === true,
    canonical_host_exact: canonicalHostExact,
    audience_exact: audienceExact,
    issuer_exact: issuerExact,
    key_id_configured: keyIdConfigured,
    expected_deployment_sha: expectedDeploymentShaValid ? expectedDeploymentSha : null,
    replay_directory_exact: replayDirectoryExact,
    secrets_included: false,
  };
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
  const runtimeEnv = deps?.env || process.env;

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
    const sqlCacheHealth = typeof getSqlCacheRuntimeStatus === "function"
      ? getSqlCacheRuntimeStatus()
      : { enabled: false, available: false, skipped: true };
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
    const stagingRecoveryTrustedIngress = buildStagingRecoveryTrustedIngressHealth(runtimeEnv);

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
        sql_cache: sqlCacheHealth,
        db: {
          connected: dbHealth.connected,
          ...(dbHealth.error ? { error: dbHealth.error } : {}),
          ...(dbHealth.skipped ? { skipped: true } : {})
        }
      },
      ...(stagingRecoveryTrustedIngress ? {
        staging_recovery_trusted_ingress: stagingRecoveryTrustedIngress,
      } : {}),
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
