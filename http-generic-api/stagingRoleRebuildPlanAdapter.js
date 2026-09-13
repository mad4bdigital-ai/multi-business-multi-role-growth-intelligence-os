import { createHash } from "node:crypto";
import { validateRoleBundleBinding } from "./recoveryExecutionBinding.js";
import { computeRoleSelectionProofHash } from "./roleSelectionProof.js";
import { assertCanonicalRoleRebuildFinding } from "./recoveryKernelInspectionBridge.js";

export const STAGING_ROLE_REBUILD_PLAN_ADAPTER_CONTRACT = "mad4b.staging-role-rebuild-plan-adapter.v1";
const ROLES = Object.freeze(["runtime", "governance", "runtime_persistence"]);
const SHA256 = /^[0-9a-f]{64}$/u;

const text = (value, max = 512) => String(value ?? "").trim().slice(0, max);
const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value;
const digest = (value) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

function fail(code, message, details = {}, status = 409) {
  throw Object.assign(new Error(message), { code, status, details: { ...details, production_authority: false, database_mutation_performed: false, secrets_included: false } });
}

function roleFinding(run, role) {
  const finding = (Array.isArray(run?.findings) ? run.findings : []).find((entry) => entry?.subject?.target_role === role);
  if (!finding) fail("RECOVERY_ROLE_SELECTION_PROVENANCE_UNAVAILABLE", "Durable inspection is missing the canonical Recovery finding for a selected role.", { role });
  assertCanonicalRoleRebuildFinding(finding);
  return finding;
}

export function buildRoleSelectionProof(run, role) {
  if (!ROLES.includes(role)) fail("RECOVERY_ROLE_SELECTION_PROVENANCE_UNAVAILABLE", "Role is not registered for selective baseline rebuild.", { role }, 400);
  const inspection = run?.evidence?.inspection;
  if (!inspection || run?.durable_full_inspection !== true || !Array.isArray(inspection.selected_zero_object_roles) || !inspection.selected_zero_object_roles.includes(role)) {
    fail("RECOVERY_ROLE_SELECTION_PROVENANCE_UNAVAILABLE", "Role is not selected by the durable canonical full inspection.", { role });
  }
  const finding = roleFinding(run, role);
  const fingerprint = text(inspection.role_database_object_count_fingerprints?.[role], 128).toLowerCase();
  if (!SHA256.test(fingerprint)) fail("RECOVERY_ROLE_SELECTION_PROVENANCE_UNAVAILABLE", "Selected role is missing its canonical object-count fingerprint.", { role });
  const proof = {
    source: "durable_full_inspection",
    expected_sha: run.expected_sha,
    selected_roles: [role],
    inspection_run_id: run.run_id,
    inspection_evidence_hash: run.inspection_evidence_hash,
    finding_ids: [finding.finding_id],
    role_object_count_fingerprints: { [role]: fingerprint },
    composite_target_fingerprint: run.target_fingerprint,
  };
  return { ...proof, selection_hash: computeRoleSelectionProofHash(proof) };
}

function roleBundleBinding(run, role) {
  const raw = run?.evidence?.inspection?.role_bundle_bindings?.[role];
  const validation = validateRoleBundleBinding(raw, {
    role,
    bundleManifestSha256: raw?.bundle_manifest_sha256,
    roleBundleSha256: raw?.role_bundle_sha256,
    statementCount: raw?.statement_count,
    statementFingerprints: raw?.statement_fingerprints,
  });
  if (!validation.ok) fail("RECOVERY_ROLE_BUNDLE_BINDING_INVALID", "Canonical role-specific rebuild plan requires an exact schema-bundle binding.", { role, problems: validation.problems });
  return validation.binding;
}

export function buildStagingRoleRebuildPlan({ expectedSha, idempotencyKey, run, role, attestation }) {
  const proof = buildRoleSelectionProof(run, role);
  const finding = roleFinding(run, role);
  const bundle = roleBundleBinding(run, role);
  const capabilityKey = `${role}.baseline.rebuild_empty`;
  const roleIdempotencyKey = `${idempotencyKey}:${role}`;
  const derivedAttestationHash = digest({
    contract: "mad4b.staging-role-target-attestation.v1",
    base_attestation_hash: attestation.attestation_hash,
    control_plane_target_fingerprint: run.control_plane_target_fingerprint,
    database_target_fingerprint: run.target_fingerprint,
    inspection_run_id: run.run_id,
    inspection_evidence_hash: run.inspection_evidence_hash,
    role,
    role_object_count_fingerprint: proof.role_object_count_fingerprints[role],
    role_bundle_binding: bundle,
  });
  const stepBase = {
    ordinal: 1,
    finding_id: finding.finding_id,
    classification: "empty_uninitialized_database",
    capability_key: capabilityKey,
    operation: "database.rebuild_empty",
    action: "apply_migration",
    target_role: role,
    ownership_domain: role,
    database_target_role: role,
    target_fingerprint: run.target_fingerprint,
    role_object_count_fingerprint: proof.role_object_count_fingerprints[role],
    role_object_classification: "zero_objects",
    inspection_run_id: run.run_id,
    inspection_evidence_hash: run.inspection_evidence_hash,
    authority_ref: capabilityKey,
    mutation_class: "C5",
    consequential: true,
    approval_required: true,
    execution_allowed: false,
    preconditions: [
      "staging_identity_match",
      "plan_hash_match",
      "database_target_fingerprint_match",
      "canonical_role_finding_match",
      "durable_role_selection_proof",
      "single_step_approval",
      "exact_role_bundle_binding",
      "same_cycle_zero_object_recheck",
    ],
    postconditions: [
      "selected_role_schema_readback",
      "preserved_non_selected_roles_unchanged",
      "same_cycle_readback",
      "ticket_finalized_once",
    ],
    deployment_attestation_required: true,
    role_bundle_binding_required: true,
    role_bundle_binding: bundle,
    rollback: "forward_only_or_capability_declared",
    role_selection_proof_hash: proof.selection_hash,
    execution_ticket_required: true,
    approval_binding_required: true,
    exact_durable_run_id_required: true,
    verification_before_finalization: true,
    grants_included: false,
    raw_sql_allowed: false,
  };
  const step = { ...stepBase, step_id: `step:${digest(stepBase).slice(0, 32)}`, step_hash: digest(stepBase) };
  const planIdentity = {
    expected_sha: expectedSha,
    target_key: "staging-runtime",
    inspection_run_id: run.run_id,
    inspection_evidence_hash: run.inspection_evidence_hash,
    role,
    role_selection_hash: proof.selection_hash,
    step_hash: step.step_hash,
    idempotency_key: roleIdempotencyKey,
  };
  const planId = `plan:${digest(planIdentity).slice(0, 32)}`;
  const base = {
    contract: "mad4b.recovery-remediation-plan.v1",
    trust_model: "mad4b.recovery-trust-model.v1",
    plan_adapter_contract: STAGING_ROLE_REBUILD_PLAN_ADAPTER_CONTRACT,
    plan_id: planId,
    environment: "staging",
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    branch: "main",
    expected_sha: expectedSha,
    expected_sha_at_creation: expectedSha,
    target_key: "staging-runtime",
    target_fingerprint: run.target_fingerprint,
    target_fingerprint_at_creation: run.target_fingerprint,
    target_fingerprints: { composite: run.target_fingerprint, [role]: run.target_fingerprint },
    database_target_fingerprint: run.target_fingerprint,
    control_plane_target_fingerprint: run.control_plane_target_fingerprint,
    manifest_hash: attestation.recovery_manifest_hash,
    runtime_attestation_hash: derivedAttestationHash,
    base_runtime_attestation_hash: attestation.attestation_hash,
    inspection_run_ids: [run.run_id],
    inspection_evidence_hashes: [run.inspection_evidence_hash],
    finding_ids: [finding.finding_id],
    finding_hash: digest([finding]),
    selected_rebuild_roles: [role],
    role_selection_proof: proof,
    role_selection_hash: proof.selection_hash,
    role_bundle_bindings: { [role]: bundle },
    steps: [step],
    status: "planned",
    blast_radius: { database_roles: [role], tables_max: null, schema_objects_max: "derived_from_role_bundle_manifest", rows_data_mutation: false, schema_mutation: true, grants_mutation: false, cross_database: false },
    mutation_scope: [{ step_id: step.step_id, operation: step.operation, target_role: role, capability_key: capabilityKey }],
    rollback_strategy: "capability_declared_forward_only",
    required_approval: "APPROVE_RECOVERY_STEP:<plan_hash>:<step_hash>:<expected_sha>:<target_key>",
    expected_postconditions: [...step.postconditions],
    idempotency_key: roleIdempotencyKey,
    database_independent_control_plane: true,
    proof: {
      manifest_bound: true,
      target_fingerprint_bound: true,
      role_selection_provenance_bound: true,
      role_bundle_bindings_bound: true,
      deployment_attestation_bound: true,
      authority_resolved: true,
      unknown_drift: false,
      preconditions_satisfied: true,
      execution_requires_fresh_trust_and_approval: true,
    },
    execution_transport: "verified_host_breakglass_local_only",
    execution_allowed: false,
    production_live_enabled: false,
    database_mutation_performed: false,
    grant_mutation_performed: false,
    provider_mutation_performed: false,
    raw_sql_allowed: false,
    caller_role_selection_allowed: false,
    access_repair_separate: true,
    secrets_included: false,
  };
  return { role, proof, step, plan: { ...base, plan_hash: digest(base) } };
}

export function buildRolePlanSetConfirmation(entries, expectedSha, inspectionRunId) {
  const ordered = [...entries]
    .sort((a, b) => a.role.localeCompare(b.role))
    .map((entry) => ({ role: entry.role, capability_key: entry.step.capability_key, plan_hash: entry.plan.plan_hash, step_hash: entry.step.step_hash, approval_hash: entry.approval?.challenge_hash || null }));
  const setHash = digest({ expected_sha: expectedSha, inspection_run_id: inspectionRunId, entries: ordered });
  return { set_hash: setHash, confirmation: `APPROVE_STAGING_ROLE_REBUILD_SET:${setHash}:${expectedSha}:${inspectionRunId}`, entries: ordered };
}

export const _testingStagingRoleRebuildPlanAdapter = Object.freeze({ digest, roleFinding, roleBundleBinding });
