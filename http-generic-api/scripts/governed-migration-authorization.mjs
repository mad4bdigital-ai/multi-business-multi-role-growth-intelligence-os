#!/usr/bin/env node

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";
import {
  assessMigrationSqlPreflight,
  extractMigrationReadinessRequirementsFromSql,
  splitSqlStatements,
} from "../releaseReadiness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(API_DIR, "migrations");
const AUTHORIZATION_POLICY_KEY = "governed_migration_runner_authorization_v1";
const APPLY_AUTHORIZATION_POLICY_KEY = "mysql_resource_governance_apply_block_v1";
const REQUIRED_ENVELOPE = Object.freeze({
  app_key: "mysql",
  capability_key: "mysql_resource_governance",
  operation_intent: "mysql.resource.governance_apply",
  runtime_surface: "governed_resource_run",
  resource_uri: "mysql://platform-schema/governed_migration_authorization_registry",
});
const RISK_ORDER = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    mode: "dry_run",
    migration: "",
    expectedChecksum: "",
    riskTier: "medium",
    confirm: "",
    capabilityEnvelopeId: "",
    authorizedBy: "platform_admin",
    reason: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = String(argv[index] || "");
    const readValue = (name) => item.startsWith(`${name}=`) ? item.slice(name.length + 1) : String(argv[++index] || "");
    if (item === "--dry-run") args.mode = "dry_run";
    else if (item === "--apply") args.mode = "apply";
    else if (item === "--migration" || item.startsWith("--migration=")) args.migration = readValue("--migration");
    else if (item === "--expected-checksum" || item.startsWith("--expected-checksum=")) args.expectedChecksum = readValue("--expected-checksum");
    else if (item === "--risk-tier" || item.startsWith("--risk-tier=")) args.riskTier = readValue("--risk-tier");
    else if (item === "--confirm" || item.startsWith("--confirm=")) args.confirm = readValue("--confirm");
    else if (item === "--capability-envelope-id" || item.startsWith("--capability-envelope-id=")) args.capabilityEnvelopeId = readValue("--capability-envelope-id");
    else if (item === "--authorized-by" || item.startsWith("--authorized-by=")) args.authorizedBy = readValue("--authorized-by");
    else if (item === "--reason" || item.startsWith("--reason=")) args.reason = readValue("--reason");
    else throw validationError("unsupported_argument", `Unsupported argument: ${item}`);
  }
  return args;
}

function validationError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function compact(value = "", max = 512) {
  return String(value || "").trim().slice(0, max);
}

function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function sha256(value = "") {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function normalizeMigrationFile(value = "") {
  const migration = compact(value, 255);
  const basename = path.basename(migration);
  if (!migration || migration !== basename || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.sql$/.test(migration)) {
    throw validationError(
      "invalid_migration_file",
      "--migration must be one repository migration filename without path separators.",
      { migration }
    );
  }
  return migration;
}

function requiredConfirmation(migration, checksum) {
  const stem = migration.replace(/\.sql$/i, "").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
  return `AUTHORIZE_MIGRATION_${stem}_${checksum.slice(0, 12).toUpperCase()}`;
}

function minimumRiskTier(preflight) {
  return Number(preflight?.risk_count || 0) > 0 ? "high" : "medium";
}

function validateRiskTier(requested, minimum) {
  const riskTier = compact(requested, 16).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(RISK_ORDER, riskTier)) {
    throw validationError("invalid_risk_tier", "--risk-tier must be low, medium, high, or critical.");
  }
  if (RISK_ORDER[riskTier] < RISK_ORDER[minimum]) {
    throw validationError(
      "risk_tier_below_minimum",
      `Migration authorization requires risk tier ${minimum} or higher.`,
      { requested: riskTier, minimum }
    );
  }
  return riskTier;
}

async function readAuthorization(pool, migration) {
  const [rows] = await pool.query(
    `SELECT migration_file, authorization_status, authorization_source, policy_key, risk_tier,
            requires_preflight, requires_confirmation, allow_record_only, allow_apply,
            notes, metadata_json, created_at, updated_at
       FROM governed_migration_authorization_registry
      WHERE migration_file = ?
      LIMIT 1`,
    [migration]
  );
  return rows?.[0] || null;
}

async function readApplyPolicy(pool) {
  const [rows] = await pool.query(
    `SELECT policy_key, app_key, capability_key, operation_intent, runtime_surface, status,
            allow_external_write, allow_no_credential_binding, requires_ready_for_dispatch,
            requires_dispatch_allowed, requires_zero_blocking_gaps, requires_audit_evidence,
            requires_readback, requires_typed_confirmation, requires_same_cycle_dry_run
       FROM capability_apply_authorization_policy_registry
      WHERE policy_key = ?
        AND app_key = ?
        AND capability_key = ?
        AND operation_intent = ?
        AND runtime_surface = ?
        AND status = 'active'
      LIMIT 1`,
    [
      APPLY_AUTHORIZATION_POLICY_KEY,
      REQUIRED_ENVELOPE.app_key,
      REQUIRED_ENVELOPE.capability_key,
      REQUIRED_ENVELOPE.operation_intent,
      REQUIRED_ENVELOPE.runtime_surface,
    ]
  );
  return rows?.[0] || null;
}

async function requireCapabilityEnvelope(pool, envelopeId) {
  const id = compact(envelopeId, 64);
  if (!id) {
    throw validationError("capability_envelope_required", "--capability-envelope-id is required for --apply.");
  }
  const [rows] = await pool.query(
    `SELECT envelope_id, app_key, capability_key, operation_intent, selected_runtime_surface,
            envelope_status, decision, dispatch_allowed, apply_allowed, blocking_gap_count,
            execution_status, expires_at, secrets_included, envelope_json
       FROM capability_resolution_envelope_ledger
      WHERE envelope_id = ?
      LIMIT 1`,
    [id]
  );
  const row = rows?.[0] || null;
  if (!row) throw validationError("capability_envelope_not_found", "Capability envelope was not found.");
  if (row.envelope_status !== "ready_for_dispatch" || row.decision !== "ready_for_dispatch") {
    throw validationError("capability_envelope_not_ready", "Capability envelope must be ready_for_dispatch.");
  }
  if (Number(row.dispatch_allowed || 0) !== 1 || Number(row.apply_allowed || 0) !== 1 || Number(row.blocking_gap_count || 0) !== 0) {
    throw validationError("capability_envelope_not_apply_authorized", "Capability envelope is not dispatchable and apply-authorized with zero blocking gaps.");
  }
  if (Number(row.secrets_included || 0) !== 0) {
    throw validationError("capability_envelope_secret_flagged", "Secret-bearing capability envelopes are rejected.");
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    throw validationError("capability_envelope_expired", "Capability envelope is expired.");
  }
  const contract = {
    app_key: row.app_key,
    capability_key: row.capability_key,
    operation_intent: row.operation_intent,
    runtime_surface: row.selected_runtime_surface,
  };
  for (const [key, expected] of Object.entries(REQUIRED_ENVELOPE)) {
    if (key === "resource_uri") continue;
    if (String(contract[key] || "") !== expected) {
      throw validationError("capability_envelope_scope_mismatch", "Capability envelope scope does not match governed migration authorization.", { key, expected, actual: contract[key] || null });
    }
  }
  const envelopeJson = safeJson(row.envelope_json, {});
  const applyAuthorization = envelopeJson.apply_authorization || {};
  if (String(envelopeJson?.request_context?.resource_uri || "") !== REQUIRED_ENVELOPE.resource_uri) {
    throw validationError("capability_envelope_resource_mismatch", "Capability envelope resource URI does not match the migration authorization registry.");
  }
  if (
    applyAuthorization.policy_key !== APPLY_AUTHORIZATION_POLICY_KEY ||
    applyAuthorization.status !== "apply_authorized" ||
    applyAuthorization.allow_external_write !== false ||
    applyAuthorization.no_external_write !== true ||
    applyAuthorization.no_provider_call !== true ||
    applyAuthorization.no_credential_payload_read !== true ||
    applyAuthorization.requires_readback !== true
  ) {
    throw validationError("capability_envelope_apply_policy_mismatch", "Capability envelope lacks the required no-external-write MySQL governance apply authorization evidence.");
  }
  return row;
}

export async function runGovernedMigrationAuthorization(args = parseArgs(), dependencies = {}) {
  const pool = dependencies.pool || getPool();
  const readFile = dependencies.readFile || fs.readFile;
  const migrationsDir = dependencies.migrationsDir || MIGRATIONS_DIR;
  const migration = normalizeMigrationFile(args.migration);
  const migrationPath = path.join(migrationsDir, migration);
  let sql;
  try {
    sql = await readFile(migrationPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw validationError("migration_file_not_found", `Migration file was not found: ${migration}`);
    throw error;
  }
  const checksum = sha256(sql);
  const preflight = assessMigrationSqlPreflight(migration, sql);
  const requirements = extractMigrationReadinessRequirementsFromSql(sql);
  const statements = splitSqlStatements(sql);
  const statementCount = statements.length;
  const preflightStatementCount = Number(preflight?.counts?.statements || 0);
  if (preflightStatementCount !== statementCount) {
    throw validationError("preflight_statement_count_mismatch", "Migration preflight statement count does not match executable statement count.", { preflight_statement_count: preflightStatementCount, statement_count: statementCount });
  }
  if (preflight.status !== "pass") {
    throw validationError("migration_preflight_not_pass", "Migration preflight must pass before authorization.", { preflight_status: preflight.status, risk_count: Number(preflight.risk_count || 0) });
  }
  const minimumRisk = minimumRiskTier(preflight);
  const riskTier = validateRiskTier(args.riskTier, minimumRisk);
  const confirmation = requiredConfirmation(migration, checksum);
  const currentAuthorization = await readAuthorization(pool, migration);
  const applyPolicy = await readApplyPolicy(pool);
  if (!applyPolicy) {
    throw validationError("mysql_resource_governance_apply_policy_missing", "The active MySQL resource governance apply policy is missing.");
  }
  const evidence = {
    migration,
    checksum,
    preflight_status: preflight.status,
    preflight_risk_count: Number(preflight.risk_count || 0),
    statement_count: statementCount,
    requirements,
    minimum_risk_tier: minimumRisk,
    requested_risk_tier: riskTier,
    required_confirmation: confirmation,
    required_capability_envelope: REQUIRED_ENVELOPE,
    apply_authorization_policy_key: APPLY_AUTHORIZATION_POLICY_KEY,
    current_authorization: currentAuthorization ? {
      authorization_status: currentAuthorization.authorization_status,
      authorization_source: currentAuthorization.authorization_source,
      policy_key: currentAuthorization.policy_key,
      risk_tier: currentAuthorization.risk_tier,
      allow_apply: Boolean(currentAuthorization.allow_apply),
      allow_record_only: Boolean(currentAuthorization.allow_record_only),
      metadata: safeJson(currentAuthorization.metadata_json, {}),
      updated_at: currentAuthorization.updated_at,
    } : null,
    applies_migration_sql: false,
    provider_calls_made: 0,
    credential_payload_reads: 0,
    external_writes_made: 0,
    secrets_included: false,
  };
  if (args.mode !== "apply") {
    return { ok: true, mode: "dry_run", authorization_write: false, ...evidence };
  }
  const expectedChecksum = compact(args.expectedChecksum, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedChecksum) || expectedChecksum !== checksum) {
    throw validationError("migration_checksum_mismatch", "--expected-checksum must exactly match the current migration file SHA-256.", { expected: expectedChecksum || null, actual: checksum });
  }
  if (args.confirm !== confirmation) {
    throw validationError("typed_confirmation_mismatch", `Apply requires --confirm=${confirmation}`);
  }
  const reason = compact(args.reason, 1000);
  if (reason.length < 20) {
    throw validationError("authorization_reason_required", "--reason must contain at least 20 characters for audit evidence.");
  }
  const authorizedBy = compact(args.authorizedBy, 64) || "platform_admin";
  const envelope = await requireCapabilityEnvelope(pool, args.capabilityEnvelopeId);
  const metadata = {
    migration_checksum_sha256: checksum,
    preflight_status: preflight.status,
    preflight_risk_count: Number(preflight.risk_count || 0),
    statement_count: statementCount,
    required_schema_objects: requirements.schema_objects || [],
    capability_envelope_id: envelope.envelope_id,
    capability_policy_key: APPLY_AUTHORIZATION_POLICY_KEY,
    authorized_by: authorizedBy,
    reason,
    applies_migration_sql: false,
    no_provider_call: true,
    no_credential_payload_read: true,
    no_external_write: true,
    secrets_included: false,
  };
  const connection = typeof pool.getConnection === "function" ? await pool.getConnection() : pool;
  let mutationResult;
  try {
    if (typeof connection.beginTransaction === "function") await connection.beginTransaction();
    [mutationResult] = await connection.query(
      `INSERT INTO governed_migration_authorization_registry
        (migration_file, authorization_status, authorization_source, policy_key, risk_tier,
         requires_preflight, requires_confirmation, allow_record_only, allow_apply, notes, metadata_json)
       VALUES (?, 'authorized', 'platform_admin_review', ?, ?, 1, 1, 1, 1, ?, ?)
       ON DUPLICATE KEY UPDATE
         authorization_status = VALUES(authorization_status),
         authorization_source = VALUES(authorization_source),
         policy_key = VALUES(policy_key),
         risk_tier = VALUES(risk_tier),
         requires_preflight = VALUES(requires_preflight),
         requires_confirmation = VALUES(requires_confirmation),
         allow_record_only = VALUES(allow_record_only),
         allow_apply = VALUES(allow_apply),
         notes = VALUES(notes),
         metadata_json = VALUES(metadata_json),
         updated_at = CURRENT_TIMESTAMP`,
      [migration, AUTHORIZATION_POLICY_KEY, riskTier, reason, JSON.stringify(metadata)]
    );
    await connection.query(
      `UPDATE capability_resolution_envelope_ledger
          SET execution_ref = ?, execution_status = 'referenced', updated_at = CURRENT_TIMESTAMP
        WHERE envelope_id = ?
          AND envelope_status = 'ready_for_dispatch'
          AND dispatch_allowed = 1
          AND apply_allowed = 1
          AND blocking_gap_count = 0
          AND secrets_included = 0`,
      [`governed_migration_authorization:${migration}:${checksum.slice(0, 16)}`, envelope.envelope_id]
    );
    if (typeof connection.commit === "function") await connection.commit();
  } catch (error) {
    if (typeof connection.rollback === "function") await connection.rollback();
    throw error;
  } finally {
    if (connection !== pool && typeof connection.release === "function") connection.release();
  }
  const readback = await readAuthorization(pool, migration);
  const readbackMetadata = safeJson(readback?.metadata_json, {});
  const readbackVerified = Boolean(
    readback &&
    readback.authorization_status === "authorized" &&
    readback.authorization_source === "platform_admin_review" &&
    readback.policy_key === AUTHORIZATION_POLICY_KEY &&
    readback.risk_tier === riskTier &&
    Number(readback.requires_preflight || 0) === 1 &&
    Number(readback.requires_confirmation || 0) === 1 &&
    Number(readback.allow_record_only || 0) === 1 &&
    Number(readback.allow_apply || 0) === 1 &&
    readbackMetadata.migration_checksum_sha256 === checksum &&
    readbackMetadata.capability_envelope_id === envelope.envelope_id &&
    readbackMetadata.applies_migration_sql === false &&
    readbackMetadata.secrets_included === false
  );
  if (!readbackVerified) {
    throw validationError("migration_authorization_readback_failed", "Migration authorization write completed but same-cycle readback did not match the requested contract.");
  }
  return {
    ok: true,
    mode: "apply",
    authorization_write: true,
    changed_rows: Number(mutationResult?.affectedRows || 0),
    capability_envelope_id: envelope.envelope_id,
    readback_verified: true,
    authorization: {
      migration_file: readback.migration_file,
      authorization_status: readback.authorization_status,
      authorization_source: readback.authorization_source,
      policy_key: readback.policy_key,
      risk_tier: readback.risk_tier,
      allow_record_only: true,
      allow_apply: true,
      metadata: readbackMetadata,
      updated_at: readback.updated_at,
    },
    ...evidence,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runGovernedMigrationAuthorization(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
    })
    .catch(async (error) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: error.code || "governed_migration_authorization_failed", message: error.message, details: error.details || undefined }, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
