import { getPool } from "./db.js";
import { executeHostingerSshDeployRelease } from "./hostingerSshDeployExecutor.js";
import { appendReleaseOperationStep } from "./releaseOperationService.js";
import {
  HOSTINGER_ASYNC_DEPLOY_JOB_TYPE,
  classifyAsyncDeployOutcome,
  normalizeHostingerAsyncDeployPayload,
} from "./asyncReleaseDeployContract.js";

export { HOSTINGER_ASYNC_DEPLOY_JOB_TYPE };

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

async function updateTracking(pool, asyncDeploymentId, patch = {}) {
  await pool.query(
    `UPDATE release_async_deployments
        SET status = COALESCE(?, status), job_id = COALESCE(?, job_id), deployment_run_id = COALESCE(?, deployment_run_id),
            last_http_status = COALESCE(?, last_http_status), result_json = COALESCE(?, result_json),
            error_json = COALESCE(?, error_json), started_at = COALESCE(started_at, ?),
            completed_at = CASE WHEN ? = 1 THEN NOW(3) ELSE completed_at END,
            updated_at = NOW(3)
      WHERE async_deployment_id = ?`,
    [
      patch.status || null,
      patch.job_id || null,
      patch.deployment_run_id || null,
      patch.last_http_status ?? null,
      patch.result === undefined ? null : safeJson(patch.result),
      patch.error === undefined ? null : safeJson(patch.error),
      patch.started ? new Date() : null,
      patch.completed ? 1 : 0,
      asyncDeploymentId,
    ],
  );
}

export async function runHostingerAsyncDeployJob(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const executeDeploy = deps.executeHostingerSshDeployRelease || executeHostingerSshDeployRelease;
  const payload = normalizeHostingerAsyncDeployPayload(input);
  const baseDetail = {
    async_deployment_id: payload.async_deployment_id,
    job_id: payload.worker_job_id || null,
    dry_run: payload.dry_run,
    provider_write: payload.dry_run !== true,
    secrets_included: false,
  };

  await updateTracking(pool, payload.async_deployment_id, {
    status: "running",
    job_id: payload.worker_job_id,
    started: true,
  });
  await appendReleaseOperationStep(payload.operation_id, {
    step_key: "async_deploy_worker_started",
    step_order: 110,
    attempt_number: 1,
    step_status: "completed",
    operation_status: payload.dry_run ? "ready_for_execution" : "deploy_started",
    classification: payload.dry_run ? "async_dry_run_started" : "deploy_started",
    idempotency_key: `${payload.async_deployment_id}:worker_started`,
    detail: baseDetail,
  });

  try {
    const result = await executeDeploy({
      target_id: payload.target_id,
      app_key: payload.app_key,
      app_path: payload.app_path,
      branch: payload.branch,
      expected_commit_sha: payload.expected_commit_sha,
      capability_envelope_id: payload.capability_envelope_id || undefined,
      approval_reason: payload.approval_reason,
      force_clean: payload.force_clean,
      restart: payload.restart,
      dry_run: payload.dry_run,
      timeout_ms: payload.timeout_ms,
      ssh_auth_mode: payload.ssh_auth_mode,
      ssh_transport_mode: payload.ssh_transport_mode,
    }, deps);
    const outcome = classifyAsyncDeployOutcome({ result });

    if (!payload.dry_run && outcome.status === "readback_pending" && result?.reload_verification?.restart_requested === true) {
      await appendReleaseOperationStep(payload.operation_id, {
        step_key: "async_deploy_restart_in_progress",
        step_order: 120,
        attempt_number: 1,
        step_status: "completed",
        operation_status: "restart_in_progress",
        classification: "restart_in_progress",
        idempotency_key: `${payload.async_deployment_id}:restart_in_progress`,
        detail: { ...baseDetail, deployment_run_id: outcome.deployment_run_id, reload_verification: result.reload_verification },
      });
    }

    await appendReleaseOperationStep(payload.operation_id, {
      step_key: payload.dry_run ? "async_deploy_dry_run_complete" : `async_deploy_${outcome.status}`,
      step_order: 130,
      attempt_number: 1,
      step_status: outcome.job_success ? "completed" : "failed",
      operation_status: outcome.operation_status,
      classification: outcome.status,
      idempotency_key: `${payload.async_deployment_id}:${outcome.status}`,
      detail: { ...baseDetail, deployment_run_id: outcome.deployment_run_id, outcome, result },
      error: outcome.job_success ? undefined : { code: outcome.reason },
    });

    await updateTracking(pool, payload.async_deployment_id, {
      status: outcome.status,
      deployment_run_id: outcome.deployment_run_id,
      last_http_status: outcome.http_status,
      result: { ...result, async_classification: outcome, secrets_included: false },
      completed: outcome.terminal,
    });
    return {
      ok: outcome.job_success,
      operation_id: payload.operation_id,
      async_deployment_id: payload.async_deployment_id,
      deployment_run_id: outcome.deployment_run_id,
      async_status: outcome.status,
      deployment: result,
      transient: outcome.transient,
      secrets_included: false,
    };
  } catch (error) {
    const outcome = classifyAsyncDeployOutcome({ error });
    await appendReleaseOperationStep(payload.operation_id, {
      step_key: `async_deploy_${outcome.status}`,
      step_order: 130,
      attempt_number: 1,
      step_status: outcome.job_success ? "completed" : "failed",
      operation_status: outcome.operation_status,
      classification: outcome.status,
      idempotency_key: `${payload.async_deployment_id}:${outcome.status}`,
      detail: { ...baseDetail, outcome },
      error: { code: error?.code || outcome.reason, message: error?.message || "Async deploy worker failed." },
    }).catch(() => null);
    await updateTracking(pool, payload.async_deployment_id, {
      status: outcome.status,
      last_http_status: outcome.http_status,
      error: { code: error?.code || outcome.reason, message: error?.message || "Async deploy worker failed.", details: error?.details || null },
      completed: outcome.terminal,
    });
    return {
      ok: outcome.job_success,
      operation_id: payload.operation_id,
      async_deployment_id: payload.async_deployment_id,
      deployment_run_id: null,
      async_status: outcome.status,
      transient: outcome.transient,
      error: { code: error?.code || outcome.reason, message: error?.message || "Async deploy worker failed." },
      secrets_included: false,
    };
  }
}
