#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getPool } from "../db.js";
import { splitGovernedMigrationStatements } from "../governedMigrationExecutionTool.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(HERE, "..");
const MIGRATIONS_ROOT = path.join(API_ROOT, "migrations");
const DEFAULT_REPORT_PATH = path.resolve(process.cwd(), "retail-commerce-production-schema-baseline.json");
const CANONICAL_RUNTIME_BASE_URL = "https://auth.mad4b.com";
const MIGRATIONS = Object.freeze([
  "029_sprint32_tenant_commercials.sql",
  "319_sprint69_dynamic_container_authority_foundation.sql",
]);
const IDENTIFIER = /^[A-Za-z0-9_]+$/u;

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function extractCreatedTableDefinitions(sql) {
  const definitions = [];
  const pattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?\s*\(([\s\S]*?)\)\s*ENGINE\s*=/giu;
  for (const match of String(sql).matchAll(pattern)) {
    const table = match[1];
    const body = match[2];
    const columns = unique([...body.matchAll(/^\s*`([A-Za-z0-9_]+)`\s+/gmu)].map((entry) => entry[1]));
    const indexes = [];
    if (/^\s*PRIMARY\s+KEY\s*\(/imu.test(body)) indexes.push("PRIMARY");
    for (const entry of body.matchAll(/^\s*(?:UNIQUE\s+)?KEY\s+`([A-Za-z0-9_]+)`\s*\(/gimu)) indexes.push(entry[1]);
    definitions.push({ table, columns, indexes: unique(indexes) });
  }
  if (!definitions.length || definitions.some((entry) => !IDENTIFIER.test(entry.table))) {
    throw new Error("Unable to derive bounded table definitions from the repository migration.");
  }
  return definitions;
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

async function queryRows(pool, sql, params = [], audit = []) {
  if (/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|REPLACE|TRUNCATE|CALL|GRANT|REVOKE|LOCK|UNLOCK|SET)\b/iu.test(sql)) {
    throw new Error("Mutation-capable SQL is forbidden in the Production schema baseline collector.");
  }
  if (/SELECT\s+\*/iu.test(sql)) {
    throw new Error("SELECT * is forbidden in the Production schema baseline collector.");
  }
  audit.push({ sql, parameter_count: params.length });
  const [rows] = await pool.query(sql, params);
  return rows || [];
}

async function loadMigrationContract(migration, readFile = fs.readFile) {
  const file = path.join(MIGRATIONS_ROOT, migration);
  const sql = await readFile(file, "utf8");
  const definitions = extractCreatedTableDefinitions(sql);
  return {
    migration_file: migration,
    repository_checksum_sha256: sha256(sql),
    repository_statement_count: splitGovernedMigrationStatements(sql).length,
    expected_tables: definitions.map((entry) => entry.table),
    expected_columns: definitions.flatMap((entry) => entry.columns.map((column) => ({ table: entry.table, column }))),
    expected_indexes: definitions.flatMap((entry) => entry.indexes.map((index) => ({ table: entry.table, index }))),
  };
}

function mapColumns(rows) {
  return rows.map((row) => ({
    table_name: row.TABLE_NAME,
    column_name: row.COLUMN_NAME,
    ordinal_position: Number(row.ORDINAL_POSITION || 0),
    column_type: row.COLUMN_TYPE,
    nullable: row.IS_NULLABLE,
    default_present: row.COLUMN_DEFAULT !== null && row.COLUMN_DEFAULT !== undefined,
    extra: row.EXTRA || "",
  }));
}

function mapIndexes(rows) {
  return rows.map((row) => ({
    table_name: row.TABLE_NAME,
    index_name: row.INDEX_NAME,
    column_name: row.COLUMN_NAME,
    sequence: Number(row.SEQ_IN_INDEX || 0),
    non_unique: Number(row.NON_UNIQUE || 0),
  }));
}

function mapLedger(row) {
  if (!row) return { found: false };
  return {
    found: true,
    run_id: row.run_id || null,
    migration_file: row.migration_file,
    migration_checksum_sha256: row.migration_checksum_sha256 || null,
    mode: row.mode || null,
    applied_at: row.applied_at || null,
    statement_count: Number(row.statement_count || 0),
    preflight_status: row.preflight_status || null,
    preflight_risk_count: Number(row.preflight_risk_count || 0),
    secrets_included: Boolean(Number(row.secrets_included || 0)),
    capability_envelope_id_present: Boolean(row.capability_envelope_id || row.capability_envelope_id_present),
  };
}

function migrationGaps(entry, ledgerTablePresent = true) {
  const items = [];
  if (entry.schema.missing_tables.length) items.push({ migration_file: entry.migration_file, code: "missing_expected_tables", tables: entry.schema.missing_tables });
  if (entry.schema.missing_columns?.length) items.push({ migration_file: entry.migration_file, code: "missing_expected_columns", columns: entry.schema.missing_columns });
  if (entry.schema.missing_indexes?.length) items.push({ migration_file: entry.migration_file, code: "missing_expected_indexes", indexes: entry.schema.missing_indexes });
  if (!entry.ledger.found) items.push({ migration_file: entry.migration_file, code: ledgerTablePresent ? "migration_ledger_entry_missing" : "migration_ledger_table_missing" });
  if (entry.ledger.found && !entry.checks.ledger_checksum_matches_repository) items.push({ migration_file: entry.migration_file, code: "ledger_checksum_mismatch" });
  if (entry.ledger.found && !entry.checks.ledger_statement_count_matches_repository) items.push({ migration_file: entry.migration_file, code: "ledger_statement_count_mismatch" });
  if (entry.ledger.found && !entry.checks.ledger_secrets_flag_safe) items.push({ migration_file: entry.migration_file, code: "ledger_secrets_flag_unsafe" });
  return items;
}

export async function collectRetailCommerceProductionSchemaBaseline(options = {}) {
  const pool = options.pool || getPool();
  const readFile = options.readFile || fs.readFile;
  const now = options.now || (() => new Date());
  const queryAudit = [];
  const contracts = [];
  for (const migration of MIGRATIONS) contracts.push(await loadMigrationContract(migration, readFile));

  const databaseRows = await queryRows(pool, "SELECT DATABASE() AS database_name", [], queryAudit);
  const databaseName = String(databaseRows[0]?.database_name || "");
  const ledgerTableRows = await queryRows(
    pool,
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    ["governed_migration_ledger"],
    queryAudit,
  );
  const ledgerTablePresent = ledgerTableRows.some((row) => row.TABLE_NAME === "governed_migration_ledger");

  const migrations = [];
  for (const contract of contracts) {
    const tableRows = await queryRows(
      pool,
      `SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders(contract.expected_tables)}) ORDER BY TABLE_NAME`,
      contract.expected_tables,
      queryAudit,
    );
    const columnRows = await queryRows(
      pool,
      `SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders(contract.expected_tables)}) ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      contract.expected_tables,
      queryAudit,
    );
    const indexRows = await queryRows(
      pool,
      `SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX, NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders(contract.expected_tables)}) ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      contract.expected_tables,
      queryAudit,
    );
    const ledgerRows = ledgerTablePresent
      ? await queryRows(
        pool,
        "SELECT run_id, migration_file, migration_checksum_sha256, mode, applied_at, statement_count, preflight_status, preflight_risk_count, secrets_included, capability_envelope_id FROM governed_migration_ledger WHERE migration_file = ? ORDER BY applied_at DESC LIMIT 1",
        [contract.migration_file],
        queryAudit,
      )
      : [];

    const presentTables = unique(tableRows.map((row) => row.TABLE_NAME));
    const missingTables = contract.expected_tables.filter((table) => !presentTables.includes(table));
    const ledger = mapLedger(ledgerRows[0]);
    const checksumMatches = ledger.found && ledger.migration_checksum_sha256 === contract.repository_checksum_sha256;
    const statementCountMatches = ledger.found && ledger.statement_count === contract.repository_statement_count;

    migrations.push({
      ...contract,
      schema: {
        present_tables: tableRows.map((row) => ({
          table_name: row.TABLE_NAME,
          engine: row.ENGINE || null,
          collation: row.TABLE_COLLATION || null,
        })),
        missing_tables: missingTables,
        missing_columns: [],
        missing_indexes: [],
        columns: mapColumns(columnRows),
        indexes: mapIndexes(indexRows),
      },
      ledger,
      checks: {
        all_expected_tables_present: missingTables.length === 0,
        all_expected_columns_present: true,
        all_expected_indexes_present: true,
        ledger_table_present: ledgerTablePresent,
        ledger_entry_found: ledger.found,
        ledger_checksum_matches_repository: checksumMatches,
        ledger_statement_count_matches_repository: statementCountMatches,
        ledger_secrets_flag_safe: !ledger.found || ledger.secrets_included === false,
      },
    });
  }

  const gaps = migrations.flatMap((entry) => migrationGaps(entry, ledgerTablePresent));

  return {
    contract: "mad4b.retail-commerce-production-schema-baseline.v1",
    generated_at: now().toISOString(),
    source_repository_sha: process.env.GITHUB_SHA || null,
    collection_source: "direct_database_metadata",
    environment: process.env.GITHUB_ACTIONS === "true" ? "github_actions_production_environment" : "direct_read_only_client",
    database_identity_sha256: databaseName ? sha256(databaseName) : null,
    authoritative_database_connection_succeeded: true,
    baseline_collected: true,
    parity_status: gaps.length ? "gaps_detected" : "pass",
    migrations,
    gaps,
    safety: {
      query_count: queryAudit.length,
      statements: queryAudit,
      select_only: true,
      information_schema_only_for_schema: true,
      migration_ledger_metadata_only: true,
      row_data_read: false,
      freeform_sql_accepted: false,
      sql_execution: true,
      mutation_sql_execution: false,
      migration_dry_run: false,
      migration_apply: false,
      database_mutation: false,
      runtime_api_request_executed: false,
      provider_call: false,
      credential_values_returned: false,
      external_send: false,
      external_write: false,
      secrets_included: false,
    },
  };
}

function normalizeRuntimeBaseUrl(value = CANONICAL_RUNTIME_BASE_URL) {
  const url = new URL(String(value || CANONICAL_RUNTIME_BASE_URL));
  if (url.origin !== CANONICAL_RUNTIME_BASE_URL || !["", "/"].includes(url.pathname) || url.search || url.hash || url.username || url.password) {
    throw new Error("Retail Commerce Production schema runtime readback requires the canonical https://auth.mad4b.com origin.");
  }
  return CANONICAL_RUNTIME_BASE_URL;
}

function parsedJson(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || (!text.startsWith("{") && !text.startsWith("["))) return value;
  try { return JSON.parse(text); } catch { return value; }
}

function findObject(value, predicate, seen = new Set()) {
  value = parsedJson(value);
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (predicate(value)) return value;
  for (const child of Object.values(value)) {
    const found = findObject(child, predicate, seen);
    if (found) return found;
  }
  return null;
}

async function runtimeToolCall({ runtimeBaseUrl, backendApiKey, body, fetchFn, timeoutMs = 180000 }) {
  const response = await fetchFn(`${runtimeBaseUrl}/gpt/tools/call`, {
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${backendApiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; }
  catch { payload = { non_json_response: true }; }
  if (!response.ok || payload?.ok === false) {
    const error = new Error(`Governed runtime schema readback failed with HTTP ${response.status}.`);
    error.code = findObject(payload, (entry) => typeof entry?.code === "string")?.code || "runtime_schema_readback_failed";
    throw error;
  }
  if (findObject(payload, (entry) => entry?.response_chunked === true)) {
    const error = new Error("Governed runtime schema readback unexpectedly returned a chunked response.");
    error.code = "runtime_schema_readback_chunked_response";
    throw error;
  }
  return payload;
}

function normalizeRuntimeMigration(contract, readback) {
  if (!readback || readback.migration !== contract.migration_file) {
    throw new Error(`Runtime schema readback did not return the expected migration ${contract.migration_file}.`);
  }
  if (readback.migration_checksum_sha256 !== contract.repository_checksum_sha256) {
    throw new Error(`Runtime schema readback checksum mismatch for ${contract.migration_file}.`);
  }
  if (Number(readback.statement_count) !== contract.repository_statement_count) {
    throw new Error(`Runtime schema readback statement-count mismatch for ${contract.migration_file}.`);
  }
  for (const [key, expected] of [
    ["provider_call_executed", false],
    ["external_write_executed", false],
    ["row_data_read", false],
    ["freeform_sql_accepted", false],
    ["secrets_included", false],
  ]) {
    if (readback[key] !== expected) throw new Error(`Runtime schema readback safety marker ${key} is invalid.`);
  }

  const missing = readback.expectations?.missing || {};
  const ledger = mapLedger(readback.ledger?.found ? readback.ledger : null);
  const schema = readback.schema || {};
  const checksumMatches = ledger.found && ledger.migration_checksum_sha256 === contract.repository_checksum_sha256;
  const statementCountMatches = ledger.found && ledger.statement_count === contract.repository_statement_count;
  const missingTables = Array.isArray(missing.tables) ? missing.tables : [];
  const missingColumns = Array.isArray(missing.columns) ? missing.columns : [];
  const missingIndexes = Array.isArray(missing.indexes) ? missing.indexes : [];

  return {
    ...contract,
    runtime_readback_status: readback.readback_status,
    schema: {
      present_tables: (schema.tables || []).map((row) => ({ table_name: row.TABLE_NAME, engine: null, collation: null })),
      missing_tables: missingTables,
      missing_columns: missingColumns,
      missing_indexes: missingIndexes,
      columns: mapColumns(schema.columns || []),
      indexes: mapIndexes(schema.indexes || []),
    },
    ledger,
    checks: {
      all_expected_tables_present: missingTables.length === 0,
      all_expected_columns_present: missingColumns.length === 0,
      all_expected_indexes_present: missingIndexes.length === 0,
      ledger_table_present: ledger.found,
      ledger_entry_found: ledger.found,
      ledger_checksum_matches_repository: checksumMatches,
      ledger_statement_count_matches_repository: statementCountMatches,
      ledger_secrets_flag_safe: !ledger.found || ledger.secrets_included === false,
    },
  };
}

export async function collectRetailCommerceProductionSchemaRuntimeBaseline(options = {}) {
  const readFile = options.readFile || fs.readFile;
  const now = options.now || (() => new Date());
  const fetchFn = options.fetchFn || globalThis.fetch;
  const runtimeBaseUrl = normalizeRuntimeBaseUrl(options.runtimeBaseUrl || process.env.RUNTIME_BASE_URL || CANONICAL_RUNTIME_BASE_URL);
  const backendApiKey = String(options.backendApiKey || process.env.BACKEND_API_KEY || "").trim();
  if (!backendApiKey) {
    const error = new Error("BACKEND_API_KEY is required for the governed runtime schema readback source.");
    error.code = "missing_backend_api_key";
    throw error;
  }
  if (typeof fetchFn !== "function") throw new Error("A fetch implementation is required for governed runtime schema readback.");

  const contracts = [];
  for (const migration of MIGRATIONS) contracts.push(await loadMigrationContract(migration, readFile));
  const migrations = [];
  for (const contract of contracts) {
    const payload = await runtimeToolCall({
      runtimeBaseUrl,
      backendApiKey,
      fetchFn,
      body: {
        name: "governed_migration_schema_readback",
        tool_args: {
          migration: contract.migration_file,
          expected_checksum_sha256: contract.repository_checksum_sha256,
          expected_statement_count: contract.repository_statement_count,
          expected_tables: contract.expected_tables,
          expected_columns: contract.expected_columns,
          expected_indexes: contract.expected_indexes,
          _response: { max_chars: 150000 },
        },
      },
    });
    const readback = findObject(payload, (entry) => entry?.readback_status && entry?.migration === contract.migration_file);
    migrations.push(normalizeRuntimeMigration(contract, readback));
  }

  const gaps = migrations.flatMap((entry) => migrationGaps(entry, true));
  return {
    contract: "mad4b.retail-commerce-production-schema-baseline.v1",
    generated_at: now().toISOString(),
    source_repository_sha: process.env.GITHUB_SHA || null,
    collection_source: "governed_production_runtime_schema_readback",
    environment: "canonical_production_runtime",
    runtime_base_url: runtimeBaseUrl,
    database_identity_sha256: null,
    database_identity_disclosed: false,
    authoritative_database_connection_succeeded: true,
    baseline_collected: true,
    parity_status: gaps.length ? "gaps_detected" : "pass",
    migrations,
    gaps,
    safety: {
      runtime_tool_calls: migrations.length,
      runtime_tool_name: "governed_migration_schema_readback",
      select_only: true,
      information_schema_only_for_schema: true,
      migration_ledger_metadata_only: true,
      row_data_read: false,
      freeform_sql_accepted: false,
      sql_execution: true,
      local_sql_execution: false,
      mutation_sql_execution: false,
      migration_dry_run: false,
      migration_apply: false,
      database_mutation: false,
      runtime_api_request_executed: true,
      provider_call: false,
      credential_values_returned: false,
      external_send: false,
      external_write: false,
      secrets_included: false,
    },
  };
}

async function runCli() {
  const reportPathArg = process.argv.find((arg) => arg.startsWith("--report="));
  const sourceArg = process.argv.find((arg) => arg.startsWith("--source="));
  const sourceMode = sourceArg ? sourceArg.slice("--source=".length) : "direct_db";
  const reportPath = path.resolve(reportPathArg ? reportPathArg.slice("--report=".length) : DEFAULT_REPORT_PATH);
  let report;
  let exitCode = 0;
  try {
    if (sourceMode === "runtime_api") report = await collectRetailCommerceProductionSchemaRuntimeBaseline();
    else if (sourceMode === "direct_db") report = await collectRetailCommerceProductionSchemaBaseline();
    else throw new Error(`Unsupported Retail Commerce schema baseline source: ${sourceMode}`);
  } catch (error) {
    report = {
      contract: "mad4b.retail-commerce-production-schema-baseline.v1",
      generated_at: new Date().toISOString(),
      source_repository_sha: process.env.GITHUB_SHA || null,
      collection_source: sourceMode === "runtime_api" ? "governed_production_runtime_schema_readback" : "direct_database_metadata",
      authoritative_database_connection_succeeded: false,
      baseline_collected: false,
      parity_status: "collection_failed",
      error: { code: error?.code || "production_schema_baseline_failed", message: error?.message || "Production schema baseline collection failed." },
      safety: {
        select_only: true,
        row_data_read: false,
        freeform_sql_accepted: false,
        sql_execution: false,
        mutation_sql_execution: false,
        migration_dry_run: false,
        migration_apply: false,
        database_mutation: false,
        runtime_api_request_executed: sourceMode === "runtime_api",
        provider_call: false,
        credential_values_returned: false,
        external_send: false,
        external_write: false,
        secrets_included: false,
      },
    };
    exitCode = 1;
  }
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: report.baseline_collected === true, report_path: reportPath, collection_source: report.collection_source, parity_status: report.parity_status, secrets_included: false }));
  process.exitCode = exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await runCli();
