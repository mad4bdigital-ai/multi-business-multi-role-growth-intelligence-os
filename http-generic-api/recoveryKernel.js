import { createHash, randomUUID } from "node:crypto";
import { readDeploymentManifest } from "./deploymentManifest.js";
import { executeHostLocalRoleInspection } from "./hostLocalRuntimeInspection.js";
import { runProductionActivationReadiness } from "./productionActivationReadiness.js";
import {
  assertTrustForMutation,
  buildCausalFindingGraph,
  deriveRoleTargetFingerprints,
  getRecoveryTrustModel,
  readRecoveryManifest,
  readRuntimeAttestation,
  verifyRecoveryManifest,
} from "./recoveryTrustModel.js";
import {
  createEphemeralCapability,
  escalateUnsupportedRecovery,
  executeUnsupportedCapability,
  previewSshSession,
  previewSqlSession,
} from "./unsupportedRecoveryBroker.js";
import {
  appendEvidenceChainEvent,
  buildPrivilegedLeasePreview,
  buildPrivilegedOperationPreview,
  buildRecoveryCancelPreview,
  buildRecoveryExceptionPreview,
  buildRecoveryIncident,
  buildReconciliationPreview,
  observeSecretSafely,
} from "./recoveryExceptionFramework.js";
import {
  buildExecutionTicketPayload,
  computeExecutionTicketHash,
  issueExecutionTicket,
  verifyExecutionTicket,
} from "./recoveryExecutionTicket.js";
import {
  canonicalizeRoleSelection,
  computeRoleSelectionProofHash,
} from "./roleSelectionProof.js";
import {
  activateExceptionLifecycle,
  approveExceptionLifecycle,
  buildDisasterRecoveryPreview,
  consumeExceptionLifecycle,
  createExceptionLifecycle,
  createExceptionLifecycleRecord,
  expireExceptionLifecycle,
  heartbeatExceptionLease,
  revokeExceptionLifecycle,
} from "./recoveryExceptionLifecycle.js";

export { assertTrustForMutation, deriveRoleTargetFingerprints, getRecoveryTrustModel, readRuntimeAttestation, readRecoveryManifest, activateExceptionLifecycle, approveExceptionLifecycle, buildDisasterRecoveryPreview, consumeExceptionLifecycle, createExceptionLifecycle, createExceptionLifecycleRecord, expireExceptionLifecycle, heartbeatExceptionLease, revokeExceptionLifecycle };

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

export const RECOVERY_STATE_PHASES = Object.freeze([
  "created",
  "inspecting",
  "classified",
  "planned",
  "awaiting_approval",
  "approval_granted",
  "locked",
  "executing",
  "provider_acknowledged",
  "execution_outcome_unknown",
  "readback_pending",
  "verifying",
  "verified",
  "partially_verified",
  "compensation_required",
  "failed_closed",
  "recovered",
]);

export const RECOVERY_STATE_TRANSITIONS = Object.freeze({
  created: ["inspecting", "planned", "failed_closed"],
  inspecting: ["classified", "failed_closed"],
  classified: ["planned", "failed_closed"],
  planned: ["awaiting_approval", "failed_closed"],
  awaiting_approval: ["approval_granted", "failed_closed"],
  approval_granted: ["locked", "failed_closed"],
  locked: ["executing", "failed_closed"],
  executing: ["provider_acknowledged", "execution_outcome_unknown", "failed_closed"],
  execution_outcome_unknown: ["readback_pending", "verifying", "compensation_required", "failed_closed"],
  provider_acknowledged: ["readback_pending", "verifying", "failed_closed"],
  readback_pending: ["verifying", "partially_verified", "compensation_required", "failed_closed"],
  verifying: ["verified", "partially_verified", "failed_closed"],
  verified: ["recovered", "failed_closed"],
  partially_verified: ["compensation_required", "failed_closed"],
  compensation_required: ["failed_closed"],
  failed_closed: [],
  recovered: [],
});

function text(value, max = 256) {
  return String(value ?? "").trim().slice(0, max);
}

function isStagingEnvironment(env = {}) {
  const value = text(env.DEPLOYMENT_ENVIRONMENT || env.REMOTE_MCP_ENVIRONMENT || env.NODE_ENV || "", 64).toLowerCase();
  return ["staging", "stage", "staging_local_windows_docker"].includes(value);
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

function requireDigest(value, field) {
  const digest = text(value, 128).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(digest)) throw kernelError(400, "RECOVERY_DIGEST_INVALID", `${field} must be a 64-character SHA-256 digest.`);
  return digest;
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
  capability("recovery_manifest_get", "C0", "Read the repository-owned Recovery Manifest and its hash without deployment or database access.", { dependencies: ["recovery_manifest"] }),
  capability("recovery_trust_model", "C0", "Read exact-SHA Root of Trust, target fingerprints, role boundaries, dependency graph, and causal graph without mutation.", { dependencies: ["exact_production_sha", "recovery_manifest", "target_fingerprint"] }),
  capability("recovery_incident_create", "C0", "Create or preview a bounded Recovery Incident object before any privileged path; no session or mutation is opened.", { dependencies: ["incident_context", "exact_production_sha"] }),
  capability("privileged_operation_preview", "C0", "Preview a bounded privileged operation with risk, exception, budget, target, TTL, and evidence requirements; never executes it.", { dependencies: ["incident_context", "risk_policy", "approval_policy"] }),
  capability("privileged_lease_preview", "C0", "Preview a short-lived SSH or SQL lease with owner, target, TTL, heartbeat, and bounded command/row limits; never opens a session.", { dependencies: ["incident_context", "target_fingerprint", "lease_policy"] }),
  capability("recovery_exception_preview", "C0", "Preview a scoped E0-E6 exception with approval policy, budget, non-bypassable invariants, and expiry; never grants authority.", { dependencies: ["incident_context", "exception_policy", "approval_policy"] }),
  capability("disaster_recovery_preview", "C0", "Preview backup, restore, replacement, validation, cutover, rollback, and credential-rotation phases without connecting to a provider or mutating runtime.", { dependencies: ["backup_policy", "replacement_validation", "cutover_policy"] }),
  capability("recovery_reconciliation_preview", "C0", "Preview reconciliation-only actions after an unknown provider outcome; retries and compensating mutations remain denied.", { dependencies: ["execution_outcome", "same_cycle_readback"] }),
  capability("recovery_cancel_preview", "C0", "Preview cancellation of future recovery steps without automatic rollback; reconciliation remains required.", { dependencies: ["recovery_run_state", "reconciliation_policy"] }),
  capability("recovery_evidence_chain_preview", "C0", "Build one tamper-evident evidence-chain event from a previous hash and sanitized event metadata.", { dependencies: ["append_only_evidence_contract"] }),
  capability("secret_observation", "C0", "Return only configured/fingerprint/age metadata for a secret reference; never returns the secret value.", { dependencies: ["secret_presence_reader"] }),
  capability("runtime_attestation", "C0", "Return hash-only runtime attestation, manifest binding, process start metadata, and role credential presence without secret values.", { dependencies: ["exact_production_sha", "recovery_manifest"] }),
  capability("tool_surface_parity", "C0", "Compare bounded server-side route/schema/fixed-tool availability without loading the large dynamic catalog or trusting a GPT snapshot.", { dependencies: ["static_system_tool_registry", "generated_openapi_projection"] }),
  capability("system_tool_get", "C0", "Look up one repository-registered fixed system tool by exact name without loading the large dynamic catalog.", { dependencies: ["static_system_tool_registry"] }),
  capability("system_tools_search", "C0", "Search the bounded repository-registered fixed system-tool descriptors without loading the large dynamic catalog.", { dependencies: ["static_system_tool_registry"] }),
  capability("recovery_capabilities", "C0", "Return the static Recovery Kernel capability matrix, risk classes, dependencies, and boundaries.", { dependencies: ["repository_static_contract"] }),
  capability("production_activation_readiness", "C0", "Read the three bounded Production readiness dimensions without loading a large catalog or performing mutation.", { dependencies: ["mcp_catalog_schema_reader", "governance_privilege_reader", "runtime_persistence_reader"] }),
  capability("database_full_inspection", "C0", "Run the exact-SHA Production host-local full database inspection using the three independent role identities in the server environment.", { dependencies: ["host_local_role_env", "production_identity", "runtime_bootstrap_contract"] }),
  capability("runtime.baseline.rebuild_empty", "C5", "Rebuild only the runtime role from its repository-owned baseline when the same-cycle inspection proves that role has zero schema objects; never drops a nonempty target.", { dependencies: ["database_full_inspection", "role_object_proof", "role_fingerprint", "recovery_plan_state"], mutation: true, approval_required: true, blast_radius: { database_roles: ["runtime"], tables_max: 0, rows_data_mutation: false, schema_mutation: true, grants_mutation: false, cross_database: false }, rollback: "forward_only_or_capability_declared" }),
  capability("governance.baseline.rebuild_empty", "C5", "Rebuild only the governance role from its repository-owned baseline when the same-cycle inspection proves that role has zero schema objects; never drops a nonempty target.", { dependencies: ["database_full_inspection", "role_object_proof", "role_fingerprint", "recovery_plan_state"], mutation: true, approval_required: true, blast_radius: { database_roles: ["governance"], tables_max: 0, rows_data_mutation: false, schema_mutation: true, grants_mutation: false, cross_database: false }, rollback: "forward_only_or_capability_declared" }),
  capability("runtime_persistence.baseline.rebuild_empty", "C5", "Rebuild only the runtime-persistence role from its repository-owned baseline when the same-cycle inspection proves that role has zero schema objects; never drops a nonempty target.", { dependencies: ["database_full_inspection", "role_object_proof", "role_fingerprint", "recovery_plan_state"], mutation: true, approval_required: true, blast_radius: { database_roles: ["runtime_persistence"], tables_max: 0, rows_data_mutation: false, schema_mutation: true, grants_mutation: false, cross_database: false }, rollback: "forward_only_or_capability_declared" }),
  capability("finding_details", "C0", "Read one sanitized finding produced by a Recovery Kernel inspection or readiness probe.", { dependencies: ["recovery_run_state"] }),
  capability("remediation_plan_create", "C0", "Build a deterministic plan from registered finding IDs and repository-owned capability rules without execution.", { dependencies: ["recovery_findings", "repository_static_contract"] }),
  capability("remediation_plan_preview", "C0", "Preview blast radius, dependencies, approval class, rollback classification, and postconditions for a registered plan step.", { dependencies: ["recovery_plan_state"] }),
  capability("approval_challenge_create", "C1", "Create a short-lived, step-bound approval challenge without executing a mutation.", { dependencies: ["recovery_plan_state"], approval_required: false }),
  capability("remediation_step_execute", "C2-C6", "Execute only a registered plan step through an injected capability executor after exact plan, target, SHA, lock, idempotency, and approval validation.", { dependencies: ["recovery_plan_state", "approval_verifier", "recovery_lock", "mutation_executor"], mutation: true, approval_required: true, blast_radius: { database_roles: ["server_resolved"], tables_max: 1, rows_data_mutation: false, schema_mutation: true, grants_mutation: true, cross_database: false }, rollback: "capability_declared" }),
  capability("remediation_step_verify", "C0", "Verify registered postconditions through an injected readback verifier; never equates HTTP success with recovery.", { dependencies: ["recovery_plan_state", "readback_verifier"] }),
  capability("recovery_run_get", "C0", "Read sanitized resumable Recovery Kernel run state by run ID.", { dependencies: ["recovery_run_state"] }),
  capability("recovery_evidence_get", "C0", "Read sanitized evidence for a Recovery Kernel run without raw logs, credentials, or database identifiers.", { dependencies: ["recovery_evidence_store"] }),
  capability("unsupported_recovery_escalate", "C0", "Open a recorded unsupported-recovery incident without opening SSH, SQL, or mutation authority.", { dependencies: ["incident_context", "normal_recovery_first"] }),
  capability("ssh_session_preview", "C0", "Preview a managed, short-lived SSH diagnostic session without accepting a local connector, command text, or credentials.", { dependencies: ["managed_ssh_broker", "incident_context"] }),
  capability("sql_session_preview", "C0", "Preview a role-bound SQL metadata session without accepting connection material, raw SQL, or a database name.", { dependencies: ["managed_sql_broker", "incident_context"] }),
  capability("ephemeral_capability_create", "C2", "Create a hash-only, expiring, single-use unsupported SSH/SQL capability reference; content is never accepted by the GPT-facing contract.", { dependencies: ["incident_context", "artifact_hash", "temporary_authority"], approval_required: true }),
  capability("unsupported_capability_execute", "C4-C6", "Execute only a separately approved ephemeral capability through an injected managed broker; the repository default is kill-switched and fails closed.", { dependencies: ["temporary_authority", "recovery_lock", "approval_verifier", "managed_broker"], mutation: true, approval_required: true, blast_radius: { database_roles: ["server_resolved"], tables_max: 1, rows_data_mutation: true, schema_mutation: true, grants_mutation: true, cross_database: false }, rollback: "capability_declared" }),
]);

const CAPABILITY_INDEX = new Map(RECOVERY_KERNEL_CAPABILITIES.map((entry) => [entry.capability_key, entry]));
const CAPABILITY_ALIASES = Object.freeze({
  production_inspect: "database_full_inspection",
  production_full_inspection: "database_full_inspection",
  production_host_local_database_inspect: "database_full_inspection",
  production_activation_readiness_probe: "production_activation_readiness",
  recovery_capabilities: "recovery_capabilities",
  recovery_manifest: "recovery_manifest_get",
  recovery_trust: "recovery_trust_model",
  recovery_plan_create: "remediation_plan_create",
  recovery_plan_preview: "remediation_plan_preview",
  recovery_execute: "remediation_step_execute",
  recovery_verify: "remediation_step_verify",
  host_breakglass_plan: "remediation_plan_create",
  host_breakglass_preview: "remediation_plan_preview",
  host_breakglass_verify: "remediation_step_verify",
  host_breakglass_run_get: "recovery_run_get",
  recovery_evidence_export: "recovery_evidence_get",
  ssh_preview: "ssh_session_preview",
  ssh_execute: "unsupported_capability_execute",
  ssh_session_get: "recovery_run_get",
  sql_preview: "sql_session_preview",
  sql_execute: "unsupported_capability_execute",
  sql_session_get: "recovery_run_get",
});

function capabilityHash(entry) {
  return stableHash(entry);
}

export function getRecoveryCapabilities({ env = null } = {}) {
  const staging = Boolean(env && isStagingEnvironment(env));
  const visibleKeys = staging ? new Set(["recovery_capabilities", "system_tool_get", "system_tools_search"]) : null;
  const capabilities = RECOVERY_KERNEL_CAPABILITIES
    .filter((entry) => !visibleKeys || visibleKeys.has(entry.capability_key))
    .map((entry) => ({ ...entry, capability_hash: capabilityHash(entry) }));
  return {
    ok: true,
    contract: RECOVERY_KERNEL_CONTRACT,
    version: RECOVERY_KERNEL_VERSION,
    environment_view: staging ? "staging_discovery_only" : "production_private_recovery",
    catalog_source: "repository_static_contract",
    catalog_hash: stableHash(capabilities),
    fixed_aliases: staging ? { recovery_capabilities: "recovery_capabilities", system_tool_get: "system_tool_get", system_tools_search: "system_tools_search" } : CAPABILITY_ALIASES,
    capabilities,
    public_surface_count: capabilities.length,
    database_independent_capabilities: capabilities.filter((entry) => !entry.dependencies.some((dependency) => dependency.includes("role") || dependency.includes("database"))).map((entry) => entry.capability_key),
    mutation_capabilities: capabilities.filter((entry) => entry.mutation).map((entry) => entry.capability_key),
    capability_levels: { R0: "observe", R1: "diagnose", R2: "simulate", R3: "governed_repair", R4: "privileged_recovery", R5: "disaster_recovery", legacy_R0: "identity_and_readiness", legacy_R1: "inspection", legacy_R2: "planning_and_simulation", legacy_R3: "reversible_repair", legacy_R4: "schema_or_grant_mutation", legacy_R5: "rebuild", legacy_R6: "cutover" },
    formal_recovery_modes: ["NORMAL", "DEGRADED", "RECOVERY_READONLY", "RECOVERY_CONTROLLED", "RECOVERY_PRIVILEGED", "DISASTER_RECOVERY", "VERIFYING", "RECOVERED"],
    ssh_levels: { S0: "connectivity_only", S1: "read_only_shell", S2: "service_diagnostics", S3: "file_or_config_repair", S4: "process_or_service_mutation", S5: "privileged_root_mutation" },
    sql_levels: { Q0: "metadata_only", Q1: "select", Q2: "temporary_session_changes", Q3: "dml", Q4: "grants", Q5: "additive_ddl", Q6: "destructive_ddl" },
    manifest_hash: readRecoveryManifest().manifest_hash,
    trust_model_contract: "mad4b.recovery-trust-model.v1",
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
  const roleCounts = inspection.role_database_object_counts && typeof inspection.role_database_object_counts === "object" ? inspection.role_database_object_counts : {};
  const roleClassifications = inspection.role_database_object_classifications && typeof inspection.role_database_object_classifications === "object" ? inspection.role_database_object_classifications : {};
  const roleCountFingerprints = inspection.role_database_object_count_fingerprints && typeof inspection.role_database_object_count_fingerprints === "object" ? inspection.role_database_object_count_fingerprints : {};
  const roleEvidenceAvailable = ["runtime", "governance", "runtime_persistence"].every((role) => Object.prototype.hasOwnProperty.call(roleClassifications, role) && Object.prototype.hasOwnProperty.call(roleCounts, role));
  const emptyRoles = new Set();
  if (roleEvidenceAvailable && inspection.full_inspection === true) {
    for (const role of ["runtime", "governance", "runtime_persistence"]) {
      if (roleClassifications[role] !== "zero_objects") continue;
      emptyRoles.add(role);
      const finding = inspectionFinding({
        targetRole: role,
        resource: `${role} database schema objects`,
        category: "empty_uninitialized_database",
        severity: "high",
        expected: { object_count: 0, object_kinds: ["tables", "views", "triggers", "routines", "events"] },
        actual: { classification: roleClassifications[role], object_counts: roleCounts[role], object_count_fingerprint: roleCountFingerprints[role] || null },
        authorityRef: `${role}.baseline.rebuild_empty`,
        repairability: "deterministic",
        mutationRequired: true,
      });
      finding.candidate_capability = `${role}.baseline.rebuild_empty`;
      findings.push(finding);
    }
  }
  const checkMap = [
    ["mcp_catalog_schema_ready", "governance", "admin_platform_endpoint_tools.mcp_catalog_level", "known_migration_gap", "high", "governance.mcp_catalog.repair", "20260815_custom_gpt_mcp_catalog_levels.sql"],
    ["governance_db_privilege_ready", "governance", "governance database privilege contract", "known_grant_gap", "high", "governance.grant.repair", "repository grant contract"],
    ["runtime_persistence_ready", "runtime_persistence", "governed_tool_response_chunks", "schema_drift", "high", "runtime_persistence.schema.repair", "persistence schema bundle"],
  ];
  for (const [check, role, resource, category, severity, candidate, authority] of checkMap) {
    if (checks[check] === true || emptyRoles.has(role)) continue;
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
  const roleRebuild = candidate.match(/^(runtime|governance|runtime_persistence)\.baseline\.rebuild_empty$/u);
  if (roleRebuild) return { classification: "empty_uninitialized_database", capability_key: candidate, operation: "database.rebuild_empty", target_role: roleRebuild[1], authority_ref: `${roleRebuild[1]}.baseline.rebuild_empty`, mutation_class: "C5" };
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

function isMutationRecoveryStore(recoveryStore) {
  return Boolean(isDurableRecoveryStore(recoveryStore)
    && typeof recoveryStore.claimExecution === "function"
    && typeof recoveryStore.reserveApproval === "function"
    && typeof recoveryStore.getExecutionTicket === "function"
    && typeof recoveryStore.putExecutionTicket === "function"
    && typeof recoveryStore.reserveExecutionTicket === "function"
    && typeof recoveryStore.releaseExecutionTicket === "function"
    && typeof recoveryStore.finalizeExecutionTicket === "function"
    && typeof recoveryStore.releaseExecutionClaim === "function"
    && (typeof recoveryStore.finalizeApproval === "function" || typeof recoveryStore.markApprovalUsed === "function")
    && (typeof recoveryStore.releaseApprovalReservation === "function")
    && recoveryStore.executionTicketVerifier
    && typeof recoveryStore.executionTicketVerifier.verify === "function");
}

function requireMutationRecoveryStore(recoveryStore) {
  if (!isMutationRecoveryStore(recoveryStore)) throw kernelError(503, "RECOVERY_MUTATION_STORE_UNAVAILABLE", "A mutation-grade durable store with atomic claims, approval reservation, and execution-ticket verification is required before any consequential step.");
  return recoveryStore;
}

async function claimExecution(recoveryStore, context) {
  if (!recoveryStore || typeof recoveryStore.claimExecution !== "function") throw kernelError(503, "RECOVERY_IDEMPOTENCY_CLAIM_UNAVAILABLE", "An atomic durable execution claim provider is required before any consequential step.");
  const result = await recoveryStore.claimExecution(sanitizeEvidence(context));
  if (result?.existing === true || result?.status === "reconciliation_required") return { existing: true, result: sanitizeEvidence(result) };
  if (result !== true && result?.claimed !== true) throw kernelError(409, "RECOVERY_IDEMPOTENCY_CLAIM_DENIED", "The durable recovery store did not grant the single execution claim.");
  return { existing: false, result: sanitizeEvidence(result) };
}

async function reserveApproval(recoveryStore, context) {
  if (!recoveryStore || typeof recoveryStore.reserveApproval !== "function") throw kernelError(503, "RECOVERY_APPROVAL_RESERVATION_UNAVAILABLE", "An atomic durable approval reservation provider is required before any consequential step.");
  const result = await recoveryStore.reserveApproval(sanitizeEvidence(context));
  if (result !== true && result?.reserved !== true) throw kernelError(409, "RECOVERY_APPROVAL_RESERVATION_DENIED", "The approval is already reserved, consumed, expired, or bound to another execution claim.");
  return result === true ? { reserved: true } : result;
}

async function reserveExecutionTicket(recoveryStore, context) {
  if (!recoveryStore || typeof recoveryStore.reserveExecutionTicket !== "function") throw kernelError(503, "RECOVERY_EXECUTION_TICKET_RESERVATION_UNAVAILABLE", "An atomic durable execution-ticket reservation provider is required before provider execution.");
  const result = await recoveryStore.reserveExecutionTicket(sanitizeEvidence(context));
  if (result !== true && result?.reserved !== true) throw kernelError(409, "RECOVERY_EXECUTION_TICKET_RESERVATION_DENIED", "The execution ticket is already reserved, finalized, expired, or bound to another execution claim.");
  return result === true ? { reserved: true } : result;
}

async function releaseExecutionTicket(recoveryStore, context) {
  if (!recoveryStore || typeof recoveryStore.releaseExecutionTicket !== "function") return;
  await recoveryStore.releaseExecutionTicket(sanitizeEvidence(context));
}

async function finalizeExecutionTicket(recoveryStore, context) {
  if (!recoveryStore || typeof recoveryStore.finalizeExecutionTicket !== "function") throw kernelError(503, "RECOVERY_EXECUTION_TICKET_FINALIZATION_UNAVAILABLE", "Execution-ticket finalization could not be confirmed durably.");
  const result = await recoveryStore.finalizeExecutionTicket(sanitizeEvidence(context));
  if (result !== undefined && result !== true && result?.finalized !== true && result?.already_finalized !== true) throw kernelError(503, "RECOVERY_EXECUTION_TICKET_FINALIZATION_FAILED", "Execution-ticket finalization failed; reconciliation is required and replay is forbidden.");
  return result === undefined || result === true ? { finalized: true } : result;
}

async function releaseApprovalReservation(recoveryStore, context) {
  if (!recoveryStore || typeof recoveryStore.releaseApprovalReservation !== "function") return;
  await recoveryStore.releaseApprovalReservation(sanitizeEvidence(context));
}

async function finalizeApproval(recoveryStore, context) {
  const finalizer = typeof recoveryStore?.finalizeApproval === "function" ? recoveryStore.finalizeApproval.bind(recoveryStore) : typeof recoveryStore?.markApprovalUsed === "function" ? recoveryStore.markApprovalUsed.bind(recoveryStore) : null;
  if (!finalizer) throw kernelError(503, "RECOVERY_APPROVAL_FINALIZATION_UNAVAILABLE", "An idempotent durable approval finalizer is required after provider acknowledgement.");
  const result = typeof recoveryStore.finalizeApproval === "function" ? await finalizer(sanitizeEvidence(context)) : await finalizer(context.approval_id);
  if (result !== undefined && result !== true && result?.finalized !== true && result?.already_finalized !== true) throw kernelError(503, "RECOVERY_APPROVAL_FINALIZATION_FAILED", "Approval finalization could not be durably recorded; reconciliation is required and replay is forbidden.");
  return result === undefined || result === true ? { finalized: true } : result;
}

async function heartbeatLease(recoveryLock, lockHandle, context) {
  if (!recoveryLock || typeof recoveryLock.heartbeat !== "function") throw kernelError(503, "RECOVERY_LOCK_HEARTBEAT_UNAVAILABLE", "A heartbeat-capable lease provider is required before every consequential mutation boundary.");
  const result = await recoveryLock.heartbeat({ ...sanitizeEvidence(context), lease_id: lockHandle.lease_id, fencing_token: lockHandle.fencing_token });
  if (result !== true && result?.renewed !== true && result?.valid !== true) throw kernelError(409, "RECOVERY_LOCK_HEARTBEAT_FAILED", "The recovery lease could not be renewed; execution stopped before the next mutation boundary.");
  return result;
}

async function assertLeaseFence(recoveryLock, lockHandle, context) {
  if (!recoveryLock || typeof recoveryLock.assertFence !== "function") throw kernelError(503, "RECOVERY_LOCK_FENCE_UNAVAILABLE", "A fenced lease provider is required before every consequential mutation boundary.");
  const result = await recoveryLock.assertFence({ ...sanitizeEvidence(context), lease_id: lockHandle.lease_id, fencing_token: lockHandle.fencing_token });
  if (result !== true && result?.valid !== true) throw kernelError(409, "RECOVERY_LOCK_FENCE_LOST", "The recovery lease fence is no longer valid; execution stopped before the next mutation boundary.");
  return result;
}

async function ensurePlan(planId, planHash = null, { recoveryStore } = {}) {
  let plan = null;
  if (recoveryStore && typeof recoveryStore.getPlan === "function") plan = await recoveryStore.getPlan(planId);
  if (!plan) plan = PLANS.get(planId);
  if (!plan) throw kernelError(404, "RECOVERY_PLAN_NOT_FOUND", "The requested recovery plan is not available.", { plan_id: planId });
  if (planHash && plan.plan_hash !== planHash) throw kernelError(409, "RECOVERY_PLAN_HASH_MISMATCH", "The requested recovery plan hash does not match the repository-bound plan.", { plan_id: planId });
  if (plan.expected_sha !== plan.expected_sha_at_creation) throw kernelError(409, "RECOVERY_PLAN_STALE", "The recovery plan is stale and must be recreated.");
  if (plan.target_fingerprint !== plan.target_fingerprint_at_creation) throw kernelError(409, "RECOVERY_TARGET_FINGERPRINT_MISMATCH", "The recovery plan target fingerprint is stale or invalid.");
  if (!plan.manifest_hash || plan.proof?.manifest_bound !== true) throw kernelError(409, "RECOVERY_MANIFEST_BINDING_MISSING", "The recovery plan is missing a valid repository-owned Recovery Manifest binding.");
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

function stateEvent(run, phase, event, details = {}) {
  const previousPhase = run.phase || null;
  const allowed = previousPhase === null
    ? phase === "created"
    : (RECOVERY_STATE_TRANSITIONS[previousPhase] || []).includes(phase);
  if (!allowed) throw kernelError(409, "RECOVERY_STATE_TRANSITION_INVALID", "Recovery state transition is not allowed by the repository state machine.", { run_id: run.run_id, previous_phase: previousPhase, next_phase: phase });
  const eventBase = {
    event,
    phase,
    previous_phase: previousPhase,
    at: new Date().toISOString(),
    run_id: run.run_id,
    plan_hash: run.plan_hash,
    step_id: run.step_id,
    expected_sha: run.expected_sha,
    target_key: run.target_key,
    ...sanitizeEvidence(details),
    secrets_included: false,
  };
  return { ...eventBase, evidence_hash: stableHash(eventBase) };
}

function stateStatus(phase) {
  return phase === "recovered" ? "recovered" : phase === "failed_closed" ? "failed_closed" : phase;
}

async function appendStateEvent(run, phase, event, { recoveryStore, requiredDurable = false, details = {} } = {}) {
  if (requiredDurable && (!recoveryStore || typeof recoveryStore.appendEvidenceEvent !== "function" || typeof recoveryStore.putRun !== "function")) {
    throw kernelError(503, "RECOVERY_EVIDENCE_STORE_UNAVAILABLE", "A durable append-only evidence store is required before consequential recovery transitions.");
  }
  const record = stateEvent(run, phase, event, details);
  run.events = Array.isArray(run.events) ? [...run.events, record] : [record];
  run.phase = phase;
  run.status = stateStatus(phase);
  try {
    await writeRun(run, { recoveryStore });
    if (requiredDurable) await recoveryStore.appendEvidenceEvent(run.run_id, sanitizeEvidence(record));
  } catch (error) {
    run.phase = "failed_closed";
    run.status = "failed_closed";
    run.evidence = { ...(run.evidence || {}), state_persistence_error: { code: text(error?.code || "RECOVERY_EVIDENCE_APPEND_FAILED", 128), message: "Append-only Recovery evidence could not be persisted; no automatic continuation is allowed.", secrets_included: false } };
    try { await writeRun(run, { recoveryStore }); } catch { /* fail closed even if fallback persistence is unavailable */ }
    if (error?.code === "RECOVERY_EVIDENCE_APPEND_FAILED") throw error;
    throw kernelError(503, "RECOVERY_EVIDENCE_APPEND_FAILED", "Append-only Recovery evidence could not be persisted; mutation is fail-closed.");
  }
  return record;
}

function createRunId(plan) {
  return `run:${stableHash({ plan_hash: plan.plan_hash, nonce: randomUUID() }).slice(0, 32)}`;
}

function createPlanId(input) {
  return `plan:${stableHash({ expected_sha: input.expected_sha, target_key: input.target_key, finding_ids: input.finding_ids, finding_hash: input.finding_hash || null, role_selection_hash: input.role_selection_hash || null, unsupported_capability_id: input.unsupported_capability_id || null, unsupported_capability_hash: input.unsupported_capability_hash || null }).slice(0, 32)}`;
}

function deriveRoleSelectionProofFromFindings(findings, expectedSha, targetFingerprints = {}, { durable = false } = {}) {
  const rebuildFindings = findings.filter((finding) => /^(runtime|governance|runtime_persistence)\.baseline\.rebuild_empty$/u.test(text(finding.candidate_capability, 160)));
  if (!rebuildFindings.length) return null;
  const selectedRoles = canonicalizeRoleSelection(rebuildFindings.map((finding) => finding.subject?.target_role));
  const inspectionRunIds = [...new Set(rebuildFindings.map((finding) => text(finding.inspection_run_id, 160)).filter(Boolean))];
  const inspectionEvidenceHashes = [...new Set(rebuildFindings.map((finding) => text(finding.inspection_evidence_hash, 128)).filter(Boolean))];
  const roleFingerprints = Object.fromEntries(selectedRoles.map((role) => [role, text(rebuildFindings.find((finding) => finding.subject?.target_role === role)?.observed_state?.actual?.object_count_fingerprint, 128)]));
  if (inspectionRunIds.length !== 1 || inspectionEvidenceHashes.length !== 1 || selectedRoles.length !== rebuildFindings.length || Object.values(roleFingerprints).some((value) => !value)) {
    throw kernelError(409, "RECOVERY_ROLE_SELECTION_PROVENANCE_UNAVAILABLE", "Role-selective Recovery planning requires one durable inspection run, one evidence hash, and a complete object-count fingerprint for every selected role.");
  }
  const proof = {
    source: durable ? "durable_full_inspection" : "inspection_memory_only",
    expected_sha: expectedSha,
    selected_roles: selectedRoles,
    inspection_run_id: inspectionRunIds[0],
    inspection_evidence_hash: inspectionEvidenceHashes[0],
    finding_ids: rebuildFindings.map((finding) => finding.finding_id).sort(),
    role_object_count_fingerprints: roleFingerprints,
    composite_target_fingerprint: text(targetFingerprints.composite, 128),
  };
  return { ...proof, selection_hash: computeRoleSelectionProofHash(proof) };
}

function planSteps(findings, targetFingerprints = {}, roleSelectionProof = null) {
  return findings.map((finding, index) => {
    const classified = classifyFinding(finding);
    const stepBase = {
      ordinal: index + 1,
      finding_id: finding.finding_id,
      classification: classified.classification,
      capability_key: classified.capability_key,
      operation: classified.operation,
      target_role: classified.target_role,
      target_fingerprint: targetFingerprints[classified.target_role] || targetFingerprints.composite || null,
      role_object_count_fingerprint: text(finding.observed_state?.actual?.object_count_fingerprint, 128) || (finding.observed_state?.actual?.object_counts ? stableHash(finding.observed_state.actual.object_counts) : null),
      role_object_classification: text(finding.observed_state?.actual?.classification, 80) || null,
      inspection_run_id: text(finding.inspection_run_id, 160) || null,
      inspection_evidence_hash: text(finding.inspection_evidence_hash, 128) || null,
      authority_ref: classified.authority_ref,
      mutation_class: classified.mutation_class,
      consequential: Boolean(classified.capability_key),
      approval_required: Boolean(classified.capability_key),
      execution_allowed: false,
      preconditions: ["production_identity_match", "plan_hash_match", "target_fingerprint_match", "recovery_lock_available", "single_use_approval"],
      postconditions: classified.capability_key ? ["schema_or_grant_readback", "ledger_or_privilege_readback", "behavioral_probe_or_readiness_pass"] : ["no_mutation", "fail_closed_record"],
      rollback: classified.capability_key === "governance.grant.repair" ? "exact_delta_revoke" : classified.capability_key ? "forward_only_or_capability_declared" : "not_applicable",
      role_selection_proof_hash: roleSelectionProof?.selection_hash || null,
      execution_ticket_required: Boolean(classified.capability_key),
    };
    return { ...stepBase, step_id: `step:${stableHash(stepBase).slice(0, 32)}`, step_hash: stableHash(stepBase) };
  });
}

export async function createRemediationPlan(input = {}, { recoveryStore, env = process.env } = {}) {
  assertObject(input);
  assertNoForbiddenKeys(input);
  const allowed = new Set(["expected_sha", "target_key", "finding_ids", "idempotency_key", "unsupported_capability_id", "unsupported_capability_hash"]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "Plan creation accepts only exact SHA, target, finding IDs, and an idempotency key.", { fields: unexpected });
  const expectedSha = requireSha(input.expected_sha);
  const targetKey = requireTargetKey(input.target_key);
  const identity = readProductionIdentity({ env, expectedSha });
  const manifestVerification = verifyRecoveryManifest({ expectedSha, identity: identityFromEnvironment(env), env });
  if (!manifestVerification.ok) throw kernelError(412, "RECOVERY_TRUST_ROOT_INVALID", "Recovery planning requires exact Production identity and Recovery Manifest binding.", { manifest_verification: manifestVerification });
  const targetFingerprints = deriveRoleTargetFingerprints({ env });
  const findingIds = Array.isArray(input.finding_ids) ? [...new Set(input.finding_ids.map((value) => text(value, 160)))] : [];
  if (findingIds.length > 50 || findingIds.some((id) => !FINDING_ID_RE.test(id))) throw kernelError(400, "RECOVERY_FINDINGS_INVALID", "finding_ids must contain zero to fifty registered finding IDs when a bounded capability reference is supplied.");
  const ephemeralRefId = input.unsupported_capability_id ? text(input.unsupported_capability_id, 160) : null;
  const ephemeralDigest = input.unsupported_capability_hash ? requireDigest(input.unsupported_capability_hash, "unsupported_capability_hash") : null;
  const hasUnsupportedReference = Boolean(ephemeralRefId || ephemeralDigest);
  if (!hasUnsupportedReference && findingIds.length === 0) throw kernelError(400, "RECOVERY_FINDINGS_INVALID", "Plan creation requires registered findings or one bounded unsupported capability reference.");
  if (hasUnsupportedReference && (!ephemeralRefId || !ephemeralDigest)) throw kernelError(400, "RECOVERY_UNSUPPORTED_REFERENCE_INVALID", "Unsupported plan binding requires both capability_id and capability_hash.");
  let temporaryReference = null;
  if (hasUnsupportedReference) {
    if (!recoveryStore || typeof recoveryStore.getEphemeralCapability !== "function") throw kernelError(503, "RECOVERY_CAPABILITY_STORE_UNAVAILABLE", "Unsupported plan binding requires a durable capability store; memory-only capability references cannot authorize a plan.");
    temporaryReference = await recoveryStore.getEphemeralCapability(ephemeralRefId);
    if (!temporaryReference || stableHash(temporaryReference) !== ephemeralDigest) throw kernelError(409, "RECOVERY_CAPABILITY_HASH_MISMATCH", "The ephemeral capability reference is absent or does not match its durable record.");
    if (temporaryReference.expected_sha !== expectedSha || temporaryReference.target_key !== targetKey) throw kernelError(409, "RECOVERY_CAPABILITY_TARGET_MISMATCH", "The ephemeral capability is not bound to the requested exact Production target.");
    if (Date.parse(temporaryReference.expires_at) <= Date.now() || temporaryReference.single_use === false) throw kernelError(409, "RECOVERY_CAPABILITY_NOT_EXECUTABLE", "The ephemeral capability is expired or not single-use and cannot be bound to a recovery plan.");
  }
  const findings = [];
  for (const findingId of findingIds) {
    let found = null;
    if (recoveryStore && typeof recoveryStore.getFinding === "function") found = await recoveryStore.getFinding(findingId);
    if (!found) found = [...RUNS.values()].flatMap((run) => run.findings || []).find((finding) => finding.finding_id === findingId);
    if (!found) throw kernelError(404, "RECOVERY_FINDING_NOT_FOUND", "A requested finding is not registered in the Recovery Kernel state.", { finding_id: findingId });
    findings.push(sanitizeEvidence(found));
  }
  const findingHash = stableHash(findings);
  const roleSelectionProof = deriveRoleSelectionProofFromFindings(findings, expectedSha, targetFingerprints, { durable: isDurableRecoveryStore(recoveryStore) });
  const planId = createPlanId({ expected_sha: expectedSha, target_key: targetKey, finding_ids: findingIds, finding_hash: findingHash, role_selection_hash: roleSelectionProof?.selection_hash || null });
  let existing = null;
  if (recoveryStore && typeof recoveryStore.getPlan === "function") existing = await recoveryStore.getPlan(planId);
  if (!existing) existing = PLANS.get(planId);
  if (existing) return sanitizeEvidence(existing);
  const steps = [
    ...planSteps(findings, targetFingerprints, roleSelectionProof),
    ...(temporaryReference ? [{
      ordinal: findings.length + 1,
      finding_id: null,
      classification: "registered_unsupported_capability",
      capability_key: "unsupported_capability_execute",
      operation: "unsupported_capability_execute",
      target_role: temporaryReference.target_role === "server_resolved" ? "composite" : temporaryReference.target_role,
      target_fingerprint: targetFingerprints[temporaryReference.target_role] || targetFingerprints.composite,
      authority_ref: `capability:${temporaryReference.capability_id}`,
      mutation_class: temporaryReference.risk_class === "destructive" ? "C6" : "C4",
      consequential: true,
      approval_required: true,
      execution_allowed: false,
      preconditions: ["production_identity_match", "plan_hash_match", "target_fingerprint_match", "recovery_lock_available", "single_use_approval", "ephemeral_capability_unexpired"],
      postconditions: ["provider_acknowledgement", "same_cycle_readback", "behavioral_probe_or_reconciliation"],
      rollback: "capability_declared_forward_only",
      unsupported_capability_id: temporaryReference.capability_id,
      unsupported_capability_hash: ephemeralDigest,
      incident_id: temporaryReference.incident_id,
      step_hash: null,
    }] : []),
  ].map((step) => step.step_hash ? step : { ...step, step_id: `step:${stableHash(step).slice(0, 32)}`, step_hash: stableHash(step) });
  const causalGraph = buildCausalFindingGraph(findings);
  const planBase = {
    contract: "mad4b.recovery-remediation-plan.v1",
    trust_model: "mad4b.recovery-trust-model.v1",
    plan_id: planId,
    expected_sha: expectedSha,
    expected_sha_at_creation: expectedSha,
    target_key: targetKey,
    target_fingerprint: targetFingerprints.composite,
    target_fingerprint_at_creation: targetFingerprints.composite,
    target_fingerprints: targetFingerprints,
    manifest_hash: manifestVerification.manifest_hash,
    runtime_attestation_hash: readRuntimeAttestation({ env, expectedSha }).attestation_hash,
    environment: "production",
    repository: RECOVERY_KERNEL_REPOSITORY,
    branch: RECOVERY_KERNEL_PRODUCTION_BRANCH,
    finding_ids: findingIds,
    finding_hash: findingHash,
    inspection_run_ids: [...new Set(findings.map((finding) => text(finding.inspection_run_id, 160)).filter(Boolean))],
    inspection_evidence_hashes: [...new Set(findings.map((finding) => text(finding.inspection_evidence_hash, 128)).filter(Boolean))],
    selected_rebuild_roles: [...new Set(steps.filter((step) => step.capability_key?.endsWith(".baseline.rebuild_empty")).map((step) => step.target_role))],
    role_selection_proof: roleSelectionProof,
    role_selection_hash: roleSelectionProof?.selection_hash || null,
    unsupported_capability: temporaryReference ? { capability_id: temporaryReference.capability_id, capability_hash: ephemeralDigest, incident_id: temporaryReference.incident_id, transport: temporaryReference.transport, capability_type: temporaryReference.capability_type, target_role: temporaryReference.target_role, scope_ref: temporaryReference.scope_ref, expires_at: temporaryReference.expires_at, single_use: true, content_received: false } : null,
    steps,
    status: "planned",
    blast_radius: (() => {
      const databaseRoles = [...new Set(steps.map((step) => step.target_role).filter((role) => role !== "unknown"))];
      const roleRebuild = steps.some((step) => step.mutation_class === "C5");
      return {
        database_roles: databaseRoles,
        tables_max: roleRebuild ? null : 1,
        schema_objects_max: roleRebuild ? "derived_from_role_bundle_manifests" : null,
        rows_data_mutation: false,
        schema_mutation: roleRebuild || steps.some((step) => step.mutation_class === "C3"),
        grants_mutation: steps.some((step) => step.mutation_class === "C2"),
        cross_database: new Set(databaseRoles).size > 1,
        logical_owner_roles: databaseRoles,
        mutation_target_roles: databaseRoles,
        evidence_target_roles: databaseRoles,
      };
    })(),
    mutation_scope: steps.filter((step) => step.consequential).map((step) => ({ step_id: step.step_id, operation: step.operation, target_role: step.target_role, capability_key: step.capability_key })),
    rollback_strategy: steps.some((step) => step.rollback === "forward_only_or_capability_declared") ? "capability_declared_forward_only" : "exact_delta_or_none",
    required_approval: steps.some((step) => step.approval_required) ? "APPROVE_RECOVERY_STEP:<plan_hash>:<step_hash>:<expected_sha>:<target_key>" : null,
    expected_postconditions: [...new Set(steps.flatMap((step) => step.postconditions))],
    idempotency_key: text(input.idempotency_key, 160) || null,
    database_independent_control_plane: true,
    causal_graph: causalGraph,
    proof: {
      exact_production_sha: identity.git_sha === expectedSha,
      manifest_bound: manifestVerification.ok,
      target_fingerprint_bound: Boolean(targetFingerprints.composite),
      role_selection_provenance_bound: Boolean(!roleSelectionProof || (roleSelectionProof.source === "durable_full_inspection" && roleSelectionProof.selection_hash && isDurableRecoveryStore(recoveryStore))),
      authority_resolved: steps.every((step) => Boolean(step.capability_key || step.classification === "unknown_fail_closed")),
      unknown_drift: findings.some((finding) => finding.repairability === "unknown_fail_closed"),
      preconditions_satisfied: findings.every((finding) => finding.repairability !== "unknown_fail_closed"),
      execution_requires_fresh_trust_and_approval: true,
    },
    execution_transport: "server_resolved_capability_executor",
    execution_allowed: false,
    secrets_included: false,
  };
  const plan = { ...planBase, plan_hash: stableHash(planBase) };
  PLANS.set(planId, plan);
  if (recoveryStore && typeof recoveryStore.putFinding === "function") {
    for (const finding of findings) await recoveryStore.putFinding(sanitizeEvidence(finding));
  }
  if (recoveryStore && typeof recoveryStore.putPlan === "function") await recoveryStore.putPlan(sanitizeEvidence(plan));
  return sanitizeEvidence(plan);
}

export async function previewRemediationPlan(input = {}, { recoveryStore } = {}) {
  assertObject(input);
  assertNoForbiddenKeys(input);
  const allowed = new Set(["plan_id", "plan_hash", "step_id"]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "Plan preview accepts only plan and optional step references.", { fields: unexpected });
  const planId = requireId(input.plan_id, PLAN_ID_RE, "plan_id", "RECOVERY_PLAN_ID_INVALID");
  const plan = await ensurePlan(planId, text(input.plan_hash, 128) || null, { recoveryStore });
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

export async function createApprovalChallenge(input = {}, { approvalIssuer, approvalStore, recoveryStore } = {}) {
  assertObject(input);
  assertNoForbiddenKeys(input);
  const allowed = new Set(["plan_id", "plan_hash", "step_id"]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "Approval challenge creation accepts only plan and step references.", { fields: unexpected });
  const planId = requireId(input.plan_id, PLAN_ID_RE, "plan_id", "RECOVERY_PLAN_ID_INVALID");
  const stepId = requireId(input.step_id, STEP_ID_RE, "step_id", "RECOVERY_STEP_ID_INVALID");
  const plan = await ensurePlan(planId, text(input.plan_hash, 128) || null, { recoveryStore });
  const step = ensureStep(plan, stepId);
  if (!step.approval_required) throw kernelError(409, "RECOVERY_APPROVAL_NOT_REQUIRED", "The selected step is read-only and does not require an approval challenge.");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const approvalId = `approval:${stableHash({ plan_hash: plan.plan_hash, step_id: step.step_id, nonce: randomUUID() }).slice(0, 32)}`;
  const challengeBase = { contract: "mad4b.recovery-approval-challenge.v1", approval_id: approvalId, plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id, step_hash: stableHash(step), expected_sha: plan.expected_sha, target_key: plan.target_key, target_fingerprint: plan.target_fingerprint, composite_target_fingerprint: plan.target_fingerprint, step_target_fingerprint: step.target_fingerprint, target_role: step.target_role, approval_class: step.mutation_class, expires_at: expiresAt, single_use: true, non_transferable: true, secrets_included: false };
  const issued = approvalIssuer && typeof approvalIssuer.createChallenge === "function" ? await approvalIssuer.createChallenge(sanitizeEvidence(challengeBase)) : null;
  if (approvalStore && typeof approvalStore.putChallenge === "function") await approvalStore.putChallenge(sanitizeEvidence(challengeBase));
  const challenge = { ...challengeBase, issuer: issued ? "injected_approval_issuer" : "repository_challenge_reference_only", challenge_hash: stableHash(challengeBase), execution_ready: Boolean(issued && approvalStore && typeof approvalStore.putChallenge === "function") };
  APPROVALS.set(approvalId, { ...challenge, used: false, issued });
  if (recoveryStore && typeof recoveryStore.putApproval === "function") await recoveryStore.putApproval(sanitizeEvidence({ ...challenge, used: false }));
  return sanitizeEvidence({ ok: true, ...challenge, approval_token_required: true, approval_token_not_returned: true, read_only_probe: true, ...noMutationAttestation({ read_only_probe: true }) });
}

export async function createExecutionTicket(input = {}, { recoveryStore, executionTicketSigner } = {}) {
  assertObject(input);
  assertNoForbiddenKeys(input);
  const allowed = new Set(["plan_id", "plan_hash", "step_id", "idempotency_key"]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "Execution-ticket issuance accepts only plan, step, and idempotency references.", { fields: unexpected });
  const planId = requireId(input.plan_id, PLAN_ID_RE, "plan_id", "RECOVERY_PLAN_ID_INVALID");
  const stepId = requireId(input.step_id, STEP_ID_RE, "step_id", "RECOVERY_STEP_ID_INVALID");
  const plan = await ensurePlan(planId, text(input.plan_hash, 128) || null, { recoveryStore });
  const step = ensureStep(plan, stepId);
  if (!step.consequential) throw kernelError(409, "RECOVERY_TICKET_NOT_REQUIRED", "Execution tickets are reserved for consequential Recovery steps.");
  requireMutationRecoveryStore(recoveryStore);
  if (!executionTicketSigner || typeof executionTicketSigner.sign !== "function") throw kernelError(503, "RECOVERY_EXECUTION_TICKET_SIGNER_UNAVAILABLE", "A server-side execution-ticket signer is required; tickets are never self-issued or synthesized.");
  const ticket = await issueExecutionTicket({
    inspection_run_id: plan.role_selection_proof?.inspection_run_id || `run:${plan.plan_id.slice(-32)}`,
    inspection_evidence_hash: plan.role_selection_proof?.inspection_evidence_hash || plan.finding_hash,
    finding_ids: plan.finding_ids,
    selected_roles: plan.role_selection_proof?.selected_roles || ["composite"],
    role_selection_required: step.mutation_class === "C5",
    role_object_count_fingerprints: plan.role_selection_proof?.role_object_count_fingerprints || {},
    target_fingerprints: plan.target_fingerprints || { composite: plan.target_fingerprint },
    role_selection_hash: plan.role_selection_hash || null,
    production_sha: plan.expected_sha,
    target_key: plan.target_key,
    plan_hash: plan.plan_hash,
    step_hash: step.step_hash,
    step_id: step.step_id,
    target_role: step.target_role,
    idempotency_key: text(input.idempotency_key, 160),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    nonce: randomUUID(),
  }, { signer: executionTicketSigner });
  await recoveryStore.putExecutionTicket(ticket);
  return sanitizeEvidence({ ok: true, ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id, expires_at: ticket.expires_at, single_use: true, signature_not_returned: true, secrets_included: false });
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
  if (approval.plan_hash !== context.plan_hash || approval.step_id !== context.step_id || approval.step_hash !== context.step_hash) return false;
  if (approval.composite_target_fingerprint && approval.composite_target_fingerprint !== context.composite_target_fingerprint) return false;
  if (approval.step_target_fingerprint && approval.step_target_fingerprint !== context.step_target_fingerprint) return false;
  if (approval.target_role && approval.target_role !== context.target_role) return false;
  if (approvalVerifier && typeof approvalVerifier.verify === "function") {
    return (await approvalVerifier.verify({ token, approval: sanitizeEvidence(approval), context: sanitizeEvidence(context) })) === true;
  }
  return false;
}

async function acquireLock(targetKey, planHash, { recoveryLock } = {}) {
  if (!recoveryLock || typeof recoveryLock.acquire !== "function") throw kernelError(503, "RECOVERY_LOCK_UNAVAILABLE", "A durable recovery lock provider is required before any mutation step.");
  const result = await recoveryLock.acquire({ target_key: targetKey, plan_hash: planHash, ttl_seconds: 600, fencing_required: true, heartbeat_required: true });
  if (result !== true && result?.acquired !== true) throw kernelError(409, "RECOVERY_LOCK_BUSY", "Another consequential recovery operation owns the target lock.");
  const handle = result === true ? { acquired: true } : result;
  if (!handle.lease_id || !handle.fencing_token || !handle.expires_at) throw kernelError(503, "RECOVERY_LOCK_FENCE_UNAVAILABLE", "The lock provider did not return a lease ID, fencing token, and expiry.");
  if (typeof recoveryLock.heartbeat !== "function" || typeof recoveryLock.assertFence !== "function") throw kernelError(503, "RECOVERY_LOCK_HEARTBEAT_UNAVAILABLE", "The lock provider did not expose heartbeat and fencing support for long-running recovery.");
  return handle;
}

async function releaseLock(lockHandle, targetKey, planHash, { recoveryLock } = {}) {
  if (!recoveryLock || typeof recoveryLock.release !== "function") return;
  await recoveryLock.release({ target_key: targetKey, plan_hash: planHash, lock: lockHandle });
}

function hasIndependentRecoveryStoreBoundary(recoveryStore) {
  return recoveryStore?.recovery_store_contract === "mad4b.recovery-durable-store.v1"
    && recoveryStore?.independent_of_target_databases === true
    && recoveryStore?.target_database_binding === "forbidden"
    && recoveryStore?.provider_accessed === false;
}

function isDurableRecoveryStore(recoveryStore) {
  return Boolean(
    hasIndependentRecoveryStoreBoundary(recoveryStore)
    && typeof recoveryStore.putRun === "function"
    && typeof recoveryStore.getRun === "function"
    && typeof recoveryStore.putPlan === "function"
    && typeof recoveryStore.getPlan === "function"
    && typeof recoveryStore.putFinding === "function"
    && typeof recoveryStore.getFinding === "function"
    && typeof recoveryStore.getRunByIdempotency === "function"
    && typeof recoveryStore.appendEvidenceEvent === "function"
    && typeof recoveryStore.putIdempotencyReceipt === "function"
  );
}

function requireDurableRecoveryStore(recoveryStore) {
  if (!isDurableRecoveryStore(recoveryStore)) {
    throw kernelError(503, "RECOVERY_STORE_UNAVAILABLE", "A durable append-only recovery store with durable idempotency is required before any consequential step; in-memory state is test-only and cannot authorize mutation.");
  }
  return recoveryStore;
}

export async function executeRemediationStep(input = {}, { env = process.env, adminPrincipal, approvalVerifier, approvalStore, recoveryLock, mutationExecutor, recoveryStore, unsupportedBroker, readbackVerifier } = {}) {
  assertObject(input);
  assertNoForbiddenKeys(input);
  const allowed = new Set(["plan_id", "plan_hash", "step_id", "approval_token", "idempotency_key", "execution_ticket_id"]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "Step execution accepts only plan, step, approval, and idempotency references.", { fields: unexpected });
  const planId = requireId(input.plan_id, PLAN_ID_RE, "plan_id", "RECOVERY_PLAN_ID_INVALID");
  const plan = await ensurePlan(planId, text(input.plan_hash, 128) || null, { recoveryStore });
  const stepId = requireId(input.step_id, STEP_ID_RE, "step_id", "RECOVERY_STEP_ID_INVALID");
  const step = ensureStep(plan, stepId);
  if (!step.consequential) throw kernelError(409, "RECOVERY_STEP_NOT_CONSEQUENTIAL", "Read-only or fail-closed steps cannot be executed as mutations.");
  const idempotencyKey = text(input.idempotency_key, 160);
  if (!idempotencyKey) throw kernelError(400, "RECOVERY_IDEMPOTENCY_KEY_REQUIRED", "A caller-supplied idempotency_key is required for every consequential recovery step.");
  requireMutationRecoveryStore(recoveryStore);
  const externalExisting = await recoveryStore.getRunByIdempotency(idempotencyKey);
  if (externalExisting) {
    if ((externalExisting.plan_hash && externalExisting.plan_hash !== plan.plan_hash) || (externalExisting.step_id && externalExisting.step_id !== step.step_id) || (externalExisting.execution_ticket_id && text(input.execution_ticket_id, 160) && externalExisting.execution_ticket_id !== text(input.execution_ticket_id, 160))) {
      throw kernelError(409, "RECOVERY_IDEMPOTENCY_BINDING_MISMATCH", "The idempotency key is already bound to a different plan, step, or execution ticket.");
    }
    const unknown = externalExisting.phase === "execution_outcome_unknown" || externalExisting.status === "execution_outcome_unknown";
    return sanitizeEvidence({ ...externalExisting, status: unknown ? "reconciliation_required" : externalExisting.status, reconciliation_required: unknown, idempotent_replay: true });
  }
  const executionTicketId = text(input.execution_ticket_id, 160);
  if (!executionTicketId) throw kernelError(400, "RECOVERY_EXECUTION_TICKET_REQUIRED", "A single-use signed execution ticket is required for every consequential recovery step.");
  if (!readbackVerifier || typeof readbackVerifier.verify !== "function") throw kernelError(503, "RECOVERY_READBACK_UNAVAILABLE", "A same-cycle readback verifier is required before any consequential provider execution.");
  if (typeof recoveryStore.getExecutionTicket !== "function" || !recoveryStore.executionTicketVerifier || typeof recoveryStore.executionTicketVerifier.verify !== "function") throw kernelError(503, "RECOVERY_EXECUTION_TICKET_STORE_UNAVAILABLE", "A durable execution-ticket store and verifier are required before any consequential step.");
  const executionTicket = await recoveryStore.getExecutionTicket(executionTicketId);
  if (!executionTicket) throw kernelError(404, "RECOVERY_EXECUTION_TICKET_NOT_FOUND", "The requested execution ticket is not available.");
  try {
    await verifyExecutionTicket(executionTicket, { verifier: recoveryStore.executionTicketVerifier, expected: { plan_hash: plan.plan_hash, step_hash: step.step_hash, step_id: step.step_id, production_sha: plan.expected_sha, target_key: plan.target_key, idempotency_key: idempotencyKey, target_role: step.target_role, role_selection_hash: plan.role_selection_hash || null, target_fingerprints: plan.target_fingerprints || { composite: plan.target_fingerprint }, selected_roles: plan.role_selection_proof?.selected_roles || ["composite"] } });
  } catch {
    throw kernelError(401, "RECOVERY_EXECUTION_TICKET_INVALID", "The execution ticket is absent, expired, invalid, or not bound to this exact plan step.");
  }
  const claimContext = { idempotency_key: idempotencyKey, plan_hash: plan.plan_hash, step_id: step.step_id, execution_ticket_id: executionTicketId, execution_ticket_hash: executionTicket.ticket_hash };
  const claim = await claimExecution(recoveryStore, { ...claimContext, step_hash: step.step_hash });
  if (claim.existing) return sanitizeEvidence({ ok: false, status: "reconciliation_required", phase: "execution_outcome_unknown", idempotency_key: idempotencyKey, plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id, existing_claim: claim.result, reconciliation_required: true, idempotent_replay: true, database_mutation_performed: "unknown", secrets_included: false });
  let approvalToken;
  let approval;
  let approvalContext;
  try {
    approvalToken = assertApprovalTokenShape(input.approval_token);
    const storedDecision = recoveryStore && typeof recoveryStore.getApprovalByPlanStep === "function"
      ? await recoveryStore.getApprovalByPlanStep(plan.plan_id, step.step_id)
      : null;
    const latestApproval = [...APPROVALS.values()].reverse().find((entry) => entry.plan_id === plan.plan_id && entry.step_id === step.step_id);
    approval = storedDecision || latestApproval
      || (approvalStore && typeof approvalStore.getChallenge === "function" ? await approvalStore.getChallenge(plan.plan_hash, step.step_id) : null);
    approvalContext = { plan_hash: plan.plan_hash, step_id: step.step_id, step_hash: stableHash(step), expected_sha: plan.expected_sha, target_key: plan.target_key, target_fingerprint: plan.target_fingerprint, composite_target_fingerprint: plan.target_fingerprint, step_target_fingerprint: step.target_fingerprint, target_role: step.target_role };
    const approvalValid = await verifyApproval(approval, approvalToken, approvalContext, { approvalVerifier, approvalStore });
    if (!approvalValid) throw kernelError(401, "RECOVERY_APPROVAL_INVALID", "Approval is absent, expired, already used, or not cryptographically bound to this plan step.");
    if (plan.proof?.unknown_drift === true || plan.proof?.preconditions_satisfied !== true || plan.proof?.role_selection_provenance_bound !== true) throw kernelError(409, "RECOVERY_UNKNOWN_DRIFT", "The proof-carrying plan contains unknown drift, unverified provenance, or unsatisfied preconditions; mutation is denied.");
    if (String(env.RECOVERY_MUTATIONS_ENABLED || "").trim().toLowerCase() !== "true") throw kernelError(423, "RECOVERY_MUTATIONS_DISABLED", "Recovery mutations are disabled by the server kill-switch.");
    assertTrustForMutation({ expectedSha: plan.expected_sha, env, targetFingerprint: step.target_fingerprint || plan.target_fingerprint, targetRole: step.target_role, adminPrincipal });
  } catch (error) {
    await recoveryStore.releaseExecutionClaim(claimContext).catch(() => {});
    throw error;
  }
  const approvalReservationContext = { ...approvalContext, approval_id: approval.approval_id, idempotency_key: idempotencyKey, execution_ticket_id: executionTicketId };
  let providerBoundaryStarted = false;
  try {
    await reserveApproval(recoveryStore, approvalReservationContext);
  } catch (error) {
    if (typeof recoveryStore.releaseExecutionClaim === "function") await recoveryStore.releaseExecutionClaim(claimContext);
    throw error;
  }
  let lockHandle;
  try { lockHandle = await acquireLock(plan.target_key, plan.plan_hash, { recoveryLock }); } catch (error) {
    await releaseApprovalReservation(recoveryStore, approvalReservationContext).catch(() => {});
    await recoveryStore.releaseExecutionClaim(claimContext).catch(() => {});
    throw error;
  }
  let run = null;
  let executionTicketReserved = false;
  try {
    run = {
      run_id: createRunId(plan),
      status: "created",
      plan_id: plan.plan_id,
      plan_hash: plan.plan_hash,
      step_id: step.step_id,
      expected_sha: plan.expected_sha,
      target_key: plan.target_key,
      target_fingerprint: plan.target_fingerprint,
      idempotency_key: idempotencyKey,
      started_at: new Date().toISOString(),
      findings: [],
      phase: null,
      events: [],
      execution_ticket_id: executionTicketId,
      execution_ticket_hash: executionTicket.ticket_hash,
      evidence: { intent_recorded: true, approval_verified: false, approval_reserved: true, execution_started: false, execution_outcome: "not_started", provider_receipt: null, verification: null, secrets_included: false },
    };
    await appendStateEvent(run, "created", "recovery_run_created", { recoveryStore, requiredDurable: true });
    await appendStateEvent(run, "planned", "plan_bound", { recoveryStore, requiredDurable: true, details: { plan_hash: plan.plan_hash } });
    await appendStateEvent(run, "awaiting_approval", "approval_required", { recoveryStore, requiredDurable: true, details: { approval_id: approval.approval_id || null } });
    await appendStateEvent(run, "approval_granted", "approval_verified", { recoveryStore, requiredDurable: true, details: { approval_id: approval.approval_id || null } });
    await appendStateEvent(run, "locked", "recovery_lock_acquired", { recoveryStore, requiredDurable: true, details: { lease_id: lockHandle.lease_id, fencing_token: lockHandle.fencing_token, expires_at: lockHandle.expires_at } });
    await heartbeatLease(recoveryLock, lockHandle, { target_key: plan.target_key, plan_hash: plan.plan_hash, step_id: step.step_id, boundary: "before_provider_execution" });
    await assertLeaseFence(recoveryLock, lockHandle, { target_key: plan.target_key, plan_hash: plan.plan_hash, step_id: step.step_id, boundary: "before_provider_execution" });
    await reserveExecutionTicket(recoveryStore, { ticket_id: executionTicketId, ticket_hash: executionTicket.ticket_hash, plan_hash: plan.plan_hash, step_hash: step.step_hash, step_id: step.step_id, idempotency_key: idempotencyKey });
    executionTicketReserved = true;
    await appendStateEvent(run, "executing", "execution_started", { recoveryStore, requiredDurable: true, details: { execution_ticket_id: executionTicketId } });
    run.evidence.approval_verified = true;
    run.evidence.execution_started = true;
    await writeRun(run, { recoveryStore });
    let result;
    const executionPayload = {
      capability_key: step.capability_key,
      operation: step.operation,
      target_role: step.target_role,
      authority_ref: step.authority_ref,
      expected_sha: plan.expected_sha,
      target_key: plan.target_key,
      target_fingerprint: step.target_fingerprint || plan.target_fingerprint,
      plan_hash: plan.plan_hash,
      step_id: step.step_id,
      idempotency_key: idempotencyKey,
      execution_ticket_id: executionTicketId,
      execution_ticket_hash: executionTicket.ticket_hash,
      lease_id: lockHandle.lease_id,
      fencing_token: lockHandle.fencing_token,
      role_selection_proof_hash: plan.role_selection_hash || null,
    };
    try {
      if (step.capability_key === "unsupported_capability_execute") {
        if (!plan.unsupported_capability || plan.unsupported_capability.capability_id !== step.unsupported_capability_id || plan.unsupported_capability.capability_hash !== step.unsupported_capability_hash) throw kernelError(409, "RECOVERY_UNSUPPORTED_PLAN_BINDING_INVALID", "The unsupported capability is not bound to the immutable recovery plan step.");
        if (!unsupportedBroker || typeof unsupportedBroker.execute !== "function") throw kernelError(503, "UNSUPPORTED_BROKER_UNAVAILABLE", "No managed Unsupported Recovery broker is configured; no SSH or SQL action was attempted.");
        providerBoundaryStarted = true;
        result = await executeUnsupportedCapability({ incident_id: plan.unsupported_capability.incident_id || `incident:${plan.plan_id.slice(-24)}`, expected_sha: plan.expected_sha, target_key: plan.target_key, capability_id: step.unsupported_capability_id, capability_hash: step.unsupported_capability_hash, approval_id: approval.approval_id, idempotency_key: idempotencyKey, execution_ticket_id: executionTicketId, execution_ticket_hash: executionTicket.ticket_hash, plan_hash: plan.plan_hash, step_hash: step.step_hash, step_id: step.step_id, lease_id: lockHandle.lease_id, fencing_token: lockHandle.fencing_token }, { env, adminPrincipal, unsupportedBroker, recoveryStore });
      } else {
        if (!mutationExecutor || typeof mutationExecutor.execute !== "function") throw kernelError(503, "RECOVERY_EXECUTOR_UNAVAILABLE", "No capability executor is configured; mutation was not attempted.");
        providerBoundaryStarted = true;
        result = await mutationExecutor.execute(executionPayload);
      }
    } catch (error) {
      const preProviderCodes = new Set(["RECOVERY_EXECUTOR_UNAVAILABLE", "UNSUPPORTED_BROKER_UNAVAILABLE", "UNSUPPORTED_ADMIN_PRINCIPAL_REQUIRED", "UNSUPPORTED_CAPABILITY_NOT_FOUND", "UNSUPPORTED_CAPABILITY_CONSUMED", "RECOVERY_UNSUPPORTED_PLAN_BINDING_INVALID"]);
      if (!providerBoundaryStarted && preProviderCodes.has(error?.code)) {
        await releaseApprovalReservation(recoveryStore, approvalReservationContext).catch(() => {});
        await recoveryStore.releaseExecutionClaim(claimContext).catch(() => {});
        throw error;
      }
      run.evidence.execution_outcome = "unknown";
      run.evidence.execution_error = { code: text(error?.code || "recovery_executor_failed", 128), message: "The capability provider outcome is unknown; same-cycle readback is required and replay is forbidden.", secrets_included: false };
      await appendStateEvent(run, "execution_outcome_unknown", "provider_outcome_unknown", { recoveryStore, requiredDurable: true, details: { error_code: text(error?.code || "recovery_executor_failed", 128) } });
      throw kernelError(502, "RECOVERY_EXECUTION_OUTCOME_UNKNOWN", "The capability provider outcome is unknown; recovery is reconciliation-only and must not be replayed automatically.", { run_id: run.run_id });
    }
    try {
      await heartbeatLease(recoveryLock, lockHandle, { target_key: plan.target_key, plan_hash: plan.plan_hash, step_id: step.step_id, boundary: "after_provider_execution" });
      await assertLeaseFence(recoveryLock, lockHandle, { target_key: plan.target_key, plan_hash: plan.plan_hash, step_id: step.step_id, boundary: "after_provider_execution" });
    } catch (error) {
      run.evidence.execution_outcome = "unknown";
      run.evidence.execution_error = { code: text(error?.code || "RECOVERY_LOCK_FENCE_LOST", 128), message: "The provider returned but the execution fence was lost; readback is required and replay is forbidden.", secrets_included: false };
      await appendStateEvent(run, "execution_outcome_unknown", "post_provider_fence_lost", { recoveryStore, requiredDurable: true, details: { error_code: text(error?.code || "RECOVERY_LOCK_FENCE_LOST", 128) } });
      throw kernelError(409, "RECOVERY_EXECUTION_OUTCOME_UNKNOWN", "The provider returned but the execution fence was lost; recovery is reconciliation-only.", { run_id: run.run_id });
    }
    try {
      await finalizeExecutionTicket(recoveryStore, { ticket_id: executionTicketId, ticket_hash: executionTicket.ticket_hash, plan_hash: plan.plan_hash, step_hash: step.step_hash, step_id: step.step_id, idempotency_key: idempotencyKey, provider_acknowledged: true });
      executionTicketReserved = false;
      await finalizeApproval(recoveryStore, { ...approvalReservationContext, provider_acknowledged: true });
    } catch (error) {
      run.evidence.execution_outcome = "unknown";
      run.evidence.execution_error = { code: text(error?.code || "RECOVERY_APPROVAL_FINALIZATION_FAILED", 128), message: "Provider acknowledgement was received but approval finalization was not durably confirmed; reconciliation is required and replay is forbidden.", secrets_included: false };
      await appendStateEvent(run, "execution_outcome_unknown", "approval_finalization_failed", { recoveryStore, requiredDurable: true, details: { error_code: text(error?.code || "RECOVERY_APPROVAL_FINALIZATION_FAILED", 128) } });
      throw kernelError(502, "RECOVERY_EXECUTION_OUTCOME_UNKNOWN", "Provider acknowledgement cannot be safely replayed because approval finalization is not durably confirmed.", { run_id: run.run_id });
    }
    approval.used = true;
    run.evidence.approval_finalized = true;
    run.evidence.provider_receipt = sanitizeEvidence(result);
    run.evidence.database_mutation_performed = result?.database_mutation_performed === true;
    run.evidence.verification_required = true;
    await appendStateEvent(run, "provider_acknowledged", "provider_acknowledged", { recoveryStore, requiredDurable: true, details: { database_mutation_performed: run.evidence.database_mutation_performed } });
    await appendStateEvent(run, run.evidence.database_mutation_performed ? "readback_pending" : "verifying", run.evidence.database_mutation_performed ? "readback_required" : "verification_pending", { recoveryStore, requiredDurable: true });
    const receipt = sanitizeEvidence({ ok: true, contract: "mad4b.recovery-remediation-execution-receipt.v1", run_id: run.run_id, plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id, status: run.status, phase: run.phase, idempotency_key: idempotencyKey,       execution_ticket_id: executionTicketId, execution_ticket_hash: executionTicket.ticket_hash, mutation_attestation: { ...noMutationAttestation({ read_only_probe: false }), database_mutation_performed: result?.database_mutation_performed === true }, readback_required: true, approval_reserved: true, secrets_included: false });
    await recoveryStore.putIdempotencyReceipt(idempotencyKey, receipt);
    return receipt;
  } catch (error) {
    if (providerBoundaryStarted && run && run.phase !== "execution_outcome_unknown") {
      const errorCode = text(error?.code || "RECOVERY_POST_PROVIDER_PERSISTENCE_FAILED", 128);
      run.evidence.execution_outcome = "unknown";
      run.evidence.execution_error = { code: errorCode, message: "A post-provider control-plane step failed; the outcome is unknown and reconciliation is required. Automatic replay is forbidden.", secrets_included: false };
      try {
        await appendStateEvent(run, "execution_outcome_unknown", "post_provider_control_plane_failure", { recoveryStore, requiredDurable: true, details: { error_code: errorCode } });
      } catch {
        run.phase = "execution_outcome_unknown";
        run.status = "execution_outcome_unknown";
        try { await writeRun(run, { recoveryStore }); } catch { /* durable persistence failure remains fail-closed */ }
      }
      if (error?.code !== "RECOVERY_EXECUTION_OUTCOME_UNKNOWN") {
        error = kernelError(502, "RECOVERY_EXECUTION_OUTCOME_UNKNOWN", "A provider-bound recovery operation cannot be replayed because a post-provider control-plane step failed; reconciliation is required.", { run_id: run.run_id });
      }
    }
    if (!providerBoundaryStarted) {
      if (executionTicketReserved) await releaseExecutionTicket(recoveryStore, { ticket_id: executionTicketId, ticket_hash: executionTicket.ticket_hash, plan_hash: plan.plan_hash, step_hash: step.step_hash, step_id: step.step_id, idempotency_key: idempotencyKey }).catch(() => {});
      await releaseApprovalReservation(recoveryStore, approvalReservationContext).catch(() => {});
      await recoveryStore.releaseExecutionClaim(claimContext).catch(() => {});
    }
    if (run && !providerBoundaryStarted && !["failed_closed", "recovered", "execution_outcome_unknown"].includes(run.phase)) {
      try { await appendStateEvent(run, "failed_closed", "recovery_failed_closed", { recoveryStore, requiredDurable: true, details: { error_code: text(error?.code || "recovery_failed_closed", 128) } }); } catch { /* preserve fail-closed result if evidence persistence itself fails */ }
    }
    throw error;
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
  const plan = await ensurePlan(planId, text(input.plan_hash, 128) || null, { recoveryStore });
  const stepId = requireId(input.step_id, STEP_ID_RE, "step_id", "RECOVERY_STEP_ID_INVALID");
  const step = ensureStep(plan, stepId);
  if (!readbackVerifier || typeof readbackVerifier.verify !== "function") throw kernelError(503, "RECOVERY_READBACK_UNAVAILABLE", "No same-cycle readback verifier is configured; recovery remains unverified.");
  requireDurableRecoveryStore(recoveryStore);
  const run = (await recoveryStore.getRunByPlanStep?.(plan.plan_id, step.step_id))
    || [...RUNS.values()].reverse().find((candidate) => candidate.plan_id === plan.plan_id && candidate.step_id === step.step_id);
  if (!run) throw kernelError(404, "RECOVERY_RUN_NOT_FOUND", "No durable execution run is available for the requested plan step.");
  const result = await readbackVerifier.verify({ plan: sanitizeEvidence(plan), step: sanitizeEvidence(step), run: sanitizeEvidence(run) });
  const passed = result?.postconditions_passed === true && result?.behavioral_probe_passed !== false;
  run.evidence = { ...(run.evidence || {}), verification: sanitizeEvidence(result), postconditions_passed: passed };
  run.completed_at = new Date().toISOString();
  if (passed) {
    if (run.phase === "readback_pending") await appendStateEvent(run, "verifying", "readback_started", { recoveryStore, requiredDurable: true });
    if (run.phase === "verifying") await appendStateEvent(run, "verified", "postconditions_verified", { recoveryStore, requiredDurable: true });
    if (run.phase === "verified") await appendStateEvent(run, "recovered", "recovery_completed", { recoveryStore, requiredDurable: true });
  } else {
    if (run.phase === "readback_pending" || run.phase === "verifying") await appendStateEvent(run, "partially_verified", "postconditions_incomplete", { recoveryStore, requiredDurable: true, details: { compensation_required: true } });
    if (run.phase === "partially_verified" || run.phase === "compensation_required") await appendStateEvent(run, "failed_closed", "recovery_failed_closed_after_readback", { recoveryStore, requiredDurable: true });
  }
  await writeRun(run, { recoveryStore });
  return sanitizeEvidence({ ok: passed, contract: "mad4b.recovery-remediation-verification.v1", plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id, status: run.status, phase: run.phase, postconditions: sanitizeEvidence(result), recovered: passed, durability: { durable: true, source: "injected_recovery_store" }, ...noMutationAttestation({ read_only_probe: true }) });
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
  return sanitizeEvidence({ ok: true, contract: "mad4b.recovery-run.v1", ...run, resumable: Boolean(recoveryStore && typeof recoveryStore.getRun === "function"), durability: { durable: Boolean(recoveryStore && typeof recoveryStore.getRun === "function"), mode: recoveryStore ? "injected_store" : "degraded_memory_only_test_state" }, secrets_included: false });
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
  return sanitizeEvidence({ ok: true, contract: "mad4b.recovery-evidence.v1", run_id: runId, evidence: run.evidence || {}, redaction: { applied: true, raw_logs_included: false, secrets_included: false }, durability: { durable: Boolean(recoveryStore && typeof recoveryStore.getRun === "function"), mode: recoveryStore ? "injected_store" : "degraded_memory_only_test_state" }, secrets_included: false });
}

export async function inspectProductionDatabase(input = {}, { env = process.env, repoRoot, hostLocalExecutor = executeHostLocalRoleInspection, recoveryStore } = {}) {
  const request = requireProductionRequest(input, ["expected_sha", "target_key"]);
  const identity = readProductionIdentity({ env, expectedSha: request.expected_sha });
  const inspection = await hostLocalExecutor({ expected_sha: request.expected_sha, target_key: request.target_key }, { env, repoRoot });
  const findings = findingsFromInspection(inspection);
  const trust = getRecoveryTrustModel({ env, expectedSha: request.expected_sha });
  const attestation = readRuntimeAttestation({ env, expectedSha: request.expected_sha });
  const causalGraph = buildCausalFindingGraph(findings);
  const runId = `run:${stableHash({ expected_sha: request.expected_sha, target_key: request.target_key, nonce: randomUUID() }).slice(0, 32)}`;
  const inspectionEvidenceHash = stableHash(sanitizeEvidence(inspection));
  for (const finding of findings) {
    finding.inspection_run_id = runId;
    finding.inspection_evidence_hash = inspectionEvidenceHash;
  }
  const evidence = { identity, trust, attestation, inspection: sanitizeEvidence(inspection), findings: sanitizeEvidence(findings), causal_graph: causalGraph, final_inspection: false, inspection_run_id: runId, inspection_evidence_hash: inspectionEvidenceHash, secrets_included: false };
  const run = { run_id: runId, status: "created", phase: null, plan_id: null, plan_hash: null, step_id: null, expected_sha: request.expected_sha, target_key: request.target_key, target_fingerprint: trust.target_fingerprints.composite, started_at: new Date().toISOString(), findings, events: [], evidence };
  await appendStateEvent(run, "created", "recovery_inspection_created", { recoveryStore, details: { durable: Boolean(recoveryStore) } });
  await appendStateEvent(run, "inspecting", "inspection_started", { recoveryStore });
  await appendStateEvent(run, inspection?.ok === false ? "failed_closed" : "classified", inspection?.ok === false ? "inspection_failed_closed" : "findings_classified", { recoveryStore, details: { finding_count: findings.length } });
  if (recoveryStore && typeof recoveryStore.putFinding === "function") {
    for (const finding of findings) await recoveryStore.putFinding(sanitizeEvidence(finding));
  }
  const durableStore = isDurableRecoveryStore(recoveryStore);
  return sanitizeEvidence({ ok: inspection?.ok !== false, contract: "mad4b.recovery-production-inspection.v1", run_id: runId, status: run.status, phase: run.phase, identity, trust, attestation, causal_graph: causalGraph, finding_count: findings.length, findings, inspection: { ...inspection, findings }, next_actions: findings.length ? ["finding_details", "remediation_plan_create"] : ["recovery_evidence_get"], durability: { store_present: Boolean(recoveryStore), store_contract_valid: durableStore, inspection_durable: durableStore, mutation_grade_durable: durableStore, mode: durableStore ? "injected_durable_store" : recoveryStore ? "injected_store_contract_unverified" : "degraded_memory_only_test_state" }, read_only: true, ...noMutationAttestation({ database_connection_performed: inspection?.database_connection_performed === true, read_only_probe: true }) });
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
    case "recovery_manifest_get": {
      if (Object.keys(assertObject(input)).length > 0) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "recovery_manifest_get accepts no arguments.");
      return sanitizeEvidence({ ok: true, contract: "mad4b.recovery-manifest-read.v1", ...readRecoveryManifest(), read_only_probe: true, ...noMutationAttestation({ read_only_probe: true }) });
    }
    case "recovery_trust_model": {
      const body = requireProductionRequest(input, ["expected_sha", "target_key"]);
      return sanitizeEvidence({ ok: true, ...getRecoveryTrustModel({ env: deps.env || process.env, expectedSha: body.expected_sha }), read_only_probe: true, ...noMutationAttestation({ read_only_probe: true }) });
    }
    case "recovery_incident_create": {
      const result = buildRecoveryIncident(input, { adminPrincipal: deps.adminPrincipal });
      const durable = deps.recoveryStore && typeof deps.recoveryStore.putRecoveryIncident === "function";
      if (durable) await deps.recoveryStore.putRecoveryIncident(sanitizeEvidence(result));
      return sanitizeEvidence({ ...result, persistence: { durable, mode: durable ? "injected_store" : "contract_preview_only" }, read_only_probe: true, ...noMutationAttestation({ read_only_probe: true }) });
    }
    case "privileged_operation_preview":
      return sanitizeEvidence({ ...buildPrivilegedOperationPreview(input, { adminPrincipal: deps.adminPrincipal }), read_only_probe: true, ...noMutationAttestation({ read_only_probe: true }) });
    case "privileged_lease_preview":
      return sanitizeEvidence({ ...buildPrivilegedLeasePreview(input, { adminPrincipal: deps.adminPrincipal }), read_only_probe: true, ...noMutationAttestation({ read_only_probe: true }) });
    case "recovery_exception_preview":
      return sanitizeEvidence({ ...buildRecoveryExceptionPreview(input, { adminPrincipal: deps.adminPrincipal }), read_only_probe: true, ...noMutationAttestation({ read_only_probe: true }) });
    case "disaster_recovery_preview":
      return sanitizeEvidence({ ...buildDisasterRecoveryPreview(input, { adminPrincipal: deps.adminPrincipal }), read_only_probe: true, ...noMutationAttestation({ read_only_probe: true }) });
    case "recovery_reconciliation_preview":
      return sanitizeEvidence({ ...buildReconciliationPreview(input, { adminPrincipal: deps.adminPrincipal }), read_only_probe: true, ...noMutationAttestation({ read_only_probe: true }) });
    case "recovery_cancel_preview":
      return sanitizeEvidence({ ...buildRecoveryCancelPreview(input, { adminPrincipal: deps.adminPrincipal }), read_only_probe: true, ...noMutationAttestation({ read_only_probe: true }) });
    case "recovery_evidence_chain_preview": {
      const body = assertObject(input);
      const allowed = new Set(["previous_hash", "event"]);
      const unexpected = Object.keys(body).filter((field) => !allowed.has(field));
      if (unexpected.length || !body.event || typeof body.event !== "object" || Array.isArray(body.event)) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "Evidence-chain preview accepts only previous_hash and a bounded event object.", { fields: unexpected });
      return sanitizeEvidence({ ok: true, ...appendEvidenceChainEvent({ previous_hash: body.previous_hash, event: body.event }), read_only_probe: true, ...noMutationAttestation({ read_only_probe: true }) });
    }
    case "secret_observation": {
      const body = assertObject(input);
      const allowed = new Set(["configured", "value_hash", "age_seconds"]);
      const unexpected = Object.keys(body).filter((field) => !allowed.has(field));
      if (unexpected.length) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "Secret observation accepts only presence metadata and a precomputed hash.", { fields: unexpected });
      return sanitizeEvidence({ ok: true, ...observeSecretSafely(body), read_only_probe: true, ...noMutationAttestation({ read_only_probe: true }) });
    }
    case "runtime_attestation": {
      const body = requireProductionRequest(input, ["expected_sha", "target_key"]);
      return sanitizeEvidence({ ok: true, ...readRuntimeAttestation({ env: deps.env || process.env, expectedSha: body.expected_sha }), read_only_probe: true, ...noMutationAttestation({ read_only_probe: true }) });
    }
    case "tool_surface_parity": {
      if (Object.keys(assertObject(input)).length > 0) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "tool_surface_parity accepts no arguments.");
      const fixedRegistryReady = typeof deps.systemToolLookup === "function";
      return sanitizeEvidence({ ok: fixedRegistryReady, contract: "mad4b.recovery-tool-surface-parity.v1", source_openapi: "repository_openapi", generated_gpt_schema: "repository_generated_projection", runtime_route_registry: "server_route_registry", fixed_system_tools: fixedRegistryReady ? "available" : "not_injected", client_snapshot_stale: "not_observable_from_server", dynamic_catalog_required: false, backend_ready: fixedRegistryReady, parity_state: fixedRegistryReady ? "bounded_server_contract_ready" : "unknown", read_only_probe: true, ...noMutationAttestation({ read_only_probe: true }) });
    }
    case "recovery_capabilities":
      if (Object.keys(assertObject(input)).length > 0) throw kernelError(400, "RECOVERY_INPUT_FIELD_FORBIDDEN", "recovery_capabilities accepts no arguments.");
      return getRecoveryCapabilities({ env: deps.env || process.env });
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
    case "unsupported_recovery_escalate": return escalateUnsupportedRecovery(input, { ...deps, adminPrincipal: deps.adminPrincipal });
    case "ssh_session_preview": return previewSshSession(input, { ...deps, adminPrincipal: deps.adminPrincipal });
    case "sql_session_preview": return previewSqlSession(input, { ...deps, adminPrincipal: deps.adminPrincipal });
    case "ephemeral_capability_create": return createEphemeralCapability(input, { ...deps, adminPrincipal: deps.adminPrincipal });
    case "remediation_plan_create": return createRemediationPlan(input, deps);
    case "remediation_plan_preview": return previewRemediationPlan(input, deps);
    case "approval_challenge_create": return createApprovalChallenge(input, deps);
    case "remediation_step_execute": return executeRemediationStep(input, { ...deps, adminPrincipal: deps.adminPrincipal });
    case "unsupported_capability_execute": return executeUnsupportedCapability(input, { ...deps, adminPrincipal: deps.adminPrincipal });
    case "recovery_exception_lifecycle": throw kernelError(501, "RECOVERY_EXCEPTION_LIFECYCLE_INTERNAL_ONLY", "Exception lifecycle transitions require a separately injected durable control-plane adapter and are not exposed through the read-only capability call surface.");
    case "remediation_step_verify": return verifyRemediationStep(input, deps);
    case "recovery_run_get": return getRecoveryRun(input, deps);
    case "recovery_evidence_get": return getRecoveryEvidence(input, deps);
    case "finding_details": {
      assertObject(input); assertNoForbiddenKeys(input);
      const findingId = requireId(input.finding_id, FINDING_ID_RE, "finding_id", "RECOVERY_FINDING_ID_INVALID");
      let finding = null;
      if (deps.recoveryStore && typeof deps.recoveryStore.getFinding === "function") finding = await deps.recoveryStore.getFinding(findingId);
      if (!finding) finding = [...RUNS.values()].flatMap((run) => run.findings || []).find((candidate) => candidate.finding_id === findingId);
      if (!finding) throw kernelError(404, "RECOVERY_FINDING_NOT_FOUND", "The requested finding is not available in the durable Recovery state.", { finding_id: findingId });
      return sanitizeEvidence({ ok: true, contract: "mad4b.recovery-finding.v1", finding, durable_read: Boolean(deps.recoveryStore && typeof deps.recoveryStore.getFinding === "function") });
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
  RECOVERY_STATE_PHASES,
  RECOVERY_STATE_TRANSITIONS,
});
