import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";
import {
  assessMigrationSqlPreflight,
  extractMigrationReadinessRequirementsFromSql,
  splitSqlStatements,
} from "./releaseReadiness.js";
import {
  capabilityEnvelopeError,
  markCapabilityEnvelopeReferenced,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const AUTHORIZATION_POLICY_KEY = "governed_migration_runner_authorization_v1";
const AUTHORIZATION_SOURCE = "governed_admin_bootstrap_tool";
const MIGRATION_EXECUTOR_APPLY_POLICY = Object.freeze({
  policy_key: "governed_migration_execute_apply_v1",
  app_key: "platform_orchestration",
  capability_key: "governed_migration_execute",
  operation_intent: "governed_migration_apply",
  runtime_surface: "governed_migration_execute",
  allowed_source_tiers: ["platform_managed_fallback"],
  policy: {
    external_write_allowed: false,
    provider_call_allowed: false,
    credential_payload_read_allowed: false,
    migration_authorization_registry_required: true,
    checksum_bound: true,
    statement_count_bound: true,
    zero_risk_preflight_required: true,
    exact_typed_confirmation_required: true,
    governed_ledger_required: true,
    same_cycle_schema_readback_required: true,
    secrets_included: false,
  },
});
const MIGRATION_EXECUTOR_CERTIFICATION = Object.freeze({
  certification_key: "governed_migration_execute",
  surface_key: "governed_migration_execute",
  surface_family: "governed_migration",
  tool_or_action_key: "governed_migration_execute",
  risk_class: "D",
  certification_status: "bootstrap_registered",
  smoke_strategy: "checksum_bound_dry_run_apply_schema_readback",
  last_evidence_ref: "governed_migration_authorization_bootstrap",
});
const ACCEPTED_OPERATION_INTENTS = Object.freeze([
  "governed_migration_authorization_bootstrap",
  "migration_authorization_bootstrap",
  "governed.migration.authorization.bootstrap",
]);

function compact(value = "", max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function bootstrapError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function sha256(value = "") {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function stripSqlComments(sql = "") {
  return String(sql || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\n)\s*--[^\n]*/g, "$1");
}

function destructiveSqlFindings(sql = "") {
  const source = stripSqlComments(sql);
  const rules = [
    ["drop_statement", /\bDROP\s+(?:TABLE|VIEW|DATABASE|SCHEMA|INDEX|TRIGGER|PROCEDURE|FUNCTION|EVENT)\b/i],
    ["truncate_statement", /\bTRUNCATE\s+TABLE\b/i],
    ["delete_statement", /\bDELETE\s+FROM\b/i],
    ["alter_drop", /\bALTER\s+TABLE\b[\s\S]{0,500}\bDROP\s+(?:COLUMN|INDEX|KEY|CONSTRAINT|FOREIGN\s+KEY)\b/i],
    ["rename_table", /\bRENAME\s+TABLE\b/i],
    ["foreign_key_checks_disabled", /\bSET\s+FOREIGN_KEY_CHECKS\s*=\s*0\b/i],
  ];
  return rules.filter(([, pattern]) => pattern.test(source)).map(([code]) => code);
}

function normalizeMigrationName(value = "") {
  const migration = compact(value, 255);
  if (!migration || migration !== path.basename(migration) || !/^[A-Za-z0-9._-]+\.sql$/.test(migration)) {
    throw bootstrapError(400, "governed_migration_authorization_invalid_migration", "migration must be one repository migration filename.");
  }
  return migration;
}

export function governedMigrationAuthorizationConfirmation(migration = "") {
  const normalized = normalizeMigrationName(migration);
  return `AUTHORIZE_GOVERNED_MIGRATION_${normalized.replace(/\.sql$/i, "").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return {}; }
}

async function queryMigrationExecutorApplyPolicy(db) {
  const [rows] = await db.query(
    `SELECT policy_key, app_key, capability_key, operation_intent, runtime_surface, status,
            allow_external_write, allow_credential_binding, allow_no_credential_binding,
            requires_ready_for_dispatch, requires_dispatch_allowed, requires_zero_blocking_gaps,
            requires_audit_evidence, requires_readback, requires_typed_confirmation,
            requires_same_cycle_dry_run, allowed_source_tiers_json, policy_json, notes
       FROM capability_apply_authorization_policy_registry
      WHERE app_key = ? AND capability_key = ? AND runtime_surface = ?
      LIMIT 1`,
    [
      MIGRATION_EXECUTOR_APPLY_POLICY.app_key,
      MIGRATION_EXECUTOR_APPLY_POLICY.capability_key,
      MIGRATION_EXECUTOR_APPLY_POLICY.runtime_surface,
    ]
  );
  return rows?.[0] || null;
}

function verifyMigrationExecutorApplyPolicy(row) {
  if (!row) {
    throw bootstrapError(500, "governed_migration_executor_apply_policy_readback_failed", "Migration executor apply policy was not visible during same-cycle readback.");
  }
  const sourceTiers = parseMetadata(row.allowed_source_tiers_json);
  const policy = parseMetadata(row.policy_json);
  const exact =
    row.app_key === MIGRATION_EXECUTOR_APPLY_POLICY.app_key &&
    row.capability_key === MIGRATION_EXECUTOR_APPLY_POLICY.capability_key &&
    row.operation_intent === MIGRATION_EXECUTOR_APPLY_POLICY.operation_intent &&
    row.runtime_surface === MIGRATION_EXECUTOR_APPLY_POLICY.runtime_surface &&
    row.status === "active" &&
    Number(row.allow_external_write || 0) === 0 &&
    Number(row.allow_credential_binding || 0) === 0 &&
    Number(row.allow_no_credential_binding || 0) === 1 &&
    Number(row.requires_ready_for_dispatch || 0) === 1 &&
    Number(row.requires_dispatch_allowed || 0) === 1 &&
    Number(row.requires_zero_blocking_gaps || 0) === 1 &&
    Number(row.requires_audit_evidence || 0) === 1 &&
    Number(row.requires_readback || 0) === 1 &&
    Number(row.requires_typed_confirmation || 0) === 1 &&
    Number(row.requires_same_cycle_dry_run || 0) === 1 &&
    Array.isArray(sourceTiers) && sourceTiers.length === 1 && sourceTiers[0] === "platform_managed_fallback" &&
    policy?.external_write_allowed === false &&
    policy?.provider_call_allowed === false &&
    policy?.credential_payload_read_allowed === false &&
    policy?.migration_authorization_registry_required === true &&
    policy?.checksum_bound === true &&
    policy?.statement_count_bound === true &&
    policy?.zero_risk_preflight_required === true &&
    policy?.exact_typed_confirmation_required === true &&
    policy?.governed_ledger_required === true &&
    policy?.same_cycle_schema_readback_required === true &&
    policy?.secrets_included === false;
  if (!exact) {
    throw bootstrapError(409, "governed_migration_executor_apply_policy_mismatch", "Migration executor apply policy does not match the fail-closed bootstrap contract.", {
      policy_key: row.policy_key || null,
    });
  }
  return {
    ...row,
    allowed_source_tiers_json: sourceTiers,
    policy_json: policy,
    secrets_included: false,
  };
}

async function ensureMigrationExecutorApplyPolicy(db) {
  await db.query(
    `INSERT INTO capability_apply_authorization_policy_registry
      (policy_key, app_key, capability_key, operation_intent, runtime_surface, status,
       allow_external_write, allow_credential_binding, allow_no_credential_binding,
       requires_ready_for_dispatch, requires_dispatch_allowed, requires_zero_blocking_gaps,
       requires_audit_evidence, requires_readback, requires_typed_confirmation,
       requires_same_cycle_dry_run, allowed_source_tiers_json, policy_json, notes)
     VALUES (?, ?, ?, ?, ?, 'active', 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       operation_intent = VALUES(operation_intent),
       status = 'active',
       allow_external_write = 0,
       allow_credential_binding = 0,
       allow_no_credential_binding = 1,
       requires_ready_for_dispatch = 1,
       requires_dispatch_allowed = 1,
       requires_zero_blocking_gaps = 1,
       requires_audit_evidence = 1,
       requires_readback = 1,
       requires_typed_confirmation = 1,
       requires_same_cycle_dry_run = 1,
       allowed_source_tiers_json = VALUES(allowed_source_tiers_json),
       policy_json = VALUES(policy_json),
       notes = VALUES(notes),
       updated_at = CURRENT_TIMESTAMP`,
    [
      MIGRATION_EXECUTOR_APPLY_POLICY.policy_key,
      MIGRATION_EXECUTOR_APPLY_POLICY.app_key,
      MIGRATION_EXECUTOR_APPLY_POLICY.capability_key,
      MIGRATION_EXECUTOR_APPLY_POLICY.operation_intent,
      MIGRATION_EXECUTOR_APPLY_POLICY.runtime_surface,
      JSON.stringify(MIGRATION_EXECUTOR_APPLY_POLICY.allowed_source_tiers),
      JSON.stringify(MIGRATION_EXECUTOR_APPLY_POLICY.policy),
      "Bootstrap-only internal runner policy. Every apply still requires checksum-bound migration authorization, exact statement count, zero-risk preflight, typed confirmation, governed ledger persistence, and same-cycle schema readback.",
    ]
  );
  return verifyMigrationExecutorApplyPolicy(await queryMigrationExecutorApplyPolicy(db));
}

async function queryMigrationExecutorDispatchCertification(db) {
  const [rows] = await db.query(
    `SELECT certification_key, surface_key, surface_family, tool_or_action_key, risk_class,
            certification_status, smoke_strategy, dispatch_allowed, apply_allowed,
            requires_resource_authority, requires_dry_run, requires_audit_evidence,
            requires_readback, last_evidence_ref, last_certified_at, expires_at, notes
       FROM runtime_dispatch_certification_registry
      WHERE certification_key = ?
      LIMIT 1`,
    [MIGRATION_EXECUTOR_CERTIFICATION.certification_key]
  );
  return rows?.[0] || null;
}

function verifyMigrationExecutorDispatchCertification(row) {
  if (!row) {
    throw bootstrapError(500, "governed_migration_executor_dispatch_certification_readback_failed", "Migration executor dispatch certification was not visible during same-cycle readback.");
  }
  const exact =
    row.certification_key === MIGRATION_EXECUTOR_CERTIFICATION.certification_key &&
    row.surface_key === MIGRATION_EXECUTOR_CERTIFICATION.surface_key &&
    row.surface_family === MIGRATION_EXECUTOR_CERTIFICATION.surface_family &&
    row.tool_or_action_key === MIGRATION_EXECUTOR_CERTIFICATION.tool_or_action_key &&
    row.risk_class === MIGRATION_EXECUTOR_CERTIFICATION.risk_class &&
    row.certification_status === MIGRATION_EXECUTOR_CERTIFICATION.certification_status &&
    row.smoke_strategy === MIGRATION_EXECUTOR_CERTIFICATION.smoke_strategy &&
    Number(row.dispatch_allowed || 0) === 1 &&
    Number(row.apply_allowed || 0) === 0 &&
    Number(row.requires_resource_authority || 0) === 0 &&
    Number(row.requires_dry_run || 0) === 1 &&
    Number(row.requires_audit_evidence || 0) === 1 &&
    Number(row.requires_readback || 0) === 1 &&
    row.last_evidence_ref === MIGRATION_EXECUTOR_CERTIFICATION.last_evidence_ref &&
    !row.expires_at;
  if (!exact) {
    throw bootstrapError(409, "governed_migration_executor_dispatch_certification_mismatch", "Migration executor dispatch certification does not match the fail-closed bootstrap contract.", {
      certification_key: row.certification_key || null,
    });
  }
  return { ...row, secrets_included: false };
}

async function ensureMigrationExecutorDispatchCertification(db) {
  await db.query(
    `INSERT INTO runtime_dispatch_certification_registry
      (certification_key, surface_key, surface_family, tool_or_action_key, risk_class,
       certification_status, smoke_strategy, dispatch_allowed, apply_allowed,
       requires_resource_authority, requires_dry_run, requires_audit_evidence,
       requires_readback, last_evidence_ref, last_certified_at, expires_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 1, 1, 1, ?, CURRENT_TIMESTAMP, NULL, ?)
     ON DUPLICATE KEY UPDATE
       surface_key = VALUES(surface_key),
       surface_family = VALUES(surface_family),
       tool_or_action_key = VALUES(tool_or_action_key),
       risk_class = VALUES(risk_class),
       certification_status = VALUES(certification_status),
       smoke_strategy = VALUES(smoke_strategy),
       dispatch_allowed = 1,
       apply_allowed = 0,
       requires_resource_authority = 0,
       requires_dry_run = 1,
       requires_audit_evidence = 1,
       requires_readback = 1,
       last_evidence_ref = VALUES(last_evidence_ref),
       last_certified_at = CURRENT_TIMESTAMP,
       expires_at = NULL,
       notes = VALUES(notes),
       updated_at = CURRENT_TIMESTAMP`,
    [
      MIGRATION_EXECUTOR_CERTIFICATION.certification_key,
      MIGRATION_EXECUTOR_CERTIFICATION.surface_key,
      MIGRATION_EXECUTOR_CERTIFICATION.surface_family,
      MIGRATION_EXECUTOR_CERTIFICATION.tool_or_action_key,
      MIGRATION_EXECUTOR_CERTIFICATION.risk_class,
      MIGRATION_EXECUTOR_CERTIFICATION.certification_status,
      MIGRATION_EXECUTOR_CERTIFICATION.smoke_strategy,
      MIGRATION_EXECUTOR_CERTIFICATION.last_evidence_ref,
      "Bootstrap-only dispatch certification. Global apply remains disabled; apply requires a checksum-bound authorization, approved dynamic apply policy, exact typed confirmation, governed ledger persistence, and same-cycle schema readback.",
    ]
  );
  return verifyMigrationExecutorDispatchCertification(
    await queryMigrationExecutorDispatchCertification(db)
  );
}

async function queryExistingAuthorization(db, migration) {
  const [rows] = await db.query(
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

async function queryMatchingLedger(db, migration, checksum) {
  const [rows] = await db.query(
    `SELECT run_id, mode, applied_at
       FROM governed_migration_ledger
      WHERE migration_file = ? AND migration_checksum_sha256 = ?
      ORDER BY applied_at DESC
      LIMIT 1`,
    [migration, checksum]
  );
  return rows?.[0] || null;
}

async function queryAnyLedger(db, migration) {
  const [rows] = await db.query(
    `SELECT run_id, mode, migration_checksum_sha256, applied_at
       FROM governed_migration_ledger
      WHERE migration_file = ?
      ORDER BY applied_at DESC
      LIMIT 1`,
    [migration]
  );
  return rows?.[0] || null;
}

function verifyExistingAuthorization(row, checksum, options = {}) {
  if (!row) return null;
  const metadata = parseMetadata(row.metadata_json);
  const recordedChecksum = compact(metadata.migration_checksum_sha256 || metadata.checksum_sha256, 64).toLowerCase();
  if (row.authorization_status !== "authorized" || Number(row.allow_apply || 0) !== 1) {
    throw bootstrapError(409, "governed_migration_authorization_conflict", "An existing authorization row is not apply-authorized.", {
      migration_file: row.migration_file,
      authorization_status: row.authorization_status,
      allow_apply: Number(row.allow_apply || 0),
    });
  }
  if (recordedChecksum && recordedChecksum !== checksum && options.allowChecksumMismatch !== true) {
    throw bootstrapError(409, "governed_migration_authorization_checksum_conflict", "The existing authorization row is bound to a different migration checksum.", {
      migration_file: row.migration_file,
      expected_checksum_sha256: checksum,
      recorded_checksum_sha256: recordedChecksum,
    });
  }
  return {
    ...row,
    metadata_json: metadata,
    recorded_checksum_sha256: recordedChecksum || null,
  };
}

async function resolveBootstrapEnvelope({ pool, input, auth, resolveEnvelope }) {
  const resolved = await resolveEnvelope({
    pool,
    source: input,
    acceptedIntents: ACCEPTED_OPERATION_INTENTS,
    expectedTenantId: auth?.tenant_id || PLATFORM_TENANT_ID,
    expectedUserId: auth?.user_id || "",
  });
  if (!resolved?.ok) {
    throw capabilityEnvelopeError(resolved, "Governed migration authorization bootstrap requires a valid capability resolution envelope.");
  }
  return resolved;
}

function buildAuthorizationMetadata({ candidate, envelope, auth }) {
  return {
    migration_checksum_sha256: candidate.migration_checksum_sha256,
    expected_statement_count: candidate.statement_count,
    preflight_status: candidate.preflight.status,
    preflight_risk_count: Number(candidate.preflight.risk_count || 0),
    destructive_operations: 0,
    provider_write: false,
    external_send: false,
    migration_sql_executed: false,
    pull_request: candidate.pull_request,
    merge_sha: candidate.merge_sha,
    capability_envelope_id: envelope.envelope_id,
    authorized_by: compact(auth?.user_id || auth?.sub || "platform_admin", 128),
    requirements: candidate.requirements,
    secrets_included: false,
  };
}

async function reauthorizeExistingMigration({
  pool,
  candidate,
  envelope,
  auth,
  input,
  existing,
  markReferenced,
}) {
  const previousChecksum = compact(input.previous_checksum_sha256, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(previousChecksum)) {
    throw bootstrapError(
      409,
      "governed_migration_authorization_previous_checksum_required",
      "Checksum rotation requires previous_checksum_sha256 to match the currently authorized checksum.",
      {
        migration_file: candidate.migration,
        recorded_checksum_sha256: existing.recorded_checksum_sha256,
      }
    );
  }
  if (!existing.recorded_checksum_sha256 || previousChecksum !== existing.recorded_checksum_sha256) {
    throw bootstrapError(
      409,
      "governed_migration_authorization_previous_checksum_mismatch",
      "previous_checksum_sha256 does not match the currently authorized migration checksum.",
      {
        migration_file: candidate.migration,
        supplied_previous_checksum_sha256: previousChecksum,
        recorded_checksum_sha256: existing.recorded_checksum_sha256,
      }
    );
  }

  const priorLedger = await queryAnyLedger(pool, candidate.migration);
  if (priorLedger) {
    throw bootstrapError(
      409,
      "governed_migration_authorization_already_recorded",
      "Checksum rotation is not permitted after any ledger entry exists for the migration.",
      {
        migration_file: candidate.migration,
        ledger_run_id: priorLedger.run_id,
        ledger_mode: priorLedger.mode,
        ledger_checksum_sha256: priorLedger.migration_checksum_sha256 || null,
      }
    );
  }

  const metadata = {
    ...buildAuthorizationMetadata({ candidate, envelope, auth }),
    previous_checksum_sha256: previousChecksum,
    reauthorized: true,
  };
  const notes = compact(
    input.decision_note || `Checksum-bound migration authorization rotated after reviewed migration repair in PR #${candidate.pull_request}.`,
    1000
  );
  const connection = typeof pool.getConnection === "function" ? await pool.getConnection() : pool;
  const transactional = typeof connection.beginTransaction === "function";
  try {
    if (transactional) await connection.beginTransaction();
    const [result] = await connection.query(
      `UPDATE governed_migration_authorization_registry
          SET notes = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE migration_file = ?
          AND authorization_status = 'authorized'
          AND allow_apply = 1
          AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.migration_checksum_sha256')) = ?`,
      [notes || null, JSON.stringify(metadata), candidate.migration, previousChecksum]
    );
    if (Number(result?.affectedRows || 0) !== 1) {
      throw bootstrapError(
        409,
        "governed_migration_authorization_rotation_conflict",
        "The migration authorization changed before checksum rotation could be committed.",
        { migration_file: candidate.migration }
      );
    }
    await ensureMigrationExecutorApplyPolicy(connection);
    await ensureMigrationExecutorDispatchCertification(connection);
    if (transactional) await connection.commit();
  } catch (error) {
    if (transactional) {
      try { await connection.rollback(); } catch { }
    }
    throw error;
  } finally {
    if (connection !== pool && typeof connection.release === "function") connection.release();
  }

  const readback = verifyExistingAuthorization(
    await queryExistingAuthorization(pool, candidate.migration),
    candidate.migration_checksum_sha256
  );
  if (!readback) {
    throw bootstrapError(
      500,
      "governed_migration_authorization_readback_failed",
      "Rotated authorization row was not visible during same-cycle readback.",
      { migration_file: candidate.migration }
    );
  }
  const migrationExecutorApplyPolicy = verifyMigrationExecutorApplyPolicy(
    await queryMigrationExecutorApplyPolicy(pool)
  );
  const migrationExecutorDispatchCertification = verifyMigrationExecutorDispatchCertification(
    await queryMigrationExecutorDispatchCertification(pool)
  );
  await markReferenced({
    pool,
    envelopeId: envelope.envelope_id,
    executionRef: `migration_authorization:${candidate.migration}`,
  });
  return {
    ok: true,
    authorization_created: false,
    authorization_updated: true,
    reauthorized: true,
    previous_checksum_sha256: previousChecksum,
    idempotent: false,
    candidate,
    authorization: readback,
    migration_executor_apply_policy: migrationExecutorApplyPolicy,
    migration_executor_dispatch_certification: migrationExecutorDispatchCertification,
    migration_sql_executed: false,
    applies_migration: false,
    capability_envelope_id: envelope.envelope_id,
    secrets_included: false,
  };
}

export async function inspectGovernedMigrationAuthorizationCandidate(input = {}, deps = {}) {
  const migration = normalizeMigrationName(input.migration);
  const expectedChecksum = compact(input.expected_checksum_sha256, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedChecksum)) {
    throw bootstrapError(400, "governed_migration_authorization_checksum_required", "expected_checksum_sha256 must be a lowercase SHA-256 value.");
  }
  const expectedStatementCount = Number(input.expected_statement_count);
  if (!Number.isInteger(expectedStatementCount) || expectedStatementCount < 1 || expectedStatementCount > 5000) {
    throw bootstrapError(400, "governed_migration_authorization_statement_count_required", "expected_statement_count must be an integer between 1 and 5000.");
  }
  const pullRequest = Number(input.pull_request);
  if (!Number.isInteger(pullRequest) || pullRequest < 1) {
    throw bootstrapError(400, "governed_migration_authorization_pull_request_required", "pull_request must be a positive integer.");
  }
  const mergeSha = compact(input.merge_sha, 40).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(mergeSha)) {
    throw bootstrapError(400, "governed_migration_authorization_merge_sha_required", "merge_sha must be a 40-character commit SHA.");
  }
  const requiredConfirmation = governedMigrationAuthorizationConfirmation(migration);
  if (compact(input.confirm, 300) !== requiredConfirmation) {
    throw bootstrapError(400, "governed_migration_authorization_confirmation_required", `Authorization requires confirm=${requiredConfirmation}.`, {
      required_confirmation: requiredConfirmation,
    });
  }

  const readFile = deps.readFile || fs.readFile.bind(fs);
  const migrationsDir = deps.migrationsDir || MIGRATIONS_DIR;
  const migrationPath = path.join(migrationsDir, migration);
  const sql = await readFile(migrationPath, "utf8");
  const checksum = sha256(sql);
  if (checksum !== expectedChecksum) {
    throw bootstrapError(409, "governed_migration_authorization_checksum_mismatch", "The migration checksum changed after review.", {
      migration_file: migration,
      expected_checksum_sha256: expectedChecksum,
      actual_checksum_sha256: checksum,
    });
  }

  const statements = splitSqlStatements(sql);
  const preflight = assessMigrationSqlPreflight(migration, sql);
  const preflightStatementCount = Number(preflight?.counts?.statements || 0);
  if (statements.length !== expectedStatementCount || preflightStatementCount !== expectedStatementCount) {
    throw bootstrapError(409, "governed_migration_authorization_statement_count_mismatch", "The migration statement count changed after review.", {
      migration_file: migration,
      expected_statement_count: expectedStatementCount,
      actual_statement_count: statements.length,
      preflight_statement_count: preflightStatementCount,
    });
  }
  if (preflight.status !== "pass" || Number(preflight.risk_count || 0) !== 0) {
    throw bootstrapError(422, "governed_migration_authorization_preflight_failed", "Migration preflight must pass with zero risk findings before authorization.", {
      migration_file: migration,
      preflight_status: preflight.status,
      preflight_risk_count: Number(preflight.risk_count || 0),
    });
  }
  const destructiveFindings = destructiveSqlFindings(sql);
  if (destructiveFindings.length) {
    throw bootstrapError(422, "governed_migration_authorization_destructive_sql_blocked", "Destructive SQL cannot be authorized by the bootstrap tool.", {
      migration_file: migration,
      findings: destructiveFindings,
    });
  }

  const requirements = extractMigrationReadinessRequirementsFromSql(sql);
  return {
    migration,
    migration_checksum_sha256: checksum,
    statement_count: statements.length,
    pull_request: pullRequest,
    merge_sha: mergeSha,
    required_confirmation: requiredConfirmation,
    preflight,
    requirements: Object.fromEntries(
      Object.entries(requirements || {}).map(([key, value]) => [key, Array.isArray(value) ? value.slice(0, 100) : []])
    ),
    destructive_findings: [],
    secrets_included: false,
  };
}

export async function bootstrapGovernedMigrationAuthorization(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const auth = deps.auth || {};
  const resolveEnvelope = deps.resolveEnvelope || resolveCapabilityExecutionEnvelope;
  const markReferenced = deps.markReferenced || markCapabilityEnvelopeReferenced;
  const candidate = await inspectGovernedMigrationAuthorizationCandidate(input, deps);
  const envelope = await resolveBootstrapEnvelope({ pool, input, auth, resolveEnvelope });

  const existing = verifyExistingAuthorization(
    await queryExistingAuthorization(pool, candidate.migration),
    candidate.migration_checksum_sha256
  );
  if (existing) {
    const migrationExecutorApplyPolicy = await ensureMigrationExecutorApplyPolicy(pool);
    const migrationExecutorDispatchCertification = await ensureMigrationExecutorDispatchCertification(pool);
    await markReferenced({
      pool,
      envelopeId: envelope.envelope_id,
      executionRef: `migration_authorization:${candidate.migration}`,
    });
    return {
      ok: true,
      authorization_created: false,
      idempotent: true,
      candidate,
      authorization: existing,
      migration_executor_apply_policy: migrationExecutorApplyPolicy,
      migration_executor_dispatch_certification: migrationExecutorDispatchCertification,
      migration_sql_executed: false,
      applies_migration: false,
      capability_envelope_id: envelope.envelope_id,
      secrets_included: false,
    };
  }

  const ledger = await queryMatchingLedger(pool, candidate.migration, candidate.migration_checksum_sha256);
  if (ledger) {
    throw bootstrapError(409, "governed_migration_authorization_already_recorded", "A matching migration ledger row already exists; authorization bootstrap is not permitted after application.", {
      migration_file: candidate.migration,
      ledger_run_id: ledger.run_id,
      ledger_mode: ledger.mode,
    });
  }

  const metadata = {
    migration_checksum_sha256: candidate.migration_checksum_sha256,
    expected_statement_count: candidate.statement_count,
    preflight_status: candidate.preflight.status,
    preflight_risk_count: Number(candidate.preflight.risk_count || 0),
    destructive_operations: 0,
    provider_write: false,
    external_send: false,
    migration_sql_executed: false,
    pull_request: candidate.pull_request,
    merge_sha: candidate.merge_sha,
    capability_envelope_id: envelope.envelope_id,
    authorized_by: compact(auth?.user_id || auth?.sub || "platform_admin", 128),
    requirements: candidate.requirements,
    secrets_included: false,
  };
  const notes = compact(
    input.decision_note || `Checksum-bound additive migration authorization approved through the governed bootstrap tool for PR #${candidate.pull_request}.`,
    1000
  );

  const connection = typeof pool.getConnection === "function" ? await pool.getConnection() : pool;
  const transactional = typeof connection.beginTransaction === "function";
  try {
    if (transactional) await connection.beginTransaction();
    await connection.query(
      `INSERT INTO governed_migration_authorization_registry
        (migration_file, authorization_status, authorization_source, policy_key, risk_tier,
         requires_preflight, requires_confirmation, allow_record_only, allow_apply, notes, metadata_json)
       VALUES (?, 'authorized', ?, ?, 'medium', 1, 1, 0, 1, ?, ?)`,
      [candidate.migration, AUTHORIZATION_SOURCE, AUTHORIZATION_POLICY_KEY, notes || null, JSON.stringify(metadata)]
    );
    await ensureMigrationExecutorApplyPolicy(connection);
    await ensureMigrationExecutorDispatchCertification(connection);
    if (transactional) await connection.commit();
  } catch (error) {
    if (transactional) {
      try { await connection.rollback(); } catch { }
    }
    if (String(error?.code || "") === "ER_DUP_ENTRY") {
      const raced = verifyExistingAuthorization(
        await queryExistingAuthorization(pool, candidate.migration),
        candidate.migration_checksum_sha256
      );
      if (raced) {
        const migrationExecutorApplyPolicy = await ensureMigrationExecutorApplyPolicy(pool);
        const migrationExecutorDispatchCertification = await ensureMigrationExecutorDispatchCertification(pool);
        return {
          ok: true,
          authorization_created: false,
          idempotent: true,
          candidate,
          authorization: raced,
          migration_executor_apply_policy: migrationExecutorApplyPolicy,
          migration_executor_dispatch_certification: migrationExecutorDispatchCertification,
          migration_sql_executed: false,
          applies_migration: false,
          capability_envelope_id: envelope.envelope_id,
          secrets_included: false,
        };
      }
    }
    throw error;
  } finally {
    if (connection !== pool && typeof connection.release === "function") connection.release();
  }

  const readback = verifyExistingAuthorization(
    await queryExistingAuthorization(pool, candidate.migration),
    candidate.migration_checksum_sha256
  );
  if (!readback) {
    throw bootstrapError(500, "governed_migration_authorization_readback_failed", "Authorization row was not visible during same-cycle readback.", {
      migration_file: candidate.migration,
    });
  }
  const migrationExecutorApplyPolicy = verifyMigrationExecutorApplyPolicy(
    await queryMigrationExecutorApplyPolicy(pool)
  );
  const migrationExecutorDispatchCertification = verifyMigrationExecutorDispatchCertification(
    await queryMigrationExecutorDispatchCertification(pool)
  );
  await markReferenced({
    pool,
    envelopeId: envelope.envelope_id,
    executionRef: `migration_authorization:${candidate.migration}`,
  });

  return {
    ok: true,
    authorization_created: true,
    idempotent: false,
    candidate,
    authorization: readback,
    migration_executor_apply_policy: migrationExecutorApplyPolicy,
    migration_executor_dispatch_certification: migrationExecutorDispatchCertification,
    migration_sql_executed: false,
    applies_migration: false,
    capability_envelope_id: envelope.envelope_id,
    secrets_included: false,
  };
}
