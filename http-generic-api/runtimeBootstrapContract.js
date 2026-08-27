import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { splitMigrationSqlStatements } from "./migrationSqlStatements.js";
import { computeRoleSelectionProofHash } from "./roleSelectionProof.js";
import { allowedGrantPrivilegesForRole } from "./databasePrivilegeContracts.js";
import {
  BASELINE_ORDER_CONTRACT,
  validateBaselineBeforeOrdinaryMigration,
  buildRoleBundleBinding,
  createRoleBundleProgress,
  recordRoleBundleProgress,
} from "./recoveryExecutionBinding.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTRACT_PATH = path.join(HERE, "config", "runtime-bootstrap-contract.json");
const SHA_RE = /^[0-9a-f]{40}$/iu;
const SHA256_RE = /^[0-9a-f]{64}$/iu;
const DATABASE_RE = /^[A-Za-z0-9_$-]+$/u;
const IDENTIFIER_RE = /^[A-Za-z0-9_$.-]+$/u;
const ACCOUNT_HOST_RE = /^[A-Za-z0-9_$%.:-]+$/u;
const SAFE_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/u;
const SAFE_GRANT_PRIVILEGES = new Set(["SELECT", "INSERT", "UPDATE", "DELETE"]);
const LEDGER_COLUMNS = [
  "run_id", "migration_file", "migration_checksum_sha256", "applied_at", "applied_by", "runner_version",
  "mode", "statement_count", "preflight_status", "preflight_risk_count", "requirements_json", "results_json",
  "before_schema_objects_json", "after_schema_objects_json", "metadata_json", "secrets_included",
];
const BROAD_WRITE_PRIVILEGES = new Set([
  "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "INDEX", "TRIGGER", "REFERENCES",
  "EXECUTE", "EVENT", "CREATE ROUTINE", "ALTER ROUTINE", "CREATE VIEW", "CREATE TEMPORARY TABLES", "LOCK TABLES",
]);
const BOOTSTRAP_ROLE_KEYS = Object.freeze(["runtime", "governance", "runtime_persistence"]);
const BOOTSTRAP_OBJECT_KINDS = Object.freeze(["tables", "views", "triggers", "routines", "events"]);
const ROLE_SELECTION_FROM_INSPECTION = "inspection_derived_zero_object_roles";

function normalizeRoleSelection(value, { allowInspectionDerived = true } = {}) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || (allowInspectionDerived && raw === ROLE_SELECTION_FROM_INSPECTION)) return null;
  const roles = [...new Set(raw.split(",").map((role) => role.trim()).filter(Boolean))];
  if (!roles.length || roles.some((role) => !BOOTSTRAP_ROLE_KEYS.includes(role))) {
    throw bootstrapError("bootstrap_role_selection_invalid", "Role selection must contain only repository-registered database roles.", { allowed_roles: BOOTSTRAP_ROLE_KEYS });
  }
  return BOOTSTRAP_ROLE_KEYS.filter((role) => roles.includes(role));
}

export function bootstrapError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

export function readRuntimeBootstrapContract(contractPath = DEFAULT_CONTRACT_PATH) {
  try {
    return JSON.parse(fs.readFileSync(contractPath, "utf8"));
  } catch (error) {
    throw bootstrapError("bootstrap_contract_unreadable", "Runtime bootstrap contract is unreadable", {
      contract_path: path.basename(contractPath),
      cause: error?.message || "parse_failed",
    });
  }
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function roleIdentityBindings({ database, governanceDatabase, persistenceDatabase, principal, principalHost, runtimePrincipal, runtimePrincipalHost, governancePrincipal, governancePrincipalHost, persistencePrincipal, persistencePrincipalHost }) {
  return {
    runtime: { database, principal: String(runtimePrincipal || principal || "").trim(), principal_host: String(runtimePrincipalHost || principalHost || "").trim() },
    governance: { database: governanceDatabase, principal: String(governancePrincipal || (governanceDatabase === database ? principal : "")).trim(), principal_host: String(governancePrincipalHost || (governanceDatabase === database ? principalHost : "")).trim() },
    runtime_persistence: { database: persistenceDatabase, principal: String(persistencePrincipal || (persistenceDatabase === database ? principal : "")).trim(), principal_host: String(persistencePrincipalHost || (persistenceDatabase === database ? principalHost : "")).trim() },
  };
}

function assertRoleIdentityBindings(bindings, { strictDistinct = true } = {}) {
  for (const role of BOOTSTRAP_ROLE_KEYS) {
    const binding = bindings[role];
    if (!binding?.database || !binding?.principal || !binding?.principal_host) {
      if (strictDistinct) throw bootstrapError("bootstrap_role_identity_binding_missing", "Every distinct database role requires an explicit principal and principal host binding", { role });
    }
  }
  const seen = new Map();
  for (const [role, binding] of Object.entries(bindings)) {
    if (!binding?.principal) continue;
    const identity = `${binding.principal}@${binding.principal_host}`;
    const otherRole = seen.get(identity);
    if (otherRole && bindings[otherRole]?.database !== binding.database) throw bootstrapError("bootstrap_role_identity_reuse_denied", "Distinct database roles cannot reuse one principal identity", { role, other_role: otherRole });
    seen.set(identity, role);
  }
  return bindings;
}

export function computeTargetBindingFingerprint(target) {
  const bindings = roleIdentityBindings({
    database: target.database,
    governanceDatabase: target.governance_database || target.database,
    persistenceDatabase: target.runtime_persistence_database || target.database,
    principal: target.principal,
    principalHost: target.principal_host,
    runtimePrincipal: target.runtime_principal,
    runtimePrincipalHost: target.runtime_principal_host,
    governancePrincipal: target.governance_principal,
    governancePrincipalHost: target.governance_principal_host,
    persistencePrincipal: target.runtime_persistence_principal,
    persistencePrincipalHost: target.runtime_persistence_principal_host,
  });
  const strictDistinct = new Set(Object.values(bindings).map((binding) => binding.database)).size > 1;
  assertRoleIdentityBindings(bindings, { strictDistinct });
  return sha256Hex(JSON.stringify({ repository: target.repository, branch: target.branch, key: target.key, role_identity_bindings: bindings }));
}

export function normalizeMode(value) {
  const mode = String(value || "plan").trim().toLowerCase();
  if (!["plan", "dry_run", "apply_migration", "apply_grants"].includes(mode)) {
    throw bootstrapError("bootstrap_mode_invalid", "Bootstrap mode must be plan, dry_run, apply_migration, or apply_grants; combined apply is denied", { mode });
  }
  return mode;
}

function isMutationMode(mode) {
  return mode === "apply_migration" || mode === "apply_grants";
}

async function verifyBootstrapExecutionAuthority({ env, mode, target, source, operation, roleSelectionHash = null, grantBindingHash = null, executionTicketVerifier }) {
  if (!isMutationMode(mode)) return null;
  const ticketId = String(env.BOOTSTRAP_EXECUTION_TICKET_ID || "").trim();
  const ticketHash = String(env.BOOTSTRAP_EXECUTION_TICKET_HASH || "").trim().toLowerCase();
  if (!ticketId || !ticketHash) {
    throw bootstrapError("bootstrap_execution_ticket_required", "Every database mutation requires a server-issued execution-ticket reference.", { required_fields: ["BOOTSTRAP_EXECUTION_TICKET_ID", "BOOTSTRAP_EXECUTION_TICKET_HASH"], database_connection_performed: false, database_mutation_performed: false });
  }
  if (!executionTicketVerifier || typeof executionTicketVerifier.verifyForBootstrap !== "function") {
    throw bootstrapError("bootstrap_execution_ticket_authority_unavailable", "No injected governed execution-ticket authority is configured; mutation is unavailable and no database connection was opened.", { database_connection_performed: false, database_mutation_performed: false });
  }
  const expected = {
    ticket_id: ticketId,
    ticket_hash: ticketHash,
    production_sha: source.sha,
    target_key: target.key,
    target_fingerprint: target.target_fingerprint,
    operation,
    role_selection_hash: roleSelectionHash,
    grant_binding_hash: grantBindingHash,
  };
  let verified;
  try {
    verified = await executionTicketVerifier.verifyForBootstrap({ ticket_id: ticketId, ticket_hash: ticketHash, expected });
  } catch (error) {
    throw bootstrapError("bootstrap_execution_ticket_verification_failed", "The injected execution-ticket authority rejected the mutation binding.", { authority_error: String(error?.code || "verification_failed").slice(0, 120), database_connection_performed: false, database_mutation_performed: false });
  }
  if (verified !== true && verified?.valid !== true) {
    throw bootstrapError("bootstrap_execution_ticket_verification_failed", "The injected execution-ticket authority did not confirm the mutation binding.", { database_connection_performed: false, database_mutation_performed: false });
  }
  return { ticket_id: ticketId, ticket_hash: ticketHash, verified: true, secrets_included: false };
}

function isFullInspectionDryRun(env, mode) {
  const operation = String(env.HOST_BREAKGLASS_OPERATION || "").trim();
  return mode === "dry_run"
    && ["database.inspect", "database.rebuild_empty"].includes(operation)
    && !String(env.BOOTSTRAP_MIGRATION || "").trim();
}

function isRoleSelectiveRebuild(env, mode) {
  return mode === "apply_migration"
    && String(env.HOST_BREAKGLASS_OPERATION || "").trim() === "database.rebuild_empty"
    && !String(env.BOOTSTRAP_MIGRATION || "").trim();
}

function migrationCatalogEvidence(contract) {
  return Object.entries(contract.migrations || {}).map(([file, spec]) => ({
    file,
    sha256: String(spec?.sha256 || "").toLowerCase(),
    statement_count: Number(spec?.statement_count || 0),
    allowed_modes: Array.isArray(spec?.allowed_modes) ? [...spec.allowed_modes] : [],
    role: spec?.role || null,
  }));
}

function mutationEvidenceTemplate(migration, statementCount, grantsTotal = 0) {
  return {
    mutation_attempted: false,
    mutation_state: "none",
    migration: {
      attempted: false,
      state: "none",
      file: migration,
      statement_count: Number(statementCount || 0),
      statements_completed: 0,
    },
    grants: {
      attempted: false,
      state: "none",
      tables_total: Number(grantsTotal || 0),
      tables_completed: [],
      failed_table: null,
    },
    baseline: {
      attempted: false,
      state: "none",
      operations_completed: [],
      failed_operation: null,
      role_bundle_progress: {},
      reconciliation_required: false,
    },
    ddl_privilege_preflight: [],
    secrets_included: false,
  };
}

function cloneMutationEvidence(evidence) {
  return JSON.parse(JSON.stringify(evidence));
}

function declaredBehavioralProbeEvidence(contract) {
  return (Array.isArray(contract?.baseline_bundle?.behavioral_probes) ? contract.baseline_bundle.behavioral_probes : []).map((probe) => ({
    ...probe,
    execution_status: "declared_not_executed_in_bootstrap_contract",
    probe_authority_required: true,
    provider_accessed: false,
    runtime_mutation_performed: false,
    secrets_included: false,
  }));
}

function markMutationAttempt(evidence, kind) {
  evidence.mutation_attempted = true;
  evidence.mutation_state = "partial_possible";
  evidence[kind].attempted = true;
  evidence[kind].state = "partial_possible";
}

function markMutationComplete(evidence, kind) {
  evidence[kind].state = "complete";
  const sectionsComplete = ["baseline", "migration", "grants"].every((section) => evidence[section].state === "complete" || !evidence[section].attempted);
  evidence.mutation_state = sectionsComplete ? "complete" : "partial_possible";
}

function withMutationEvidence(error, evidence) {
  error.details = {
    ...(error.details && typeof error.details === "object" ? error.details : {}),
    mutation_evidence: cloneMutationEvidence(evidence),
  };
  return error;
}

export function parseJsonArray(value, label) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw bootstrapError(`${label}_missing`, `${label} is required`);
  }
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch (error) {
    throw bootstrapError(`${label}_invalid_json`, `${label} must be valid JSON`, { cause: error?.message || "parse_failed" });
  }
  if (!Array.isArray(parsed)) throw bootstrapError(`${label}_invalid`, `${label} must be a JSON array`);
  return parsed;
}

function parseJsonObject(value, label) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw bootstrapError(`${label}_missing`, `${label} is required`);
  }
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch (error) {
    throw bootstrapError(`${label}_invalid_json`, `${label} must be valid JSON`, { cause: error?.message || "parse_failed" });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw bootstrapError(`${label}_invalid`, `${label} must be a JSON object`);
  return parsed;
}

function validateBaselineOrderProofFromEnvironment(env, { expectedSha, targetKey } = {}) {
  const proof = parseJsonObject(env.BOOTSTRAP_BASELINE_ORDER_PROOF, "bootstrap_baseline_order_proof");
  const validation = validateBaselineBeforeOrdinaryMigration({ proof, expectedSha, targetKey });
  if (!validation.ok) {
    throw bootstrapError("bootstrap_baseline_order_proof_invalid", "Ordinary migration apply requires a valid completed baseline-order proof; no database connection was opened.", { problems: validation.problems, required_predecessors: validation.required_predecessors, database_connection_performed: false, database_mutation_performed: false });
  }
  return validation;
}

function requireString(value, code, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw bootstrapError(code, `${field} is required`, { field });
  return normalized;
}

function requireSha(value, field) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA_RE.test(normalized)) throw bootstrapError("bootstrap_sha_invalid", `${field} must be a full 40-character SHA`, { field });
  return normalized;
}

function requireSha256(value, field) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA256_RE.test(normalized)) throw bootstrapError("bootstrap_sha256_invalid", `${field} must be a 64-character SHA-256`, { field });
  return normalized;
}

function assertIdentifier(value, field) {
  const normalized = requireString(value, "bootstrap_identifier_missing", field);
  if (!IDENTIFIER_RE.test(normalized)) throw bootstrapError("bootstrap_identifier_invalid", `${field} contains unsafe characters`, { field });
  return normalized;
}

function assertDatabase(value, field = "database") {
  const normalized = requireString(value, "bootstrap_database_missing", field);
  if (!DATABASE_RE.test(normalized)) throw bootstrapError("bootstrap_database_invalid", `${field} contains unsafe characters`, { field });
  return normalized;
}

function assertAccountHost(value, field) {
  const normalized = requireString(value, "bootstrap_account_host_missing", field);
  if (!ACCOUNT_HOST_RE.test(normalized)) throw bootstrapError("bootstrap_account_host_invalid", `${field} contains unsafe account-host characters`, { field });
  return normalized;
}

const RUNTIME_ENV_TARGET_SOURCE = "runtime_env";
const REPOSITORY_TARGET_SOURCE = "repository_allowlist";
const HOST_LOCAL_ROLE_OPERATIONS = new Set(["database.inspect", "database.repair", "database.rebuild_empty"]);

function normalizeTargetSource(value) {
  const source = String(value || REPOSITORY_TARGET_SOURCE).trim().toLowerCase();
  if (![REPOSITORY_TARGET_SOURCE, RUNTIME_ENV_TARGET_SOURCE, "host_local_role_env", "staging_local_role_env"].includes(source)) {
    throw bootstrapError("bootstrap_target_source_invalid", "Bootstrap target source must be repository_allowlist, runtime_env, or an explicitly authorized environment-local role source", { source });
  }
  return source;
}

function usesLocalRoleIdentity(value) {
  return ["host_local_role_env", "staging_local_role_env"].includes(String(value || "").trim().toLowerCase());
}

function assertHostLocalRoleAuthorization(env, mode) {
  if (String(env.HOST_BREAKGLASS_HOST_LOCAL_ROLE_CREDENTIALS || "") !== "true") {
    throw bootstrapError("bootstrap_host_local_role_authorization_missing", "Host-local role credentials require an explicit Host Breakglass authorization");
  }
  if (String(env.GITHUB_ACTIONS || "").trim().toLowerCase() === "true") {
    throw bootstrapError("bootstrap_host_local_role_transport_denied", "Environment-local role credentials cannot be consumed inside GitHub Actions");
  }
  const source = String(env.BOOTSTRAP_TARGET_SOURCE || "").trim().toLowerCase();
  const expected = source === "staging_local_role_env" ? "staging_local_windows_docker" : "production_hostinger_autodeploy";
  const selected = String(env.HOST_BREAKGLASS_ENVIRONMENT_KEY || expected).trim();
  if (selected !== expected) {
    throw bootstrapError("bootstrap_role_environment_mismatch", "Environment-local role credentials cannot cross Staging and Production", { environment_key: selected });
  }
  const targetKey = String(env.BOOTSTRAP_TARGET_KEY || "").trim();
  if (targetKey && !targetKey.startsWith(source === "staging_local_role_env" ? "staging-" : "production-")) {
    throw bootstrapError("bootstrap_role_target_environment_mismatch", "Role-bound target key belongs to a different environment", { environment_key: expected });
  }
  if (!["dry_run", "apply_migration", "apply_grants"].includes(mode)) {
    throw bootstrapError("bootstrap_host_local_role_mode_denied", "Host-local role credentials never authorize shell or SQL capsules", { mode });
  }
  const operation = String(env.HOST_BREAKGLASS_OPERATION || "").trim();
  if (mode === "apply_grants" && operation !== "database.repair") {
    throw bootstrapError("bootstrap_host_local_grant_operation_denied", "Host-local grants require the separately confirmed database.repair access runbook", { operation });
  }
  if (operation === "database.inspect" && mode !== "dry_run") {
    throw bootstrapError("bootstrap_host_local_inspection_mode_denied", "Host-local database inspection is restricted to dry_run", { operation, mode });
  }
  if (!HOST_LOCAL_ROLE_OPERATIONS.has(operation)) {
    throw bootstrapError("bootstrap_host_local_role_operation_denied", "Host-local role credentials require a bounded database inspection, repair, or empty-rebuild runbook", { operation });
  }
  return operation;
}

function normalizeRuntimeEnvironmentInputs(env = {}) {
  const normalized = { ...env };
  const source = String(normalized.BOOTSTRAP_TARGET_SOURCE || REPOSITORY_TARGET_SOURCE).trim().toLowerCase();
  const mode = String(normalized.BOOTSTRAP_MODE || "plan").trim().toLowerCase();
  if (usesLocalRoleIdentity(source)) {
    assertHostLocalRoleAuthorization(normalized, mode);
    normalized.MYSQL_BOOTSTRAP_HOST = String(normalized.DB_HOST || "").trim();
    normalized.MYSQL_BOOTSTRAP_PORT = String(normalized.DB_PORT || "3306").trim();
    normalized.MYSQL_BOOTSTRAP_USER = String(normalized.DB_USER || "").trim();
    normalized.MYSQL_BOOTSTRAP_PASSWORD = String(normalized.DB_PASSWORD || "");
    normalized.MYSQL_BOOTSTRAP_DATABASE = String(normalized.DB_NAME || "").trim();
    normalized.BOOTSTRAP_HOST_LOCAL_ROLE_IDENTITY = "true";
  } else if (source === RUNTIME_ENV_TARGET_SOURCE && mode === "dry_run") {
    if (!String(normalized.MYSQL_BOOTSTRAP_HOST || "").trim() && String(normalized.DB_HOST || "").trim()) {
      normalized.MYSQL_BOOTSTRAP_HOST = String(normalized.DB_HOST).trim();
    }
    if (!String(normalized.MYSQL_BOOTSTRAP_DATABASE || "").trim() && String(normalized.DB_NAME || "").trim()) {
      normalized.MYSQL_BOOTSTRAP_DATABASE = String(normalized.DB_NAME).trim();
    }
    if (!String(normalized.MYSQL_BOOTSTRAP_PORT || "").trim() && String(normalized.DB_PORT || "").trim()) {
      normalized.MYSQL_BOOTSTRAP_PORT = String(normalized.DB_PORT).trim();
    }
    if (!String(normalized.MYSQL_BOOTSTRAP_USER || "").trim() && String(normalized.DB_USER || "").trim()) {
      normalized.MYSQL_BOOTSTRAP_USER = String(normalized.DB_USER).trim();
      normalized.MYSQL_BOOTSTRAP_PASSWORD = String(normalized.DB_PASSWORD || "");
      normalized.BOOTSTRAP_RUNTIME_READ_ONLY_IDENTITY = "true";
    }
  }
  return normalized;
}

function buildRuntimeEnvironmentTarget(env, contract, mode, source = RUNTIME_ENV_TARGET_SOURCE) {
  if (usesLocalRoleIdentity(source)) {
    assertHostLocalRoleAuthorization(env, mode);
  } else if (mode !== "dry_run") {
    throw bootstrapError("bootstrap_runtime_target_source_mode_denied", "runtime_env target discovery is restricted to dry_run", { mode });
  }
  const repository = contract.source_binding.required_repository || contract.source_binding.repository;
  const branch = contract.target_binding.required_branch || contract.source_binding.branch;
  const key = assertIdentifier(env.BOOTSTRAP_TARGET_KEY || contract.target_binding.default_target_key || "production-runtime", "BOOTSTRAP_TARGET_KEY");
  const database = assertDatabase(env.DB_NAME, "DB_NAME");
  const governanceDatabase = String(env.GOVERNANCE_DB_NAME || "").trim()
    ? assertDatabase(env.GOVERNANCE_DB_NAME, "GOVERNANCE_DB_NAME")
    : database;
  const persistenceDatabase = String(env.RUNTIME_PERSISTENCE_DB_NAME || "").trim()
    ? assertDatabase(env.RUNTIME_PERSISTENCE_DB_NAME, "RUNTIME_PERSISTENCE_DB_NAME")
    : database;
  const principal = assertIdentifier(env.DB_USER, "DB_USER");
  // Hostinger's standard MySQL host is localhost. A deployment may override this
  // for a remote grant principal, but it must be explicit rather than inferred from DB_HOST.
  const principalHost = assertAccountHost(env.DB_PRINCIPAL_HOST || "localhost", "DB_PRINCIPAL_HOST");
  const bootstrapDatabase = String(env.MYSQL_BOOTSTRAP_DATABASE || "").trim();
  if (bootstrapDatabase && bootstrapDatabase !== database) {
    throw bootstrapError("bootstrap_connection_database_mismatch", "MYSQL_BOOTSTRAP_DATABASE must match DB_NAME for runtime_env discovery", { source: RUNTIME_ENV_TARGET_SOURCE });
  }
  const environment = String(contract.target_binding.required_environment || "production").trim().toLowerCase();
  const databaseSha = sha256Hex(database);
  const governanceDatabaseSha = sha256Hex(governanceDatabase);
  const roleBindings = roleIdentityBindings({ database, governanceDatabase, persistenceDatabase, principal, principalHost, runtimePrincipal: env.DB_USER, runtimePrincipalHost: principalHost, governancePrincipal: env.GOVERNANCE_DB_USER, governancePrincipalHost: env.GOVERNANCE_DB_PRINCIPAL_HOST || principalHost, persistencePrincipal: env.RUNTIME_PERSISTENCE_DB_USER, persistencePrincipalHost: env.RUNTIME_PERSISTENCE_DB_PRINCIPAL_HOST || principalHost });
  assertRoleIdentityBindings(roleBindings, { strictDistinct: new Set(Object.values(roleBindings).map((binding) => binding.database)).size > 1 });
  const targetFingerprint = sha256Hex(JSON.stringify({ repository, branch, key, role_identity_bindings: roleBindings }));
  return {
    key,
    database,
    governance_database: governanceDatabase === database ? null : governanceDatabase,
    runtime_persistence_database: persistenceDatabase === database ? null : persistenceDatabase,
    repository,
    branch,
    environment,
    principal,
    principal_host: principalHost,
    database_sha256: databaseSha,
    governance_database_sha256: governanceDatabase === database ? null : governanceDatabaseSha,
    runtime_persistence_database_sha256: persistenceDatabase === database ? null : sha256Hex(persistenceDatabase),
    target_fingerprint: targetFingerprint,
    role_identity_bindings: roleBindings,
    runtime_principal: roleBindings.runtime.principal,
    governance_principal: roleBindings.governance.principal,
    runtime_persistence_principal: roleBindings.runtime_persistence.principal,
    target_source: source,
    target_source_runtime_env: source === RUNTIME_ENV_TARGET_SOURCE,
    target_source_host_local_role_env: source === "host_local_role_env",
    target_source_staging_local_role_env: source === "staging_local_role_env",
  };
}

function describeTargetBinding(target, source) {
  return {
    source,
    target_key: target.key,
    database_configured: Boolean(target.database),
    governance_database_configured: Boolean(target.governance_database || target.database),
    runtime_persistence_database_configured: Boolean(target.runtime_persistence_database || target.database),
    principal_configured: Boolean(target.principal),
    principal_host_configured: Boolean(target.principal_host),
    database_sha256: target.database_sha256 || sha256Hex(target.database),
    governance_database_sha256: target.governance_database_sha256 || sha256Hex(target.governance_database || target.database),
    runtime_persistence_database_sha256: target.runtime_persistence_database_sha256 || sha256Hex(target.runtime_persistence_database || target.database),
    target_fingerprint: target.target_fingerprint || computeTargetBindingFingerprint(target),
    role_identity_bindings: Object.fromEntries(Object.entries(roleIdentityBindings({ database: target.database, governanceDatabase: target.governance_database || target.database, persistenceDatabase: target.runtime_persistence_database || target.database, principal: target.principal, principalHost: target.principal_host, runtimePrincipal: target.runtime_principal, runtimePrincipalHost: target.runtime_principal_host, governancePrincipal: target.governance_principal, governancePrincipalHost: target.governance_principal_host, persistencePrincipal: target.runtime_persistence_principal, persistencePrincipalHost: target.runtime_persistence_principal_host })).map(([role, binding]) => [role, { database_sha256: sha256Hex(binding.database), principal_configured: Boolean(binding.principal), principal_host_configured: Boolean(binding.principal_host) }])),
    raw_values_exposed: false,
    secrets_included: false,
  };
}

function normalizeEntry(entry) {
  if (typeof entry === "string") return { file: entry };
  if (!entry || typeof entry !== "object") throw bootstrapError("bootstrap_target_entry_invalid", "Bootstrap target entry must be an object or file string");
  return { ...entry, file: String(entry.file || "").trim() };
}

export function parseTargetAllowlist(env, contract) {
  const raw = env.RUNTIME_BOOTSTRAP_TARGETS_JSON;
  const targets = parseJsonArray(raw, "RUNTIME_BOOTSTRAP_TARGETS_JSON");
  const requiredRepository = contract.target_binding.required_repository;
  const requiredBranch = contract.target_binding.required_branch;
  const requiredEnvironment = String(contract.target_binding.required_environment || "production").toLowerCase();
  return targets.map((target) => {
    const key = assertIdentifier(target?.key, "target.key");
    const database = assertDatabase(target?.database, "target.database");
    const repository = requireString(target?.repository, "bootstrap_target_repository_missing", "target.repository");
    const branch = requireString(target?.branch, "bootstrap_target_branch_missing", "target.branch");
    const environment = requireString(target?.environment, "bootstrap_target_environment_missing", "target.environment").toLowerCase();
    if (repository !== requiredRepository || branch !== requiredBranch || environment !== requiredEnvironment) {
      throw bootstrapError("bootstrap_target_scope_denied", "Target is outside the bootstrap environment contract", { key, environment, branch, required_environment: requiredEnvironment });
    }
    const databaseSha = requireSha256(target?.database_sha256, "target.database_sha256");
    if (databaseSha !== sha256Hex(database)) {
      throw bootstrapError("bootstrap_target_database_fingerprint_mismatch", "Target database SHA does not match its database identifier", { key });
    }
    const governanceDatabase = target.governance_database === undefined || String(target.governance_database).trim() === ""
      ? database
      : assertDatabase(target.governance_database, "target.governance_database");
    if (target.governance_database !== undefined && String(target.governance_database).trim() !== "") {
      const governanceSha = requireSha256(target.governance_database_sha256, "target.governance_database_sha256");
      if (governanceSha !== sha256Hex(governanceDatabase)) throw bootstrapError("bootstrap_governance_database_fingerprint_mismatch", "Governance database SHA does not match its database identifier", { key });
    }
    const persistenceDatabase = target.runtime_persistence_database === undefined || String(target.runtime_persistence_database).trim() === ""
      ? database
      : assertDatabase(target.runtime_persistence_database, "target.runtime_persistence_database");
    if (target.runtime_persistence_database !== undefined && String(target.runtime_persistence_database).trim() !== "") {
      const persistenceSha = requireSha256(target.runtime_persistence_database_sha256, "target.runtime_persistence_database_sha256");
      if (persistenceSha !== sha256Hex(persistenceDatabase)) throw bootstrapError("bootstrap_persistence_database_fingerprint_mismatch", "Runtime persistence database SHA does not match its database identifier", { key });
    }
    const principal = assertIdentifier(target?.principal, "target.principal");
    const principalHost = assertAccountHost(target?.principal_host, "target.principal_host");
    const fingerprint = requireSha256(target?.target_fingerprint, "target.target_fingerprint");
    const expectedFingerprint = computeTargetBindingFingerprint({ ...target, repository, branch, key, database, governance_database: target.governance_database ? governanceDatabase : null, runtime_persistence_database: target.runtime_persistence_database ? persistenceDatabase : null, principal, principal_host: principalHost });
    if (fingerprint !== expectedFingerprint) {
      throw bootstrapError("bootstrap_target_fingerprint_mismatch", "Target fingerprint does not match repository, branch, key, databases, and grant principal", { key });
    }
    const roleBindings = roleIdentityBindings({ database, governanceDatabase, persistenceDatabase, principal, principalHost, runtimePrincipal: target.runtime_principal, runtimePrincipalHost: target.runtime_principal_host, governancePrincipal: target.governance_principal, governancePrincipalHost: target.governance_principal_host, persistencePrincipal: target.runtime_persistence_principal, persistencePrincipalHost: target.runtime_persistence_principal_host });
    assertRoleIdentityBindings(roleBindings, { strictDistinct: new Set(Object.values(roleBindings).map((binding) => binding.database)).size > 1 });
    return { ...target, key, database, governance_database: target.governance_database ? governanceDatabase : null, runtime_persistence_database: target.runtime_persistence_database ? persistenceDatabase : null, principal, principal_host: principalHost, role_identity_bindings: roleBindings, repository, branch, environment };
  });
}

export function resolveBootstrapTarget(env, contract) {
  const mode = normalizeMode(env.BOOTSTRAP_MODE || "plan");
  const source = normalizeTargetSource(env.BOOTSTRAP_TARGET_SOURCE);
  if (source === RUNTIME_ENV_TARGET_SOURCE || usesLocalRoleIdentity(source)) {
    return buildRuntimeEnvironmentTarget(env, contract, mode, source);
  }
  const key = requireString(env.BOOTSTRAP_TARGET_KEY, "bootstrap_target_key_missing", "BOOTSTRAP_TARGET_KEY");
  const targets = parseTargetAllowlist(env, contract);
  const target = targets.find((candidate) => candidate.key === key);
  if (!target) throw bootstrapError("bootstrap_target_not_allowlisted", "BOOTSTRAP_TARGET_KEY is not present in the repository-owned target allowlist", { key });
  const requestedDatabase = String(env.BOOTSTRAP_TARGET_DATABASE || "").trim();
  if (requestedDatabase && target.database !== requestedDatabase) {
    throw bootstrapError("bootstrap_target_database_mismatch", "BOOTSTRAP_TARGET_DATABASE does not match the allowlisted target", { key });
  }
  const bootstrapDatabase = String(env.MYSQL_BOOTSTRAP_DATABASE || "").trim();
  if (bootstrapDatabase && bootstrapDatabase !== target.database) {
    throw bootstrapError("bootstrap_connection_database_mismatch", "MYSQL_BOOTSTRAP_DATABASE does not match the allowlisted target", { key });
  }
  if (!target.governance_database && String(env.BOOTSTRAP_GOVERNANCE_DATABASE || "").trim()) {
    throw bootstrapError("bootstrap_governance_database_not_allowlisted", "A separate governance database must be explicitly allowlisted in the target entry", { key });
  }
  const governanceDatabase = String(target.governance_database || target.database).trim();
  if (target.governance_database && governanceDatabase !== String(env.BOOTSTRAP_GOVERNANCE_DATABASE || target.governance_database).trim()) {
    throw bootstrapError("bootstrap_governance_database_mismatch", "BOOTSTRAP_GOVERNANCE_DATABASE does not match the allowlisted target", { key });
  }
  const configuredPersistence = String(env.RUNTIME_PERSISTENCE_DB_NAME || "").trim();
  if (configuredPersistence && configuredPersistence !== target.database && !target.runtime_persistence_database) {
    throw bootstrapError("bootstrap_persistence_database_not_allowlisted", "A separate runtime persistence database must be explicitly allowlisted in the target entry", { key });
  }
  const persistenceDatabase = String(target.runtime_persistence_database || target.database).trim();
  if (configuredPersistence && configuredPersistence !== persistenceDatabase) {
    throw bootstrapError("bootstrap_persistence_database_mismatch", "Runtime persistence database does not match the allowlisted target", { key });
  }
  return { ...target, governance_database: governanceDatabase, runtime_persistence_database: persistenceDatabase, target_source: REPOSITORY_TARGET_SOURCE, target_source_runtime_env: false };
}

export function validateSourceBinding(env, contract, mode) {
  const binding = contract.source_binding;
  const repository = String(env.BOOTSTRAP_EXPECTED_REPOSITORY || binding.repository).trim();
  const branch = String(env.BOOTSTRAP_EXPECTED_BRANCH || binding.branch).trim();
  if (repository !== binding.repository) throw bootstrapError("bootstrap_repository_binding_mismatch", "Bootstrap repository binding is not canonical", { repository });
  if (branch !== binding.branch) throw bootstrapError("bootstrap_branch_binding_mismatch", "Bootstrap branch binding is not canonical", { branch });
  const sha = mode === "plan" && !env.BOOTSTRAP_EXPECTED_SHA ? null : requireSha(env.BOOTSTRAP_EXPECTED_SHA, "BOOTSTRAP_EXPECTED_SHA");
  return { repository, branch, sha, exact_sha_required: mode !== "plan" };
}

export function validateLocalDeploymentEvidence(repoRoot, source, contract) {
  if (!source?.sha) return { available: false, checked: false };
  const candidates = Array.isArray(contract.source_binding.deployment_manifest_candidates)
    ? contract.source_binding.deployment_manifest_candidates
    : [];
  for (const relative of candidates) {
    const absolute = path.resolve(repoRoot, relative);
    if (!fs.existsSync(absolute)) continue;
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(absolute, "utf8")); } catch {
      throw bootstrapError("bootstrap_deployment_manifest_invalid", "Local deployment manifest is unreadable");
    }
    const observedSha = String(manifest.commit_sha || manifest.commit || manifest.deployed_commit_sha || "").trim().toLowerCase();
    const observedBranch = String(manifest.branch || "").trim();
    if (observedSha !== source.sha || observedBranch !== source.branch) {
      throw bootstrapError("bootstrap_deployment_manifest_mismatch", "Local deployment manifest does not match exact bootstrap source binding", { source: path.basename(absolute) });
    }
    return { available: true, checked: true, source: path.basename(absolute) };
  }
  return { available: false, checked: false };
}

export function validateBootstrapCredentials(env, { requirePassword = true, target = null } = {}) {
  const required = ["MYSQL_BOOTSTRAP_HOST", "MYSQL_BOOTSTRAP_USER"];
  if (requirePassword) required.push("MYSQL_BOOTSTRAP_PASSWORD");
  const missing = required.filter((key) => !String(env[key] ?? "").trim());
  if (missing.length) throw bootstrapError("bootstrap_credentials_missing", "Dedicated MYSQL_BOOTSTRAP credentials are incomplete", { missing });
  const bootstrapUser = String(env.MYSQL_BOOTSTRAP_USER).trim();
  const runtimeUser = String(env.DB_USER || "").trim();
  const runtimePassword = String(env.DB_PASSWORD || "");
  const runtimeReadOnlyIdentity = env.BOOTSTRAP_RUNTIME_READ_ONLY_IDENTITY === "true"
    && String(env.BOOTSTRAP_TARGET_SOURCE || "").trim().toLowerCase() === RUNTIME_ENV_TARGET_SOURCE
    && String(env.BOOTSTRAP_MODE || "").trim().toLowerCase() === "dry_run";
  const boundIdentity = env.BOOTSTRAP_HOST_LOCAL_ROLE_IDENTITY === "true"
    && usesLocalRoleIdentity(env.BOOTSTRAP_TARGET_SOURCE);
  if (boundIdentity) assertHostLocalRoleAuthorization(env, normalizeMode(env.BOOTSTRAP_MODE || "plan"));
  const authorizedRuntimeIdentity = runtimeReadOnlyIdentity || boundIdentity;
  if (runtimeUser && bootstrapUser === runtimeUser && !authorizedRuntimeIdentity) {
    throw bootstrapError("bootstrap_credential_reuse_denied", "MYSQL_BOOTSTRAP_USER must be separate from DB_USER");
  }
  if (target?.principal && bootstrapUser === String(target.principal).trim() && !authorizedRuntimeIdentity) {
    throw bootstrapError("bootstrap_principal_collision_denied", "MYSQL_BOOTSTRAP_USER must be separate from the target runtime principal");
  }
  if (runtimePassword && String(env.MYSQL_BOOTSTRAP_PASSWORD) === runtimePassword && !authorizedRuntimeIdentity) {
    throw bootstrapError("bootstrap_credential_reuse_denied", "MYSQL_BOOTSTRAP_PASSWORD must be separate from DB_PASSWORD");
  }
  const port = Number(env.MYSQL_BOOTSTRAP_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw bootstrapError("bootstrap_port_invalid", "MYSQL_BOOTSTRAP_PORT is invalid");
  return { host_configured: true, user_configured: true, password_configured: requirePassword, port, separate_from_runtime: !authorizedRuntimeIdentity, credential_source: boundIdentity ? "host_local_role_scoped" : runtimeReadOnlyIdentity ? "runtime_read_only" : "dedicated_bootstrap", separate_from_target_principal: target?.principal ? bootstrapUser !== String(target.principal).trim() : null };
}

export function resolveRoleBootstrapCredentials(env, role, target, { requirePassword = true } = {}) {
  const roleBindings = {
    runtime: { prefix: "DB", database: target.database },
    governance: { prefix: "GOVERNANCE_DB", database: target.governance_database || target.database },
    runtime_persistence: { prefix: "RUNTIME_PERSISTENCE_DB", database: target.runtime_persistence_database || target.database },
  };
  const binding = roleBindings[role];
  if (!binding) throw bootstrapError("bootstrap_role_invalid", "Unknown database role", { role });
  const localIdentity = usesLocalRoleIdentity(env.BOOTSTRAP_TARGET_SOURCE);
  if (!localIdentity) {
    const primaryDatabase = target.database;
    const roleSpecific = binding.database !== primaryDatabase;
    const prefix = role === "runtime" ? "MYSQL_BOOTSTRAP" : role === "governance" ? "MYSQL_BOOTSTRAP_GOVERNANCE" : "MYSQL_BOOTSTRAP_RUNTIME_PERSISTENCE";
    const host = String(env[`${prefix}_HOST`] || (roleSpecific ? "" : env.MYSQL_BOOTSTRAP_HOST) || "").trim();
    const port = Number(env[`${prefix}_PORT`] || (roleSpecific ? "" : env.MYSQL_BOOTSTRAP_PORT) || 3306);
    const user = String(env[`${prefix}_USER`] || (roleSpecific ? "" : env.MYSQL_BOOTSTRAP_USER) || "").trim();
    const password = String(env[`${prefix}_PASSWORD`] ?? (roleSpecific ? "" : env.MYSQL_BOOTSTRAP_PASSWORD) ?? "");
    const configuredDatabase = String(env[`${prefix}_DATABASE`] || (roleSpecific ? "" : env.MYSQL_BOOTSTRAP_DATABASE) || "").trim();
    if (roleSpecific && (!host || !user || !password.trim() || configuredDatabase !== binding.database)) throw bootstrapError("bootstrap_role_credentials_missing", "A distinct database role requires its own bootstrap host, port, user, password, and database binding", { role, required_env_prefix: prefix });
    if (configuredDatabase && configuredDatabase !== binding.database) throw bootstrapError("bootstrap_role_database_mismatch", "Role bootstrap database does not match the allowlisted role database", { role });
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw bootstrapError("bootstrap_role_port_invalid", "Role bootstrap port is invalid", { role });
    return { host, port, user, password, database: binding.database, role, credential_source: roleSpecific ? "dedicated_bootstrap_role_specific" : "dedicated_bootstrap" };
  }
  assertHostLocalRoleAuthorization(env, normalizeMode(env.BOOTSTRAP_MODE || "plan"));
  const prefix = binding.database === target.database ? "DB" : binding.prefix;
  const configuredDatabase = String(env[prefix + "_NAME"] || "").trim();
  if (configuredDatabase !== binding.database) {
    throw bootstrapError("bootstrap_role_database_mismatch", "Host-local role database does not match its bound environment identity", { role });
  }
  const host = String(env[prefix + "_HOST"] || env.DB_HOST || "").trim();
  const user = String(env[prefix + "_USER"] || "").trim();
  const password = String(env[prefix + "_PASSWORD"] || "");
  const missing = [];
  if (!host) missing.push(prefix + "_HOST_or_DB_HOST");
  if (!user) missing.push(prefix + "_USER");
  if (requirePassword && !password.trim()) missing.push(prefix + "_PASSWORD");
  if (missing.length) throw bootstrapError("bootstrap_role_credentials_missing", "Host-local database role credentials are incomplete", { role, missing });
  const port = Number(env[prefix + "_PORT"] || env.DB_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw bootstrapError("bootstrap_role_port_invalid", "Host-local database role port is invalid", { role });
  }
  return { host, port, user, password, database: binding.database, role, credential_source: "host_local_role_scoped" };
}

function preflightRoleBootstrapCredentials(env, target, { requirePassword = true } = {}) {
  const governanceDatabase = target.governance_database || target.database;
  const persistenceDatabase = target.runtime_persistence_database || target.database;
  const splitRoleTopology = governanceDatabase !== target.database || persistenceDatabase !== target.database;
  const source = normalizeTargetSource(env.BOOTSTRAP_TARGET_SOURCE);
  if (splitRoleTopology && source === RUNTIME_ENV_TARGET_SOURCE) {
    throw bootstrapError("bootstrap_runtime_env_split_role_credentials_unsupported", "runtime_env cannot reuse the primary DB identity across distinct governance or runtime-persistence databases; use the explicit host-local role source", { source, required_source: "host_local_role_env", distinct_role_count: 1 + Number(governanceDatabase !== target.database) + Number(persistenceDatabase !== target.database) });
  }
  const roles = ["runtime"];
  if (governanceDatabase !== target.database) roles.push("governance");
  if (persistenceDatabase !== target.database && persistenceDatabase !== governanceDatabase) roles.push("runtime_persistence");
  const resolved = new Map(roles.map((role) => [role, resolveRoleBootstrapCredentials(env, role, target, { requirePassword })]));
    if (usesLocalRoleIdentity(env.BOOTSTRAP_TARGET_SOURCE) || splitRoleTopology) {
    const identities = new Map();
    for (const [role, credentials] of resolved) {
      if (identities.has(credentials.user)) {
        throw bootstrapError("bootstrap_role_identity_reuse_denied", "Distinct Hostinger databases require distinct role-bound users", { role, other_role: identities.get(credentials.user) });
      }
      identities.set(credentials.user, role);
    }
  }
  return resolved;
}

export function selectMigration(contract, migration, mode) {
  const file = String(migration || "").trim().replaceAll("\\", "/");
  if (!file || file.includes("/") || file.includes("..")) throw bootstrapError("bootstrap_migration_path_invalid", "Bootstrap migration must be a canonical filename without path components");
  const spec = contract.migrations?.[file];
  if (!spec) throw bootstrapError("bootstrap_migration_not_allowlisted", "Migration is outside the repository-owned bootstrap allowlist", { migration: file });
  if (!Array.isArray(spec.allowed_modes) || !spec.allowed_modes.includes(mode)) {
    throw bootstrapError("bootstrap_migration_mode_denied", "Migration is not allowed in the requested mode", { migration: file, mode, role: spec.role || null });
  }
  return { file, spec };
}

export function validateApplyConfirmation(env, sha, target, contract, operation) {
  const targetKey = typeof target === "string" ? target : target?.key;
  const normalizedOperation = String(operation || "").trim().toLowerCase();
  if (!['migration', 'grants'].includes(normalizedOperation)) {
    throw bootstrapError("bootstrap_operation_invalid", "Apply confirmation must identify migration or grants operation");
  }
  const prefix = normalizedOperation === "migration"
    ? contract.execution_policy.apply_migration_confirmation_prefix
    : contract.execution_policy.apply_grants_confirmation_prefix;
  const expected = normalizedOperation === "migration"
    ? `${prefix}:${sha}:${targetKey}:${target?.migration || env.BOOTSTRAP_MIGRATION || "20260815_custom_gpt_mcp_catalog_levels.sql"}`
    : (() => {
      const distinctDatabases = new Set(Object.values(target?.role_identity_bindings || {}).map((binding) => binding?.database).filter(Boolean)).size > 1;
      if (!distinctDatabases) return `${prefix}:${sha}:${targetKey}:${target?.principal}:${target?.principal_host}`;
      const suppliedBindingHash = String(target?.grant_binding_hash || env.BOOTSTRAP_GRANT_BINDING_HASH || "").trim().toLowerCase();
      const expectedBindingHash = computeGrantBindingHash(target, contract);
      if (!SHA256_RE.test(suppliedBindingHash) || suppliedBindingHash !== expectedBindingHash) throw bootstrapError("bootstrap_grant_binding_hash_mismatch", "Split-database grants require an exact hash of all role databases, principals, and role grant policies");
      return `${prefix}:${sha}:${targetKey}:${expectedBindingHash}`;
    })();
  const confirmationKey = normalizedOperation === "migration" ? "BOOTSTRAP_MIGRATION_CONFIRMATION" : "BOOTSTRAP_GRANTS_CONFIRMATION";
  const confirmation = String(env[confirmationKey] || "");
  if (confirmation !== expected) {
    throw bootstrapError("bootstrap_confirmation_mismatch", "Apply requires an exact operation-, SHA-, target-, and identity-bound confirmation", { operation: normalizedOperation, confirmation_key: confirmationKey, expected_confirmation: expected });
  }
  return expected;
}

export function validateRoleRebuildConfirmation(env, sha, target, contract) {
  const selected = normalizeRoleSelection(env.BOOTSTRAP_ROLE_SELECTION || env.HOST_BREAKGLASS_TARGET_ROLES, { allowInspectionDerived: false });
  const inspectionRunId = String(env.BOOTSTRAP_INSPECTION_RUN_ID || "").trim();
  const planHash = String(env.BOOTSTRAP_PLAN_SHA256 || "").trim().toLowerCase();
  const selectionHash = String(env.BOOTSTRAP_ROLE_SELECTION_HASH || "").trim().toLowerCase();
  const roleProofText = String(env.BOOTSTRAP_ROLE_OBJECT_COUNT_FINGERPRINTS || "").trim();
  let roleProof;
  try { roleProof = JSON.parse(roleProofText); } catch { roleProof = null; }
  const roleFingerprints = roleProof?.role_object_count_fingerprints;
  const requiredProofFields = ["source", "expected_sha", "inspection_evidence_hash", "finding_ids", "role_object_count_fingerprints", "composite_target_fingerprint"];
  if (!inspectionRunId || !SAFE_ID_RE.test(inspectionRunId) || !SHA256_RE.test(planHash) || !roleProof || typeof roleProof !== "object" || Array.isArray(roleProof) || requiredProofFields.some((field) => !Object.hasOwn(roleProof, field)) || !Array.isArray(roleProof.finding_ids) || !roleFingerprints || typeof roleFingerprints !== "object" || Array.isArray(roleFingerprints)) {
    throw bootstrapError("bootstrap_rebuild_inspection_binding_missing", "Role-selective baseline rebuild requires a bounded durable inspection run, exact plan hash, and a complete rich inspection proof envelope.", { required_fields: ["BOOTSTRAP_INSPECTION_RUN_ID", "BOOTSTRAP_PLAN_SHA256", "BOOTSTRAP_ROLE_SELECTION", "BOOTSTRAP_ROLE_SELECTION_HASH", "BOOTSTRAP_ROLE_OBJECT_COUNT_FINGERPRINTS.rich_proof_envelope"] });
  }
  const proofExpectedSha = String(roleProof.expected_sha || "").trim().toLowerCase();
  if (!SHA_RE.test(proofExpectedSha) || proofExpectedSha !== String(sha).trim().toLowerCase()) throw bootstrapError("bootstrap_rebuild_proof_sha_mismatch", "Role selection proof expected SHA must match the exact bootstrap source SHA.");
  if (!SHA256_RE.test(String(roleProof.inspection_evidence_hash || "").trim().toLowerCase()) || !SHA256_RE.test(String(roleProof.composite_target_fingerprint || "").trim().toLowerCase())) throw bootstrapError("bootstrap_rebuild_role_selection_proof_invalid", "Role selection proof evidence and composite fingerprints must be full SHA-256 values.");
  for (const role of selected) if (!SHA256_RE.test(String(roleFingerprints[role] || "").toLowerCase())) throw bootstrapError("bootstrap_rebuild_role_fingerprint_missing", "Every selected role must carry a full object-count fingerprint from the inspection record.", { role });
  const normalizedRoleFingerprints = Object.fromEntries(selected.map((role) => [role, String(roleFingerprints[role]).toLowerCase()]));
  const expectedSelectionHash = computeRoleSelectionProofHash({
    source: roleProof.source,
    expected_sha: proofExpectedSha,
    selected_roles: selected,
    inspection_run_id: inspectionRunId,
    inspection_evidence_hash: roleProof.inspection_evidence_hash,
    finding_ids: roleProof.finding_ids,
    role_object_count_fingerprints: normalizedRoleFingerprints,
    composite_target_fingerprint: roleProof.composite_target_fingerprint,
  });
  if (selectionHash !== expectedSelectionHash) throw bootstrapError("bootstrap_rebuild_role_selection_hash_mismatch", "Role selection proof hash does not match the complete selected-role inspection proof.", { selected_roles: selected });
  const roleBinding = selected.join(",");
  const prefix = contract.execution_policy.rebuild_confirmation_prefix || "APPLY_HOSTINGER_RUNTIME_BASELINE_REBUILD";
  const expected = `${prefix}:${sha}:${target?.key}:${roleBinding}`;
  const confirmation = String(env.BOOTSTRAP_REBUILD_CONFIRMATION || "");
  if (confirmation !== expected) {
    throw bootstrapError("bootstrap_rebuild_confirmation_mismatch", "Role-selective baseline rebuild requires an exact SHA-, target-, and role-set-bound confirmation.", { confirmation_key: "BOOTSTRAP_REBUILD_CONFIRMATION", expected_confirmation: expected, selected_roles: selected });
  }
  return { confirmation: expected, plan_hash: planHash, selection_hash: selectionHash, selected_roles: selected, inspection_run_id: inspectionRunId, role_object_count_fingerprints: normalizedRoleFingerprints };
}

function normalizeOperationsByTable(policy, expectedTables, role) {
  const declared = policy?.required_operations_by_table;
  if (!declared) return null;
  const declaredTables = Object.keys(declared);
  if (declaredTables.length !== expectedTables.length || declaredTables.some((table) => !expectedTables.includes(table))) {
    throw bootstrapError("bootstrap_grant_operation_table_map_denied", "Per-table grant operations must exactly match the repository role table contract", { role });
  }
  return Object.fromEntries(expectedTables.map((table) => {
    const operations = [...new Set((declared[table] || []).map((item) => String(item).toUpperCase()))];
    if (!operations.length) throw bootstrapError("bootstrap_grant_operation_table_map_invalid", "Every contracted grant table must declare a non-empty operation set", { role, table });
    return [table, operations];
  }));
}

function validateGrantEntries(entries, expectedTables, expectedOps, { role = "runtime", expectedOpsByTable = null } = {}) {
  const tables = entries.map((entry) => String(entry.table || ""));
  const roleAllowedPrivileges = allowedGrantPrivilegesForRole(role);
  if (tables.length !== expectedTables.length || new Set(tables).size !== expectedTables.length || tables.some((table) => !expectedTables.includes(table))) {
    throw bootstrapError("bootstrap_grant_table_set_denied", "Grant table set must exactly match the repository role contract", { role });
  }
  return entries.map((entry) => {
    const table = assertIdentifier(entry.table, "grant.table");
    const expectedForTable = expectedOpsByTable?.[table] || expectedOps;
    const privileges = [...new Set((entry.privileges || []).map((item) => String(item).toUpperCase()))];
    if (privileges.length !== expectedForTable.length || privileges.some((item) => !SAFE_GRANT_PRIVILEGES.has(item) || !roleAllowedPrivileges.has(item)) || expectedForTable.some((item) => !privileges.includes(item))) {
      throw bootstrapError("bootstrap_grant_operation_set_denied", "Grant operations must exactly match the selected role policy and its bounded privilege allowlist", { role, table });
    }
    return { table, privileges };
  });
}

export function validateGrantPlan(target, contract) {
  const policy = contract.grant_policy;
  const expectedTables = [...(policy.required_tables || [])];
  const expectedOps = [...(policy.required_operations || [])].map((item) => String(item).toUpperCase());
  const expectedOpsByTable = normalizeOperationsByTable(policy, expectedTables, "runtime");
  const entries = Array.isArray(target.grants) && target.grants.length
    ? target.grants.map(normalizeEntry)
    : expectedTables.map((table) => ({ table, privileges: expectedOpsByTable?.[table] || expectedOps }));
  return validateGrantEntries(entries, expectedTables, expectedOps, { role: "runtime", expectedOpsByTable });
}

function roleGrantPolicy(contract, role) {
  const policy = contract.grant_policy?.role_policies?.[role];
  if (policy) return policy;
  if (role === "runtime") return { required_tables: contract.grant_policy?.required_tables || [], required_operations: contract.grant_policy?.required_operations || [], apply_when: "always" };
  throw bootstrapError("bootstrap_role_grant_policy_missing", "The repository contract has no exact grant policy for the selected database role", { role });
}

export function validateRoleGrantPlan(target, role, contract) {
  const policy = roleGrantPolicy(contract, role);
  const expectedTables = [...(policy.required_tables || [])];
  const expectedOps = [...(policy.required_operations || contract.grant_policy?.required_operations || [])].map((item) => String(item).toUpperCase());
  const expectedOpsByTable = normalizeOperationsByTable(policy, expectedTables, role);
  if (!expectedTables.length || !expectedOps.length) throw bootstrapError("bootstrap_role_grant_policy_invalid", "A role grant policy must declare an exact non-empty table and operation set", { role });
  const entries = Array.isArray(target.grants) && target.grants.length
    ? target.grants.map(normalizeEntry)
    : expectedTables.map((table) => ({ table, privileges: expectedOpsByTable?.[table] || expectedOps }));
  const grants = validateGrantEntries(entries, expectedTables, expectedOps, { role, expectedOpsByTable });
  const binding = targetRoleIdentityBindings(target)?.[role];
  if (!binding?.database || !binding?.principal || !binding?.principal_host) throw bootstrapError("bootstrap_role_grant_identity_missing", "Role-specific grants require an explicit database, principal, and principal host binding", { role });
  return { role, database: binding.database, principal: binding.principal, principal_host: binding.principal_host, apply_when: policy.apply_when || "always", grants };
}

function targetRoleIdentityBindings(target) {
  if (target?.role_identity_bindings && typeof target.role_identity_bindings === "object") return target.role_identity_bindings;
  return roleIdentityBindings({ database: target?.database, governanceDatabase: target?.governance_database || target?.database, persistenceDatabase: target?.runtime_persistence_database || target?.database, principal: target?.principal, principalHost: target?.principal_host, runtimePrincipal: target?.runtime_principal, runtimePrincipalHost: target?.runtime_principal_host, governancePrincipal: target?.governance_principal, governancePrincipalHost: target?.governance_principal_host, persistencePrincipal: target?.runtime_persistence_principal, persistencePrincipalHost: target?.runtime_persistence_principal_host });
}

function roleGrantTarget(target, role, contract) {
  const plan = validateRoleGrantPlan({ ...target, role_identity_bindings: targetRoleIdentityBindings(target) }, role, contract);
  return { ...target, role_identity_bindings: targetRoleIdentityBindings(target), principal: plan.principal, principal_host: plan.principal_host, grants: plan.grants };
}

function roleGrantApplies(target, role, contract) {
  const plan = roleGrantPolicy(contract, role);
  if (plan.apply_when !== "distinct_database_only") return true;
  const binding = targetRoleIdentityBindings(target)?.[role];
  return Boolean(binding?.database && binding.database !== target.database);
}

export function resolveGrantRoles(target, contract) {
  const roles = BOOTSTRAP_ROLE_KEYS.filter((role) => roleGrantApplies(target, role, contract));
  if (!roles.length) throw bootstrapError("bootstrap_grant_role_set_empty", "The repository grant contract resolved no database role for this target");
  return roles;
}

export function computeGrantBindingHash(target, contract) {
  const bindings = resolveGrantRoles(target, contract).map((role) => {
    const policy = roleGrantPolicy(contract, role);
    const binding = targetRoleIdentityBindings(target)?.[role];
    return { role, database: binding?.database || null, principal: binding?.principal || null, principal_host: binding?.principal_host || null, required_tables: [...(policy.required_tables || [])], required_operations: [...(policy.required_operations || [])].map((item) => String(item).toUpperCase()), required_operations_by_table: policy.required_operations_by_table ? Object.fromEntries((policy.required_tables || []).map((table) => [table, [...(policy.required_operations_by_table[table] || [])].map((item) => String(item).toUpperCase())])) : null };
  });
  return sha256Hex(JSON.stringify(bindings));
}

export function classifyMysqlError(error) {
  const code = String(error?.code || "");
  if (["ER_TABLEACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR", "ER_ACCESS_DENIED_ERROR", "ER_SPECIFIC_ACCESS_DENIED_ERROR"].includes(code)) return "privilege_denied";
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR", "ER_WRONG_TABLE_NAME", "ER_DB_CREATE_EXISTS"].includes(code)) return "missing_schema";
  return "bootstrap_error";
}

export function sanitizeBootstrapError(error) {
  const category = classifyMysqlError(error);
  const details = error?.details && typeof error.details === "object" ? { ...error.details } : {};
  delete details.password;
  delete details.secret;
  delete details.connection_string;
  delete details.sql;
  return {
    code: error?.code || "bootstrap_failed",
    category,
    message: String(error?.message || "Bootstrap failed").slice(0, 500),
    details,
    secrets_included: false,
  };
}

async function queryOne(connection, sql, params = []) {
  const [rows] = await connection.execute(sql, params);
  return Array.isArray(rows) ? rows : [];
}

export async function databaseExists(connection, database) {
  return (await queryOne(connection, "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [database])).length > 0;
}

export async function tableCount(connection, database) {
  const rows = await queryOne(connection, "SELECT COUNT(*) AS table_count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'", [database]);
  const countRow = rows.find((row) => Object.prototype.hasOwnProperty.call(row, "table_count"));
  return Number(countRow?.table_count || 0);
}

function countFromRows(rows, key) {
  const countRow = rows.find((row) => Object.prototype.hasOwnProperty.call(row, key));
  const count = Number(countRow?.[key] || 0);
  if (!Number.isInteger(count) || count < 0) throw bootstrapError("bootstrap_object_count_invalid", "Database object count is invalid", { object_kind: key.replace(/_count$/u, "") });
  return count;
}

export async function databaseObjectCounts(connection, database) {
  const [tables, views, triggers, routines, events] = await Promise.all([
    queryOne(connection, "SELECT COUNT(*) AS table_count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'", [database]),
    queryOne(connection, "SELECT COUNT(*) AS view_count FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?", [database]),
    queryOne(connection, "SELECT COUNT(*) AS trigger_count FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?", [database]),
    queryOne(connection, "SELECT COUNT(*) AS routine_count FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?", [database]),
    queryOne(connection, "SELECT COUNT(*) AS event_count FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?", [database]),
  ]);
  const counts = {
    tables: countFromRows(tables, "table_count"),
    views: countFromRows(views, "view_count"),
    triggers: countFromRows(triggers, "trigger_count"),
    routines: countFromRows(routines, "routine_count"),
    events: countFromRows(events, "event_count"),
  };
  return { ...counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0), secrets_included: false };
}

function normalizeObjectCounts(value) {
  if (typeof value === "number") {
    const count = Number(value);
    if (!Number.isInteger(count) || count < 0) throw bootstrapError("bootstrap_object_count_invalid", "Database object count is invalid");
    return { tables: count, views: 0, triggers: 0, routines: 0, events: 0, total: count, legacy_table_only: true, secrets_included: false };
  }
  if (!value || typeof value !== "object") throw bootstrapError("bootstrap_object_count_invalid", "Database object count evidence is required");
  const counts = { tables: 0, views: 0, triggers: 0, routines: 0, events: 0 };
  for (const key of Object.keys(counts)) {
    const count = Number(value[key]);
    if (!Number.isInteger(count) || count < 0) throw bootstrapError("bootstrap_object_count_invalid", "Database object count is invalid", { object_kind: key });
    counts[key] = count;
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (value.total !== undefined && Number(value.total) !== total) throw bootstrapError("bootstrap_object_count_mismatch", "Database object count total does not match its components");
  return { ...counts, total, legacy_table_only: false, secrets_included: false };
}

export function classifyDatabaseTableCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) throw bootstrapError("bootstrap_table_count_invalid", "Database table count is invalid");
  return count === 0 ? "zero_tables" : "nonempty";
}

export function classifyDatabaseObjectCount(value) {
  const counts = normalizeObjectCounts(value);
  return counts.total === 0 ? "zero_objects" : "nonempty_objects";
}

export function assertZeroObjectDatabase(value) {
  const counts = normalizeObjectCounts(value);
  if (counts.total !== 0) throw bootstrapError("bootstrap_baseline_nonempty_denied", "Schema bundle reconstruction is permitted only when tables, views, triggers, routines, and events are all absent", { object_counts: counts });
  return true;
}

export function assertBaselineDatabaseEligible(value) {
  const counts = normalizeObjectCounts(value);
  if (counts.total !== 0) {
    throw bootstrapError("bootstrap_baseline_nonempty_denied", "Baseline schema bundle is permitted only for a zero-object database", { table_count: counts.tables, object_counts: counts });
  }
  return true;
}

function resolveEmptyRebuildRoles(env, roleClassifications, { allowNone = false } = {}) {
  const requested = normalizeRoleSelection(env.BOOTSTRAP_ROLE_SELECTION || env.HOST_BREAKGLASS_TARGET_ROLES);
  const zeroObjectRoles = BOOTSTRAP_ROLE_KEYS.filter((role) => roleClassifications[role] === "zero_objects");
  const selected = requested || zeroObjectRoles;
  if (!selected.length && !allowNone) throw bootstrapError("bootstrap_no_zero_object_roles", "database.rebuild_empty requires at least one role proven to have zero tables, views, triggers, routines, and events.", { role_classifications: roleClassifications });
  const nonemptySelected = selected.filter((role) => roleClassifications[role] !== "zero_objects");
  if (nonemptySelected.length) {
    throw bootstrapError("bootstrap_role_rebuild_nonempty_denied", "A role-specific empty rebuild is permitted only for roles proven zero-object in the same inspection cycle.", { selected_roles: selected, nonempty_selected_roles: nonemptySelected, role_classifications: roleClassifications });
  }
  return { roles: selected, source: requested ? "plan_bound_role_selection" : ROLE_SELECTION_FROM_INSPECTION };
}

function roleSeedEntries(contract, role) {
  const declared = contract?.baseline_bundle?.role_seed_files?.[role];
  if (Array.isArray(declared)) return declared;
  return role === "runtime" && Array.isArray(contract?.baseline_bundle?.required_seed_files)
    ? contract.baseline_bundle.required_seed_files
    : [];
}

function roleBaselineTables(contract, role) {
  const key = role === "runtime" ? "required_runtime_tables" : role === "governance" ? "required_governance_tables" : "required_runtime_persistence_tables";
  return Array.isArray(contract?.baseline_bundle?.[key]) ? contract.baseline_bundle[key] : [];
}

function objectCountsFingerprint(counts) {
  return sha256Hex(JSON.stringify(normalizeObjectCounts(counts)));
}

function roleConnectionBindings({ connection, ledgerConnection, persistenceExecutor, target, governanceDatabase, persistenceDatabase }) {
  return {
    runtime: { connection, database: target.database },
    governance: { connection: ledgerConnection, database: governanceDatabase },
    runtime_persistence: { connection: persistenceExecutor, database: persistenceDatabase },
  };
}

export async function tableExists(connection, database, table) {
  const rows = await queryOne(connection, "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?", [database, table]);
  return rows.length > 0;
}

export async function requiredTableEvidence(connection, database, tables) {
  const evidence = [];
  for (const table of tables) {
    const present = await tableExists(connection, database, table);
    evidence.push({ table, present });
  }
  return evidence;
}

export async function columnExists(connection, database, table, column) {
  const rows = await queryOne(connection, "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?", [database, table, column]);
  return rows.length > 0;
}

export async function indexExists(connection, database, table, index) {
  const rows = await queryOne(connection, "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?", [database, table, index]);
  return rows.length > 0;
}

export async function readIncidentPostconditions(connection, database, contract, migration) {
  const checks = contract.postconditions?.[migration] || [];
  if (!checks.length) throw bootstrapError("bootstrap_postconditions_missing", "Migration has no declared postconditions", { migration });
  const evidence = [];
  for (const check of checks) {
    const table = check.type === "view_row" ? null : assertIdentifier(check.table, "postcondition.table");
    if (check.type === "column") {
      const column = assertIdentifier(check.column, "postcondition.column");
      evidence.push({ ...check, ready: await columnExists(connection, database, table, column) });
    } else if (check.type === "index") {
      const index = assertIdentifier(check.index, "postcondition.index");
      evidence.push({ ...check, ready: await indexExists(connection, database, table, index) });
    } else if (check.type === "row" || check.type === "view_row") {
      const relation = assertIdentifier(check.view || check.table, "postcondition.relation");
      const keyColumn = assertIdentifier(check.key_column, "postcondition.key_column");
      const valueColumn = assertIdentifier(check.value_column, "postcondition.value_column");
      const rows = await queryOne(connection, `SELECT \`${valueColumn}\` AS observed_value FROM \`${relation}\` WHERE \`${keyColumn}\` = ?`, [check.key_value]);
      const observedRow = rows.find((row) => Object.prototype.hasOwnProperty.call(row, "observed_value"));
      evidence.push({ ...check, ready: rows.length === 1 && String(observedRow?.observed_value) === String(check.expected_value) });
    } else {
      throw bootstrapError("bootstrap_postcondition_type_denied", "Unknown postcondition type", { migration, type: check.type || null });
    }
  }
  return { ready: evidence.every((item) => item.ready), checks: evidence };
}

export async function readLedgerInspection(connection, database) {
  const tableRows = await queryOne(connection, "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'governed_migration_ledger'", [database]);
  if (tableRows.length !== 1) {
    return { available: false, required: true, reason_code: "bootstrap_ledger_missing", missing_columns: [], records: [] };
  }
  const columnRows = await queryOne(connection, `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'governed_migration_ledger' AND COLUMN_NAME IN (${LEDGER_COLUMNS.map(() => "?").join(",")})`, [database, ...LEDGER_COLUMNS]);
  const present = new Set(columnRows.map((row) => String(row.COLUMN_NAME)));
  const missing = LEDGER_COLUMNS.filter((column) => !present.has(column));
  if (missing.length) {
    return { available: false, required: true, reason_code: "bootstrap_ledger_contract_incomplete", missing_columns: missing, records: [] };
  }
  const rows = await queryOne(connection, "SELECT migration_file, migration_checksum_sha256, applied_at, mode FROM governed_migration_ledger ORDER BY applied_at DESC LIMIT 100");
  return {
    available: true,
    required: true,
    row_count: rows.length,
    records: rows.map((row) => ({
      migration_file: String(row.migration_file || ""),
      migration_checksum_sha256: String(row.migration_checksum_sha256 || "").toLowerCase(),
      applied_at: row.applied_at || null,
      mode: String(row.mode || ""),
    })),
  };
}

export async function readLedgerApplyRecord(connection, database, migration, checksum) {
  const tableRows = await queryOne(connection, "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'governed_migration_ledger'", [database]);
  if (tableRows.length !== 1) throw bootstrapError("bootstrap_ledger_missing", "Canonical governed_migration_ledger is required before recovery apply", { migration });
  const columnRows = await queryOne(connection, `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'governed_migration_ledger' AND COLUMN_NAME IN (${LEDGER_COLUMNS.map(() => "?").join(",")})`, [database, ...LEDGER_COLUMNS]);
  const present = new Set(columnRows.map((row) => String(row.COLUMN_NAME)));
  const missing = LEDGER_COLUMNS.filter((column) => !present.has(column));
  if (missing.length) throw bootstrapError("bootstrap_ledger_contract_incomplete", "Canonical ledger schema is incomplete", { migration, missing });
  const rows = await queryOne(connection, "SELECT run_id, migration_checksum_sha256, mode, applied_at FROM governed_migration_ledger WHERE migration_file = ? AND mode = 'apply' ORDER BY applied_at DESC", [migration]);
  const expected = String(checksum).toLowerCase();
  const conflicts = rows.filter((row) => String(row.migration_checksum_sha256 || "").toLowerCase() !== expected);
  if (conflicts.length) throw bootstrapError("bootstrap_ledger_checksum_conflict", "Canonical ledger contains a conflicting apply checksum", { migration, expected_checksum_sha256: expected, conflicting_record_count: conflicts.length });
  const match = rows.find((row) => String(row.migration_checksum_sha256 || "").toLowerCase() === expected);
  return match ? { found: true, run_id: match.run_id || null, applied_at: match.applied_at || null } : { found: false, run_id: null, applied_at: null };
}

function migrationFilePath(repoRoot, file) {
  const normalized = String(file || "").replaceAll("\\", "/");
  if (!/^[A-Za-z0-9_.-]+\.sql$/u.test(normalized)) throw bootstrapError("bootstrap_migration_path_invalid", "Migration file name is unsafe", { file: normalized });
  const root = path.resolve(repoRoot, "http-generic-api", "migrations");
  const absolute = path.resolve(root, normalized);
  if (!absolute.startsWith(`${root}${path.sep}`)) throw bootstrapError("bootstrap_migration_path_invalid", "Migration path escaped repository migrations root", { file: normalized });
  if (!fs.existsSync(absolute)) throw bootstrapError("bootstrap_migration_missing", "Allowlisted migration artifact is missing", { file: normalized });
  return absolute;
}

function assertSqlArtifactSafe(sql, { allowData = false } = {}) {
  const statements = splitMigrationSqlStatements(String(sql)).map((item) => String(item).trim()).filter(Boolean);
  if (!statements.length) throw bootstrapError("bootstrap_sql_empty", "SQL artifact is empty");
  const forbidden = [
    /^\s*(?:GRANT|REVOKE|CREATE\s+USER|ALTER\s+USER|DROP\s+DATABASE|CREATE\s+DATABASE|LOAD\s+DATA)\b/imu,
    /^\s*SELECT[\s\S]*\bINTO\s+(?:OUTFILE|DUMPFILE)\b/imu,
  ];
  if (!allowData) forbidden.push(/^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/imu);
  const hit = statements.find((statement) => forbidden.some((pattern) => pattern.test(statement)));
  if (hit) throw bootstrapError("bootstrap_sql_safety_denied", "SQL artifact contains an unapproved authority or data statement");
  return statements;
}

const TABLE_SCOPED_DDL_PRIVILEGES = new Set(["ALTER", "INDEX", "TRIGGER", "REFERENCES", "DROP"]);

export function deriveDdlPrivilegeRequirements(sql) {
  const statements = splitMigrationSqlStatements(String(sql)).map((item) => String(item).trim()).filter(Boolean);
  const required = new Set();
  for (const rawStatement of statements) {
    const statement = rawStatement.replace(/^\/\*[\s\S]*?\*\//u, "").trim().toUpperCase();
    if (/^CREATE\s+(?:TEMPORARY\s+)?TABLE\b/u.test(statement)) required.add("CREATE");
    if (/^ALTER\s+TABLE\b/u.test(statement)) required.add("ALTER");
    if (/^(?:CREATE\s+(?:UNIQUE\s+)?INDEX\b|ALTER\s+TABLE[\s\S]*\b(?:ADD|DROP|RENAME)\s+(?:UNIQUE\s+)?(?:INDEX|KEY)\b)/u.test(statement)) required.add("INDEX");
    if (/^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b/u.test(statement)) required.add("CREATE VIEW");
    if (/^CREATE\s+TRIGGER\b/u.test(statement)) required.add("TRIGGER");
    if (/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:PROCEDURE|FUNCTION)\b/u.test(statement)) required.add("CREATE ROUTINE");
    if (/^ALTER\s+(?:PROCEDURE|FUNCTION)\b/u.test(statement)) required.add("ALTER ROUTINE");
    if (/^CREATE\s+EVENT\b/u.test(statement)) required.add("EVENT");
    if (/^DROP\s+(?:TABLE|VIEW|TRIGGER|PROCEDURE|FUNCTION|EVENT)\b/u.test(statement)) required.add("DROP");
    if (/\bREFERENCES\b/u.test(statement)) required.add("REFERENCES");
  }
  return { required_privileges: [...required].sort(), statement_count: statements.length };
}

export async function readDdlPrivilegePreconditions(connection, database, requiredPrivileges, requiredTables = []) {
  const privileges = [...new Set((requiredPrivileges || []).map((item) => String(item).toUpperCase()))];
  const tables = [...new Set((requiredTables || []).map((item) => String(item)))];
  if (!privileges.length) return { ready: true, required_privileges: [], scope_tables: tables, missing_privileges: [], missing_table_privileges: [], secrets_included: false };
  const userRows = await queryOne(connection, "SELECT PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = CURRENT_USER()");
  const schemaRows = await queryOne(connection, "SELECT PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = CURRENT_USER() AND TABLE_SCHEMA = ?", [database]);
  const tableRows = tables.length
    ? await queryOne(connection, `SELECT TABLE_NAME, PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = CURRENT_USER() AND TABLE_SCHEMA = ? AND TABLE_NAME IN (${tables.map(() => "?").join(",")})`, [database, ...tables])
    : [];
  const allScopeRows = [...userRows, ...schemaRows, ...tableRows];
  const broad = new Set([...userRows, ...schemaRows].map((row) => String(row.PRIVILEGE_TYPE || "").toUpperCase()));
  const grantOptionRows = allScopeRows.filter((row) => String(row.IS_GRANTABLE || "NO").toUpperCase() === "YES");
  const missingPrivileges = [];
  const missingTablePrivileges = [];
  for (const privilege of privileges) {
    if (broad.has(privilege)) continue;
    if (TABLE_SCOPED_DDL_PRIVILEGES.has(privilege) && tables.length) {
      const missingTables = tables.filter((table) => !tableRows.some((row) => String(row.TABLE_NAME || "") === table && String(row.PRIVILEGE_TYPE || "").toUpperCase() === privilege));
      if (!missingTables.length) continue;
      missingTablePrivileges.push({ privilege, tables: missingTables });
      continue;
    }
    missingPrivileges.push(privilege);
  }
  return { ready: missingPrivileges.length === 0 && missingTablePrivileges.length === 0 && grantOptionRows.length === 0, required_privileges: privileges, scope_tables: tables, missing_privileges: missingPrivileges, missing_table_privileges: missingTablePrivileges, grant_option_count: grantOptionRows.length, secrets_included: false };
}

export async function assertDdlPrivilegePreflight(connection, database, sql, requiredTables = [], context = {}) {
  const requirements = deriveDdlPrivilegeRequirements(sql);
  const evidence = await readDdlPrivilegePreconditions(connection, database, requirements.required_privileges, requiredTables);
  if (!evidence.ready) {
    throw bootstrapError("bootstrap_ddl_privilege_preflight_failed", "Required DDL privileges were not proven before the first schema mutation.", { ...context, required_privileges: evidence.required_privileges, scope_tables: evidence.scope_tables, missing_privileges: evidence.missing_privileges, missing_table_privileges: evidence.missing_table_privileges, grant_option_count: evidence.grant_option_count, preflight_complete: true, database_mutation_performed: false });
  }
  return { ...evidence, statement_count: requirements.statement_count, context: { ...context }, database_mutation_performed: false };
}

function resolveBundleManifestPath(repoRoot, configuredPath, contract) {
  const requested = String(configuredPath || contract.baseline_bundle.default_manifest_path).trim();
  const resolvedRoot = path.resolve(repoRoot);
  const resolved = path.resolve(resolvedRoot, requested);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw bootstrapError("bootstrap_bundle_path_denied", "Schema bundle manifest must remain inside the exact checkout");
  }
  return resolved;
}

export function validateBundleManifestPath(repoRoot, configuredPath, contract = readRuntimeBootstrapContract()) {
  return resolveBundleManifestPath(repoRoot, configuredPath, contract);
}

function readBundleManifest(manifestPath, expectedSha, contract, role = "runtime") {
  let manifest;
  let manifestBytes;
  try {
    manifestBytes = fs.readFileSync(manifestPath);
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    throw bootstrapError("bootstrap_bundle_manifest_unreadable", "Schema bundle manifest is unreadable", { cause: error?.message || "parse_failed" });
  }
  if (manifest.contract !== contract.baseline_bundle.manifest_contract) throw bootstrapError("bootstrap_bundle_contract_invalid", "Schema bundle manifest contract is not canonical");
  if (manifest.source_commit !== expectedSha) throw bootstrapError("bootstrap_bundle_source_mismatch", "Schema bundle was not generated from the exact requested source SHA");
  if (manifest.schema_only !== true || manifest.production_accessed !== false || manifest.provider_accessed !== false || manifest.data_exported !== false || manifest.secrets_included !== false) {
    throw bootstrapError("bootstrap_bundle_safety_invalid", "Schema bundle safety declarations are incomplete");
  }
  const roleConfig = manifest.roles?.[role];
  const roleContracts = {
    runtime: { file: contract.baseline_bundle.runtime_role_file, tables: contract.baseline_bundle.required_runtime_tables },
    governance: { file: contract.baseline_bundle.governance_role_file, tables: contract.baseline_bundle.required_governance_tables },
    runtime_persistence: { file: contract.baseline_bundle.runtime_persistence_role_file, tables: contract.baseline_bundle.required_runtime_persistence_tables },
  };
  const roleContract = roleContracts[role];
  if (!roleContract?.file || !Array.isArray(roleContract.tables) || roleContract.tables.length === 0) {
    throw bootstrapError("bootstrap_bundle_role_contract_invalid", "Schema bundle role has no repository-owned execution contract", { role });
  }
  const expectedFile = roleContract.file;
  const requiredTables = roleContract.tables;
  const bundleFile = roleConfig?.bundle_file || roleConfig?.file;
  if (!roleConfig || bundleFile !== expectedFile || !Array.isArray(roleConfig.tables) || roleConfig.tables.length === 0 || !Number.isInteger(Number(roleConfig.table_count)) || Number(roleConfig.table_count) !== roleConfig.tables.length) throw bootstrapError("bootstrap_bundle_role_invalid", "Schema bundle role is incomplete", { role });
  for (const table of requiredTables) if (!roleConfig.tables.includes(table)) throw bootstrapError("bootstrap_bundle_required_table_missing", "Schema bundle does not declare a required table", { role, table });
  const bundlePath = path.resolve(path.dirname(manifestPath), bundleFile);
  if (!fs.existsSync(bundlePath)) throw bootstrapError("bootstrap_bundle_file_missing", "Schema bundle file is missing", { role, file: bundleFile });
  const observed = crypto.createHash("sha256").update(fs.readFileSync(bundlePath)).digest("hex");
  if (observed !== String(roleConfig.sha256).toLowerCase()) throw bootstrapError("bootstrap_bundle_checksum_mismatch", "Schema bundle checksum does not match manifest", { role });
  const manifestSha256 = crypto.createHash("sha256").update(manifestBytes).digest("hex");
  return { manifest, manifest_sha256: manifestSha256, bundlePath, role: { ...roleConfig, file: bundleFile } };
}

export function validateSchemaBundleManifest(manifestPath, expectedSha, contract = readRuntimeBootstrapContract(), role = "runtime") {
  return readBundleManifest(manifestPath, expectedSha, contract, role);
}

async function applyRoleBundle(connection, database, manifestPath, expectedSha, contract, role, mutationEvidence, progressRegistry = null) {
  const bundle = readBundleManifest(manifestPath, expectedSha, contract, role);
  const sql = zlib.gunzipSync(fs.readFileSync(bundle.bundlePath)).toString("utf8");
  const statements = assertSqlArtifactSafe(sql, { allowData: false });
  const bundleBinding = buildRoleBundleBinding({
    role,
    bundleManifestSha256: bundle.manifest_sha256,
    roleBundleSha256: bundle.role.sha256,
    statementCount: statements.length,
    statementFingerprints: statements.map((statement) => sha256Hex(statement)),
  });
  let progress = createRoleBundleProgress({ role, bundleBinding });
  const saveProgress = () => {
    mutationEvidence.baseline.role_bundle_progress[role] = progress;
    if (progressRegistry) progressRegistry[role] = progress;
  };
  saveProgress();
  markMutationAttempt(mutationEvidence, "baseline");
  for (const [index, statement] of statements.entries()) {
    try {
      await connection.query(statement);
      progress = recordRoleBundleProgress(progress, { state: "executing", completedBoundary: index + 1, providerOutcome: "acknowledged" });
      saveProgress();
      mutationEvidence.baseline.operations_completed.push(`${role}:${index + 1}`);
    } catch (error) {
      progress = recordRoleBundleProgress(progress, { state: "partial_execution", completedBoundary: index, providerOutcome: "unknown", reconciliationRequired: true });
      saveProgress();
      mutationEvidence.baseline.failed_operation = `${role}:${index + 1}`;
      mutationEvidence.baseline.reconciliation_required = true;
      throw withMutationEvidence(bootstrapError("bootstrap_schema_bundle_mutation_failed", "Schema bundle application failed after mutation began", { role, operation_index: index + 1, role_bundle_binding: bundleBinding, role_bundle_progress: progress, reconciliation_required: true, automatic_rerun_allowed: false, mysql_code: error?.code || null }), mutationEvidence);
    }
  }
  progress = recordRoleBundleProgress(progress, { state: "completed", completedBoundary: statements.length, providerOutcome: "acknowledged" });
  saveProgress();
  markMutationComplete(mutationEvidence, "baseline");
  return { role, file: bundle.role.file, sha256: bundle.role.sha256, manifest_sha256: bundle.manifest_sha256, role_bundle_binding: bundleBinding, role_bundle_progress: progress, table_count: bundle.role.table_count || bundle.role.tables.length, statement_count: statements.length, status: "schema_bundle_applied" };
}

async function applyRuntimeBundle(connection, database, manifestPath, expectedSha, contract, mutationEvidence, progressRegistry = null) {
  return applyRoleBundle(connection, database, manifestPath, expectedSha, contract, "runtime", mutationEvidence, progressRegistry);
}

async function applyGovernanceBundle(connection, database, manifestPath, expectedSha, contract, mutationEvidence, progressRegistry = null) {
  return applyRoleBundle(connection, database, manifestPath, expectedSha, contract, "governance", mutationEvidence, progressRegistry);
}

async function applyRuntimePersistenceBundle(connection, database, manifestPath, expectedSha, contract, mutationEvidence, progressRegistry = null) {
  const applied = await applyRoleBundle(connection, database, manifestPath, expectedSha, contract, "runtime_persistence", mutationEvidence, progressRegistry);
  const recoveryMigration = contract.baseline_bundle.runtime_persistence_readback_migration;
  if (!contract.postconditions?.[recoveryMigration]) {
    throw bootstrapError("bootstrap_persistence_postcondition_contract_missing", "Runtime persistence has no repository-owned same-cycle readback contract");
  }
  const postconditions = await readIncidentPostconditions(connection, database, contract, recoveryMigration);
  if (!postconditions.ready) {
    throw bootstrapError("bootstrap_persistence_postcondition_failed", "Runtime persistence schema or required indexes are not ready after baseline application", { role: "runtime_persistence" });
  }
  return { ...applied, same_cycle_postconditions_ready: true, postcondition_migration: recoveryMigration };
}

async function applySeedFile(connection, repoRoot, entry, mutationEvidence) {
  const file = String(entry.file || "");
  const absolute = migrationFilePath(repoRoot, file);
  const sql = fs.readFileSync(absolute, "utf8");
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  if (checksum !== String(entry.sha256).toLowerCase()) throw bootstrapError("bootstrap_seed_checksum_mismatch", "Canonical empty-database seed checksum differs from contract", { file });
  const statements = assertSqlArtifactSafe(sql, { allowData: true });
  if (statements.length !== Number(entry.statement_count)) throw bootstrapError("bootstrap_seed_statement_count_mismatch", "Canonical empty-database seed statement count differs from contract", { file });
  markMutationAttempt(mutationEvidence, "baseline");
  for (const [index, statement] of statements.entries()) {
    try {
      await connection.query(statement);
      mutationEvidence.baseline.operations_completed.push(`${file}:${index + 1}`);
    } catch (error) {
      mutationEvidence.baseline.failed_operation = `${file}:${index + 1}`;
      throw withMutationEvidence(bootstrapError("bootstrap_seed_mutation_failed", "Seed application failed after mutation began", { file, operation_index: index + 1, mysql_code: error?.code || null }), mutationEvidence);
    }
  }
  return { file, sha256: checksum, statement_count: statements.length, status: "seed_applied" };
}

async function applyIncidentMigration(connection, repoRoot, migration, spec, database, mutationEvidence) {
  const absolute = migrationFilePath(repoRoot, migration);
  const sql = fs.readFileSync(absolute, "utf8");
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  if (checksum !== String(spec.sha256).toLowerCase()) throw bootstrapError("bootstrap_migration_checksum_mismatch", "Canonical migration checksum differs from contract", { migration });
  const statements = assertSqlArtifactSafe(sql, { allowData: true });
  if (statements.length !== Number(spec.statement_count)) throw bootstrapError("bootstrap_migration_statement_count_mismatch", "Canonical migration statement count differs from contract", { migration });
  for (const table of spec.requires_tables || []) if (!(await tableExists(connection, database, table))) throw bootstrapError("bootstrap_migration_prerequisite_missing", "Incident migration prerequisite table is missing", { migration, table });
  markMutationAttempt(mutationEvidence, "migration");
  mutationEvidence.migration.statement_count = statements.length;
  for (const [index, statement] of statements.entries()) {
    try {
      await connection.query(statement);
      mutationEvidence.migration.statements_completed += 1;
    } catch (error) {
      mutationEvidence.migration.failed_statement = index + 1;
      throw withMutationEvidence(bootstrapError("bootstrap_migration_mutation_failed", "Incident migration failed after mutation began", { migration, statement_index: index + 1, mysql_code: error?.code || null }), mutationEvidence);
    }
  }
  markMutationComplete(mutationEvidence, "migration");
  return { file: migration, sha256: checksum, statement_count: statements.length, status: "applied" };
}

async function readGrantRows(connection, target, database) {
  const grantee = `'${String(target.principal).replaceAll("'", "''")}'@'${String(target.principal_host).replaceAll("'", "''")}'`;
  const [userRows] = await connection.execute("SELECT PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = ?", [grantee]);
  const [schemaRows] = await connection.execute("SELECT TABLE_SCHEMA, PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = ? AND TABLE_SCHEMA = ?", [grantee, database]);
  const [tableRows] = await connection.execute("SELECT TABLE_SCHEMA, TABLE_NAME, PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = ? AND TABLE_SCHEMA = ?", [grantee, database]);
  return { userRows, schemaRows, tableRows };
}

export async function readGrantPostconditions(connection, target, database, contract, role = "runtime") {
  const roleTarget = role === "runtime" ? target : roleGrantTarget(target, role, contract);
  if (!roleTarget.principal || !roleTarget.principal_host) throw bootstrapError("bootstrap_grant_principal_missing", "Allowlisted target must declare principal and principal_host for grants", { role });
  const grants = role === "runtime" ? validateGrantPlan(roleTarget, contract) : validateRoleGrantPlan(roleTarget, role, contract).grants;
  const { userRows, schemaRows, tableRows } = await readGrantRows(connection, roleTarget, database);
  const requiredTables = new Set(grants.map((entry) => entry.table));
  const roleBindings = targetRoleIdentityBindings(target);
  const allowedIdentityTables = new Set();
  for (const candidateRole of BOOTSTRAP_ROLE_KEYS) {
    const candidateBinding = roleBindings?.[candidateRole];
    if (candidateBinding?.database === database && candidateBinding?.principal === roleTarget.principal && candidateBinding?.principal_host === roleTarget.principal_host) {
      for (const entry of (candidateRole === "runtime" ? validateGrantPlan(target, contract) : validateRoleGrantPlan(target, candidateRole, contract).grants)) allowedIdentityTables.add(entry.table);
    }
  }
  const tableEvidence = grants.map((grant) => {
    const expectedOps = new Set(grant.privileges.map((item) => String(item).toUpperCase()));
    const rows = tableRows.filter((row) => String(row.TABLE_NAME) === grant.table);
    const observed = new Set(rows.map((row) => String(row.PRIVILEGE_TYPE).toUpperCase()));
    return {
      table: grant.table,
      missing: [...expectedOps].filter((operation) => !observed.has(operation)),
      forbidden: [...observed].filter((operation) => !expectedOps.has(operation)),
      grant_option: rows.some((row) => String(row.IS_GRANTABLE || "NO").toUpperCase() === "YES"),
    };
  });
  const broadGlobal = userRows.filter((row) => BROAD_WRITE_PRIVILEGES.has(String(row.PRIVILEGE_TYPE).toUpperCase()));
  const broadSchema = schemaRows.filter((row) => BROAD_WRITE_PRIVILEGES.has(String(row.PRIVILEGE_TYPE).toUpperCase()));
  const outsideTableWrites = tableRows.filter((row) => {
    const table = String(row.TABLE_NAME || "");
    const privilege = String(row.PRIVILEGE_TYPE || "").toUpperCase();
    return !(allowedIdentityTables.size ? allowedIdentityTables.has(table) : requiredTables.has(table)) && BROAD_WRITE_PRIVILEGES.has(privilege);
  });
  const grantOptions = [...userRows, ...schemaRows, ...tableRows].filter((row) => String(row.IS_GRANTABLE || "NO").toUpperCase() === "YES");
  const ready = broadGlobal.length === 0 && broadSchema.length === 0 && outsideTableWrites.length === 0 && grantOptions.length === 0 && tableEvidence.every((entry) => entry.missing.length === 0 && entry.forbidden.length === 0 && !entry.grant_option);
  return {
    contract: "mad4b.hostinger.runtime-bootstrap-grant-readback.v1",
    ready,
    database,
    table_evidence: tableEvidence,
    broad_global_write_privilege_count: broadGlobal.length,
    broad_schema_write_privilege_count: broadSchema.length,
    outside_allowlist_table_write_count: outsideTableWrites.length,
    grant_option_count: grantOptions.length,
    secrets_included: false,
  };
}

async function applyGrants(connection, target, database, contract, mutationEvidence, role = "runtime") {
  const roleTarget = role === "runtime" ? target : roleGrantTarget(target, role, contract);
  const grants = role === "runtime" ? validateGrantPlan(roleTarget, contract) : validateRoleGrantPlan(roleTarget, role, contract).grants;
  if (!roleTarget.principal || !roleTarget.principal_host) throw bootstrapError("bootstrap_grant_principal_missing", "Allowlisted role target must declare principal and principal_host for grants", { role });
  const quoteLiteral = (value) => `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
  const account = `${quoteLiteral(roleTarget.principal)}@${quoteLiteral(roleTarget.principal_host)}`;
  const tableEvidence = await requiredTableEvidence(connection, database, grants.map((grant) => grant.table));
  const missing = tableEvidence.filter((entry) => !entry.present).map((entry) => entry.table);
  if (missing.length) throw bootstrapError("bootstrap_grant_table_missing", "All required role grant tables must exist before the first GRANT", { role, missing_tables: missing, preflight_complete: true });
  const applied = [];
  markMutationAttempt(mutationEvidence, "grants");
  mutationEvidence.grants.tables_total += grants.length;
  for (const grant of grants) {
    try {
      await connection.query(`GRANT ${grant.privileges.join(", ")} ON \`${database}\`.\`${grant.table}\` TO ${account}`);
      applied.push({ ...grant, role, database });
      mutationEvidence.grants.tables_completed.push(role === "runtime" ? grant.table : `${role}:${grant.table}`);
    } catch (error) {
      mutationEvidence.grants.failed_table = `${role}:${grant.table}`;
      throw withMutationEvidence(bootstrapError("bootstrap_grant_mutation_failed", "Bootstrap credential could not apply the least-privilege role grant after mutation began", { role, table: grant.table, mysql_code: error?.code || null }), mutationEvidence);
    }
  }
  markMutationComplete(mutationEvidence, "grants");
  return { role, database, principal_host_bound: true, applied, grant_mutation_performed: applied.length > 0, preflight_tables: tableEvidence };
}

async function insertLedgerRecord(connection, migration, checksum, statementCount, expectedSha, sqlApplied, mutationEvidence) {
  const runId = crypto.randomUUID();
  await connection.execute(
    `INSERT INTO governed_migration_ledger
      (run_id, migration_file, migration_checksum_sha256, applied_by, runner_version, mode,
       statement_count, preflight_status, preflight_risk_count, requirements_json, results_json,
       before_schema_objects_json, after_schema_objects_json, metadata_json, secrets_included)
     VALUES (?, ?, ?, ?, ?, 'apply', ?, 'pass', 0, ?, ?, ?, ?, ?, 0)`,
    [
      runId,
      migration,
      checksum,
      "hostinger_runtime_bootstrap",
      "hostinger-runtime-bootstrap-v1",
      statementCount,
      JSON.stringify({ source: "runtime_bootstrap_contract", exact_sha: expectedSha, secrets_included: false }),
      JSON.stringify({ canonical_postconditions_ready: true, sql_applied_by_this_run: sqlApplied, mutation_evidence: cloneMutationEvidence(mutationEvidence), evidence_mode: "apply_migration", secrets_included: false }),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify({ source: "explicit_release_hook_or_github", exact_production_sha: expectedSha, sql_applied_by_this_run: sqlApplied, mutation_evidence: cloneMutationEvidence(mutationEvidence), secrets_included: false }),
    ],
  );
  return { run_id: runId, mode: "apply_migration", recorded: true, sql_applied_by_this_run: sqlApplied };
}

export function buildPlan(env = process.env, contract = readRuntimeBootstrapContract()) {
  env = normalizeRuntimeEnvironmentInputs(env);
  const mode = normalizeMode(env.BOOTSTRAP_MODE || "plan");
  const source = validateSourceBinding(env, contract, mode);
  const result = {
    ok: true,
    contract: "mad4b.hostinger.runtime-bootstrap-plan.v1",
    mode,
    status: mode === "plan" ? "bootstrap_not_executed" : "preflight_required",
    source_binding: { repository: source.repository, branch: source.branch, expected_sha: source.sha, exact_sha_required: source.exact_sha_required },
    auto_apply: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    migration_apply_performed: false,
    grant_mutation_performed: false,
    startup_hook_required: true,
    normal_route_bypass: false,
    baseline_order_contract: BASELINE_ORDER_CONTRACT,
    baseline_order_proof: null,
    secrets_included: false,
  };
  if (mode === "plan") return result;
  const target = resolveBootstrapTarget(env, contract);
  const fullInspection = isFullInspectionDryRun(env, mode);
  const roleSelectiveRebuild = isRoleSelectiveRebuild(env, mode);
  const migrationSelection = fullInspection || roleSelectiveRebuild ? null : selectMigration(contract, env.BOOTSTRAP_MIGRATION, mode);
  const migration = migrationSelection?.file || null;
  const spec = migrationSelection?.spec || null;
  const requestedRebuildRoles = (fullInspection || roleSelectiveRebuild) ? normalizeRoleSelection(env.BOOTSTRAP_ROLE_SELECTION || env.HOST_BREAKGLASS_TARGET_ROLES) : null;
  const credentials = validateBootstrapCredentials(env, { requirePassword: false, target });
  const roleCredentials = preflightRoleBootstrapCredentials(env, target, { requirePassword: false });
  if (roleSelectiveRebuild) validateRoleRebuildConfirmation(env, source.sha, target, contract);
  else if (mode === "apply_migration") validateApplyConfirmation(env, source.sha, { ...target, migration }, contract, "migration");
  if (mode === "apply_grants") validateApplyConfirmation(env, source.sha, target, contract, "grants");
  const baselineOrderProof = mode === "apply_migration" && !roleSelectiveRebuild
    ? validateBaselineOrderProofFromEnvironment(env, { expectedSha: source.sha, targetKey: target.key })
    : null;
  const operation = roleSelectiveRebuild ? "database.rebuild_empty" : mode === "apply_migration" ? "migration" : mode === "apply_grants" ? "grants" : "read_only";
  return { ...result, status: "preflight_ready_for_explicit_invocation", target_key: target.key, database_binding_present: true, target_binding: describeTargetBinding(target, target.target_source || REPOSITORY_TARGET_SOURCE), migration, migration_selected: Boolean(migration), migration_selection: fullInspection || roleSelectiveRebuild ? "inspection_derived_role_selection" : "explicit", full_inspection: fullInspection, operation, migration_role: spec?.role || null, selected_rebuild_roles: requestedRebuildRoles, role_selection_source: (fullInspection || roleSelectiveRebuild) ? (requestedRebuildRoles ? "plan_bound_role_selection" : ROLE_SELECTION_FROM_INSPECTION) : null, role_selection_enum: BOOTSTRAP_ROLE_KEYS, credentials: { host_configured: credentials.host_configured, user_configured: credentials.user_configured, password_configured: Boolean(String(env.MYSQL_BOOTSTRAP_PASSWORD || "")), separate_from_runtime: credentials.separate_from_runtime, credential_source: credentials.credential_source, separate_from_target_principal: credentials.separate_from_target_principal, role_credentials: [...roleCredentials].map(([role, value]) => ({ role, credential_source: value.credential_source, user_configured: Boolean(value.user), password_configured: Boolean(value.password), host_configured: Boolean(value.host) })) }, baseline_order_contract: BASELINE_ORDER_CONTRACT, baseline_order_proof: baselineOrderProof, migration_catalog: fullInspection ? migrationCatalogEvidence(contract) : undefined, mutation_evidence: mutationEvidenceTemplate(migration, spec?.statement_count || 0, 0), secrets_included: false };
}

export async function runBootstrap({ env = process.env, contract = readRuntimeBootstrapContract(), repoRoot = path.resolve(HERE, ".."), connectionFactory, partialReceiptStore = null, executionTicketVerifier = null } = {}) {
  env = normalizeRuntimeEnvironmentInputs(env);
  const mode = normalizeMode(env.BOOTSTRAP_MODE || "plan");
  const roleSelectiveRebuildMode = isRoleSelectiveRebuild(env, mode);
  if (roleSelectiveRebuildMode && (!partialReceiptStore || typeof partialReceiptStore.putImmutablePartialRebuildReceipt !== "function")) {
    throw bootstrapError("bootstrap_partial_receipt_store_unavailable", "Selected-role baseline rebuild requires an injected immutable partial-rebuild receipt store; no database connection was opened.", { reconciliation_required: true, automatic_rerun_allowed: false });
  }
  if (isMutationMode(mode) && String(env.BOOTSTRAP_PARTIAL_REBUILD_RECEIPT_ID || "").trim()) {
    throw bootstrapError("bootstrap_partial_rebuild_resume_denied", "A prior partial rebuild receipt exists; automatic rerun is denied until an explicit reconciliation/resume authority is introduced.", { receipt_id_present: true, automatic_rerun_allowed: false, reconciliation_required: true });
  }
  const plan = buildPlan(env, contract);
  if (mode === "plan") return plan;
  if (isMutationMode(mode) && (!partialReceiptStore || typeof partialReceiptStore.putImmutablePartialRebuildReceipt !== "function")) {
    throw bootstrapError("bootstrap_partial_receipt_store_unavailable", "Every database mutation requires an injected immutable partial-mutation receipt store; no database connection was opened.", { reconciliation_required: true, automatic_rerun_allowed: false });
  }
  const target = resolveBootstrapTarget(env, contract);
  const source = validateSourceBinding(env, contract, mode);
  const localDeployment = validateLocalDeploymentEvidence(repoRoot, source, contract);
  const fullInspection = isFullInspectionDryRun(env, mode);
  const roleSelectiveRebuild = isRoleSelectiveRebuild(env, mode);
  const migrationSelection = fullInspection || roleSelectiveRebuild ? null : selectMigration(contract, env.BOOTSTRAP_MIGRATION, mode);
  const migration = migrationSelection?.file || null;
  const spec = migrationSelection?.spec || null;
  validateBootstrapCredentials(env, { requirePassword: true, target });
  const roleCredentials = preflightRoleBootstrapCredentials(env, target, { requirePassword: true });
  const rebuildBinding = roleSelectiveRebuild ? validateRoleRebuildConfirmation(env, source.sha, target, contract) : null;
  if (!roleSelectiveRebuild && mode === "apply_migration") validateApplyConfirmation(env, source.sha, { ...target, migration }, contract, "migration");
  if (mode === "apply_grants") validateApplyConfirmation(env, source.sha, target, contract, "grants");
  const executionTicket = await verifyBootstrapExecutionAuthority({ env, mode, target, source, operation: roleSelectiveRebuild ? "database.rebuild_empty" : mode === "apply_migration" ? "migration" : "grants", roleSelectionHash: rebuildBinding?.selection_hash || null, grantBindingHash: mode === "apply_grants" ? computeGrantBindingHash(target, contract) : null, executionTicketVerifier });
  const mutationEvidence = mutationEvidenceTemplate(migration, spec?.statement_count || 0, 0);
  const createConnection = connectionFactory || (async ({ credentials }) => {
    const { createConnection: connect } = await import("mysql2/promise");
    return connect({
      host: credentials.host,
      port: credentials.port,
      user: credentials.user,
      password: credentials.password,
      database: credentials.database,
      multipleStatements: true,
      connectTimeout: 15000,
    });
  });
  let connection;
  let governanceConnection;
  let persistenceConnection;
  let ledgerConnection;
  try {
    connection = await createConnection({ target, env, mode, role: "runtime", database: target.database, credentials: roleCredentials.get("runtime") });
    const exists = await databaseExists(connection, target.database);
    if (!exists) throw bootstrapError("bootstrap_database_missing", "Target database does not exist; database creation is intentionally outside this contract", { target_key: target.key, role: "runtime" });
    await connection.query(`USE \`${target.database}\``);
    const governanceDatabase = target.governance_database || target.database;
    if (governanceDatabase === target.database) {
      ledgerConnection = connection;
    } else {
      governanceConnection = await createConnection({ target, env, mode, role: "governance", database: governanceDatabase, credentials: roleCredentials.get("governance") });
      const governanceExists = await databaseExists(governanceConnection, governanceDatabase);
      if (!governanceExists) throw bootstrapError("bootstrap_database_missing", "Governance database does not exist; database creation is intentionally outside this contract", { target_key: target.key, role: "governance" });
      await governanceConnection.query(`USE \`${governanceDatabase}\``);
      ledgerConnection = governanceConnection;
    }
    const persistenceDatabase = target.runtime_persistence_database || target.database;
    let persistenceExecutor = connection;
    if (persistenceDatabase === governanceDatabase) {
      persistenceExecutor = ledgerConnection;
    } else if (persistenceDatabase !== target.database) {
      persistenceConnection = await createConnection({ target, env, mode, role: "runtime_persistence", database: persistenceDatabase, credentials: roleCredentials.get("runtime_persistence") });
      const persistenceExists = await databaseExists(persistenceConnection, persistenceDatabase);
      if (!persistenceExists) throw bootstrapError("bootstrap_database_missing", "Runtime persistence database does not exist; database creation is intentionally outside this contract", { target_key: target.key, role: "runtime_persistence" });
      await persistenceConnection.query(`USE \`${persistenceDatabase}\``);
      persistenceExecutor = persistenceConnection;
    }
    const beforeTableCount = await tableCount(connection, target.database);
    const databaseClassification = classifyDatabaseTableCount(beforeTableCount);
    const roleDatabaseObjectCounts = {
      runtime: await databaseObjectCounts(connection, target.database),
      governance: governanceDatabase === target.database ? null : await databaseObjectCounts(ledgerConnection, governanceDatabase),
      runtime_persistence: persistenceDatabase === target.database ? null : await databaseObjectCounts(persistenceExecutor, persistenceDatabase),
    };
    if (roleDatabaseObjectCounts.governance === null) roleDatabaseObjectCounts.governance = roleDatabaseObjectCounts.runtime;
    if (roleDatabaseObjectCounts.runtime_persistence === null) roleDatabaseObjectCounts.runtime_persistence = roleDatabaseObjectCounts.runtime;
    const databaseObjectClassification = classifyDatabaseObjectCount(roleDatabaseObjectCounts.runtime);
    const roleDatabaseObjectClassifications = Object.fromEntries(Object.entries(roleDatabaseObjectCounts).map(([role, counts]) => [role, classifyDatabaseObjectCount(counts)]));
    const hostBreakglassOperation = String(env.HOST_BREAKGLASS_OPERATION || "").trim();
    const rebuildSelection = ["database.inspect", "database.rebuild_empty"].includes(hostBreakglassOperation)
      ? resolveEmptyRebuildRoles(env, roleDatabaseObjectClassifications, { allowNone: fullInspection })
      : null;
    const selectedRebuildRoles = rebuildSelection?.roles || [];
    if (mode === "apply_migration" && databaseObjectClassification === "zero_objects" && !roleSelectiveRebuild) {
      throw bootstrapError("bootstrap_empty_requires_rebuild_operation", "An empty database must enter through database.rebuild_empty; standalone migration apply is denied before the reconstruction chain.", { object_counts: roleDatabaseObjectCounts.runtime });
    }
    const roleDatabaseTableCounts = {
      runtime: beforeTableCount,
      governance: governanceDatabase === target.database ? beforeTableCount : await tableCount(ledgerConnection, governanceDatabase),
      runtime_persistence: persistenceDatabase === target.database ? beforeTableCount : await tableCount(persistenceExecutor, persistenceDatabase),
    };
    const roleTableEvidence = {
      runtime: await requiredTableEvidence(connection, target.database, roleBaselineTables(contract, "runtime")),
      governance: await requiredTableEvidence(ledgerConnection, governanceDatabase, roleBaselineTables(contract, "governance")),
      runtime_persistence: await requiredTableEvidence(persistenceExecutor, persistenceDatabase, roleBaselineTables(contract, "runtime_persistence")),
    };
    const required = fullInspection ? [] : (spec?.requires_tables || []);
    const requiredEvidence = fullInspection ? roleTableEvidence.runtime : await requiredTableEvidence(connection, target.database, required);
    if (!fullInspection && requiredEvidence.some((entry) => !entry.present) && databaseObjectClassification !== "zero_objects") {
      throw bootstrapError("bootstrap_migration_prerequisite_missing", "Incident migration prerequisites are missing from a non-empty database", { migration, missing_tables: requiredEvidence.filter((entry) => !entry.present).map((entry) => entry.table), table_count: beforeTableCount });
    }
    let ledger = fullInspection
      ? await readLedgerInspection(ledgerConnection, governanceDatabase)
      : roleSelectiveRebuild || databaseObjectClassification === "zero_objects"
        ? { found: false, run_id: null, applied_at: null, deferred_until_baseline: true }
        : await readLedgerApplyRecord(ledgerConnection, governanceDatabase, migration, spec.sha256);
    const postconditionsBefore = fullInspection || roleSelectiveRebuild || databaseObjectClassification === "zero_objects"
      ? null
      : await readIncidentPostconditions(connection, target.database, contract, migration);
    const grantRoles = resolveGrantRoles(target, contract);
    const grantRoleConnections = {
      runtime: { connection, database: target.database },
      governance: { connection: ledgerConnection, database: governanceDatabase },
      runtime_persistence: { connection: persistenceExecutor, database: persistenceDatabase },
    };
    const grantReadbackByRole = Object.fromEntries(await Promise.all(grantRoles.map(async (role) => {
      const binding = grantRoleConnections[role];
      return [role, await readGrantPostconditions(binding.connection, target, binding.database, contract, role)];
    })));
    const grantReadbackBefore = grantReadbackByRole.runtime;
    const behavioralProbes = declaredBehavioralProbeEvidence(contract);
    if (mode === "dry_run") {
      return {
        ...plan,
        source_binding: { ...plan.source_binding, local_deployment_manifest: localDeployment },
        status: "dry_run_complete",
        operation: "read_only",
        target_key: target.key,
        database_table_count: beforeTableCount,
        database_classification: databaseClassification,
        role_database_table_counts: roleDatabaseTableCounts,
        role_database_classifications: Object.fromEntries(Object.entries(roleDatabaseTableCounts).map(([role, count]) => [role, classifyDatabaseTableCount(count)])),
        database_object_counts: roleDatabaseObjectCounts.runtime,
        database_object_classification: databaseObjectClassification,
        role_database_object_counts: roleDatabaseObjectCounts,
        role_database_object_classifications: roleDatabaseObjectClassifications,
        role_database_object_count_fingerprints: Object.fromEntries(Object.entries(roleDatabaseObjectCounts).map(([role, counts]) => [role, objectCountsFingerprint(counts)])),
        selected_rebuild_roles: selectedRebuildRoles,
        role_selection_source: rebuildSelection?.source || null,
        runtime_role_touched: false,
        behavioral_probes: behavioralProbes,
        required_table_evidence: requiredEvidence,
        role_table_evidence: roleTableEvidence,
        ledger,
        postconditions: postconditionsBefore,
        grant_readback: grantReadbackBefore,
        grant_readback_by_role: grantReadbackByRole,
        grant_binding_hash: computeGrantBindingHash(target, contract),
        migration_catalog: fullInspection ? migrationCatalogEvidence(contract) : undefined,
        migration_selected: Boolean(migration),
        migration_selection: fullInspection ? "inspection_derived_role_selection" : "explicit",
        mutation_evidence: cloneMutationEvidence(mutationEvidence),
        database_connection_performed: true,
        secrets_included: false,
      };
    }
    if (mode === "apply_grants") {
      if (databaseObjectClassification === "zero_objects") throw bootstrapError("bootstrap_grants_zero_table_denied", "Grant apply requires an existing non-empty schema; baseline is a separate operation");
      if (contract.execution_policy.apply_grants_requires_migration_ready && (!ledger.found || !postconditionsBefore?.ready)) {
        throw bootstrapError("bootstrap_grants_requires_migration_ready", "Grant apply requires a matching migration ledger record and ready migration postconditions", { migration, ledger_found: ledger.found, postconditions_ready: Boolean(postconditionsBefore?.ready) });
      }
      const grantPreflightByRole = Object.fromEntries(await Promise.all(grantRoles.map(async (role) => {
        const binding = grantRoleConnections[role];
        const rolePlan = role === "runtime" ? { grants: validateGrantPlan(target, contract) } : validateRoleGrantPlan(target, role, contract);
        const evidence = await requiredTableEvidence(binding.connection, binding.database, rolePlan.grants.map((grant) => grant.table));
        const missing = evidence.filter((entry) => !entry.present).map((entry) => entry.table);
        if (missing.length) throw bootstrapError("bootstrap_grant_table_missing", "All role grant tables must exist before the first GRANT", { role, missing_tables: missing, preflight_complete: true });
        return [role, { database: binding.database, table_evidence: evidence }];
      })));
      const grantsByRole = {};
      for (const role of grantRoles) {
        const binding = grantRoleConnections[role];
        grantsByRole[role] = await applyGrants(binding.connection, target, binding.database, contract, mutationEvidence, role);
      }
      const grantReadbackByRoleAfter = Object.fromEntries(await Promise.all(grantRoles.map(async (role) => {
        const binding = grantRoleConnections[role];
        return [role, await readGrantPostconditions(binding.connection, target, binding.database, contract, role)];
      })));
      const grantReadback = grantReadbackByRoleAfter.runtime;
      if (Object.values(grantReadbackByRoleAfter).some((entry) => !entry.ready)) throw bootstrapError("bootstrap_grant_readback_failed", "Same-cycle role grant readback is not ready", { roles: Object.entries(grantReadbackByRoleAfter).filter(([, entry]) => !entry.ready).map(([role]) => role) });
      return {
        ...plan,
        source_binding: { ...plan.source_binding, local_deployment_manifest: localDeployment },
        status: "apply_grants_complete",
        operation: "grants",
        target_key: target.key,
        database_table_count_before: beforeTableCount,
        database_classification: databaseClassification,
        database_object_counts_before: roleDatabaseObjectCounts,
        database_object_classifications_before: roleDatabaseObjectClassifications,
        ledger,
        postconditions: postconditionsBefore,
        grant_readback_before: grantReadbackBefore,
        grants: { by_role: grantsByRole, preflight_by_role: grantPreflightByRole, grant_readback: grantReadback, grant_readback_by_role: grantReadbackByRoleAfter, binding_hash: computeGrantBindingHash(target, contract) },
        mutation_evidence: cloneMutationEvidence(mutationEvidence),
        database_connection_performed: true,
        database_mutation_performed: true,
        migration_apply_performed: false,
        grant_mutation_performed: true,
        secrets_included: false,
      };
    }
    const migrationResults = [];
    const roleRebuildResults = [];
    let roleRebuildEvidence = null;
    if (roleSelectiveRebuild) {
      let manifestPath = null;
      const roleConnections = roleConnectionBindings({ connection, ledgerConnection, persistenceExecutor, target, governanceDatabase, persistenceDatabase });
      const roleBundleProgress = {};
      const roleFingerprintsBefore = Object.fromEntries(Object.entries(roleDatabaseObjectCounts).map(([role, counts]) => [role, objectCountsFingerprint(counts)]));
      roleRebuildEvidence = {
        contract: "mad4b.role-selective-baseline-rebuild.v1",
        expected_sha: source.sha,
        target_key: target.key,
        selected_roles: selectedRebuildRoles,
        selection_source: rebuildSelection?.source || ROLE_SELECTION_FROM_INSPECTION,
        inspection_run_id: rebuildBinding?.inspection_run_id || null,
        role_object_count_fingerprints_from_inspection: rebuildBinding?.role_object_count_fingerprints || {},
        role_object_count_fingerprints_before: roleFingerprintsBefore,
        role_database_object_classifications_before: roleDatabaseObjectClassifications,
        sequential: true,
        runtime_role_touched: selectedRebuildRoles.includes("runtime"),
        durable_recovery_store_required: true,
        provider_accessed: false,
        secrets_included: false,
      };
      roleRebuildEvidence.evidence_hash = sha256Hex(JSON.stringify(roleRebuildEvidence));
      for (const role of selectedRebuildRoles) {
        if (rebuildBinding && rebuildBinding.role_object_count_fingerprints[role] !== roleFingerprintsBefore[role]) {
          throw bootstrapError("bootstrap_role_rebuild_inspection_fingerprint_mismatch", "Observed role object-count evidence does not match the durable inspection proof; rebuild is stale and fail-closed.", { role, selected_roles: selectedRebuildRoles });
        }
        const binding = roleConnections[role];
        const beforeRoleCounts = await databaseObjectCounts(binding.connection, binding.database);
        const beforeRoleFingerprint = objectCountsFingerprint(beforeRoleCounts);
        if (classifyDatabaseObjectCount(beforeRoleCounts) !== "zero_objects" || beforeRoleFingerprint !== roleFingerprintsBefore[role]) {
          throw bootstrapError("bootstrap_role_rebuild_stale_zero_object_proof", "Selected role changed after inspection; baseline reconstruction is denied and the next role will not be attempted.", { role, expected_object_count_fingerprint: roleFingerprintsBefore[role], observed_object_count_fingerprint: beforeRoleFingerprint, observed_classification: classifyDatabaseObjectCount(beforeRoleCounts), selected_roles: selectedRebuildRoles });
        }
        manifestPath ||= resolveBundleManifestPath(repoRoot, env.BOOTSTRAP_SCHEMA_BUNDLE_MANIFEST, contract);
        const bundle = readBundleManifest(manifestPath, source.sha, contract, role);
        const bundleSql = zlib.gunzipSync(fs.readFileSync(bundle.bundlePath)).toString("utf8");
        const ddlPreflight = await assertDdlPrivilegePreflight(binding.connection, binding.database, bundleSql, bundle.role.tables, { kind: "baseline_bundle", role });
        mutationEvidence.ddl_privilege_preflight.push(ddlPreflight);
        const applied = role === "runtime"
          ? await applyRuntimeBundle(binding.connection, binding.database, manifestPath, source.sha, contract, mutationEvidence, roleBundleProgress)
          : role === "governance"
            ? await applyGovernanceBundle(binding.connection, binding.database, manifestPath, source.sha, contract, mutationEvidence, roleBundleProgress)
            : await applyRuntimePersistenceBundle(binding.connection, binding.database, manifestPath, source.sha, contract, mutationEvidence, roleBundleProgress);
        const seeds = [];
        for (const seed of roleSeedEntries(contract, role)) seeds.push(await applySeedFile(binding.connection, repoRoot, seed, mutationEvidence));
        const afterRoleCounts = await databaseObjectCounts(binding.connection, binding.database);
        const afterRoleClassification = classifyDatabaseObjectCount(afterRoleCounts);
        const afterTables = await requiredTableEvidence(binding.connection, binding.database, roleBaselineTables(contract, role));
        if (afterRoleClassification === "zero_objects" || afterTables.some((entry) => !entry.present)) {
          if (roleBundleProgress[role]) {
            roleBundleProgress[role] = recordRoleBundleProgress(roleBundleProgress[role], { state: "reconciliation_required", completedBoundary: roleBundleProgress[role].last_completed_boundary, providerOutcome: "acknowledged", reconciliationRequired: true, objectFingerprintAfterFailure: objectCountsFingerprint(afterRoleCounts) });
            mutationEvidence.baseline.role_bundle_progress[role] = roleBundleProgress[role];
            mutationEvidence.baseline.reconciliation_required = true;
          }
          throw bootstrapError("bootstrap_role_rebuild_verification_failed", "A selected role did not pass same-cycle object and required-table verification; sequential reconstruction stopped before the next role.", { role, after_classification: afterRoleClassification, required_table_verification_passed: afterTables.every((entry) => entry.present), role_bundle_progress: roleBundleProgress[role] || null, reconciliation_required: true, automatic_rerun_allowed: false, selected_roles: selectedRebuildRoles });
        }
        if (roleBundleProgress[role]) {
          roleBundleProgress[role] = recordRoleBundleProgress(roleBundleProgress[role], { state: "verified", completedBoundary: roleBundleProgress[role].statement_count, providerOutcome: "verified" });
          mutationEvidence.baseline.role_bundle_progress[role] = roleBundleProgress[role];
        }
        const roleResult = { role, before_object_count_fingerprint: beforeRoleFingerprint, after_object_counts: afterRoleCounts, after_object_classification: afterRoleClassification, required_table_evidence: afterTables, bundle: applied, role_bundle_binding: applied.role_bundle_binding || null, role_bundle_progress: roleBundleProgress[role] || applied.role_bundle_progress || null, seeds, verification: { object_count_nonzero: afterRoleClassification !== "zero_objects", required_tables_present: afterTables.every((entry) => entry.present), provider_accessed: false, secrets_included: false } };
        roleRebuildResults.push(roleResult);
        migrationResults.push(roleResult);
      }
      markMutationComplete(mutationEvidence, "baseline");
      roleRebuildEvidence.roles_completed = roleRebuildResults.map((item) => item.role);
      roleRebuildEvidence.role_bundle_progress = Object.fromEntries(Object.entries(roleBundleProgress).map(([role, progress]) => [role, progress]));
      roleRebuildEvidence.verification = roleRebuildResults.map((item) => item.verification);
      roleRebuildEvidence.evidence_hash = sha256Hex(JSON.stringify(roleRebuildEvidence));
      return {
        ...plan,
        source_binding: { ...plan.source_binding, local_deployment_manifest: localDeployment },
        status: "baseline_rebuild_complete",
        operation: "database.rebuild_empty",
        target_key: target.key,
        database_table_count_before: beforeTableCount,
        database_classification: databaseClassification,
        database_object_counts_before: roleDatabaseObjectCounts,
        database_object_classifications_before: roleDatabaseObjectClassifications,
        selected_rebuild_roles: selectedRebuildRoles,
        role_selection_source: rebuildSelection?.source || ROLE_SELECTION_FROM_INSPECTION,
        role_rebuild_evidence: roleRebuildEvidence,
        role_rebuild_results: roleRebuildResults,
        behavioral_probes: behavioralProbes,
        ledger,
        postconditions: { ready: true, contract: "role_baseline_required_tables.v1", roles: roleRebuildResults.map((item) => ({ role: item.role, required_tables_ready: item.verification.required_tables_present })) },
        grant_readback: grantReadbackBefore,
        mutation_evidence: cloneMutationEvidence(mutationEvidence),
        database_connection_performed: true,
        database_mutation_performed: mutationEvidence.mutation_attempted,
        migration_apply_performed: false,
        grant_mutation_performed: false,
        secrets_included: false,
      };
    }
    const postconditionsAfterBaseline = postconditionsBefore;
    if (ledger.found && !postconditionsAfterBaseline?.ready) {
      throw bootstrapError("bootstrap_ledger_schema_divergence", "Ledger says migration is applied but declared postconditions are not ready", { migration, run_id: ledger.run_id || null });
    }
    let sqlApplied = false;
    if (!ledger.found) {
      const migrationSql = fs.readFileSync(migrationFilePath(repoRoot, migration), "utf8");
      const ddlPreflight = await assertDdlPrivilegePreflight(connection, target.database, migrationSql, spec.requires_tables || [], { kind: "incident_migration", migration });
      mutationEvidence.ddl_privilege_preflight.push(ddlPreflight);
      mutationEvidence.migration.statement_count = spec.statement_count;
      migrationResults.push(await applyIncidentMigration(connection, repoRoot, migration, spec, target.database, mutationEvidence));
      sqlApplied = true;
      const postconditionsAfter = await readIncidentPostconditions(connection, target.database, contract, migration);
      if (!postconditionsAfter.ready) throw bootstrapError("bootstrap_postcondition_failed", "Migration completed but postconditions are not ready", { migration });
      mutationEvidence.migration.ledger_record_attempted = true;
      try {
        migrationResults.push(await insertLedgerRecord(ledgerConnection, migration, spec.sha256, spec.statement_count, source.sha, true, mutationEvidence));
      } catch (error) {
        mutationEvidence.migration.ledger_record_state = "partial_possible";
        mutationEvidence.mutation_state = "partial_possible";
        throw withMutationEvidence(bootstrapError("bootstrap_ledger_record_failed_after_migration", "Migration completed but canonical ledger recording failed; database state is partial_possible", { migration, mysql_code: error?.code || null }), mutationEvidence);
      }
      mutationEvidence.migration.ledger_recorded = true;
      ledger = await readLedgerApplyRecord(ledgerConnection, target.governance_database || target.database, migration, spec.sha256);
      if (!ledger.found) {
        mutationEvidence.migration.ledger_record_state = "partial_possible";
        mutationEvidence.mutation_state = "partial_possible";
        throw withMutationEvidence(bootstrapError("bootstrap_ledger_readback_failed", "Migration ledger record was not visible in the same cycle", { migration }), mutationEvidence);
      }
    }
    if (databaseObjectClassification === "zero_objects") {
      for (const seed of contract.baseline_bundle.required_seed_files) {
        migrationResults.push(await applySeedFile(connection, repoRoot, seed, mutationEvidence));
      }
    }
    if (mutationEvidence.migration.attempted || mutationEvidence.baseline.attempted) markMutationComplete(mutationEvidence, "migration");
    const postconditions = await readIncidentPostconditions(connection, target.database, contract, migration);
    if (!postconditions.ready) throw bootstrapError("bootstrap_postcondition_failed", "Migration readback is not ready after operation", { migration });
    return {
      ...plan,
      source_binding: { ...plan.source_binding, local_deployment_manifest: localDeployment },
      status: "apply_migration_complete",
      operation: "migration",
      target_key: target.key,
      database_table_count_before: beforeTableCount,
      database_classification: databaseClassification,
      database_object_counts_before: roleDatabaseObjectCounts,
      database_object_classifications_before: roleDatabaseObjectClassifications,
      behavioral_probes: behavioralProbes,
      migration_results: migrationResults,
      ledger,
      postconditions,
      grant_readback: grantReadbackBefore,
      mutation_evidence: cloneMutationEvidence(mutationEvidence),
      database_connection_performed: true,
      database_mutation_performed: mutationEvidence.mutation_attempted,
      migration_apply_performed: sqlApplied || mutationEvidence.baseline.attempted,
      grant_mutation_performed: false,
      secrets_included: false,
    };
  } catch (error) {
    const partial = mutationEvidence.mutation_state === "partial_possible";
    const partialReceipt = partial ? {
      contract: "mad4b.hostinger.partial-rebuild-receipt.v1",
      receipt_id: `partial:${sha256Hex(JSON.stringify({ expected_sha: source.sha, target_key: target.key, target_fingerprint: target.target_fingerprint, plan_hash: env.BOOTSTRAP_PLAN_SHA256 || null, execution_ticket_id: env.BOOTSTRAP_EXECUTION_TICKET_ID || null, mutation_evidence: mutationEvidence })).slice(0, 32)}`,
      status: "reconciliation_required",
      automatic_rerun_allowed: false,
      reconciliation_required: true,
      expected_sha: source.sha,
      target_key: target.key,
      target_fingerprint: target.target_fingerprint,
      plan_hash: String(env.BOOTSTRAP_PLAN_SHA256 || "").trim().toLowerCase() || null,
      execution_ticket_id: executionTicket?.ticket_id || String(env.BOOTSTRAP_EXECUTION_TICKET_ID || "").trim() || null,
      execution_ticket_hash: executionTicket?.ticket_hash || String(env.BOOTSTRAP_EXECUTION_TICKET_HASH || "").trim().toLowerCase() || null,
      bundle_manifest_reference: String(env.BOOTSTRAP_SCHEMA_BUNDLE_MANIFEST || "").trim() || null,
      mutation_evidence: cloneMutationEvidence(mutationEvidence),
      secrets_included: false,
    } : null;
    let partialReceiptPersisted = false;
    if (partial && partialReceiptStore && typeof partialReceiptStore.putImmutablePartialRebuildReceipt === "function") {
      try {
        await partialReceiptStore.putImmutablePartialRebuildReceipt(partialReceipt);
        partialReceiptPersisted = true;
      } catch (receiptError) {
        error.details = {
          ...(error.details && typeof error.details === "object" ? error.details : {}),
          partial_receipt_persistence_error: String(receiptError?.code || "partial_receipt_store_failed").slice(0, 120),
        };
      }
    }
    error.details = {
      ...(error.details && typeof error.details === "object" ? error.details : {}),
      database_connection_performed: Boolean(connection || governanceConnection || persistenceConnection),
      database_mutation_performed: partial ? "unknown" : mutationEvidence.mutation_attempted,
      migration_apply_performed: mutationEvidence.migration.attempted ? (mutationEvidence.migration.state === "complete" ? true : "unknown") : false,
      grant_mutation_performed: mutationEvidence.grants.attempted ? (mutationEvidence.grants.state === "complete" ? true : "unknown") : false,
      mutation_evidence: cloneMutationEvidence(mutationEvidence),
      partial_rebuild_receipt: partialReceipt,
      partial_receipt_persisted: partialReceiptPersisted,
      reconciliation_required: partial,
      automatic_rerun_allowed: partial ? false : undefined,
    };
    throw error;
  } finally {
    if (persistenceConnection) await persistenceConnection.end().catch(() => {});
    if (governanceConnection) await governanceConnection.end().catch(() => {});
    if (connection) await connection.end().catch(() => {});
  }
}

export { DEFAULT_CONTRACT_PATH };
