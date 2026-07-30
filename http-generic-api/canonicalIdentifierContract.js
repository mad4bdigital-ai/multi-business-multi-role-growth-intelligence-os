import { getPool } from "./db.js";

export const CANONICAL_IDENTIFIER_CONTRACT_VERSION = "canonical_identifier_contract_v1";

const REPOSITORY_AUTHORITY_READINESS_REPAIR_MARKERS = Object.freeze([
  "migration:20260725_repository_authority_capability_readiness_repair",
  "growth_intelligence_platform.github.primary.production",
  "authority.system_id COLLATE utf8mb4_unicode_ci",
  "system.system_id COLLATE utf8mb4_unicode_ci",
]);

function defineUuidContract(identifierName) {
  return Object.freeze({
    contract_key: `uuid.${identifierName}.v1`,
    identifier_name: identifierName,
    logical_type: "uuid",
    transition_sql_type: "char(36)",
    transition_character_set: "ascii",
    transition_collation: "ascii_bin",
    target_sql_type: "binary(16)",
    comparison_mode: "binary",
  });
}

export const CANONICAL_IDENTIFIER_CONTRACTS = Object.freeze({
  system_id: defineUuidContract("system_id"),
  tenant_id: defineUuidContract("tenant_id"),
  workspace_id: defineUuidContract("workspace_id"),
  installation_id: defineUuidContract("installation_id"),
  connection_id: defineUuidContract("connection_id"),
  binding_id: defineUuidContract("binding_id"),
  capability_binding_id: defineUuidContract("capability_binding_id"),
});

const RESERVED_ALIAS_TOKENS = new Set([
  "SET", "WHERE", "ON", "LEFT", "RIGHT", "INNER", "OUTER", "JOIN",
  "ORDER", "GROUP", "LIMIT", "VALUES", "USING", "CROSS", "FULL",
]);

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function resolveCanonicalIdentifierContract(columnName = "") {
  return CANONICAL_IDENTIFIER_CONTRACTS[normalize(columnName)] || null;
}

function extractAliasMap(statement = "") {
  const aliases = new Map();
  const tablePattern = /\b(?:FROM|JOIN|UPDATE|INTO)\s+`?([A-Za-z_][A-Za-z0-9_$]*)`?(?:\s+(?:AS\s+)?`?([A-Za-z_][A-Za-z0-9_$]*)`?)?/gi;
  let match;
  while ((match = tablePattern.exec(statement)) !== null) {
    const tableName = match[1];
    const aliasCandidate = match[2] || "";
    aliases.set(normalize(tableName), tableName);
    if (aliasCandidate && !RESERVED_ALIAS_TOKENS.has(aliasCandidate.toUpperCase())) {
      aliases.set(normalize(aliasCandidate), tableName);
    }
  }
  return aliases;
}

function predicateOnlySql(statement = "") {
  return String(statement).replace(/\bSET\b[\s\S]*?(?=\bWHERE\b|$)/gi, " SET ");
}

export function extractCanonicalIdentifierComparisons(sql = "") {
  const comparisons = [];
  const comparisonPattern = /(?:(BINARY)\s+)?`?([A-Za-z_][A-Za-z0-9_$]*)`?\.`?([A-Za-z_][A-Za-z0-9_$]*)`?\s*(<=>|<>|!=|=)\s*(?:(BINARY)\s+)?`?([A-Za-z_][A-Za-z0-9_$]*)`?\.`?([A-Za-z_][A-Za-z0-9_$]*)`?/gi;

  for (const statement of String(sql || "").split(";")) {
    const aliases = extractAliasMap(statement);
    const predicateSql = predicateOnlySql(statement);
    let match;
    while ((match = comparisonPattern.exec(predicateSql)) !== null) {
      const leftContract = resolveCanonicalIdentifierContract(match[3]);
      const rightContract = resolveCanonicalIdentifierContract(match[7]);
      if (!leftContract || !rightContract || leftContract.contract_key !== rightContract.contract_key) continue;

      const leftTable = aliases.get(normalize(match[2]));
      const rightTable = aliases.get(normalize(match[6]));
      if (!leftTable || !rightTable) continue;

      comparisons.push({
        contract_key: leftContract.contract_key,
        identifier_name: leftContract.identifier_name,
        operator: match[4],
        left: { table_name: leftTable, column_name: match[3], binary_cast: Boolean(match[1]) },
        right: { table_name: rightTable, column_name: match[7], binary_cast: Boolean(match[5]) },
        binary_protected: Boolean(match[1] && match[5]),
      });
    }
  }

  return comparisons;
}

function schemaColumnKey(tableName, columnName) {
  return `${normalize(tableName)}.${normalize(columnName)}`;
}

function normalizeSchemaRow(row = {}) {
  return {
    table_name: row.table_name ?? row.TABLE_NAME ?? "",
    column_name: row.column_name ?? row.COLUMN_NAME ?? "",
    column_type: row.column_type ?? row.COLUMN_TYPE ?? "",
    data_type: row.data_type ?? row.DATA_TYPE ?? "",
    character_set_name: row.character_set_name ?? row.CHARACTER_SET_NAME ?? null,
    collation_name: row.collation_name ?? row.COLLATION_NAME ?? null,
  };
}

function mismatchFields(left = {}, right = {}) {
  return ["column_type", "data_type", "character_set_name", "collation_name"]
    .filter((field) => normalize(left[field]) !== normalize(right[field]));
}

export function requiresDedicatedIdentifierRepairRunner(sql = "") {
  const source = String(sql || "");
  return REPOSITORY_AUTHORITY_READINESS_REPAIR_MARKERS.every((marker) => source.includes(marker));
}

function dedicatedIdentifierRepairFinding() {
  return {
    code: "IDENTIFIER_REPAIR_DEDICATED_ATOMIC_RUNNER_REQUIRED",
    contract_key: "uuid.system_id.v1",
    identifier_name: "system_id",
    migration_file: "20260725_repository_authority_capability_readiness_repair.sql",
    required_runner: "repository-authority-capability-readiness-repair-runner.mjs",
    reason: "The comparison-time collation repair, target-row readback, ledger write, and capability-envelope consumption must commit atomically.",
  };
}

export async function assessLiveIdentifierComparisonContracts(sql = "", { query } = {}) {
  if (requiresDedicatedIdentifierRepairRunner(sql)) {
    const finding = dedicatedIdentifierRepairFinding();
    return {
      status: "block",
      contract_version: CANONICAL_IDENTIFIER_CONTRACT_VERSION,
      checked_comparison_count: 1,
      issue_count: 1,
      protected_mismatch_count: 0,
      issues: [finding],
      protected_mismatches: [],
      dedicated_atomic_runner_required: true,
      required_runner: finding.required_runner,
      secrets_included: false,
    };
  }

  const comparisons = extractCanonicalIdentifierComparisons(sql);
  if (!comparisons.length) {
    return {
      status: "pass",
      contract_version: CANONICAL_IDENTIFIER_CONTRACT_VERSION,
      checked_comparison_count: 0,
      issue_count: 0,
      protected_mismatch_count: 0,
      issues: [],
      protected_mismatches: [],
      secrets_included: false,
    };
  }

  const references = new Map();
  for (const comparison of comparisons) {
    for (const side of [comparison.left, comparison.right]) {
      references.set(schemaColumnKey(side.table_name, side.column_name), side);
    }
  }

  const clauses = [...references.values()].map(() => "(table_name = ? AND column_name = ?)");
  const params = [...references.values()].flatMap((ref) => [ref.table_name, ref.column_name]);
  const execute = query || ((statement, values) => getPool().query(statement, values));
  const result = await execute(
    `SELECT table_name, column_name, column_type, data_type, character_set_name, collation_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND (${clauses.join(" OR ")})`,
    params,
  );
  const rows = Array.isArray(result?.[0]) ? result[0] : (Array.isArray(result) ? result : result?.rows || []);
  const columns = new Map(rows.map((row) => {
    const normalized = normalizeSchemaRow(row);
    return [schemaColumnKey(normalized.table_name, normalized.column_name), normalized];
  }));

  const issues = [];
  const protectedMismatches = [];
  for (const comparison of comparisons) {
    const left = columns.get(schemaColumnKey(comparison.left.table_name, comparison.left.column_name));
    const right = columns.get(schemaColumnKey(comparison.right.table_name, comparison.right.column_name));
    if (!left || !right) {
      issues.push({
        code: "IDENTIFIER_SCHEMA_COLUMN_MISSING",
        contract_key: comparison.contract_key,
        left: comparison.left,
        right: comparison.right,
      });
      continue;
    }

    const mismatches = mismatchFields(left, right);
    if (!mismatches.length) continue;
    const finding = {
      code: "IDENTIFIER_COMPARISON_CONTRACT_MISMATCH",
      contract_key: comparison.contract_key,
      identifier_name: comparison.identifier_name,
      operator: comparison.operator,
      mismatch_fields: mismatches,
      left,
      right,
      binary_protected: comparison.binary_protected,
    };
    if (comparison.binary_protected) protectedMismatches.push(finding);
    else issues.push(finding);
  }

  return {
    status: issues.length ? "block" : "pass",
    contract_version: CANONICAL_IDENTIFIER_CONTRACT_VERSION,
    checked_comparison_count: comparisons.length,
    issue_count: issues.length,
    protected_mismatch_count: protectedMismatches.length,
    issues,
    protected_mismatches: protectedMismatches,
    secrets_included: false,
  };
}
