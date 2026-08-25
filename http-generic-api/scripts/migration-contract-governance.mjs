#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(scriptDir, "..");
const defaultRepoRoot = path.resolve(apiRoot, "..");
const parserPath = path.join(apiRoot, "scripts", "staging-sql-parser.mjs");
const { splitStatements } = await import(pathToFileURL(parserPath).href);
const { inspectOrderedMigrationChainCollations } = await import(pathToFileURL(path.join(apiRoot, "databaseCollationPolicyGuard.js")).href);
const { inspectOrderedMigrationChainEnumSeeds } = await import(pathToFileURL(path.join(apiRoot, "databaseEnumSeedPolicyGuard.js")).href);
const { inspectOrderedMigrationChainTextWidths } = await import(pathToFileURL(path.join(apiRoot, "databaseTextWidthPolicyGuard.js")).href);

function parseArgs(argv) {
  const options = { root: defaultRepoRoot, expectedCommit: "", output: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--root") options.root = argv[++index] || options.root;
    else if (item.startsWith("--root=")) options.root = item.slice("--root=".length);
    else if (item === "--expected-commit") options.expectedCommit = argv[++index] || "";
    else if (item.startsWith("--expected-commit=")) options.expectedCommit = item.slice("--expected-commit=".length);
    else if (item === "--output") options.output = argv[++index] || "";
    else if (item.startsWith("--output=")) options.output = item.slice("--output=".length);
    else throw new Error(`Unsupported argument: ${item}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(options.root);
const migrationsDir = path.join(repoRoot, "http-generic-api", "migrations");
const policyPath = path.join(repoRoot, "http-generic-api", "config", "staging-migration-contract-policy.json");
const collationPolicyPath = path.join(repoRoot, "http-generic-api", "config", "database-engine-collation-policy.json");
const builderPath = path.join(repoRoot, "http-generic-api", "scripts", "build-staging-schema-bundle.mjs");
const outputPath = path.resolve(options.output || process.env.MIGRATION_CONTRACT_GOVERNANCE_OUTPUT || path.join(process.env.TEST_SUITE_REPORT_DIR || os.tmpdir(), "migration-contract-governance.json"));

function normalize(value) { return String(value ?? "").replaceAll("\r", "").trim(); }
function stripLeadingComments(value) {
  return normalize(value).replace(/^(?:(?:--[^\n]*\n)|(?:\/\*[\s\S]*?\*\/)|\s)*/u, "");
}
function tableName(value) { return normalize(value).replaceAll("`", "").split(".").pop().toLowerCase(); }
function sqlLiteralValue(token) {
  const value = normalize(token);
  if (!value.startsWith("'") || !value.endsWith("'")) return null;
  return value.slice(1, -1).replaceAll("''", "'").replaceAll("\\\\", "\\");
}
function runGit(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function pushFinding(report, category, severity, file, detail, statement = "", evidence = {}) {
  report.findings.push({ category, severity, file, detail, statement: normalize(statement).slice(0, 1600), ...evidence });
}
function migrationFiles() {
  return fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => Number(left.match(/^\d+/u)?.[0] || 0) - Number(right.match(/^\d+/u)?.[0] || 0) || left.localeCompare(right));
}
function insertInfo(statement) {
  const match = statement.match(/^\s*INSERT\s+(IGNORE\s+)?INTO\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))/iu);
  if (!match) return null;
  const after = statement.slice(match[0].length);
  const leadingWhitespace = after.match(/^\s*/u)?.[0].length ?? 0;
  const open = leadingWhitespace;
  let columns = [];
  if (after[open] === "(") {
    let depth = 0;
    let quote = null;
    let escaped = false;
    let close = -1;
    for (let index = open; index < after.length; index += 1) {
      const current = after[index];
      const next = after[index + 1] ?? "";
      if (quote) {
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === quote) {
          if (next === quote) index += 1;
          else quote = null;
        }
        continue;
      }
      if (current === "'" || current === '"' || current === "`") quote = current;
      else if (current === "(") depth += 1;
      else if (current === ")") {
        depth -= 1;
        if (depth === 0) { close = index; break; }
      }
    }
    if (close >= 0) columns = after.slice(open + 1, close).split(",").map((column) => normalize(column).replaceAll("`", "").replace(/\s+/gu, "").toLowerCase());
  }
  return { table: tableName(match[2] || match[3]), columns, hasColumns: columns.length > 0, ignore: Boolean(match[1]), duplicate: /\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/iu.test(statement), notExists: /\bNOT\s+EXISTS\s*\(/iu.test(statement) };
}
function updateInfo(statement) {
  const match = statement.match(/^\s*UPDATE\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+SET\s+/iu);
  return match ? { table: tableName(match[1] || match[2]) } : null;
}
function hasWidening(statement, table, column, types) {
  const escapedTable = table.replace(/[.*+?^${}()|[\[\]\\]/gu, "\\$&");
  const escapedColumn = column.replace(/[.*+?^${}()|[\[\]\\]/gu, "\\$&");
  const tablePattern = new RegExp(`\\bALTER\\s+TABLE\\s+${escapedTable}`, "iu");
  if (!tablePattern.test(statement.replaceAll("`", ""))) return false;
  const escapedTypes = types.map((type) => String(type).replace(/[.*+?^${}()|[\[\]\\]/gu, "\\$&"));
  const columnPattern = new RegExp(`\\b(?:MODIFY|CHANGE)\\s+(?:COLUMN\\s+)?${escapedColumn}\\s+(${escapedTypes.join("|")})(?=\\s|$)`, "iu");
  return columnPattern.test(statement.replaceAll("`", ""));
}
function inspectForbidden(report, policy, file, statement) {
  for (const item of policy.forbidden_sql_patterns || []) {
    let pattern;
    try { pattern = new RegExp(item.pattern, "imu"); } catch (error) { pushFinding(report, "policy_definition", "blocker", "staging-migration-contract-policy.json", `invalid forbidden SQL regex ${item.id}: ${error.message}`); continue; }
    if (pattern.test(statement)) pushFinding(report, "mariadb_compatibility", "blocker", file, `forbidden SQL pattern: ${item.id}`, statement, { rule_id: item.id });
  }
}

let policy;
try { policy = readJson(policyPath); } catch (error) {
  console.error(JSON.stringify({ contract: "mad4b.staging.migration-contract-governance.v1", ok: false, error: `policy unreadable: ${error.message}`, safety: { database_connection_performed: false, provider_access_performed: false, credential_access_performed: false, data_export_performed: false, runtime_mutation_performed: false, secrets_included: false } }, null, 2));
  process.exit(1);
}
const expectedCommit = normalize(options.expectedCommit || runGit(["rev-parse", "HEAD"])).toLowerCase();
if (!/^[0-9a-f]{40}$/u.test(expectedCommit)) throw new Error(`expected commit must be a full SHA: ${expectedCommit}`);

const report = {
  contract: "mad4b.staging.migration-contract-governance.v1",
  generated_at: new Date().toISOString(),
  source_commit: expectedCommit,
  source_repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
  engine: policy.engine,
  scope: policy.scope,
  policy_file: "http-generic-api/config/staging-migration-contract-policy.json",
  counts: { migration_files: 0, migration_statements: 0, checked_required_id_writers: 0, checked_secret_reference_writers: 0, checked_width_writers: 0, forbidden_pattern_hits: 0 },
  findings: [],
  safety: { database_connection_performed: false, database_mutation_performed: false, provider_access_performed: false, credential_access_performed: false, data_export_performed: false, runtime_mutation_performed: false, secrets_included: false },
  preuse_contract: policy.preuse_contract || null,
  collation_chain_contract: policy.collation_chain_contract || null,
  enum_seed_chain_contract: policy.enum_seed_chain_contract || null,
  text_width_chain_contract: policy.text_width_chain_contract || null,
  environment_profiles: {},
  database_role_topology: policy.database_role_topology || null,
  migration_history: policy.migration_history || null,
  execution_authority: policy.execution_authority || null,
};
const expectedEnvironmentProfiles = {
  staging_local_windows_docker: { environment: "staging", source_branch: "main", execution_transport: "local_cli", target_key_prefix: "staging-" },
  production_hostinger_autodeploy: { environment: "production", source_branch: "Production", execution_transport: "github_workflow", target_key_prefix: "production-" },
};
for (const [key, expected] of Object.entries(expectedEnvironmentProfiles)) {
  const profile = policy.environment_profiles?.[key];
  if (!profile || Object.entries(expected).some(([field, value]) => profile[field] !== value) || profile.automatic_mutation_allowed !== false) {
    pushFinding(report, "environment_isolation", "blocker", "staging-migration-contract-policy.json", `${key} must declare its canonical environment, source branch, transport, target namespace, and disabled automatic mutation`);
    continue;
  }
  if (key === "staging_local_windows_docker" && (profile.hostinger_access_allowed !== false || profile.production_access_allowed !== false)) {
    pushFinding(report, "environment_isolation", "blocker", "staging-migration-contract-policy.json", "Staging profile must deny Hostinger and Production access");
  }
  if (key === "production_hostinger_autodeploy" && (profile.local_docker_access_allowed !== false || profile.exact_source_sha_required !== true || profile.typed_approval_required !== true)) {
    pushFinding(report, "environment_isolation", "blocker", "staging-migration-contract-policy.json", "Production profile must deny local Docker and require exact source SHA plus typed approval");
  }
  report.environment_profiles[key] = { ...profile, analysis_only: true, execution_authority_granted: false };
}
const expectedRoles = ["governance", "runtime", "runtime_persistence"];
if (Object.keys(policy.database_role_topology || {}).sort().join(",") !== expectedRoles.join(",") || expectedRoles.some((role) => policy.database_role_topology[role]?.required !== true)) {
  pushFinding(report, "database_role_topology", "blocker", "staging-migration-contract-policy.json", "runtime, governance, and runtime_persistence must all be declared as required roles");
}
if (policy.database_role_topology?.governance?.owns_migration_ledger !== true || !policy.database_role_topology?.runtime_persistence?.owns_tables?.includes("governed_tool_response_chunks")) {
  pushFinding(report, "database_role_topology", "blocker", "staging-migration-contract-policy.json", "governance must own the migration ledger and runtime_persistence must own governed response chunks");
}
if (policy.migration_history?.published_checksum_verification_required !== true || policy.migration_history?.silent_ledger_reconciliation_allowed !== false || policy.migration_history?.production_apply_requires_ledger_compatibility !== true) {
  pushFinding(report, "migration_history", "blocker", "staging-migration-contract-policy.json", "published checksums and Production ledger compatibility must be enforced without silent reconciliation");
}
if (policy.execution_authority?.discovery_grants_execution !== false || policy.execution_authority?.production_auto_apply_allowed !== false || policy.execution_authority?.separate_grants_approval_required !== true || policy.execution_authority?.same_cycle_postcondition_readback_required !== true || policy.execution_authority?.nonempty_destructive_rebuild_allowed !== false) {
  pushFinding(report, "execution_authority", "blocker", "staging-migration-contract-policy.json", "catalog discovery cannot authorize execution, Production auto-apply, combined grants, skipped readback, or destructive nonempty rebuild");
}
const requiredPreuseContractFlags = [
  "check_create_index_table_and_columns",
  "check_alter_add_index_table_and_columns",
  "check_foreign_key_parent_tables",
  "check_table_source_operations",
  "check_view_source_columns",
  "check_insert_column_value_arity",
  "check_update_target_columns",
  "check_rename_and_drop_targets",
  "fail_on_unresolved_gaps",
];
if (!policy.preuse_contract || requiredPreuseContractFlags.some((flag) => policy.preuse_contract[flag] !== true)) {
  pushFinding(report, "policy_definition", "blocker", "staging-migration-contract-policy.json", "preuse_contract must enable every required dependency/ordering guard");
}

let collationPolicy;
try { collationPolicy = readJson(collationPolicyPath); } catch (error) {
  pushFinding(report, "collation_chain", "blocker", "database-engine-collation-policy.json", `collation policy unreadable: ${error.message}`);
}
const collationContract = policy.collation_chain_contract;
if (!collationContract || collationContract.enabled !== true || collationContract.engine !== "mariadb" || collationContract.fail_on_implicit_mismatch !== true || collationContract.allow_registered_explicit_boundary_warning !== true || collationContract.static_only !== true || collationContract.database_connection_allowed !== false || collationContract.sql_mutation_allowed !== false || collationContract.provider_access_allowed !== false || collationContract.secrets_included !== false) {
  pushFinding(report, "collation_chain", "blocker", "staging-migration-contract-policy.json", "collation_chain_contract must enable the MariaDB static ordered-chain gate and fail on implicit mismatches");
}
const enumSeedContract = policy.enum_seed_chain_contract;
if (!enumSeedContract || enumSeedContract.enabled !== true || enumSeedContract.engine !== "mariadb" || enumSeedContract.fail_on_unsupported_literal !== true || enumSeedContract.inspect_create_alter_enum_domains !== true || enumSeedContract.inspect_insert_replace_update_literals !== true || enumSeedContract.static_only !== true || enumSeedContract.database_connection_allowed !== false || enumSeedContract.sql_mutation_allowed !== false || enumSeedContract.provider_access_allowed !== false || enumSeedContract.credential_access_allowed !== false || enumSeedContract.data_export_allowed !== false || enumSeedContract.runtime_mutation_allowed !== false || enumSeedContract.secrets_included !== false) {
  pushFinding(report, "enum_seed_chain", "blocker", "staging-migration-contract-policy.json", "enum_seed_chain_contract must enable the MariaDB static ordered enum-domain/seed gate and fail on unsupported literals");
}
const textWidthContract = policy.text_width_chain_contract;
if (!textWidthContract || textWidthContract.enabled !== true || textWidthContract.engine !== "mariadb" || textWidthContract.fail_on_literal_overflow !== true || textWidthContract.inspect_create_alter_text_domains !== true || textWidthContract.inspect_insert_replace_update_literals !== true || textWidthContract.static_only !== true || textWidthContract.database_connection_allowed !== false || textWidthContract.sql_mutation_allowed !== false || textWidthContract.provider_access_allowed !== false || textWidthContract.credential_access_allowed !== false || textWidthContract.data_export_allowed !== false || textWidthContract.runtime_mutation_allowed !== false || textWidthContract.secrets_included !== false) {
  pushFinding(report, "text_width_chain", "blocker", "staging-migration-contract-policy.json", "text_width_chain_contract must enable the MariaDB static ordered text-domain/width gate and fail on literal overflow");
}

const files = migrationFiles();
report.counts.migration_files = files.length;
const widthState = new Map((policy.width_contracts || []).map((item) => [`${item.table}.${item.column}`, false]));
const requiredIdRules = new Map((policy.required_insert_columns || []).map((item) => [item.table, item.columns]));
const secretRules = new Map((policy.canonical_unique_guard_contracts || []).map((item) => [item.table, item]));
const directLiteralUniqueKeys = new Map();
const catalogEntries = [];

for (const file of files) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
  const statements = splitStatements(sql);
  catalogEntries.push({ file, sha256: sha256(sql), statement_count: statements.length, discovery_only: true, execution_authorized: false });
  report.counts.migration_statements += statements.length;
  for (const originalStatement of statements) {
    const statement = stripLeadingComments(originalStatement);
    if (!statement) continue;
    inspectForbidden(report, policy, file, statement);
    const insert = insertInfo(statement);
    const update = updateInfo(statement);
    if (insert) {
      const required = requiredIdRules.get(insert.table);
      if (required) {
        report.counts.checked_required_id_writers += 1;
        if (!insert.hasColumns) pushFinding(report, "required_identifier_contract", "blocker", file, `${insert.table} INSERT must declare columns including ${required.join(", ")}`, statement, { table: insert.table, required_columns: required });
        else for (const column of required) if (!insert.columns.includes(column)) pushFinding(report, "required_identifier_contract", "blocker", file, `${insert.table} INSERT omits required identifier ${column}`, statement, { table: insert.table, required_column: column });
      }
      const secretRule = secretRules.get(insert.table);
      if (secretRule) {
        report.counts.checked_secret_reference_writers += 1;
        const hasDuplicateHandling = insert.duplicate;
        const guard = statement.match(/\b(?:WHERE|AND|OR)\s+NOT\s+EXISTS\s*\(([\s\S]*)\)\s*$/iu)?.[1] || "";
        if (!hasDuplicateHandling && !insert.notExists) pushFinding(report, "unique_idempotency_contract", "blocker", file, `${insert.table} INSERT has no ON DUPLICATE KEY UPDATE or NOT EXISTS guard`, statement, { table: insert.table, canonical_key: secretRule.key });
        if (insert.notExists && !new RegExp(`\\b${secretRule.required_guard_tokens[0]}\\b`, "iu").test(guard)) pushFinding(report, "unique_idempotency_contract", "blocker", file, `${insert.table} NOT EXISTS guard must compare ${secretRule.required_guard_tokens.join(", ")}`, statement, { table: insert.table, canonical_key: secretRule.key });
        if (insert.notExists && secretRule.forbidden_guard_tokens.some((token) => new RegExp(`\\b${token}\\b`, "iu").test(guard))) pushFinding(report, "unique_idempotency_contract", "blocker", file, `${insert.table} NOT EXISTS guard narrows the canonical uniqueness key`, statement, { table: insert.table, forbidden_guard_tokens: secretRule.forbidden_guard_tokens });
      }
      for (const contract of policy.width_contracts || []) {
        const key = `${contract.table}.${contract.column}`;
        if (insert.table !== contract.table || !insert.hasColumns || !insert.columns.includes(contract.column)) continue;
        report.counts.checked_width_writers += 1;
        if (widthState.get(key) === true) continue;
        const columnIndex = insert.columns.indexOf(contract.column);
        const valueMatch = statement.match(/\bVALUES\s*\(([\s\S]*)\)/iu);
        if (!valueMatch) continue;
        const values = valueMatch[1].split(/,(?![^()]*\))/u).map((value) => normalize(value));
        const literal = sqlLiteralValue(values[columnIndex]);
        if (typeof literal === "string" && literal.length > contract.initial_max_length) pushFinding(report, "width_before_write", "blocker", file, `${contract.table}.${contract.column} literal length ${literal.length} exceeds ${contract.initial_max_length} before widening`, statement, { table: contract.table, column: contract.column, length: literal.length, max_length: contract.initial_max_length });
      }
      if (insert.table === "secret_references" && insert.hasColumns) {
        const keyColumns = ["tenant_id", "secret_key"];
        const keyIndices = keyColumns.map((column) => insert.columns.indexOf(column));
        if (keyIndices.every((index) => index >= 0)) {
          const valuesMatch = statement.match(/\bVALUES\s*\(([\s\S]*)\)/iu);
          const values = valuesMatch ? valuesMatch[1].split(/,(?![^()]*\))/u).map((value) => normalize(value)) : [];
          const tuple = keyIndices.map((index) => sqlLiteralValue(values[index])).join("|");
          if (tuple && !tuple.includes("null") && !insert.duplicate && !insert.notExists) {
            const previous = directLiteralUniqueKeys.get(tuple);
            if (previous) pushFinding(report, "unique_duplicate_risk", "blocker", file, "secret_references literal unique tuple is repeated without duplicate handling", statement, { tuple, previous });
            else directLiteralUniqueKeys.set(tuple, `${file}`);
          }
        }
      }
    }
    if (update) {
      for (const contract of policy.width_contracts || []) {
        const key = `${contract.table}.${contract.column}`;
        if (update.table !== contract.table) continue;
        const tagAssignment = statement.match(new RegExp(`\\b${contract.column}\\s*=\\s*'((?:''|[^'])*)'`, "iu"));
        if (!tagAssignment) continue;
        report.counts.checked_width_writers += 1;
        const length = tagAssignment[1].replaceAll("''", "'").length;
        if (widthState.get(key) !== true && length > contract.initial_max_length) pushFinding(report, "width_before_write", "blocker", file, `${contract.table}.${contract.column} literal length ${length} exceeds ${contract.initial_max_length} before widening`, statement, { table: contract.table, column: contract.column, length, max_length: contract.initial_max_length });
      }
    }
    for (const contract of policy.width_contracts || []) {
      const key = `${contract.table}.${contract.column}`;
      if (hasWidening(statement, contract.table, contract.column, contract.widening_types || [])) widthState.set(key, true);
    }
  }
}

if (collationPolicy && collationContract?.enabled === true) {
  const orderedFiles = files.map((file) => `http-generic-api/migrations/${file}`);
  const collationChain = inspectOrderedMigrationChainCollations({
    files: orderedFiles,
    baselineFile: collationContract.baseline_file || "http-generic-api/schema.sql",
    engine: collationContract.engine || "mariadb",
    policy: collationPolicy,
    readFile: (file) => fs.readFileSync(path.join(repoRoot, file), "utf8"),
  });
  report.collation_chain = {
    contract: collationChain.contract,
    engine: collationChain.engine,
    policy_key: collationChain.policy_key,
    baseline_file: collationChain.baseline_file,
    files_checked: collationChain.files_checked,
    migration_files_checked: collationChain.migration_files_checked,
    statements_checked: collationChain.statements_checked,
    projected_tables: collationChain.projected_tables,
    findings: collationChain.findings,
    warnings: collationChain.warnings,
    ok: collationChain.ok,
    ready: collationChain.ready,
    database_connection_performed: collationChain.database_connection_performed,
    sql_mutation_performed: collationChain.sql_mutation_performed,
    provider_mutation_performed: collationChain.provider_mutation_performed,
    secrets_included: collationChain.secrets_included,
  };
  if (collationChain.findings.length > 0) {
    pushFinding(report, "collation_chain", "blocker", "database-engine-collation-policy.json", "ordered MariaDB collation-chain guard reports implicit or unregistered JOIN mismatches", "", {
      ordered_chain_findings: collationChain.findings.length,
      ordered_chain_warnings: collationChain.warnings.length,
      ordered_chain_files_checked: collationChain.files_checked,
      ordered_chain_statements_checked: collationChain.statements_checked,
    });
  }
}

if (enumSeedContract?.enabled === true) {
  const orderedFiles = files.map((file) => `http-generic-api/migrations/${file}`);
  const enumSeedChain = inspectOrderedMigrationChainEnumSeeds({
    files: orderedFiles,
    baselineFile: enumSeedContract.baseline_file || "http-generic-api/schema.sql",
    engine: enumSeedContract.engine || "mariadb",
    policy,
    readFile: (file) => fs.readFileSync(path.join(repoRoot, file), "utf8"),
  });
  report.enum_seed_chain = {
    contract: enumSeedChain.contract,
    engine: enumSeedChain.engine,
    policy_key: enumSeedChain.policy_key,
    baseline_file: enumSeedChain.baseline_file,
    files_checked: enumSeedChain.files_checked,
    migration_files_checked: enumSeedChain.migration_files_checked,
    statements_checked: enumSeedChain.statements_checked,
    enum_columns: enumSeedChain.enum_columns,
    definitions_applied: enumSeedChain.definitions_applied,
    findings: enumSeedChain.findings,
    warnings: enumSeedChain.warnings,
    ok: enumSeedChain.ok,
    ready: enumSeedChain.ready,
    database_connection_performed: enumSeedChain.database_connection_performed,
    sql_mutation_performed: enumSeedChain.sql_mutation_performed,
    provider_mutation_performed: enumSeedChain.provider_mutation_performed,
    credential_access_performed: enumSeedChain.credential_access_performed,
    data_export_performed: enumSeedChain.data_export_performed,
    runtime_mutation_performed: enumSeedChain.runtime_mutation_performed,
    secrets_included: enumSeedChain.secrets_included,
  };
  if (enumSeedChain.findings.length > 0) {
    pushFinding(report, "enum_seed_chain", "blocker", "staging-migration-contract-policy.json", "ordered MariaDB enum-seed guard reports unsupported literal writes", "", {
      enum_seed_findings: enumSeedChain.findings.length,
      enum_seed_files_checked: enumSeedChain.files_checked,
      enum_seed_statements_checked: enumSeedChain.statements_checked,
    });
  }
  if (enumSeedChain.database_connection_performed !== false || enumSeedChain.sql_mutation_performed !== false || enumSeedChain.provider_mutation_performed !== false || enumSeedChain.credential_access_performed !== false || enumSeedChain.data_export_performed !== false || enumSeedChain.runtime_mutation_performed !== false || enumSeedChain.secrets_included !== false) {
    pushFinding(report, "safety_boundary", "blocker", "staging-migration-contract-policy.json", "ordered MariaDB enum-seed evidence violates static-only safety");
  }
}

if (textWidthContract?.enabled === true) {
  const orderedFiles = files.map((file) => `http-generic-api/migrations/${file}`);
  const textWidthChain = inspectOrderedMigrationChainTextWidths({
    files: orderedFiles,
    baselineFile: textWidthContract.baseline_file || "http-generic-api/schema.sql",
    engine: textWidthContract.engine || "mariadb",
    policy,
    readFile: (file) => fs.readFileSync(path.join(repoRoot, file), "utf8"),
  });
  report.text_width_chain = {
    contract: textWidthChain.contract,
    engine: textWidthChain.engine,
    policy_key: textWidthChain.policy_key,
    baseline_file: textWidthChain.baseline_file,
    files_checked: textWidthChain.files_checked,
    migration_files_checked: textWidthChain.migration_files_checked,
    statements_checked: textWidthChain.statements_checked,
    bounded_text_columns: textWidthChain.bounded_text_columns,
    definitions_applied: textWidthChain.definitions_applied,
    findings: textWidthChain.findings,
    warnings: textWidthChain.warnings,
    ok: textWidthChain.ok,
    ready: textWidthChain.ready,
    database_connection_performed: textWidthChain.database_connection_performed,
    sql_mutation_performed: textWidthChain.sql_mutation_performed,
    provider_mutation_performed: textWidthChain.provider_mutation_performed,
    credential_access_performed: textWidthChain.credential_access_performed,
    data_export_performed: textWidthChain.data_export_performed,
    runtime_mutation_performed: textWidthChain.runtime_mutation_performed,
    secrets_included: textWidthChain.secrets_included,
  };
  if (textWidthChain.findings.length > 0) {
    pushFinding(report, "text_width_chain", "blocker", "staging-migration-contract-policy.json", "ordered MariaDB text-width guard reports literal overflow before widening", "", {
      text_width_findings: textWidthChain.findings.length,
      text_width_files_checked: textWidthChain.files_checked,
      text_width_statements_checked: textWidthChain.statements_checked,
    });
  }
  if (textWidthChain.database_connection_performed !== false || textWidthChain.sql_mutation_performed !== false || textWidthChain.provider_mutation_performed !== false || textWidthChain.credential_access_performed !== false || textWidthChain.data_export_performed !== false || textWidthChain.runtime_mutation_performed !== false || textWidthChain.secrets_included !== false) {
    pushFinding(report, "safety_boundary", "blocker", "staging-migration-contract-policy.json", "ordered MariaDB text-width evidence violates static-only safety");
  }
}

report.migration_catalog = {
  contract: "mad4b.cross-environment.migration-discovery.v1",
  source_commit: expectedCommit,
  digest_sha256: sha256(JSON.stringify(catalogEntries)),
  migration_count: catalogEntries.length,
  execution_authority_granted: false,
  environment_keys: Object.keys(report.environment_profiles).sort(),
  entries: catalogEntries,
};

const planArgs = [builderPath, "--expected-commit", expectedCommit, "--plan"];
const planResult = spawnSync(process.execPath, planArgs, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180000 });
if (planResult.error) pushFinding(report, "canonical_plan", "blocker", "build-staging-schema-bundle.mjs", `canonical builder plan could not start: ${planResult.error.message}`);
else if (planResult.status !== 0) pushFinding(report, "canonical_plan", "blocker", "build-staging-schema-bundle.mjs", `canonical builder plan failed: ${normalize(planResult.stderr || planResult.stdout).slice(-4000)}`);
else {
  try {
    const plan = JSON.parse(planResult.stdout);
    report.plan = { contract: plan.contract, migration_count: plan.migration_count, statement_count: plan.statement_count, ordered_preuse_audit: plan.ordered_preuse_audit, ordered_collation_chain: plan.ordered_collation_chain, ordered_enum_seed_chain: plan.ordered_enum_seed_chain, ordered_text_width_chain: plan.ordered_text_width_chain, canonical_table_bootstrap: plan.canonical_table_bootstrap, plan_only: plan.plan_only, production_access_forbidden: plan.production_access_forbidden, provider_access_forbidden: plan.provider_access_forbidden };
    if (plan.plan_only !== true) pushFinding(report, "canonical_plan", "blocker", "build-staging-schema-bundle.mjs", "canonical builder did not return plan_only=true");
    if (plan.production_access_forbidden !== true || plan.provider_access_forbidden !== true) pushFinding(report, "safety_boundary", "blocker", "build-staging-schema-bundle.mjs", "canonical plan safety flags are incomplete");
    if (plan.ordered_preuse_audit?.missing_table_gaps > 0 || plan.ordered_preuse_audit?.missing_column_gaps > 0 || plan.ordered_preuse_audit?.unique_true_preuse_gaps > 0) pushFinding(report, "ordering_dependency", "blocker", "build-staging-schema-bundle.mjs", "canonical ordered pre-use audit reports unresolved gaps", plan.ordered_preuse_audit);
    if (!Number.isInteger(plan.ordered_preuse_audit?.view_column_references_checked) || plan.ordered_preuse_audit.view_column_references_checked <= 0) pushFinding(report, "ordering_dependency", "blocker", "build-staging-schema-bundle.mjs", "canonical ordered pre-use audit did not check qualified view columns", plan.ordered_preuse_audit || {});
    if (!Number.isInteger(plan.ordered_preuse_audit?.insert_arity_checks) || plan.ordered_preuse_audit.insert_arity_checks <= 0) pushFinding(report, "insert_arity", "blocker", "build-staging-schema-bundle.mjs", "canonical ordered pre-use audit did not check INSERT column/value arity", plan.ordered_preuse_audit || {});
    if ((plan.ordered_preuse_audit?.insert_arity_mismatches || 0) > 0) pushFinding(report, "insert_arity", "blocker", "build-staging-schema-bundle.mjs", "canonical ordered pre-use audit reports INSERT column/value arity mismatches", plan.ordered_preuse_audit || {});
    if (!Number.isInteger(plan.ordered_preuse_audit?.update_target_column_checks) || plan.ordered_preuse_audit.update_target_column_checks <= 0) pushFinding(report, "update_target_columns", "blocker", "build-staging-schema-bundle.mjs", "canonical ordered pre-use audit did not check UPDATE target columns", plan.ordered_preuse_audit || {});
    if ((plan.ordered_preuse_audit?.update_target_column_missing_columns || 0) > 0) pushFinding(report, "update_target_columns", "blocker", "build-staging-schema-bundle.mjs", "canonical ordered pre-use audit reports missing UPDATE target columns", plan.ordered_preuse_audit || {});
    if (plan.canonical_table_bootstrap?.unresolved_missing_table_gaps > 0) pushFinding(report, "ordering_dependency", "blocker", "build-staging-schema-bundle.mjs", "canonical bootstrap reports unresolved missing tables", plan.canonical_table_bootstrap);
    if (plan.ordered_collation_chain?.ok !== true || plan.ordered_collation_chain?.finding_count !== 0 || plan.ordered_collation_chain?.files_checked !== plan.migration_count + 1 || plan.ordered_collation_chain?.statements_checked <= plan.statement_count) pushFinding(report, "collation_chain", "blocker", "build-staging-schema-bundle.mjs", "canonical builder ordered collation evidence is incomplete or reports findings", plan.ordered_collation_chain || {});
    if (plan.ordered_collation_chain?.database_connection_performed !== false || plan.ordered_collation_chain?.sql_mutation_performed !== false || plan.ordered_collation_chain?.provider_mutation_performed !== false || plan.ordered_collation_chain?.secrets_included !== false) pushFinding(report, "safety_boundary", "blocker", "build-staging-schema-bundle.mjs", "canonical builder ordered collation evidence violates static-only safety", plan.ordered_collation_chain || {});
    if (plan.ordered_enum_seed_chain?.ok !== true || plan.ordered_enum_seed_chain?.finding_count !== 0 || plan.ordered_enum_seed_chain?.files_checked !== plan.migration_count + 1 || plan.ordered_enum_seed_chain?.statements_checked <= plan.statement_count) pushFinding(report, "enum_seed_chain", "blocker", "build-staging-schema-bundle.mjs", "canonical builder ordered enum-seed evidence is incomplete or reports unsupported literals", plan.ordered_enum_seed_chain || {});
    if (plan.ordered_enum_seed_chain?.database_connection_performed !== false || plan.ordered_enum_seed_chain?.sql_mutation_performed !== false || plan.ordered_enum_seed_chain?.provider_mutation_performed !== false || plan.ordered_enum_seed_chain?.credential_access_performed !== false || plan.ordered_enum_seed_chain?.data_export_performed !== false || plan.ordered_enum_seed_chain?.runtime_mutation_performed !== false || plan.ordered_enum_seed_chain?.secrets_included !== false) pushFinding(report, "safety_boundary", "blocker", "build-staging-schema-bundle.mjs", "canonical builder ordered enum-seed evidence violates static-only safety", plan.ordered_enum_seed_chain || {});
    if (plan.ordered_text_width_chain?.ok !== true || plan.ordered_text_width_chain?.ready !== true || plan.ordered_text_width_chain?.finding_count !== 0 || plan.ordered_text_width_chain?.files_checked !== plan.migration_count + 1 || plan.ordered_text_width_chain?.statements_checked <= plan.statement_count) pushFinding(report, "text_width_chain", "blocker", "build-staging-schema-bundle.mjs", "canonical builder ordered text-width evidence is incomplete or reports literal overflows", plan.ordered_text_width_chain || {});
    if (plan.ordered_text_width_chain?.database_connection_performed !== false || plan.ordered_text_width_chain?.sql_mutation_performed !== false || plan.ordered_text_width_chain?.provider_mutation_performed !== false || plan.ordered_text_width_chain?.credential_access_performed !== false || plan.ordered_text_width_chain?.data_export_performed !== false || plan.ordered_text_width_chain?.runtime_mutation_performed !== false || plan.ordered_text_width_chain?.secrets_included !== false) pushFinding(report, "safety_boundary", "blocker", "build-staging-schema-bundle.mjs", "canonical builder ordered text-width evidence violates static-only safety", plan.ordered_text_width_chain || {});
  } catch (error) { pushFinding(report, "canonical_plan", "blocker", "build-staging-schema-bundle.mjs", `canonical builder plan was not valid JSON: ${error.message}`); }
}

report.summary = {
  ok: report.findings.every((finding) => finding.severity !== "blocker"),
  blockers: report.findings.filter((finding) => finding.severity === "blocker").length,
  reviews: report.findings.filter((finding) => finding.severity === "review").length,
  categories: Object.fromEntries([...new Set(report.findings.map((finding) => finding.category))].sort().map((category) => [category, report.findings.filter((finding) => finding.category === category).length])),
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output: outputPath, source_commit: expectedCommit, counts: report.counts, summary: report.summary, safety: report.safety }, null, 2)}\n`);
if (!report.summary.ok) process.exitCode = 1;
