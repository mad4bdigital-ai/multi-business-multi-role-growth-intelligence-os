#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";
import {
  capabilityEnvelopeError,
  resolveCapabilityExecutionEnvelope,
  transitionCapabilityEnvelopeLifecycle,
} from "../capabilityResolutionEnvelopeGuard.js";
import { splitMigrationSqlStatements } from "../migrationSqlStatements.js";

const __filename = fileURLToPath(import.meta.url);
const API_DIR = path.resolve(path.dirname(__filename), "..");
const MIGRATION_DIR = path.join(API_DIR, "migrations");

export const READINESS_REPAIR_MIGRATION =
  "20260725_repository_authority_capability_readiness_repair.sql";
export const READINESS_REPAIR_CHECKSUM =
  "d655e9a45b9fd6b0d7b9c7f3069fbc50d5fd5a76ac0d426629b42a5de971c58b";
export const READINESS_REPAIR_APPLY_CONFIRMATION =
  "APPLY_20260725_REPOSITORY_AUTHORITY_CAPABILITY_READINESS_REPAIR";
export const READINESS_REPAIR_RUNNER_VERSION =
  "repository-authority-capability-readiness-repair-runner-v1";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const CONNECTED_SYSTEM_TENANT_ID = "f2795a7f-8d06-4053-8bee-35ca9af8b460";
const CONNECTED_SYSTEM_KEY = "github_rest_prod_platform_managed";
const AUTHORITY_BINDING_KEY = "growth_intelligence_platform.github.primary.production";
const CAPABILITY_BINDING_KEY =
  "growth_intelligence_platform.github.repository_main_moved_webhook.production";
const POLICY_KEY = "github_repository_main_moved_webhook_provision_apply_v1";
const LOCK_NAME = "migration:20260725:repository-authority-capability-readiness-repair";
const TARGET_TABLES = Object.freeze([
  "connected_systems",
  "repository_authority_bindings",
  "repository_capability_bindings",
  "capability_apply_authorization_policy_registry",
  "governed_migration_authorization_registry",
  "governed_migration_ledger",
  "capability_resolution_envelope_ledger",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function runnerError(code, message, details = {}, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

function parseJson(value, fallback = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function sha256(value = "") {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function equalNullable(left, right) {
  return (left ?? null) === (right ?? null);
}

function normalizeRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : [];
}

function oneRow(rows, name, { allowMissing = false } = {}) {
  if (rows.length > 1) {
    throw runnerError("readiness_repair_row_ambiguous", `${name} matched multiple rows.`, {
      row_kind: name,
      row_count: rows.length,
    });
  }
  if (!allowMissing && rows.length !== 1) {
    throw runnerError("readiness_repair_row_missing", `${name} must exist exactly once.`, {
      row_kind: name,
      row_count: rows.length,
    });
  }
  return rows[0] || null;
}

function publicMetadata(value) {
  const metadata = parseJson(value, {});
  return {
    readiness_repair_migration: metadata.readiness_repair_migration || null,
    system_authority_source: metadata.system_authority_source || null,
    managed_system_key: metadata.managed_system_key || null,
    policy_authority_source: metadata.policy_authority_source || null,
    provider_call_executed: metadata.provider_call_executed ?? null,
    external_write_executed: metadata.external_write_executed ?? null,
    credential_payload_read: metadata.credential_payload_read ?? null,
    secrets_included: metadata.secrets_included ?? false,
  };
}

function publicState(state = {}) {
  return {
    system: state.system
      ? {
          system_id: state.system.system_id,
          tenant_id: state.system.tenant_id,
          system_key: state.system.system_key,
          service_mode: state.system.service_mode,
          managed_capable: Number(state.system.managed_capable || 0),
          status: state.system.status,
        }
      : null,
    authority: state.authority
      ? {
          binding_key: state.authority.binding_key,
          system_id: state.authority.system_id || null,
          installation_id: state.authority.installation_id || null,
          system_binding_mode: state.authority.system_binding_mode,
          lifecycle_status: state.authority.lifecycle_status,
          authority_version: Number(state.authority.authority_version || 0),
          lock_version: Number(state.authority.lock_version || 0),
          metadata: publicMetadata(state.authority.metadata_json),
        }
      : null,
    capability: state.capability
      ? {
          capability_binding_key: state.capability.capability_binding_key,
          capability_key: state.capability.capability_key,
          operation_intent: state.capability.operation_intent,
          policy_key: state.capability.policy_key || null,
          lifecycle_status: state.capability.lifecycle_status,
          capability_version: Number(state.capability.capability_version || 0),
          lock_version: Number(state.capability.lock_version || 0),
          metadata: publicMetadata(state.capability.metadata_json),
        }
      : null,
    policy: state.policy
      ? {
          policy_key: state.policy.policy_key,
          app_key: state.policy.app_key,
          capability_key: state.policy.capability_key,
          operation_intent: state.policy.operation_intent,
          runtime_surface: state.policy.runtime_surface,
          status: state.policy.status,
        }
      : null,
    authorization: state.authorization
      ? {
          migration_file: state.authorization.migration_file,
          authorization_status: state.authorization.authorization_status,
          policy_key: state.authorization.policy_key || null,
          risk_tier: state.authorization.risk_tier || null,
          requires_preflight: Number(state.authorization.requires_preflight || 0),
          requires_confirmation: Number(state.authorization.requires_confirmation || 0),
          allow_apply: Number(state.authorization.allow_apply || 0),
        }
      : null,
    ledger: state.ledger
      ? {
          run_id: state.ledger.run_id,
          mode: state.ledger.mode,
          applied_at: state.ledger.applied_at,
        }
      : null,
    collations: state.collations || [],
  };
}

async function queryRows(db, sql, params = []) {
  return normalizeRows(await db.query(sql, params));
}

async function readState(db, { forUpdate = false } = {}) {
  const lockSuffix = forUpdate ? " FOR UPDATE" : "";
  // Keep reads sequential. A transaction-scoped mysql2 connection must never
  // receive overlapping queries because that can reorder lock acquisition or
  // fail with a connection-level command sequencing error.
  const systemRows = await queryRows(
    db,
    `SELECT system_id, tenant_id, system_key, service_mode, managed_capable, status, config_json
       FROM connected_systems
      WHERE tenant_id = ? AND system_key = ?
      LIMIT 2${lockSuffix}`,
    [CONNECTED_SYSTEM_TENANT_ID, CONNECTED_SYSTEM_KEY],
  );
  const authorityRows = await queryRows(
    db,
    `SELECT binding_key, system_id, installation_id, system_binding_mode, lifecycle_status,
            authority_version, lock_version, metadata_json
       FROM repository_authority_bindings
      WHERE binding_key = ?
      LIMIT 2${lockSuffix}`,
    [AUTHORITY_BINDING_KEY],
  );
  const capabilityRows = await queryRows(
    db,
    `SELECT capability_binding_key, capability_key, operation_intent, policy_key,
            lifecycle_status, capability_version, lock_version, metadata_json
       FROM repository_capability_bindings
      WHERE capability_binding_key = ?
      LIMIT 2${lockSuffix}`,
    [CAPABILITY_BINDING_KEY],
  );
  const policyRows = await queryRows(
    db,
    `SELECT policy_key, app_key, capability_key, operation_intent, runtime_surface, status
       FROM capability_apply_authorization_policy_registry
      WHERE policy_key = ?
      LIMIT 2${lockSuffix}`,
    [POLICY_KEY],
  );
  const authorizationRows = await queryRows(
    db,
    `SELECT migration_file, authorization_status, authorization_source, policy_key,
            risk_tier, requires_preflight, requires_confirmation, allow_record_only, allow_apply
       FROM governed_migration_authorization_registry
      WHERE migration_file = ?
      LIMIT 2${lockSuffix}`,
    [READINESS_REPAIR_MIGRATION],
  );
  const ledgerRows = await queryRows(
    db,
    `SELECT run_id, mode, applied_at
       FROM governed_migration_ledger
      WHERE migration_file = ? AND migration_checksum_sha256 = ?
      ORDER BY applied_at DESC
      LIMIT 2${lockSuffix}`,
    [READINESS_REPAIR_MIGRATION, READINESS_REPAIR_CHECKSUM],
  );

  const collations = await queryRows(
    db,
    `SELECT table_name, column_name, collation_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND ((table_name = 'repository_authority_bindings' AND column_name = 'system_id')
          OR (table_name = 'connected_systems' AND column_name = 'system_id'))
      ORDER BY table_name, column_name`,
  );

  return {
    system: oneRow(systemRows, "connected_system", { allowMissing: true }),
    authority: oneRow(authorityRows, "repository_authority_binding"),
    capability: oneRow(capabilityRows, "repository_capability_binding"),
    policy: oneRow(policyRows, "capability_policy"),
    authorization: oneRow(authorizationRows, "migration_authorization"),
    ledger: oneRow(ledgerRows, "migration_ledger", { allowMissing: true }),
    collations,
  };
}

function stripLeadingSqlComments(statement = "") {
  let value = String(statement || "").trimStart();
  while (value) {
    const next = value
      .replace(/^--[^\n]*(?:\n|$)/, "")
      .replace(/^#[^\n]*(?:\n|$)/, "")
      .replace(/^\/\*[\s\S]*?\*\//, "")
      .trimStart();
    if (next === value) break;
    value = next;
  }
  return value;
}

export function assertReadinessRepairStatements(statements = []) {
  if (!Array.isArray(statements) || statements.length !== 3) {
    throw runnerError("readiness_repair_statement_count_mismatch", "Readiness repair must contain exactly three statements.", {
      statement_count: Array.isArray(statements) ? statements.length : null,
    });
  }
  const unsafe = statements.filter(
    (statement) => !/^(?:INSERT|UPDATE)\b/i.test(stripLeadingSqlComments(statement)),
  );
  if (unsafe.length) {
    throw runnerError("readiness_repair_non_transactional_statement_blocked", "Only transaction-safe INSERT and UPDATE statements are permitted.", {
      unsafe_statement_count: unsafe.length,
    });
  }
  return true;
}

export function assessReadinessRepairState(state = {}) {
  const blocking = [];
  const system = state.system || null;
  const authority = state.authority || null;
  const capability = state.capability || null;
  const policy = state.policy || null;
  const authorization = state.authorization || null;

  if (!authority) blocking.push("authority_binding_missing");
  if (!capability) blocking.push("capability_binding_missing");
  if (!policy) blocking.push("policy_missing");
  if (!authorization) blocking.push("migration_authorization_missing");
  if (authorization && authorization.authorization_status !== "authorized") {
    blocking.push("migration_authorization_not_authorized");
  }
  if (authorization && Number(authorization.allow_apply || 0) !== 1) {
    blocking.push("migration_apply_not_allowed");
  }
  if (policy && policy.status !== "active") blocking.push("policy_not_active");
  if (policy && policy.runtime_surface !== "system_layer") blocking.push("policy_runtime_surface_mismatch");
  if (authority && authority.system_binding_mode !== "shared_platform_adapter") {
    blocking.push("authority_binding_mode_mismatch");
  }
  if (authority && authority.lifecycle_status !== "active") blocking.push("authority_not_active");
  if (capability && capability.lifecycle_status !== "active") blocking.push("capability_not_active");
  if (!Array.isArray(state.collations) || state.collations.length !== 2) {
    blocking.push("system_id_collation_evidence_incomplete");
  }

  const systemReady = Boolean(
    system && system.status === "active" && system.service_mode === "managed" && Number(system.managed_capable || 0) === 1,
  );
  const authorityReady = Boolean(
    system && authority && equalNullable(authority.system_id, system.system_id) && authority.installation_id === null,
  );
  const capabilityReady = Boolean(
    capability && policy && equalNullable(capability.policy_key, policy.policy_key),
  );
  const targetSatisfied = systemReady && authorityReady && capabilityReady;

  return {
    status: blocking.length ? "blocked" : targetSatisfied ? "already_satisfied" : "ready",
    recommended_action: blocking.length ? "diagnose" : targetSatisfied ? "record_only" : "apply",
    blocking_reasons: blocking,
    target_satisfied: targetSatisfied,
    system_ready: systemReady,
    authority_ready: authorityReady,
    capability_ready: capabilityReady,
    ledger_present: Boolean(state.ledger),
    secrets_included: false,
  };
}

function assertApplyReady(state, assessment) {
  if (state.ledger) {
    throw runnerError("readiness_repair_already_recorded", "A matching checksum is already present in the migration ledger.", {
      ledger: publicState(state).ledger,
    });
  }
  if (assessment.status === "blocked") {
    throw runnerError("readiness_repair_preflight_blocked", "Readiness repair preflight contains blocking gaps.", {
      blocking_reasons: assessment.blocking_reasons,
    });
  }
  if (assessment.status === "already_satisfied") {
    throw runnerError("readiness_repair_record_only_required", "Target rows already satisfy the migration contract; do not reapply version increments.", {
      recommended_action: "record_only",
    });
  }
}

function verifyAfter(before, after) {
  const assessment = assessReadinessRepairState(after);
  if (assessment.status !== "already_satisfied") {
    throw runnerError("readiness_repair_post_apply_state_invalid", "Post-apply rows do not satisfy the target contract.", {
      assessment,
      after: publicState(after),
    });
  }
  const authorityChanged = Boolean(
    before.authority && (
      !equalNullable(before.authority.system_id, after.authority.system_id)
      || !equalNullable(before.authority.installation_id, after.authority.installation_id)
    ),
  );
  if (authorityChanged) {
    if (Number(after.authority.authority_version || 0) <= Number(before.authority.authority_version || 0)) {
      throw runnerError("readiness_repair_authority_version_not_incremented", "Authority version did not increment after authority change.");
    }
    if (Number(after.authority.lock_version || 0) <= Number(before.authority.lock_version || 0)) {
      throw runnerError("readiness_repair_authority_lock_version_not_incremented", "Authority lock version did not increment after authority change.");
    }
  }
  if (before.capability && !equalNullable(before.capability.policy_key, after.capability.policy_key)) {
    if (Number(after.capability.capability_version || 0) <= Number(before.capability.capability_version || 0)) {
      throw runnerError("readiness_repair_capability_version_not_incremented", "Capability version did not increment after policy change.");
    }
    if (Number(after.capability.lock_version || 0) <= Number(before.capability.lock_version || 0)) {
      throw runnerError("readiness_repair_capability_lock_version_not_incremented", "Capability lock version did not increment after policy change.");
    }
  }
  return assessment;
}

async function ledgerSupportsCapabilityEnvelope(db) {
  const rows = await queryRows(
    db,
    `SELECT COUNT(*) AS count
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'governed_migration_ledger'
        AND column_name = 'capability_envelope_id'`,
  );
  return Number(rows[0]?.count || 0) === 1;
}

async function recordLedger(db, { results, before, after, capabilityEnvelopeId }) {
  const runId = randomUUID();
  const metadata = {
    atomic_transaction: true,
    advisory_lock: LOCK_NAME,
    transaction_scope: "migration_statements+ledger+envelope_consume",
    retry_without_readback_allowed: false,
    before: publicState(before),
    after: publicState(after),
    capability_envelope_id: capabilityEnvelopeId,
    provider_call_executed: false,
    external_write_executed: false,
    credential_payload_read: false,
    secrets_included: false,
  };
  await db.query(
    `INSERT INTO governed_migration_ledger
      (run_id, migration_file, migration_checksum_sha256, applied_by, runner_version, mode,
       statement_count, preflight_status, preflight_risk_count, requirements_json, results_json,
       before_schema_objects_json, after_schema_objects_json, metadata_json, secrets_included)
     VALUES (?, ?, ?, ?, ?, 'apply', 3, 'pass', 0, ?, ?, ?, ?, ?, 0)`,
    [
      runId,
      READINESS_REPAIR_MIGRATION,
      READINESS_REPAIR_CHECKSUM,
      process.env.GOVERNED_MIGRATION_APPLIED_BY || "readiness_repair_atomic_runner",
      READINESS_REPAIR_RUNNER_VERSION,
      JSON.stringify({ target_tables: TARGET_TABLES, row_readback_required: true }),
      JSON.stringify(results),
      JSON.stringify(TARGET_TABLES),
      JSON.stringify(TARGET_TABLES),
      JSON.stringify(metadata),
    ],
  );
  if (await ledgerSupportsCapabilityEnvelope(db)) {
    await db.query(
      "UPDATE governed_migration_ledger SET capability_envelope_id = ? WHERE run_id = ?",
      [capabilityEnvelopeId, runId],
    );
  }
  return runId;
}

async function resolveApplyEnvelope(db, envelopeId) {
  const resolved = await resolveCapabilityExecutionEnvelope({
    pool: db,
    envelopeId,
    acceptedAppKeys: ["platform_orchestration"],
    acceptedIntents: [
      "governed_migration_execute",
      "governed_migration_apply",
      "migration_apply",
      "governed_migration_runner",
    ],
    expectedTenantId: PLATFORM_TENANT_ID,
    requireReadyForDispatch: true,
    requireDispatchAllowed: true,
    requireNoBlockingGaps: true,
    requireNoSecrets: true,
    allowReferenced: true,
  });
  if (!resolved.ok) {
    throw capabilityEnvelopeError(resolved, "Readiness repair apply requires a ready platform_orchestration capability envelope.");
  }
  if (resolved.apply_allowed !== true) {
    throw runnerError("readiness_repair_capability_envelope_apply_not_allowed", "Capability envelope does not permit apply.", {
      envelope_id: resolved.envelope_id,
    }, 403);
  }
  if (resolved.readback_required !== true) {
    throw runnerError("readiness_repair_capability_envelope_readback_required", "Capability envelope must require readback.", {
      envelope_id: resolved.envelope_id,
    }, 403);
  }
  return resolved;
}

async function loadMigration() {
  const migrationPath = path.join(MIGRATION_DIR, READINESS_REPAIR_MIGRATION);
  const sql = await fs.readFile(migrationPath, "utf8");
  const checksum = sha256(sql);
  if (checksum !== READINESS_REPAIR_CHECKSUM) {
    throw runnerError("readiness_repair_checksum_mismatch", "Deployed migration checksum differs from the approved checksum.", {
      expected_checksum_sha256: READINESS_REPAIR_CHECKSUM,
      actual_checksum_sha256: checksum,
    });
  }
  const statements = splitMigrationSqlStatements(sql);
  assertReadinessRepairStatements(statements);
  return { sql, statements, checksum };
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { mode: "dry_run", confirm: "", capabilityEnvelopeId: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = String(argv[index] || "");
    if (value === "--dry-run") args.mode = "dry_run";
    else if (value === "--apply") args.mode = "apply";
    else if (value === "--confirm") args.confirm = String(argv[++index] || "");
    else if (value.startsWith("--confirm=")) args.confirm = value.slice("--confirm=".length);
    else if (value === "--capability-envelope-id") args.capabilityEnvelopeId = String(argv[++index] || "");
    else if (value.startsWith("--capability-envelope-id=")) {
      args.capabilityEnvelopeId = value.slice("--capability-envelope-id=".length);
    } else if (value === `--migration=${READINESS_REPAIR_MIGRATION}`) {
      // Compatibility with governedMigrationExecutionTool runner arguments.
    } else if (value === "--migration" && String(argv[index + 1] || "") === READINESS_REPAIR_MIGRATION) {
      index += 1;
    } else {
      throw runnerError("readiness_repair_argument_unsupported", `Unsupported argument: ${value}`, {}, 400);
    }
  }
  return args;
}

async function runDryRun(pool, migration) {
  const state = await readState(pool);
  const assessment = assessReadinessRepairState(state);
  return {
    ok: assessment.status !== "blocked",
    mode: "dry_run",
    migration: READINESS_REPAIR_MIGRATION,
    migration_checksum_sha256: migration.checksum,
    statement_count: migration.statements.length,
    applies_sql: false,
    authorization: publicState(state).authorization,
    preflight: assessment,
    requirements: { schema_objects: TARGET_TABLES },
    before_schema_objects: TARGET_TABLES,
    before_state: publicState(state),
    required_confirmation: READINESS_REPAIR_APPLY_CONFIRMATION,
    atomic_transaction_required: true,
    retry_without_readback_allowed: false,
    secrets_included: false,
  };
}

async function acquireLock(connection) {
  const rows = await queryRows(connection, "SELECT GET_LOCK(?, 15) AS acquired", [LOCK_NAME]);
  if (Number(rows[0]?.acquired || 0) !== 1) {
    throw runnerError("readiness_repair_advisory_lock_unavailable", "Could not acquire the migration advisory lock.", {
      advisory_lock: LOCK_NAME,
    });
  }
}

async function releaseLock(connection) {
  try {
    await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
  } catch {
  }
}

async function runApply(pool, migration, args) {
  if (args.confirm !== READINESS_REPAIR_APPLY_CONFIRMATION) {
    throw runnerError("readiness_repair_confirmation_required", `Apply requires --confirm=${READINESS_REPAIR_APPLY_CONFIRMATION}.`, {
      required_confirmation: READINESS_REPAIR_APPLY_CONFIRMATION,
    });
  }
  if (!UUID_PATTERN.test(args.capabilityEnvelopeId)) {
    throw runnerError("readiness_repair_capability_envelope_required", "Apply requires a valid capability envelope UUID.", {}, 403);
  }

  const connection = await pool.getConnection();
  let committed = false;
  let transactionStarted = false;
  let runId = null;
  try {
    await acquireLock(connection);
    await connection.beginTransaction();
    transactionStarted = true;

    const envelope = await resolveApplyEnvelope(connection, args.capabilityEnvelopeId);
    const before = await readState(connection, { forUpdate: true });
    const beforeAssessment = assessReadinessRepairState(before);
    assertApplyReady(before, beforeAssessment);

    const results = [];
    for (const statement of migration.statements) {
      const [result] = await connection.query(statement);
      results.push({
        statement_sha256: sha256(statement),
        affectedRows: Number(result?.affectedRows || 0),
        changedRows: Number(result?.changedRows || 0),
        warningStatus: Number(result?.warningStatus || 0),
      });
    }

    const after = await readState(connection, { forUpdate: true });
    const afterAssessment = verifyAfter(before, after);
    runId = await recordLedger(connection, {
      results,
      before,
      after,
      capabilityEnvelopeId: envelope.envelope_id,
    });

    const consumed = await transitionCapabilityEnvelopeLifecycle({
      pool: connection,
      envelopeId: envelope.envelope_id,
      action: "consume",
      executionRef: `governed_migration:${runId}`,
    });
    if (!consumed.ok) {
      throw capabilityEnvelopeError(consumed, "Capability envelope could not be consumed atomically with the migration.");
    }

    await connection.commit();
    committed = true;
    transactionStarted = false;

    const postCommit = await readState(pool);
    const postCommitAssessment = assessReadinessRepairState(postCommit);
    if (postCommitAssessment.status !== "already_satisfied" || postCommit.ledger?.run_id !== runId) {
      throw runnerError("readiness_repair_post_commit_readback_failed", "Committed migration could not be verified by post-commit readback.", {
        committed: true,
        retry_allowed: false,
        run_id: runId,
        assessment: postCommitAssessment,
        ledger: publicState(postCommit).ledger,
      }, 502);
    }

    return {
      ok: true,
      mode: "apply",
      migration: READINESS_REPAIR_MIGRATION,
      migration_checksum_sha256: migration.checksum,
      statement_count: migration.statements.length,
      statements_executed: results.length,
      applies_sql: true,
      atomic_transaction: true,
      advisory_lock: LOCK_NAME,
      results,
      preflight: beforeAssessment,
      post_apply: afterAssessment,
      requirements: { schema_objects: TARGET_TABLES },
      before_schema_objects: TARGET_TABLES,
      after_schema_objects: TARGET_TABLES,
      before_state: publicState(before),
      after_state: publicState(postCommit),
      ledger: {
        recorded: true,
        run_id: runId,
        capability_envelope_id: envelope.envelope_id,
      },
      capability_envelope: {
        envelope_id: envelope.envelope_id,
        consumed: true,
      },
      retry_without_readback_allowed: false,
      same_cycle_row_readback_verified: true,
      secrets_included: false,
    };
  } catch (error) {
    if (transactionStarted && !committed) {
      try {
        await connection.rollback();
      } catch {
      }
    }
    if (committed) {
      error.details = {
        ...(error.details || {}),
        committed: true,
        retry_allowed: false,
        run_id: runId,
        secrets_included: false,
      };
    }
    throw error;
  } finally {
    await releaseLock(connection);
    connection.release();
  }
}

export async function runReadinessRepairMigration(args = parseArgs(), deps = {}) {
  const pool = deps.pool || getPool();
  const migration = await loadMigration();
  return args.mode === "apply"
    ? runApply(pool, migration, args)
    : runDryRun(pool, migration);
}

async function closePoolQuietly() {
  try {
    await getPool().end();
  } catch {
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runReadinessRepairMigration()
    .then(async (result) => {
      console.log(JSON.stringify(result, null, 2));
      await closePoolQuietly();
      if (result.ok !== true) process.exitCode = 2;
    })
    .catch(async (error) => {
      console.error(JSON.stringify({
        ok: false,
        error: error?.message || String(error),
        code: error?.code || "readiness_repair_runner_failed",
        details: error?.details || undefined,
        retry_allowed: false,
        secrets_included: false,
      }, null, 2));
      await closePoolQuietly();
      process.exit(1);
    });
}
