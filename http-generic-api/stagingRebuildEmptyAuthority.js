import { createHash } from "node:crypto";
import { createApprovalChallenge } from "./recoveryKernel.js";
import { issueExecutionTicket } from "./recoveryExecutionTicket.js";
import { buildApprovalBinding, validateRoleBundleBinding } from "./recoveryExecutionBinding.js";
import { computeRoleSelectionProofHash } from "./roleSelectionProof.js";
import { deriveCanonicalRecoveryFindingsFromInspection, assertCanonicalRoleRebuildFinding } from "./recoveryKernelInspectionBridge.js";
import { buildStagingRoleRebuildPlan, buildRolePlanSetConfirmation } from "./stagingRoleRebuildPlanAdapter.js";
import { stagingRecoveryAuthorityInternals } from "./stagingRecoveryAuthorityBinding.js";

export const STAGING_REBUILD_EMPTY_AUTHORITY_CONTRACT = "mad4b.staging-rebuild-empty-authority.v2";
const ROLES = Object.freeze(["runtime", "governance", "runtime_persistence"]);
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;
const RUN_ID = /^run:[A-Za-z0-9._:-]{8,160}$/u;

const text = (value, max = 512) => String(value ?? "").trim().slice(0, max);
const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value;
const digest = (value) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

function fail(code, message, details = {}, status = 409) {
  throw Object.assign(new Error(message), { code, status, details: { ...details, production_authority: false, secrets_included: false } });
}

function requireSha(value, field, pattern = SHA256) {
  const normalized = text(value, 128).toLowerCase();
  if (!pattern.test(normalized)) fail(field === "expected_sha" ? "STAGING_SHA_MISMATCH" : "RECOVERY_TICKET_BINDING_MISMATCH", `${field} is invalid.`, { field }, 400);
  return normalized;
}

function requireSafeId(value, field, pattern = SAFE_ID) {
  const normalized = text(value, 180);
  if (!pattern.test(normalized)) fail("RECOVERY_TICKET_BINDING_MISMATCH", `${field} is invalid.`, { field }, 400);
  return normalized;
}

function assertExactKeys(input, allowed, label) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("STAGING_REBUILD_EMPTY_INPUT_INVALID", `${label} requires an object.`, {}, 400);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) fail("STAGING_REBUILD_EMPTY_FIELD_FORBIDDEN", `${label} accepts only bounded rebuild-empty references.`, { fields: unexpected }, 400);
}

function graphFor(env = process.env) {
  stagingRecoveryAuthorityInternals.runtime({ environment: "staging", runtime_class: "local_windows_docker", requested_mode: "injected_non_live", production_live: false }, env);
  const roots = stagingRecoveryAuthorityInternals.roots(env);
  return stagingRecoveryAuthorityInternals.adapters(roots.readiness, env).adapters;
}

function authorityGraph(env, injectedAuthorityGraph, adapters) {
  if (injectedAuthorityGraph && typeof injectedAuthorityGraph === "object") return injectedAuthorityGraph;
  const injected = Object.fromEntries(Object.entries(adapters || {}).filter(([, value]) => value !== undefined && value !== null));
  return { ...graphFor(env), ...injected };
}

async function attestExactDeployment(graph, expectedSha, expectedControlPlaneTargetFingerprint = null) {
  if (!graph.deploymentIdentityProvider?.readAttestation) fail("RECOVERY_DEPLOYMENT_ATTESTATION_UNAVAILABLE", "Staging deployment attestation is unavailable.", {}, 503);
  const attestation = await graph.deploymentIdentityProvider.readAttestation();
  const deploymentSha = text(attestation.sha || attestation.deployment_sha || attestation.repository_sha, 64).toLowerCase();
  const controlPlaneTargetFingerprint = text(attestation.target_fingerprint, 128).toLowerCase();
  if (attestation.environment !== "staging" || attestation.branch !== "main" || deploymentSha !== expectedSha || !SHA256.test(controlPlaneTargetFingerprint)) {
    fail(deploymentSha !== expectedSha ? "STAGING_SHA_MISMATCH" : "RECOVERY_TICKET_BINDING_MISMATCH", "Staging rebuild-empty authority is not bound to the exact main deployment and Recovery control-plane target.", { deployment_sha: deploymentSha || null }, 412);
  }
  if (expectedControlPlaneTargetFingerprint && controlPlaneTargetFingerprint !== expectedControlPlaneTargetFingerprint) {
    fail("RECOVERY_TICKET_BINDING_MISMATCH", "Staging Recovery control-plane identity changed after the durable inspection.", { control_plane_target_match: false }, 412);
  }
  const manifestHash = text(attestation.recovery_manifest_hash, 128).toLowerCase();
  const attestationHash = text(attestation.attestation_hash, 128).toLowerCase();
  if (attestation.manifest_bound !== true || !SHA256.test(manifestHash) || !SHA256.test(attestationHash)) {
    fail("RECOVERY_MANIFEST_BINDING_MISSING", "Staging rebuild-empty authority requires a valid repository-owned deployment attestation.", { manifest_bound: attestation.manifest_bound === true }, 412);
  }
  return {
    ...attestation,
    sha: deploymentSha,
    target_fingerprint: controlPlaneTargetFingerprint,
    control_plane_target_fingerprint: controlPlaneTargetFingerprint,
    recovery_manifest_hash: manifestHash,
    attestation_hash: attestationHash,
  };
}

function normalizeCounts(value, role) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalized = {};
  for (const key of ["tables", "views", "triggers", "routines", "events"]) {
    const count = Number(source[key] ?? 0);
    if (!Number.isSafeInteger(count) || count < 0) fail("STAGING_REBUILD_EMPTY_INSPECTION_INVALID", "Role object counts must be non-negative integers.", { role, object_kind: key }, 400);
    normalized[key] = count;
  }
  const computedTotal = Object.values(normalized).reduce((sum, count) => sum + count, 0);
  if (source.total !== undefined && Number(source.total) !== computedTotal) fail("STAGING_REBUILD_EMPTY_INSPECTION_INVALID", "Role object-count total does not match its object-kind census.", { role }, 400);
  normalized.total = computedTotal;
  return normalized;
}

function objectCountsFingerprint(counts) {
  const normalized = {
    tables: counts.tables,
    views: counts.views,
    triggers: counts.triggers,
    routines: counts.routines,
    events: counts.events,
    total: counts.total,
    legacy_table_only: false,
    secrets_included: false,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function normalizeBundleBindings(value, selectedRoles) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalized = {};
  for (const role of selectedRoles) {
    const binding = source[role];
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) fail("RECOVERY_ROLE_BUNDLE_BINDING_MISSING", "Every selected empty role requires an exact schema-bundle candidate binding before approval.", { role }, 409);
    const validation = validateRoleBundleBinding(binding, {
      role,
      bundleManifestSha256: binding.bundle_manifest_sha256,
      roleBundleSha256: binding.role_bundle_sha256,
      statementCount: binding.statement_count,
      statementFingerprints: binding.statement_fingerprints,
    });
    if (!validation.ok) fail("RECOVERY_ROLE_BUNDLE_BINDING_INVALID", "Selected role schema-bundle binding is invalid.", { role, problems: validation.problems }, 409);
    normalized[role] = validation.binding;
  }
  return normalized;
}

function normalizeInspection(input, expectedSha, controlPlaneTargetFingerprint) {
  const inspection = input?.inspection;
  if (!inspection || typeof inspection !== "object" || Array.isArray(inspection)) fail("STAGING_REBUILD_EMPTY_INSPECTION_INVALID", "A bounded full-inspection envelope is required.", {}, 400);
  if (inspection.full_inspection !== true || inspection.secrets_included !== false) fail("STAGING_REBUILD_EMPTY_INSPECTION_INVALID", "Rebuild-empty requires a redacted full inspection.", {}, 400);
  for (const flag of ["database_mutation_performed", "sql_mutation_performed", "migration_apply_performed", "grant_mutation_performed", "provider_mutation_performed", "deployment_performed", "workflow_dispatch_performed"]) {
    if (inspection[flag] === true) fail("STAGING_REBUILD_EMPTY_INSPECTION_MUTATED", "Durable role selection must come from a read-only inspection cycle.", { flag }, 409);
  }
  const databaseTargetFingerprint = requireSha(inspection.database_target_fingerprint, "database_target_fingerprint");
  if (text(inspection.database_target_fingerprint_source, 96) !== "runtime_bootstrap_target_binding") {
    fail("STAGING_REBUILD_EMPTY_DATABASE_TARGET_BINDING_INVALID", "The local database target fingerprint must be derived by the runtime bootstrap target-binding contract.", {}, 409);
  }
  const countsSource = inspection.role_database_object_counts;
  const classificationsSource = inspection.role_database_object_classifications;
  const fingerprintsSource = inspection.role_database_object_count_fingerprints;
  if (!countsSource || !classificationsSource || !fingerprintsSource) fail("STAGING_REBUILD_EMPTY_INSPECTION_INVALID", "Full inspection is missing role census evidence.", {}, 400);
  const counts = {};
  const classifications = {};
  const fingerprints = {};
  const selectedRoles = [];
  const preservedRoles = [];
  for (const role of ROLES) {
    counts[role] = normalizeCounts(countsSource[role], role);
    classifications[role] = text(classificationsSource[role], 64);
    fingerprints[role] = requireSha(fingerprintsSource[role], `role_database_object_count_fingerprints.${role}`);
    const canonicalFingerprint = objectCountsFingerprint(counts[role]);
    if (fingerprints[role] !== canonicalFingerprint) {
      fail("STAGING_REBUILD_EMPTY_INSPECTION_FINGERPRINT_MISMATCH", "Role object-count fingerprint does not match the canonical normalized object census.", { role }, 409);
    }
    const expectedClassification = counts[role].total === 0 ? "zero_objects" : "nonempty_objects";
    if (classifications[role] !== expectedClassification) fail("STAGING_REBUILD_EMPTY_INSPECTION_INVALID", "Role classification disagrees with the object census.", { role, expected_classification: expectedClassification, observed_classification: classifications[role] }, 409);
    (counts[role].total === 0 ? selectedRoles : preservedRoles).push(role);
  }
  if (!selectedRoles.length) fail("STAGING_REBUILD_EMPTY_NO_ZERO_ROLE", "No role is eligible for rebuild_empty in this inspection.", {}, 409);
  const roleBundleBindings = normalizeBundleBindings(input.role_bundle_bindings, selectedRoles);
  return {
    contract: "mad4b.staging-durable-full-inspection.v2",
    expected_sha: expectedSha,
    target_key: "staging-runtime",
    target_fingerprint: databaseTargetFingerprint,
    database_target_fingerprint: databaseTargetFingerprint,
    control_plane_target_fingerprint: controlPlaneTargetFingerprint,
    full_inspection: true,
    role_database_object_counts: counts,
    role_database_object_classifications: classifications,
    role_database_object_count_fingerprints: fingerprints,
    selected_zero_object_roles: selectedRoles,
    preserved_nonempty_roles: preservedRoles,
    role_bundle_bindings: roleBundleBindings,
    role_bundle_binding_source: "local_exact_sha_candidate_reverified_before_mutation",
    read_only_probe: inspection.read_only_probe === true || inspection.read_only === true,
    database_connection_performed: inspection.database_connection_performed === true,
    database_mutation_performed: false,
    sql_mutation_performed: false,
    migration_apply_performed: false,
    grant_mutation_performed: false,
    provider_mutation_performed: false,
    deployment_performed: false,
    workflow_dispatch_performed: false,
    production_accessed: false,
    secrets_included: false,
  };
}

function proofFromRun(run) {
  const inspection = run?.evidence?.inspection;
  if (!run || !inspection || inspection.full_inspection !== true || run.durable_full_inspection !== true) fail("RECOVERY_ROLE_SELECTION_PROVENANCE_UNAVAILABLE", "Durable Staging full-inspection record is unavailable.", {}, 404);
  const selectedRoles = [...(inspection.selected_zero_object_roles || [])].filter((role) => ROLES.includes(role));
  if (!selectedRoles.length) fail("RECOVERY_ROLE_SELECTION_PROVENANCE_UNAVAILABLE", "Durable inspection contains no rebuild-empty role selection.", {}, 409);
  const findingIds = selectedRoles.map((role) => run.finding_ids_by_role?.[role]).filter(Boolean).sort();
  if (findingIds.length !== selectedRoles.length) fail("RECOVERY_ROLE_SELECTION_PROVENANCE_UNAVAILABLE", "Durable inspection findings are incomplete for selected roles.", {}, 409);
  const roleFingerprints = Object.fromEntries(selectedRoles.map((role) => [role, requireSha(inspection.role_database_object_count_fingerprints?.[role], `role_object_count_fingerprints.${role}`)]));
  const proof = {
    source: "durable_full_inspection",
    expected_sha: run.expected_sha,
    selected_roles: selectedRoles,
    inspection_run_id: run.run_id,
    inspection_evidence_hash: requireSha(run.inspection_evidence_hash, "inspection_evidence_hash"),
    finding_ids: findingIds,
    role_object_count_fingerprints: roleFingerprints,
    composite_target_fingerprint: requireSha(run.target_fingerprint, "composite_target_fingerprint"),
  };
  return { ...proof, selection_hash: computeRoleSelectionProofHash(proof) };
}

function approvalContext(plan, step, approval) {
  return {
    plan_hash: plan.plan_hash,
    step_id: step.step_id,
    step_hash: step.step_hash,
    expected_sha: plan.expected_sha,
    target_key: plan.target_key,
    target_fingerprint: plan.target_fingerprint,
    composite_target_fingerprint: plan.target_fingerprint,
    step_target_fingerprint: step.target_fingerprint,
    target_role: step.target_role,
    operation: step.operation,
    approval_id: approval.approval_id,
    approval_hash: approval.challenge_hash,
  };
}

function issuedRoleTicketReceipt(plan, step, ticket, run) {
  return {
    ok: true,
    contract: STAGING_REBUILD_EMPTY_AUTHORITY_CONTRACT,
    status: "execution_ticket_issued",
    canonical_capability_key: step.capability_key,
    target_role: step.target_role,
    plan_id: plan.plan_id,
    authority_plan_hash: plan.plan_hash,
    step_id: step.step_id,
    step_hash: step.step_hash,
    expected_sha: plan.expected_sha,
    target_key: plan.target_key,
    target_fingerprint: plan.target_fingerprint,
    database_target_fingerprint: plan.database_target_fingerprint,
    control_plane_target_fingerprint: plan.control_plane_target_fingerprint,
    inspection_run_id: plan.role_selection_proof.inspection_run_id,
    role_selection_proof: structuredClone(plan.role_selection_proof),
    selected_zero_object_roles: [step.target_role],
    inspection_selected_zero_object_roles: [...run.evidence.inspection.selected_zero_object_roles],
    preserved_nonempty_roles: [...run.evidence.inspection.preserved_nonempty_roles],
    execution_ticket_id: ticket.ticket_id,
    execution_ticket_hash: ticket.ticket_hash,
    idempotency_key: plan.idempotency_key,
    execution_ticket_signature_returned: false,
    approval_token_returned: false,
    grants_included: false,
    access_repair_separate: true,
    database_mutation_performed: false,
    production_authority: false,
    secrets_included: false,
  };
}

export function createStagingRebuildEmptyAuthority({ env = process.env, adapters = null, authorityGraph: injectedGraph = null } = {}) {
  const graph = authorityGraph(env, injectedGraph, adapters);
  const store = graph.recoveryStore;
  if (!store?.putRun || !store?.getRun || !store?.putFinding || !store?.putPlan || !store?.getPlan || !store?.getApprovalByPlanStep || !store?.putExecutionTicket || !store?.getExecutionTicket || !store?.reserveApproval || !store?.releaseApprovalReservation || !store?.markApprovalUsed || !graph.approvalIssuer?.createChallenge || !graph.approvalVerifier?.verify || !graph.executionTicketSigner?.sign) {
    fail("RECOVERY_APPROVAL_CHALLENGE_AUTHORITY_UNAVAILABLE", "Staging rebuild-empty durable Recovery authorities are incomplete.", {}, 503);
  }

  const getRun = async (expectedSha, inspectionRunId) => {
    const run = await store.getRun(inspectionRunId);
    if (!run || run.expected_sha !== expectedSha || run.target_key !== "staging-runtime" || run.durable_full_inspection !== true) fail("RECOVERY_ROLE_SELECTION_PROVENANCE_UNAVAILABLE", "Rebuild-empty requires the exact durable Staging inspection run.", { inspection_run_id: inspectionRunId }, 404);
    return run;
  };

  const prepareRoleSet = async ({ expectedSha, inspectionRunId, idempotencyKey }) => {
    const run = await getRun(expectedSha, inspectionRunId);
    const proof = proofFromRun(run);
    const attestation = await attestExactDeployment(graph, expectedSha, run.control_plane_target_fingerprint);
    const entries = [];
    for (const role of proof.selected_roles) {
      const built = buildStagingRoleRebuildPlan({ expectedSha, idempotencyKey, run, role, attestation });
      const existingPlan = await store.getPlan(built.plan.plan_id);
      if (existingPlan && (existingPlan.plan_hash !== built.plan.plan_hash || existingPlan.idempotency_key !== built.plan.idempotency_key || existingPlan.steps?.[0]?.capability_key !== `${role}.baseline.rebuild_empty`)) {
        fail("RECOVERY_IDEMPOTENCY_CONFLICT", "Role-specific rebuild prepare is already bound to different canonical Recovery content.", { role, plan_id: built.plan.plan_id }, 409);
      }
      if (!existingPlan) await store.putPlan(built.plan);
      const plan = existingPlan || built.plan;
      const step = plan.steps?.[0];
      if (!step || step.capability_key !== `${role}.baseline.rebuild_empty` || step.target_role !== role || step.operation !== "database.rebuild_empty") {
        fail("RECOVERY_ROLE_REBUILD_PLAN_INVALID", "Persisted Staging rebuild plan is not the canonical role-specific Recovery capability.", { role, plan_id: plan.plan_id }, 409);
      }
      let approval = await store.getApprovalByPlanStep(plan.plan_id, step.step_id);
      const approvedOrTicketed = plan.status === "approved" || Boolean(plan.execution_ticket_id);
      if (approvedOrTicketed) {
        if (!approval) fail("RECOVERY_APPROVAL_INVALID", "Approved role rebuild plan is missing its durable Recovery approval challenge.", { role, plan_id: plan.plan_id }, 409);
      } else {
        const expiresAt = Date.parse(approval?.expires_at || 0);
        const reusable = Boolean(approval && approval.used !== true && Number.isFinite(expiresAt) && expiresAt > Date.now());
        if (approval?.used === true) fail("RECOVERY_APPROVAL_INVALID", "Role rebuild prepare found a consumed approval before ticket issuance was durably attached to the plan.", { role, plan_id: plan.plan_id }, 409);
        if (!reusable) approval = await createApprovalChallenge({ plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id }, { approvalIssuer: graph.approvalIssuer, approvalStore: graph.approvalStore, recoveryStore: store });
      }
      entries.push({ role, plan, step, approval });
    }
    const approvalSet = buildRolePlanSetConfirmation(entries, expectedSha, inspectionRunId);
    return { run, proof, attestation, entries, approvalSet };
  };

  const resolveProof = async (input = {}) => {
    const expectedSha = requireSha(input.expected_sha, "expected_sha", SHA40);
    const targetKey = text(input.target_key || "staging-runtime", 128);
    if (targetKey !== "staging-runtime") fail("RECOVERY_TICKET_BINDING_MISMATCH", "Staging rebuild_empty is bound to staging-runtime.", { target_key: targetKey }, 400);
    const inspectionRunId = requireSafeId(input.inspection_run_id || input.role_selection_proof?.inspection_run_id, "inspection_run_id", RUN_ID);
    const run = await getRun(expectedSha, inspectionRunId);
    await attestExactDeployment(graph, expectedSha, run.control_plane_target_fingerprint);
    return proofFromRun(run);
  };

  return Object.freeze({
    contract: STAGING_REBUILD_EMPTY_AUTHORITY_CONTRACT,
    canonical_capabilities: ROLES.map((role) => `${role}.baseline.rebuild_empty`),
    production_authority: false,
    resolveProof,

    async recordInspection(input = {}) {
      assertExactKeys(input, new Set(["expected_sha", "target_key", "correlation_id", "inspection", "role_bundle_bindings"]), "Rebuild-empty inspection recording");
      const expectedSha = requireSha(input.expected_sha, "expected_sha", SHA40);
      const targetKey = text(input.target_key || "staging-runtime", 128);
      if (targetKey !== "staging-runtime") fail("RECOVERY_TICKET_BINDING_MISMATCH", "Staging rebuild_empty inspection is bound to staging-runtime.", { target_key: targetKey }, 400);
      const correlationId = requireSafeId(input.correlation_id, "correlation_id");
      const attestation = await attestExactDeployment(graph, expectedSha);
      const inspection = normalizeInspection(input, expectedSha, attestation.control_plane_target_fingerprint);
      const inspectionEvidenceHash = digest(inspection);
      const runId = `run:${digest({ expected_sha: expectedSha, target_key: targetKey, target_fingerprint: inspection.target_fingerprint, control_plane_target_fingerprint: attestation.control_plane_target_fingerprint, inspection_evidence_hash: inspectionEvidenceHash, correlation_id: correlationId }).slice(0, 32)}`;
      const canonicalFindings = deriveCanonicalRecoveryFindingsFromInspection(inspection)
        .filter((finding) => /^(runtime|governance|runtime_persistence)\.baseline\.rebuild_empty$/u.test(text(finding?.candidate_capability, 160)))
        .map((finding) => ({ ...finding, inspection_run_id: runId, inspection_evidence_hash: inspectionEvidenceHash }));
      const findingRoles = canonicalFindings.map((finding) => assertCanonicalRoleRebuildFinding(finding).target_role).sort();
      const selectedRoles = [...inspection.selected_zero_object_roles].sort();
      if (JSON.stringify(findingRoles) !== JSON.stringify(selectedRoles)) {
        fail("RECOVERY_CANONICAL_INSPECTION_CLASSIFICATION_MISMATCH", "Canonical Recovery Kernel findings disagree with the normalized Staging full inspection; no durable role selection was recorded.", { canonical_roles: findingRoles, normalized_roles: selectedRoles }, 409);
      }
      const findingIdsByRole = Object.fromEntries(canonicalFindings.map((finding) => [finding.subject.target_role, finding.finding_id]));
      const run = {
        contract: "mad4b.staging-durable-full-inspection-run.v3",
        run_id: runId,
        status: "classified",
        phase: "classified",
        expected_sha: expectedSha,
        target_key: targetKey,
        target_fingerprint: inspection.target_fingerprint,
        control_plane_target_fingerprint: attestation.control_plane_target_fingerprint,
        correlation_id: correlationId,
        inspection_evidence_hash: inspectionEvidenceHash,
        durable_full_inspection: true,
        canonical_finding_classifier: "RecoveryKernel.findingsFromInspection",
        finding_ids_by_role: findingIdsByRole,
        findings: canonicalFindings,
        evidence: { inspection, findings: canonicalFindings, deployment_attestation_hash: attestation.attestation_hash, secrets_included: false },
        database_mutation_performed: false,
        provider_mutation_performed: false,
        production_authority: false,
        secrets_included: false,
      };
      for (const finding of canonicalFindings) await store.putFinding(finding);
      await store.putRun(run);
      const proof = proofFromRun(run);
      return {
        ok: true,
        contract: STAGING_REBUILD_EMPTY_AUTHORITY_CONTRACT,
        status: "durable_full_inspection_recorded",
        inspection_run_id: runId,
        inspection_evidence_hash: inspectionEvidenceHash,
        target_fingerprint: run.target_fingerprint,
        control_plane_target_fingerprint: run.control_plane_target_fingerprint,
        selected_zero_object_roles: [...proof.selected_roles],
        selected_capability_keys: proof.selected_roles.map((role) => `${role}.baseline.rebuild_empty`),
        preserved_nonempty_roles: [...inspection.preserved_nonempty_roles],
        role_selection_hash: proof.selection_hash,
        role_selection_authoritative: true,
        canonical_finding_classifier: run.canonical_finding_classifier,
        database_mutation_performed: false,
        grant_mutation_performed: false,
        production_authority: false,
        secrets_included: false,
      };
    },

    async prepare(input = {}) {
      assertExactKeys(input, new Set(["expected_sha", "inspection_run_id", "idempotency_key"]), "Rebuild-empty prepare");
      const expectedSha = requireSha(input.expected_sha, "expected_sha", SHA40);
      const inspectionRunId = requireSafeId(input.inspection_run_id, "inspection_run_id", RUN_ID);
      const idempotencyKey = requireSafeId(input.idempotency_key, "idempotency_key");
      const prepared = await prepareRoleSet({ expectedSha, inspectionRunId, idempotencyKey });
      const allApproved = prepared.entries.every((entry) => entry.plan.status === "approved" && entry.plan.execution_ticket_id && entry.plan.execution_ticket_hash);
      return {
        ok: true,
        contract: STAGING_REBUILD_EMPTY_AUTHORITY_CONTRACT,
        status: allApproved ? "execution_tickets_already_issued" : "approval_required",
        expected_sha: expectedSha,
        target_key: "staging-runtime",
        target_fingerprint: prepared.run.target_fingerprint,
        control_plane_target_fingerprint: prepared.run.control_plane_target_fingerprint,
        inspection_run_id: inspectionRunId,
        role_selection_proof: structuredClone(prepared.proof),
        selected_zero_object_roles: [...prepared.proof.selected_roles],
        selected_capability_keys: prepared.entries.map((entry) => entry.step.capability_key),
        preserved_nonempty_roles: [...prepared.run.evidence.inspection.preserved_nonempty_roles],
        approval_set_hash: prepared.approvalSet.set_hash,
        approval_confirmation: prepared.approvalSet.confirmation,
        role_plans: prepared.entries.map((entry) => ({
          role: entry.role,
          capability_key: entry.step.capability_key,
          plan_id: entry.plan.plan_id,
          authority_plan_hash: entry.plan.plan_hash,
          step_id: entry.step.step_id,
          step_hash: entry.step.step_hash,
          approval_id: entry.approval.approval_id,
          approval_hash: entry.approval.challenge_hash,
          idempotency_key: entry.plan.idempotency_key,
          status: entry.plan.status,
        })),
        grants_included: false,
        access_repair_separate: true,
        caller_role_selection_allowed: false,
        approval_token_not_returned: true,
        execution_ticket_not_returned: true,
        database_mutation_performed: false,
        production_authority: false,
        secrets_included: false,
      };
    },

    async approveAndIssue(input = {}) {
      assertExactKeys(input, new Set(["expected_sha", "inspection_run_id", "idempotency_key", "approval_confirmation"]), "Rebuild-empty approval");
      const expectedSha = requireSha(input.expected_sha, "expected_sha", SHA40);
      const inspectionRunId = requireSafeId(input.inspection_run_id, "inspection_run_id", RUN_ID);
      const idempotencyKey = requireSafeId(input.idempotency_key, "idempotency_key");
      const prepared = await prepareRoleSet({ expectedSha, inspectionRunId, idempotencyKey });
      if (text(input.approval_confirmation, 1024) !== prepared.approvalSet.confirmation) {
        fail("RECOVERY_APPROVAL_INVALID", "Exact high-level approval for the complete server-derived role-plan set is required.", { confirmation_formula: "APPROVE_STAGING_ROLE_REBUILD_SET:<set_hash>:<expected_sha>:<inspection_run_id>" }, 401);
      }
      await attestExactDeployment(graph, expectedSha, prepared.run.control_plane_target_fingerprint);
      const issuances = [];
      for (const entry of prepared.entries) {
        let plan = await store.getPlan(entry.plan.plan_id);
        const step = plan.steps?.[0];
        const role = entry.role;
        if (plan.execution_ticket_id || plan.status === "approved") {
          if (plan.approved_idempotency_key === plan.idempotency_key && plan.execution_ticket_id && plan.execution_ticket_hash) {
            const existingTicket = await store.getExecutionTicket(plan.execution_ticket_id);
            if (existingTicket?.ticket_hash === plan.execution_ticket_hash) {
              issuances.push(issuedRoleTicketReceipt(plan, step, existingTicket, prepared.run));
              continue;
            }
          }
          fail("RECOVERY_APPROVAL_INVALID", "Role rebuild approval already issued a ticket for a different request or lost its durable ticket binding.", { role, plan_id: plan.plan_id }, 409);
        }
        const approval = await store.getApprovalByPlanStep(plan.plan_id, step.step_id);
        if (!approval || approval.used === true || Date.parse(approval.expires_at || 0) <= Date.now()) fail("RECOVERY_APPROVAL_INVALID", "The role-plan approval challenge is absent, expired, or already used.", { role }, 401);
        const issuedApproval = await graph.approvalIssuer.createChallenge(approval);
        const approvalToken = issuedApproval?.server_token;
        const context = approvalContext(plan, step, approval);
        if ((await graph.approvalVerifier.verify({ token: approvalToken, approval, context })) !== true) fail("RECOVERY_APPROVAL_INVALID", "Server-managed Recovery approval verification failed closed.", { role }, 401);
        const approvalBinding = buildApprovalBinding({ approvalId: approval.approval_id, approvalHash: approval.challenge_hash, approvalVersion: approval.approval_version || "v1", planHash: plan.plan_hash, stepId: step.step_id, stepHash: step.step_hash, targetKey: plan.target_key, targetFingerprint: plan.target_fingerprint, targetRole: role, operation: step.operation });
        const reservation = await store.reserveApproval({ ...context, approval_hash: approvalBinding.approval_hash, approval_binding_hash: approvalBinding.binding_hash, idempotency_key: plan.idempotency_key, execution_ticket_id: null });
        if (reservation?.reserved !== true && reservation?.same_idempotency !== true && reservation?.existing !== true) fail("RECOVERY_APPROVAL_INVALID", "The role-plan approval challenge is already reserved or consumed.", { role, reconciliation_required: true }, 409);
        let ticketPersisted = false;
        try {
          const ticket = await issueExecutionTicket({
            inspection_run_id: plan.role_selection_proof.inspection_run_id,
            inspection_evidence_hash: plan.role_selection_proof.inspection_evidence_hash,
            finding_ids: plan.finding_ids,
            selected_roles: [role],
            role_selection_required: true,
            role_selection_hash: plan.role_selection_hash,
            role_object_count_fingerprints: plan.role_selection_proof.role_object_count_fingerprints,
            role_bundle_bindings: plan.role_bundle_bindings,
            target_fingerprints: { composite: plan.target_fingerprint, [role]: plan.target_fingerprint },
            deployment_attestation_hash: plan.runtime_attestation_hash,
            approval_id: approvalBinding.approval_id,
            approval_hash: approvalBinding.approval_hash,
            approval_version: approvalBinding.approval_version,
            approval_binding: approvalBinding,
            production_sha: plan.expected_sha,
            target_key: plan.target_key,
            target_fingerprint: plan.target_fingerprint,
            plan_hash: plan.plan_hash,
            step_hash: step.step_hash,
            step_id: step.step_id,
            target_role: role,
            operation: "database.rebuild_empty",
            idempotency_key: plan.idempotency_key,
            expires_at: approval.expires_at,
            nonce: `nonce:${digest({ plan_hash: plan.plan_hash, approval_id: approval.approval_id, idempotency_key: plan.idempotency_key, role })}`,
          }, { signer: graph.executionTicketSigner });
          await store.putExecutionTicket(ticket);
          ticketPersisted = true;
          plan = { ...plan, status: "approved", execution_ticket_id: ticket.ticket_id, execution_ticket_hash: ticket.ticket_hash, approved_idempotency_key: plan.idempotency_key, approved_at: new Date().toISOString() };
          await store.putPlan(plan);
          await store.markApprovalUsed(approval.approval_id);
          issuances.push(issuedRoleTicketReceipt(plan, step, ticket, prepared.run));
        } catch (error) {
          if (!ticketPersisted) await store.releaseApprovalReservation({ approval_id: approval.approval_id, idempotency_key: plan.idempotency_key }).catch(() => {});
          throw error;
        }
      }
      return {
        ok: true,
        contract: STAGING_REBUILD_EMPTY_AUTHORITY_CONTRACT,
        status: "role_execution_tickets_issued",
        expected_sha: expectedSha,
        inspection_run_id: inspectionRunId,
        approval_set_hash: prepared.approvalSet.set_hash,
        selected_zero_object_roles: [...prepared.proof.selected_roles],
        selected_capability_keys: issuances.map((entry) => entry.canonical_capability_key),
        preserved_nonempty_roles: [...prepared.run.evidence.inspection.preserved_nonempty_roles],
        role_issuances: issuances,
        grants_included: false,
        access_repair_separate: true,
        database_mutation_performed: false,
        production_authority: false,
        secrets_included: false,
      };
    },
  });
}

export const _testingStagingRebuildEmptyAuthority = Object.freeze({ normalizeInspection, proofFromRun, objectCountsFingerprint, digest });
