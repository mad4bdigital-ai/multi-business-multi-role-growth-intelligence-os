export const HOSTINGER_ASYNC_DEPLOY_JOB_TYPE = "hostinger_ssh_deploy_release_async";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function bool(value) {
  return value === true || ["true", "1", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

export function normalizeHostingerAsyncDeployPayload(input = {}) {
  const dryRun = input.dry_run === undefined ? false : bool(input.dry_run);
  return {
    async_deployment_id: text(input.async_deployment_id || input.asyncDeploymentId, 36),
    operation_id: text(input.operation_id || input.operationId, 36),
    gate_id: text(input.gate_id || input.gateId, 36),
    target_id: text(input.target_id || input.targetId, 36),
    app_key: text(input.app_key || input.appKey || "auth.mad4b.com", 191),
    app_path: text(input.app_path || input.appPath || "/home/u338416126/domains/auth.mad4b.com/nodejs", 1024),
    branch: text(input.branch || "main", 64),
    expected_commit_sha: text(input.expected_commit_sha || input.expectedCommitSha, 40).toLowerCase(),
    capability_envelope_id: text(input.capability_envelope_id || input.capabilityEnvelopeId, 36),
    approval_reason: text(input.approval_reason || input.approvalReason, 1000),
    force_clean: bool(input.force_clean || input.forceClean),
    restart: input.restart === undefined ? true : bool(input.restart),
    dry_run: dryRun,
    timeout_ms: boundedInt(input.timeout_ms || input.timeoutMs, 120000, 1000, 300000),
    ssh_auth_mode: text(input.ssh_auth_mode || input.sshAuthMode || "password", 32),
    ssh_transport_mode: text(input.ssh_transport_mode || input.sshTransportMode || "auto", 32),
    requested_by: text(input.requested_by || input.requestedBy || "gpt_admin", 191),
    worker_job_id: text(input.worker_job_id || input.workerJobId, 191),
    secrets_included: false,
  };
}

export function validateHostingerAsyncDeployPayload(input = {}) {
  const payload = normalizeHostingerAsyncDeployPayload(input);
  const errors = [];
  for (const [field, value] of [
    ["async_deployment_id", payload.async_deployment_id],
    ["operation_id", payload.operation_id],
    ["target_id", payload.target_id],
  ]) {
    if (!UUID_PATTERN.test(value)) errors.push(`${field} must be a UUID.`);
  }
  if (!SHA_PATTERN.test(payload.expected_commit_sha)) errors.push("expected_commit_sha must be a 40-character Git SHA.");
  if (payload.branch !== "main") errors.push("branch must be main.");
  if (!payload.app_path.startsWith("/home/") || payload.app_path.includes("..")) errors.push("app_path must be a safe /home/... path.");
  if (!payload.dry_run) {
    if (!UUID_PATTERN.test(payload.gate_id)) errors.push("gate_id must be a UUID for live deploy.");
    if (!UUID_PATTERN.test(payload.capability_envelope_id)) errors.push("capability_envelope_id must be a UUID for live deploy.");
    if (payload.approval_reason.length < 20) errors.push("approval_reason with at least 20 characters is required for live deploy.");
  }
  return errors;
}

export function classifyAsyncDeployOutcome({ result = null, error = null } = {}) {
  if (error) {
    const status = Number(error.status || error.statusCode || error.http_status || 500);
    if (status === 503) {
      return {
        status: "restart_in_progress",
        operation_status: "restart_in_progress",
        job_success: true,
        terminal: false,
        http_status: 202,
        deployment_run_id: null,
        transient: true,
        reason: error.code || "service_unavailable_during_restart",
        secrets_included: false,
      };
    }
    return {
      status: "failed_execution",
      operation_status: "failed_execution",
      job_success: false,
      terminal: true,
      http_status: status,
      deployment_run_id: null,
      transient: false,
      reason: error.code || "async_deploy_execution_failed",
      secrets_included: false,
    };
  }

  const reload = result?.reload_verification || result?.deploy?.reload_verification || {};
  const deploymentRunId = result?.deployment_run_id || result?.deploymentRunId || null;
  if (result?.dry_run === true) {
    const dryRunPassed = result?.ok !== false;
    return {
      status: dryRunPassed ? "dry_run_complete" : "failed_preflight",
      operation_status: dryRunPassed ? "ready_for_execution" : "failed_preflight",
      job_success: dryRunPassed,
      terminal: true,
      http_status: dryRunPassed ? 200 : Number(result?.http_status || 409),
      deployment_run_id: deploymentRunId,
      transient: false,
      reason: dryRunPassed ? "dry_run_complete" : "dry_run_failed",
      secrets_included: false,
    };
  }
  const filesUpdated = reload.files_updated === true || result?.execution?.files_updated === true;
  if (result?.ok === false) {
    return {
      status: filesUpdated ? "rollback_required" : "failed_execution",
      operation_status: filesUpdated ? "rollback_required" : "failed_execution",
      job_success: false,
      terminal: true,
      http_status: Number(result?.http_status || 500),
      deployment_run_id: deploymentRunId,
      transient: false,
      reason: filesUpdated ? "deploy_failed_after_files_updated" : "deploy_execution_failed",
      secrets_included: false,
    };
  }
  if (Number(result?.http_status) === 503 || result?.deployment_status === "accepted") {
    return {
      status: "restart_in_progress",
      operation_status: "restart_in_progress",
      job_success: true,
      terminal: false,
      http_status: 202,
      deployment_run_id: deploymentRunId,
      transient: true,
      reason: "restart_or_runtime_reload_in_progress",
      secrets_included: false,
    };
  }
  return {
    status: reload.runtime_health_readback_required === true ? "readback_pending" : "readback_pending",
    operation_status: "readback_pending",
    job_success: true,
    terminal: false,
    http_status: 202,
    deployment_run_id: deploymentRunId,
    transient: false,
    reason: reload.runtime_health_readback_required === true ? "runtime_health_readback_required" : "runtime_verification_required",
    secrets_included: false,
  };
}

export function classifyAsyncDeployReadback({ deployment = {}, filesUpdated = false } = {}) {
  if (deployment.deployment_status === "completed" && deployment.runtime_parity?.matches_expected_commit === true) {
    return { status: "verified", operation_status: "verified", terminal: true, secrets_included: false };
  }
  if (deployment.deployment_status === "failed" || deployment.ok === false) {
    return {
      status: filesUpdated ? "rollback_required" : "failed_execution",
      operation_status: filesUpdated ? "rollback_required" : "failed_execution",
      terminal: true,
      secrets_included: false,
    };
  }
  if (deployment.deployment_status === "accepted") {
    return { status: "readback_pending", operation_status: "readback_pending", terminal: false, secrets_included: false };
  }
  return { status: "degraded", operation_status: "degraded", terminal: false, secrets_included: false };
}
