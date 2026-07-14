import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { readHostingerSshDeployRunStatus } from "./hostingerSshDeployExecutor.js";
import {
  appendReleaseOperationStep,
  finalizeReleaseOperation,
  getReleaseOperation,
} from "./releaseOperationService.js";
import {
  HOSTINGER_ASYNC_DEPLOY_JOB_TYPE,
  classifyAsyncDeployReadback,
  normalizeHostingerAsyncDeployPayload,
  validateHostingerAsyncDeployPayload,
} from "./asyncReleaseDeployContract.js";

function fail(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  throw error;
}

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function json(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function shape(row) {
  return row ? {
    ...row,
    result_json: json(row.result_json),
    error_json: json(row.error_json),
    secrets_included: false,
  } : null;
}

async function loadOperationAndGate(pool, operationId, input, dryRun) {
  const [operationRows] = await pool.query(`SELECT * FROM release_operations WHERE operation_id = ? LIMIT 1`, [operationId]);
  const operation = operationRows[0];
  if (!operation) fail("release_async_deploy_operation_not_found", "Release operation was not found.", 404);
  const allowed = dryRun
    ? new Set(["dry_run_complete", "approval_required", "ready_for_execution"])
    : new Set(["ready_for_execution"]);
  if (!allowed.has(operation.current_status)) {
    fail("release_async_deploy_operation_not_ready", "Release operation is not ready for async deploy acceptance.", 409, { current_status: operation.current_status });
  }
  if (String(operation.target_id || "") !== String(input.target_id || "")) fail("release_async_deploy_target_mismatch", "Release operation target does not match request.", 409);
  if (String(operation.expected_commit_sha || "").toLowerCase() !== String(input.expected_commit_sha || "").toLowerCase()) fail("release_async_deploy_commit_mismatch", "Release operation commit does not match request.", 409);
  if (dryRun) return { operation, gate: null };

  const [gateRows] = await pool.query(
    `SELECT * FROM release_gates WHERE gate_id = ? AND operation_id = ? LIMIT 1`,
    [input.gate_id, operationId],
  );
  const gate = gateRows[0];
  if (!gate) fail("release_async_deploy_gate_not_found", "An open release gate linked to this operation is required.", 404);
  if (gate.status !== "open" || new Date(gate.expires_at) <= new Date()) fail("release_async_deploy_gate_not_open", "Release gate is not open or has expired.", 409);
  if (String(gate.target_id) !== String(input.target_id)) fail("release_async_deploy_gate_target_mismatch", "Release gate target does not match request.", 409);
  if (String(gate.expected_commit_sha).toLowerCase() !== String(input.expected_commit_sha).toLowerCase()) fail("release_async_deploy_gate_commit_mismatch", "Release gate commit does not match request.", 409);
  if (String(gate.capability_envelope_id) !== String(input.capability_envelope_id)) fail("release_async_deploy_gate_envelope_mismatch", "Release gate envelope does not match request.", 409);
  return { operation, gate };
}

async function loadTracking(pool, operationId) {
  const [rows] = await pool.query(`SELECT * FROM release_async_deployments WHERE operation_id = ? LIMIT 1`, [operationId]);
  return rows[0] || null;
}

export async function submitAsyncReleaseDeploy({ operationId, body = {}, requestedBy, idempotencyKey, executionFacade }) {
  const pool = getPool();
  const normalized = normalizeHostingerAsyncDeployPayload({ ...body, operation_id: operationId, requested_by: requestedBy });
  normalized.async_deployment_id = normalized.async_deployment_id || randomUUID();
  const errors = validateHostingerAsyncDeployPayload(normalized);
  if (errors.length) fail("release_async_deploy_validation_error", "Async deploy request is invalid.", 400, { errors });
  await loadOperationAndGate(pool, operationId, normalized, normalized.dry_run);

  const existing = await loadTracking(pool, operationId);
  if (existing) {
    if (idempotencyKey && existing.idempotency_key === idempotencyKey) {
      return {
        status: 202,
        body: {
          ok: true,
          accepted: true,
          deduplicated: true,
          operation_id: operationId,
          async_deployment_id: existing.async_deployment_id,
          job_id: existing.job_id,
          async_status: existing.status,
          status_url: `/admin/release-operations/${operationId}/async-deploy`,
          readback_url: `/admin/release-operations/${operationId}/async-deploy/readback`,
          secrets_included: false,
        },
      };
    }
    fail("release_async_deploy_already_exists", "An async deployment already exists for this release operation.", 409, { async_deployment_id: existing.async_deployment_id, status: existing.status });
  }

  await pool.query(
    `INSERT INTO release_async_deployments
     (async_deployment_id, operation_id, gate_id, target_id, capability_envelope_id, expected_commit_sha,
      status, idempotency_key, accepted_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'accepted', ?, NOW(3), ?)`,
    [normalized.async_deployment_id, operationId, normalized.gate_id || null, normalized.target_id,
     normalized.capability_envelope_id || null, normalized.expected_commit_sha, idempotencyKey || null, text(requestedBy || "gpt_admin", 191)],
  );

  await appendReleaseOperationStep(operationId, {
    step_key: "async_deploy_accepted",
    step_order: 100,
    attempt_number: 1,
    step_status: "completed",
    operation_status: normalized.dry_run ? undefined : "ready_for_execution",
    classification: "accepted",
    idempotency_key: `${normalized.async_deployment_id}:accepted`,
    detail: { async_deployment_id: normalized.async_deployment_id, dry_run: normalized.dry_run, secrets_included: false },
  });

  const submission = await executionFacade.submitJob({
    job_type: HOSTINGER_ASYNC_DEPLOY_JOB_TYPE,
    request_payload: normalized,
    max_attempts: 1,
    idempotency_key: idempotencyKey || undefined,
  }, requestedBy, idempotencyKey);

  if (![200, 202].includes(Number(submission.status))) {
    await pool.query(
      `UPDATE release_async_deployments SET status = 'failed_preflight', error_json = ?, last_http_status = ?, completed_at = NOW(3), updated_at = NOW(3) WHERE async_deployment_id = ?`,
      [JSON.stringify(submission.body || null), Number(submission.status || 503), normalized.async_deployment_id],
    );
    fail("release_async_deploy_enqueue_failed", "Async deploy job could not be accepted by the governed queue.", Number(submission.status || 503), submission.body);
  }

  const jobId = submission.body?.job_id;
  await pool.query(
    `UPDATE release_async_deployments SET status = 'queued', job_id = ?, updated_at = NOW(3) WHERE async_deployment_id = ?`,
    [jobId || null, normalized.async_deployment_id],
  );
  return {
    status: 202,
    body: {
      ok: true,
      accepted: true,
      operation_id: operationId,
      async_deployment_id: normalized.async_deployment_id,
      job_id: jobId || null,
      async_status: "queued",
      status_url: `/admin/release-operations/${operationId}/async-deploy`,
      job_status_url: jobId ? `/jobs/${jobId}` : null,
      job_result_url: jobId ? `/jobs/${jobId}/result` : null,
      readback_url: `/admin/release-operations/${operationId}/async-deploy/readback`,
      deduplicated: submission.body?.deduplicated === true,
      secrets_included: false,
    },
  };
}

export async function getAsyncReleaseDeployStatus({ operationId, executionFacade }) {
  const pool = getPool();
  const row = await loadTracking(pool, operationId);
  if (!row) fail("release_async_deploy_not_found", "Async deployment was not found.", 404);
  let job = null;
  if (row.job_id) {
    const jobResult = await executionFacade.getJob(row.job_id);
    job = jobResult.body || null;
  }
  return {
    ok: true,
    operation_id: operationId,
    async_deployment: shape(row),
    job,
    status_url: `/admin/release-operations/${operationId}/async-deploy`,
    readback_url: `/admin/release-operations/${operationId}/async-deploy/readback`,
    secrets_included: false,
  };
}

export async function reconcileAsyncReleaseDeploy({ operationId, executionFacade }) {
  const pool = getPool();
  const row = await loadTracking(pool, operationId);
  if (!row) fail("release_async_deploy_not_found", "Async deployment was not found.", 404);
  let job = null;
  if (row.job_id) {
    const jobResult = await executionFacade.getJob(row.job_id);
    job = jobResult.body || null;
  }
  if (!row.deployment_run_id) {
    return { ok: true, operation_id: operationId, async_deployment: shape(row), job, readback: null, secrets_included: false };
  }

  const deployment = await readHostingerSshDeployRunStatus({ deployment_run_id: row.deployment_run_id });
  const resultJson = json(row.result_json, {});
  const filesUpdated = resultJson?.reload_verification?.files_updated === true || resultJson?.deployment?.reload_verification?.files_updated === true;
  const classification = classifyAsyncDeployReadback({ deployment, filesUpdated });
  const operationDetail = await getReleaseOperation(operationId);
  const currentStatus = operationDetail.operation.current_status;

  if (classification.status === "verified") {
    if (currentStatus === "restart_in_progress") {
      await appendReleaseOperationStep(operationId, {
        step_key: "async_deploy_readback_pending",
        step_order: 140,
        attempt_number: 1,
        step_status: "completed",
        operation_status: "readback_pending",
        classification: "readback_pending",
        idempotency_key: `${row.async_deployment_id}:readback_pending`,
        detail: { deployment_run_id: row.deployment_run_id, secrets_included: false },
      });
    }
    await finalizeReleaseOperation(operationId, {
      final_status: "verified",
      final_classification: "async_deploy_verified",
      deployed_commit_sha: deployment.deployed_commit_sha,
      runtime_verification_run_id: deployment.runtime_parity?.latest_run_id,
      detail: { async_deployment_id: row.async_deployment_id, deployment, secrets_included: false },
      rollback_plan: { required: false },
    });
  } else if (["rollback_required", "failed_execution", "degraded", "readback_pending"].includes(classification.status)) {
    await appendReleaseOperationStep(operationId, {
      step_key: `async_deploy_readback_${classification.status}`,
      step_order: 140,
      attempt_number: 1,
      step_status: classification.status === "failed_execution" ? "failed" : "completed",
      operation_status: classification.operation_status,
      classification: classification.status,
      idempotency_key: `${row.async_deployment_id}:readback:${classification.status}`,
      detail: { deployment_run_id: row.deployment_run_id, deployment, secrets_included: false },
      error: classification.status === "failed_execution" ? { code: deployment.failure_reason || "async_deploy_failed" } : undefined,
    });
  }

  await pool.query(
    `UPDATE release_async_deployments
        SET status = ?, last_readback_at = NOW(3), result_json = ?,
            completed_at = CASE WHEN ? = 1 THEN NOW(3) ELSE completed_at END,
            updated_at = NOW(3)
      WHERE async_deployment_id = ?`,
    [classification.status, JSON.stringify({ ...(resultJson || {}), readback: deployment, secrets_included: false }), classification.terminal ? 1 : 0, row.async_deployment_id],
  );
  return {
    ok: true,
    operation_id: operationId,
    async_deployment: shape(await loadTracking(pool, operationId)),
    job,
    readback: deployment,
    classification,
    secrets_included: false,
  };
}
