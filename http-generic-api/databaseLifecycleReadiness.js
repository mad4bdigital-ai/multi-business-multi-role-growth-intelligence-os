import crypto from "node:crypto";

const DESTRUCTIVE_RULES = Object.freeze([
  ["drop_statement", /\bDROP\s+(?:TABLE|VIEW|DATABASE|SCHEMA|INDEX|TRIGGER|PROCEDURE|FUNCTION|EVENT)\b/iu],
  ["truncate_statement", /\bTRUNCATE\s+TABLE\b/iu],
  ["delete_statement", /\bDELETE\s+FROM\b/iu],
  ["alter_drop", /\bALTER\s+TABLE\b[\s\S]{0,500}\bDROP\s+(?:COLUMN|INDEX|KEY|CONSTRAINT|FOREIGN\s+KEY)\b/iu],
  ["rename_table", /\bRENAME\s+TABLE\b/iu],
]);

function stripSqlComments(sql = "") {
  return String(sql).replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/(^|\n)\s*--[^\n]*/gu, "$1");
}

export function sha256(value = "") {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function splitSqlStatements(sql = "") {
  return stripSqlComments(sql).split(";").map((item) => item.trim()).filter(Boolean);
}

export function destructiveFindings(sql = "") {
  const source = stripSqlComments(sql);
  return DESTRUCTIVE_RULES.filter(([, pattern]) => pattern.test(source)).map(([code]) => code);
}

export function assessMigrationPreflight({ file, sql, expectedTables = [], environment = "non-production" }) {
  const statements = splitSqlStatements(sql);
  const findings = destructiveFindings(sql);
  const missingTables = expectedTables.filter((table) => {
    const escaped = String(table).replace(/[.*+?^${}()|[\[\]\\\\]/gu, "\\\\$&");
    return !new RegExp("\\bCREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+`?" + escaped + "`?\\b", "iu").test(sql);
  });
  const blockedEnvironment = String(environment).toLowerCase() === "production";
  const ready = statements.length > 0 && findings.length === 0 && missingTables.length === 0 && !blockedEnvironment;
  return Object.freeze({
    file: String(file),
    environment: String(environment),
    checksum_sha256: sha256(sql),
    statement_count: statements.length,
    expected_tables: [...expectedTables],
    missing_expected_tables: missingTables,
    destructive_findings: findings,
    readiness_status: ready ? "ready_for_governed_preflight" : "blocked",
    migration_applied: false,
    database_mutated: false,
    apply_authorized: false,
    secrets_included: false,
  });
}

export function buildReadbackContract({ migration, observed = {} }) {
  const checksumMatches = observed.checksum_sha256 === migration.checksum_sha256;
  const statementCountMatches = Number(observed.statement_count) === migration.statement_count;
  return Object.freeze({
    file: migration.file,
    expected_checksum_sha256: migration.checksum_sha256,
    observed_checksum_sha256: observed.checksum_sha256 ?? null,
    checksum_matches: checksumMatches,
    expected_statement_count: migration.statement_count,
    observed_statement_count: observed.statement_count ?? null,
    statement_count_matches: statementCountMatches,
    same_cycle_readback: checksumMatches && statementCountMatches,
    readback_status: checksumMatches && statementCountMatches ? "verified" : "blocked",
    migration_applied: false,
    database_mutated: false,
    secrets_included: false,
  });
}

export function buildEnvironmentAttestation({ environment, branch, expectedSha, deployedSha, runtimeImmutable = true, breakGlass = [] }) {
  const shaMatches = Boolean(expectedSha && deployedSha && expectedSha === deployedSha);
  const unreconciled = breakGlass.filter((item) => item && item.reconciliation_status !== "closed");
  return Object.freeze({
    environment: String(environment),
    authority_branch: String(branch),
    expected_sha: expectedSha || null,
    deployed_sha: deployedSha || null,
    sha_matches: shaMatches,
    runtime_immutable: Boolean(runtimeImmutable),
    break_glass_unreconciled_count: unreconciled.length,
    readiness_status: shaMatches && runtimeImmutable && unreconciled.length === 0 ? "ready" : "blocked",
    production_promotion_authorized: false,
    database_mutated: false,
    secrets_included: false,
  });
}

export function buildRollbackMatrix(entries = []) {
  return Object.freeze(entries.map((entry) => Object.freeze({
    operation: String(entry.operation),
    pre_change_evidence_required: true,
    rollback_evidence_required: true,
    clean_readback_required: true,
    rollback_status: "not_executed",
    database_mutated: false,
    secrets_included: false,
  })));
}

export function buildTrackBManifest({ migrations = [], readbacks = [], attestations = [], rollback = [] } = {}) {
  return Object.freeze({
    schema_version: 1,
    track: "B",
    branch: "agent/track-b-db-lifecycle-readiness",
    migration_applied: false,
    database_mutated: false,
    runtime_consumer_enabled: false,
    provider_called: false,
    production_promotion_authorized: false,
    migrations,
    readbacks,
    attestations,
    rollback_matrix: rollback,
    secrets_included: false,
  });
}
