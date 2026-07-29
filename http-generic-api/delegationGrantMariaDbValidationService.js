import { createHash } from "node:crypto";

export const DELEGATION_GRANT_MARIADB_VALIDATION_VERSION =
  "spec011-delegation-grant-mariadb-validation-v1";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const REQUIRED_TABLES = Object.freeze([
  "agent_delegations",
  "repository_automation_receipts",
]);
const REQUIRED_AGENT_COLUMNS = Object.freeze([
  "grant_schema_version",
  "approval_mode",
  "plan_hash",
  "resource_scope_json",
  "resource_scope_hash",
  "allowed_intents_json",
  "denied_intents_json",
  "max_risk_tier",
  "max_mutations",
  "max_retries",
  "max_pull_requests",
  "require_readback",
  "stop_on_drift",
  "grant_hash",
  "idempotency_key",
  "canonical_status",
  "runtime_policy_ready",
]);
const REQUIRED_AGENT_INDEXES = Object.freeze([
  "ux_agent_delegations_tenant_user_idempotency",
  "ix_agent_delegations_canonical_active",
  "ix_agent_delegations_plan_hash",
  "ix_agent_delegations_grant_hash",
]);
const REQUIRED_RECEIPT_INDEXES = Object.freeze([
  "uq_repository_automation_receipt_id",
  "uq_repository_automation_receipt_request",
  "idx_repository_automation_receipt_status",
]);

function compact(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : stableJson(value))
    .digest("hex");
}

function stringSet(value) {
  return new Set(Array.isArray(value) ? value.map((entry) => compact(entry, 191)).filter(Boolean) : []);
}

function includesAll(observed, required) {
  const set = stringSet(observed);
  return required.filter((entry) => !set.has(entry));
}

export function evaluateDelegationGrantMariaDbReadiness({
  migrationEvidence = {},
  schemaReadback = {},
  engineEvidence = {},
  rollbackAssessment = {},
  now = new Date().toISOString(),
} = {}) {
  const blockers = [];
  const checksum = compact(migrationEvidence.migration_checksum_sha256, 64).toLowerCase();
  const statementCount = Number(migrationEvidence.statement_count);

  if (migrationEvidence.mode !== "apply") blockers.push("DELEGATION_MARIADB_LEDGER_APPLY_REQUIRED");
  if (migrationEvidence.ledger_status !== "applied") blockers.push("DELEGATION_MARIADB_LEDGER_STATUS_INVALID");
  if (!HASH_PATTERN.test(checksum)) blockers.push("DELEGATION_MARIADB_CHECKSUM_REQUIRED");
  if (!Number.isInteger(statementCount) || statementCount < 1) blockers.push("DELEGATION_MARIADB_STATEMENT_COUNT_REQUIRED");
  if (migrationEvidence.readback_complete !== true) blockers.push("DELEGATION_MARIADB_LEDGER_READBACK_INCOMPLETE");

  if (schemaReadback.status !== "pass") blockers.push("DELEGATION_MARIADB_SCHEMA_READBACK_FAILED");
  if (schemaReadback.readback_complete !== true) blockers.push("DELEGATION_MARIADB_SCHEMA_READBACK_INCOMPLETE");
  if (schemaReadback.row_data_read === true) blockers.push("DELEGATION_MARIADB_SCHEMA_READBACK_ROW_DATA_FORBIDDEN");
  if (schemaReadback.secrets_included !== false) blockers.push("DELEGATION_MARIADB_SCHEMA_READBACK_SECRETS_FLAG_INVALID");

  for (const table of includesAll(schemaReadback.tables, REQUIRED_TABLES)) {
    blockers.push(`DELEGATION_MARIADB_TABLE_MISSING:${table}`);
  }
  for (const column of includesAll(schemaReadback.agent_delegations_columns, REQUIRED_AGENT_COLUMNS)) {
    blockers.push(`DELEGATION_MARIADB_AGENT_COLUMN_MISSING:${column}`);
  }
  for (const index of includesAll(schemaReadback.agent_delegations_indexes, REQUIRED_AGENT_INDEXES)) {
    blockers.push(`DELEGATION_MARIADB_AGENT_INDEX_MISSING:${index}`);
  }
  for (const index of includesAll(schemaReadback.repository_automation_receipts_indexes, REQUIRED_RECEIPT_INDEXES)) {
    blockers.push(`DELEGATION_MARIADB_RECEIPT_INDEX_MISSING:${index}`);
  }
  if (schemaReadback.effective_view_present !== true) blockers.push("DELEGATION_MARIADB_EFFECTIVE_VIEW_MISSING");

  if (String(engineEvidence.storage_engine || "").toLowerCase() !== "innodb") {
    blockers.push("DELEGATION_MARIADB_INNODB_REQUIRED");
  }
  if (!String(engineEvidence.character_set || "").toLowerCase().startsWith("utf8mb4")) {
    blockers.push("DELEGATION_MARIADB_UTF8MB4_REQUIRED");
  }
  if (!String(engineEvidence.collation || "").toLowerCase().startsWith("utf8mb4")) {
    blockers.push("DELEGATION_MARIADB_COLLATION_INVALID");
  }
  const sqlMode = String(engineEvidence.sql_mode || "").toUpperCase();
  if (!sqlMode.includes("STRICT_TRANS_TABLES") && !sqlMode.includes("STRICT_ALL_TABLES")) {
    blockers.push("DELEGATION_MARIADB_STRICT_SQL_MODE_REQUIRED");
  }
  if (engineEvidence.json_supported !== true) blockers.push("DELEGATION_MARIADB_JSON_SUPPORT_REQUIRED");
  if (engineEvidence.check_constraints_enforced !== true) blockers.push("DELEGATION_MARIADB_CHECK_CONSTRAINTS_REQUIRED");
  if (engineEvidence.transaction_isolation_verified !== true) blockers.push("DELEGATION_MARIADB_TRANSACTION_ISOLATION_UNVERIFIED");
  if (engineEvidence.secrets_included !== false) blockers.push("DELEGATION_MARIADB_ENGINE_SECRETS_FLAG_INVALID");

  if (rollbackAssessment.status !== "pass") blockers.push("DELEGATION_MARIADB_ROLLBACK_ASSESSMENT_REQUIRED");
  if (rollbackAssessment.destructive_change_detected === true) blockers.push("DELEGATION_MARIADB_DESTRUCTIVE_CHANGE_FORBIDDEN");
  if (rollbackAssessment.runtime_binding_enabled === true) blockers.push("DELEGATION_MARIADB_RUNTIME_BINDING_MUST_REMAIN_DISABLED");

  const uniqueBlockers = [...new Set(blockers)];
  const verified = uniqueBlockers.length === 0;
  const readbackPayload = {
    migration_checksum_sha256: checksum || null,
    statement_count: Number.isInteger(statementCount) ? statementCount : null,
    ledger_evidence_ref: compact(migrationEvidence.ledger_evidence_ref, 500) || null,
    tables: [...stringSet(schemaReadback.tables)].sort(),
    agent_delegations_columns: [...stringSet(schemaReadback.agent_delegations_columns)].sort(),
    agent_delegations_indexes: [...stringSet(schemaReadback.agent_delegations_indexes)].sort(),
    repository_automation_receipts_indexes:
      [...stringSet(schemaReadback.repository_automation_receipts_indexes)].sort(),
    engine: {
      storage_engine: compact(engineEvidence.storage_engine, 32).toLowerCase(),
      character_set: compact(engineEvidence.character_set, 64).toLowerCase(),
      collation: compact(engineEvidence.collation, 64).toLowerCase(),
      sql_mode: compact(engineEvidence.sql_mode, 1000),
      json_supported: engineEvidence.json_supported === true,
      check_constraints_enforced: engineEvidence.check_constraints_enforced === true,
      transaction_isolation_verified: engineEvidence.transaction_isolation_verified === true,
    },
    evaluated_at: new Date(now).toISOString(),
    secrets_included: false,
  };

  return {
    ok: true,
    report_type: "delegation_grant_mariadb_readiness_evidence",
    validation_version: DELEGATION_GRANT_MARIADB_VALIDATION_VERSION,
    status: verified ? "verified_applied" : "blocked",
    decision: verified ? "eligible_for_certified_adapter_binding" : "blocked",
    blockers: uniqueBlockers,
    migration_applied: verified,
    readback_complete: verified,
    migration_checksum_sha256: verified ? checksum : null,
    statement_count: verified ? statementCount : null,
    schema_readback_fingerprint: verified ? sha256(readbackPayload) : null,
    evidence: readbackPayload,
    guarantees: {
      database_write_performed: false,
      migration_apply_performed: false,
      runtime_binding_changed: false,
      row_data_read: false,
      provider_call_performed: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export const _testingDelegationGrantMariaDbValidation = {
  stableJson,
  sha256,
  stringSet,
  includesAll,
  REQUIRED_TABLES,
  REQUIRED_AGENT_COLUMNS,
  REQUIRED_AGENT_INDEXES,
  REQUIRED_RECEIPT_INDEXES,
};
