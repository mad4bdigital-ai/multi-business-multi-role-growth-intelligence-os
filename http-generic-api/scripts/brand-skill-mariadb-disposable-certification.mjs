#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";
import { assessBrandSkillMigrationPreflight } from "../brandSkillMigrationPreflight.js";
import { assessMigrationSqlPreflight, splitSqlStatements } from "../releaseReadiness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const MIGRATION_NAME = "20260728_brand_scoped_user_skill_activation.sql";
const MIGRATION_PATH = path.join(API_DIR, "migrations", MIGRATION_NAME);
const ARTIFACT_PATH = path.join(API_DIR, "artifacts", "brand-skill-mariadb-certification.json");
const REQUIRED_COLLATION = "utf8mb4_uca1400_ai_ci";

function sha256(value = "") {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function assertContract(condition, code) {
  if (condition) return;
  const error = new Error(code);
  error.code = code;
  throw error;
}

async function queryRows(pool, sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return Array.isArray(rows) ? rows : [];
}

async function resetDisposableSchema(pool) {
  await pool.query("DROP VIEW IF EXISTS v_effective_user_brand_skill_grants");
  await pool.query("DROP TABLE IF EXISTS user_brand_skill_grants");
  await pool.query("DROP TABLE IF EXISTS brand_skill_policies");
  await pool.query("DROP VIEW IF EXISTS v_effective_agent_skill_grants");
  await pool.query("DROP TABLE IF EXISTS agent_skill_grants");
  await pool.query("DROP TABLE IF EXISTS agent_skills");

  await pool.query(`CREATE TABLE agent_skills (
    skill_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE ${REQUIRED_COLLATION} NOT NULL PRIMARY KEY,
    skill_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE ${REQUIRED_COLLATION} NOT NULL,
    status ENUM('active','inactive','revoked') CHARACTER SET utf8mb4 COLLATE ${REQUIRED_COLLATION} NOT NULL DEFAULT 'active'
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${REQUIRED_COLLATION}`);

  await pool.query(`CREATE TABLE agent_skill_grants (
    grant_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE ${REQUIRED_COLLATION} NOT NULL PRIMARY KEY,
    agent_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE ${REQUIRED_COLLATION} NOT NULL,
    skill_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE ${REQUIRED_COLLATION} NOT NULL,
    tenant_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE ${REQUIRED_COLLATION} NOT NULL,
    brand_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE ${REQUIRED_COLLATION} NOT NULL,
    status ENUM('active','revoked','expired') NOT NULL DEFAULT 'active',
    expires_at DATETIME NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${REQUIRED_COLLATION}`);

  await pool.query(`CREATE OR REPLACE VIEW v_effective_agent_skill_grants AS
    SELECT grant_id, agent_id, skill_id, tenant_id, brand_key
      FROM agent_skill_grants
     WHERE status = 'active'
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`);
}

async function inspectSchema(pool) {
  const [statusColumn] = await queryRows(pool, `SELECT COLUMN_TYPE, COLLATION_NAME
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'user_brand_skill_grants'
       AND COLUMN_NAME = 'status'`);
  const [hashColumn] = await queryRows(pool, `SELECT EXTRA, GENERATION_EXPRESSION
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'user_brand_skill_grants'
       AND COLUMN_NAME = 'active_scope_hash'`);
  const uniqueIndex = await queryRows(pool, `SELECT INDEX_NAME, NON_UNIQUE
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'user_brand_skill_grants'
       AND INDEX_NAME = 'uq_user_brand_skill_grant_active_scope'`);
  const objects = await queryRows(pool, `SELECT TABLE_NAME, TABLE_TYPE
      FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('brand_skill_policies','user_brand_skill_grants','v_effective_user_brand_skill_grants')
     ORDER BY TABLE_NAME`);

  const statusType = String(statusColumn?.COLUMN_TYPE || "");
  const generationExpression = String(hashColumn?.GENERATION_EXPRESSION || "").toLowerCase();
  assertContract(statusType.includes("'suspended'"), "BRAND_SKILL_SUSPENDED_STATUS_MISSING");
  assertContract(String(hashColumn?.EXTRA || "").toUpperCase().includes("STORED GENERATED"), "BRAND_SKILL_SCOPE_HASH_NOT_STORED");
  assertContract((generationExpression.match(/hex\s*\(/g) || []).length >= 7, "BRAND_SKILL_SCOPE_HASH_NOT_DELIMITER_SAFE");
  assertContract(uniqueIndex.length === 1 && Number(uniqueIndex[0]?.NON_UNIQUE) === 0, "BRAND_SKILL_SCOPE_UNIQUE_INDEX_MISSING");
  assertContract(objects.length === 3, "BRAND_SKILL_TARGET_OBJECT_COUNT_INVALID");

  return {
    status_column_type: statusType,
    status_column_collation: statusColumn?.COLLATION_NAME || null,
    active_scope_hash_extra: hashColumn?.EXTRA || null,
    active_scope_hash_hex_call_count: (generationExpression.match(/hex\s*\(/g) || []).length,
    active_scope_unique_index: uniqueIndex[0] || null,
    objects,
  };
}

async function inspectEmptyState(pool) {
  const [policy] = await queryRows(pool, "SELECT COUNT(*) AS count FROM brand_skill_policies");
  const [grant] = await queryRows(pool, "SELECT COUNT(*) AS count FROM user_brand_skill_grants");
  const [effective] = await queryRows(pool, "SELECT COUNT(*) AS count FROM v_effective_user_brand_skill_grants");
  const [baseline] = await queryRows(pool, "SELECT COUNT(*) AS count FROM agent_skill_grants");
  const result = {
    policy_count: Number(policy?.count || 0),
    grant_count: Number(grant?.count || 0),
    effective_grant_count: Number(effective?.count || 0),
    baseline_agent_grant_count: Number(baseline?.count || 0),
  };
  assertContract(result.policy_count === 0, "BRAND_SKILL_POLICY_EMPTY_STATE_FAILED");
  assertContract(result.grant_count === 0, "BRAND_SKILL_GRANT_EMPTY_STATE_FAILED");
  assertContract(result.effective_grant_count === 0, "BRAND_SKILL_EFFECTIVE_EMPTY_STATE_FAILED");
  assertContract(result.baseline_agent_grant_count === 0, "BRAND_SKILL_BASELINE_EMPTY_STATE_CHANGED");
  return result;
}

async function certifyLifecycleContracts(pool) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(`INSERT INTO agent_skills (skill_id, skill_key, status)
      VALUES ('00000000-0000-4000-a000-000000000101', 'brand-skill-cert', 'active')`);
    await connection.query(`INSERT INTO brand_skill_policies
      (policy_id, tenant_id, brand_key, skill_id, activation_mode, allowed_operations_json, status)
      VALUES ('00000000-0000-4000-a000-000000000201', 'tenant-cert', 'brand-cert',
              '00000000-0000-4000-a000-000000000101', 'self_service', JSON_ARRAY('publish'), 'active')`);

    const common = [
      "tenant-cert",
      "user-cert",
      "brand-cert",
      "agent-cert",
      "00000000-0000-4000-a000-000000000101",
      "00000000-0000-4000-a000-000000000201",
    ];
    await connection.query(`INSERT INTO user_brand_skill_grants
      (grant_id, tenant_id, user_id, brand_key, agent_id, skill_id, policy_id,
       resource_type, resource_ref, allowed_operations_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, JSON_ARRAY('publish'), 'active')`,
    ["grant-cert-active-a", ...common, "a|b", "c"]);
    await connection.query(`INSERT INTO user_brand_skill_grants
      (grant_id, tenant_id, user_id, brand_key, agent_id, skill_id, policy_id,
       resource_type, resource_ref, allowed_operations_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, JSON_ARRAY('publish'), 'active')`,
    ["grant-cert-active-b", ...common, "a", "b|c"]);
    await connection.query(`INSERT INTO user_brand_skill_grants
      (grant_id, tenant_id, user_id, brand_key, agent_id, skill_id, policy_id,
       resource_type, resource_ref, allowed_operations_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, JSON_ARRAY('publish'), 'suspended')`,
    ["grant-cert-suspended", ...common, "site", "site-cert"]);

    const [activeRows] = await connection.query(`SELECT grant_id, active_scope_hash
      FROM user_brand_skill_grants
     WHERE status = 'active'
     ORDER BY grant_id`);
    const [suspendedRows] = await connection.query(`SELECT grant_id, active_scope_hash
      FROM user_brand_skill_grants
     WHERE status = 'suspended'`);
    const [effectiveRows] = await connection.query("SELECT grant_id FROM v_effective_user_brand_skill_grants ORDER BY grant_id");

    assertContract(activeRows.length === 2, "BRAND_SKILL_ACTIVE_FIXTURE_COUNT_INVALID");
    assertContract(new Set(activeRows.map((row) => row.active_scope_hash)).size === 2, "BRAND_SKILL_DELIMITER_COLLISION_NOT_PREVENTED");
    assertContract(suspendedRows.length === 1 && suspendedRows[0].active_scope_hash === null, "BRAND_SKILL_SUSPENDED_SCOPE_HASH_INVALID");
    assertContract(effectiveRows.length === 2, "BRAND_SKILL_EFFECTIVE_VIEW_FILTER_INVALID");

    return {
      delimiter_collision_prevented: true,
      suspended_status_accepted: true,
      suspended_scope_hash_null: true,
      effective_active_grant_count: effectiveRows.length,
    };
  } finally {
    await connection.rollback();
    connection.release();
  }
}

async function main() {
  const pool = getPool();
  const sql = await readFile(MIGRATION_PATH, "utf8");
  const checksum = sha256(sql);
  const staticPreflight = assessMigrationSqlPreflight(MIGRATION_NAME, sql);
  const statements = splitSqlStatements(sql);
  assertContract(staticPreflight.status === "pass", "BRAND_SKILL_STATIC_PREFLIGHT_FAILED");
  assertContract(statements.length === 3, "BRAND_SKILL_STATEMENT_COUNT_INVALID");

  await resetDisposableSchema(pool);
  const livePreflight = await assessBrandSkillMigrationPreflight({ pool, requireRuntimeBaseline: true });
  assertContract(livePreflight.ready === true, "BRAND_SKILL_LIVE_PREFLIGHT_FAILED");
  assertContract(livePreflight.applies_sql === false, "BRAND_SKILL_PREFLIGHT_APPLIED_SQL");

  for (const statement of statements) await pool.query(statement);

  const schema = await inspectSchema(pool);
  const emptyStateBeforeFixtures = await inspectEmptyState(pool);
  const lifecycle = await certifyLifecycleContracts(pool);
  const emptyStateAfterRollback = await inspectEmptyState(pool);

  const artifact = {
    ok: true,
    certification: "brand_skill_mariadb_disposable_v1",
    migration: MIGRATION_NAME,
    migration_checksum_sha256: checksum,
    statement_count: statements.length,
    database_version: (await queryRows(pool, "SELECT VERSION() AS version"))[0]?.version || null,
    static_preflight: staticPreflight,
    live_preflight: livePreflight,
    schema,
    empty_state_before_fixtures: emptyStateBeforeFixtures,
    lifecycle,
    empty_state_after_rollback: emptyStateAfterRollback,
    applies_to_disposable_only: true,
    production_authorized: false,
    staging_apply_authorized: false,
    applies_sql_to_external_environment: false,
    provider_calls: false,
    external_writes: false,
    secrets_included: false,
  };
  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  await pool.end();
}

main().catch(async (error) => {
  const safe = {
    ok: false,
    certification: "brand_skill_mariadb_disposable_v1",
    error_code: error?.code || "BRAND_SKILL_MARIADB_CERTIFICATION_FAILED",
    production_authorized: false,
    staging_apply_authorized: false,
    applies_sql_to_external_environment: false,
    provider_calls: false,
    external_writes: false,
    secrets_included: false,
  };
  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(safe, null, 2)}\n`);
  try { await getPool().end(); } catch {}
  process.exit(1);
});
