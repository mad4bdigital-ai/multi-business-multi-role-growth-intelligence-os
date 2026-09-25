import { createHash, randomUUID } from "node:crypto";
import {
  evaluateProductionRecoveryClosure,
  PRODUCTION_RECOVERY_BACKUP_EVIDENCE_CONTRACT,
  PRODUCTION_RECOVERY_CLOSURE_EVIDENCE_CONTRACT,
} from "./productionRecoveryClosure.js";
import { assertRecoveryData } from "./recoveryProofBoundary.js";

const SHA40_RE = /^[0-9a-f]{40}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9._:-]{8,220}$/u;
const RUN_CONTRACT = "mad4b.platform-recovery-convergence-run.v1";
const PLAN_CONTRACT = "mad4b.platform-recovery-convergence-plan.v1";
const EVENT_CONTRACT = "mad4b.platform-recovery-convergence-event.v1";
const PROCESS_INSTANCE_ID = `recovery-process:${randomUUID()}`;
const STALE_EXECUTION_RECONCILE_AFTER_MS = 15 * 60 * 1000;

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
  "claimExecution",
  "releaseExecutionClaim",
  "reserveApproval",
  "releaseApprovalReservation",
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
  if (store.independent_of_target_databases !== true) {
    fail("PLATFORM_RECOVERY_STORE_NOT_INDEPENDENT", "Recovery convergence store must explicitly prove independence from target databases.", 503);
  }
  if (typeof store.finalizeApproval !== "function" && typeof store.markApprovalUsed !== "function") {
    fail("PLATFORM_RECOVERY_APPROVAL_FINALIZER_UNAVAILABLE", "Recovery convergence requires an idempotent durable approval finalizer.", 503);
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
    approval_id: null,
    execution_process_id: null,
    started_at: null,
    completed_at: null,
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
    closure: null,
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
  step.completed_at = new Date().toISOString();
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

  if (step.key === "canonical_grants_apply") {
    const inspection = priorResult(run, "database_full_inspection");
    if (inspection?.checks?.governance_db_privilege_ready === true) {
      return "canonical_grants_already_ready";
    }
  }

  if (step.key === "mcp_catalog_migration_apply") {
    const inspection = priorResult(run, "database_full_inspection");
    if (inspection?.checks?.mcp_catalog_schema_ready === true) {
      return "mcp_catalog_schema_already_ready";
    }
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

function validateBoundResult(run, step, result, { mode = "execute" } = {}) {
  const value = result && typeof result === "object" && !Array.isArray(result) ? result : {};
  const status = text(value.status || (value.ok === true ? "pass" : ""), 64);
  if (!EXECUTOR_STATES.has(status)) fail("PLATFORM_RECOVERY_STEP_RESULT_INVALID", `Invalid result state for ${step.key}.`, 502);

  if (value.secrets_included !== false) {
    fail("PLATFORM_RECOVERY_STEP_SECRET_BOUNDARY_INVALID", `Step ${step.key} did not prove secrets_included=false.`, 502);
  }
  try { assertRecoveryData(value); } catch (error) { fail("PLATFORM_RECOVERY_PROOF_BOUNDARY_INVALID", `Step ${step.key} returned forbidden proof fields.`, 502, { error_code: String(error?.code || "proof_boundary") }); }

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
    if (mode === "reconcile" && isMutationStep(step)) {
      if (value.mutation_performed !== false || value.reconciled !== true) {
        fail(
          "PLATFORM_RECOVERY_RECONCILIATION_READBACK_INVALID",
          `Reconciliation for ${step.key} must be read-only and explicitly reconciled.`,
          502,
        );
      }
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

  if (step.key === "canonical_grants_apply" && status === "pass") {
    if (value.execution_mode !== "host_local" || value.local_connector_required !== false || value.local_connector_fallback_allowed !== false) fail("PLATFORM_RECOVERY_GRANTS_HOST_AUTHORITY_INVALID", "Runtime grants must use host-local authority without connector fallback.", 502);
    if (typeof value.grant_binding_hash !== "string" || !/^[0-9a-f]{64}$/u.test(value.grant_binding_hash)) fail("PLATFORM_RECOVERY_GRANT_BINDING_MISSING", "Grant binding hash must be server-derived and durable.", 502);
    const resources = Array.isArray(value.resources) ? value.resources : [];
    const allowed = new Set(["local_manager_device_link_sessions", "local_manager_desktop_commands"]);
    if (resources.length === 0 || resources.some((resource) => !allowed.has(String(resource.table || resource)))) fail("PLATFORM_RECOVERY_GRANT_SCOPE_INVALID", "Local Manager runtime grant scope is broader than the bounded runtime tables.", 502);
    if (mode === "reconcile") {
      if (value.database_mutation_performed !== false || value.reconciled !== true || value.readback_verified !== true) {
        fail("PLATFORM_RECOVERY_GRANT_RECONCILIATION_INVALID", "Grant reconciliation must be host-local readback only and perform no database mutation.", 502);
      }
    } else if (value.database_mutation_performed !== true || value.readback_verified !== true) {
      fail("PLATFORM_RECOVERY_GRANT_READBACK_INCOMPLETE", "Grant repair requires durable host-local readback.", 502);
    }
  }

  if (step.key === "bootstrap_ledger_verify" && status === "pass" && value.bootstrap_ledger_ready !== true) {
    fail("PLATFORM_RECOVERY_BOOTSTRAP_LEDGER_NOT_READY", "Bootstrap ledger readiness did not pass.", 502);
  }

  if (step.key === "mcp_catalog_verify" && status === "pass" && value.mcp_catalog_level_ready !== true) {
    fail("PLATFORM_RECOVERY_MCP_CATALOG_NOT_READY", "MCP catalog schema/readback is not ready.", 502);
  }

  if (step.key === "response_chunk_storage_smoke" && status === "pass") {
    for (const flag of ["write_read_verified", "delete_verified", "absence_readback_verified"]) {
      if (value[flag] !== true) fail("PLATFORM_RECOVERY_RESPONSE_CHUNK_SMOKE_FAILED", `Response chunk smoke did not verify ${flag}.`, 502);
    }
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
    if (mode === "reconcile") {
      if (value.reconciled !== true || value.new_credential_active !== true || value.old_credential_revoked !== true) {
        fail("PLATFORM_RECOVERY_CONNECTOR_REBIND_RECONCILIATION_INCOMPLETE", "Connector reconciliation did not prove the active/revoked credential state.", 502);
      }
    } else {
      const required = [
        "fresh_device_authorization_verified",
        "pending_credential_created",
        "local_atomic_install_verified",
        "new_credential_probe_verified",
        "old_credential_revoked_after_probe",
      ];
      for (const flag of required) if (value[flag] !== true) fail("PLATFORM_RECOVERY_CONNECTOR_REBIND_INCOMPLETE", `Connector two-phase rebind did not prove ${flag}.`, 502);
      if (value.old_credential_revoked_before_probe === true) fail("PLATFORM_RECOVERY_CONNECTOR_REBIND_ORDER_INVALID", "Old credential was revoked before the new credential probe.", 502);
    }
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

function staleExecutingStep(run, nowMs = Date.now()) {
  const step = run.steps.find((candidate) => candidate.status === "executing");
  if (!step) return null;
  const startedMs = Date.parse(text(step.started_at, 80));
  if (!Number.isFinite(startedMs)) return null;
  const differentProcess = text(step.execution_process_id, 220) !== PROCESS_INSTANCE_ID;
  const ageMs = Math.max(0, nowMs - startedMs);
  if (!differentProcess || ageMs < STALE_EXECUTION_RECONCILE_AFTER_MS) return null;
  return { step, age_ms: ageMs };
}

async function promoteStaleExecutionToUnknown(run, recoveryStore, step, ageMs) {
  step.status = "unknown_outcome";
  step.error_code = "platform_recovery_orphaned_execution_after_process_restart";
  step.request_id = step.request_id || null;
  step.completed_at = null;
  step.result = {
    ok: false,
    status: "unknown_outcome",
    expected_sha: run.expected_sha,
    run_id: run.run_id,
    plan_hash: run.plan_hash,
    step_id: step.step_id,
    authority_ref: step.authority_ref || null,
    nested_operation: step.nested_operation || null,
    idempotency_key: step.idempotency_key,
    error_code: step.error_code,
    request_id: step.request_id,
    next_safe_action: "reconcile_same_operation_before_retry",
    mutation_outcome_known: false,
    stale_execution_age_ms: ageMs,
    secrets_included: false,
  };
  run.status = "unknown_outcome";
  run.active = false;
  run.blocking_stage = step.key;
  run.error_code = step.error_code;
  run.request_id = step.request_id;
  run.next_safe_action = "reconcile_same_operation_before_retry";
  await appendEvent(recoveryStore, run, step, "stale_execution_promoted_to_unknown_outcome", {
    error_code: step.error_code,
    stale_execution_age_ms: ageMs,
  });
  await persistRun(recoveryStore, run);
}

function orchestrationClaimContext(run, step) {
  return Object.freeze({
    idempotency_key: `platform-recovery-orchestration:${hash({
      run_id: run.run_id,
      plan_hash: run.plan_hash,
      step_id: step.step_id,
      step_idempotency_key: step.idempotency_key,
    }).slice(0, 40)}`,
    run_id: run.run_id,
    plan_hash: run.plan_hash,
    step_id: step.step_id,
    expected_sha: run.expected_sha,
    claim_scope: "platform_recovery_convergence_orchestration",
    secrets_included: false,
  });
}

async function acquireOrchestrationClaim(recoveryStore, run, step) {
  if (!isMutationStep(step)) return null;
  const context = orchestrationClaimContext(run, step);
  const result = await recoveryStore.claimExecution(context);
  if (result?.existing === true || result?.status === "reconciliation_required") {
    fail(
      "PLATFORM_RECOVERY_STEP_EXECUTION_IN_PROGRESS",
      `A durable orchestration claim already exists for ${step.key}; duplicate execution is forbidden.`,
      409,
      { step_key: step.key, next_safe_action: "read_same_run_status_or_reconcile" },
    );
  }
  if (result !== true && result?.claimed !== true) {
    fail("PLATFORM_RECOVERY_STEP_EXECUTION_CLAIM_DENIED", `The durable store did not grant an orchestration claim for ${step.key}.`, 409);
  }
  return context;
}

async function releaseOrchestrationClaim(recoveryStore, context) {
  if (!context) return;
  const result = await recoveryStore.releaseExecutionClaim(context);
  if (result !== undefined && result !== true && result?.released !== true) {
    fail("PLATFORM_RECOVERY_STEP_EXECUTION_CLAIM_RELEASE_FAILED", "The orchestration execution claim could not be durably released.", 503);
  }
}

function approvalReservationContext(run, step, approvalId) {
  const id = text(approvalId, 220);
  if (!SAFE_ID_RE.test(id)) {
    fail("PLATFORM_RECOVERY_APPROVAL_ID_INVALID", "A valid server-resolved approval_id is required for mutating convergence stages.", 503);
  }
  return Object.freeze({
    approval_id: id,
    expected_sha: run.expected_sha,
    run_id: run.run_id,
    plan_hash: run.plan_hash,
    step_id: step.step_id,
    idempotency_key: step.idempotency_key,
    secrets_included: false,
  });
}

async function reserveStepApproval(recoveryStore, run, step, approvalId) {
  if (!isMutationStep(step)) return null;
  const context = approvalReservationContext(run, step, approvalId);
  const result = await recoveryStore.reserveApproval(context);
  if (result !== true && result?.reserved !== true && !(result?.existing === true && result?.same_idempotency === true)) {
    fail(
      "PLATFORM_RECOVERY_APPROVAL_RESERVATION_DENIED",
      `Approval reservation was denied for ${step.key}; execution is forbidden.`,
      409,
      { step_key: step.key },
    );
  }
  return context;
}

async function releaseStepApprovalReservation(recoveryStore, context) {
  if (!context) return;
  await recoveryStore.releaseApprovalReservation(context);
}

async function finalizeStepApproval(recoveryStore, context) {
  if (!context) return;
  const finalizer = typeof recoveryStore.finalizeApproval === "function"
    ? recoveryStore.finalizeApproval.bind(recoveryStore)
    : recoveryStore.markApprovalUsed.bind(recoveryStore);
  const result = typeof recoveryStore.finalizeApproval === "function"
    ? await finalizer(context)
    : await finalizer(context.approval_id);
  if (
    result !== undefined
    && result !== true
    && result?.finalized !== true
    && result?.already_finalized !== true
  ) {
    fail(
      "PLATFORM_RECOVERY_APPROVAL_FINALIZATION_FAILED",
      "Approval finalization could not be durably recorded; reconciliation is required before replay.",
      503,
      { step_id: context.step_id },
    );
  }
}

function buildFinalClosureEvidence(run) {
  const result = (key) => priorResult(run, key);
  const state = (key) => findStep(run, key);
  const identity = result("production_identity") || {};
  const inspection = result("database_full_inspection") || {};
  const backup = result("backup_evidence") || {};
  const governance = result("governance_baseline_verify") || {};
  const persistence = result("runtime_persistence_baseline_verify") || {};
  const grants = result("canonical_grants_verify") || {};
  const bootstrap = result("bootstrap_ledger_verify") || {};
  const catalog = result("mcp_catalog_verify") || {};
  const chunks = result("response_chunk_storage_smoke") || {};
  const admin = result("admin_tools_functional_readback") || {};
  const device = result("device_tools_functional_readback") || {};
  const activation = run.final_activation || result("production_activation_readiness") || {};
  const connector = result("connector_auth_verify") || {};
  const deployment = run.final_parity || result("deployment_parity") || {};
  const rateStep = state("local_manager_rate_limit_recovery");

  const mutationAuditReady = run.steps
    .filter((step) => isMutationStep(step))
    .every((step) => step.status === "skipped_not_required"
      || (step.status === "pass"
        && step.result?.authority_verified === true
        && step.result?.readback_verified === true
        && step.result?.mutation_performed === true));

  const rateLimitAttributionReady = rateStep?.status === "skipped_not_required"
    || (rateStep?.status === "pass"
      && rateStep.result?.http_status_checked_before_json === true
      && rateStep.result?.retry_after_respected === true
      && rateStep.result?.backoff_persisted === true
      && rateStep.result?.rate_limit_source_attributed === true);

  return Object.freeze({
    contract: PRODUCTION_RECOVERY_CLOSURE_EVIDENCE_CONTRACT,
    expected_sha: run.expected_sha,
    server_derived: true,
    durable: inspection.durable === true && backup.durable === true,
    same_cycle: true,
    cycle_id: run.run_id,
    target_fingerprint: inspection.target_fingerprint || null,
    inspection_run_id: inspection.inspection_run_id || null,
    inspection_evidence_hash: inspection.inspection_evidence_hash || null,
    gates: Object.freeze({
      exact_source_sha_verified: identity.exact_sha_parity === true
        && identity.version_readback === true
        && identity.deployment_info_readback === true
        && deployment.exact_sha_parity === true,
      durable_inspection_verified: inspection.durable === true
        && Boolean(inspection.inspection_run_id)
        && /^[0-9a-f]{64}$/u.test(text(inspection.inspection_evidence_hash, 128)),
      governance_baseline_ready: governance.baseline_ready === true,
      runtime_persistence_baseline_ready: persistence.baseline_ready === true,
      canonical_grants_ready: grants.grants_ready === true,
      bootstrap_ledger_ready: bootstrap.bootstrap_ledger_ready === true,
      mcp_catalog_schema_ready: catalog.mcp_catalog_level_ready === true,
      admin_catalog_functional_readback: admin.listAdminTools === true
        && admin.repo_inspect === true
        && admin.schema_contract_not_ready !== true,
      device_catalog_functional_readback: device.listDeviceTools === true
        && device.schema_contract_not_ready !== true,
      response_chunk_storage_smoke: chunks.write_read_verified === true
        && chunks.delete_verified === true
        && chunks.absence_readback_verified === true,
      production_activation_readiness: activation.ready === true,
      backup_evidence_verified: backup.backup_verified === true
        && backup.verified === true
        && backup.contract === PRODUCTION_RECOVERY_BACKUP_EVIDENCE_CONTRACT,
      production_mutation_audited: mutationAuditReady,
      connector_auth_ready: connector.auth_ready === true
        && Number(connector.authenticated_operation_http_status) === 200,
      rate_limit_attribution_ready: rateLimitAttributionReady,
    }),
    backup_evidence: Object.freeze({
      contract: backup.contract || null,
      expected_sha: backup.expected_sha || run.expected_sha,
      evidence_sha256: backup.evidence_sha256 || null,
      created_at: backup.created_at || null,
      evidence_ref: backup.evidence_ref || null,
      roles: Array.isArray(backup.roles) ? [...backup.roles] : [],
      verified: backup.verified === true,
      storage_readback_verified: backup.storage_readback_verified === true,
      restore_test_verified: backup.restore_test_verified === true,
      artifact_manifest_hash: backup.artifact_manifest_hash || null,
      target_fingerprint: backup.target_fingerprint || null,
      cycle_id: backup.cycle_id || null,
      secrets_included: false,
    }),
    unknown_outcome: run.steps.some((step) => step.status === "unknown_outcome"),
    secrets_included: false,
  });
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

async function verifyFinalDeploymentParity(run, finalStep, executors) {
  const reader = executorFor(executors, "deployment_parity", "execute");
  if (!reader) {
    return {
      ready: false,
      error_code: "platform_recovery_final_parity_unavailable",
      next_safe_action: "restore_exact_production_sha_parity_reader",
      result: null,
    };
  }

  let result;
  try {
    result = await reader(Object.freeze({
      expected_sha: run.expected_sha,
      target_key: run.target_key,
      run_id: run.run_id,
      plan_hash: run.plan_hash,
      step_id: finalStep.step_id,
      step_key: "final_gate",
      step_kind: "read_only_final_recertification",
      idempotency_key: `platform-recovery-final-parity:${run.plan_hash.slice(0, 24)}`,
      prior_steps: run.steps
        .filter((candidate) => candidate.key !== "final_gate")
        .map((candidate) => ({ key: candidate.key, status: candidate.status, result: candidate.result })),
      secrets_included: false,
    }));
  } catch (error) {
    return {
      ready: false,
      error_code: text(error?.code || "platform_recovery_final_parity_read_failed", 160),
      request_id: text(error?.request_id || error?.details?.request_id, 160) || null,
      next_safe_action: "restore_exact_production_sha_parity_before_final_closure",
      result: null,
    };
  }

  const ready = result?.status === "pass"
    && text(result?.expected_sha, 64).toLowerCase() === run.expected_sha
    && result?.exact_sha_parity === true
    && result?.version_readback === true
    && result?.deployment_info_readback === true
    && result?.mutation_performed !== true
    && result?.secrets_included === false;

  return {
    ready,
    error_code: ready ? null : "platform_recovery_final_parity_failed",
    request_id: text(result?.request_id, 160) || null,
    next_safe_action: ready ? "none" : "restore_exact_production_sha_parity_before_final_closure",
    result: result && typeof result === "object"
      ? {
          expected_sha: run.expected_sha,
          exact_sha_parity: result.exact_sha_parity === true,
          version_readback: result.version_readback === true,
          deployment_info_readback: result.deployment_info_readback === true,
          request_id: text(result.request_id, 160) || null,
          checked_at: new Date().toISOString(),
          mutation_performed: false,
          secrets_included: false,
        }
      : null,
  };
}

async function verifyFinalProductionActivation(run, finalStep, executors) {
  const reader = executorFor(executors, "production_activation_readiness", "execute");
  if (!reader) {
    return {
      ready: false,
      error_code: "platform_recovery_final_activation_reader_unavailable",
      next_safe_action: "restore_production_activation_readiness_reader",
      result: null,
    };
  }

  let result;
  try {
    result = await reader(Object.freeze({
      expected_sha: run.expected_sha,
      target_key: run.target_key,
      run_id: run.run_id,
      plan_hash: run.plan_hash,
      step_id: finalStep.step_id,
      step_key: "final_gate",
      step_kind: "read_only_final_activation_recertification",
      idempotency_key: `platform-recovery-final-activation:${run.plan_hash.slice(0, 24)}`,
      prior_steps: run.steps
        .filter((candidate) => candidate.key !== "final_gate")
        .map((candidate) => ({ key: candidate.key, status: candidate.status, result: candidate.result })),
      secrets_included: false,
    }));
  } catch (error) {
    return {
      ready: false,
      error_code: text(error?.code || "platform_recovery_final_activation_read_failed", 160),
      request_id: text(error?.request_id || error?.details?.request_id, 160) || null,
      next_safe_action: "restore_production_activation_readiness_before_final_closure",
      result: null,
    };
  }

  const ready = result?.status === "pass"
    && text(result?.expected_sha, 64).toLowerCase() === run.expected_sha
    && result?.ready === true
    && result?.readback_verified === true
    && result?.mutation_performed !== true
    && result?.secrets_included === false;

  return {
    ready,
    error_code: ready ? null : "platform_recovery_final_activation_not_ready",
    request_id: text(result?.request_id, 160) || null,
    next_safe_action: ready ? "none" : "restore_production_activation_readiness_before_final_closure",
    result: result && typeof result === "object"
      ? {
          expected_sha: run.expected_sha,
          ready: result.ready === true,
          readback_verified: result.readback_verified === true,
          request_id: text(result.request_id, 160) || null,
          checked_at: new Date().toISOString(),
          mutation_performed: false,
          secrets_included: false,
        }
      : null,
  };
}

function summarize(run) {
  const staleExecution = staleExecutingStep(run);
  return {
    ok: run.status === "recovered" && run.active === true,
    contract: RUN_CONTRACT,
    run_id: run.run_id,
    expected_sha: run.expected_sha,
    plan_hash: run.plan_hash,
    status: run.status,
    active: run.active === true,
    blocking_stage: run.blocking_stage,
    error_code: run.error_code,
    request_id: run.request_id,
    next_safe_action: staleExecution ? "reconcile_same_operation_before_retry" : run.next_safe_action,
    stale_execution_reconciliation_eligible: Boolean(staleExecution),
    stale_execution_step: staleExecution?.step?.key || null,
    final_parity: run.final_parity ? clone(run.final_parity) : null,
    final_activation: run.final_activation ? clone(run.final_activation) : null,
    closure: run.closure ? clone(run.closure) : null,
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

  const orchestrationClaim = await acquireOrchestrationClaim(recoveryStore, run, step);
  let approvalReservation = null;
  try {
    approvalReservation = await reserveStepApproval(
      recoveryStore,
      run,
      step,
      authority.approval?.approval_id || null,
    );
  } catch (error) {
    await releaseOrchestrationClaim(recoveryStore, orchestrationClaim);
    throw error;
  }
  if (isMutationStep(step)) {
    step.approval_id = authority.approval.approval_id;
  }

  step.status = "executing";
  step.execution_process_id = PROCESS_INSTANCE_ID;
  step.started_at = new Date().toISOString();
  step.completed_at = null;
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
      status: error?.unknown_outcome === true || (isMutationStep(step) && error?.mutation_performed === true) ? "unknown_outcome" : "blocked",
      error_code: text(error?.code || "platform_recovery_stage_failed", 160),
      request_id: text(error?.request_id || error?.details?.request_id, 160) || null,
      next_safe_action: error?.unknown_outcome === true ? "reconcile_same_operation_before_retry" : "resolve_blocking_stage_and_resume_same_run",
      mutation_performed: error?.mutation_performed === true,
      secrets_included: false,
    };
  }

  if (isMutationStep(step)
    && rawResult?.mutation_performed === true
    && !["pass", "unknown_outcome"].includes(text(rawResult?.status, 64))) {
    rawResult = {
      ...rawResult,
      ok: false,
      status: "unknown_outcome",
      error_code: rawResult?.error_code || "platform_recovery_mutation_without_verified_terminal_state",
      next_safe_action: "reconcile_same_operation_before_retry",
      secrets_included: false,
    };
  }

  let result;
  try {
    result = validateBoundResult(run, step, rawResult);
  } catch (error) {
    if (isMutationStep(step) && rawResult?.mutation_performed !== false) {
      step.status = "unknown_outcome";
      step.completed_at = null;
      step.error_code = "platform_recovery_mutation_receipt_invalid";
      step.request_id = text(rawResult?.request_id, 160) || null;
      step.result = {
        ok: false,
        status: "unknown_outcome",
        error_code: step.error_code,
        request_id: step.request_id,
        next_safe_action: "reconcile_same_operation_before_retry",
        mutation_performed: rawResult?.mutation_performed === true,
        receipt_validation_error: text(error?.code || "invalid_mutation_receipt", 160),
        secrets_included: false,
      };
      run.status = "unknown_outcome";
      run.active = false;
      run.blocking_stage = step.key;
      run.error_code = step.error_code;
      run.request_id = step.request_id;
      run.next_safe_action = "reconcile_same_operation_before_retry";
      await appendEvent(recoveryStore, run, step, "step_unknown_outcome", {
        error_code: step.error_code,
        request_id: step.request_id,
        receipt_validation_error: step.result.receipt_validation_error,
      });
      await persistRun(recoveryStore, run);
      return { continue: false };
    }
    await releaseOrchestrationClaim(recoveryStore, orchestrationClaim);
    throw error;
  }
  step.result = result;
  step.status = result.status;
  step.completed_at = result.status === "unknown_outcome" ? null : new Date().toISOString();
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
    if (result.status !== "unknown_outcome") {
      await releaseStepApprovalReservation(recoveryStore, approvalReservation);
      await releaseOrchestrationClaim(recoveryStore, orchestrationClaim);
    }
    return { continue: false };
  }

  if (isMutationStep(step)) {
    try {
      await finalizeStepApproval(recoveryStore, approvalReservation);
    } catch (error) {
      step.status = "unknown_outcome";
      step.completed_at = null;
      step.error_code = "platform_recovery_approval_finalization_unknown";
      step.result = {
        ...result,
        ok: false,
        status: "unknown_outcome",
        error_code: step.error_code,
        next_safe_action: "reconcile_same_operation_before_retry",
        approval_finalization_error: text(error?.code || "approval_finalization_failed", 160),
        secrets_included: false,
      };
      run.status = "unknown_outcome";
      run.active = false;
      run.blocking_stage = step.key;
      run.error_code = step.error_code;
      run.next_safe_action = "reconcile_same_operation_before_retry";
      await appendEvent(recoveryStore, run, step, "step_unknown_outcome", {
        error_code: step.error_code,
        approval_finalization_error: step.result.approval_finalization_error,
      });
      await persistRun(recoveryStore, run);
      return { continue: false };
    }
  }

  step.status = "pass";
  run.blocking_stage = null;
  run.error_code = null;
  run.request_id = null;
  run.next_safe_action = "advance_same_run";
  await persistRun(recoveryStore, run);
  await releaseStepApprovalReservation(recoveryStore, approvalReservation);
  await releaseOrchestrationClaim(recoveryStore, orchestrationClaim);
  return { continue: true, consequential_executed: isMutationStep(step) };
}

async function reconcileUnknownStep(run, { recoveryStore, executors }) {
  let step = run.steps.find((candidate) => candidate.status === "unknown_outcome");
  if (!step) {
    const executing = run.steps.find((candidate) => candidate.status === "executing");
    const stale = staleExecutingStep(run);
    if (executing && !stale) {
      const startedMs = Date.parse(text(executing.started_at, 80));
      const ageMs = Number.isFinite(startedMs) ? Math.max(0, Date.now() - startedMs) : 0;
      const retryAfterSeconds = Math.max(1, Math.ceil((STALE_EXECUTION_RECONCILE_AFTER_MS - ageMs) / 1000));
      fail(
        "PLATFORM_RECOVERY_EXECUTION_MAY_STILL_BE_IN_PROGRESS",
        "The mutating step is still inside the bounded execution-liveness window; reconciliation is not yet allowed.",
        409,
        {
          step_key: executing.key,
          retry_after_seconds: retryAfterSeconds,
          next_safe_action: "read_same_run_status_then_reconcile_after_stale_window",
        },
      );
    }
    if (!stale) fail("PLATFORM_RECOVERY_RECONCILIATION_NOT_REQUIRED", "No unknown outcome requires reconciliation.", 409);
    step = stale.step;
    await promoteStaleExecutionToUnknown(run, recoveryStore, step, stale.age_ms);
  }
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
  if (raw?.mutation_performed === true) {
    fail(
      "PLATFORM_RECOVERY_RECONCILIATION_MUTATION_FORBIDDEN",
      "Unknown-outcome reconciliation must be readback-only and may not perform a second mutation.",
      409,
      { step_key: step.key },
    );
  }
  const result = validateBoundResult(run, step, raw, { mode: "reconcile" });
  if (result.status === "unknown_outcome") {
    step.result = result;
    run.status = "unknown_outcome";
    run.blocking_stage = step.key;
    run.next_safe_action = "reconcile_same_operation_before_retry";
  } else if (result.status === "pass") {
    const reconciliationApproval = approvalReservationContext(run, step, step.approval_id);
    await finalizeStepApproval(recoveryStore, reconciliationApproval);
    step.status = "pass";
    step.result = result;
    step.completed_at = new Date().toISOString();
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
    step.completed_at = result.status === "unknown_outcome" ? null : new Date().toISOString();
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
  if (result.status === "pass") {
    const reconciliationApproval = approvalReservationContext(run, step, step.approval_id);
    await releaseStepApprovalReservation(recoveryStore, reconciliationApproval);
    await releaseOrchestrationClaim(recoveryStore, orchestrationClaimContext(run, step));
  } else if (
    result.status !== "unknown_outcome"
    && result.mutation_outcome_known === true
    && result.mutation_applied === false
  ) {
    const reconciliationApproval = approvalReservationContext(run, step, step.approval_id);
    await releaseStepApprovalReservation(recoveryStore, reconciliationApproval);
    await releaseOrchestrationClaim(recoveryStore, orchestrationClaimContext(run, step));
  }
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

  const staleExecution = staleExecutingStep(run);
  if (staleExecution) {
    await promoteStaleExecutionToUnknown(
      run,
      deps.recoveryStore,
      staleExecution.step,
      staleExecution.age_ms,
    );
    return summarize(run);
  }

  if (run.status === "unknown_outcome") {
    run.next_safe_action = "reconcile_same_operation_before_retry";
    return summarize(run);
  }
  if (run.status === "recovered" || run.status === "active") return summarize(run);

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

      const finalParity = await verifyFinalDeploymentParity(run, step, deps.executors || {});
      run.final_parity = finalParity.result ? clone(finalParity.result) : null;
      if (!finalParity.ready) {
        step.status = "blocked";
        step.error_code = finalParity.error_code;
        step.request_id = finalParity.request_id || null;
        step.result = {
          ok: false,
          status: "blocked",
          expected_sha: run.expected_sha,
          run_id: run.run_id,
          plan_hash: run.plan_hash,
          step_id: step.step_id,
          idempotency_key: step.idempotency_key,
          error_code: step.error_code,
          request_id: step.request_id,
          next_safe_action: finalParity.next_safe_action,
          mutation_performed: false,
          readback_verified: false,
          secrets_included: false,
        };
        run.status = "blocked";
        run.active = false;
        run.blocking_stage = "final_gate";
        run.error_code = step.error_code;
        run.request_id = step.request_id;
        run.next_safe_action = finalParity.next_safe_action;
        await appendEvent(deps.recoveryStore, run, step, "final_parity_blocked", {
          error_code: step.error_code,
          request_id: step.request_id,
        });
        await persistRun(deps.recoveryStore, run);
        return summarize(run);
      }

      const finalActivation = await verifyFinalProductionActivation(run, step, deps.executors || {});
      run.final_activation = finalActivation.result ? clone(finalActivation.result) : null;
      if (!finalActivation.ready) {
        step.status = "blocked";
        step.error_code = finalActivation.error_code;
        step.request_id = finalActivation.request_id || null;
        step.result = {
          ok: false,
          status: "blocked",
          expected_sha: run.expected_sha,
          run_id: run.run_id,
          plan_hash: run.plan_hash,
          step_id: step.step_id,
          idempotency_key: step.idempotency_key,
          error_code: step.error_code,
          request_id: step.request_id,
          next_safe_action: finalActivation.next_safe_action,
          mutation_performed: false,
          readback_verified: false,
          secrets_included: false,
        };
        run.status = "blocked";
        run.active = false;
        run.blocking_stage = "final_gate";
        run.error_code = step.error_code;
        run.request_id = step.request_id;
        run.next_safe_action = finalActivation.next_safe_action;
        await appendEvent(deps.recoveryStore, run, step, "final_activation_blocked", {
          error_code: step.error_code,
          request_id: step.request_id,
        });
        await persistRun(deps.recoveryStore, run);
        return summarize(run);
      }

      const closureEvidence = buildFinalClosureEvidence(run);
      const closure = evaluateProductionRecoveryClosure({
        expectedSha: run.expected_sha,
        evidence: closureEvidence,
      });
      run.closure = clone(closure);

      if (closure.status !== "recovered") {
        step.status = closure.status === "unknown_outcome"
          ? "unknown_outcome"
          : closure.status === "degraded_non_db"
            ? "degraded"
            : "blocked";
        step.error_code = `platform_recovery_final_closure_${closure.status}`;
        step.result = {
          ok: false,
          status: step.status,
          expected_sha: run.expected_sha,
          run_id: run.run_id,
          plan_hash: run.plan_hash,
          step_id: step.step_id,
          idempotency_key: step.idempotency_key,
          closure_status: closure.status,
          closure_sha256: closure.closure_sha256,
          problems: closure.problems,
          mutation_performed: false,
          readback_verified: true,
          secrets_included: false,
        };
        run.status = closure.status === "unknown_outcome"
          ? "unknown_outcome"
          : closure.status === "degraded_non_db"
            ? "degraded"
            : "blocked";
        run.active = false;
        run.blocking_stage = "final_gate";
        run.error_code = step.error_code;
        run.request_id = null;
        run.next_safe_action = closure.status === "unknown_outcome"
          ? "reconcile_same_operation_before_retry"
          : "resolve_closure_evidence_and_resume_same_run";
        await appendEvent(deps.recoveryStore, run, step, "final_closure_not_recovered", {
          closure_status: closure.status,
          closure_sha256: closure.closure_sha256,
          problems: closure.problems,
        });
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
        closure_status: closure.status,
        closure_sha256: closure.closure_sha256,
        mutation_performed: false,
        readback_verified: true,
        secrets_included: false,
      };
      run.status = "recovered";
      run.active = true;
      run.blocking_stage = null;
      run.error_code = null;
      run.request_id = null;
      run.next_safe_action = "none";
      await appendEvent(deps.recoveryStore, run, step, "run_recovered", {
        all_gates_passed: true,
        closure_sha256: closure.closure_sha256,
      });
      await persistRun(deps.recoveryStore, run);
      await deps.recoveryStore.putIdempotencyReceipt(run.idempotency_key, {
        contract: "mad4b.platform-recovery-convergence-idempotency.v1",
        run_id: run.run_id,
        expected_sha: run.expected_sha,
        plan_hash: run.plan_hash,
        status: "recovered",
        closure_sha256: closure.closure_sha256,
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
