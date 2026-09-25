import { createHash } from "node:crypto";

const SHA40_RE = /^[0-9a-f]{40}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9._:-]{8,220}$/u;
const RUN_CONTRACT = "mad4b.platform-recovery-convergence-run.v1";
const PLAN_CONTRACT = "mad4b.platform-recovery-convergence-plan.v1";
const EVENT_CONTRACT = "mad4b.platform-recovery-convergence-event.v1";

export const PLATFORM_RECOVERY_CONVERGENCE_CAPABILITY = "platform_recovery_converge_v1";

export const PLATFORM_RECOVERY_CONVERGENCE_STEPS = Object.freeze([
  Object.freeze({ key: "production_identity", kind: "read_only" }),
  Object.freeze({ key: "database_full_inspection", kind: "read_only" }),
  Object.freeze({ key: "backup_evidence", kind: "read_only" }),
  Object.freeze({ key: "governance_baseline_rebuild", kind: "consequential", role: "governance", conditional_zero_object: true, authority_ref: "governance.baseline.rebuild_empty", nested_operation: "database.rebuild_empty" }),
  Object.freeze({ key: "governance_baseline_verify", kind: "read_only", role: "governance" }),
  Object.freeze({ key: "runtime_persistence_baseline_rebuild", kind: "consequential", role: "runtime_persistence", conditional_zero_object: true, authority_ref: "runtime_persistence.baseline.rebuild_empty", nested_operation: "database.rebuild_empty" }),
  Object.freeze({ key: "runtime_persistence_baseline_verify", kind: "read_only", role: "runtime_persistence" }),
  Object.freeze({ key: "canonical_grants_apply", kind: "consequential", authority_ref: "runtime_bootstrap_canonical_grant_contract", nested_operation: "apply_grants" }),
  Object.freeze({ key: "canonical_grants_verify", kind: "read_only" }),
  Object.freeze({ key: "bootstrap_ledger_verify", kind: "read_only" }),
  Object.freeze({ key: "mcp_catalog_migration_apply", kind: "consequential", migration: "20260815_custom_gpt_mcp_catalog_levels.sql", authority_ref: "governance.mcp_catalog.repair", nested_operation: "apply_migration" }),
  Object.freeze({ key: "mcp_catalog_verify", kind: "read_only" }),
  Object.freeze({ key: "response_chunk_storage_smoke", kind: "bounded_mutation", authority_ref: "response_chunk_durable_recovery_smoke", nested_operation: "execute_smoke" }),
  Object.freeze({ key: "admin_tools_functional_readback", kind: "read_only" }),
  Object.freeze({ key: "device_tools_functional_readback", kind: "read_only" }),
  Object.freeze({ key: "production_activation_readiness", kind: "read_only" }),
  Object.freeze({ key: "connector_auth_probe", kind: "read_only" }),
  Object.freeze({ key: "local_manager_rate_limit_recovery", kind: "read_only", conditional_rate_limit: true }),
  Object.freeze({ key: "connector_two_phase_rebind", kind: "consequential", conditional_credential_invalid: true, authority_ref: "local_connector_two_phase_rebind", nested_operation: "credential_rebind" }),
  Object.freeze({ key: "connector_auth_verify", kind: "read_only" }),
  Object.freeze({ key: "local_manager_e2e_round_trip", kind: "bounded_mutation", authority_ref: "local_manager_desktop_command_round_trip", nested_operation: "create_claim_complete" }),
  Object.freeze({ key: "deployment_parity", kind: "read_only" }),
  Object.freeze({ key: "final_gate", kind: "derived" }),
]);

const TERMINAL_FAILURE_STATES = new Set(["blocked", "failed", "unknown_outcome"]);
const EXECUTOR_STATES = new Set(["pass", "blocked", "failed", "awaiting_approval", "unknown_outcome", "degraded"]);
const COMPLETED_STATES = new Set(["pass", "skipped_not_required"]);
const REQUIRED_STORE_METHODS = Object.freeze([
  "putRun",
  "getRun",
  "getRunByIdempotency",
  "appendEvidenceEvent",
  "putIdempotencyReceipt",
]);

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function stableJson(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function hash(value) {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

function fail(code, message, status = 409, details = {}) {
  throw Object.assign(new Error(message), {
    code,
    status,
    details: { ...details, secrets_included: false },
  });
}

function requireSha(value) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA40_RE.test(normalized)) fail("PLATFORM_RECOVERY_SHA_INVALID", "expected_sha must be a full 40-character commit SHA.", 400);
  return normalized;
}

function assertStore(store) {
  for (const method of REQUIRED_STORE_METHODS) {
    if (typeof store?.[method] !== "function") {
      fail("PLATFORM_RECOVERY_DURABLE_STORE_UNAVAILABLE", `Recovery store is missing required method ${method}.`, 503);
    }
  }
  if (store.independent_of_target_databases === false) {
    fail("PLATFORM_RECOVERY_STORE_NOT_INDEPENDENT", "Recovery convergence store must remain independent of target databases.", 503);
  }
}

function isMutationStep(step) {
  return ["consequential", "bounded_mutation"].includes(step?.kind);
}

async function resolveStepAuthority(run, step, approvalResolver) {
  if (!isMutationStep(step)) return { ready: true, approval: null };
  if (typeof approvalResolver !== "function") {
    return {
      ready: false,
      error_code: "platform_recovery_step_approval_required",
      next_safe_action: "obtain_server_verified_step_bound_approval",
    };
  }

  let raw;
  try {
    raw = await approvalResolver(Object.freeze({
      expected_sha: run.expected_sha,
      target_key: run.target_key,
      run_id: run.run_id,
      plan_hash: run.plan_hash,
      step_id: step.step_id,
      step_key: step.key,
      step_kind: step.kind,
      authority_ref: step.authority_ref || null,
      nested_operation: step.nested_operation || null,
      idempotency_key: step.idempotency_key,
      secrets_included: false,
    }));
  } catch (error) {
    fail(
      "PLATFORM_RECOVERY_APPROVAL_RESOLUTION_FAILED",
      "Server-side step approval resolution failed closed.",
      Number(error?.status) || 503,
      { step_key: step.key, error_code: text(error?.code || "approval_resolution_failed", 160) },
    );
  }

  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const bindings = [
    ["expected_sha", run.expected_sha],
    ["run_id", run.run_id],
    ["plan_hash", run.plan_hash],
    ["step_id", step.step_id],
    ["authority_ref", step.authority_ref],
    ["nested_operation", step.nested_operation],
    ["idempotency_key", step.idempotency_key],
  ];
  const bindingMismatch = bindings.find(([key, expected]) => text(value[key], 256).toLowerCase() !== String(expected).toLowerCase());
  if (
    value.verified !== true
    || value.secrets_included !== false
    || value.single_use !== true
    || bindingMismatch
    || !SAFE_ID_RE.test(text(value.approval_id, 220))
  ) {
    fail(
      "PLATFORM_RECOVERY_APPROVAL_BINDING_INVALID",
      "Server-resolved approval is not verified and bound to the exact recovery step.",
      409,
      { step_key: step.key, binding: bindingMismatch?.[0] || null },
    );
  }

  return {
    ready: true,
    approval: Object.freeze({
      approval_id: text(value.approval_id, 220),
      expected_sha: run.expected_sha,
      run_id: run.run_id,
      plan_hash: run.plan_hash,
      step_id: step.step_id,
      authority_ref: step.authority_ref,
      nested_operation: step.nested_operation || null,
      idempotency_key: step.idempotency_key,
      single_use: true,
      server_verified: true,
      secrets_included: false,
    }),
  };
}

export function buildPlatformRecoveryConvergencePlan(expectedSha) {
  const expected = requireSha(expectedSha);
  const base = {
    contract: PLAN_CONTRACT,
    version: 1,
    expected_sha: expected,
    target_key: "production-runtime",
    steps: PLATFORM_RECOVERY_CONVERGENCE_STEPS.map((step, index) => ({
      order: index + 1,
      step_id: `platform-recovery:${String(index + 1).padStart(2, "0")}:${step.key}`,
      key: step.key,
      kind: step.kind,
      role: step.role || null,
      migration: step.migration || null,
      authority_ref: step.authority_ref || null,
      nested_operation: step.nested_operation || null,
      nested_authority_required: ["consequential", "bounded_mutation"].includes(step.kind),
      caller_sql_forbidden: true,
      caller_credentials_forbidden: true,
      caller_database_selection_forbidden: true,
      secrets_included: false,
    })),
    automatic_retry_after_unknown_outcome: false,
    ordinary_migration_before_baseline_forbidden: true,
    runtime_role_baseline_rebuild_by_this_plan: false,
    secrets_included: false,
  };
  return Object.freeze({ ...base, plan_hash: hash(base) });
}

function createStepState(planStep, runId, planHash) {
  return {
    ...planStep,
    run_id: runId,
    plan_hash: planHash,
    idempotency_key: `platform-recovery-step:${planHash.slice(0, 20)}:${planStep.order}`,
    status: "pending",
    attempts: 0,
    result: null,
    request_id: null,
    error_code: null,
    secrets_included: false,
  };
}

function runIdFor(plan) {
  return `run:platform-recovery:${plan.expected_sha.slice(0, 12)}:${plan.plan_hash.slice(0, 16)}`;
}

function runIdempotencyFor(plan) {
  return `platform-recovery:${plan.expected_sha}:${plan.plan_hash}`;
}

async function persistRun(store, run) {
  await store.putRun(clone(run));
}

async function appendEvent(store, run, step, eventType, details = {}) {
  await store.appendEvidenceEvent(run.run_id, {
    contract: EVENT_CONTRACT,
    event_type: eventType,
    run_id: run.run_id,
    plan_hash: run.plan_hash,
    step_id: step?.step_id || null,
    step_key: step?.key || null,
    step_idempotency_key: step?.idempotency_key || null,
    details: { ...details, secrets_included: false },
    secrets_included: false,
  });
}

async function loadExistingRun({ expectedSha, runId, recoveryStore }) {
  assertStore(recoveryStore);
  const plan = buildPlatformRecoveryConvergencePlan(expectedSha);
  const normalized = text(runId, 220);
  if (!normalized || !SAFE_ID_RE.test(normalized)) {
    fail("PLATFORM_RECOVERY_RUN_ID_REQUIRED", "run_id is required for status or reconciliation.", 400);
  }
  const run = await recoveryStore.getRun(normalized);
  if (!run) fail("PLATFORM_RECOVERY_RUN_NOT_FOUND", "Requested convergence run was not found.", 404);
  if (run.expected_sha !== plan.expected_sha || run.plan_hash !== plan.plan_hash) {
    fail("PLATFORM_RECOVERY_RUN_BINDING_MISMATCH", "Existing run is not bound to the requested exact SHA and plan.", 409);
  }
  return { run, plan };
}

async function loadOrCreateRun({ expectedSha, runId = null, recoveryStore }) {
  assertStore(recoveryStore);
  const plan = buildPlatformRecoveryConvergencePlan(expectedSha);
  const expectedRunId = runIdFor(plan);
  const runIdempotencyKey = runIdempotencyFor(plan);

  if (runId) {
    const normalized = text(runId, 220);
    if (!SAFE_ID_RE.test(normalized)) fail("PLATFORM_RECOVERY_RUN_ID_INVALID", "run_id is invalid.", 400);
    const existing = await recoveryStore.getRun(normalized);
    if (!existing) fail("PLATFORM_RECOVERY_RUN_NOT_FOUND", "Requested convergence run was not found.", 404);
    if (existing.expected_sha !== plan.expected_sha || existing.plan_hash !== plan.plan_hash) {
      fail("PLATFORM_RECOVERY_RUN_BINDING_MISMATCH", "Existing run is not bound to the requested exact SHA and plan.", 409);
    }
    return { run: existing, plan, created: false };
  }

  const byIdempotency = await recoveryStore.getRunByIdempotency(runIdempotencyKey);
  if (byIdempotency) {
    if (byIdempotency.expected_sha !== plan.expected_sha || byIdempotency.plan_hash !== plan.plan_hash) {
      fail("PLATFORM_RECOVERY_IDEMPOTENCY_COLLISION", "Recovery idempotency key is already bound to different evidence.", 409);
    }
    return { run: byIdempotency, plan, created: false };
  }

  const run = {
    contract: RUN_CONTRACT,
    run_id: expectedRunId,
    idempotency_key: runIdempotencyKey,
    expected_sha: plan.expected_sha,
    plan_hash: plan.plan_hash,
    target_key: plan.target_key,
    status: "pending",
    blocking_stage: null,
    error_code: null,
    request_id: null,
    next_safe_action: "advance_same_run",
    current_step_id: plan.steps[0]?.step_id || null,
    steps: plan.steps.map((step) => createStepState(step, expectedRunId, plan.plan_hash)),
    active: false,
    automatic_retry_allowed: false,
    database_names_caller_selectable: false,
    raw_sql_allowed: false,
    credentials_caller_selectable: false,
    secrets_included: false,
  };
  await persistRun(recoveryStore, run);
  await recoveryStore.putIdempotencyReceipt(runIdempotencyKey, {
    contract: "mad4b.platform-recovery-convergence-idempotency.v1",
    run_id: run.run_id,
    expected_sha: run.expected_sha,
    plan_hash: run.plan_hash,
    status: "created",
    secrets_included: false,
  });
  await appendEvent(recoveryStore, run, null, "run_created", { expected_sha: run.expected_sha });
  return { run, plan, created: true };
}

function findStep(run, key) {
  return run.steps.find((step) => step.key === key) || null;
}

function priorResult(run, key) {
  return findStep(run, key)?.result || null;
}

function markSkipped(step, reason) {
  step.status = "skipped_not_required";
  step.result = {
    ok: true,
    status: "skipped_not_required",
    reason,
    mutation_performed: false,
    readback_verified: true,
    secrets_included: false,
  };
}

function shouldSkip(run, step) {
  if (step.key === "governance_baseline_rebuild" || step.key === "runtime_persistence_baseline_rebuild") {
    const inspection = priorResult(run, "database_full_inspection");
    const role = step.role;
    const zeroObject = inspection?.roles?.[role]?.zero_object === true;
    if (!zeroObject) return "role_not_zero_object";
  }

  if (step.key === "local_manager_rate_limit_recovery") {
    const probe = priorResult(run, "connector_auth_probe");
    const failureKind = text(probe?.failure_kind, 96);
    if (!["rate_limited", "edge_rate_limited", "proxy_rate_limited"].includes(failureKind)) return "no_rate_limit_observed";
  }

  if (step.key === "connector_two_phase_rebind") {
    const probe = priorResult(run, "connector_auth_probe");
    const rate = priorResult(run, "local_manager_rate_limit_recovery");
    const failureKind = text(rate?.post_recovery_auth_failure_kind || probe?.failure_kind, 96);
    if (probe?.auth_ready === true) return "connector_already_authenticated";
    if (failureKind !== "credential_invalid") return "credential_rebind_not_indicated";
  }

  return null;
}

function validateBoundResult(run, step, result) {
  const value = result && typeof result === "object" && !Array.isArray(result) ? result : {};
  const status = text(value.status || (value.ok === true ? "pass" : ""), 64);
  if (!EXECUTOR_STATES.has(status)) fail("PLATFORM_RECOVERY_STEP_RESULT_INVALID", `Invalid result state for ${step.key}.`, 502);

  if (value.secrets_included !== false) {
    fail("PLATFORM_RECOVERY_STEP_SECRET_BOUNDARY_INVALID", `Step ${step.key} did not prove secrets_included=false.`, 502);
  }

  if (status === "pass") {
    if (text(value.expected_sha, 64).toLowerCase() !== run.expected_sha) fail("PLATFORM_RECOVERY_STEP_SHA_MISMATCH", `Step ${step.key} returned the wrong SHA.`, 502);
    if (text(value.run_id, 220) !== run.run_id) fail("PLATFORM_RECOVERY_STEP_RUN_MISMATCH", `Step ${step.key} returned the wrong run_id.`, 502);
    if (text(value.plan_hash, 128).toLowerCase() !== run.plan_hash) fail("PLATFORM_RECOVERY_STEP_PLAN_MISMATCH", `Step ${step.key} returned the wrong plan_hash.`, 502);
    if (text(value.step_id, 220) !== step.step_id) fail("PLATFORM_RECOVERY_STEP_ID_MISMATCH", `Step ${step.key} returned the wrong step_id.`, 502);
    if (text(value.idempotency_key, 256) !== step.idempotency_key) fail("PLATFORM_RECOVERY_STEP_IDEMPOTENCY_MISMATCH", `Step ${step.key} returned the wrong idempotency key.`, 502);

    if (["consequential", "bounded_mutation"].includes(step.kind)) {
      if (value.authority_verified !== true) fail("PLATFORM_RECOVERY_STEP_AUTHORITY_UNVERIFIED", `Step ${step.key} did not verify nested execution authority.`, 502);
      if (text(value.authority_ref, 256) !== text(step.authority_ref, 256)) fail("PLATFORM_RECOVERY_STEP_AUTHORITY_REF_MISMATCH", `Step ${step.key} used a different nested authority.`, 502);
      if (text(value.nested_operation, 128) !== text(step.nested_operation, 128)) fail("PLATFORM_RECOVERY_STEP_OPERATION_MISMATCH", `Step ${step.key} used a different nested operation.`, 502);
      if (value.readback_verified !== true) fail("PLATFORM_RECOVERY_STEP_READBACK_UNVERIFIED", `Step ${step.key} did not complete same-cycle readback.`, 502);
    }
  }

  if (step.key === "production_identity" && status === "pass") {
    if (value.exact_sha_parity !== true) {
      fail("PLATFORM_RECOVERY_IDENTITY_PARITY_UNVERIFIED", "Production identity step did not prove exact SHA parity.", 502);
    }
    if (value.version_readback !== true || value.deployment_info_readback !== true) {
      fail("PLATFORM_RECOVERY_IDENTITY_HTTP_READBACK_INCOMPLETE", "Production identity did not prove version and deployment-info readback.", 502);
    }
  }

  if (step.key === "backup_evidence" && status === "pass") {
    const roles = Array.isArray(value.roles) ? value.roles : [];
    for (const role of ["runtime", "governance", "runtime_persistence"]) {
      if (!roles.includes(role)) fail("PLATFORM_RECOVERY_BACKUP_ROLE_MISSING", `Backup evidence is missing role ${role}.`, 502);
    }
    if (value.backup_verified !== true) fail("PLATFORM_RECOVERY_BACKUP_UNVERIFIED", "Backup evidence was not verified.", 502);
  }

  if (step.key === "database_full_inspection" && status === "pass") {
    for (const role of ["runtime", "governance", "runtime_persistence"]) {
      if (typeof value.roles?.[role]?.zero_object !== "boolean") {
        fail("PLATFORM_RECOVERY_INSPECTION_ROLE_INVALID", `Full inspection is missing zero_object evidence for ${role}.`, 502);
      }
    }
    if (value.durable !== true) fail("PLATFORM_RECOVERY_INSPECTION_NOT_DURABLE", "Full inspection evidence is not durable.", 502);
  }

  if (step.key.endsWith("_baseline_verify") && status === "pass" && value.baseline_ready !== true) {
    fail("PLATFORM_RECOVERY_BASELINE_NOT_READY", `Step ${step.key} did not prove baseline readiness.`, 502);
  }

  if (step.key === "canonical_grants_verify" && status === "pass" && value.grants_ready !== true) {
    fail("PLATFORM_RECOVERY_GRANTS_NOT_READY", "Canonical grants readback did not pass.", 502);
  }

  if (step.key === "bootstrap_ledger_verify" && status === "pass" && value.bootstrap_ledger_ready !== true) {
    fail("PLATFORM_RECOVERY_BOOTSTRAP_LEDGER_NOT_READY", "Bootstrap ledger readiness did not pass.", 502);
  }

  if (step.key === "mcp_catalog_verify" && status === "pass" && value.mcp_catalog_level_ready !== true) {
    fail("PLATFORM_RECOVERY_MCP_CATALOG_NOT_READY", "MCP catalog schema/readback is not ready.", 502);
  }

  if (step.key === "response_chunk_storage_smoke" && status === "pass" && value.write_read_verified !== true) {
    fail("PLATFORM_RECOVERY_RESPONSE_CHUNK_SMOKE_FAILED", "Response chunk write/read smoke did not verify.", 502);
  }

  if (step.key === "admin_tools_functional_readback" && status === "pass") {
    if (value.listAdminTools !== true || value.repo_inspect !== true || value.schema_contract_not_ready === true) {
      fail("PLATFORM_RECOVERY_ADMIN_TOOLS_READBACK_FAILED", "Admin tool functional readback did not pass.", 502);
    }
  }

  if (step.key === "device_tools_functional_readback" && status === "pass") {
    if (value.listDeviceTools !== true || value.schema_contract_not_ready === true) {
      fail("PLATFORM_RECOVERY_DEVICE_TOOLS_READBACK_FAILED", "Device tool functional readback did not pass.", 502);
    }
  }

  if (step.key === "production_activation_readiness" && status === "pass" && value.ready !== true) {
    fail("PLATFORM_RECOVERY_ACTIVATION_NOT_READY", "Production activation readiness did not pass.", 502);
  }

  if (step.key === "local_manager_rate_limit_recovery" && status === "pass") {
    for (const flag of ["http_status_checked_before_json", "retry_after_respected", "backoff_persisted", "rate_limit_source_attributed"]) {
      if (value[flag] !== true) fail("PLATFORM_RECOVERY_RATE_LIMIT_CONTRACT_INCOMPLETE", `Rate-limit recovery did not prove ${flag}.`, 502);
    }
  }

  if (step.key === "connector_two_phase_rebind" && status === "pass") {
    const required = [
      "fresh_device_authorization_verified",
      "pending_credential_created",
      "local_atomic_install_verified",
      "new_credential_probe_verified",
      "old_credential_revoked_after_probe",
    ];
    for (const flag of required) if (value[flag] !== true) fail("PLATFORM_RECOVERY_CONNECTOR_REBIND_INCOMPLETE", `Connector two-phase rebind did not prove ${flag}.`, 502);
    if (value.old_credential_revoked_before_probe === true) fail("PLATFORM_RECOVERY_CONNECTOR_REBIND_ORDER_INVALID", "Old credential was revoked before the new credential probe.", 502);
    if (value.credential_material_returned_to_orchestrator === true) fail("PLATFORM_RECOVERY_CONNECTOR_SECRET_EXPOSED", "Connector credential material must not be returned to the orchestrator.", 502);
  }

  if (step.key === "connector_auth_verify" && status === "pass") {
    if (Number(value.authenticated_operation_http_status) !== 200 || value.auth_ready !== true) {
      fail("PLATFORM_RECOVERY_CONNECTOR_AUTH_UNVERIFIED", "Authenticated connector operation did not return 200.", 502);
    }
  }

  if (step.key === "local_manager_e2e_round_trip" && status === "pass") {
    if (value.command_created !== true || value.command_claimed !== true || value.command_completed !== true) {
      fail("PLATFORM_RECOVERY_LOCAL_MANAGER_E2E_FAILED", "Local Manager create→claim→complete round-trip did not verify.", 502);
    }
  }

  if (step.key === "deployment_parity" && status === "pass" && value.exact_sha_parity !== true) {
    fail("PLATFORM_RECOVERY_DEPLOYMENT_PARITY_FAILED", "Final deployment parity did not match the expected SHA.", 502);
  }

  return { ...clone(value), status, secrets_included: false };
}

function resultToRunState(result) {
  if (result.status === "awaiting_approval") return {
    status: "awaiting_approval",
    next_safe_action: "provide_step_bound_approval_and_resume_same_run",
  };
  if (result.status === "unknown_outcome") return {
    status: "unknown_outcome",
    next_safe_action: "reconcile_same_operation_before_retry",
  };
  if (result.status === "degraded") return {
    status: "degraded",
    next_safe_action: result.next_safe_action || "resolve_degraded_stage_and_resume_same_run",
  };
  return {
    status: "blocked",
    next_safe_action: result.next_safe_action || "resolve_blocking_stage_and_resume_same_run",
  };
}

function executorFor(executors, key, mode = "execute") {
  const value = executors?.[key];
  if (typeof value === "function") return mode === "execute" ? value : null;
  if (value && typeof value === "object" && typeof value[mode] === "function") return value[mode];
  return null;
}

async function verifyPreMutationDeploymentParity(run, step, executors) {
  if (!isMutationStep(step)) return { ready: true };
  const reader = executorFor(executors, "deployment_parity", "execute");
  if (!reader) {
    return {
      ready: false,
      error_code: "platform_recovery_pre_mutation_parity_unavailable",
      next_safe_action: "restore_exact_production_sha_parity_reader",
    };
  }
  const result = await reader(Object.freeze({
    expected_sha: run.expected_sha,
    target_key: run.target_key,
    run_id: run.run_id,
    plan_hash: run.plan_hash,
    step_id: step.step_id,
    step_key: step.key,
    step_kind: step.kind,
    role: step.role || null,
    migration: step.migration || null,
    idempotency_key: step.idempotency_key,
    prior_steps: run.steps
      .filter((candidate) => candidate.order < step.order)
      .map((candidate) => ({ key: candidate.key, status: candidate.status, result: candidate.result })),
    secrets_included: false,
  }));
  const ready = result?.status === "pass"
    && result?.exact_sha_parity === true
    && result?.mutation_performed !== true
    && result?.secrets_included === false;
  return ready
    ? { ready: true }
    : {
        ready: false,
        error_code: "platform_recovery_pre_mutation_parity_failed",
        next_safe_action: "restore_exact_production_sha_parity_before_mutation",
        request_id: text(result?.request_id, 160) || null,
      };
}

function summarize(run) {
  return {
    ok: run.status === "active",
    contract: RUN_CONTRACT,
    run_id: run.run_id,
    expected_sha: run.expected_sha,
    plan_hash: run.plan_hash,
    status: run.status,
    active: run.active === true,
    blocking_stage: run.blocking_stage,
    error_code: run.error_code,
    request_id: run.request_id,
    next_safe_action: run.next_safe_action,
    steps: run.steps.map((step) => ({
      order: step.order,
      step_id: step.step_id,
      key: step.key,
      kind: step.kind,
      role: step.role,
      migration: step.migration,
      idempotency_key: step.idempotency_key,
      status: step.status,
      attempts: step.attempts,
      request_id: step.request_id,
      error_code: step.error_code,
      result: step.result ? clone(step.result) : null,
      secrets_included: false,
    })),
    automatic_retry_allowed: false,
    database_names_caller_selectable: false,
    raw_sql_allowed: false,
    credentials_caller_selectable: false,
    secrets_included: false,
  };
}

async function executeOneStep(run, step, { recoveryStore, executors, approvalResolver }) {
  const skipReason = shouldSkip(run, step);
  if (skipReason) {
    markSkipped(step, skipReason);
    await appendEvent(recoveryStore, run, step, "step_skipped", { reason: skipReason });
    await persistRun(recoveryStore, run);
    return { continue: true };
  }

  const preMutationParity = await verifyPreMutationDeploymentParity(run, step, executors);
  if (!preMutationParity.ready) {
    step.status = "blocked";
    step.error_code = preMutationParity.error_code;
    step.request_id = preMutationParity.request_id || null;
    step.result = {
      ok: false,
      status: "blocked",
      error_code: preMutationParity.error_code,
      request_id: step.request_id,
      next_safe_action: preMutationParity.next_safe_action,
      mutation_performed: false,
      readback_verified: false,
      secrets_included: false,
    };
    run.status = "blocked";
    run.active = false;
    run.blocking_stage = step.key;
    run.error_code = preMutationParity.error_code;
    run.request_id = step.request_id;
    run.next_safe_action = preMutationParity.next_safe_action;
    await appendEvent(recoveryStore, run, step, "step_blocked_pre_mutation_parity", {
      error_code: step.error_code,
      request_id: step.request_id,
    });
    await persistRun(recoveryStore, run);
    return { continue: false };
  }

  const authority = await resolveStepAuthority(run, step, approvalResolver);
  if (!authority.ready) {
    step.status = "awaiting_approval";
    step.error_code = authority.error_code;
    step.result = {
      ok: false,
      status: "awaiting_approval",
      error_code: authority.error_code,
      next_safe_action: authority.next_safe_action,
      mutation_performed: false,
      secrets_included: false,
    };
    run.status = "awaiting_approval";
    run.active = false;
    run.blocking_stage = step.key;
    run.error_code = authority.error_code;
    run.next_safe_action = authority.next_safe_action;
    await appendEvent(recoveryStore, run, step, "step_waiting_for_approval", { error_code: authority.error_code });
    await persistRun(recoveryStore, run);
    return { continue: false };
  }

  const execute = executorFor(executors, step.key, "execute");
  if (!execute) {
    step.status = "awaiting_approval";
    step.error_code = "platform_recovery_stage_executor_unavailable";
    step.result = {
      ok: false,
      status: "awaiting_approval",
      error_code: step.error_code,
      next_safe_action: "configure_or_authorize_nested_stage_executor",
      mutation_performed: false,
      secrets_included: false,
    };
    run.status = "awaiting_approval";
    run.blocking_stage = step.key;
    run.error_code = step.error_code;
    run.next_safe_action = "configure_or_authorize_nested_stage_executor";
    await appendEvent(recoveryStore, run, step, "step_waiting_for_authority", { error_code: step.error_code });
    await persistRun(recoveryStore, run);
    return { continue: false };
  }

  step.status = "executing";
  step.attempts += 1;
  run.status = "running";
  run.current_step_id = step.step_id;
  await appendEvent(recoveryStore, run, step, "step_started", { attempt: step.attempts });
  await persistRun(recoveryStore, run);

  let rawResult;
  try {
    rawResult = await execute(Object.freeze({
      expected_sha: run.expected_sha,
      target_key: run.target_key,
      run_id: run.run_id,
      plan_hash: run.plan_hash,
      step_id: step.step_id,
      step_key: step.key,
      step_kind: step.kind,
      role: step.role || null,
      migration: step.migration || null,
      authority_ref: step.authority_ref || null,
      nested_operation: step.nested_operation || null,
      idempotency_key: step.idempotency_key,
      approval: authority.approval,
      prior_steps: run.steps
        .filter((candidate) => candidate.order < step.order)
        .map((candidate) => ({ key: candidate.key, status: candidate.status, result: candidate.result })),
      secrets_included: false,
    }));
  } catch (error) {
    rawResult = {
      ok: false,
      status: error?.unknown_outcome === true ? "unknown_outcome" : "blocked",
      error_code: text(error?.code || "platform_recovery_stage_failed", 160),
      request_id: text(error?.request_id || error?.details?.request_id, 160) || null,
      next_safe_action: error?.unknown_outcome === true ? "reconcile_same_operation_before_retry" : "resolve_blocking_stage_and_resume_same_run",
      mutation_performed: error?.mutation_performed === true,
      secrets_included: false,
    };
  }

  const result = validateBoundResult(run, step, rawResult);
  step.result = result;
  step.status = result.status;
  step.request_id = text(result.request_id, 160) || null;
  step.error_code = text(result.error_code, 160) || null;
  await appendEvent(recoveryStore, run, step, `step_${result.status}`, {
    request_id: step.request_id,
    error_code: step.error_code,
    mutation_performed: result.mutation_performed === true,
    readback_verified: result.readback_verified === true,
  });

  if (result.status !== "pass") {
    const mapped = resultToRunState(result);
    run.status = mapped.status;
    run.active = false;
    run.blocking_stage = step.key;
    run.error_code = step.error_code || `platform_recovery_${step.key}_${result.status}`;
    run.request_id = step.request_id;
    run.next_safe_action = mapped.next_safe_action;
    await persistRun(recoveryStore, run);
    return { continue: false };
  }

  step.status = "pass";
  run.blocking_stage = null;
  run.error_code = null;
  run.request_id = null;
  run.next_safe_action = "advance_same_run";
  await persistRun(recoveryStore, run);
  return { continue: true, consequential_executed: isMutationStep(step) };
}

async function reconcileUnknownStep(run, { recoveryStore, executors }) {
  const step = run.steps.find((candidate) => candidate.status === "unknown_outcome");
  if (!step) fail("PLATFORM_RECOVERY_RECONCILIATION_NOT_REQUIRED", "No unknown outcome requires reconciliation.", 409);
  const reconcile = executorFor(executors, step.key, "reconcile");
  if (!reconcile) fail("PLATFORM_RECOVERY_RECONCILER_UNAVAILABLE", `No reconciliation adapter is available for ${step.key}.`, 503);

  await appendEvent(recoveryStore, run, step, "reconciliation_started", {});
  const raw = await reconcile(Object.freeze({
    expected_sha: run.expected_sha,
    target_key: run.target_key,
    run_id: run.run_id,
    plan_hash: run.plan_hash,
    step_id: step.step_id,
    step_key: step.key,
    authority_ref: step.authority_ref || null,
    nested_operation: step.nested_operation || null,
    idempotency_key: step.idempotency_key,
    original_result: clone(step.result),
    secrets_included: false,
  }));
  const result = validateBoundResult(run, step, raw);
  if (result.mutation_performed === true) {
    fail(
      "PLATFORM_RECOVERY_RECONCILIATION_MUTATION_FORBIDDEN",
      "Unknown-outcome reconciliation must be readback-only and may not perform a second mutation.",
      409,
      { step_key: step.key },
    );
  }
  if (result.status === "unknown_outcome") {
    step.result = result;
    run.status = "unknown_outcome";
    run.blocking_stage = step.key;
    run.next_safe_action = "reconcile_same_operation_before_retry";
  } else if (result.status === "pass") {
    step.status = "pass";
    step.result = result;
    step.error_code = null;
    step.request_id = text(result.request_id, 160) || null;
    run.status = "pending";
    run.blocking_stage = null;
    run.error_code = null;
    run.request_id = null;
    run.next_safe_action = "advance_same_run";
  } else {
    step.status = result.status;
    step.result = result;
    run.status = result.status === "degraded" ? "degraded" : "blocked";
    run.blocking_stage = step.key;
    run.error_code = text(result.error_code, 160) || `platform_recovery_${step.key}_reconciliation_failed`;
    run.next_safe_action = result.next_safe_action || "resolve_reconciliation_failure";
  }
  await appendEvent(recoveryStore, run, step, `reconciliation_${result.status}`, {
    error_code: run.error_code,
    request_id: run.request_id,
  });
  await persistRun(recoveryStore, run);
  return summarize(run);
}

export async function runPlatformRecoveryConvergence(input = {}, deps = {}) {
  const allowed = new Set(["expected_sha", "run_id", "action"]);
  const unexpected = Object.keys(input || {}).filter((key) => !allowed.has(key));
  if (unexpected.length) fail("PLATFORM_RECOVERY_INPUT_FIELD_FORBIDDEN", "Unsupported convergence input fields.", 400, { fields: unexpected });

  const expectedSha = requireSha(input.expected_sha);
  const action = text(input.action || "advance", 32).toLowerCase();
  if (!["advance", "status", "reconcile"].includes(action)) fail("PLATFORM_RECOVERY_ACTION_INVALID", "action must be advance, status, or reconcile.", 400);

  const loaded = action === "advance"
    ? await loadOrCreateRun({ expectedSha, runId: input.run_id || null, recoveryStore: deps.recoveryStore })
    : await loadExistingRun({ expectedSha, runId: input.run_id, recoveryStore: deps.recoveryStore });
  const { run } = loaded;

  if (action === "status") return summarize(run);
  if (action === "reconcile") return reconcileUnknownStep(run, {
    recoveryStore: deps.recoveryStore,
    executors: deps.executors || {},
  });

  if (run.status === "unknown_outcome") {
    run.next_safe_action = "reconcile_same_operation_before_retry";
    return summarize(run);
  }
  if (run.status === "active") return summarize(run);

  run.status = "running";
  run.next_safe_action = "advance_same_run";
  await persistRun(deps.recoveryStore, run);

  for (const step of run.steps) {
    if (COMPLETED_STATES.has(step.status)) continue;
    if (step.key === "final_gate") {
      const incomplete = run.steps.filter((candidate) => candidate.key !== "final_gate" && !COMPLETED_STATES.has(candidate.status));
      if (incomplete.length) {
        run.status = "blocked";
        run.active = false;
        run.blocking_stage = incomplete[0].key;
        run.error_code = "platform_recovery_final_gate_incomplete";
        run.next_safe_action = "resolve_blocking_stage_and_resume_same_run";
        await persistRun(deps.recoveryStore, run);
        return summarize(run);
      }
      step.status = "pass";
      step.result = {
        ok: true,
        status: "pass",
        expected_sha: run.expected_sha,
        run_id: run.run_id,
        plan_hash: run.plan_hash,
        step_id: step.step_id,
        idempotency_key: step.idempotency_key,
        all_gates_passed: true,
        mutation_performed: false,
        readback_verified: true,
        secrets_included: false,
      };
      run.status = "active";
      run.active = true;
      run.blocking_stage = null;
      run.error_code = null;
      run.request_id = null;
      run.next_safe_action = "none";
      await appendEvent(deps.recoveryStore, run, step, "run_activated", { all_gates_passed: true });
      await persistRun(deps.recoveryStore, run);
      await deps.recoveryStore.putIdempotencyReceipt(run.idempotency_key, {
        contract: "mad4b.platform-recovery-convergence-idempotency.v1",
        run_id: run.run_id,
        expected_sha: run.expected_sha,
        plan_hash: run.plan_hash,
        status: "active",
        secrets_included: false,
      });
      return summarize(run);
    }

    const result = await executeOneStep(run, step, {
      recoveryStore: deps.recoveryStore,
      executors: deps.executors || {},
      approvalResolver: deps.approvalResolver,
    });
    if (!result.continue) return summarize(run);
    if (result.consequential_executed) {
      run.status = "pending";
      run.next_safe_action = "advance_same_run";
      await persistRun(deps.recoveryStore, run);
      return summarize(run);
    }
  }

  return summarize(run);
}

export const _testingPlatformRecoveryConvergence = Object.freeze({
  COMPLETED_STATES,
  TERMINAL_FAILURE_STATES,
  buildPlatformRecoveryConvergencePlan,
  shouldSkip,
  validateBoundResult,
});
