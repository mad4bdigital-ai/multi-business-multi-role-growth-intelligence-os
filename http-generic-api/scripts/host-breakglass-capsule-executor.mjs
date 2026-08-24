#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { readRuntimeBootstrapContract, resolveBootstrapTarget, sanitizeBootstrapError, validateBootstrapCredentials } from "../runtimeBootstrapContract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const CAPSULE_RE = /^\.github\/breakglass\/sql\/[A-Za-z0-9._-]+\.sql$/u;
const EVIDENCE_RE = /^\.github\/breakglass\/evidence\/[A-Za-z0-9._-]+\.json$/u;
const SHA_RE = /^[0-9a-f]{40}$/u;
const HASH_RE = /^[0-9a-f]{64}$/u;

function deny(code, message) { throw Object.assign(new Error(message), { code, status: 400 }); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function same(a, b) { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }
function resolveInsideRepo(relativePath) {
  const absolute = path.resolve(REPO_ROOT, relativePath);
  if (!absolute.startsWith(`${REPO_ROOT}${path.sep}`)) deny("host_breakglass_capsule_escape_denied", "Capsule path escapes the repository.");
  return absolute;
}

function validateBackupEvidence(relativePath, { expectedSha, targetKey }) {
  if (!EVIDENCE_RE.test(relativePath)) deny("host_breakglass_backup_evidence_invalid", "Production SQL requires repository-owned backup evidence.");
  const evidence = JSON.parse(fs.readFileSync(resolveInsideRepo(relativePath), "utf8"));
  if (evidence?.contract !== "mad4b.host-breakglass-backup-evidence.v1" || evidence?.environment !== "production" || evidence?.status !== "verified" || evidence?.target_key !== targetKey || evidence?.source_sha !== expectedSha || evidence?.restore_test?.status !== "pass" || evidence?.secrets_included !== false || Date.parse(evidence?.expires_at || 0) <= Date.now()) {
    deny("host_breakglass_backup_evidence_not_ready", "Backup evidence is absent, expired, or does not prove a restore test for this exact target and SHA.");
  }
  return hash(JSON.stringify(evidence));
}

export async function runSqlCapsule({ env = process.env, contract = readRuntimeBootstrapContract(), connectionFactory = mysql.createConnection } = {}) {
  const capsuleJson = String(env.HOST_BREAKGLASS_CAPSULE_JSON || "").trim();
  if (capsuleJson.length > 4096) deny("host_breakglass_capsule_envelope_too_large", "Capsule envelope exceeds the bounded input size.");
  const capsuleEnvelope = capsuleJson ? JSON.parse(capsuleJson) : {};
  if (Object.keys(capsuleEnvelope).some((key) => !["path", "sha256", "confirmation", "backup_evidence_path"].includes(key))) deny("host_breakglass_capsule_envelope_field_denied", "Capsule envelope contains unsupported fields.");
  const environmentKey = String(env.HOST_BREAKGLASS_ENVIRONMENT_KEY || "production_hostinger_autodeploy");
  const expectedSha = String(env.BOOTSTRAP_EXPECTED_SHA || "").toLowerCase();
  const capsulePath = String(capsuleEnvelope.path || env.HOST_BREAKGLASS_CAPSULE_PATH || "");
  const capsuleSha256 = String(capsuleEnvelope.sha256 || env.HOST_BREAKGLASS_CAPSULE_SHA256 || "").toLowerCase();
  const targetKey = String(env.BOOTSTRAP_TARGET_KEY || "production-runtime");
  if (!SHA_RE.test(expectedSha) || !HASH_RE.test(capsuleSha256) || !CAPSULE_RE.test(capsulePath)) deny("host_breakglass_capsule_binding_invalid", "Capsule source binding is invalid.");
  const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim().toLowerCase();
  if (!same(checkoutSha, expectedSha)) deny("host_breakglass_capsule_source_mismatch", "Checkout SHA does not match the approved capsule SHA.");
  const sql = fs.readFileSync(resolveInsideRepo(capsulePath), "utf8");
  if (!same(hash(sql), capsuleSha256)) deny("host_breakglass_capsule_hash_mismatch", "Capsule content does not match capsule_sha256.");
  const confirmation = String(capsuleEnvelope.confirmation || env.HOST_BREAKGLASS_CAPSULE_CONFIRMATION || "");
  const expectedConfirmation = `EXECUTE_HOST_BREAKGLASS_CAPSULE:${environmentKey}:${expectedSha}:${capsuleSha256}`;
  if (!same(confirmation, expectedConfirmation)) deny("host_breakglass_capsule_confirmation_required", "Exact capsule confirmation is required.");
  if (/\b(?:CREATE|DROP)\s+DATABASE\b|\b(?:CREATE|ALTER|DROP)\s+USER\b|\bGRANT\b|\bREVOKE\b|\bINTO\s+OUTFILE\b|\bLOAD\s+DATA\b/iu.test(sql)) deny("host_breakglass_capsule_privilege_boundary_denied", "SQL capsule crosses the database or credential boundary.");
  const backupEvidenceSha256 = environmentKey === "production_hostinger_autodeploy" ? validateBackupEvidence(String(capsuleEnvelope.backup_evidence_path || env.HOST_BREAKGLASS_BACKUP_EVIDENCE_PATH || ""), { expectedSha, targetKey }) : null;
  const target = resolveBootstrapTarget({ ...env, BOOTSTRAP_MODE: "dry_run" }, contract);
  const credentialEvidence = validateBootstrapCredentials(env, { requirePassword: true, target });
  const connection = await connectionFactory({ host: String(env.MYSQL_BOOTSTRAP_HOST), port: credentialEvidence.port, user: String(env.MYSQL_BOOTSTRAP_USER), password: String(env.MYSQL_BOOTSTRAP_PASSWORD), database: target.database, multipleStatements: true, namedPlaceholders: false });
  try {
    const [identityRows] = await connection.query("SELECT CURRENT_USER() AS current_account, DATABASE() AS current_database");
    const currentAccount = String(identityRows?.[0]?.current_account || "");
    if (!currentAccount.includes("@") || String(identityRows?.[0]?.current_database || "") !== target.database) deny("host_breakglass_sql_identity_mismatch", "SQL capsule connection is not bound to the exact target database.");
    const split = currentAccount.lastIndexOf("@");
    const grantee = `'${currentAccount.slice(0, split).replaceAll("'", "''")}'@'${currentAccount.slice(split + 1).replaceAll("'", "''")}'`;
    const [globalPrivileges] = await connection.query("SELECT PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = ?", [grantee]);
    const [schemaPrivileges] = await connection.query("SELECT TABLE_SCHEMA, PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = ?", [grantee]);
    if (globalPrivileges.some((row) => String(row.PRIVILEGE_TYPE || "").toUpperCase() !== "USAGE" || String(row.IS_GRANTABLE || "").toUpperCase() === "YES") || schemaPrivileges.some((row) => String(row.TABLE_SCHEMA || "") !== target.database || String(row.IS_GRANTABLE || "").toUpperCase() === "YES")) deny("host_breakglass_sql_privilege_scope_too_broad", "Bootstrap SQL identity has global, cross-schema, or grantable privileges.");
    const [results] = await connection.query(sql);
    const items = Array.isArray(results) ? results : [results];
    const affectedRows = items.reduce((sum, item) => sum + Number(item?.affectedRows || 0), 0);
    const [readbackRows] = await connection.query("SELECT DATABASE() AS current_database, (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()) AS table_count");
    if (String(readbackRows?.[0]?.current_database || "") !== target.database) deny("host_breakglass_sql_readback_mismatch", "Same-cycle SQL capsule readback lost the target database binding.");
    return { ok: true, contract: "mad4b.host-breakglass-sql-capsule-result.v1", environment_key: environmentKey, target_key: targetKey, expected_sha: expectedSha, capsule_path: capsulePath, capsule_sha256: capsuleSha256, backup_evidence_sha256: backupEvidenceSha256, result_set_count: items.length, affected_rows: affectedRows, database_mutation_performed: true, raw_sql_exception_used: true, privilege_boundary: { global_privilege_count: globalPrivileges.length, schema_privilege_count: schemaPrivileges.length, grantable_privilege_count: 0, target_database_only: true }, readback: { current_database_matches: true, table_count: Number(readbackRows?.[0]?.table_count || 0) }, secrets_included: false };
  } finally { await connection.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSqlCapsule().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => { process.stdout.write(`${JSON.stringify({ ok: false, error: sanitizeBootstrapError(error), database_mutation_performed: "unknown", secrets_included: false })}\n`); process.exitCode = 1; });
}
