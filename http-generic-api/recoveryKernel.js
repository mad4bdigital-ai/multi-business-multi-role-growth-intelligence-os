import { createHash, randomUUID } from "node:crypto";
import { readDeploymentManifest } from "./deploymentManifest.js";
import { executeHostLocalRoleInspection } from "./hostLocalRuntimeInspection.js";
import { runProductionActivationReadiness } from "./productionActivationReadiness.js";

export const RECOVERY_KERNEL_CONTRACT = "mad4b.recovery-kernel.v1";
export const RECOVERY_KERNEL_VERSION = 1;
export const RECOVERY_KERNEL_TARGET_KEY = "production-runtime";
export const RECOVERY_KERNEL_PRODUCTION_ENVIRONMENT = "production_hostinger_autodeploy";
export const RECOVERY_KERNEL_PRODUCTION_BRANCH = "Production";
export const RECOVERY_KERNEL_REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";

const SHA_RE = /^[0-9a-f]{40}$/iu;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const FINDING_ID_RE = /^finding:[0-9a-f]{16,64}$/u;
const RUN_ID_RE = /^run:[0-9a-f]{16,64}$/u;
const PLAN_ID_RE = /^plan:[0-9a-f]{16,64}$/u;
const STEP_ID_RE = /^step:[0-9a-f]{16,64}$/u;
const SENSITIVE_KEY_RE = /(password|secret|token|credential|authorization|private[_-]?key|connection[_-]?string|database|hostname|username|user)/iu;
const SAFE_ATTESTATION_KEYS = new Set([
  "secrets_included",
  "read_only",
  "read_only_probe",
  "database_connection_performed",
  "database_mutation_performed",
  "sql_mutation_performed",
  "migration_apply_performed",
  "grant_mutation_performed",
  "provider_mutation_performed",
  "deployment_performed",
  "workflow_dispatch_performed",
  "postconditions_passed",
  "behavioral_probe_passed",
  "database_independent_control_plane",
  "approval_token_not_returned",
]);
const FORBIDDEN_REQUEST_KEYS = new Set([
  "sql", "query", "shell", "command", "script", "credentials", "credential", "password", "secret", "token",
  "authorization", "private_key", "connection_string", "database", "database_name", "target_database", "db_name",
  "db_user", "db_password", "username", "hostname", "repository", "repo", "branch", "workflow", "workflow_file",
  "ref", "dispatch_ref", "migration", "migration_file", "grant", "privileges", "target_source", "mode", "action",
]);

const RUNS = new Map();
const PLANS = new Map();
const APPROVALS = new Map();
const EVIDENCE = new Map();
const IDEMPOTENCY = new Map();

function text(value, max = 256) {
  return String(value ?? "").trim().slice(0, max);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function stableHash(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function kernelError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function assertObject(value, code = "RECOVERY_REQUEST_INVALID") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw kernelError(400, code, "Recovery Kernel request must be a JSON object.");
  }
  return value;
}

function assertNoForbiddenKeys(input = {}) {
  const forbidden = Object.keys(input).filter((key) => FORBIDDEN_REQUEST_KEYS.has(String(key).trim().toLowerCase()));
  if (forbidden.length) {
    throw kernelError(400, "RECOVERY_FORBIDDEN_INPUT", "Raw commands, credentials, database identifiers, migration selection, and provider controls are server-controlled.", { fields: forbidden });
  }
}

function requireSha(value, field = "expected_sha") {
  const sha = text(value, 64).toLowerCase();
  if (!SHA_RE.test(sha)) throw kernelError(400, "RECOVERY_SHA_INVALID", `${field} must be a full 40-character SHA.`);
  return sha;
}

function requireTargetKey(value = RECOVERY_KERNEL_TARGET_KEY) {
  const targetKey = text(value, 128) || RECOVERY_KERNEL_TARGET_KEY;
  if (targetKey !== RECOVERY_KERNEL_TARGET_KEY) throw kernelError(403, "RECOVERY_TARGET_INVALID", "Recovery Kernel is bound to the registered Production runtime target.", { target_key: targetKey });
  return targetKey;
}

function requireId(value, pattern, field, code) {
  const normalized = text(value, 160);
  if (!pattern.test(normalized)) throw kernelError(400, code, `${field} is invalid.`);
  return normalized;
}

function sanitizeScalar(value, key = "") {
  if (SAFE_ATTESTATION_KEYS.has(String(key))) return value;
  if (SENSITIVE_KEY_RE.test(key)) return "[REDACTED]";
  if (typeof value !== "string") return value;
  if (/-----BEGIN [A-Z ]+PRIVATE KEY-----/u.test(value) || /(?:mysql|postgres(?:ql)?):\/\/[^\s]+/iu.test(value)) return "[REDACTED]";
  return value.length > 2000 ? `${value.slice(0, 1997)}...` : value;
}

export function sanitizeEvidence(value, key = "", depth = 0) {
  if (depth > 8) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeEvidence(item, key, depth + 1));
  if (!value || typeof value !== "object") return sanitizeScalar(value, key);
  return Object.fromEntries(Object.entries(value).slice(0, 300).map(([childKey, childValue]) => [childKey, sanitizeEvidence(childValue, childKey, depth + 1)]));
}

function noMutationAttestation(overrides = {}) {
  return {
    database_connection_performed: overrides.database_connection_performed === true,
    database_mutation_performed: false,
    sql_mutation_performed: false,
    migration_apply_performed: false,
    grant_mutation_performed: false,
    provider_mutation_performed: false,
    deployment_performed: false,
    workflow_dispatch_performed: false,
    read_only_probe: overrides.read_only_probe === true,
    secrets_included: false,
  };
}

function capability(key, riskClass, description, options = {}) {
  return {
    capability_key: key,
    version: 1,
    risk_class: riskClass,
    description,
    target_policy: options.target_policy || "server_resolved",
    dependencies: [...(options.dependencies || [])],
    authority: options.authority || "repository_static_contract",
    mutation: options.mutation === true,
    approval_required: options.approval_required === true,
    environments: [...(options.environments || ["production"])],
    secrets_required: false,
    blast_radius: options.blast_radius || { database_roles: [], tables_max: 0, rows_data_mutation: false, schema_mutation: false, grants_mutation: false, cross_database: false },
    rollback: options.rollback || "not_applicable",
  };
}

export const RECOVERY_KERNEL_CAPABILITIES = Object.freeze([
  capability("production_identity", "C0", "Read the server-controlled Production repository, branch, SHA, and identity parity status without DB or catalog access.", { dependencies: ["deployment_manifest_or_runtime_identity"] }),
  capability("system_tool_get", "C0", "Look up one repository-registered fixed system tool by exact name without loading the large dynamic catalog.", { dependencies: ["static_system_tool_registry"] }),
  capability("system_tools_search", "C0", "Search the bounded repository-registered fixed system-tool descriptors without loading the large dynamic catalog.", { dependencies: ["static_system_tool_registry"] }),
  capability("recovery_capabilities", "C0", "Return the static Recovery Kernel capability matrix, risk classes, dependencies, and boundaries.", { dependencies: ["repository_static_contract"] }),
  capability("production_activation_readiness", "C0", "Read the three bounded Production readiness dimensions without loading a large catalog or performing mutation.", { dependencies: ["mcp_catalog_schema_reader", "governance_privilege_reader", "runtime_persistence_reader"] }),
  capability("database_full_inspection", "C0", "Run the exact-SHA Production host-local full database inspection using the three independent role identities in the server environment.", { dependencies: ["host_local_role_env", "production_identity", "runtime_bootstrap_contract"] }),
  capability("finding_details", "C0", "Read one sanitized finding produced by a Recovery Kernel inspection or readiness probe.", { dependencies: ["recovery_run_state"] }),
  capability("remediation_plan_create", "C0", "Build a deterministic plan from registered finding IDs and repository-owned capability rules without execution.", { dependencies: ["recovery_findings", "repository_static_contract"] }),
  capability("remediation_plan_preview", "C0", "Preview blast radius, dependencies, approval class, rollback classification, and postconditions for a registered plan step.", { dependencies: ["recovery_plan_state"] }),
  capability("approval_challenge_create", "C1", "Create a short-lived, step-bound approval challenge without executing a mutation.", { dependencies: ["recovery_plan_state"], approval_required: false }),
  capability("remediation_step_execute", "C2-C6", "Execute only a registered plan step through an injected capability executor after exact plan, target, SHA, lock, idempotency, and approval validation.", { dependencies: ["recovery_plan_state", "approval_verifier", "recovery_lock", "mutation_executor"], mutation: true, approval_required: true, blast_radius: { database_roles: ["server_resolved"], tables_max: 1, rows_data_mutation: false, schema_mutation: true, grants_mutation: true, cross_database: false }, rollback: "capability_declared" }),
  capability("remediation_step_verify", "C0", "Verify registered postconditions through an injected readback verifier; never equates HTTP success with recovery.", { dependencies: ["recovery_plan_state", "readback_verifier"] }),
  capability("recovery_run_get", "C0", "Read sanitized resumable Recovery Kernel run state by run ID.", { dependencies: ["recovery_run_state"] }),
  capability("recovery_evidence_get", "C0", "Read sanitized evidence for a Recovery Kernel run without raw logs, credentials, or database identifiers.", { dependencies: ["recovery_evidence_store"] }),
]);

const CAPABILITY_INDEX = new Map(RECOVERY_KERNEL_CAPABILITIES.map((entry) => [entry.capability_key, entry]));
const CAPABILITY_ALIASES = Object.freeze({
  production_host_local_database_inspect: "database_full_inspection",
  production_activation_readiness_probe: "production_activation_readiness",
  host_breakglass_plan: "remediation_plan_create",
  host_breakglass_preview: "remediation_plan_preview",
  host_breakglass_verify: "remediation_step_verify",
  host_breakglass_run_get: "recovery_run_get",
  recovery_evidence_export: "recovery_evidence_get",
});

function capabilityHash(entry) {
  return stableHash(entry);
}

export function getRecoveryCapabilities() {
  const capabilities = RECOVERY_KERNEL_CAPABILITIES.map((entry) => ({ ...entry, capability_hash: capabilityHash(entry) }));
  return {
    ok: true,
    contract: RECOVERY_KERNEL_CONTRACT,
    version: RECOVERY_KERNEL_VERSION,
    catalog_source: "repository_static_contract",
    catalog_hash: stableHash(capabilities),
    fixed_aliases: CAPABILITY_ALIASES,
    capabilities,
    public_surface_count: capabilities.length,
    database_independent_capabilities: capabilities.filter((entry) => !entry.dependencies.some((dependency) => dependency.includes("role") || dependency.includes("database"))).map((entry) => entry.capability_key),
    mutation_capabilities: capabilities.filter((entry) => entry.mutation).map((entry) => entry.capability_key),
    secrets_included: false,
  };
}

function identityFromEnvironment(env = process.env) {
  const manifestResult = readDeploymentManifest(env);
  const manifest = manifestResult.ok ? manifestResult.manifest : null;
  const repository = text(manifest?.repository || env.GITHUB_REPOSITORY || env.DEPLOY_REPOSITORY, 160) || null;
  const branch = text(manifest?.branch || env.GITHUB_REF_NAME || env.DEPLOY_BRANCH || env.BRANCH_NAME, 64) || null;
  const commit = text(manifest?.commit_sha || env.GITHUB_SHA || env.DEPLOY_COMMIT || env.COMMIT_SHA || env.REVISION_SHA, 64).toLowerCase() || null;
  return { repository, branch, commit, source: manifest?.source || (manifestResult.ok ? "deployment_manifest" : "runtime_environment") };
}

export function readProductionIdentity({ env = process.env, expectedSha = null } = {}) {
  const identity = identityFromEnvironment(env);
  const parity = identity.repository === RECOVERY_KERNEL_REPOSITORY
    && identity.branch === RECOVERY_KERNEL_PRODUCTION_BRANCH
    && SHA_RE.test(identity.commit || "")
    && (!expectedSha || identity.commit === expectedSha);
  if (expectedSha && !parity) {
    throw kernelError(412, "RECOVERY_PRODUCTION_IDENTITY_MISMATCH", "The server-controlled Production identity does not match the requested exact SHA.", {
      repository_match: identity.repository === RECOVERY_KERNEL_REPOSITORY,
      branch_match: identity.branch === RECOVERY_KERNEL_PRODUCTION_BRANCH,
      sha_match: identity.commit === expectedSha,
      identity_available: Boolean(identity.commit && identity.branch && identity.repository),
    });
  }
  return {
    ok: parity,
    contract: "mad4b.recovery-production-identity.v1",
    environment: "production",
    repository: identity.repository,
    branch: identity.branch,
    git_sha: identity.commit,
    identity_source: identity.source,
    expected_sha: expectedSha,
    parity,
    read_only_probe: true,
    database_connection_performed: false,
    ...noMutationAttestation({ read_only_probe: true }),
  };
}

function inspectionFinding({ targetRole, resource, category, severity, expected, actual, authorityRef, repairability, mutationRequired }) {
  const subject = { target_role: targetRole, resource };
  const finding = {
    subject,
    category,
    severity,
    desired_state: { expected: sanitizeEvidence(expected), authority_ref: authorityRef || null },
    observed_state: { actual: sanitizeEvidence(actual) },
    confidence: "verified",
    repairability,
    mutation_required: mutationRequired === true,
    candidate_capability: null,
  };
  const id = `finding:${stableHash(finding).slice(0, 32)}`;
  return { finding_id: id, ...finding };
}

function findingsFromInspection(inspection = {}) {
  const findings = [];
  const checks = inspection.checks && typeof inspection.checks === "object" ? inspection.checks : {};
  const dimensions = inspection.dimensions && typeof inspection.dimensions === "object" ? inspection.dimensions : {};
  const checkMap = [
    ["mcp_catalog_schema_ready", "governance", "admin_platform_endpoint_tools.mcp_catalog_level", "known_migration_gap", "high", "governance.mcp_catalog.repair", "20260815_custom_gpt_mcp_catalog_levels.sql"],
    ["governance_db_privilege_ready", "governance", "governance database privilege contract", "known_grant_gap", "high", "governance.grant.repair", "repository grant contract"],
    ["runtime_persistence_ready", "runtime_persistence", "governed_tool_response_chunks", "schema_drift", "high", "runtime_persistence.schema.repair", "persistence schema bundle"],
  ];
  for (const [check, role, resource, category, severity, candidate, authority] of checkMap) {
    if (checks[check] === true) continue;
    const finding = inspectionFinding({ targetRole: role, resource, category, severity, expected: { ready: true }, actual: { ready: checks[check] ?? dimensions[role] ?? false }, authorityRef: authority, repairability: candidate ? "deterministic" : "unknown_fail_closed", mutationRequired: true });
    finding.candidate_capability = candidate;
    findings.push(finding);
  }
  if (Array.isArray(inspection.findings)) {
    for (const item of inspection.findings.slice(0, 100)) findings.push(sanitizeEvidence(item));
  }
  if (findings.length === 0 && inspection.ok === false) {
    findings.push(inspectionFinding({ targetRole: "unknown", resource: "recovery inspection", category: "unknown_fail_closed", severity: "critical", expected: { ok: true }, actual: { ok: false }, authorityRef: null, repairability: "unknown_fail_closed", mutationRequired: false }));
  }
  return [...new Map(findings.map((finding) => [finding.finding_id || `finding:${stableHash(finding).slice(0, 32)}`, finding])).values()];
}

function classifyFinding(finding = {}) {
  const candidate = text(finding.candidate_capability, 160);
  if (candidate === "governance.mcp_catalog.repair") return { classification: "known_migration_gap", capability_key: candidate, operation: "apply_migration", target_role: "governance", authority_ref: "20260815_custom_gpt_mcp_catalog_levels.sql", mutation_class: "C3" };
  if (candidate === "governance.grant.repair") return { classification: "known_grant_gap", capability_key: candidate, operation: "apply_grants", target_role: "governance", authority_ref: "repository grant contract", mutation_class: "C2" };
  if (candidate === "runtime_persistence.schema.repair") return { classification: "schema_drift", capability_key: candidate, operation: "apply_migration", target_role: "runtime_persistence", authority_ref: "persistence schema bundle", mutation_class: "C3" };
  if (finding.repairability === "unknown_fail_closed" || finding.category === "unknown_fail_closed") return { classification: "unknown_fail_closed", capability_key: null, operation: null, target_role: finding.subject?.target_role || "unknown", authority_ref: null, mutation_class: "C0" };
  return { classification: "unknown_fail_closed", capability_key: null, operation: null, target_role: finding.subject?.target_role || "unknown", authority_ref: null, mutation_class: "C0" };
}

function requireProductionRequest(input = {}, allowedKeys = []) {
  assertObject(input);
  assertNoForbiddenKeys(input);
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "The Recovery Kernel input contains fields outside the capability contract.", { fields: unexpected });
  const expectedSha = requireSha(input.expected_sha);
  const targetKey = requireTargetKey(input.target_key);
  return { expected_sha: expectedSha, target_key: targetKey };
}

function ensurePlan(planId, planHash = null) {
  const plan = PLANS.get(planId);
  if (!plan) throw kernelError(404, "RECOVERY_PLAN_NOT_FOUND", "The requested recovery plan is not available.", { plan_id: planId });
  if (planHash && plan.plan_hash !== planHash) throw kernelError(409, "RECOVERY_PLAN_HASH_MISMATCH", "The requested recovery plan hash does not match the repository-bound plan.", { plan_id: planId });
  if (plan.expected_sha !== plan.expected_sha_at_creation) throw kernelError(409, "RECOVERY_PLAN_STALE", "The recovery plan is stale and must be recreated.");
  const expectedTargetFingerprint = stableHash({ environment: plan.environment, repository: plan.repository, branch: plan.branch, target_key: plan.target_key });
  if (plan.target_fingerprint !== expectedTargetFingerprint) throw kernelError(409, "RECOVERY_TARGET_FINGERPRINT_MISMATCH", "The recovery plan target fingerprint is stale or invalid.");
  return plan;
}

function ensureStep(plan, stepId) {
  const step = plan.steps.find((candidate) => candidate.step_id === stepId);
  if (!step) throw kernelError(404, "RECOVERY_STEP_NOT_FOUND", "The requested recovery step is not part of the plan.", { plan_id: plan.plan_id, step_id: stepId });
  return step;
}

function writeRun(run, { recoveryStore } = {}) {
  RUNS.set(run.run_id, run);
  EVIDENCE.set(run.run_id, run.evidence);
  if (recoveryStore && typeof recoveryStore.putRun === "function") return recoveryStore.putRun(sanitizeEvidence(run));
  return null;
}

async function readRun(runId, { recoveryStore } = {}) {
  if (recoveryStore && typeof recoveryStore.getRun === "function") {
    const stored = await recoveryStore.getRun(runId);
    if (stored) return sanitizeEvidence(stored);
  }
  return RUNS.get(runId) ? sanitizeEvidence(RUNS.get(runId)) : null;
}

function createRunId(plan) {
  return `run:${stableHash({ plan_hash: plan.plan_hash, nonce: randomUUID() }).slice(0, 32)}`;
}

function createPlanId(input) {
  return `plan:${stableHash({ expected_sha: input.expected_sha, target_key: input.target_key, finding_ids: input.finding_ids }).slice(0, 32)}`;
}

function planSteps(findings) {
  return findings.map((finding, index) => {
    const classified = classifyFinding(finding);
    const stepBase = {
      ordinal: index + 1,
      finding_id: finding.finding_id,
      classification: classified.classification,
      capability_key: classified.capability_key,
      operation: classified.operation,
      target_role: classified.target_role,
      authority_ref: classified.authority_ref,
      mutation_class: classified.mutation_class,
      consequential: Boolean(classified.capability_key),
      approval_required: Boolean(classified.capability_key),
      execution_allowed: false,
      preconditions: ["production_identity_match", "plan_hash_match", "target_fingerprint_match", "recovery_lock_available", "single_use_approval"],
      postconditions: classified.capability_key ? ["schema_or_grant_readback", "ledger_or_privilege_readback", "behavioral_probe_or_readiness_pass"] : ["no_mutation", "fail_closed_record"],
      rollback: classified.capability_key === "governance.grant.repair" ? "exact_delta_revoke" : classified.capability_key ? "forward_only_or_capability_declared" : "not_applicable",
    };
    return { ...stepBase, step_id: `step:${stableHash(stepBase).slice(0, 32)}` };
  });
}

export async function createRemediationPlan(input = {}, { recoveryStore } = {}) {
  assertObject(input);
  assertNoForbiddenKeys(input);
  const allowed = new Set(["expected_sha", "target_key", "finding_ids", "idempotency_key"]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "Plan creation accepts only exact SHA, target, finding IDs, and an idempotency key.", { fields: unexpected });
  const expectedSha = requireSha(input.expected_sha);
  const targetKey = requireTargetKey(input.target_key);
  const findingIds = Array.isArray(input.finding_ids) ? [...new Set(input.finding_ids.map((value) => text(value, 160)))] : [];
  if (findingIds.length === 0 || findingIds.length > 50 || findingIds.some((id) => !FINDING_ID_RE.test(id))) throw kernelError(400, "RECOVERY_FINDINGS_INVALID", "finding_ids must contain one to fifty registered finding IDs.");
  const findings = [];
  for (const findingId of findingIds) {
    const found = [...RUNS.values()].flatMap((run) => run.findings || []).find((finding) => finding.finding_id === findingId);
    if (!found) throw kernelError(404, "RECOVERY_FINDING_NOT_FOUND", "A requested finding is not registered in the Recovery Kernel state.", { finding_id: findingId });
    findings.push(sanitizeEvidence(found));
  }
  const planId = createPlanId({ expected_sha: expectedSha, target_key: targetKey, finding_ids: findingIds });
  const existing = PLANS.get(planId);
  if (existing) return sanitizeEvidence(existing);
  const steps = planSteps(findings);
  const planBase = {
    contract: "mad4b.recovery-remediation-plan.v1",
    plan_id: planId,
    expected_sha: expectedSha,
    expected_sha_at_creation: expectedSha,
    target_key: targetKey,
    target_fingerprint: stableHash({ environment: "production", repository: RECOVERY_KERNEL_REPOSITORY, branch: RECOVERY_KERNEL_PRODUCTION_BRANCH, target_key: targetKey }),
    environment: "production",
    repository: RECOVERY_KERNEL_REPOSITORY,
    branch: RECOVERY_KERNEL_PRODUCTION_BRANCH,
    finding_ids: findingIds,
    finding_hash: stableHash(findings),
    steps,
    status: "planned",
    blast_radius: { database_roles: [...new Set(steps.map((step) => step.target_role).filter((role) => role !== "unknown"))], tables_max: 1, rows_data_mutation: false, schema_mutation: steps.some((step) => step.mutation_class === "C3"), grants_mutation: steps.some((step) => step.mutation_class === "C2"), cross_database: false },
    mutation_scope: steps.filter((step) => step.consequential).map((step) => ({ step_id: step.step_id, operation: step.operation, target_role: step.target_role, capability_key: step.capability_key })),
    rollback_strategy: steps.some((step) => step.rollback === "forward_only_or_capability_declared") ? "capability_declared_forward_only" : "exact_delta_or_none",
    required_approval: steps.some((step) => step.approval_required) ? "APPROVE_RECOVERY_STEP:<plan_hash>:<step_hash>:<expected_sha>:<target_key>" : null,
    expected_postconditions: [...new Set(steps.flatMap((step) => step.postconditions))],
    idempotency_key: text(input.idempotency_key, 160) || null,
    database_independent_control_plane: true,
    execution_transport: "server_resolved_capability_executor",
    execution_allowed: false,
    secrets_included: false,
  };
  const plan = { ...planBase, plan_hash: stableHash(planBase) };
  PLANS.set(planId, plan);
  return sanitizeEvidence(plan);
}

export async function previewRemediationPlan(input = {}) {
  assertObject(input);
  assertNoForbiddenKeys(input);
  const allowed = new Set(["plan_id", "plan_hash", "step_id"]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "Plan preview accepts only plan and optional step references.", { fields: unexpected });
  const planId = requireId(input.plan_id, PLAN_ID_RE, "plan_id", "RECOVERY_PLAN_ID_INVALID");
  const plan = ensurePlan(planId, text(input.plan_hash, 128) || null);
  const stepId = input.step_id ? requireId(input.step_id, STEP_ID_RE, "step_id", "RECOVERY_STEP_ID_INVALID") : null;
  const step = stepId ? ensureStep(plan, stepId) : null;
  return sanitizeEvidence({
    ok: true,
    contract: "mad4b.recovery-remediation-preview.v1",
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    step_id: step?.step_id || null,
    target: { environment: plan.environment, repository: plan.repository, branch: plan.branch, expected_sha: plan.expected_sha, target_key: plan.target_key, target_fingerprint: plan.target_fingerprint },
    impact: { tables_affected: step?.consequential ? [step.target_role] : [], rows_possibly_affected: false, locks_expected: step?.consequential ? "capability_executor_declared" : "none", downtime_expected: step?.consequential ? "capability_executor_declared" : "none", reversibility: step?.rollback || "not_applicable", dependent_surfaces: step?.postconditions || [] },
    approval_required: step?.approval_required || false,
    execution_allowed: false,
    read_only_probe: true,
    ...noMutationAttestation({ read_only_probe: true }),
  });
}

export async function createApprovalChallenge(input = {}, { approvalIssuer, approvalStore } = {}) {
  assertObject(input);
  assertNoForbiddenKeys(input);
  const allowed = new Set(["plan_id", "plan_hash", "step_id"]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "Approval challenge creation accepts only plan and step references.", { fields: unexpected });
  const planId = requireId(input.plan_id, PLAN_ID_RE, "plan_id", "RECOVERY_PLAN_ID_INVALID");
  const stepId = requireId(input.step_id, STEP_ID_RE, "step_id", "RECOVERY_STEP_ID_INVALID");
  const plan = ensurePlan(planId, text(input.plan_hash, 128) || null);
  const step = ensureStep(plan, stepId);
  if (!step.approval_required) throw kernelError(409, "RECOVERY_APPROVAL_NOT_REQUIRED", "The selected step is read-only and does not require an approval challenge.");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const approvalId = `approval:${stableHash({ plan_hash: plan.plan_hash, step_id: step.step_id, nonce: randomUUID() }).slice(0, 32)}`;
  const challengeBase = { contract: "mad4b.recovery-approval-challenge.v1", approval_id: approvalId, plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id, step_hash: stableHash(step), expected_sha: plan.expected_sha, target_key: plan.target_key, target_fingerprint: plan.target_fingerprint, approval_class: step.mutation_class, expires_at: expiresAt, single_use: true, non_transferable: true, secrets_included: false };
  const issued = approvalIssuer && typeof approvalIssuer.createChallenge === "function" ? await approvalIssuer.createChallenge(sanitizeEvidence(challengeBase)) : null;
  if (approvalStore && typeof approvalStore.putChallenge === "function") await approvalStore.putChallenge(sanitizeEvidence(challengeBase));
  const challenge = { ...challengeBase, issuer: issued ? "injected_approval_issuer" : "repository_challenge_reference_only", challenge_hash: stableHash(challengeBase), execution_ready: Boolean(issued && approvalStore && typeof approvalStore.putChallenge === "function") };
  APPROVALS.set(approvalId, { ...challenge, used: false, issued });
  return sanitizeEvidence({ ok: true, ...challenge, approval_token_required: true, approval_token_not_returned: true, read_only_probe: true, ...noMutationAttestation({ read_only_probe: true }) });
}

function assertApprovalTokenShape(value) {
  const token = text(value, 512);
  if (!token || token.length < 16) throw kernelError(401, "RECOVERY_APPROVAL_INVALID", "A bound single-use approval token is required.");
  return token;
}

async function verifyApproval(approval, token, context, { approvalVerifier, approvalStore } = {}) {
  if (!approval && approvalStore && typeof approvalStore.getChallenge === "function") {
    approval = await approvalStore.getChallenge(context.plan_hash, context.step_id) || null;
  }
  if (!approval || approval.used === true || Date.parse(approval.expires_at) <= Date.now()) return false;
  if (approvalVerifier && typeof approvalVerifier.verify === "function") {
    return (await approvalVerifier.verify({ token, approval: sanitizeEvidence(approval), context: sanitizeEvidence(context) })) === true;
  }
  return false;
}

async function acquireLock(targetKey, planHash, { recoveryLock } = {}) {
  if (!recoveryLock || typeof recoveryLock.acquire !== "function") throw kernelError(503, "RECOVERY_LOCK_UNAVAILABLE", "A durable recovery lock provider is required before any mutation step.");
  const result = await recoveryLock.acquire({ target_key: targetKey, plan_hash: planHash, ttl_seconds: 600 });
  if (result !== true && result?.acquired !== true) throw kernelError(409, "RECOVERY_LOCK_BUSY", "Another consequential recovery operation owns the target lock.");
  return result === true ? { acquired: true } : result;
}

async function releaseLock(lockHandle, targetKey, planHash, { recoveryLock } = {}) {
  if (!recoveryLock || typeof recoveryLock.release !== "function") return;
  await recoveryLock.release({ target_key: targetKey, plan_hash: planHash, lock: lockHandle });
}

export async function executeRemediationStep(input = {}, { approvalVerifier, approvalStore, recoveryLock, mutationExecutor, recoveryStore } = {}) {
  assertObject(input);
  assertNoForbiddenKeys(input);
  const allowed = new Set(["plan_id", "plan_hash", "step_id", "approval_token", "idempotency_key"]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "Step execution accepts only plan, step, approval, and idempotency references.", { fields: unexpected });
  const planId = requireId(input.plan_id, PLAN_ID_RE, "plan_id", "RECOVERY_PLAN_ID_INVALID");
  const plan = ensurePlan(planId, text(input.plan_hash, 128) || null);
  const stepId = requireId(input.step_id, STEP_ID_RE, "step_id", "RECOVERY_STEP_ID_INVALID");
  const step = ensureStep(plan, stepId);
  if (!step.consequential) throw kernelError(409, "RECOVERY_STEP_NOT_CONSEQUENTIAL", "Read-only or fail-closed steps cannot be executed as mutations.");
  const idempotencyKey = text(input.idempotency_key, 160);
  if (!idempotencyKey) throw kernelError(400, "RECOVERY_IDEMPOTENCY_KEY_REQUIRED", "A caller-supplied idempotency_key is required for every consequential recovery step.");
  const externalExisting = recoveryStore && typeof recoveryStore.getRunByIdempotency === "function"
    ? await recoveryStore.getRunByIdempotency(idempotencyKey)
    : null;
  const existingReceipt = externalExisting || IDEMPOTENCY.get(idempotencyKey);
  if (existingReceipt) return sanitizeEvidence({ ...existingReceipt, idempotent_replay: true });
  const approvalToken = assertApprovalTokenShape(input.approval_token);
  const approval = [...APPROVALS.values()].find((entry) => entry.plan_id === plan.plan_id && entry.step_id === step.step_id)
    || (approvalStore && typeof approvalStore.getChallenge === "function" ? await approvalStore.getChallenge(plan.plan_hash, step.step_id) : null);
  const approvalValid = await verifyApproval(approval, approvalToken, { plan_hash: plan.plan_hash, step_id: step.step_id, step_hash: stableHash(step), expected_sha: plan.expected_sha, target_key: plan.target_key, target_fingerprint: plan.target_fingerprint }, { approvalVerifier, approvalStore });
  if (!approvalValid) throw kernelError(401, "RECOVERY_APPROVAL_INVALID", "Approval is absent, expired, already used, or not cryptographically bound to this plan step.");
  const lockHandle = await acquireLock(plan.target_key, plan.plan_hash, { recoveryLock });
  try {
    if (!mutationExecutor || typeof mutationExecutor.execute !== "function") throw kernelError(503, "RECOVERY_EXECUTOR_UNAVAILABLE", "No capability executor is configured; mutation was not attempted.");
    const run = {
      run_id: createRunId(plan),
      status: "executing",
      plan_id: plan.plan_id,
      plan_hash: plan.plan_hash,
      step_id: step.step_id,
      expected_sha: plan.expected_sha,
      target_key: plan.target_key,
      idempotency_key: idempotencyKey,
      started_at: new Date().toISOString(),
      findings: [],
      evidence: { intent_recorded: true, approval_verified: true, execution_started: true, provider_receipt: null, verification: null, secrets_included: false },
    };
    await writeRun(run, { recoveryStore });
    let result;
    try {
      result = await mutationExecutor.execute({ capability_key: step.capability_key, operation: step.operation, target_role: step.target_role, authority_ref: step.authority_ref, expected_sha: plan.expected_sha, target_key: plan.target_key, target_fingerprint: plan.target_fingerprint, plan_hash: plan.plan_hash, step_id: step.step_id, idempotency_key: idempotencyKey });
    } catch (error) {
      run.status = "failed_closed";
      run.completed_at = new Date().toISOString();
      run.evidence.execution_error = { code: text(error?.code || "recovery_executor_failed", 128), message: "Recovery capability executor failed; final state requires readback.", secrets_included: false };
      await writeRun(run, { recoveryStore });
      throw kernelError(502, "RECOVERY_EXECUTOR_FAILED", "The capability executor failed; recovery remains unverified and must not be replayed automatically.", { run_id: run.run_id });
    }
    approval.used = true;
    if (approvalStore && typeof approvalStore.markUsed === "function") await approvalStore.markUsed(approval.approval_id);
    run.status = "verifying";
    run.evidence.provider_receipt = sanitizeEvidence(result);
    run.evidence.database_mutation_performed = result?.database_mutation_performed === true;
    run.evidence.verification_required = true;
    await writeRun(run, { recoveryStore });
    const receipt = sanitizeEvidence({ ok: true, contract: "mad4b.recovery-remediation-execution-receipt.v1", run_id: run.run_id, plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id, status: run.status, idempotency_key: idempotencyKey, mutation_attestation: { ...noMutationAttestation({ read_only_probe: false }), database_mutation_performed: result?.database_mutation_performed === true }, readback_required: true, secrets_included: false });
    IDEMPOTENCY.set(idempotencyKey, receipt);
    return receipt;
  } finally {
    await releaseLock(lockHandle, plan.target_key, plan.plan_hash, { recoveryLock });
  }
}

export async function verifyRemediationStep(input = {}, { readbackVerifier, recoveryStore } = {}) {
  assertObject(input);
  assertNoForbiddenKeys(input);
  const allowed = new Set(["plan_id", "plan_hash", "step_id"]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "Step verification accepts only plan and step references.", { fields: unexpected });
  const planId = requireId(input.plan_id, PLAN_ID_RE, "plan_id", "RECOVERY_PLAN_ID_INVALID");
  const plan = ensurePlan(planId, text(input.plan_hash, 128) || null);
  const stepId = requireId(input.step_id, STEP_ID_RE, "step_id", "RECOVERY_STEP_ID_INVALID");
  const step = ensureStep(plan, stepId);
  if (!readbackVerifier || typeof readbackVerifier.verify !== "function") throw kernelError(503, "RECOVERY_READBACK_UNAVAILABLE", "No same-cycle readback verifier is configured; recovery remains unverified.");
  const result = await readbackVerifier.verify({ plan: sanitizeEvidence(plan), step: sanitizeEvidence(step) });
  const passed = result?.postconditions_passed === true && result?.behavioral_probe_passed !== false;
  const run = [...RUNS.values()].reverse().find((candidate) => candidate.plan_id === plan.plan_id && candidate.step_id === step.step_id);
  if (run) {
    run.status = passed ? "recovered" : "failed_closed";
    run.completed_at = new Date().toISOString();
    run.evidence.verification = sanitizeEvidence(result);
    run.evidence.postconditions_passed = passed;
    await writeRun(run, { recoveryStore });
  }
  return sanitizeEvidence({ ok: passed, contract: "mad4b.recovery-remediation-verification.v1", plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id, status: passed ? "recovered" : "failed_closed", postconditions: sanitizeEvidence(result), recovered: passed, ...noMutationAttestation({ read_only_probe: true }) });
}

export async function getRecoveryRun(input = {}, { recoveryStore } = {}) {
  assertObject(input);
  assertNoForbiddenKeys(input);
  const allowed = new Set(["run_id"]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "Run readback accepts only run_id.", { fields: unexpected });
  const runId = requireId(input.run_id, RUN_ID_RE, "run_id", "RECOVERY_RUN_ID_INVALID");
  const run = await readRun(runId, { recoveryStore });
  if (!run) throw kernelError(404, "RECOVERY_RUN_NOT_FOUND", "The requested recovery run is not available.", { run_id: runId });
  return sanitizeEvidence({ ok: true, contract: "mad4b.recovery-run.v1", ...run, resumable: true, secrets_included: false });
}

export async function getRecoveryEvidence(input = {}, { recoveryStore } = {}) {
  assertObject(input);
  assertNoForbiddenKeys(input);
  const allowed = new Set(["run_id"]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "Evidence readback accepts only run_id.", { fields: unexpected });
  const runId = requireId(input.run_id, RUN_ID_RE, "run_id", "RECOVERY_RUN_ID_INVALID");
  const run = await readRun(runId, { recoveryStore });
  if (!run) throw kernelError(404, "RECOVERY_EVIDENCE_NOT_FOUND", "Evidence for the requested recovery run is not available.", { run_id: runId });
  return sanitizeEvidence({ ok: true, contract: "mad4b.recovery-evidence.v1", run_id: runId, evidence: run.evidence || {}, redaction: { applied: true, raw_logs_included: false, secrets_included: false }, secrets_included: false });
}

export async function inspectProductionDatabase(input = {}, { env = process.env, repoRoot, hostLocalExecutor = executeHostLocalRoleInspection, recoveryStore } = {}) {
  const request = requireProductionRequest(input, ["expected_sha", "target_key"]);
  const identity = readProductionIdentity({ env, expectedSha: request.expected_sha });
  const inspection = await hostLocalExecutor({ expected_sha: request.expected_sha, target_key: request.target_key }, { env, repoRoot });
  const findings = findingsFromInspection(inspection);
  const runId = `run:${stableHash({ expected_sha: request.expected_sha, target_key: request.target_key, nonce: randomUUID() }).slice(0, 32)}`;
  const evidence = { identity, inspection: sanitizeEvidence(inspection), findings: sanitizeEvidence(findings), final_inspection: false, secrets_included: false };
  const run = { run_id: runId, status: inspection?.ok === false ? "failed_closed" : "diagnosing", plan_id: null, plan_hash: null, step_id: null, expected_sha: request.expected_sha, target_key: request.target_key, started_at: new Date().toISOString(), findings, evidence };
  await writeRun(run, { recoveryStore });
  return sanitizeEvidence({ ok: inspection?.ok !== false, contract: "mad4b.recovery-production-inspection.v1", run_id: runId, status: run.status, identity, finding_count: findings.length, findings, inspection: { ...inspection, findings }, next_actions: findings.length ? ["finding_details", "remediation_plan_create"] : ["recovery_evidence_get"], read_only: true, ...noMutationAttestation({ database_connection_performed: inspection?.database_connection_performed === true, read_only_probe: true }) });
}

export async function callRecoveryKernelCapability(capabilityKey, input = {}, deps = {}) {
  const requestedKey = text(capabilityKey, 160);
  const key = CAPABILITY_ALIASES[requestedKey] || requestedKey;
  assertObject(input);
  assertNoForbiddenKeys(input);
  if (!CAPABILITY_INDEX.has(key)) throw kernelError(400, "RECOVERY_CAPABILITY_UNKNOWN", "The requested Recovery Kernel capability is not registered.", { capability_key: requestedKey });
  switch (key) {
    case "production_identity": {
      assertObject(input);
      const unexpected = Object.keys(input).filter((field) => field !== "expected_sha");
      if (unexpected.length) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "Production identity accepts only optional expected_sha.", { fields: unexpected });
      return readProductionIdentity({ env: deps.env || process.env, expectedSha: input?.expected_sha ? requireSha(input.expected_sha) : null });
    }
    case "recovery_capabilities":
      if (Object.keys(assertObject(input)).length > 0) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "recovery_capabilities accepts no arguments.");
      return getRecoveryCapabilities();
    case "production_activation_readiness": {
      if (Object.keys(assertObject(input)).length > 0) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "production_activation_readiness accepts no arguments.");
      const reader = typeof deps.productionActivationReadinessExecutor === "function"
        ? deps.productionActivationReadinessExecutor
        : runProductionActivationReadiness;
      const result = await reader();
      return sanitizeEvidence({
        ...result,
        contract: "mad4b.recovery-production-readiness.v1",
        source: "bounded_readiness_probe",
        catalog_loaded: false,
        read_only_probe: true,
        ...noMutationAttestation({
          database_connection_performed: result?.database_connection_performed === true,
          read_only_probe: true,
        }),
      });
    }
    case "database_full_inspection": return inspectProductionDatabase(input, deps);
    case "remediation_plan_create": return createRemediationPlan(input, deps);
    case "remediation_plan_preview": return previewRemediationPlan(input, deps);
    case "approval_challenge_create": return createApprovalChallenge(input, deps);
    case "remediation_step_execute": return executeRemediationStep(input, deps);
    case "remediation_step_verify": return verifyRemediationStep(input, deps);
    case "recovery_run_get": return getRecoveryRun(input, deps);
    case "recovery_evidence_get": return getRecoveryEvidence(input, deps);
    case "finding_details": {
      assertObject(input); assertNoForbiddenKeys(input);
      const findingId = requireId(input.finding_id, FINDING_ID_RE, "finding_id", "RECOVERY_FINDING_ID_INVALID");
      const finding = [...RUNS.values()].flatMap((run) => run.findings || []).find((candidate) => candidate.finding_id === findingId);
      if (!finding) throw kernelError(404, "RECOVERY_FINDING_NOT_FOUND", "The requested finding is not available.", { finding_id: findingId });
      return sanitizeEvidence({ ok: true, contract: "mad4b.recovery-finding.v1", finding });
    }
    case "system_tool_get":
    case "system_tools_search":
      if (typeof deps.systemToolLookup !== "function") throw kernelError(503, "RECOVERY_SYSTEM_TOOL_LOOKUP_UNAVAILABLE", "Static system-tool lookup is not configured.");
      return await deps.systemToolLookup(key, input);
    default: throw kernelError(501, "RECOVERY_CAPABILITY_NOT_IMPLEMENTED", "The registered Recovery Kernel capability has no callable adapter.", { capability_key: key });
  }
}

export const _testingRecoveryKernel = Object.freeze({
  RUNS,
  PLANS,
  APPROVALS,
  EVIDENCE,
  identityFromEnvironment,
  findingsFromInspection,
  classifyFinding,
  planSteps,
  requireProductionRequest,
  noMutationAttestation,
  CAPABILITY_INDEX,
  RECOVERY_KERNEL_REPOSITORY,
  RECOVERY_KERNEL_PRODUCTION_BRANCH,
  RECOVERY_KERNEL_TARGET_KEY,
});
