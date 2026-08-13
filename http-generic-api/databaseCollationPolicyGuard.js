import { basename } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const POLICY_PATH = fileURLToPath(new URL("./database-engine-collation-policy.json", import.meta.url));
const POLICY_MIGRATION = "198_sprint67_database_collation_policy_guard.sql";
const SECRET_FIELD_PATTERN = /(encrypted_credentials|api_key_value|access_token|refresh_token|client_secret|password|private_key)/i;

function text(value = "") {
  return String(value ?? "").trim();
}

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = { ...details, secrets_included: false };
  return error;
}

function parsePolicy(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const targetCharacterSet = text(value.target_character_set);
  const targetCollation = text(value.target_collation);
  const policyKey = text(value.policy_key);
  const migrationFile = text(value.policy_migration_file);
  const readbackViews = Array.isArray(value.readback_views) ? value.readback_views.map(text).filter(Boolean) : [];
  const jsonAllowedCollations = Array.isArray(value.json_allowed_collations)
    ? value.json_allowed_collations.map(text).filter(Boolean)
    : [];
  if (
    value.contract !== "mad4b.database-engine-collation-policy.v1"
    || !policyKey
    || targetCharacterSet !== "utf8mb4"
    || targetCollation !== "utf8mb4_unicode_ci"
    || migrationFile !== POLICY_MIGRATION
    || readbackViews.length !== 2
    || !readbackViews.includes("v_database_collation_policy_violations")
    || !readbackViews.includes("v_database_collation_policy_status")
    || !jsonAllowedCollations.includes("utf8mb4_bin")
    || !jsonAllowedCollations.includes("utf8mb4_unicode_ci")
    || value.blocking !== true
  ) {
    throw fail(
      "DATABASE_COLLATION_POLICY_CONTRACT_INVALID",
      "The database collation policy contract is incomplete or unsafe.",
      { policy_path: POLICY_PATH },
    );
  }
  return Object.freeze({
    contract: value.contract,
    policy_key: policyKey,
    target_character_set: targetCharacterSet,
    target_collation: targetCollation,
    json_allowed_collations: Object.freeze(jsonAllowedCollations),
    blocking: true,
    policy_migration_file: migrationFile,
    readback_views: Object.freeze(readbackViews),
    secrets_included: false,
  });
}

export function loadDatabaseCollationPolicy() {
  try {
    return parsePolicy(JSON.parse(readFileSync(POLICY_PATH, "utf8")));
  } catch (cause) {
    if (cause?.code === "DATABASE_COLLATION_POLICY_CONTRACT_INVALID") throw cause;
    throw fail(
      "DATABASE_COLLATION_POLICY_UNAVAILABLE",
      "The database collation policy file could not be loaded.",
      { policy_path: POLICY_PATH, cause_code: cause?.code || null },
    );
  }
}

export const DATABASE_COLLATION_POLICY = loadDatabaseCollationPolicy();

function requiredSqlFragments(policy = DATABASE_COLLATION_POLICY) {
  return [
    "database_collation_policy_registry",
    "database_collation_policy_exception_registry",
    "v_database_collation_policy_violations",
    "v_database_collation_policy_status",
    policy.target_character_set,
    policy.target_collation,
    policy.policy_key,
  ];
}

export function assessDatabaseCollationPolicyMigrationContract({ migrationName = "", sql = "" } = {}) {
  const migration = basename(text(migrationName));
  if (migration !== POLICY_MIGRATION) {
    return {
      status: "not_applicable",
      contract: DATABASE_COLLATION_POLICY.contract,
      migration,
      policy_migration_file: POLICY_MIGRATION,
      secrets_included: false,
    };
  }
  const source = String(sql || "");
  const missing = requiredSqlFragments().filter((fragment) => !source.includes(fragment));
  const secretFieldMentioned = SECRET_FIELD_PATTERN.test(source);
  const status = missing.length === 0 && !secretFieldMentioned ? "pass" : "fail";
  return {
    status,
    contract: DATABASE_COLLATION_POLICY.contract,
    migration,
    policy_migration_file: POLICY_MIGRATION,
    target_character_set: DATABASE_COLLATION_POLICY.target_character_set,
    target_collation: DATABASE_COLLATION_POLICY.target_collation,
    missing_fragments: missing,
    secret_field_mentioned: secretFieldMentioned,
    blocking: true,
    applies_sql: false,
    secrets_included: false,
  };
}

export function databaseCollationPolicyReadbackQuery() {
  return {
    sql: `SELECT policy_key, target_character_set, target_collation, policy_status, blocking,
                 actionable_violation_count, observed_at
            FROM v_database_collation_policy_status
           WHERE policy_key = ?
           LIMIT 1`,
    params: [DATABASE_COLLATION_POLICY.policy_key],
    secrets_included: false,
  };
}

export async function inspectDatabaseCollationPolicy({ query } = {}) {
  if (typeof query !== "function") {
    throw fail(
      "DATABASE_COLLATION_POLICY_READBACK_UNAVAILABLE",
      "Database collation policy readback requires an explicit query executor.",
    );
  }
  const { sql, params } = databaseCollationPolicyReadbackQuery();
  let rows;
  try {
    [rows] = await query(sql, params);
  } catch (cause) {
    throw fail(
      "DATABASE_COLLATION_POLICY_READBACK_FAILED",
      "Database collation policy status could not be read back.",
      { cause_code: cause?.code || null },
    );
  }
  const row = rows?.[0] || null;
  const actionableViolations = Number(row?.actionable_violation_count);
  const ready = Boolean(row)
    && text(row.target_character_set) === DATABASE_COLLATION_POLICY.target_character_set
    && text(row.target_collation) === DATABASE_COLLATION_POLICY.target_collation
    && text(row.policy_status).toLowerCase() === "active"
    && Number(row.blocking) === 1
    && Number.isFinite(actionableViolations)
    && actionableViolations === 0;
  return {
    contract: DATABASE_COLLATION_POLICY.contract,
    ready,
    status: ready ? "pass" : "blocked",
    policy_key: DATABASE_COLLATION_POLICY.policy_key,
    target_character_set: DATABASE_COLLATION_POLICY.target_character_set,
    target_collation: DATABASE_COLLATION_POLICY.target_collation,
    actionable_violation_count: Number.isFinite(actionableViolations) ? actionableViolations : null,
    observed_at: row?.observed_at || null,
    readback_performed: true,
    secrets_included: false,
  };
}

export async function assertDatabaseCollationPolicyReady(deps = {}) {
  const result = await inspectDatabaseCollationPolicy(deps);
  if (result.ready) return result;
  throw fail(
    "DATABASE_COLLATION_POLICY_NOT_READY",
    "Database collation policy is not ready for governed migration or release readiness.",
    result,
  );
}
