import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { splitMigrationSqlStatements } from "./migrationSqlStatements.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTRACT_PATH = path.join(HERE, "config", "runtime-bootstrap-contract.json");
const SHA_RE = /^[0-9a-f]{40}$/iu;
const SHA256_RE = /^[0-9a-f]{64}$/iu;
const DATABASE_RE = /^[A-Za-z0-9_$-]+$/u;
const IDENTIFIER_RE = /^[A-Za-z0-9_$.-]+$/u;
const ACCOUNT_HOST_RE = /^[A-Za-z0-9_$%.:-]+$/u;
const SAFE_GRANT_PRIVILEGES = new Set(["SELECT", "INSERT", "UPDATE"]);
const LEDGER_COLUMNS = [
  "run_id", "migration_file", "migration_checksum_sha256", "applied_at", "applied_by", "runner_version",
  "mode", "statement_count", "preflight_status", "preflight_risk_count", "requirements_json", "results_json",
  "before_schema_objects_json", "after_schema_objects_json", "metadata_json", "secrets_included",
];
const BROAD_WRITE_PRIVILEGES = new Set([
  "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "INDEX", "TRIGGER", "REFERENCES",
  "EXECUTE", "EVENT", "CREATE ROUTINE", "ALTER ROUTINE", "CREATE VIEW", "CREATE TEMPORARY TABLES", "LOCK TABLES",
]);

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

export function normalizeMode(value) {
  const mode = String(value || "plan").trim().toLowerCase();
  if (!["plan", "dry_run", "apply"].includes(mode)) {
    throw bootstrapError("bootstrap_mode_invalid", "Bootstrap mode must be plan, dry_run, or apply", { mode });
  }
  return mode;
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
  return targets.map((target) => {
    const key = assertIdentifier(target?.key, "target.key");
    const database = assertDatabase(target?.database, "target.database");
    const repository = requireString(target?.repository, "bootstrap_target_repository_missing", "target.repository");
    const branch = requireString(target?.branch, "bootstrap_target_branch_missing", "target.branch");
    const environment = requireString(target?.environment, "bootstrap_target_environment_missing", "target.environment").toLowerCase();
    if (repository !== requiredRepository || branch !== requiredBranch || environment !== "production") {
      throw bootstrapError("bootstrap_target_scope_denied", "Target is outside the production bootstrap contract", { key, environment, branch });
    }
    const databaseSha = requireSha256(target?.database_sha256, "target.database_sha256");
    if (databaseSha !== sha256Hex(database)) {
      throw bootstrapError("bootstrap_target_database_fingerprint_mismatch", "Target database SHA does not match its database identifier", { key });
    }
    const fingerprint = requireSha256(target?.target_fingerprint, "target.target_fingerprint");
    const expectedFingerprint = sha256Hex(`${repository}:${branch}:${key}:${database}`);
    if (fingerprint !== expectedFingerprint) {
      throw bootstrapError("bootstrap_target_fingerprint_mismatch", "Target fingerprint does not match repository, branch, key, and database", { key });
    }
    const governanceDatabase = target.governance_database === undefined || String(target.governance_database).trim() === ""
      ? null
      : assertDatabase(target.governance_database, "target.governance_database");
    if (governanceDatabase) {
      const governanceSha = requireSha256(target.governance_database_sha256, "target.governance_database_sha256");
      if (governanceSha !== sha256Hex(governanceDatabase)) throw bootstrapError("bootstrap_governance_database_fingerprint_mismatch", "Governance database SHA does not match its database identifier", { key });
    }
    if (target.principal !== undefined) assertIdentifier(target.principal, "target.principal");
    if (target.principal_host !== undefined) assertAccountHost(target.principal_host, "target.principal_host");
    return { ...target, key, database, governance_database: governanceDatabase, repository, branch, environment };
  });
}

export function resolveBootstrapTarget(env, contract) {
  const key = requireString(env.BOOTSTRAP_TARGET_KEY, "bootstrap_target_key_missing", "BOOTSTRAP_TARGET_KEY");
  const requestedDatabase = requireString(env.BOOTSTRAP_TARGET_DATABASE, "bootstrap_target_database_missing", "BOOTSTRAP_TARGET_DATABASE");
  const targets = parseTargetAllowlist(env, contract);
  const target = targets.find((candidate) => candidate.key === key);
  if (!target) throw bootstrapError("bootstrap_target_not_allowlisted", "BOOTSTRAP_TARGET_KEY is not present in the repository-owned target allowlist", { key });
  if (target.database !== requestedDatabase) {
    throw bootstrapError("bootstrap_target_database_mismatch", "BOOTSTRAP_TARGET_DATABASE does not match the allowlisted target", { key });
  }
  const bootstrapDatabase = requireString(env.MYSQL_BOOTSTRAP_DATABASE, "bootstrap_connection_database_missing", "MYSQL_BOOTSTRAP_DATABASE");
  if (bootstrapDatabase !== target.database) {
    throw bootstrapError("bootstrap_connection_database_mismatch", "MYSQL_BOOTSTRAP_DATABASE does not match the allowlisted target", { key });
  }
  if (!target.governance_database && String(env.BOOTSTRAP_GOVERNANCE_DATABASE || "").trim()) {
    throw bootstrapError("bootstrap_governance_database_not_allowlisted", "A separate governance database must be explicitly allowlisted in the target entry", { key });
  }
  const governanceDatabase = String(target.governance_database || target.database).trim();
  if (target.governance_database && governanceDatabase !== String(env.BOOTSTRAP_GOVERNANCE_DATABASE || target.governance_database).trim()) {
    throw bootstrapError("bootstrap_governance_database_mismatch", "BOOTSTRAP_GOVERNANCE_DATABASE does not match the allowlisted target", { key });
  }
  return { ...target, governance_database: governanceDatabase };
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

export function validateBootstrapCredentials(env, { requirePassword = true } = {}) {
  const required = ["MYSQL_BOOTSTRAP_HOST", "MYSQL_BOOTSTRAP_USER"];
  if (requirePassword) required.push("MYSQL_BOOTSTRAP_PASSWORD");
  const missing = required.filter((key) => !String(env[key] ?? "").trim());
  if (missing.length) throw bootstrapError("bootstrap_credentials_missing", "Dedicated MYSQL_BOOTSTRAP credentials are incomplete", { missing });
  const runtimeUser = String(env.DB_USER || "").trim();
  const runtimePassword = String(env.DB_PASSWORD || "");
  if (runtimeUser && String(env.MYSQL_BOOTSTRAP_USER).trim() === runtimeUser) {
    throw bootstrapError("bootstrap_credential_reuse_denied", "MYSQL_BOOTSTRAP_USER must be separate from DB_USER");
  }
  if (runtimePassword && String(env.MYSQL_BOOTSTRAP_PASSWORD) === runtimePassword) {
    throw bootstrapError("bootstrap_credential_reuse_denied", "MYSQL_BOOTSTRAP_PASSWORD must be separate from DB_PASSWORD");
  }
  const port = Number(env.MYSQL_BOOTSTRAP_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw bootstrapError("bootstrap_port_invalid", "MYSQL_BOOTSTRAP_PORT is invalid");
  return { host_configured: true, user_configured: true, password_configured: requirePassword, port };
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

export function validateApplyConfirmation(env, sha, targetKey, contract) {
  const confirmation = String(env.BOOTSTRAP_CONFIRMATION || "");
  const expected = `${contract.execution_policy.apply_confirmation_prefix}:${sha}:${targetKey}`;
  if (confirmation !== expected) {
    throw bootstrapError("bootstrap_confirmation_mismatch", "Apply requires an exact SHA- and target-bound confirmation", { expected_confirmation: expected });
  }
  return expected;
}

export function validateGrantPlan(target, contract) {
  const policy = contract.grant_policy;
  const expectedTables = [...(policy.required_tables || [])];
  const expectedOps = [...(policy.required_operations || [])].map((item) => String(item).toUpperCase());
  const entries = Array.isArray(target.grants) && target.grants.length
    ? target.grants.map(normalizeEntry)
    : expectedTables.map((table) => ({ table, privileges: expectedOps }));
  const tables = entries.map((entry) => String(entry.table || ""));
  if (tables.length !== expectedTables.length || new Set(tables).size !== expectedTables.length || tables.some((table) => !expectedTables.includes(table))) {
    throw bootstrapError("bootstrap_grant_table_set_denied", "Grant table set must exactly match the repository contract");
  }
  const grants = entries.map((entry) => {
    const table = assertIdentifier(entry.table, "grant.table");
    const privileges = [...new Set((entry.privileges || []).map((item) => String(item).toUpperCase()))];
    if (privileges.length !== expectedOps.length || privileges.some((item) => !SAFE_GRANT_PRIVILEGES.has(item)) || expectedOps.some((item) => !privileges.includes(item))) {
      throw bootstrapError("bootstrap_grant_operation_set_denied", "Grant operations must exactly match SELECT, INSERT, UPDATE", { table });
    }
    return { table, privileges };
  });
  return grants;
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
  const rows = await queryOne(connection, "SELECT COUNT(*) AS table_count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
  const countRow = rows.find((row) => Object.prototype.hasOwnProperty.call(row, "table_count"));
  return Number(countRow?.table_count || 0);
}

export function classifyDatabaseTableCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) throw bootstrapError("bootstrap_table_count_invalid", "Database table count is invalid");
  return count === 0 ? "zero_tables" : "nonempty";
}

export function assertBaselineDatabaseEligible(value) {
  const classification = classifyDatabaseTableCount(value);
  if (classification !== "zero_tables") {
    throw bootstrapError("bootstrap_baseline_nonempty_denied", "Baseline schema bundle is permitted only for a zero-table database", { table_count: Number(value) });
  }
  return true;
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
    const table = assertIdentifier(check.table, "postcondition.table");
    if (check.type === "column") {
      const column = assertIdentifier(check.column, "postcondition.column");
      evidence.push({ ...check, ready: await columnExists(connection, database, table, column) });
    } else if (check.type === "index") {
      const index = assertIdentifier(check.index, "postcondition.index");
      evidence.push({ ...check, ready: await indexExists(connection, database, table, index) });
    } else if (check.type === "row") {
      const keyColumn = assertIdentifier(check.key_column, "postcondition.key_column");
      const valueColumn = assertIdentifier(check.value_column, "postcondition.value_column");
      const rows = await queryOne(connection, `SELECT \`${valueColumn}\` AS observed_value FROM \`${table}\` WHERE \`${keyColumn}\` = ?`, [check.key_value]);
      const observedRow = rows.find((row) => Object.prototype.hasOwnProperty.call(row, "observed_value"));
      evidence.push({ ...check, ready: rows.length === 1 && String(observedRow?.observed_value) === String(check.expected_value) });
    } else {
      throw bootstrapError("bootstrap_postcondition_type_denied", "Unknown postcondition type", { migration, type: check.type || null });
    }
  }
  return { ready: evidence.every((item) => item.ready), checks: evidence };
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
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch (error) {
    throw bootstrapError("bootstrap_bundle_manifest_unreadable", "Schema bundle manifest is unreadable", { cause: error?.message || "parse_failed" });
  }
  if (manifest.contract !== contract.baseline_bundle.manifest_contract) throw bootstrapError("bootstrap_bundle_contract_invalid", "Schema bundle manifest contract is not canonical");
  if (manifest.source_commit !== expectedSha) throw bootstrapError("bootstrap_bundle_source_mismatch", "Schema bundle was not generated from the exact requested source SHA");
  if (manifest.schema_only !== true || manifest.production_accessed !== false || manifest.provider_accessed !== false || manifest.data_exported !== false || manifest.secrets_included !== false) {
    throw bootstrapError("bootstrap_bundle_safety_invalid", "Schema bundle safety declarations are incomplete");
  }
  const roleConfig = manifest.roles?.[role];
  const expectedFile = role === "runtime" ? contract.baseline_bundle.runtime_role_file : contract.baseline_bundle.governance_role_file;
  const requiredTables = role === "runtime" ? contract.baseline_bundle.required_runtime_tables : contract.baseline_bundle.required_governance_tables;
  const bundleFile = roleConfig?.bundle_file || roleConfig?.file;
  if (!roleConfig || bundleFile !== expectedFile || !Array.isArray(roleConfig.tables) || roleConfig.tables.length === 0 || !Number.isInteger(Number(roleConfig.table_count)) || Number(roleConfig.table_count) !== roleConfig.tables.length) throw bootstrapError("bootstrap_bundle_role_invalid", "Schema bundle role is incomplete", { role });
  for (const table of requiredTables) if (!roleConfig.tables.includes(table)) throw bootstrapError("bootstrap_bundle_required_table_missing", "Schema bundle does not declare a required table", { role, table });
  const bundlePath = path.resolve(path.dirname(manifestPath), bundleFile);
  if (!fs.existsSync(bundlePath)) throw bootstrapError("bootstrap_bundle_file_missing", "Schema bundle file is missing", { role, file: bundleFile });
  const observed = crypto.createHash("sha256").update(fs.readFileSync(bundlePath)).digest("hex");
  if (observed !== String(roleConfig.sha256).toLowerCase()) throw bootstrapError("bootstrap_bundle_checksum_mismatch", "Schema bundle checksum does not match manifest", { role });
  return { manifest, bundlePath, role: { ...roleConfig, file: bundleFile } };
}

export function validateSchemaBundleManifest(manifestPath, expectedSha, contract = readRuntimeBootstrapContract()) {
  return readBundleManifest(manifestPath, expectedSha, contract, "runtime");
}

async function applyRoleBundle(connection, database, manifestPath, expectedSha, contract, role) {
  const bundle = readBundleManifest(manifestPath, expectedSha, contract, role);
  const sql = zlib.gunzipSync(fs.readFileSync(bundle.bundlePath)).toString("utf8");
  assertSqlArtifactSafe(sql, { allowData: false });
  await connection.query(sql);
  return { role, file: bundle.role.file, sha256: bundle.role.sha256, table_count: bundle.role.table_count || bundle.role.tables.length, status: "schema_bundle_applied" };
}

async function applyRuntimeBundle(connection, database, manifestPath, expectedSha, contract) {
  return applyRoleBundle(connection, database, manifestPath, expectedSha, contract, "runtime");
}

async function applyGovernanceBundle(connection, database, manifestPath, expectedSha, contract) {
  return applyRoleBundle(connection, database, manifestPath, expectedSha, contract, "governance");
}

async function applySeedFile(connection, repoRoot, entry) {
  const file = String(entry.file || "");
  const absolute = migrationFilePath(repoRoot, file);
  const sql = fs.readFileSync(absolute, "utf8");
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  if (checksum !== String(entry.sha256).toLowerCase()) throw bootstrapError("bootstrap_seed_checksum_mismatch", "Canonical empty-database seed checksum differs from contract", { file });
  const statements = assertSqlArtifactSafe(sql, { allowData: true });
  if (statements.length !== Number(entry.statement_count)) throw bootstrapError("bootstrap_seed_statement_count_mismatch", "Canonical empty-database seed statement count differs from contract", { file });
  await connection.query(sql);
  return { file, sha256: checksum, statement_count: statements.length, status: "seed_applied" };
}

async function applyIncidentMigration(connection, repoRoot, migration, spec, database) {
  const absolute = migrationFilePath(repoRoot, migration);
  const sql = fs.readFileSync(absolute, "utf8");
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  if (checksum !== String(spec.sha256).toLowerCase()) throw bootstrapError("bootstrap_migration_checksum_mismatch", "Canonical migration checksum differs from contract", { migration });
  const statements = assertSqlArtifactSafe(sql, { allowData: true });
  if (statements.length !== Number(spec.statement_count)) throw bootstrapError("bootstrap_migration_statement_count_mismatch", "Canonical migration statement count differs from contract", { migration });
  for (const table of spec.requires_tables || []) if (!(await tableExists(connection, database, table))) throw bootstrapError("bootstrap_migration_prerequisite_missing", "Incident migration prerequisite table is missing", { migration, table });
  await connection.query(sql);
  return { file: migration, sha256: checksum, statement_count: statements.length, status: "applied" };
}

async function readGrantRows(connection, target, database) {
  const grantee = `'${String(target.principal).replaceAll("'", "''")}'@'${String(target.principal_host).replaceAll("'", "''")}'`;
  const [userRows] = await connection.execute("SELECT PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = ?", [grantee]);
  const [schemaRows] = await connection.execute("SELECT TABLE_SCHEMA, PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = ? AND TABLE_SCHEMA = ?", [grantee, database]);
  const [tableRows] = await connection.execute("SELECT TABLE_SCHEMA, TABLE_NAME, PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = ? AND TABLE_SCHEMA = ?", [grantee, database]);
  return { userRows, schemaRows, tableRows };
}

export async function readGrantPostconditions(connection, target, database, contract) {
  if (!target.principal || !target.principal_host) throw bootstrapError("bootstrap_grant_principal_missing", "Allowlisted target must declare principal and principal_host for grants");
  const grants = validateGrantPlan(target, contract);
  const { userRows, schemaRows, tableRows } = await readGrantRows(connection, target, database);
  const requiredTables = new Set(grants.map((entry) => entry.table));
  const requiredOps = new Set((contract.grant_policy.required_operations || []).map((item) => String(item).toUpperCase()));
  const tableEvidence = grants.map((grant) => {
    const rows = tableRows.filter((row) => String(row.TABLE_NAME) === grant.table);
    const observed = new Set(rows.map((row) => String(row.PRIVILEGE_TYPE).toUpperCase()));
    return {
      table: grant.table,
      missing: [...requiredOps].filter((operation) => !observed.has(operation)),
      forbidden: [...observed].filter((operation) => !requiredOps.has(operation)),
      grant_option: rows.some((row) => String(row.IS_GRANTABLE || "NO").toUpperCase() === "YES"),
    };
  });
  const broadGlobal = userRows.filter((row) => BROAD_WRITE_PRIVILEGES.has(String(row.PRIVILEGE_TYPE).toUpperCase()));
  const broadSchema = schemaRows.filter((row) => BROAD_WRITE_PRIVILEGES.has(String(row.PRIVILEGE_TYPE).toUpperCase()));
  const outsideTableWrites = tableRows.filter((row) => {
    const table = String(row.TABLE_NAME || "");
    const privilege = String(row.PRIVILEGE_TYPE || "").toUpperCase();
    return !requiredTables.has(table) && BROAD_WRITE_PRIVILEGES.has(privilege);
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

async function applyGrants(connection, target, database, contract) {
  const grants = validateGrantPlan(target, contract);
  if (!target.principal || !target.principal_host) throw bootstrapError("bootstrap_grant_principal_missing", "Allowlisted target must declare principal and principal_host for grants");
  const quoteLiteral = (value) => `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
  const account = `${quoteLiteral(target.principal)}@${quoteLiteral(target.principal_host)}`;
  const applied = [];
  const missing = [];
  for (const grant of grants) {
    if (!(await tableExists(connection, database, grant.table))) {
      missing.push(grant.table);
      continue;
    }
    try {
      await connection.query(`GRANT ${grant.privileges.join(", ")} ON \`${database}\`.\`${grant.table}\` TO ${account}`);
      applied.push(grant);
    } catch (error) {
      throw bootstrapError("bootstrap_grant_mutation_failed", "Bootstrap credential could not apply the least-privilege grant", { table: grant.table, mysql_code: error?.code || null });
    }
  }
  if (missing.length) throw bootstrapError("bootstrap_grant_table_missing", "Required grant tables are missing", { missing_tables: missing });
  return { applied, grant_mutation_performed: applied.length > 0 };
}

async function insertLedgerRecord(connection, migration, checksum, statementCount, expectedSha, sqlApplied) {
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
      JSON.stringify({ canonical_postconditions_ready: true, sql_applied_by_this_run: sqlApplied, evidence_mode: "apply", secrets_included: false }),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify({ source: "explicit_release_hook_or_github", exact_production_sha: expectedSha, sql_applied_by_this_run: sqlApplied, secrets_included: false }),
    ],
  );
  return { run_id: runId, mode: "apply", recorded: true, sql_applied_by_this_run: sqlApplied };
}

export function buildPlan(env = process.env, contract = readRuntimeBootstrapContract()) {
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
    secrets_included: false,
  };
  if (mode === "plan") return result;
  const target = resolveBootstrapTarget(env, contract);
  const migration = selectMigration(contract, env.BOOTSTRAP_MIGRATION, mode);
  const credentials = validateBootstrapCredentials(env, { requirePassword: false });
  if (mode === "apply") validateApplyConfirmation(env, source.sha, target.key, contract);
  return { ...result, status: "preflight_ready_for_explicit_invocation", target_key: target.key, database_binding_present: true, migration: migration.file, migration_role: migration.spec.role || null, credentials: { host_configured: credentials.host_configured, user_configured: credentials.user_configured, password_configured: Boolean(String(env.MYSQL_BOOTSTRAP_PASSWORD || "")), separate_from_runtime: true }, secrets_included: false };
}

export async function runBootstrap({ env = process.env, contract = readRuntimeBootstrapContract(), repoRoot = path.resolve(HERE, ".."), connectionFactory } = {}) {
  const mode = normalizeMode(env.BOOTSTRAP_MODE || "plan");
  const plan = buildPlan(env, contract);
  if (mode === "plan") return plan;
  const target = resolveBootstrapTarget(env, contract);
  const source = validateSourceBinding(env, contract, mode);
  const localDeployment = validateLocalDeploymentEvidence(repoRoot, source, contract);
  const { file: migration, spec } = selectMigration(contract, env.BOOTSTRAP_MIGRATION, mode);
  validateBootstrapCredentials(env, { requirePassword: true });
  if (mode === "apply") validateApplyConfirmation(env, source.sha, target.key, contract);
  const createConnection = connectionFactory || (async () => {
    const { createConnection: connect } = await import("mysql2/promise");
    return connect({
      host: env.MYSQL_BOOTSTRAP_HOST,
      port: Number(env.MYSQL_BOOTSTRAP_PORT || 3306),
      user: env.MYSQL_BOOTSTRAP_USER,
      password: env.MYSQL_BOOTSTRAP_PASSWORD,
      multipleStatements: true,
      connectTimeout: 15000,
    });
  });
  let connection;
  let governanceConnection;
  let ledgerConnection;
  let databaseMutationPerformed = false;
  let migrationApplyPerformed = false;
  let grantMutationPerformed = false;
  try {
    connection = await createConnection({ target, env, mode, role: "runtime", database: target.database });
    const exists = await databaseExists(connection, target.database);
    if (!exists) throw bootstrapError("bootstrap_database_missing", "Target database does not exist; database creation is intentionally outside this contract", { target_key: target.key, role: "runtime" });
    await connection.query(`USE \`${target.database}\``);
    const governanceDatabase = target.governance_database || target.database;
    if (governanceDatabase === target.database) {
      ledgerConnection = connection;
    } else {
      governanceConnection = await createConnection({ target, env, mode, role: "governance", database: governanceDatabase });
      const governanceExists = await databaseExists(governanceConnection, governanceDatabase);
      if (!governanceExists) throw bootstrapError("bootstrap_database_missing", "Governance database does not exist; database creation is intentionally outside this contract", { target_key: target.key, role: "governance" });
      await governanceConnection.query(`USE \`${governanceDatabase}\``);
      ledgerConnection = governanceConnection;
    }
    const beforeTableCount = await tableCount(connection, target.database);
    const databaseClassification = classifyDatabaseTableCount(beforeTableCount);
    const required = contract.migrations[migration].requires_tables || [];
    const requiredEvidence = await requiredTableEvidence(connection, target.database, required);
    if (requiredEvidence.some((entry) => !entry.present) && beforeTableCount > 0) {
      throw bootstrapError("bootstrap_migration_prerequisite_missing", "Incident migration prerequisites are missing from a non-empty database", { migration, missing_tables: requiredEvidence.filter((entry) => !entry.present).map((entry) => entry.table), table_count: beforeTableCount });
    }
    const ledger = beforeTableCount === 0
      ? { found: false, run_id: null, applied_at: null, deferred_until_baseline: true }
      : await readLedgerApplyRecord(ledgerConnection, target.governance_database || target.database, migration, spec.sha256);
    const postconditionsBefore = migration === "20260815_custom_gpt_mcp_catalog_levels.sql" && databaseClassification !== "zero_tables"
      ? await readIncidentPostconditions(connection, target.database, contract, migration)
      : null;
    if (mode === "dry_run") {
      const grants = await readGrantPostconditions(connection, target, target.database, contract);
      return {
        ...plan,
        source_binding: { ...plan.source_binding, local_deployment_manifest: localDeployment },
        status: "dry_run_complete",
        target_key: target.key,
        database_table_count: beforeTableCount,
        database_classification: databaseClassification,
        required_table_evidence: requiredEvidence,
        ledger,
        postconditions: postconditionsBefore,
        grant_readback: grants,
        database_connection_performed: true,
        secrets_included: false,
      };
    }
    const migrationResults = [];
    if (databaseClassification === "zero_tables") {
      assertBaselineDatabaseEligible(beforeTableCount);
      const manifestPath = resolveBundleManifestPath(repoRoot, env.BOOTSTRAP_SCHEMA_BUNDLE_MANIFEST, contract);
      migrationResults.push(await applyRuntimeBundle(connection, target.database, manifestPath, source.sha, contract));
      databaseMutationPerformed = true;
      migrationResults.push(await applyGovernanceBundle(ledgerConnection, target.governance_database || target.database, manifestPath, source.sha, contract));
      databaseMutationPerformed = true;
      for (const seed of contract.baseline_bundle.required_seed_files) {
        migrationResults.push(await applySeedFile(connection, repoRoot, seed));
        databaseMutationPerformed = true;
      }
    }
    const postconditionsAfterBaseline = migration === "20260815_custom_gpt_mcp_catalog_levels.sql"
      ? await readIncidentPostconditions(connection, target.database, contract, migration)
      : null;
    if (ledger.found && !postconditionsAfterBaseline?.ready && migration === "20260815_custom_gpt_mcp_catalog_levels.sql") {
      throw bootstrapError("bootstrap_ledger_schema_divergence", "Ledger says migration is applied but declared postconditions are not ready", { migration, run_id: ledger.run_id || null });
    }
    let sqlApplied = false;
    if (!ledger.found) {
      migrationResults.push(await applyIncidentMigration(connection, repoRoot, migration, spec, target.database));
      sqlApplied = true;
      databaseMutationPerformed = true;
      migrationApplyPerformed = true;
      const postconditionsAfter = await readIncidentPostconditions(connection, target.database, contract, migration);
      if (!postconditionsAfter.ready) throw bootstrapError("bootstrap_postcondition_failed", "Migration completed but postconditions are not ready", { migration });
      migrationResults.push(await insertLedgerRecord(ledgerConnection, migration, spec.sha256, spec.statement_count, source.sha, true));
    } else if (migration === "20260815_custom_gpt_mcp_catalog_levels.sql" && !postconditionsBefore?.ready) {
      throw bootstrapError("bootstrap_ledger_schema_divergence", "Ledger record exists but postconditions are not ready", { migration, run_id: ledger.run_id || null });
    }
    const grants = await applyGrants(connection, target, target.database, contract);
    grantMutationPerformed = grants.grant_mutation_performed === true;
    databaseMutationPerformed = databaseMutationPerformed || grantMutationPerformed;
    const grantReadback = await readGrantPostconditions(connection, target, target.database, contract);
    if (!grantReadback.ready) throw bootstrapError("bootstrap_grant_readback_failed", "Same-cycle grant readback is not ready");
    const postconditions = await readIncidentPostconditions(connection, target.database, contract, migration);
    return {
      ...plan,
      source_binding: { ...plan.source_binding, local_deployment_manifest: localDeployment },
      status: "apply_complete",
      target_key: target.key,
      database_table_count_before: beforeTableCount,
      database_classification: databaseClassification,
      migration_results: migrationResults,
      ledger,
      postconditions,
      grants: { ...grants, grant_readback: grantReadback },
      database_connection_performed: true,
      database_mutation_performed: databaseMutationPerformed,
      migration_apply_performed: migrationApplyPerformed,
      grant_mutation_performed: grantMutationPerformed,
      secrets_included: false,
    };
  } catch (error) {
    error.details = {
      ...(error.details && typeof error.details === "object" ? error.details : {}),
      database_connection_performed: Boolean(connection || governanceConnection),
      database_mutation_performed: databaseMutationPerformed,
      migration_apply_performed: migrationApplyPerformed,
      grant_mutation_performed: grantMutationPerformed,
    };
    throw error;
  } finally {
    if (governanceConnection) await governanceConnection.end().catch(() => {});
    if (connection) await connection.end().catch(() => {});
  }
}

export { DEFAULT_CONTRACT_PATH };
