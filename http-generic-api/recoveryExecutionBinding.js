import { createHash } from "node:crypto";

const SHA_RE = /^[0-9a-f]{40}$/iu;
const SHA256_RE = /^[0-9a-f]{64}$/iu;
const ROLES = new Set(["runtime", "governance", "runtime_persistence"]);
const BASELINE_STAGES = Object.freeze([
  "recovery_control_plane_ready",
  "durable_full_inspection",
  "governance_baseline_ready",
  "runtime_persistence_baseline_ready",
  "canonical_grants_readback_ready",
  "governance_authority_ready",
]);
const PROGRESS_STATES = new Set([
  "pending",
  "executing",
  "completed",
  "verified",
  "partial_execution",
  "execution_outcome_unknown",
  "reconciliation_required",
]);
const PROGRESS_STATE_ORDER = Object.freeze({
  pending: 0,
  executing: 1,
  completed: 2,
  verified: 3,
  partial_execution: 3,
  execution_outcome_unknown: 3,
  reconciliation_required: 4,
});

export const RECOVERY_EXECUTION_BINDING_CONTRACT = "mad4b.recovery-execution-binding.v1";
export const BASELINE_ORDER_CONTRACT = Object.freeze({
  contract: "mad4b.baseline-before-ordinary-migration.v1",
  required_predecessors: BASELINE_STAGES,
  ordinary_migration_stage: "ordinary_migration",
  standalone_migration_first_allowed: false,
  database_independent_control_plane: true,
  secrets_included: false,
});
export const ROLE_BUNDLE_PROGRESS_CONTRACT = Object.freeze({
  contract: "mad4b.role-bundle-progress.v1",
  automatic_rerun_allowed: false,
  reconciliation_required_on_partial_or_unknown: true,
  resume_requires_exact_bundle_ticket_plan_and_fence: true,
  secrets_included: false,
});
export const APPROVAL_BINDING_CONTRACT = Object.freeze({
  contract: "mad4b.recovery-single-step-approval-binding.v1",
  plan_bound: true,
  step_bound: true,
  target_bound: true,
  single_use: true,
  caller_supplied_ticket_forbidden: true,
  secrets_included: false,
});
export const EXECUTION_LIFECYCLE_CONTRACT = Object.freeze({
  contract: "mad4b.recovery-execute-and-verify.v1",
  verification_before_finalization: true,
  fence_held_until_readback: true,
  release_fence_after_finalization: true,
  provider_acknowledged_is_not_verified: true,
  postcondition_failure_requires_reconciliation: true,
  automatic_rerun_allowed: false,
  secrets_included: false,
});
export const RUNTIME_MIGRATION_TARGET_BINDINGS = Object.freeze({
  "20260815_custom_gpt_mcp_catalog_levels.sql": Object.freeze({
    migration: "20260815_custom_gpt_mcp_catalog_levels.sql",
    ownership_domain: "governance",
    database_target_role: "runtime",
    credential_binding_prefix: "DB_",
    required_resources: ["admin_platform_endpoint_tools", "tenant_platform_endpoint_tools"],
    mutation_class: "schema_and_data_convergence",
    traffic_policy: "normal",
    rollback_class: "forward_fix_only",
    secrets_included: false,
  }),
});
export const PRODUCTION_LIVE_COMPOSITION_CONTRACT = Object.freeze({
  contract: "mad4b.recovery-production-live-composition.v1",
  required_authorities: ["recovery_store", "approval_authority", "ticket_signer_verifier", "fenced_lock", "host_executor", "readback_verifier", "deployment_attestation", "staging_certification"],
  default_mode: "fail_closed",
  live_mode_name: "production_live",
  live_execution_enabled_by_default: false,
  mutation_requires_explicit_live_mode: true,
  secrets_included: false,
});

export function buildApprovalBinding({ approvalId, approvalHash, approvalVersion = "v1", planHash, stepId, stepHash, targetKey, targetFingerprint, targetRole, operation } = {}) {
  const binding = {
    ...APPROVAL_BINDING_CONTRACT,
    approval_id: text(approvalId, 160),
    approval_hash: text(approvalHash, 128).toLowerCase(),
    approval_version: text(approvalVersion, 64),
    plan_hash: text(planHash, 128).toLowerCase(),
    step_id: text(stepId, 160),
    step_hash: text(stepHash, 128).toLowerCase(),
    target_key: text(targetKey, 160),
    target_fingerprint: text(targetFingerprint, 128).toLowerCase(),
    target_role: text(targetRole, 64).toLowerCase(),
    operation: text(operation, 96),
  };
  return { ...binding, binding_hash: hashObject(binding) };
}

export function validateApprovalBinding(binding = {}, expected = {}) {
  const observed = binding && typeof binding === "object" && !Array.isArray(binding) ? binding : {};
  const canonical = buildApprovalBinding({
    approvalId: expected.approvalId ?? observed.approval_id,
    approvalHash: expected.approvalHash ?? observed.approval_hash,
    approvalVersion: expected.approvalVersion ?? observed.approval_version,
    planHash: expected.planHash ?? observed.plan_hash,
    stepId: expected.stepId ?? observed.step_id,
    stepHash: expected.stepHash ?? observed.step_hash,
    targetKey: expected.targetKey ?? observed.target_key,
    targetFingerprint: expected.targetFingerprint ?? observed.target_fingerprint,
    targetRole: expected.targetRole ?? observed.target_role,
    operation: expected.operation ?? observed.operation,
  });
  const problems = [];
  for (const key of ["approval_id", "approval_hash", "approval_version", "plan_hash", "step_id", "step_hash", "target_key", "target_fingerprint", "target_role", "operation", "binding_hash"]) {
    if (String(observed[key] ?? "") !== String(canonical[key] ?? "")) problems.push(`approval_${key}_mismatch`);
  }
  if (!observed.single_use || observed.single_use !== true) problems.push("approval_single_use_required");
  if (observed.caller_supplied_ticket_forbidden !== true) problems.push("approval_ticket_caller_binding_invalid");
  if (!validSha256(canonical.approval_hash) || !validSha256(canonical.target_fingerprint) || !validSha256(canonical.step_hash) || !validSha256(canonical.plan_hash)) problems.push("approval_binding_digest_invalid");
  return { ok: problems.length === 0, contract: APPROVAL_BINDING_CONTRACT.contract, problems, binding: canonical, secrets_included: false };
}

export function resolveRuntimeMigrationTargetBinding({ migration, ownershipDomain = null, databaseTargetRole = null } = {}) {
  const key = text(migration, 160);
  const known = RUNTIME_MIGRATION_TARGET_BINDINGS[key] || null;
  const problems = [];
  if (!known) problems.push("migration_target_binding_unknown");
  if (known && ownershipDomain && ownershipDomain !== known.ownership_domain) problems.push("migration_ownership_domain_mismatch");
  if (known && databaseTargetRole && databaseTargetRole !== known.database_target_role) problems.push("migration_database_target_role_mismatch");
  return { ok: problems.length === 0, contract: "mad4b.recovery-migration-target-binding.v1", migration: key, ownership_domain: known?.ownership_domain || text(ownershipDomain, 64) || null, database_target_role: known?.database_target_role || text(databaseTargetRole, 64) || null, binding: known, problems, secrets_included: false };
}

export function validateDurableRunReference({ runId, run, planHash, stepId } = {}) {
  const problems = [];
  const normalizedRunId = text(runId, 160);
  if (!/^run:[A-Za-z0-9._:-]{8,160}$/u.test(normalizedRunId)) problems.push("run_id_invalid");
  if (!run || typeof run !== "object" || Array.isArray(run)) problems.push("durable_run_missing");
  if (run && run.run_id !== normalizedRunId) problems.push("run_id_mismatch");
  if (run && planHash && run.plan_hash !== planHash) problems.push("run_plan_hash_mismatch");
  if (run && stepId && run.step_id !== stepId) problems.push("run_step_id_mismatch");
  return { ok: problems.length === 0, contract: "mad4b.recovery-durable-run-reference.v1", run_id: normalizedRunId || null, problems, in_memory_fallback_allowed: false, secrets_included: false };
}

export function validateExecutionLifecycleOrder(phases = []) {
  const expected = ["provider_acknowledged", "readback_pending", "verifying", "verified", "recovered"];
  const observed = Array.isArray(phases) ? phases : [];
  const indexes = expected.map((phase) => observed.indexOf(phase));
  const problems = [];
  if (indexes.some((index) => index < 0)) problems.push("lifecycle_phase_missing");
  if (indexes.some((index, i) => i > 0 && index <= indexes[i - 1])) problems.push("lifecycle_phase_order_invalid");
  return { ok: problems.length === 0, contract: EXECUTION_LIFECYCLE_CONTRACT.contract, expected_phases: expected, observed_phases: observed, problems, secrets_included: false };
}


function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function stableJson(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function hashObject(value) {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function validSha(value) {
  return SHA_RE.test(text(value, 64).toLowerCase());
}

function validSha256(value) {
  return SHA256_RE.test(text(value, 128).toLowerCase());
}

function sha256(value) {
  return createHash("sha256").update(text(value), "utf8").digest("hex");
}

function normalizedStages(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((stage) => text(stage, 96)).filter(Boolean))];
}

function normalizedFingerprints(value) {
  return (Array.isArray(value) ? value : []).map((fingerprint) => text(fingerprint, 128).toLowerCase());
}

export function validateDeploymentIdentityAttestation({
  attestation = null,
  expectedSha = "",
  expectedRepository = "",
  expectedBranch = "",
  expectedManifestHash = "",
  expectedAttestationHash = "",
  expectedTargetFingerprint = "",
  expectedTargetRole = "composite",
} = {}) {
  const problems = [];
  const value = attestation && typeof attestation === "object" && !Array.isArray(attestation) ? attestation : {};
  const expectedCommit = text(expectedSha, 64).toLowerCase();
  const observedCommit = text(value.deployment_sha || value.repository_sha || value.commit_sha, 64).toLowerCase();
  const expectedRepo = text(expectedRepository, 200);
  const expectedBranchValue = text(expectedBranch, 100);
  const observedRepo = text(value.repository || value.deployment_repository, 200);
  const observedBranch = text(value.branch || value.deployment_branch, 100);
  const observedManifestHash = text(value.recovery_manifest_hash || value.manifest_hash, 128).toLowerCase();
  const observedAttestationHash = text(value.attestation_hash, 128).toLowerCase();
  const targetRole = ROLES.has(text(expectedTargetRole, 64)) ? text(expectedTargetRole, 64) : "composite";
  const observedTargetFingerprint = text(value.target_fingerprints?.[targetRole] || value.target_fingerprint, 128).toLowerCase();

  if (!validSha(expectedCommit)) problems.push("expected_sha_invalid");
  if (!validSha(observedCommit) || observedCommit !== expectedCommit) problems.push("deployment_sha_mismatch");
  if (expectedRepo && observedRepo !== expectedRepo) problems.push("deployment_repository_mismatch");
  if (expectedBranchValue && observedBranch !== expectedBranchValue) problems.push("deployment_branch_mismatch");
  if (!validSha256(expectedManifestHash) || observedManifestHash !== text(expectedManifestHash, 128).toLowerCase()) problems.push("recovery_manifest_mismatch");
  if (!validSha256(observedAttestationHash)) problems.push("attestation_hash_missing");
  if (expectedAttestationHash && observedAttestationHash !== text(expectedAttestationHash, 128).toLowerCase()) problems.push("attestation_hash_mismatch");
  if (expectedTargetFingerprint && observedTargetFingerprint !== text(expectedTargetFingerprint, 128).toLowerCase()) problems.push("target_fingerprint_mismatch");
  if (value.manifest_bound !== true) problems.push("manifest_not_bound");
  if (value.read_only_probe !== true) problems.push("attestation_not_read_only");
  if (value.database_mutation_performed !== false) problems.push("database_mutation_attestation_invalid");
  if (value.provider_mutation_performed !== false) problems.push("provider_mutation_attestation_invalid");
  if (value.secrets_included !== false) problems.push("secret_material_attestation_invalid");

  return {
    ok: problems.length === 0,
    contract: RECOVERY_EXECUTION_BINDING_CONTRACT,
    problems,
    binding: {
      repository_match: !expectedRepo || observedRepo === expectedRepo,
      branch_match: !expectedBranchValue || observedBranch === expectedBranchValue,
      sha_match: validSha(expectedCommit) && observedCommit === expectedCommit,
      manifest_match: validSha256(expectedManifestHash) && observedManifestHash === text(expectedManifestHash, 128).toLowerCase(),
      attestation_hash_match: !expectedAttestationHash || observedAttestationHash === text(expectedAttestationHash, 128).toLowerCase(),
      target_fingerprint_match: !expectedTargetFingerprint || observedTargetFingerprint === text(expectedTargetFingerprint, 128).toLowerCase(),
      target_role: targetRole,
    },
    attestation_hash: validSha256(observedAttestationHash) ? observedAttestationHash : null,
    read_only_probe: value.read_only_probe === true,
    database_connection_performed: value.database_connection_performed === true,
    database_mutation_performed: value.database_mutation_performed === true,
    provider_mutation_performed: value.provider_mutation_performed === true,
    secrets_included: false,
  };
}

export function buildBaselineExecutionOrderProof({
  expectedSha = "",
  targetKey = "",
  completedStages = [],
  source = "injected_baseline_readback",
} = {}) {
  const base = {
    contract: BASELINE_ORDER_CONTRACT.contract,
    expected_sha: text(expectedSha, 64).toLowerCase(),
    target_key: text(targetKey, 160),
    completed_stages: normalizedStages(completedStages),
    requested_stage: BASELINE_ORDER_CONTRACT.ordinary_migration_stage,
    source: text(source, 120),
    database_independent_control_plane: true,
    secrets_included: false,
  };
  return { ...base, proof_hash: hashObject(base) };
}

export function validateBaselineBeforeOrdinaryMigration({ proof = null, expectedSha = "", targetKey = "" } = {}) {
  const problems = [];
  const value = proof && typeof proof === "object" && !Array.isArray(proof) ? proof : {};
  const stages = normalizedStages(value.completed_stages);
  const expectedCommit = text(expectedSha, 64).toLowerCase();
  const expectedTarget = text(targetKey, 160);
  const base = {
    contract: BASELINE_ORDER_CONTRACT.contract,
    expected_sha: text(value.expected_sha, 64).toLowerCase(),
    target_key: text(value.target_key, 160),
    completed_stages: stages,
    requested_stage: BASELINE_ORDER_CONTRACT.ordinary_migration_stage,
    source: text(value.source, 120),
    database_independent_control_plane: value.database_independent_control_plane === true,
    secrets_included: false,
  };
  if (value.contract !== BASELINE_ORDER_CONTRACT.contract) problems.push("baseline_order_contract_invalid");
  if (!validSha(expectedCommit) || base.expected_sha !== expectedCommit) problems.push("baseline_order_sha_mismatch");
  if (!expectedTarget || base.target_key !== expectedTarget) problems.push("baseline_order_target_mismatch");
  if (value.requested_stage !== BASELINE_ORDER_CONTRACT.ordinary_migration_stage) problems.push("baseline_order_requested_stage_invalid");
  if (!base.source) problems.push("baseline_order_source_missing");
  if (value.database_independent_control_plane !== true) problems.push("baseline_order_control_plane_not_independent");
  if (text(value.proof_hash, 128).toLowerCase() !== hashObject(base)) problems.push("baseline_order_proof_hash_mismatch");
  let cursor = -1;
  for (const stage of BASELINE_STAGES) {
    const index = stages.indexOf(stage);
    if (index === -1) problems.push(`baseline_predecessor_missing:${stage}`);
    if (index !== -1 && index <= cursor) problems.push(`baseline_predecessor_order_invalid:${stage}`);
    if (index !== -1) cursor = index;
  }
  return {
    ok: problems.length === 0,
    contract: BASELINE_ORDER_CONTRACT.contract,
    requested_stage: BASELINE_ORDER_CONTRACT.ordinary_migration_stage,
    required_predecessors: BASELINE_STAGES,
    completed_stages: stages,
    problems,
    secrets_included: false,
  };
}

export function buildRoleBundleBinding({ role, bundleManifestSha256, roleBundleSha256, statementCount, statementFingerprints = [] } = {}) {
  const normalizedRole = text(role, 64).toLowerCase();
  const normalizedFingerprints = normalizedFingerprintsForBinding(statementFingerprints);
  const binding = {
    contract: "mad4b.role-bundle-binding.v1",
    role: normalizedRole,
    bundle_manifest_sha256: text(bundleManifestSha256, 128).toLowerCase(),
    role_bundle_sha256: text(roleBundleSha256, 128).toLowerCase(),
    statement_count: Number(statementCount),
    statement_fingerprints: normalizedFingerprints,
    secrets_included: false,
  };
  return { ...binding, binding_hash: hashObject(binding) };
}

function normalizedFingerprintsForBinding(value) {
  return normalizedFingerprints(value);
}

export function validateRoleBundleBinding(binding = {}, { role, bundleManifestSha256, roleBundleSha256, statementCount, statementFingerprints = [] } = {}) {
  const expected = buildRoleBundleBinding({ role, bundleManifestSha256, roleBundleSha256, statementCount, statementFingerprints });
  const observed = binding && typeof binding === "object" && !Array.isArray(binding) ? binding : {};
  const problems = [];
  for (const key of ["contract", "role", "bundle_manifest_sha256", "role_bundle_sha256", "statement_count", "binding_hash"]) {
    if (String(observed[key] ?? "") !== String(expected[key] ?? "")) problems.push(`role_bundle_${key}_mismatch`);
  }
  if (JSON.stringify(normalizedFingerprints(observed.statement_fingerprints)) !== JSON.stringify(expected.statement_fingerprints)) problems.push("role_bundle_statement_fingerprints_mismatch");
  if (!ROLES.has(expected.role)) problems.push("role_bundle_role_invalid");
  if (!validSha256(expected.bundle_manifest_sha256) || !validSha256(expected.role_bundle_sha256)) problems.push("role_bundle_checksum_invalid");
  if (!Number.isInteger(expected.statement_count) || expected.statement_count < 1 || expected.statement_count !== expected.statement_fingerprints.length) problems.push("role_bundle_statement_count_invalid");
  return { ok: problems.length === 0, contract: expected.contract, problems, binding: expected, secrets_included: false };
}

export function createRoleBundleProgress({ role, bundleBinding } = {}) {
  const validation = validateRoleBundleBinding(bundleBinding, {
    role: bundleBinding?.role || role,
    bundleManifestSha256: bundleBinding?.bundle_manifest_sha256,
    roleBundleSha256: bundleBinding?.role_bundle_sha256,
    statementCount: bundleBinding?.statement_count,
    statementFingerprints: bundleBinding?.statement_fingerprints,
  });
  if (!validation.ok) {
    const error = new Error("Role bundle progress requires an exact role-bundle binding.");
    error.code = "role_bundle_binding_invalid";
    error.details = { problems: validation.problems, secrets_included: false };
    throw error;
  }
  return {
    ...ROLE_BUNDLE_PROGRESS_CONTRACT,
    role: validation.binding.role,
    bundle_manifest_sha256: validation.binding.bundle_manifest_sha256,
    role_bundle_sha256: validation.binding.role_bundle_sha256,
    role_bundle_binding_hash: validation.binding.binding_hash,
    statement_count: validation.binding.statement_count,
    statement_fingerprints: validation.binding.statement_fingerprints,
    last_completed_boundary: 0,
    completed_boundaries: [],
    state: "pending",
    provider_outcome: "not_started",
    object_fingerprint_after_failure: null,
    reconciliation_required: false,
    automatic_rerun_allowed: false,
    secrets_included: false,
  };
}

export function recordRoleBundleProgress(progress = {}, {
  state,
  completedBoundary = progress.last_completed_boundary,
  providerOutcome = progress.provider_outcome,
  objectFingerprintAfterFailure = progress.object_fingerprint_after_failure,
  reconciliationRequired = false,
} = {}) {
  if (!progress || typeof progress !== "object" || !PROGRESS_STATES.has(text(state, 64))) {
    const error = new Error("Role bundle progress state is invalid.");
    error.code = "role_bundle_progress_state_invalid";
    throw error;
  }
  const nextState = text(state, 64);
  const currentState = text(progress.state, 64) || "pending";
  if (!PROGRESS_STATES.has(currentState) || PROGRESS_STATE_ORDER[nextState] < PROGRESS_STATE_ORDER[currentState]) {
    const error = new Error("Role bundle progress cannot regress.");
    error.code = "role_bundle_progress_regression";
    throw error;
  }
  const boundary = Number(completedBoundary);
  if (!Number.isInteger(boundary) || boundary < Number(progress.last_completed_boundary || 0) || boundary > Number(progress.statement_count || 0)) {
    const error = new Error("Role bundle progress boundary is invalid or regressive.");
    error.code = "role_bundle_progress_boundary_invalid";
    throw error;
  }
  if (["completed", "verified"].includes(nextState) && boundary !== Number(progress.statement_count)) {
    const error = new Error("A completed role bundle must record its final statement boundary.");
    error.code = "role_bundle_progress_incomplete";
    throw error;
  }
  const requiresReconciliation = reconciliationRequired === true || ["partial_execution", "execution_outcome_unknown", "reconciliation_required"].includes(nextState);
  const boundaries = [...new Set([
    ...(Array.isArray(progress.completed_boundaries) ? progress.completed_boundaries : []),
    ...(boundary > 0 ? [boundary] : []),
  ])].sort((left, right) => left - right);
  return {
    ...progress,
    last_completed_boundary: boundary,
    completed_boundaries: boundaries,
    state: nextState,
    provider_outcome: text(providerOutcome, 64) || "unknown",
    object_fingerprint_after_failure: validSha256(objectFingerprintAfterFailure) ? text(objectFingerprintAfterFailure, 128).toLowerCase() : null,
    reconciliation_required: requiresReconciliation,
    automatic_rerun_allowed: false,
    secrets_included: false,
  };
}

export const _testingRecoveryExecutionBinding = Object.freeze({
  BASELINE_STAGES,
  PROGRESS_STATES,
  PROGRESS_STATE_ORDER,
  stableJson,
  hashObject,
  sha256,
  validSha,
  validSha256,
});
