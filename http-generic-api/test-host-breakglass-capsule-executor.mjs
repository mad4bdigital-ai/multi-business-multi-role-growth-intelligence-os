import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { runSqlCapsule } from "./scripts/host-breakglass-capsule-executor.mjs";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const capsuleRelative = ".github/breakglass/sql/test-capsule-runner.sql";
const evidenceRelative = ".github/breakglass/evidence/test-capsule-runner.json";
const capsulePath = path.join(REPO_ROOT, capsuleRelative);
const evidencePath = path.join(REPO_ROOT, evidenceRelative);
const sql = "UPDATE sample SET status = 'repaired' WHERE id = 1;\n";
const expectedSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
const capsuleSha256 = createHash("sha256").update(sql).digest("hex");
const database = "growth_test";
const principal = "runtime_user";
const principalHost = "localhost";
const targetKey = "production-runtime";
const repository = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
const branch = "Production";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const target = { key: targetKey, database, repository, branch, environment: "production", principal, principal_host: principalHost, database_sha256: sha256(database), target_fingerprint: sha256(`${repository}:${branch}:${targetKey}:${database}:${database}:${principal}:${principalHost}`) };

test.before(() => {
  fs.mkdirSync(path.dirname(capsulePath), { recursive: true });
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(capsulePath, sql);
  fs.writeFileSync(evidencePath, JSON.stringify({ contract: "mad4b.host-breakglass-backup-evidence.v1", environment: "production", status: "verified", target_key: targetKey, source_sha: expectedSha, expires_at: new Date(Date.now() + 3600000).toISOString(), restore_test: { status: "pass" }, secrets_included: false }));
});

test("Production raw SQL capsule requires exact source, hash, backup proof, and bounded credentials", async () => {
  let observedConfig;
  let observedSql;
  let ended = false;
  const env = { BOOTSTRAP_EXPECTED_SHA: expectedSha, BOOTSTRAP_TARGET_KEY: targetKey, BOOTSTRAP_TARGET_SOURCE: "repository_allowlist", BOOTSTRAP_TARGET_DATABASE: database, RUNTIME_BOOTSTRAP_TARGETS_JSON: JSON.stringify([target]), MYSQL_BOOTSTRAP_HOST: "db.internal", MYSQL_BOOTSTRAP_PORT: "3306", MYSQL_BOOTSTRAP_DATABASE: database, MYSQL_BOOTSTRAP_USER: "breakglass_user", MYSQL_BOOTSTRAP_PASSWORD: "secret", HOST_BREAKGLASS_CAPSULE_PATH: capsuleRelative, HOST_BREAKGLASS_CAPSULE_SHA256: capsuleSha256, HOST_BREAKGLASS_CAPSULE_CONFIRMATION: `EXECUTE_HOST_BREAKGLASS_CAPSULE:production_hostinger_autodeploy:${expectedSha}:${capsuleSha256}`, HOST_BREAKGLASS_BACKUP_EVIDENCE_PATH: evidenceRelative };
  const result = await runSqlCapsule({ env, connectionFactory: async (config) => { observedConfig = config; return { query: async (text) => { if (text.startsWith("SELECT CURRENT_USER")) return [[{ current_account: "breakglass_user@localhost", current_database: database }]]; if (text.includes("USER_PRIVILEGES")) return [[{ PRIVILEGE_TYPE: "USAGE", IS_GRANTABLE: "NO" }]]; if (text.includes("SCHEMA_PRIVILEGES")) return [[{ TABLE_SCHEMA: database, PRIVILEGE_TYPE: "ALTER", IS_GRANTABLE: "NO" }]]; if (text.startsWith("SELECT DATABASE")) return [[{ current_database: database, table_count: 9 }]]; observedSql = text; return [{ affectedRows: 1 }]; }, end: async () => { ended = true; } }; } });
  assert.equal(result.ok, true);
  assert.equal(result.raw_sql_exception_used, true);
  assert.equal(result.affected_rows, 1);
  assert.equal(observedConfig.multipleStatements, true);
  assert.equal(observedConfig.database, database);
  assert.equal(observedSql, sql);
  assert.equal(ended, true);
  assert.equal(result.privilege_boundary.target_database_only, true);
  assert.equal(result.readback.table_count, 9);
});

test("Production SQL capsule blocks credential-boundary statements before connection", async () => {
  const denied = "GRANT ALL ON *.* TO 'x'@'%';\n";
  fs.writeFileSync(capsulePath, denied);
  const deniedHash = sha256(denied);
  const env = { BOOTSTRAP_EXPECTED_SHA: expectedSha, BOOTSTRAP_TARGET_KEY: targetKey, HOST_BREAKGLASS_CAPSULE_PATH: capsuleRelative, HOST_BREAKGLASS_CAPSULE_SHA256: deniedHash, HOST_BREAKGLASS_CAPSULE_CONFIRMATION: `EXECUTE_HOST_BREAKGLASS_CAPSULE:production_hostinger_autodeploy:${expectedSha}:${deniedHash}`, HOST_BREAKGLASS_BACKUP_EVIDENCE_PATH: evidenceRelative };
  await assert.rejects(() => runSqlCapsule({ env, connectionFactory: async () => { throw new Error("must not connect"); } }), /credential boundary/u);
});

test("Production SQL capsule rejects a globally privileged bootstrap identity", async () => {
  fs.writeFileSync(capsulePath, sql);
  const env = { BOOTSTRAP_EXPECTED_SHA: expectedSha, BOOTSTRAP_TARGET_KEY: targetKey, BOOTSTRAP_TARGET_SOURCE: "repository_allowlist", BOOTSTRAP_TARGET_DATABASE: database, RUNTIME_BOOTSTRAP_TARGETS_JSON: JSON.stringify([target]), MYSQL_BOOTSTRAP_HOST: "db.internal", MYSQL_BOOTSTRAP_DATABASE: database, MYSQL_BOOTSTRAP_USER: "breakglass_user", MYSQL_BOOTSTRAP_PASSWORD: "secret", HOST_BREAKGLASS_CAPSULE_PATH: capsuleRelative, HOST_BREAKGLASS_CAPSULE_SHA256: capsuleSha256, HOST_BREAKGLASS_CAPSULE_CONFIRMATION: `EXECUTE_HOST_BREAKGLASS_CAPSULE:production_hostinger_autodeploy:${expectedSha}:${capsuleSha256}`, HOST_BREAKGLASS_BACKUP_EVIDENCE_PATH: evidenceRelative };
  await assert.rejects(() => runSqlCapsule({ env, connectionFactory: async () => ({ query: async (text) => { if (text.startsWith("SELECT CURRENT_USER")) return [[{ current_account: "breakglass_user@localhost", current_database: database }]]; if (text.includes("USER_PRIVILEGES")) return [[{ PRIVILEGE_TYPE: "SUPER", IS_GRANTABLE: "YES" }]]; if (text.includes("SCHEMA_PRIVILEGES")) return [[]]; throw new Error("must not execute capsule"); }, end: async () => {} }) }), /global, cross-schema, or grantable/u);
});

test.after(() => { fs.rmSync(capsulePath, { force: true }); fs.rmSync(evidencePath, { force: true }); });
