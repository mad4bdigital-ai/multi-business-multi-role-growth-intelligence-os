#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { splitMigrationSqlStatements } from "../../http-generic-api/migrationSqlStatements.js";
import { runGovernedMigrationSchemaReadback } from "../../http-generic-api/governedMigrationSchemaReadbackTool.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const requireFromApi = createRequire(path.join(ROOT, "http-generic-api", "package.json"));
const mysql = requireFromApi("mysql2/promise");

export const CONTRACT = "mad4b.production-governance-foundation-1053.v1";
export const MIGRATION = "1053_production_governance_capability_envelope_foundation.sql";
export const MIGRATION_SHA256 = "21caf065fa700a92b301fb0abf82cc0e34520acbf4b2c913b920b7914c158e46";
export const STATEMENT_COUNT = 1;
export const TABLE = "capability_resolution_envelope_ledger";
export const CONFIRMATION = "APPLY_PRODUCTION_GOVERNANCE_FOUNDATION_1053";
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TARGET_KEY_RE = /^[A-Za-z0-9._-]{1,128}$/u;
const DB_RE = /^[A-Za-z0-9_$.-]{1,128}$/u;

const EXPECTED_COLUMNS = Object.freeze([
  "id","envelope_id","tenant_id","user_id","workspace_id","workspace_key","brand_key","app_key",
  "capability_key","operation_intent","risk_class","selected_source_tier","selected_runtime_surface",
  "authority_status","decision","envelope_status","dispatch_allowed","apply_allowed","approval_required",
  "quota_required","audit_required","readback_required","blocking_gap_count","envelope_sha256","envelope_json",
  "requested_by","execution_ref","execution_status","expires_at","secrets_included","created_at","updated_at",
]);
const EXPECTED_INDEXES = Object.freeze([
  "PRIMARY",
  "uq_capability_resolution_envelope_id",
  "idx_capability_resolution_envelope_tenant",
  "idx_capability_resolution_envelope_app",
  "idx_capability_resolution_envelope_status",
  "idx_capability_resolution_envelope_decision",
]);

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = { ...details, secrets_included: false };
  throw error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
const sha256 = (value) => crypto.createHash("sha256").update(
  typeof value === "string" ? value : JSON.stringify(stable(value)),
).digest("hex");

function required(value, name, pattern = null) {
  const normalized = String(value || "").trim();
  if (!normalized || (pattern && !pattern.test(normalized))) fail("FOUNDATION_INPUT_INVALID", `${name} is invalid.`, { field: name });
  return normalized;
}

function parseTargets(env = process.env) {
  let targets;
  try { targets = JSON.parse(required(env.RUNTIME_BOOTSTRAP_TARGETS_JSON, "RUNTIME_BOOTSTRAP_TARGETS_JSON")); }
  catch (error) {
    if (error?.code) throw error;
    fail("FOUNDATION_TARGETS_INVALID", "RUNTIME_BOOTSTRAP_TARGETS_JSON must be valid JSON.");
  }
  if (!Array.isArray(targets)) fail("FOUNDATION_TARGETS_INVALID", "RUNTIME_BOOTSTRAP_TARGETS_JSON must be an array.");
  const targetKey = required(env.BOOTSTRAP_TARGET_KEY || "production-runtime", "BOOTSTRAP_TARGET_KEY", TARGET_KEY_RE);
  const matches = targets.filter((entry) => String(entry?.key || "") === targetKey);
  if (matches.length !== 1) fail("FOUNDATION_TARGET_NOT_EXACT", "Exactly one repository-owned bootstrap target must match.", { target_key: targetKey, match_count: matches.length });
  const target = matches[0];
  const runtimeDatabase = required(target?.database, "target.database", DB_RE);
  const governanceDatabase = required(target?.governance_database, "target.governance_database", DB_RE);
  if (runtimeDatabase === governanceDatabase) {
    fail("FOUNDATION_GOVERNANCE_DATABASE_NOT_DEDICATED", "The Governance foundation repair requires an explicitly separated Governance database.");
  }
  return {
    targetKey,
    target,
    runtimeDatabase,
    governanceDatabase,
    governance_database_sha256: sha256(governanceDatabase),
    runtime_database_sha256: sha256(runtimeDatabase),
  };
}

function migrationSource() {
  const file = path.join(ROOT, "http-generic-api", "migrations", MIGRATION);
  const sql = fs.readFileSync(file, "utf8");
  const checksum = sha256(sql);
  const statements = splitMigrationSqlStatements(sql);
  if (checksum !== MIGRATION_SHA256) fail("FOUNDATION_MIGRATION_CHECKSUM_DRIFT", "Migration 1053 checksum changed.", { observed_checksum_sha256: checksum });
  if (statements.length !== STATEMENT_COUNT) fail("FOUNDATION_MIGRATION_STATEMENT_COUNT_DRIFT", "Migration 1053 statement count changed.", { observed_statement_count: statements.length });
  if (!/^CREATE TABLE IF NOT EXISTS capability_resolution_envelope_ledger\b/iu.test(statements[0])) {
    fail("FOUNDATION_MIGRATION_SCOPE_DRIFT", "Migration 1053 is no longer the fixed envelope-table foundation statement.");
  }
  if (/\b(?:DROP|DELETE|ALTER|TRUNCATE|GRANT|REVOKE|CALL|LOAD\s+DATA)\b/iu.test(statements[0])) {
    fail("FOUNDATION_MIGRATION_SCOPE_DRIFT", "Migration 1053 contains a forbidden mutation class.");
  }
  return { file, sql, statements };
}

async function fetchJson(url, timeoutMs = 30000) {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok || !payload) fail("FOUNDATION_RUNTIME_IDENTITY_UNREADABLE", "Production identity endpoint is unavailable.", { endpoint: new URL(url).pathname, http_status: response.status });
  return payload;
}

async function verifyProductionIdentity(expectedSha) {
  const version = await fetchJson("https://auth.mad4b.com/version");
  const deployment = await fetchJson("https://auth.mad4b.com/deployment-info");
  const versionSha = String(version?.deployment?.deployed_commit_sha || version?.commit_sha || "").toLowerCase();
  const versionBranch = String(version?.deployment?.manifest?.branch || version?.branch || "");
  const deploymentSha = String(deployment?.commit_sha || deployment?.commit || deployment?.deployment?.deployed_commit_sha || "").toLowerCase();
  const deploymentBranch = String(deployment?.branch || deployment?.deployment?.manifest?.branch || "");
  const runtime = deployment?.runtime_environment || {};
  const ready = versionSha === expectedSha
    && deploymentSha === expectedSha
    && versionBranch === "Production"
    && deploymentBranch === "Production"
    && runtime?.ok === true
    && runtime?.environment_key === "production"
    && runtime?.runtime_variant === "production_hostinger_autodeploy"
    && runtime?.runtime_class === "hostinger_autodeploy"
    && runtime?.runtime_class_explicit === true
    && runtime?.source_branch === "Production"
    && runtime?.raw_values_exposed === false
    && runtime?.secrets_included === false;
  if (!ready) fail("FOUNDATION_PRODUCTION_IDENTITY_NOT_EXACT", "Production runtime identity is not exact or explicit.", {
    expected_sha: expectedSha,
    version_sha_match: versionSha === expectedSha,
    deployment_sha_match: deploymentSha === expectedSha,
    version_branch_match: versionBranch === "Production",
    deployment_branch_match: deploymentBranch === "Production",
    runtime_environment_explicit: runtime?.runtime_class_explicit === true,
    runtime_class_match: runtime?.runtime_class === "hostinger_autodeploy",
  });
  return {
    expected_sha: expectedSha,
    runtime_environment: "production",
    runtime_class: "hostinger_autodeploy",
    runtime_class_explicit: true,
    source_branch: "Production",
  };
}

function mysqlConfig(env, database) {
  return {
    host: required(env.MYSQL_BOOTSTRAP_HOST, "MYSQL_BOOTSTRAP_HOST"),
    port: Number(env.MYSQL_BOOTSTRAP_PORT || 3306),
    user: required(env.MYSQL_BOOTSTRAP_USER, "MYSQL_BOOTSTRAP_USER"),
    password: required(env.MYSQL_BOOTSTRAP_PASSWORD, "MYSQL_BOOTSTRAP_PASSWORD"),
    database,
    connectTimeout: 15000,
    timezone: "Z",
  };
}

async function schemaShape(connection) {
  const [tables] = await connection.query(
    "SELECT TABLE_NAME,TABLE_TYPE,ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
    [TABLE],
  );
  if (tables.length === 0) return { table_present: false, exact: false, missing_columns: [...EXPECTED_COLUMNS], missing_indexes: [...EXPECTED_INDEXES], blocker: null };
  const [columns] = await connection.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
    [TABLE],
  );
  const [indexes] = await connection.query(
    "SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
    [TABLE],
  );
  const columnSet = new Set(columns.map((row) => String(row.COLUMN_NAME)));
  const indexSet = new Set(indexes.map((row) => String(row.INDEX_NAME)));
  const missingColumns = EXPECTED_COLUMNS.filter((name) => !columnSet.has(name));
  const missingIndexes = EXPECTED_INDEXES.filter((name) => !indexSet.has(name));
  const table = tables[0] || {};
  const tablePropertiesReady = String(table.TABLE_TYPE) === "BASE TABLE"
    && String(table.ENGINE || "").toUpperCase() === "INNODB"
    && String(table.TABLE_COLLATION || "").toLowerCase().startsWith("utf8mb4");
  return {
    table_present: true,
    exact: tablePropertiesReady && missingColumns.length === 0 && missingIndexes.length === 0,
    missing_columns: missingColumns,
    missing_indexes: missingIndexes,
    table_properties_ready: tablePropertiesReady,
    observed_column_count: columns.length,
    observed_index_count: indexes.length,
    blocker: tablePropertiesReady && missingColumns.length === 0 && missingIndexes.length === 0 ? null : "FOUNDATION_PARTIAL_SCHEMA_REQUIRES_SEPARATE_RECONCILIATION",
  };
}

async function ledgerContract(connection) {
  const requiredColumns = [
    "run_id","migration_file","migration_checksum_sha256","applied_at","applied_by","runner_version","mode",
    "statement_count","preflight_status","preflight_risk_count","requirements_json","results_json",
    "before_schema_objects_json","after_schema_objects_json","metadata_json","secrets_included","capability_envelope_id",
  ];
  const [tables] = await connection.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='governed_migration_ledger'",
  );
  if (tables.length !== 1) return { ready: false, blocker: "FOUNDATION_GOVERNED_MIGRATION_LEDGER_MISSING", missing_columns: requiredColumns };
  const [columns] = await connection.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='governed_migration_ledger'",
  );
  const present = new Set(columns.map((row) => String(row.COLUMN_NAME)));
  const missing = requiredColumns.filter((name) => !present.has(name));
  return { ready: missing.length === 0, blocker: missing.length ? "FOUNDATION_GOVERNED_MIGRATION_LEDGER_CONTRACT_INCOMPLETE" : null, missing_columns: missing };
}

async function foundationReadback(connection) {
  const source = migrationSource();
  const ledger = await ledgerContract(connection);
  if (!ledger.ready) return { ok: false, ledger_contract: ledger, schema: await schemaShape(connection), exact_apply_ledger_verified: false, readback: null };
  const readback = await runGovernedMigrationSchemaReadback({
    migration: MIGRATION,
    expected_checksum_sha256: MIGRATION_SHA256,
    expected_statement_count: STATEMENT_COUNT,
    expected_tables: [TABLE],
    expected_columns: EXPECTED_COLUMNS.map((column) => ({ table: TABLE, column })),
    expected_indexes: EXPECTED_INDEXES.map((index) => ({ table: TABLE, index })),
  }, {
    pool: connection,
    readFile: async () => source.sql,
    migrationsDir: path.dirname(source.file),
  });
  const schema = await schemaShape(connection);
  return {
    ok: readback.ok === true && schema.exact === true,
    ledger_contract: ledger,
    schema,
    exact_apply_ledger_verified: readback?.ledger?.found === true && readback?.ledger?.mode === "apply"
      && readback?.ledger?.migration_checksum_sha256 === MIGRATION_SHA256
      && Number(readback?.ledger?.statement_count) === STATEMENT_COUNT,
    readback,
  };
}

function planBase({ expectedSha, target, identity, state }) {
  let action = "blocked";
  let executionAllowed = false;
  let blocker = null;
  if (!state.ledger_contract.ready) blocker = state.ledger_contract.blocker;
  else if (state.schema.table_present && !state.schema.exact) blocker = state.schema.blocker;
  else if (state.ok && state.exact_apply_ledger_verified) action = "already_ready";
  else {
    action = state.schema.table_present ? "reassert_foundation_and_record_exact_ledger" : "create_foundation_and_record_exact_ledger";
    executionAllowed = true;
  }
  return {
    contract: "mad4b.production-governance-foundation-1053-plan.v1",
    expected_sha: expectedSha,
    migration: MIGRATION,
    migration_sha256: MIGRATION_SHA256,
    statement_count: STATEMENT_COUNT,
    target_key: target.targetKey,
    governance_database_sha256: target.governance_database_sha256,
    runtime_database_sha256: target.runtime_database_sha256,
    split_database_required: true,
    action,
    execution_allowed: executionAllowed,
    blocker,
    schema: {
      table_present: state.schema.table_present,
      exact: state.schema.exact,
      missing_column_count: state.schema.missing_columns.length,
      missing_index_count: state.schema.missing_indexes.length,
      table_properties_ready: state.schema.table_properties_ready === true,
    },
    exact_apply_ledger_verified: state.exact_apply_ledger_verified === true,
    required_confirmation: executionAllowed ? CONFIRMATION : null,
    production_identity: identity,
    legacy_migration_225_apply_authorized: false,
    legacy_migration_225_marked_applied: false,
    caller_database_allowed: false,
    caller_sql_allowed: false,
    provider_mutation_allowed: false,
    deployment_allowed: false,
    automatic_replay_allowed: false,
    secrets_included: false,
  };
}

export async function buildPlan(env = process.env) {
  const expectedSha = required(env.EXPECTED_PRODUCTION_SHA, "EXPECTED_PRODUCTION_SHA", SHA40).toLowerCase();
  const target = parseTargets(env);
  const identity = await verifyProductionIdentity(expectedSha);
  const connection = await mysql.createConnection(mysqlConfig(env, target.governanceDatabase));
  try {
    const state = await foundationReadback(connection);
    const base = planBase({ expectedSha, target, identity, state });
    return { ...base, plan_sha256: sha256(base) };
  } finally {
    await connection.end().catch(() => {});
  }
}

async function insertLedger(connection, expectedSha) {
  const runId = crypto.randomUUID();
  const requirements = {
    contract: CONTRACT,
    exact_production_sha: expectedSha,
    split_topology_successor_to_225: true,
    caller_database_allowed: false,
    caller_sql_allowed: false,
    secrets_included: false,
  };
  const results = {
    foundation_table: TABLE,
    same_cycle_schema_readback_required: true,
    legacy_migration_225_marked_applied: false,
    provider_mutation_performed: false,
    deployment_performed: false,
    secrets_included: false,
  };
  const metadata = {
    source: "github_production_governance_foundation_1053",
    exact_production_sha: expectedSha,
    sql_applied_by_this_run: true,
    governance_database_mutation_performed: true,
    runtime_database_mutation_performed: false,
    legacy_migration_225_marked_applied: false,
    secrets_included: false,
  };
  await connection.execute(
    `INSERT INTO governed_migration_ledger
      (run_id,migration_file,migration_checksum_sha256,applied_by,runner_version,mode,statement_count,
       preflight_status,preflight_risk_count,requirements_json,results_json,before_schema_objects_json,
       after_schema_objects_json,metadata_json,secrets_included)
     VALUES (?,?,?,?,?,'apply',?,'pass',0,?,?,?,?,?,0)`,
    [
      runId, MIGRATION, MIGRATION_SHA256, "github_governance_foundation_bootstrap",
      "production-governance-foundation-1053-v1", STATEMENT_COUNT,
      JSON.stringify(requirements), JSON.stringify(results), JSON.stringify([]),
      JSON.stringify([TABLE]), JSON.stringify(metadata),
    ],
  );
  return runId;
}

export async function applyPlan(env = process.env) {
  const suppliedPlan = required(env.PLAN_SHA256, "PLAN_SHA256", SHA256).toLowerCase();
  if (required(env.OPERATOR_CONFIRMATION, "OPERATOR_CONFIRMATION") !== CONFIRMATION) {
    fail("FOUNDATION_CONFIRMATION_REQUIRED", "Exact typed foundation confirmation is required.");
  }
  const authoritative = await buildPlan(env);
  if (authoritative.plan_sha256 !== suppliedPlan) fail("FOUNDATION_PLAN_STALE", "Foundation plan changed before Apply.", {
    supplied_plan_sha256: suppliedPlan,
    authoritative_plan_sha256: authoritative.plan_sha256,
  });
  if (authoritative.execution_allowed !== true || !["create_foundation_and_record_exact_ledger","reassert_foundation_and_record_exact_ledger"].includes(authoritative.action)) {
    fail("FOUNDATION_ACTION_NOT_EXECUTABLE", "Current foundation plan does not authorize Apply.", { action: authoritative.action, blocker: authoritative.blocker });
  }

  const target = parseTargets(env);
  const source = migrationSource();
  const connection = await mysql.createConnection(mysqlConfig(env, target.governanceDatabase));
  let statementAcknowledged = false;
  let ledgerRunId = null;
  try {
    await verifyProductionIdentity(authoritative.expected_sha);
    const before = await foundationReadback(connection);
    if (before.schema.table_present && !before.schema.exact) {
      fail("FOUNDATION_PARTIAL_SCHEMA_REQUIRES_SEPARATE_RECONCILIATION", "A partial or malformed envelope table cannot be auto-repaired.");
    }
    if (before.exact_apply_ledger_verified) {
      fail("FOUNDATION_ALREADY_APPLIED", "The exact Foundation 1053 ledger is already present; automatic replay is forbidden.");
    }
    await connection.query(source.statements[0]);
    statementAcknowledged = true;

    const afterDdl = await schemaShape(connection);
    if (!afterDdl.exact) fail("FOUNDATION_SAME_CYCLE_SCHEMA_READBACK_FAILED", "Foundation table did not match the expected contract after fixed DDL.", {
      missing_column_count: afterDdl.missing_columns.length,
      missing_index_count: afterDdl.missing_indexes.length,
    });

    ledgerRunId = await insertLedger(connection, authoritative.expected_sha);
    const final = await foundationReadback(connection);
    if (!final.ok || !final.exact_apply_ledger_verified) fail("FOUNDATION_SAME_CYCLE_LEDGER_READBACK_FAILED", "Exact Foundation 1053 ledger/schema readback did not converge.");

    return {
      ok: true,
      contract: "mad4b.production-governance-foundation-1053-receipt.v1",
      status: "governance_envelope_foundation_ready",
      expected_sha: authoritative.expected_sha,
      plan_sha256: authoritative.plan_sha256,
      migration: MIGRATION,
      migration_sha256: MIGRATION_SHA256,
      statement_count: STATEMENT_COUNT,
      statement_acknowledged: statementAcknowledged,
      ledger_run_id: ledgerRunId,
      same_cycle_schema_readback_performed: true,
      same_cycle_ledger_readback_performed: true,
      governance_database_mutation_performed: true,
      runtime_database_mutation_performed: false,
      legacy_migration_225_marked_applied: false,
      provider_mutation_performed: false,
      deployment_performed: false,
      production_runtime_mutation_performed: false,
      automatic_replay_allowed: false,
      secrets_included: false,
    };
  } catch (error) {
    error.details = {
      ...(error.details || {}),
      statement_acknowledged: statementAcknowledged,
      ledger_recorded: Boolean(ledgerRunId),
      automatic_replay_allowed: false,
      provider_mutation_performed: false,
      deployment_performed: false,
      legacy_migration_225_marked_applied: false,
      secrets_included: false,
    };
    throw error;
  } finally {
    await connection.end().catch(() => {});
  }
}

export async function verifyFoundation(env = process.env) {
  const expectedSha = required(env.EXPECTED_PRODUCTION_SHA, "EXPECTED_PRODUCTION_SHA", SHA40).toLowerCase();
  const target = parseTargets(env);
  const identity = await verifyProductionIdentity(expectedSha);
  const connection = await mysql.createConnection(mysqlConfig(env, target.governanceDatabase));
  try {
    const state = await foundationReadback(connection);
    return {
      ok: state.ok === true && state.exact_apply_ledger_verified === true,
      contract: "mad4b.production-governance-foundation-1053-verification.v1",
      expected_sha: expectedSha,
      migration: MIGRATION,
      migration_sha256: MIGRATION_SHA256,
      statement_count: STATEMENT_COUNT,
      governance_database_sha256: target.governance_database_sha256,
      production_identity: identity,
      schema_ready: state.schema.exact === true,
      exact_apply_ledger_verified: state.exact_apply_ledger_verified === true,
      legacy_migration_225_marked_applied: false,
      database_connection_performed: true,
      sql_readback_performed: true,
      database_mutation_performed: false,
      provider_mutation_performed: false,
      deployment_performed: false,
      secrets_included: false,
    };
  } finally {
    await connection.end().catch(() => {});
  }
}

async function main() {
  const phase = required(process.env.FOUNDATION_PHASE, "FOUNDATION_PHASE");
  fs.mkdirSync(required(process.env.EVIDENCE_DIR, "EVIDENCE_DIR"), { recursive: true });
  try {
    let result;
    if (phase === "plan") result = await buildPlan(process.env);
    else if (phase === "apply") result = await applyPlan(process.env);
    else if (phase === "verify") result = await verifyFoundation(process.env);
    else fail("FOUNDATION_PHASE_INVALID", "FOUNDATION_PHASE must be plan, apply, or verify.");
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, `${phase}.json`), `${JSON.stringify(result, null, 2)}\n`);
    if (phase === "verify" && result.ok !== true) process.exitCode = 1;
  } catch (error) {
    const result = {
      ok: false,
      contract: CONTRACT,
      phase,
      error: { code: error?.code || "FOUNDATION_FAILED", message: error?.message || "Foundation operation failed.", details: error?.details || {} },
      database_mutation_performed: false,
      provider_mutation_performed: false,
      deployment_performed: false,
      automatic_replay_allowed: false,
      secrets_included: false,
    };
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, `${phase}-failure.json`), `${JSON.stringify(result, null, 2)}\n`);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
