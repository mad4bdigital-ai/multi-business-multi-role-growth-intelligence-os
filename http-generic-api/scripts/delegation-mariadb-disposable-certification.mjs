#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { getPool } from "../db.js";
import {
  planDelegationGrantCreateShadow,
  planDelegationGrantExpireShadow,
  planDelegationGrantRevokeShadow,
} from "../delegationGrantLifecycleShadowService.js";
import { collectDelegationGrantMariaDbReadinessEvidence } from "../delegationGrantMariaDbReadinessCollector.js";
import { createDelegationGrantMariaDbRuntimeBinding } from "../delegationGrantMariaDbRuntimeBinding.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const MIGRATION = "20260725_agent_delegation_grant_persistence_contract.sql";
const ARTIFACT_PATH = path.join(API_DIR, "artifacts", "delegation-mariadb-certification.json");
const TENANT_ID = randomUUID();
const PLAN_ID = randomUUID();
const CAPABILITY_ENVELOPE_ID = randomUUID();
const APPROVAL_HOLD_ID = randomUUID();
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function assertDisposableTarget() {
  if (process.env.DELEGATION_MARIADB_CERTIFICATION_MODE !== "disposable") {
    throw new Error("DELEGATION_MARIADB_CERTIFICATION_MODE=disposable is required.");
  }
  if (!/^spec011_delegation_cert_[a-z0-9_]+$/i.test(String(process.env.DB_NAME || ""))) {
    throw new Error("DB_NAME must use the spec011_delegation_cert_* disposable prefix.");
  }
}

async function bootstrapDisposableSchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS agent_delegations (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    delegation_id VARCHAR(36) NOT NULL UNIQUE,
    user_id VARCHAR(36) NOT NULL,
    tenant_id VARCHAR(36) NOT NULL,
    agent_id VARCHAR(36) NOT NULL,
    intent_key VARCHAR(128) NOT NULL,
    brand_key VARCHAR(128) NULL,
    plan_id VARCHAR(36) NULL,
    status ENUM('pending','executing','completed','failed','expired') NOT NULL DEFAULT 'pending',
    expires_at DATETIME(3) NOT NULL,
    completed_at DATETIME(3) NULL,
    failure_reason VARCHAR(255) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await pool.query(`CREATE TABLE IF NOT EXISTS repository_automation_receipts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    receipt_id CHAR(36) NOT NULL,
    run_id CHAR(36) NOT NULL,
    step_key VARCHAR(96) NOT NULL,
    operation_key VARCHAR(191) NOT NULL,
    idempotency_key VARCHAR(191) NOT NULL,
    request_sha256 CHAR(64) NOT NULL,
    dispatch_status VARCHAR(32) NOT NULL,
    provider_status INT NULL,
    provider_receipt_json LONGTEXT NULL,
    readback_json LONGTEXT NULL,
    recovered_from_transport TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    secrets_included TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_repository_automation_receipt_id (receipt_id),
    UNIQUE KEY uq_repository_automation_receipt_request (run_id,step_key,request_sha256),
    KEY idx_repository_automation_receipt_status (dispatch_status,updated_at),
    CONSTRAINT chk_repository_automation_receipts_no_secrets CHECK (secrets_included = 0)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await pool.query(`CREATE TABLE IF NOT EXISTS governed_migration_ledger (
    run_id CHAR(36) NOT NULL,
    migration_file VARCHAR(255) NOT NULL,
    migration_checksum_sha256 CHAR(64) NOT NULL,
    applied_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    applied_by VARCHAR(191) NOT NULL DEFAULT 'governed_migration_runner',
    runner_version VARCHAR(64) NOT NULL,
    mode VARCHAR(32) NOT NULL DEFAULT 'apply',
    statement_count INT UNSIGNED NOT NULL DEFAULT 0,
    preflight_status VARCHAR(32) NOT NULL,
    preflight_risk_count INT UNSIGNED NOT NULL DEFAULT 0,
    requirements_json LONGTEXT NULL,
    results_json LONGTEXT NULL,
    before_schema_objects_json LONGTEXT NULL,
    after_schema_objects_json LONGTEXT NULL,
    metadata_json LONGTEXT NULL,
    secrets_included TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id),
    KEY idx_governed_migration_ledger_file (migration_file),
    KEY idx_governed_migration_ledger_applied_at (applied_at),
    KEY idx_governed_migration_ledger_checksum (migration_checksum_sha256)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await pool.query(`CREATE TABLE IF NOT EXISTS governed_migration_authorization_registry (
    migration_file VARCHAR(255) NOT NULL PRIMARY KEY,
    authorization_status ENUM('authorized','disabled','archived') NOT NULL DEFAULT 'authorized',
    authorization_source VARCHAR(128) NOT NULL DEFAULT 'migration_seed',
    policy_key VARCHAR(191) NOT NULL DEFAULT 'governed_migration_runner_authorization_v1',
    risk_tier ENUM('low','medium','high','critical') NOT NULL DEFAULT 'low',
    requires_preflight TINYINT(1) NOT NULL DEFAULT 1,
    requires_confirmation TINYINT(1) NOT NULL DEFAULT 1,
    allow_record_only TINYINT(1) NOT NULL DEFAULT 1,
    allow_apply TINYINT(1) NOT NULL DEFAULT 1,
    notes TEXT NULL,
    metadata_json LONGTEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await pool.query(
    `INSERT INTO governed_migration_authorization_registry
      (migration_file, authorization_status, authorization_source, policy_key, risk_tier,
       requires_preflight, requires_confirmation, allow_record_only, allow_apply, notes, metadata_json)
     VALUES (?, 'authorized', 'spec011_disposable_certification',
             'governed_migration_runner_authorization_v1', 'low', 1, 1, 1, 1, ?, ?)
     ON DUPLICATE KEY UPDATE authorization_status='authorized', allow_apply=1, updated_at=CURRENT_TIMESTAMP`,
    [
      MIGRATION,
      "Disposable CI authorization only. Production authorization is not implied.",
      JSON.stringify({ disposable: true, production_authorized: false, secrets_included: false }),
    ],
  );
}

async function verifyCheckConstraintEnforcement(pool) {
  await pool.query("DROP TEMPORARY TABLE IF EXISTS spec011_check_constraint_probe");
  await pool.query(`CREATE TEMPORARY TABLE spec011_check_constraint_probe (
    value_int INT NOT NULL,
    CONSTRAINT chk_spec011_probe CHECK (value_int = 0)
  ) ENGINE=InnoDB`);
  let rejected = false;
  try {
    await pool.query("INSERT INTO spec011_check_constraint_probe (value_int) VALUES (1)");
  } catch (error) {
    rejected = /check constraint|constraint.*failed|ER_CONSTRAINT_FAILED/i.test(String(error?.message || ""));
    if (!rejected) throw error;
  } finally {
    await pool.query("DROP TEMPORARY TABLE IF EXISTS spec011_check_constraint_probe");
  }
  assert.equal(rejected, true, "MariaDB must enforce CHECK constraints in the disposable certification engine.");
  return true;
}

function runGovernedMigration() {
  const confirmation = "APPLY_20260725_AGENT_DELEGATION_GRANT_PERSISTENCE_CONTRACT";
  const child = spawnSync(
    process.execPath,
    [
      "scripts/governed-migration-runner.mjs",
      "--apply",
      `--migration=${MIGRATION}`,
      `--confirm=${confirmation}`,
    ],
    {
      cwd: API_DIR,
      env: {
        ...process.env,
        GOVERNED_MIGRATION_APPLIED_BY: "spec011_disposable_certification",
      },
      encoding: "utf8",
    },
  );
  if (child.status !== 0) {
    throw new Error(`Governed migration failed: ${child.stderr || child.stdout}`);
  }
  return JSON.parse(child.stdout);
}

function preview({ grantId, createdAt, expiresAt, seed }) {
  return {
    decision: "eligible_preview",
    grant_hash: sha256(`preview:${seed}`),
    grant: {
      schema_version: "spec011-delegation-grant-shadow-v1",
      grant_id: grantId,
      delegated_by: "user-1",
      delegated_to: "agent-1",
      approval_mode: "delegated_plan_bound",
      plan_id: PLAN_ID,
      plan_hash: HASH_A,
      resource_scope: [{ resource_uri: `github://owner/repo/${seed}`, snapshot_hash: HASH_B }],
      allowed_intents: ["repo.patch.apply"],
      denied_intents: ["repo.pr.merge"],
      max_risk_tier: "medium",
      limits: { max_mutations: 3, max_retries: 1, max_pull_requests: 1 },
      require_readback: true,
      stop_on_drift: true,
      policy_version: "policy-v1",
      status: "preview",
      created_at: createdAt,
      expires_at: expiresAt,
      revoked_at: null,
      secrets_included: false,
    },
  };
}

function authorization(plan) {
  return {
    approved: true,
    capability_envelope_id: CAPABILITY_ENVELOPE_ID,
    approval_hold_id: APPROVAL_HOLD_ID,
    resource_authority_ref: "resource-authority:spec011-disposable-certification",
    expected_request_fingerprint: plan.request_fingerprint,
  };
}

function operationUuid(n) {
  return `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function stepUuid(n) {
  return `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

async function certifyLifecycle(pool, readiness, migrationChecksum) {
  const baseMs = Date.now();
  const isoAt = (offsetMs) => new Date(baseMs + offsetMs).toISOString();
  const createdAt = isoAt(-60_000);
  const createRevokeAt = isoAt(0);
  const revokeAt = isoAt(60_000);
  const createExpireAt = isoAt(120_000);
  const expireDueAt = isoAt(180_000);
  const expireAt = isoAt(240_000);

  const env = {
    DELEGATION_GRANT_MARIADB_RUNTIME_ENABLED: "true",
    DELEGATION_GRANT_MARIADB_RUNTIME_CERTIFIED: "true",
    DELEGATION_GRANT_MARIADB_RUNTIME_ALLOWED_ACTIONS: "create,revoke,expire",
    DELEGATION_GRANT_MARIADB_EXPECTED_MIGRATION_SHA256: migrationChecksum,
    DELEGATION_GRANT_MARIADB_READINESS_TTL_MS: "0",
  };
  const binding = createDelegationGrantMariaDbRuntimeBinding({ pool, env });

  const grantA = "70000000-0000-4000-8000-000000000001";
  const createAPlan = planDelegationGrantCreateShadow({
    preview: preview({ grantId: grantA, createdAt, expiresAt: isoAt(3_600_000), seed: "revoke" }),
    schemaReadiness: readiness,
    operationId: operationUuid(1),
    stepId: stepUuid(1),
    idempotencyKey: "spec011-live-create-revoke",
    requestedBy: "user-1",
    principalScope: "tenant",
    providerOrAdapter: "delegation_mariadb_runtime_binding",
    now: createRevokeAt,
  });
  const createdA = await binding.execute({
    plan: createAPlan,
    tenantId: TENANT_ID,
    authorization: authorization(createAPlan),
    now: createRevokeAt,
  });
  const revokePlan = planDelegationGrantRevokeShadow({
    grant: createdA.grant,
    schemaReadiness: readiness,
    operationId: operationUuid(2),
    stepId: stepUuid(2),
    idempotencyKey: "spec011-live-revoke-grant",
    requestedBy: "user-1",
    principalScope: "tenant",
    providerOrAdapter: "delegation_mariadb_runtime_binding",
    reason: "disposable certification",
    now: revokeAt,
  });
  const revoked = await binding.execute({
    plan: revokePlan,
    tenantId: TENANT_ID,
    authorization: authorization(revokePlan),
    now: revokeAt,
  });

  const grantB = "70000000-0000-4000-8000-000000000002";
  const createBPlan = planDelegationGrantCreateShadow({
    preview: preview({ grantId: grantB, createdAt, expiresAt: expireDueAt, seed: "expire" }),
    schemaReadiness: readiness,
    operationId: operationUuid(3),
    stepId: stepUuid(3),
    idempotencyKey: "spec011-live-create-expire",
    requestedBy: "user-1",
    principalScope: "tenant",
    providerOrAdapter: "delegation_mariadb_runtime_binding",
    now: createExpireAt,
  });
  const createdB = await binding.execute({
    plan: createBPlan,
    tenantId: TENANT_ID,
    authorization: authorization(createBPlan),
    now: createExpireAt,
  });
  const expirePlan = planDelegationGrantExpireShadow({
    grant: createdB.grant,
    schemaReadiness: readiness,
    operationId: operationUuid(4),
    stepId: stepUuid(4),
    idempotencyKey: "spec011-live-expire-grant",
    requestedBy: "system-certifier",
    principalScope: "system",
    providerOrAdapter: "delegation_mariadb_runtime_binding",
    now: expireAt,
  });
  const expired = await binding.execute({
    plan: expirePlan,
    tenantId: TENANT_ID,
    authorization: authorization(expirePlan),
    now: expireAt,
  });

  assert.equal(createdA.decision, "verified_success");
  assert.equal(revoked.grant.status, "revoked");
  assert.equal(createdB.decision, "verified_success");
  assert.equal(expired.grant.status, "expired");

  const [rows] = await pool.query(
    `SELECT delegation_id, canonical_status, runtime_policy_ready
       FROM agent_delegations
      ORDER BY delegation_id`,
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => Number(row.runtime_policy_ready) === 0));

  return {
    create_verified: createdA.decision === "verified_success" && createdB.decision === "verified_success",
    revoke_verified: revoked.grant.status === "revoked",
    expire_verified: expired.grant.status === "expired",
    runtime_policy_ready_zero: rows.every((row) => Number(row.runtime_policy_ready) === 0),
    receipt_readback_complete: [createdA, revoked, createdB, expired]
      .every((result) => result.receipt?.readback_complete === true),
  };
}

async function main() {
  assertDisposableTarget();
  const pool = getPool();
  await bootstrapDisposableSchema(pool);
  const checkConstraintsEnforced = await verifyCheckConstraintEnforcement(pool);
  const migrationSql = await readFile(path.join(API_DIR, "migrations", MIGRATION), "utf8");
  const migrationChecksum = sha256(migrationSql);
  const migrationRun = runGovernedMigration();
  assert.equal(migrationRun.ok, true);
  assert.equal(migrationRun.mode, "apply");
  assert.equal(migrationRun.migration_checksum_sha256, migrationChecksum);
  assert.equal(migrationRun.statements_executed, 2);

  const readiness = await collectDelegationGrantMariaDbReadinessEvidence({
    pool,
    expectedMigrationChecksum: migrationChecksum,
    runtimeAuthorityEnabled: false,
    now: new Date().toISOString(),
  });
  assert.equal(readiness.status, "verified_applied");
  assert.equal(readiness.checksum_pin_match, true);

  const lifecycle = await certifyLifecycle(pool, readiness, migrationChecksum);
  const artifact = {
    ok: true,
    report_type: "spec011_delegation_mariadb_disposable_certification",
    certification_version: "spec011-delegation-mariadb-disposable-certification-v1",
    target_class: "disposable_ci_mariadb",
    production_authorized: false,
    migration: {
      file: MIGRATION,
      checksum_sha256: migrationChecksum,
      statement_count: migrationRun.statements_executed,
      ledger_run_id: migrationRun.ledger?.run_id || null,
      readiness_status: readiness.status,
      schema_readback_fingerprint: readiness.schema_readback_fingerprint,
      check_constraints_enforced: checkConstraintsEnforced,
    },
    lifecycle,
    boundaries: {
      production_database_write: false,
      provider_call: false,
      public_route_added: false,
      runtime_policy_ready_promoted: false,
      secrets_included: false,
    },
    certified_at: new Date().toISOString(),
    secrets_included: false,
  };
  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(artifact, null, 2));
  await pool.end();
}

main().catch(async (error) => {
  console.error(JSON.stringify({
    ok: false,
    report_type: "spec011_delegation_mariadb_disposable_certification",
    error: error?.message || String(error),
    code: error?.code || null,
    production_authorized: false,
    secrets_included: false,
  }, null, 2));
  try { await getPool().end(); } catch {}
  process.exit(1);
});
