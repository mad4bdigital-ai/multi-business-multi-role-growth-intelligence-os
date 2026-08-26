#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getPool } from "../db.js";
import { splitSqlStatements } from "../releaseReadiness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const MIGRATION = "20260725_agent_delegation_grant_persistence_contract.sql";
const AUTHORIZATION_SOURCE = "spec011_disposable_certification";
const AUTHORIZATION_POLICY = "governed_migration_runner_authorization_v1";

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

export function buildDisposableMigrationAuthorizationMetadata({ migrationSql }) {
  const sql = String(migrationSql || "");
  const migrationChecksumSha256 = sha256(sql);
  const expectedStatementCount = splitSqlStatements(sql).length;

  assert.match(migrationChecksumSha256, /^[0-9a-f]{64}$/);
  assert.ok(expectedStatementCount > 0, "Disposable migration authorization requires at least one parsed statement.");

  return {
    migration_checksum_sha256: migrationChecksumSha256,
    expected_statement_count: expectedStatementCount,
    authorization_scope: "disposable_ci_only",
    disposable: true,
    production_authorized: false,
    secrets_included: false,
  };
}

export function assertDisposableAuthorizationTarget(env = process.env) {
  if (env.DELEGATION_MARIADB_CERTIFICATION_MODE !== "disposable") {
    throw new Error("DELEGATION_MARIADB_CERTIFICATION_MODE=disposable is required.");
  }
  if (!/^spec011_delegation_cert_[a-z0-9_]+$/i.test(String(env.DB_NAME || ""))) {
    throw new Error("DB_NAME must use the spec011_delegation_cert_* disposable prefix.");
  }
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(String(env.DB_HOST || ""))) {
    throw new Error("Disposable migration authorization binding requires a loopback DB_HOST.");
  }
}

async function ensureAuthorizationRegistry(pool) {
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
}

export async function bindDisposableMigrationAuthorization({ pool = getPool(), env = process.env } = {}) {
  assertDisposableAuthorizationTarget(env);
  const migrationSql = await readFile(path.join(API_DIR, "migrations", MIGRATION), "utf8");
  const metadata = buildDisposableMigrationAuthorizationMetadata({ migrationSql });
  const metadataJson = JSON.stringify(metadata);

  await ensureAuthorizationRegistry(pool);
  await pool.query(
    `INSERT INTO governed_migration_authorization_registry
      (migration_file, authorization_status, authorization_source, policy_key, risk_tier,
       requires_preflight, requires_confirmation, allow_record_only, allow_apply, notes, metadata_json)
     VALUES (?, 'authorized', ?, ?, 'low', 1, 1, 1, 1, ?, ?)
     ON DUPLICATE KEY UPDATE
       authorization_status=VALUES(authorization_status),
       authorization_source=VALUES(authorization_source),
       policy_key=VALUES(policy_key),
       risk_tier=VALUES(risk_tier),
       requires_preflight=VALUES(requires_preflight),
       requires_confirmation=VALUES(requires_confirmation),
       allow_record_only=VALUES(allow_record_only),
       allow_apply=VALUES(allow_apply),
       notes=VALUES(notes),
       metadata_json=VALUES(metadata_json),
       updated_at=CURRENT_TIMESTAMP`,
    [
      MIGRATION,
      AUTHORIZATION_SOURCE,
      AUTHORIZATION_POLICY,
      "Exact-artifact authorization for disposable Spec 011 CI only. Production authorization is not implied.",
      metadataJson,
    ],
  );

  const [rows] = await pool.query(
    `SELECT migration_file, authorization_status, authorization_source, policy_key,
            allow_apply, metadata_json
       FROM governed_migration_authorization_registry
      WHERE migration_file = ?
      LIMIT 1`,
    [MIGRATION],
  );
  const row = rows?.[0] || null;
  assert.ok(row, "Disposable migration authorization readback is required.");
  assert.equal(row.authorization_status, "authorized");
  assert.equal(row.authorization_source, AUTHORIZATION_SOURCE);
  assert.equal(row.policy_key, AUTHORIZATION_POLICY);
  assert.equal(Number(row.allow_apply), 1);

  const readbackMetadata = typeof row.metadata_json === "string"
    ? JSON.parse(row.metadata_json)
    : row.metadata_json;
  assert.equal(readbackMetadata?.migration_checksum_sha256, metadata.migration_checksum_sha256);
  assert.equal(Number(readbackMetadata?.expected_statement_count), metadata.expected_statement_count);
  assert.equal(readbackMetadata?.authorization_scope, "disposable_ci_only");
  assert.equal(readbackMetadata?.disposable, true);
  assert.equal(readbackMetadata?.production_authorized, false);
  assert.equal(readbackMetadata?.secrets_included, false);

  return {
    ok: true,
    report_type: "spec011_disposable_migration_authorization_binding",
    migration: MIGRATION,
    migration_checksum_sha256: metadata.migration_checksum_sha256,
    expected_statement_count: metadata.expected_statement_count,
    authorization_source: AUTHORIZATION_SOURCE,
    authorization_scope: "disposable_ci_only",
    production_authorized: false,
    secrets_included: false,
  };
}

function isDirectExecution() {
  const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
  return Boolean(entrypoint) && import.meta.url === entrypoint;
}

if (isDirectExecution()) {
  const pool = getPool();
  bindDisposableMigrationAuthorization({ pool })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({
        ok: false,
        report_type: "spec011_disposable_migration_authorization_binding",
        error: error?.message || String(error),
        code: error?.code || null,
        production_authorized: false,
        secrets_included: false,
      }, null, 2)}\n`);
      process.exitCode = 1;
    })
    .finally(async () => {
      try { await pool.end(); } catch {}
    });
}
