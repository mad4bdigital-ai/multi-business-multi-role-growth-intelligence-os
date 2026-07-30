import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  governedMigrationApplyConfirmation,
  governedMigrationResourceUri,
  splitGovernedMigrationStatements,
} from "../../governedMigrationExecutionTool.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_MIGRATIONS_DIR = path.join(API_DIR, "migrations");

export const CONNECTION_OWNERSHIP_MIGRATION_FILE =
  "20260730_context_kernel_connection_ownership_persistence.sql";
export const CONNECTION_OWNERSHIP_MIGRATION_SOURCE_MERGE_SHA =
  "a9c3aa67e4ed2d846fc9a0697fa95d5c5fd35902";
export const CONNECTION_OWNERSHIP_MIGRATION_EXPECTED_STATEMENT_COUNT = 4;

const EXPECTED_TOP_LEVEL_STATEMENTS = Object.freeze([
  "ALTER TABLE workspace_registry",
  "CREATE TABLE connection_ownership_scopes",
  "CREATE TABLE provider_authorization_states",
  "CREATE OR REPLACE VIEW v_context_kernel_connection_ownership_compatibility",
]);

const EXPECTED_TABLES = Object.freeze([
  "workspace_registry",
  "connection_ownership_scopes",
  "provider_authorization_states",
  "v_context_kernel_connection_ownership_compatibility",
]);

const EXPECTED_COLUMNS = Object.freeze([
  Object.freeze({ table: "workspace_registry", column: "workspace_ownership_type" }),
  Object.freeze({ table: "workspace_registry", column: "owner_user_id" }),
  Object.freeze({ table: "workspace_registry", column: "ownership_revision" }),
  Object.freeze({ table: "connection_ownership_scopes", column: "ownership_id" }),
  Object.freeze({ table: "connection_ownership_scopes", column: "connection_id" }),
  Object.freeze({ table: "connection_ownership_scopes", column: "tenant_id" }),
  Object.freeze({ table: "connection_ownership_scopes", column: "workspace_id" }),
  Object.freeze({ table: "connection_ownership_scopes", column: "brand_id" }),
  Object.freeze({ table: "connection_ownership_scopes", column: "owner_scope_type" }),
  Object.freeze({ table: "connection_ownership_scopes", column: "owner_scope_ref" }),
  Object.freeze({ table: "connection_ownership_scopes", column: "owner_user_id" }),
  Object.freeze({ table: "connection_ownership_scopes", column: "connected_by_user_id" }),
  Object.freeze({ table: "connection_ownership_scopes", column: "provider_key" }),
  Object.freeze({ table: "connection_ownership_scopes", column: "provider_account_ref" }),
  Object.freeze({ table: "connection_ownership_scopes", column: "provider_account_binding_hash" }),
  Object.freeze({ table: "connection_ownership_scopes", column: "provider_account_binding_version" }),
  Object.freeze({ table: "connection_ownership_scopes", column: "authorization_revision" }),
  Object.freeze({ table: "connection_ownership_scopes", column: "connection_revision" }),
  Object.freeze({ table: "connection_ownership_scopes", column: "status" }),
  Object.freeze({ table: "provider_authorization_states", column: "state_ref" }),
  Object.freeze({ table: "provider_authorization_states", column: "flow_type" }),
  Object.freeze({ table: "provider_authorization_states", column: "provider_key" }),
  Object.freeze({ table: "provider_authorization_states", column: "principal_ref" }),
  Object.freeze({ table: "provider_authorization_states", column: "tenant_id" }),
  Object.freeze({ table: "provider_authorization_states", column: "workspace_id" }),
  Object.freeze({ table: "provider_authorization_states", column: "brand_id" }),
  Object.freeze({ table: "provider_authorization_states", column: "owner_scope_type" }),
  Object.freeze({ table: "provider_authorization_states", column: "owner_scope_ref" }),
  Object.freeze({ table: "provider_authorization_states", column: "target_connection_id" }),
  Object.freeze({ table: "provider_authorization_states", column: "expected_connection_revision" }),
  Object.freeze({ table: "provider_authorization_states", column: "expected_provider_account_ref" }),
  Object.freeze({ table: "provider_authorization_states", column: "expected_provider_account_binding_hash" }),
  Object.freeze({ table: "provider_authorization_states", column: "nonce_hash" }),
  Object.freeze({ table: "provider_authorization_states", column: "state_signature_hash" }),
  Object.freeze({ table: "provider_authorization_states", column: "signature_version" }),
  Object.freeze({ table: "provider_authorization_states", column: "state_revision" }),
  Object.freeze({ table: "provider_authorization_states", column: "claim_revision" }),
  Object.freeze({ table: "provider_authorization_states", column: "claim_token_hash" }),
  Object.freeze({ table: "provider_authorization_states", column: "completion_revision" }),
  Object.freeze({ table: "provider_authorization_states", column: "status" }),
  Object.freeze({ table: "provider_authorization_states", column: "expires_at" }),
]);

const EXPECTED_INDEXES = Object.freeze([
  Object.freeze({ table: "connection_ownership_scopes", index: "uq_connection_ownership_id" }),
  Object.freeze({ table: "connection_ownership_scopes", index: "uq_connection_ownership_connection" }),
  Object.freeze({ table: "connection_ownership_scopes", index: "idx_connection_owner_scope" }),
  Object.freeze({ table: "connection_ownership_scopes", index: "idx_connection_owner_user" }),
  Object.freeze({ table: "connection_ownership_scopes", index: "idx_connection_owner_brand" }),
  Object.freeze({ table: "connection_ownership_scopes", index: "idx_connection_provider_account_ref" }),
  Object.freeze({ table: "connection_ownership_scopes", index: "idx_connection_provider_account_hash" }),
  Object.freeze({ table: "provider_authorization_states", index: "uq_provider_authorization_state_ref" }),
  Object.freeze({ table: "provider_authorization_states", index: "uq_provider_authorization_nonce" }),
  Object.freeze({ table: "provider_authorization_states", index: "idx_provider_authorization_context" }),
  Object.freeze({ table: "provider_authorization_states", index: "idx_provider_authorization_target" }),
  Object.freeze({ table: "provider_authorization_states", index: "idx_provider_authorization_principal" }),
  Object.freeze({ table: "provider_authorization_states", index: "idx_provider_authorization_claim" }),
]);

const ABSENT_SCHEMA_KEYS = new Set([
  "table:connection_ownership_scopes",
  "table:provider_authorization_states",
  "table:v_context_kernel_connection_ownership_compatibility",
  "column:workspace_registry.workspace_ownership_type",
  "column:workspace_registry.owner_user_id",
  "column:workspace_registry.ownership_revision",
]);

function preflightError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  error.details = { ...details, secrets_included: false };
  return error;
}

function stripSqlComments(sql = "") {
  return String(sql || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .trim();
}

function topLevelStatementIdentity(statement = "") {
  const normalized = stripSqlComments(statement)
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const match = normalized.match(
    /^(ALTER TABLE|CREATE TABLE(?: IF NOT EXISTS)?|CREATE OR REPLACE VIEW)\s+([A-Za-z0-9_]+)/i,
  );
  if (!match) return null;
  const operation = match[1]
    .replace(/\s+IF NOT EXISTS$/i, "")
    .toUpperCase();
  return `${operation} ${match[2]}`;
}

function missingKeys(result = {}) {
  const missing = result?.expectations?.missing || {};
  return new Set([
    ...(Array.isArray(missing.tables) ? missing.tables : []).map((table) => `table:${table}`),
    ...(Array.isArray(missing.columns) ? missing.columns : []).map(
      (entry) => `column:${entry?.table}.${entry?.column}`,
    ),
    ...(Array.isArray(missing.indexes) ? missing.indexes : []).map(
      (entry) => `index:${entry?.table}.${entry?.index}`,
    ),
  ]);
}

export async function inspectConnectionOwnershipMigrationArtifact({
  readFile = fs.readFile,
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
} = {}) {
  const migrationPath = path.join(migrationsDir, CONNECTION_OWNERSHIP_MIGRATION_FILE);
  const sql = await readFile(migrationPath, "utf8");
  const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
  const statements = splitGovernedMigrationStatements(sql);
  const identities = statements.map(topLevelStatementIdentity);

  if (statements.length !== CONNECTION_OWNERSHIP_MIGRATION_EXPECTED_STATEMENT_COUNT) {
    throw preflightError(
      "connection_ownership_migration_statement_count_drift",
      "Connection ownership migration statement count drifted from the reviewed additive artifact.",
      {
        migration: CONNECTION_OWNERSHIP_MIGRATION_FILE,
        expected_statement_count: CONNECTION_OWNERSHIP_MIGRATION_EXPECTED_STATEMENT_COUNT,
        actual_statement_count: statements.length,
      },
    );
  }
  if (identities.some((identity) => !identity)) {
    throw preflightError(
      "connection_ownership_migration_unsupported_statement",
      "Connection ownership migration contains an unsupported top-level SQL statement.",
      { migration: CONNECTION_OWNERSHIP_MIGRATION_FILE, statement_identities: identities },
    );
  }
  if (JSON.stringify(identities) !== JSON.stringify(EXPECTED_TOP_LEVEL_STATEMENTS)) {
    throw preflightError(
      "connection_ownership_migration_scope_drift",
      "Connection ownership migration no longer matches the reviewed additive statement scope.",
      {
        migration: CONNECTION_OWNERSHIP_MIGRATION_FILE,
        expected_statement_identities: EXPECTED_TOP_LEVEL_STATEMENTS,
        actual_statement_identities: identities,
      },
    );
  }

  const normalizedSql = stripSqlComments(sql);
  if (/\b(?:INSERT\s+(?:IGNORE\s+)?INTO|UPDATE\s+`?[A-Za-z0-9_]+`?\s+SET|DELETE\s+FROM|REPLACE\s+INTO|DROP\s+(?:TABLE|VIEW)|TRUNCATE\s+TABLE)\b/i.test(normalizedSql)) {
    throw preflightError(
      "connection_ownership_migration_data_or_destructive_mutation_detected",
      "Connection ownership migration must not contain row backfill or destructive SQL.",
      { migration: CONNECTION_OWNERSHIP_MIGRATION_FILE },
    );
  }

  return Object.freeze({
    ok: true,
    migration: CONNECTION_OWNERSHIP_MIGRATION_FILE,
    source_merge_sha: CONNECTION_OWNERSHIP_MIGRATION_SOURCE_MERGE_SHA,
    migration_path: migrationPath,
    migration_checksum_sha256: checksum,
    statement_count: statements.length,
    statement_identities: Object.freeze([...identities]),
    required_confirmation: governedMigrationApplyConfirmation(CONNECTION_OWNERSHIP_MIGRATION_FILE),
    resource_uri: governedMigrationResourceUri(CONNECTION_OWNERSHIP_MIGRATION_FILE),
    additive_only: true,
    inferred_backfill_present: false,
    destructive_sql_present: false,
    mutation_requested: false,
    apply_permitted: false,
    authorization_status: "pending_separate_authorization",
    database_connection_opened: false,
    provider_call_executed: false,
    external_write_executed: false,
    secrets_included: false,
  });
}

export function buildConnectionOwnershipMigrationDryRunInput(inspection = {}) {
  return Object.freeze({
    migration: CONNECTION_OWNERSHIP_MIGRATION_FILE,
    mode: "dry_run",
    expected_checksum_sha256: String(inspection.migration_checksum_sha256 || ""),
    expected_statement_count: Number(inspection.statement_count || 0),
  });
}

export function buildConnectionOwnershipMigrationReadbackInput(inspection = {}) {
  return Object.freeze({
    migration: CONNECTION_OWNERSHIP_MIGRATION_FILE,
    expected_checksum_sha256: String(inspection.migration_checksum_sha256 || ""),
    expected_statement_count: Number(inspection.statement_count || 0),
    expected_tables: Object.freeze([...EXPECTED_TABLES]),
    expected_columns: Object.freeze(EXPECTED_COLUMNS.map((entry) => Object.freeze({ ...entry }))),
    expected_indexes: Object.freeze(EXPECTED_INDEXES.map((entry) => Object.freeze({ ...entry }))),
  });
}

export function classifyConnectionOwnershipMigrationReadback(result = {}) {
  if (result?.ok === true && result?.ledger?.found === true) return "ready";
  const missing = missingKeys(result);
  const fullyAbsent = [...ABSENT_SCHEMA_KEYS].every((key) => missing.has(key));
  if (result?.ledger?.found !== true && fullyAbsent) return "absent";
  return "partial";
}

export const ConnectionOwnershipMigrationPreflightContract = Object.freeze({
  schema_version: "connection_ownership_migration_preflight.v1",
  migration: CONNECTION_OWNERSHIP_MIGRATION_FILE,
  source_merge_sha: CONNECTION_OWNERSHIP_MIGRATION_SOURCE_MERGE_SHA,
  expected_statement_count: CONNECTION_OWNERSHIP_MIGRATION_EXPECTED_STATEMENT_COUNT,
  expected_top_level_statements: EXPECTED_TOP_LEVEL_STATEMENTS,
  expected_tables: EXPECTED_TABLES,
  expected_columns: EXPECTED_COLUMNS,
  expected_indexes: EXPECTED_INDEXES,
  execution_status: "not_authorized",
  migration_applied: false,
  same_cycle_readback_complete: false,
  runtime_consumers_enabled: false,
  rollback_strategy: "disable_consumers_and_retain_additive_schema",
  secrets_included: false,
});
