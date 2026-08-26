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
const { inspectOrderedMigrationChainGeneratedColumns } = await import(pathToFileURL(path.join(apiRoot, "databaseGeneratedColumnPolicyGuard.js")).href);
const { inspectOrderedMigrationChainIndexKeyWidths } = await import(pathToFileURL(path.join(apiRoot, "databaseIndexKeyWidthPolicyGuard.js")).href);
const { inspectOrderedMigrationChainRequiredInsertColumns } = await import(pathToFileURL(path.join(apiRoot, "databaseRequiredInsertColumnPolicyGuard.js")).href);

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
const indexKeyWidthPolicyPath = path.join(repoRoot, "http-generic-api", "config", "database-index-key-width-policy.json");
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
function canonicalBootstrapEntries(plan) {
  return (plan.canonical_table_bootstrap?.entries || []).map((entry) => {
    const sourceFile = path.join(migrationsDir, String(entry.source_file || ""));
    if (!fs.existsSync(sourceFile)) return null;
    const table = tableName(entry.table);
    const statement = splitStatements(fs.readFileSync(sourceFile, "utf8")).find((candidate) => new RegExp(`^\\s*CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+(?:` + "`" + `)?${table}(?:` + "`" + `)?\\s*\\(`, "iu").test(candidate));
    return statement ? { ...entry, statement } : null;
  }).filter(Boolean);
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
  generated_column_chain_contract: policy.generated_column_chain_contract || null,
  index_key_width_chain_contract: policy.index_key_width_chain_contract || null,
  required_insert_column_chain_contract: policy.required_insert_column_chain_contract || null,
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
if (!textWidthContract || textWidthContract.enabled !== true || textWidthContract.engine !== "mariadb" || textWidthContract.fail_on_literal_overflow !== true || textWidthContract.inspect_create_alter_text_domains !== true || textWidthContract.inspect_insert_replace_update_literals !== true || textWidthContract.inspect_insert_select_source_domains !== true || textWidthContract.static_only !== true || textWidthContract.database_connection_allowed !== false || textWidthContract.sql_mutation_allowed !== false || textWidthContract.provider_access_allowed !== false || textWidthContract.credential_access_allowed !== false || textWidthContract.data_export_allowed !== false || textWidthContract.runtime_mutation_allowed !== false || textWidthContract.secrets_included !== false) {
  pushFinding(report, "text_width_chain", "blocker", "staging-migration-contract-policy.json", "text_width_chain_contract must enable the MariaDB static ordered text-domain/width gate and fail on literal overflow");
}
const generatedColumnContract = policy.generated_column_chain_contract;
if (!generatedColumnContract || generatedColumnContract.enabled !== true || generatedColumnContract.engine !== "mariadb" || generatedColumnContract.fail_on_generated_column_write !== true || generatedColumnContract.inspect_create_alter_generated_columns !== true || generatedColumnContract.inspect_insert_replace_update_writers !== true || generatedColumnContract.include_canonical_table_bootstrap !== true || generatedColumnContract.static_only !== true || generatedColumnContract.database_connection_allowed !== false || generatedColumnContract.sql_mutation_allowed !== false || generatedColumnContract.provider_access_allowed !== false || generatedColumnContract.credential_access_allowed !== false || generatedColumnContract.data_export_allowed !== false || generatedColumnContract.runtime_mutation_allowed !== false || generatedColumnContract.secrets_included !== false) {
  pushFinding(report, "generated_column_chain", "blocker", "staging-migration-contract-policy.json", "generated_column_chain_contract must enable the MariaDB static ordered generated-column writer gate");
}
const generatedCompatibilityContract = generatedColumnContract?.generated_expression_compatibility;
const ordinaryBridgeRules = Array.isArray(generatedCompatibilityContract?.bridges)
  ? generatedCompatibilityContract.bridges.filter((rule) => rule?.replacement_mode === "ordinary_column_trigger")
  : [];
const expectedOrdinaryBridgeCount = ordinaryBridgeRules.length;
const requiredSha2BridgeKeys = new Set([
  "local_connector_device_routes.endpoint_url_sha256",
  "growth_control_config_versions.scope_key_hash",
  "user_brand_skill_grants.active_scope_hash",
  "storage_execution_leases.root_ref_digest",
  "act_as_user_sessions.idempotency_tuple_hash",
]);
const declaredSha2BridgeKeys = new Set(ordinaryBridgeRules.map((rule) => `${rule.table}.${rule.column}`));
const invalidOrdinaryBridgeContract = !Array.isArray(generatedCompatibilityContract?.forbidden_function_names)
  || !generatedCompatibilityContract.forbidden_function_names.map((name) => String(name).toLowerCase()).includes("sha2")
  || [...requiredSha2BridgeKeys].some((key) => !declaredSha2BridgeKeys.has(key))
  || ordinaryBridgeRules.some((rule) => !rule.replacement_column_type
    || !rule.replacement_column_nullability
    || !rule.replacement_expression
    || !Array.isArray(rule.trigger_names)
    || rule.trigger_names.length !== 2
    || !Array.isArray(rule.trigger_events)
    || rule.trigger_events.length !== 2);
if (invalidOrdinaryBridgeContract) {
  pushFinding(report, "generated_column_chain", "blocker", "staging-migration-contract-policy.json", "SHA2 generated-column compatibility must declare every known affected column as an exact ordinary-column/BEFORE-trigger bridge with type, nullability, expression, and two trigger events", {
    required_sha2_bridge_count: requiredSha2BridgeKeys.size,
    declared_ordinary_bridge_count: ordinaryBridgeRules.length,
    declared_sha2_bridge_keys: [...declaredSha2BridgeKeys].sort(),
  });
}
const indexKeyWidthContract = policy.index_key_width_chain_contract;
if (!indexKeyWidthContract || indexKeyWidthContract.enabled !== true || indexKeyWidthContract.engine !== "mariadb" || indexKeyWidthContract.max_key_bytes !== 3072 || indexKeyWidthContract.fail_on_index_key_overflow !== true || indexKeyWidthContract.inspect_create_alter_index_definitions !== true || indexKeyWidthContract.inspect_character_set_byte_widths !== true || indexKeyWidthContract.static_only !== true || indexKeyWidthContract.database_connection_allowed !== false || indexKeyWidthContract.sql_mutation_allowed !== false || indexKeyWidthContract.provider_access_allowed !== false || indexKeyWidthContract.credential_access_allowed !== false || indexKeyWidthContract.data_export_allowed !== false || indexKeyWidthContract.runtime_mutation_allowed !== false || indexKeyWidthContract.secrets_included !== false) {
  pushFinding(report, "index_key_width_chain", "blocker", "staging-migration-contract-policy.json", "index_key_width_chain_contract must enable the MariaDB static ordered 3072-byte key-width gate");
}
let indexKeyWidthPolicy;
try { indexKeyWidthPolicy = readJson(indexKeyWidthPolicyPath); }
catch (error) { pushFinding(report, "index_key_width_chain", "blocker", "database-index-key-width-policy.json", `index-key-width policy unreadable: ${error.message}`); }

const requiredInsertColumnContract = policy.required_insert_column_chain_contract;
if (!requiredInsertColumnContract || requiredInsertColumnContract.enabled !== true || requiredInsertColumnContract.engine !== "mariadb" || requiredInsertColumnContract.fail_on_omitted_required_columns !== true || requiredInsertColumnContract.inspect_create_alter_required_columns !== true || requiredInsertColumnContract.inspect_insert_replace_writers !== true || requiredInsertColumnContract.allow_declared_ddl_bridges !== true || requiredInsertColumnContract.static_only !== true || requiredInsertColumnContract.database_connection_allowed !== false || requiredInsertColumnContract.sql_mutation_allowed !== false || requiredInsertColumnContract.provider_access_allowed !== false || requiredInsertColumnContract.credential_access_allowed !== false || requiredInsertColumnContract.data_export_allowed !== false || requiredInsertColumnContract.runtime_mutation_allowed !== false || requiredInsertColumnContract.secrets_included !== false || !Array.isArray(requiredInsertColumnContract.required_tables) || requiredInsertColumnContract.required_tables.length === 0) {
  pushFinding(report, "required_insert_column_chain", "blocker", "staging-migration-contract-policy.json", "required_insert_column_chain_contract must enable the MariaDB static ordered required-column writer gate");
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
    insert_select_source_domain_checks: textWidthChain.insert_select_source_domain_checks,
    insert_select_source_domain_overflows: textWidthChain.insert_select_source_domain_overflows,
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
  if (!Number.isInteger(textWidthChain.insert_select_source_domain_checks) || textWidthChain.insert_select_source_domain_checks <= 0) {
    pushFinding(report, "text_width_chain", "blocker", "staging-migration-contract-policy.json", "ordered MariaDB text-width guard did not check INSERT...SELECT source domains", "", { insert_select_source_domain_checks: textWidthChain.insert_select_source_domain_checks ?? null });
  }
  if ((textWidthChain.insert_select_source_domain_overflows || 0) > 0) {
    pushFinding(report, "text_width_chain", "blocker", "staging-migration-contract-policy.json", "ordered MariaDB text-width guard reports INSERT...SELECT source-domain overflow", "", { insert_select_source_domain_overflows: textWidthChain.insert_select_source_domain_overflows });
  }
  if (textWidthChain.findings.length > 0) {
    pushFinding(report, "text_width_chain", "blocker", "staging-migration-contract-policy.json", "ordered MariaDB text-width guard reports literal/source-domain overflow before widening", "", {
      text_width_findings: textWidthChain.findings.length,
      text_width_files_checked: textWidthChain.files_checked,
      text_width_statements_checked: textWidthChain.statements_checked,
    });
  }
  if (textWidthChain.database_connection_performed !== false || textWidthChain.sql_mutation_performed !== false || textWidthChain.provider_mutation_performed !== false || textWidthChain.credential_access_performed !== false || textWidthChain.data_export_performed !== false || textWidthChain.runtime_mutation_performed !== false || textWidthChain.secrets_included !== false) {
    pushFinding(report, "safety_boundary", "blocker", "staging-migration-contract-policy.json", "ordered MariaDB text-width evidence violates static-only safety");
  }
}

if (indexKeyWidthPolicy && indexKeyWidthContract?.enabled === true) {
  const orderedFiles = files.map((file) => `http-generic-api/migrations/${file}`);
  const indexKeyWidthChain = inspectOrderedMigrationChainIndexKeyWidths({
    files: orderedFiles,
    baselineFile: indexKeyWidthContract.baseline_file || "http-generic-api/schema.sql",
    engine: indexKeyWidthContract.engine || "mariadb",
    policy: indexKeyWidthPolicy,
    readFile: (file) => fs.readFileSync(path.join(repoRoot, file), "utf8"),
  });
  report.index_key_width_chain = {
    contract: indexKeyWidthChain.contract,
    engine: indexKeyWidthChain.engine,
    policy_key: indexKeyWidthChain.policy_key,
    baseline_file: indexKeyWidthChain.baseline_file,
    files_checked: indexKeyWidthChain.files_checked,
    migration_files_checked: indexKeyWidthChain.migration_files_checked,
    statements_checked: indexKeyWidthChain.statements_checked,
    tables_projected: indexKeyWidthChain.tables_projected,
    indexes_checked: indexKeyWidthChain.indexes_checked,
    index_columns_checked: indexKeyWidthChain.index_columns_checked,
    max_key_bytes: indexKeyWidthChain.max_key_bytes,
    findings: indexKeyWidthChain.findings,
    warnings: indexKeyWidthChain.warnings,
    ok: indexKeyWidthChain.ok,
    ready: indexKeyWidthChain.ready,
    database_connection_performed: indexKeyWidthChain.database_connection_performed,
    sql_mutation_performed: indexKeyWidthChain.sql_mutation_performed,
    provider_mutation_performed: indexKeyWidthChain.provider_mutation_performed,
    credential_access_performed: indexKeyWidthChain.credential_access_performed,
    data_export_performed: indexKeyWidthChain.data_export_performed,
    runtime_mutation_performed: indexKeyWidthChain.runtime_mutation_performed,
    secrets_included: indexKeyWidthChain.secrets_included,
  };
  if (indexKeyWidthChain.findings.length > 0) {
    pushFinding(report, "index_key_width_chain", "blocker", "database-index-key-width-policy.json", "ordered MariaDB index-key-width guard reports a key over the configured 3072-byte limit or an unresolved key width", "", {
      index_key_width_findings: indexKeyWidthChain.findings.length,
      index_key_width_files_checked: indexKeyWidthChain.files_checked,
      index_key_width_statements_checked: indexKeyWidthChain.statements_checked,
    });
  }
  if (indexKeyWidthChain.database_connection_performed !== false || indexKeyWidthChain.sql_mutation_performed !== false || indexKeyWidthChain.provider_mutation_performed !== false || indexKeyWidthChain.credential_access_performed !== false || indexKeyWidthChain.data_export_performed !== false || indexKeyWidthChain.runtime_mutation_performed !== false || indexKeyWidthChain.secrets_included !== false) {
    pushFinding(report, "safety_boundary", "blocker", "database-index-key-width-policy.json", "ordered MariaDB index-key-width evidence violates static-only safety");
  }
}

if (requiredInsertColumnContract?.enabled === true) {
  const orderedFiles = files.map((file) => `http-generic-api/migrations/${file}`);
  const requiredInsertColumnChain = inspectOrderedMigrationChainRequiredInsertColumns({
    files: orderedFiles,
    baselineFile: requiredInsertColumnContract.baseline_file || "http-generic-api/schema.sql",
    engine: requiredInsertColumnContract.engine || "mariadb",
    policy,
    readFile: (file) => fs.readFileSync(path.join(repoRoot, file), "utf8"),
  });
  report.required_insert_column_chain = {
    contract: requiredInsertColumnChain.contract,
    engine: requiredInsertColumnChain.engine,
    policy_key: requiredInsertColumnChain.policy_key,
    baseline_file: requiredInsertColumnChain.baseline_file,
    files_checked: requiredInsertColumnChain.files_checked,
    migration_files_checked: requiredInsertColumnChain.migration_files_checked,
    statements_checked: requiredInsertColumnChain.statements_checked,
    tables_projected: requiredInsertColumnChain.tables_projected,
    writer_checks: requiredInsertColumnChain.writer_checks,
    required_columns_checked: requiredInsertColumnChain.required_columns_checked,
    omitted_required_columns: requiredInsertColumnChain.omitted_required_columns,
    allowed_bridge_omissions: requiredInsertColumnChain.allowed_bridge_omissions,
    required_tables: requiredInsertColumnChain.required_tables,
    findings: requiredInsertColumnChain.findings,
    warnings: requiredInsertColumnChain.warnings,
    ok: requiredInsertColumnChain.ok,
    ready: requiredInsertColumnChain.ready,
    database_connection_performed: requiredInsertColumnChain.database_connection_performed,
    sql_mutation_performed: requiredInsertColumnChain.sql_mutation_performed,
    provider_mutation_performed: requiredInsertColumnChain.provider_mutation_performed,
    credential_access_performed: requiredInsertColumnChain.credential_access_performed,
    data_export_performed: requiredInsertColumnChain.data_export_performed,
    runtime_mutation_performed: requiredInsertColumnChain.runtime_mutation_performed,
    secrets_included: requiredInsertColumnChain.secrets_included,
  };
  if (requiredInsertColumnChain.findings.length > 0) {
    pushFinding(report, "required_insert_column_chain", "blocker", "staging-migration-contract-policy.json", "ordered MariaDB required INSERT-column guard reports an omitted required column or invalid bridge", "", {
      required_insert_column_findings: requiredInsertColumnChain.findings.length,
      required_insert_column_files_checked: requiredInsertColumnChain.files_checked,
      required_insert_column_statements_checked: requiredInsertColumnChain.statements_checked,
    });
  }
  if (requiredInsertColumnChain.database_connection_performed !== false || requiredInsertColumnChain.sql_mutation_performed !== false || requiredInsertColumnChain.provider_mutation_performed !== false || requiredInsertColumnChain.credential_access_performed !== false || requiredInsertColumnChain.data_export_performed !== false || requiredInsertColumnChain.runtime_mutation_performed !== false || requiredInsertColumnChain.secrets_included !== false) {
    pushFinding(report, "safety_boundary", "blocker", "staging-migration-contract-policy.json", "ordered MariaDB required INSERT-column evidence violates static-only safety");
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
    report.plan = { contract: plan.contract, migration_count: plan.migration_count, statement_count: plan.statement_count, ordered_preuse_audit: plan.ordered_preuse_audit, ordered_collation_chain: plan.ordered_collation_chain, ordered_enum_seed_chain: plan.ordered_enum_seed_chain, ordered_text_width_chain: plan.ordered_text_width_chain, ordered_index_key_width_chain: plan.ordered_index_key_width_chain, ordered_required_insert_column_chain: plan.ordered_required_insert_column_chain, ordered_generated_column_chain: plan.ordered_generated_column_chain, canonical_table_bootstrap: plan.canonical_table_bootstrap, plan_only: plan.plan_only, production_access_forbidden: plan.production_access_forbidden, provider_access_forbidden: plan.provider_access_forbidden };
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
    if (plan.ordered_text_width_chain?.ok !== true || plan.ordered_text_width_chain?.ready !== true || plan.ordered_text_width_chain?.finding_count !== 0 || plan.ordered_text_width_chain?.files_checked !== plan.migration_count + 1 || plan.ordered_text_width_chain?.statements_checked <= plan.statement_count || !Number.isInteger(plan.ordered_text_width_chain?.insert_select_source_domain_checks) || plan.ordered_text_width_chain.insert_select_source_domain_checks <= 0 || (plan.ordered_text_width_chain?.insert_select_source_domain_overflows || 0) > 0) pushFinding(report, "text_width_chain", "blocker", "build-staging-schema-bundle.mjs", "canonical builder ordered text-width evidence is incomplete or reports literal/source-domain overflows", plan.ordered_text_width_chain || {});
    if (plan.ordered_text_width_chain?.database_connection_performed !== false || plan.ordered_text_width_chain?.sql_mutation_performed !== false || plan.ordered_text_width_chain?.provider_mutation_performed !== false || plan.ordered_text_width_chain?.credential_access_performed !== false || plan.ordered_text_width_chain?.data_export_performed !== false || plan.ordered_text_width_chain?.runtime_mutation_performed !== false || plan.ordered_text_width_chain?.secrets_included !== false) pushFinding(report, "safety_boundary", "blocker", "build-staging-schema-bundle.mjs", "canonical builder ordered text-width evidence violates static-only safety", plan.ordered_text_width_chain || {});
    if (plan.ordered_generated_column_chain?.ok !== true || plan.ordered_generated_column_chain?.ready !== true || plan.ordered_generated_column_chain?.finding_count !== 0 || plan.ordered_generated_column_chain?.unsupported_generated_expressions !== 0 || plan.ordered_generated_column_chain?.ordinary_column_trigger_bridges !== expectedOrdinaryBridgeCount || plan.ordered_generated_column_chain?.files_checked !== plan.migration_count + 1 || plan.ordered_generated_column_chain?.statements_checked <= plan.statement_count) pushFinding(report, "generated_column_chain", "blocker", "build-staging-schema-bundle.mjs", "canonical builder ordered generated-column evidence is incomplete or reports writes/unsupported expressions/bridge-count drift", plan.ordered_generated_column_chain || {});
    if (plan.ordered_index_key_width_chain?.ok !== true || plan.ordered_index_key_width_chain?.ready !== true || plan.ordered_index_key_width_chain?.finding_count !== 0 || plan.ordered_index_key_width_chain?.files_checked !== plan.migration_count + 1 || plan.ordered_index_key_width_chain?.statements_checked <= plan.statement_count || plan.ordered_index_key_width_chain?.max_key_bytes !== 3072) pushFinding(report, "index_key_width_chain", "blocker", "build-staging-schema-bundle.mjs", "canonical builder ordered index-key-width evidence is incomplete or reports a key over 3072 bytes", plan.ordered_index_key_width_chain || {});
    if (plan.ordered_generated_column_chain?.database_connection_performed !== false || plan.ordered_generated_column_chain?.sql_mutation_performed !== false || plan.ordered_generated_column_chain?.provider_mutation_performed !== false || plan.ordered_generated_column_chain?.credential_access_performed !== false || plan.ordered_generated_column_chain?.data_export_performed !== false || plan.ordered_generated_column_chain?.runtime_mutation_performed !== false || plan.ordered_generated_column_chain?.secrets_included !== false) pushFinding(report, "safety_boundary", "blocker", "build-staging-schema-bundle.mjs", "canonical builder ordered generated-column evidence violates static-only safety", plan.ordered_generated_column_chain || {});
    if (plan.ordered_index_key_width_chain?.database_connection_performed !== false || plan.ordered_index_key_width_chain?.sql_mutation_performed !== false || plan.ordered_index_key_width_chain?.provider_mutation_performed !== false || plan.ordered_index_key_width_chain?.credential_access_performed !== false || plan.ordered_index_key_width_chain?.data_export_performed !== false || plan.ordered_index_key_width_chain?.runtime_mutation_performed !== false || plan.ordered_index_key_width_chain?.secrets_included !== false) pushFinding(report, "safety_boundary", "blocker", "build-staging-schema-bundle.mjs", "canonical builder ordered index-key-width evidence violates static-only safety", plan.ordered_index_key_width_chain || {});
    if (plan.ordered_required_insert_column_chain?.ok !== true || plan.ordered_required_insert_column_chain?.ready !== true || plan.ordered_required_insert_column_chain?.finding_count !== 0 || plan.ordered_required_insert_column_chain?.files_checked !== plan.migration_count + 1 || plan.ordered_required_insert_column_chain?.statements_checked <= plan.statement_count) pushFinding(report, "required_insert_column_chain", "blocker", "build-staging-schema-bundle.mjs", "canonical builder ordered required INSERT-column evidence is incomplete or reports omitted required columns", plan.ordered_required_insert_column_chain || {});
    if (plan.ordered_required_insert_column_chain?.database_connection_performed !== false || plan.ordered_required_insert_column_chain?.sql_mutation_performed !== false || plan.ordered_required_insert_column_chain?.provider_mutation_performed !== false || plan.ordered_required_insert_column_chain?.credential_access_performed !== false || plan.ordered_required_insert_column_chain?.data_export_performed !== false || plan.ordered_required_insert_column_chain?.runtime_mutation_performed !== false || plan.ordered_required_insert_column_chain?.secrets_included !== false) pushFinding(report, "safety_boundary", "blocker", "build-staging-schema-bundle.mjs", "canonical builder ordered required INSERT-column evidence violates static-only safety", plan.ordered_required_insert_column_chain || {});
  } catch (error) { pushFinding(report, "canonical_plan", "blocker", "build-staging-schema-bundle.mjs", `canonical builder plan was not valid JSON: ${error.message}`); }
}

if (report.plan && generatedColumnContract?.enabled === true) {
  const orderedFiles = files.map((file) => `http-generic-api/migrations/${file}`);
  const generatedColumnChain = inspectOrderedMigrationChainGeneratedColumns({
    files: orderedFiles,
    baselineFile: generatedColumnContract.baseline_file || "http-generic-api/schema.sql",
    engine: generatedColumnContract.engine || "mariadb",
    policy,
    bootstrapEntries: canonicalBootstrapEntries(report.plan),
    readFile: (file) => fs.readFileSync(path.join(repoRoot, file), "utf8"),
  });
  report.generated_column_chain = {
    contract: generatedColumnChain.contract,
    engine: generatedColumnChain.engine,
    policy_key: generatedColumnChain.policy_key,
    baseline_file: generatedColumnChain.baseline_file,
    files_checked: generatedColumnChain.files_checked,
    migration_files_checked: generatedColumnChain.migration_files_checked,
    statements_checked: generatedColumnChain.statements_checked,
    generated_columns: generatedColumnChain.generated_columns,
    definitions_applied: generatedColumnChain.definitions_applied,
    writer_checks: generatedColumnChain.writer_checks,
    generated_expression_checks: generatedColumnChain.generated_expression_checks,
    compatibility_bridge_candidates: generatedColumnChain.compatibility_bridge_candidates,
    unsupported_generated_expressions: generatedColumnChain.unsupported_generated_expressions,
    allowed_compatibility_bridges: generatedColumnChain.allowed_compatibility_bridges,
    ordinary_column_trigger_bridges: generatedColumnChain.ordinary_column_trigger_bridges,
    findings: generatedColumnChain.findings,
    warnings: generatedColumnChain.warnings,
    ok: generatedColumnChain.ok,
    ready: generatedColumnChain.ready,
    database_connection_performed: generatedColumnChain.database_connection_performed,
    sql_mutation_performed: generatedColumnChain.sql_mutation_performed,
    provider_mutation_performed: generatedColumnChain.provider_mutation_performed,
    credential_access_performed: generatedColumnChain.credential_access_performed,
    data_export_performed: generatedColumnChain.data_export_performed,
    runtime_mutation_performed: generatedColumnChain.runtime_mutation_performed,
    secrets_included: generatedColumnChain.secrets_included,
  };
  if (generatedColumnChain.ok !== true || generatedColumnChain.ready !== true || generatedColumnChain.findings.length > 0) {
    pushFinding(report, "generated_column_chain", "blocker", "staging-migration-contract-policy.json", "ordered MariaDB generated-column guard reports a writer against a generated column", "", {
      generated_column_findings: generatedColumnChain.findings.length,
      generated_column_files_checked: generatedColumnChain.files_checked,
      generated_column_statements_checked: generatedColumnChain.statements_checked,
      generated_expression_checks: generatedColumnChain.generated_expression_checks,
      compatibility_bridge_candidates: generatedColumnChain.compatibility_bridge_candidates,
      unsupported_generated_expressions: generatedColumnChain.unsupported_generated_expressions,
      allowed_compatibility_bridges: generatedColumnChain.allowed_compatibility_bridges,
      ordinary_column_trigger_bridges: generatedColumnChain.ordinary_column_trigger_bridges,
      expected_ordinary_column_trigger_bridges: expectedOrdinaryBridgeCount,
    });
  }
  if (generatedColumnChain.database_connection_performed !== false || generatedColumnChain.sql_mutation_performed !== false || generatedColumnChain.provider_mutation_performed !== false || generatedColumnChain.credential_access_performed !== false || generatedColumnChain.data_export_performed !== false || generatedColumnChain.runtime_mutation_performed !== false || generatedColumnChain.secrets_included !== false) {
    pushFinding(report, "safety_boundary", "blocker", "staging-migration-contract-policy.json", "ordered MariaDB generated-column evidence violates static-only safety");
  }
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
