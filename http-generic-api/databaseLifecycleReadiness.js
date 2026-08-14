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

const RESOURCE_URI_PATTERN = /^mysql:\/\/[^/]+\/[^*]+$/u;
const RECIPE_KEY_PATTERN = /^database\.[a-z0-9_.-]+$/u;

function validFutureDate(value, now = new Date()) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

export function validateAuthorityBinding(binding = {}, { now = new Date(), recipeAllowlist = [] } = {}) {
  const resourceUri = String(binding.resource_uri || "");
  const recipeKey = String(binding.recipe_key || "");
  const errors = [];
  if (binding.resource_type !== "database_table") errors.push("resource_type_mismatch");
  if (!RESOURCE_URI_PATTERN.test(resourceUri) || resourceUri.includes("..") || /%2f|%5c/iu.test(resourceUri)) errors.push("resource_uri_invalid");
  if (!RECIPE_KEY_PATTERN.test(recipeKey)) errors.push("recipe_key_invalid");
  if (recipeAllowlist.length > 0 && !recipeAllowlist.includes(recipeKey)) errors.push("recipe_not_allowlisted");
  if (!binding.authority_binding_id || !binding.principal_id || !binding.policy_revision) errors.push("authority_identity_missing");
  if (!validFutureDate(binding.expires_at, now)) errors.push("authority_expired_or_invalid");
  return Object.freeze({ valid: errors.length === 0, errors, secrets_included: false });
}

export function validateApprovalBinding(approval = {}, { authority = {}, planFingerprint = "", now = new Date(), recipeAllowlist = [] } = {}) {
  const errors = [];
  if (!approval.approval_id || !approval.plan_id || !approval.approved_by) errors.push("approval_identity_missing");
  if (!/^sha256:[a-f0-9]{64}$/u.test(String(approval.plan_fingerprint || ""))) errors.push("approval_fingerprint_invalid");
  if (planFingerprint && approval.plan_fingerprint !== planFingerprint) errors.push("approval_plan_mismatch");
  if (authority.resource_uri && approval.resource_uri !== authority.resource_uri) errors.push("approval_resource_mismatch");
  if (authority.recipe_key && approval.recipe_key !== authority.recipe_key) errors.push("approval_recipe_mismatch");
  if (!RECIPE_KEY_PATTERN.test(String(approval.recipe_key || "")) || (recipeAllowlist.length > 0 && !recipeAllowlist.includes(approval.recipe_key))) errors.push("approval_recipe_not_allowlisted");
  if (!validFutureDate(approval.expires_at, now)) errors.push("approval_expired_or_invalid");
  return Object.freeze({ valid: errors.length === 0, errors, secrets_included: false });
}

export function assessMutationReadiness({ authority, approval, capability, lease, planFingerprint, receiptReadback, now = new Date(), recipeAllowlist = [] } = {}) {
  const authorityResult = validateAuthorityBinding(authority, { now, recipeAllowlist });
  const approvalResult = validateApprovalBinding(approval, { authority, planFingerprint, now, recipeAllowlist });
  const errors = [...authorityResult.errors, ...approvalResult.errors];
  if (!capability || capability.enabled !== true) errors.push("capability_not_enabled");
  if (!lease || lease.status !== "active" || !validFutureDate(lease.expires_at, now)) errors.push("lease_missing_or_expired");
  if (!receiptReadback || receiptReadback.available !== true) errors.push("receipt_readback_unavailable");
  return Object.freeze({
    ready: errors.length === 0,
    decision: errors.length === 0 ? "ready_for_governed_mutation" : "blocked",
    errors,
    mutation_enabled: false,
    database_mutated: false,
    secrets_included: false,
  });
}

export function buildMigrationLedgerEntry({ migration = {}, authorization = {}, environment = "non-production", readback = {} } = {}) {
  const authorized = authorization.status === "approved" && authorization.environment === environment && authorization.apply_authorized === true;
  const checksumReadback = buildReadbackContract({ migration, observed: readback });
  return Object.freeze({
    ledger_entry_status: authorized ? "preflight_authorized" : "preflight_only",
    migration_file: migration.file || null,
    checksum_sha256: migration.checksum_sha256 || null,
    statement_count: migration.statement_count || 0,
    environment: String(environment),
    authorization_id: authorization.authorization_id || null,
    apply_authorized: false,
    authorization_observed: authorized,
    readback_status: checksumReadback.readback_status,
    same_cycle_readback: checksumReadback.same_cycle_readback,
    migration_applied: false,
    database_mutated: false,
    secrets_included: false,
  });
}

export function assessReadinessAggregate({ checks = {}, environment = "non-production" } = {}) {
  const entries = Object.entries(checks);
  const failures = entries.filter(([, value]) => value !== true).map(([key]) => key);
  if (String(environment).toLowerCase() === "production") failures.push("production_apply_disabled");
  return Object.freeze({
    readiness_status: failures.length === 0 ? "ready_for_review" : "blocked",
    checks: Object.fromEntries(entries),
    blocking_reasons: [...new Set(failures)],
    migration_applied: false,
    database_mutated: false,
    runtime_consumer_enabled: false,
    secrets_included: false,
  });
}

export function reconcileMutationReceipt({ receipt = {}, readback = {} } = {}) {
  const samePlan = receipt.plan_id && receipt.plan_id === readback.plan_id && receipt.plan_fingerprint === readback.plan_fingerprint;
  const sameIdempotency = receipt.idempotency_key && receipt.idempotency_key === readback.idempotency_key;
  const matched = samePlan && sameIdempotency && readback.status === "matched";
  return Object.freeze({
    reconciliation_status: matched ? "reconciled" : "blocked",
    same_plan: Boolean(samePlan),
    same_idempotency_key: Boolean(sameIdempotency),
    readback_status: readback.status || "unknown",
    mutation_retried: false,
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
