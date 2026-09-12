import { createHash, randomUUID } from "node:crypto";
import { createApprovalChallenge } from "./recoveryKernel.js";
import { issueExecutionTicket } from "./recoveryExecutionTicket.js";
import { buildApprovalBinding, validateRoleBundleBinding } from "./recoveryExecutionBinding.js";
import { computeRoleSelectionProofHash } from "./roleSelectionProof.js";
import { stagingRecoveryAuthorityInternals } from "./stagingRecoveryAuthorityBinding.js";

export const STAGING_REBUILD_EMPTY_AUTHORITY_CONTRACT = "mad4b.staging-rebuild-empty-authority.v1";
export const STAGING_REBUILD_EMPTY_CAPABILITY = "staging_database_rebuild_empty";
const ROLES = Object.freeze(["runtime", "governance", "runtime_persistence"]);
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;
const RUN_ID = /^run:[A-Za-z0-9._:-]{8,160}$/u;
const PLAN_ID = /^plan:[0-9a-f]{32}$/u;
const STEP_ID = /^step:[0-9a-f]{32}$/u;

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

function buildPlan({ expectedSha, idempotencyKey, run, proof, attestation }) {
  const stepBase = {
    ordinal: 1,
    classification: "staging_selective_empty_role_rebuild",
    capability_key: STAGING_REBUILD_EMPTY_CAPABILITY,
    operation: "database.rebuild_empty",
    action: "apply_migration",
    target_role: "composite",
    target_fingerprint: run.target_fingerprint,
    selected_roles: [...proof.selected_roles],
    role_selection_hash: proof.selection_hash,
    mutation_class: "C5",
    consequential: true,
    approval_required: true,
    execution_ticket_required: true,
    verification_before_finalization: true,
    grants_included: false,
    raw_sql_allowed: false,
    caller_role_selection_allowed: false,
    rollback: "forward_only_reconciliation_before_any_replay",
  };
  const stepHash = digest(stepBase);
  const step = { ...stepBase, step_id: `step:${stepHash.slice(0, 32)}`, step_hash: stepHash };
  const planIdentity = {
    expected_sha: expectedSha,
    inspection_run_id: run.run_id,
    inspection_evidence_hash: run.inspection_evidence_hash,
    role_selection_hash: proof.selection_hash,
    target_fingerprint: run.target_fingerprint,
    control_plane_target_fingerprint: run.control_plane_target_fingerprint,
    step_hash: stepHash,
    idempotency_key: idempotencyKey,
  };
  const planId = `plan:${digest(planIdentity).slice(0, 32)}`;
  const base = {
    contract: "mad4b.recovery-remediation-plan.v1",
    plan_id: planId,
    environment: "staging",
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    branch: "main",
    expected_sha: expectedSha,
    expected_sha_at_creation: expectedSha,
    target_key: "staging-runtime",
    target_fingerprint: run.target_fingerprint,
    target_fingerprint_at_creation: run.target_fingerprint,
    target_fingerprints: { composite: run.target_fingerprint },
    control_plane_target_fingerprint: run.control_plane_target_fingerprint,
    manifest_hash: attestation.recovery_manifest_hash,
    runtime_attestation_hash: attestation.attestation_hash,
    inspection_run_id: run.run_id,
    inspection_evidence_hash: run.inspection_evidence_hash,
    finding_ids: [...proof.finding_ids],
    role_selection_hash: proof.selection_hash,
    role_selection_proof: proof,
    role_bundle_bindings: structuredClone(run.evidence.inspection.role_bundle_bindings),
    preserved_nonempty_roles: [...run.evidence.inspection.preserved_nonempty_roles],
    steps: [step],
    status: "planned",
    repair_key: STAGING_REBUILD_EMPTY_CAPABILITY,
    required_approval: "server_managed_staging_selective_empty_role_rebuild",
    execution_allowed: false,
    database_independent_control_plane: true,
    production_live_enabled: false,
    database_mutation_performed: false,
    grant_mutation_performed: false,
    provider_mutation_performed: false,
    raw_sql_allowed: false,
    caller_role_selection_allowed: false,
    access_repair_separate: true,
    idempotency_key: idempotencyKey,
    secrets_included: false,
  };
  return { step, plan: { ...base, plan_hash: digest(base) } };
}

function approvalConfirmation(plan, step) {
  return `APPROVE_STAGING_DATABASE_REBUILD_EMPTY:${plan.plan_hash}:${step.step_hash}:${plan.expected_sha}:${plan.target_key}:${plan.role_selection_hash}`;
}

function issuedTicketReceipt(plan, ticket) {
  return {
    ok: true,
    contract: STAGING_REBUILD_EMPTY_AUTHORITY_CONTRACT,
    status: "execution_ticket_issued",
    plan_id: plan.plan_id,
    authority_plan_hash: plan.plan_hash,
    step_id: plan.steps?.[0]?.step_id || null,
    expected_sha: plan.expected_sha,
    target_key: plan.target_key,
    target_fingerprint: plan.target_fingerprint,
    control_plane_target_fingerprint: plan.control_plane_target_fingerprint,
    inspection_run_id: plan.inspection_run_id,
    role_selection_proof: structuredClone(plan.role_selection_proof),
    selected_zero_object_roles: [...plan.role_selection_proof.selected_roles],
    preserved_nonempty_roles: [...plan.preserved_nonempty_roles],
    execution_ticket_id: ticket.ticket_id,
    execution_ticket_hash: ticket.ticket_hash,
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
    fail("RECOVERY_APPROVAL_CHALLENGE_AUTHORITY_UNAVAILABLE", "Staging rebuild-empty durable approval/ticket authorities are incomplete.", {}, 503);
  }

  const resolveProof = async (input = {}) => {
    const expectedSha = requireSha(input.expected_sha, "expected_sha", SHA40);
    const targetKey = text(input.target_key || "staging-runtime", 128);
    if (targetKey !== "staging-runtime") fail("RECOVERY_TICKET_BINDING_MISMATCH", "Staging rebuild_empty is bound to staging-runtime.", { target_key: targetKey }, 400);
    const inspectionRunId = requireSafeId(input.inspection_run_id || input.role_selection_proof?.inspection_run_id, "inspection_run_id", RUN_ID);
    const run = await store.getRun(inspectionRunId);
    if (!run || run.expected_sha !== expectedSha || run.target_key !== targetKey || run.durable_full_inspection !== true) fail("RECOVERY_ROLE_SELECTION_PROVENANCE_UNAVAILABLE", "Requested inspection run is not a durable exact-SHA Staging full inspection.", { inspection_run_id: inspectionRunId }, 404);
    await attestExactDeployment(graph, expectedSha, run.control_plane_target_fingerprint);
    return proofFromRun(run);
  };

  return Object.freeze({
    contract: STAGING_REBUILD_EMPTY_AUTHORITY_CONTRACT,
    capability: STAGING_REBUILD_EMPTY_CAPABILITY,
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
      const findingIdsByRole = {};
      const findings = [];
      for (const role of inspection.selected_zero_object_roles) {
        const findingBase = {
          contract: "mad4b.staging-rebuild-empty-finding.v1",
          category: "empty_uninitialized_database",
          candidate_capability: `${role}.baseline.rebuild_empty`,
          target_role: role,
          target_fingerprint: inspection.target_fingerprint,
          inspection_run_id: runId,
          inspection_evidence_hash: inspectionEvidenceHash,
          object_count_fingerprint: inspection.role_database_object_count_fingerprints[role],
          role_bundle_binding: inspection.role_bundle_bindings[role],
          mutation_required: true,
          repairability: "deterministic",
          server_selected_from_full_inspection: true,
          secrets_included: false,
        };
        const findingId = `finding:${digest(findingBase).slice(0, 32)}`;
        findingIdsByRole[role] = findingId;
        findings.push({ finding_id: findingId, ...findingBase });
      }
      const run = {
        contract: "mad4b.staging-durable-full-inspection-run.v2",
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
        finding_ids_by_role: findingIdsByRole,
        findings,
        evidence: { inspection, deployment_attestation_hash: attestation.attestation_hash, secrets_included: false },
        database_mutation_performed: false,
        provider_mutation_performed: false,
        production_authority: false,
        secrets_included: false,
      };
      for (const finding of findings) await store.putFinding(finding);
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
        preserved_nonempty_roles: [...inspection.preserved_nonempty_roles],
        role_selection_hash: proof.selection_hash,
        role_selection_authoritative: true,
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
      const run = await store.getRun(inspectionRunId);
      if (!run || run.expected_sha !== expectedSha || run.target_key !== "staging-runtime" || run.durable_full_inspection !== true) fail("RECOVERY_ROLE_SELECTION_PROVENANCE_UNAVAILABLE", "Rebuild-empty prepare requires the exact durable Staging inspection run.", { inspection_run_id: inspectionRunId }, 404);
      const proof = proofFromRun(run);
      const attestation = await attestExactDeployment(graph, expectedSha, run.control_plane_target_fingerprint);
      const { step, plan } = buildPlan({ expectedSha, idempotencyKey, run, proof, attestation });
      const existingPlan = await store.getPlan(plan.plan_id);
      if (existingPlan && (existingPlan.plan_hash !== plan.plan_hash || existingPlan.idempotency_key !== idempotencyKey)) {
        fail("RECOVERY_IDEMPOTENCY_CONFLICT", "Rebuild-empty prepare idempotency key is already bound to different plan content.", { plan_id: plan.plan_id }, 409);
      }
      if (!existingPlan) await store.putPlan(plan);
      const effectivePlan = existingPlan || plan;
      const effectiveStep = effectivePlan.steps?.find((entry) => entry.step_id === step.step_id) || step;
      const challenge = await createApprovalChallenge({ plan_id: effectivePlan.plan_id, plan_hash: effectivePlan.plan_hash, step_id: effectiveStep.step_id }, { approvalIssuer: graph.approvalIssuer, approvalStore: graph.approvalStore, recoveryStore: store });
      return {
        ok: true,
        contract: STAGING_REBUILD_EMPTY_AUTHORITY_CONTRACT,
        status: effectivePlan.status === "approved" ? "execution_ticket_already_issued" : "approval_required",
        plan_id: effectivePlan.plan_id,
        authority_plan_hash: effectivePlan.plan_hash,
        step_id: effectiveStep.step_id,
        step_hash: effectiveStep.step_hash,
        approval_id: challenge.approval_id,
        approval_hash: challenge.challenge_hash,
        approval_confirmation: approvalConfirmation(effectivePlan, effectiveStep),
        expected_sha: effectivePlan.expected_sha,
        target_key: effectivePlan.target_key,
        target_fingerprint: effectivePlan.target_fingerprint,
        control_plane_target_fingerprint: effectivePlan.control_plane_target_fingerprint,
        inspection_run_id: effectivePlan.inspection_run_id,
        role_selection_proof: structuredClone(effectivePlan.role_selection_proof),
        selected_zero_object_roles: [...effectivePlan.role_selection_proof.selected_roles],
        preserved_nonempty_roles: [...effectivePlan.preserved_nonempty_roles],
        grants_included: false,
        access_repair_separate: true,
        approval_token_not_returned: true,
        execution_ticket_not_returned: true,
        database_mutation_performed: false,
        production_authority: false,
        secrets_included: false,
      };
    },

    async approveAndIssue(input = {}) {
      assertExactKeys(input, new Set(["plan_id", "authority_plan_hash", "step_id", "idempotency_key", "approval_confirmation"]), "Rebuild-empty approval");
      const planId = requireSafeId(input.plan_id, "plan_id", PLAN_ID);
      const planHash = requireSha(input.authority_plan_hash, "authority_plan_hash");
      const stepId = requireSafeId(input.step_id, "step_id", STEP_ID);
      const idempotencyKey = requireSafeId(input.idempotency_key, "idempotency_key");
      const plan = await store.getPlan(planId);
      if (!plan || plan.plan_hash !== planHash || plan.repair_key !== STAGING_REBUILD_EMPTY_CAPABILITY || plan.environment !== "staging" || plan.target_key !== "staging-runtime" || plan.caller_role_selection_allowed !== false || plan.access_repair_separate !== true) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Approval does not resolve to the fixed selective Staging rebuild-empty plan.", {}, 409);
      if (plan.execution_ticket_id || plan.status === "approved") {
        if (plan.approved_idempotency_key === idempotencyKey && plan.execution_ticket_id && plan.execution_ticket_hash) {
          const existingTicket = await store.getExecutionTicket(plan.execution_ticket_id);
          if (existingTicket?.ticket_hash === plan.execution_ticket_hash) return issuedTicketReceipt(plan, existingTicket);
        }
        fail("RECOVERY_APPROVAL_INVALID", "This rebuild-empty approval already issued its single-use ticket for a different request.", {}, 409);
      }
      const step = plan.steps?.find((entry) => entry.step_id === stepId);
      if (!step || step.operation !== "database.rebuild_empty" || step.role_selection_hash !== plan.role_selection_hash || step.grants_included !== false) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Approval step is not the fixed selective rebuild-empty capability.", {}, 409);
      if (text(input.approval_confirmation, 1024) !== approvalConfirmation(plan, step)) fail("RECOVERY_APPROVAL_INVALID", "Exact high-level Staging rebuild-empty approval confirmation is required.", { confirmation_formula: "APPROVE_STAGING_DATABASE_REBUILD_EMPTY:<authority_plan_hash>:<step_hash>:<expected_sha>:staging-runtime:<role_selection_hash>" }, 401);
      const attestation = await attestExactDeployment(graph, plan.expected_sha, plan.control_plane_target_fingerprint);
      const approval = await store.getApprovalByPlanStep(plan.plan_id, step.step_id);
      if (!approval || approval.used === true || Date.parse(approval.expires_at || 0) <= Date.now()) fail("RECOVERY_APPROVAL_INVALID", "The plan-bound approval challenge is absent, expired, or already used.", {}, 401);
      const issuedApproval = await graph.approvalIssuer.createChallenge(approval);
      const approvalToken = issuedApproval?.server_token;
      const approvalContext = {
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
      if ((await graph.approvalVerifier.verify({ token: approvalToken, approval, context: approvalContext })) !== true) fail("RECOVERY_APPROVAL_INVALID", "Server-managed approval verification failed closed.", {}, 401);
      const approvalBinding = buildApprovalBinding({ approvalId: approval.approval_id, approvalHash: approval.challenge_hash, approvalVersion: approval.approval_version || "v1", planHash: plan.plan_hash, stepId: step.step_id, stepHash: step.step_hash, targetKey: plan.target_key, targetFingerprint: plan.target_fingerprint, targetRole: step.target_role, operation: step.operation });
      const reservation = await store.reserveApproval({ ...approvalContext, approval_hash: approvalBinding.approval_hash, approval_binding_hash: approvalBinding.binding_hash, idempotency_key: idempotencyKey, execution_ticket_id: null });
      if (reservation?.reserved !== true && reservation?.same_idempotency !== true) fail("RECOVERY_APPROVAL_INVALID", "The rebuild-empty approval challenge is already reserved or consumed.", { reconciliation_required: true }, 409);
      let ticketPersisted = false;
      try {
        const ticket = await issueExecutionTicket({
          inspection_run_id: plan.inspection_run_id,
          inspection_evidence_hash: plan.inspection_evidence_hash,
          finding_ids: plan.finding_ids,
          selected_roles: plan.role_selection_proof.selected_roles,
          role_selection_required: true,
          role_selection_hash: plan.role_selection_hash,
          role_object_count_fingerprints: plan.role_selection_proof.role_object_count_fingerprints,
          role_bundle_bindings: plan.role_bundle_bindings,
          target_fingerprints: { composite: plan.target_fingerprint },
          deployment_attestation_hash: attestation.attestation_hash,
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
          target_role: "composite",
          operation: "database.rebuild_empty",
          idempotency_key: idempotencyKey,
          expires_at: approval.expires_at,
          nonce: `nonce:${digest({ plan_hash: plan.plan_hash, approval_id: approval.approval_id, idempotency_key: idempotencyKey })}`,
        }, { signer: graph.executionTicketSigner });
        await store.putExecutionTicket(ticket);
        ticketPersisted = true;
        const approvedPlan = { ...plan, status: "approved", execution_ticket_id: ticket.ticket_id, execution_ticket_hash: ticket.ticket_hash, approved_idempotency_key: idempotencyKey, approved_at: new Date().toISOString() };
        await store.putPlan(approvedPlan);
        await store.markApprovalUsed(approval.approval_id);
        return issuedTicketReceipt(approvedPlan, ticket);
      } catch (error) {
        if (!ticketPersisted) await store.releaseApprovalReservation({ approval_id: approval.approval_id, idempotency_key: idempotencyKey }).catch(() => {});
        throw error;
      }
    },
  });
}

export const _testingStagingRebuildEmptyAuthority = Object.freeze({ normalizeInspection, proofFromRun, buildPlan, approvalConfirmation, objectCountsFingerprint, digest });
