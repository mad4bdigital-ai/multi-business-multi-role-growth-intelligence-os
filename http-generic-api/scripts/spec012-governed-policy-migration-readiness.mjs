#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assessMigrationSqlPreflight,
  splitSqlStatements,
} from "../releaseReadiness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(
  API_DIR,
  "artifacts",
  "spec012-governed-policy-migration-readiness.json",
);

const MIGRATIONS = Object.freeze([
  Object.freeze({
    file: "20260731_governed_policy_questionnaire_foundation.sql",
    expected_tables: Object.freeze([
      "governed_policy_questionnaire_definitions",
      "governed_policy_sessions",
      "governed_policy_answers",
      "governed_policy_compilations",
      "governed_policy_proposals",
      "governed_policy_approvals",
      "governed_policy_versions",
      "governed_policy_invalidation_outbox",
      "governed_policy_rollbacks",
      "governed_policy_activations",
    ]),
    ordering_contract: Object.freeze({
      before: "governed_policy_invalidation_outbox",
      after: "governed_policy_activations",
    }),
  }),
  Object.freeze({
    file: "20260731_governed_policy_registry_authority.sql",
    expected_tables: Object.freeze([
      "governed_policy_safety_bounds",
      "governed_policy_domain_adoptions",
    ]),
    ordering_contract: null,
  }),
]);

function sha256(value = "") {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function stripSqlComments(sql = "") {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/(^|\n)\s*--[^\n]*/gu, "$1");
}

function destructiveFindings(sql = "") {
  const source = stripSqlComments(sql);
  const rules = [
    ["drop_statement", /\bDROP\s+(?:TABLE|VIEW|DATABASE|SCHEMA|INDEX|TRIGGER|PROCEDURE|FUNCTION|EVENT)\b/iu],
    ["truncate_statement", /\bTRUNCATE\s+TABLE\b/iu],
    ["delete_statement", /\bDELETE\s+FROM\b/iu],
    ["alter_drop", /\bALTER\s+TABLE\b[\s\S]{0,500}\bDROP\s+(?:COLUMN|INDEX|KEY|CONSTRAINT|FOREIGN\s+KEY)\b/iu],
    ["rename_table", /\bRENAME\s+TABLE\b/iu],
    ["foreign_key_checks_disabled", /\bSET\s+FOREIGN_KEY_CHECKS\s*=\s*0\b/iu],
  ];
  return rules
    .filter(([, pattern]) => pattern.test(source))
    .map(([code]) => code);
}

function hasSeedMutation(sql = "") {
  const source = stripSqlComments(sql);
  return /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+`?governed_policy_/iu.test(source);
}

function hasEmbeddedAuthorization(sql = "") {
  const source = stripSqlComments(sql);
  return (
    /\bINSERT\s+INTO\s+`?governed_migration_authorization_registry`?/iu.test(source)
    || /\ballow_apply\b/iu.test(source)
  );
}

function tableIsDeclared(sql, table) {
  const escaped = String(table).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `\\bCREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+\`?${escaped}\`?\\b`,
    "iu",
  ).test(sql);
}

function orderingContractPasses(sql, contract) {
  if (!contract) return true;
  const before = sql.indexOf(`CREATE TABLE IF NOT EXISTS \`${contract.before}\``);
  const after = sql.indexOf(`CREATE TABLE IF NOT EXISTS \`${contract.after}\``);
  return before >= 0 && after >= 0 && before < after;
}

function parseOutputPath(argv = []) {
  const argument = argv.find((value) => value.startsWith("--output="));
  if (!argument) return DEFAULT_OUTPUT;
  const requested = path.resolve(argument.slice("--output=".length));
  if (!requested.endsWith(".json")) {
    throw new Error("SPEC012_T026_OUTPUT_MUST_BE_JSON");
  }
  return requested;
}

export async function buildSpec012GovernedPolicyMigrationReadiness({
  apiDir = API_DIR,
} = {}) {
  const migrations = [];

  for (const contract of MIGRATIONS) {
    const migrationPath = path.join(apiDir, "migrations", contract.file);
    const sql = await readFile(migrationPath, "utf8");
    const statements = splitSqlStatements(sql);
    const staticPreflight = assessMigrationSqlPreflight(contract.file, sql);
    const missingExpectedTables = contract.expected_tables.filter(
      (table) => !tableIsDeclared(sql, table),
    );
    const destructive = destructiveFindings(sql);
    const seedMutationDetected = hasSeedMutation(sql);
    const authorizationEmbedded = hasEmbeddedAuthorization(sql);
    const orderingContractSatisfied = orderingContractPasses(
      sql,
      contract.ordering_contract,
    );

    const ready = (
      staticPreflight.status === "pass"
      && statements.length > 0
      && missingExpectedTables.length === 0
      && destructive.length === 0
      && seedMutationDetected === false
      && authorizationEmbedded === false
      && orderingContractSatisfied
    );

    migrations.push(Object.freeze({
      file: contract.file,
      checksum_sha256: sha256(sql),
      statement_count: statements.length,
      expected_tables: [...contract.expected_tables],
      missing_expected_tables: missingExpectedTables,
      static_preflight: staticPreflight,
      destructive_findings: destructive,
      seed_mutation_detected: seedMutationDetected,
      authorization_embedded: authorizationEmbedded,
      ordering_contract_satisfied: orderingContractSatisfied,
      readiness_status: ready ? "ready_for_governed_preflight" : "blocked",
      applies_sql: false,
      records_ledger: false,
      secrets_included: false,
    }));
  }

  const ready = migrations.every(
    (migration) => migration.readiness_status === "ready_for_governed_preflight",
  );

  return Object.freeze({
    schema_version: 1,
    evidence_contract: "spec012_governed_policy_migration_readiness_v1",
    feature_key: "012-tenant-activation-lifecycle",
    task: "T026",
    status: ready ? "ready_for_governed_preflight" : "blocked",
    ready,
    migrations,
    authorization_status: "not_authorized",
    apply_allowed: false,
    requires_separate_checksum_bound_authorization: true,
    requires_same_cycle_dry_run: true,
    requires_typed_confirmation: true,
    requires_ledger_readback: true,
    requires_schema_readback: true,
    database_mutation_performed: false,
    migration_ledger_write_performed: false,
    runtime_wiring_performed: false,
    production_mutation_performed: false,
    provider_calls_performed: false,
    external_writes_performed: false,
    secrets_included: false,
  });
}

async function main() {
  const report = await buildSpec012GovernedPolicyMigrationReadiness();
  const outputPath = parseOutputPath(process.argv.slice(2));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ready) process.exitCode = 2;
}

const executed = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (executed === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(
      `Spec 012 T026 readiness failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
