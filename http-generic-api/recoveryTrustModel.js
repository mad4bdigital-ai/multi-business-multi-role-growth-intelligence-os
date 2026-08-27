import { createHash } from "node:crypto";
import fs from "node:fs";
import { validateDeploymentIdentityAttestation } from "./recoveryExecutionBinding.js";

export const RECOVERY_TRUST_CONTRACT = "mad4b.recovery-trust-model.v1";
export const RECOVERY_MANIFEST_PATH = "config/recovery-kernel-manifest.json";
export const RECOVERY_REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
export const RECOVERY_BRANCH = "Production";
export { validateDeploymentIdentityAttestation };

const SHA_RE = /^[0-9a-f]{40}$/iu;
const HASH_RE = /^[0-9a-f]{64}$/iu;
const MANIFEST_PATH = new URL("./config/recovery-kernel-manifest.json", import.meta.url);
const ROLE_ENVIRONMENTS = Object.freeze({
  runtime: Object.freeze({ prefix: "DB", name: "DB_NAME", user: "DB_USER", host: "DB_HOST", password: "DB_PASSWORD" }),
  governance: Object.freeze({ prefix: "GOVERNANCE_DB", name: "GOVERNANCE_DB_NAME", user: "GOVERNANCE_DB_USER", host: "GOVERNANCE_DB_HOST", password: "GOVERNANCE_DB_PASSWORD" }),
  runtime_persistence: Object.freeze({ prefix: "RUNTIME_PERSISTENCE_DB", name: "RUNTIME_PERSISTENCE_DB_NAME", user: "RUNTIME_PERSISTENCE_DB_USER", host: "RUNTIME_PERSISTENCE_DB_HOST", password: "RUNTIME_PERSISTENCE_DB_PASSWORD" }),
});

const CAPABILITY_LEVELS = Object.freeze({ R0: "observe", R1: "diagnose", R2: "simulate", R3: "governed_repair", R4: "privileged_recovery", R5: "disaster_recovery", legacy_R0: "identity_and_readiness", legacy_R1: "inspection", legacy_R2: "planning_and_simulation", legacy_R3: "reversible_repair", legacy_R4: "schema_or_grant_mutation", legacy_R5: "rebuild", legacy_R6: "cutover" });
const SSH_LEVELS = Object.freeze({ S0: "connectivity_only", S1: "read_only_shell", S2: "service_diagnostics", S3: "file_or_config_repair", S4: "process_or_service_mutation", S5: "privileged_root_mutation" });
const SQL_LEVELS = Object.freeze({ Q0: "metadata_only", Q1: "select", Q2: "temporary_session_changes", Q3: "dml", Q4: "grants", Q5: "additive_ddl", Q6: "destructive_ddl" });

const DEPENDENCY_GRAPH = Object.freeze([
  { from: "mcp_catalog", to: "governance_schema", kind: "hard_dependency" },
  { from: "mcp_catalog", to: "governance_authority", kind: "authority_dependency" },
  { from: "admin_gpt", to: "mcp_catalog", kind: "soft_dependency" },
  { from: "admin_gpt", to: "fixed_system_tools", kind: "recovery_dependency" },
  { from: "large_tool_response", to: "response_chunk_persistence", kind: "hard_dependency" },
  { from: "response_chunk_persistence", to: "runtime_persistence_schema", kind: "hard_dependency" },
  { from: "response_chunk_persistence", to: "runtime_persistence_authority", kind: "authority_dependency" },
  { from: "recovery_kernel", to: "fixed_system_tools", kind: "hard_dependency" },
  { from: "recovery_kernel", to: "mcp_catalog", kind: "recovery_dependency", prohibited: true },
  { from: "recovery_kernel", to: "target_database_metadata", kind: "recovery_dependency", prohibited: true },
  { from: "recovery_kernel", to: "recovery_manifest", kind: "hard_dependency" },
  { from: "recovery_kernel", to: "exact_production_sha", kind: "hard_dependency" },
]);

const CAUSAL_GRAPH = Object.freeze([
  { from: "tool_surface_large_response_failure", to: "response_chunk_persistence_unavailable", relation: "caused_by", kind: "runtime" },
  { from: "response_chunk_persistence_unavailable", to: "runtime_persistence_schema_not_ready", relation: "caused_by", kind: "schema" },
  { from: "runtime_persistence_schema_not_ready", to: "runtime_persistence_authority_or_adapter", relation: "caused_by", kind: "authority" },
  { from: "mcp_catalog_unavailable", to: "schema_contract_not_ready", relation: "caused_by", kind: "contract" },
  { from: "schema_contract_not_ready", to: "mcp_catalog_level_missing", relation: "caused_by", kind: "schema" },
  { from: "mcp_catalog_level_missing", to: "governance_catalog_authority", relation: "caused_by", kind: "authority" },
  { from: "session_context_insert_denied", to: "governance_or_session_authority_gap", relation: "caused_by", kind: "privilege" },
  { from: "session_persistence_unavailable", to: "session_context_insert_denied", relation: "caused_by", kind: "runtime" },
  { from: "schema_semantic_drift", to: "schema_contract_not_ready", relation: "caused_by", kind: "schema" },
  { from: "grant_semantic_drift", to: "governance_or_session_authority_gap", relation: "caused_by", kind: "privilege" },
  { from: "migration_ledger_mismatch", to: "schema_contract_not_ready", relation: "caused_by", kind: "ledger" },
  { from: "runtime_behavioral_mismatch", to: "tool_surface_large_response_failure", relation: "caused_by", kind: "behavior" },
  { from: "metadata_lock_present", to: "runtime_persistence_schema_not_ready", relation: "blocked_by", kind: "lock" },
  { from: "long_running_transaction", to: "metadata_lock_present", relation: "caused_by", kind: "transaction" },
  { from: "deployment_runtime_drift", to: "schema_contract_not_ready", relation: "caused_by", kind: "deployment" },
  { from: "filesystem_config_drift", to: "deployment_runtime_drift", relation: "caused_by", kind: "configuration" },
  { from: "service_state_unready", to: "runtime_behavioral_mismatch", relation: "caused_by", kind: "service" },
  { from: "network_state_unready", to: "runtime_behavioral_mismatch", relation: "caused_by", kind: "network" },
  { from: "disk_pressure", to: "response_chunk_persistence_unavailable", relation: "caused_by", kind: "capacity" },
  { from: "credential_readiness_anomaly", to: "governance_or_session_authority_gap", relation: "caused_by", kind: "credential_presence_only" },
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function text(value, max = 256) {
  return String(value ?? "").trim().slice(0, max);
}

function safeEnvironmentKey(env = process.env) {
  const value = text(env.DEPLOYMENT_ENVIRONMENT || env.REMOTE_MCP_ENVIRONMENT || env.NODE_ENV || "", 64).toLowerCase();
  if (["production", "prod", "production_hostinger_autodeploy"].includes(value)) return "production_hostinger_autodeploy";
  if (["staging", "stage", "staging_local_windows_docker"].includes(value)) return "staging_local_windows_docker";
  return "unknown";
}

function readManifest() {
  const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
  const manifest = JSON.parse(raw);
  const manifestHash = stableHash(manifest);
  return { manifest, manifest_hash: manifestHash };
}

function readIdentity(env = process.env) {
  let deployment = null;
  const candidates = [env.DEPLOYMENT_MANIFEST_JSON, env.DEPLOYMENT_COMMIT_JSON].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(String(candidate));
      if (parsed && typeof parsed === "object") { deployment = parsed; break; }
    } catch { /* fail closed below */ }
  }
  return {
    repository: text(deployment?.repository || env.GITHUB_REPOSITORY || env.DEPLOY_REPOSITORY, 160) || null,
    branch: text(deployment?.branch || env.GITHUB_REF_NAME || env.DEPLOY_BRANCH || env.BRANCH_NAME, 64) || null,
    sha: text(deployment?.commit_sha || env.GITHUB_SHA || env.DEPLOY_COMMIT || env.COMMIT_SHA || env.REVISION_SHA, 64).toLowerCase() || null,
  };
}

function presence(env, keys) {
  return keys.some((key) => typeof env[key] === "string" && env[key].length > 0);
}

function roleTargetMaterial(role, env) {
  const config = ROLE_ENVIRONMENTS[role];
  const prefix = config.prefix;
  return {
    role,
    database_identifier: env[config.name] || env[`${prefix}_DATABASE`] || null,
    principal_identifier: env[config.user] || env[`${prefix}_PRINCIPAL`] || null,
    host_identity: env[config.host] || env[`${prefix}_PRINCIPAL_HOST`] || env.HOSTINGER_SITE_ID || env.HOSTNAME || null,
    environment: safeEnvironmentKey(env),
    repository: RECOVERY_REPOSITORY,
    branch: RECOVERY_BRANCH,
  };
}

export function deriveTargetFingerprint({ role = "composite", env = process.env, databaseIdentifier = null, principalIdentifier = null, hostIdentity = null, roleFingerprints = null } = {}) {
  const material = role === "composite"
    ? { role, environment: safeEnvironmentKey(env), repository: RECOVERY_REPOSITORY, branch: RECOVERY_BRANCH, target_key: "production-runtime", role_fingerprints: roleFingerprints || Object.fromEntries(Object.keys(ROLE_ENVIRONMENTS).map((name) => [name, deriveTargetFingerprint({ role: name, env })])) }
    : { ...roleTargetMaterial(role, env), database_identifier: databaseIdentifier ?? roleTargetMaterial(role, env).database_identifier, principal_identifier: principalIdentifier ?? roleTargetMaterial(role, env).principal_identifier, host_identity: hostIdentity ?? roleTargetMaterial(role, env).host_identity };
  return stableHash(material);
}

export function deriveRoleTargetFingerprints({ env = process.env } = {}) {
  const roleFingerprints = Object.fromEntries(Object.keys(ROLE_ENVIRONMENTS).map((role) => [role, deriveTargetFingerprint({ role, env })]));
  return { ...roleFingerprints, composite: deriveTargetFingerprint({ env, roleFingerprints }) };
}

function roleIdentityUniqueness({ env = process.env } = {}) {
  const materials = Object.keys(ROLE_ENVIRONMENTS).map((role) => {
    const material = roleTargetMaterial(role, env);
    return { role, database_identifier_hash: material.database_identifier ? stableHash(material.database_identifier) : null, principal_identifier_hash: material.principal_identifier ? stableHash(material.principal_identifier) : null };
  });
  const duplicates = [];
  for (let index = 0; index < materials.length; index += 1) {
    for (let next = index + 1; next < materials.length; next += 1) {
      if (materials[index].database_identifier_hash && materials[index].database_identifier_hash === materials[next].database_identifier_hash) duplicates.push({ kind: "database_identifier", roles: [materials[index].role, materials[next].role] });
      if (materials[index].principal_identifier_hash && materials[index].principal_identifier_hash === materials[next].principal_identifier_hash) duplicates.push({ kind: "principal_identifier", roles: [materials[index].role, materials[next].role] });
    }
  }
  return { unique: duplicates.length === 0, duplicate_bindings: duplicates, cross_role_identity_exception_required: duplicates.length > 0, secrets_included: false };
}

export function readRecoveryManifest() {
  const { manifest, manifest_hash } = readManifest();
  return {
    ...manifest,
    manifest_hash,
    manifest_path: RECOVERY_MANIFEST_PATH,
    secrets_included: false,
  };
}

export function verifyRecoveryManifest({ expectedSha, identity = null, env = process.env } = {}) {
  const manifest = readRecoveryManifest();
  const resolvedIdentity = identity || readIdentity(env);
  const sha = text(expectedSha, 64).toLowerCase();
  const shaValid = SHA_RE.test(sha);
  const repositoryMatch = resolvedIdentity.repository === manifest.repository && resolvedIdentity.repository === RECOVERY_REPOSITORY;
  const branchMatch = resolvedIdentity.branch === manifest.production_branch && resolvedIdentity.branch === RECOVERY_BRANCH;
  const identitySha = text(resolvedIdentity.sha || resolvedIdentity.commit, 64).toLowerCase();
  const shaMatch = shaValid && identitySha === sha;
  return {
    ok: Boolean(repositoryMatch && branchMatch && shaMatch && (safeEnvironmentKey(env) === "production_hostinger_autodeploy" || !text(env.DEPLOYMENT_ENVIRONMENT || env.REMOTE_MCP_ENVIRONMENT || env.NODE_ENV))),
    contract: RECOVERY_TRUST_CONTRACT,
    manifest_hash: manifest.manifest_hash,
    repository_match: repositoryMatch,
    branch_match: branchMatch,
    sha_match: shaMatch,
    environment_match: safeEnvironmentKey(env) === "production_hostinger_autodeploy" || !text(env.DEPLOYMENT_ENVIRONMENT || env.REMOTE_MCP_ENVIRONMENT || env.NODE_ENV),
    exact_sha_required: true,
    secrets_included: false,
  };
}

function roleCredentialReadiness(env, role) {
  const config = ROLE_ENVIRONMENTS[role];
  const knownPresence = {
    host: presence(env, [config.host, `${config.prefix}_HOST`]),
    name: presence(env, [config.name, `${config.prefix}_DATABASE`]),
    principal: presence(env, [config.user, `${config.prefix}_PRINCIPAL`]),
    password: presence(env, [config.password, `${config.prefix}_PASSWORD`]),
  };
  return {
    source: "server_environment_presence_only",
    configured: Object.values(knownPresence).every(Boolean),
    fields_present: Object.fromEntries(Object.entries(knownPresence).map(([key, value]) => [key, Boolean(value)])),
    raw_values_exposed: false,
    secrets_included: false,
  };
}

export function readRuntimeAttestation({ env = process.env, expectedSha = null, identity = null } = {}) {
  const resolvedIdentity = identity || readIdentity(env);
  const manifest = readRecoveryManifest();
  const manifestBinding = expectedSha ? verifyRecoveryManifest({ expectedSha, identity: resolvedIdentity, env }) : { ok: false, manifest_hash: manifest.manifest_hash, exact_sha_required: true, secrets_included: false };
  const roleCredentials = Object.fromEntries(Object.keys(ROLE_ENVIRONMENTS).map((role) => [role, roleCredentialReadiness(env, role)]));
  const processStart = Number.isFinite(Number(process.uptime?.())) ? new Date(Date.now() - (process.uptime() * 1000)).toISOString() : null;
  const base = {
    contract: "mad4b.recovery-runtime-attestation.v1",
    deployment_identity_contract: "mad4b.recovery-deployment-identity-attestation.v1",
    repository: resolvedIdentity.repository,
    branch: resolvedIdentity.branch,
    repository_sha: resolvedIdentity.sha,
    deployment_sha: resolvedIdentity.sha,
    process_start_time: processStart,
    environment_key: safeEnvironmentKey(env),
    recovery_manifest_hash: manifest.manifest_hash,
    manifest_bound: manifestBinding.ok,
    role_credentials_ready: roleCredentials,
    loaded_contract_version: manifest.contract,
    read_only_probe: true,
    target_fingerprints: deriveRoleTargetFingerprints({ env }),
    role_identity_uniqueness: roleIdentityUniqueness({ env }),
    database_connection_performed: false,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  };
  const immutableHashBasis = { ...base, process_start_time: null };
  return { ...base, attestation_hash: stableHash(immutableHashBasis), attestation_hash_basis: "immutable_deployment_identity", parity: manifestBinding.ok && resolvedIdentity.repository === RECOVERY_REPOSITORY && resolvedIdentity.branch === RECOVERY_BRANCH, manifest_verification: manifestBinding };
}

export function getRecoveryTrustModel({ env = process.env, expectedSha = null, identity = null } = {}) {
  const resolvedIdentity = identity || readIdentity(env);
  const manifest = readRecoveryManifest();
  const attestation = expectedSha ? readRuntimeAttestation({ env, expectedSha, identity: resolvedIdentity }) : null;
  return {
    ok: Boolean(attestation?.parity),
    contract: RECOVERY_TRUST_CONTRACT,
    trust_roots: ["exact_production_sha", "recovery_manifest_hash", "deployment_attestation_hash", "target_fingerprint", "admin_principal_binding"],
    identity: { repository: resolvedIdentity.repository, branch: resolvedIdentity.branch, sha: resolvedIdentity.sha, exact_sha_required: true },
    manifest: { manifest_hash: manifest.manifest_hash, contract: manifest.contract, version: manifest.recovery_manifest_version, secrets_included: false },
    target_fingerprints: deriveRoleTargetFingerprints({ env }),
    role_identity_uniqueness: roleIdentityUniqueness({ env }),
    runtime_attestation: attestation,
    capability_levels: CAPABILITY_LEVELS,
    ssh_levels: SSH_LEVELS,
    sql_levels: SQL_LEVELS,
    dependency_graph: DEPENDENCY_GRAPH,
    causal_graph: CAUSAL_GRAPH,
    database_independent_control_plane: true,
    secrets_included: false,
  };
}

export function buildCausalFindingGraph(findings = []) {
  const nodes = findings.map((finding) => ({ node_id: finding.finding_id || `finding:${stableHash(finding).slice(0, 32)}`, kind: "finding", category: text(finding.category, 128), target_role: text(finding.subject?.target_role, 64) || "unknown", severity: text(finding.severity, 32) || "unknown" }));
  const edges = [];
  for (const finding of findings) {
    const signals = [finding.category, finding.subject?.resource, finding.subject?.target_role, finding.desired_state?.authority_ref].map((value) => text(value, 128).toLowerCase()).filter(Boolean);
    const matches = CAUSAL_GRAPH.filter((edge) => signals.some((signal) => edge.from.includes(signal) || edge.to.includes(signal)));
    for (const match of matches.slice(0, 8)) edges.push({ from: finding.finding_id, to: match.to, relation: match.relation, kind: match.kind, source_signal: signals.find((signal) => match.from.includes(signal) || match.to.includes(signal)) || "registered_graph" });
  }
  const dedupedEdges = [...new Map(edges.map((edge) => [`${edge.from}:${edge.to}:${edge.relation}`, edge])).values()];
  return { contract: "mad4b.recovery-causal-finding-graph.v1", graph_kind: "causal_dependency_dag", nodes, edges: dedupedEdges, root_cause_candidates: [...new Set(dedupedEdges.map((edge) => edge.to))], unknown_drift: findings.some((finding) => finding.repairability === "unknown_fail_closed"), secrets_included: false };
}

export function assertTrustForMutation({ expectedSha, identity = null, env = process.env, targetFingerprint, targetRole = null, adminPrincipal } = {}) {
  const resolvedIdentity = identity || readIdentity(env);
  const manifestVerification = verifyRecoveryManifest({ expectedSha, identity: resolvedIdentity, env });
  if (!manifestVerification.ok) {
    const error = new Error("Exact Production SHA and Recovery Manifest binding are required before mutation.");
    error.status = 412;
    error.code = "RECOVERY_TRUST_ROOT_INVALID";
    error.details = { manifest_verification: manifestVerification, secrets_included: false };
    throw error;
  }
  const targetFingerprints = deriveRoleTargetFingerprints({ env });
  const expectedTarget = targetRole && targetFingerprints[targetRole] ? targetFingerprints[targetRole] : targetFingerprints.composite;
  if (targetFingerprint && targetFingerprint !== expectedTarget) {
    const error = new Error("The target fingerprint changed after planning; the plan is invalidated.");
    error.status = 409;
    error.code = "TARGET_CHANGED";
    error.details = { target_role: targetRole || "composite", target_fingerprint_match: false, secrets_included: false };
    throw error;
  }
  if (!adminPrincipal?.verified) {
    const error = new Error("A verified administrative principal binding is required before mutation.");
    error.status = 403;
    error.code = "RECOVERY_ADMIN_PRINCIPAL_REQUIRED";
    error.details = { principal_binding: "verified_admin_guard", secrets_included: false };
    throw error;
  }
  return { ok: true, manifest_hash: manifestVerification.manifest_hash, target_fingerprint: expectedTarget, principal_binding: "verified_admin_guard", secrets_included: false };
}

export const _testingRecoveryTrustModel = Object.freeze({
  stableHash,
  readIdentity,
  roleCredentialReadiness,
  roleIdentityUniqueness,
  CAPABILITY_LEVELS,
  SSH_LEVELS,
  SQL_LEVELS,
  DEPENDENCY_GRAPH,
  CAUSAL_GRAPH,
  HASH_RE,
});
