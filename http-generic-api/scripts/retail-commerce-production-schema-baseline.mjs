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

function extractCreatedTables(sql) {
  const tables = [...String(sql).matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/giu)]
    .map((match) => match[1]);
  const normalized = unique(tables);
  if (!normalized.length || normalized.some((table) => !IDENTIFIER.test(table))) {
    throw new Error("Unable to derive a bounded table allowlist from the repository migration.");
  }
  return normalized;
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
  return {
    migration_file: migration,
    repository_checksum_sha256: sha256(sql),
    repository_statement_count: splitGovernedMigrationStatements(sql).length,
    expected_tables: extractCreatedTables(sql),
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
    capability_envelope_id_present: Boolean(row.capability_envelope_id),
  };
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
        columns: mapColumns(columnRows),
        indexes: mapIndexes(indexRows),
      },
      ledger,
      checks: {
        all_expected_tables_present: missingTables.length === 0,
        ledger_table_present: ledgerTablePresent,
        ledger_entry_found: ledger.found,
        ledger_checksum_matches_repository: checksumMatches,
        ledger_statement_count_matches_repository: statementCountMatches,
        ledger_secrets_flag_safe: !ledger.found || ledger.secrets_included === false,
      },
    });
  }

  const gaps = migrations.flatMap((entry) => {
    const items = [];
    if (entry.schema.missing_tables.length) items.push({ migration_file: entry.migration_file, code: "missing_expected_tables", tables: entry.schema.missing_tables });
    if (!entry.ledger.found) items.push({ migration_file: entry.migration_file, code: ledgerTablePresent ? "migration_ledger_entry_missing" : "migration_ledger_table_missing" });
    if (entry.ledger.found && !entry.checks.ledger_checksum_matches_repository) items.push({ migration_file: entry.migration_file, code: "ledger_checksum_mismatch" });
    if (entry.ledger.found && !entry.checks.ledger_statement_count_matches_repository) items.push({ migration_file: entry.migration_file, code: "ledger_statement_count_mismatch" });
    if (entry.ledger.found && !entry.checks.ledger_secrets_flag_safe) items.push({ migration_file: entry.migration_file, code: "ledger_secrets_flag_unsafe" });
    return items;
  });

  return {
    contract: "mad4b.retail-commerce-production-schema-baseline.v1",
    generated_at: now().toISOString(),
    source_repository_sha: process.env.GITHUB_SHA || null,
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
      sql_execution: false,
      migration_dry_run: false,
      migration_apply: false,
      database_mutation: false,
      provider_call: false,
      credential_values_returned: false,
      external_send: false,
      secrets_included: false,
    },
  };
}

async function runCli() {
  const reportPathArg = process.argv.find((arg) => arg.startsWith("--report="));
  const reportPath = path.resolve(reportPathArg ? reportPathArg.slice("--report=".length) : DEFAULT_REPORT_PATH);
  let report;
  let exitCode = 0;
  try {
    report = await collectRetailCommerceProductionSchemaBaseline();
  } catch (error) {
    report = {
      contract: "mad4b.retail-commerce-production-schema-baseline.v1",
      generated_at: new Date().toISOString(),
      source_repository_sha: process.env.GITHUB_SHA || null,
      authoritative_database_connection_succeeded: false,
      baseline_collected: false,
      parity_status: "collection_failed",
      error: { code: error?.code || "production_schema_baseline_failed", message: error?.message || "Production schema baseline collection failed." },
      safety: {
        select_only: true,
        row_data_read: false,
        freeform_sql_accepted: false,
        sql_execution: false,
        migration_dry_run: false,
        migration_apply: false,
        database_mutation: false,
        provider_call: false,
        credential_values_returned: false,
        external_send: false,
        secrets_included: false,
      },
    };
    exitCode = 1;
  }
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: report.baseline_collected === true, report_path: reportPath, parity_status: report.parity_status, secrets_included: false }));
  process.exitCode = exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await runCli();
