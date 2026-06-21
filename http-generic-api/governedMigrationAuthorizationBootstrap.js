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

function verifyExistingAuthorization(row, checksum) {
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
  if (recordedChecksum && recordedChecksum !== checksum) {
    throw bootstrapError(409, "governed_migration_authorization_checksum_conflict", "The existing authorization row is bound to a different migration checksum.", {
      migration_file: row.migration_file,
      expected_checksum_sha256: checksum,
      recorded_checksum_sha256: recordedChecksum,
    });
  }
  return { ...row, metadata_json: metadata };
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
  if (!resolved.apply_allowed) {
    throw capabilityEnvelopeError({
      ...resolved,
      status: "capability_resolution_envelope_apply_not_allowed",
    }, "The capability resolution envelope does not permit authorization registry mutation.");
  }
  return resolved;
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
        return {
          ok: true,
          authorization_created: false,
          idempotent: true,
          candidate,
          authorization: raced,
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
    migration_sql_executed: false,
    applies_migration: false,
    capability_envelope_id: envelope.envelope_id,
    secrets_included: false,
  };
}
