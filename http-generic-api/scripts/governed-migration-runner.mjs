#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getPool } from "../db.js";
import { assessDatabaseCollationPolicy } from "../databaseCollationPolicyGuard.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(API_DIR, "migrations");
const LEGACY_RUNNER = path.join(__dirname, "governed-migration-runner-legacy.mjs");

function argValue(name) {
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const item = String(argv[index] || "");
    if (item === name) return String(argv[index + 1] || "");
    if (item.startsWith(`${name}=`)) return item.slice(name.length + 1);
  }
  return "";
}

function safeJson(text = "") {
  try { return JSON.parse(String(text || "").trim()); } catch { return null; }
}

async function closeProbePool() {
  try { await getPool().end(); } catch { /* no-op */ }
}

async function main() {
  const migration = path.basename(argValue("--migration"));
  if (!migration) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: "--migration is required.", applies_sql: false, secrets_included: false }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  const migrationPath = path.join(MIGRATIONS_DIR, migration);
  const sql = await fs.readFile(migrationPath, "utf8");
  const collationPolicyPreflight = await assessDatabaseCollationPolicy(sql);
  await closeProbePool();

  if (collationPolicyPreflight.status === "block") {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      mode: argValue("--mode") || "dry_run",
      migration,
      blocked_reason: "database_collation_policy_mismatch",
      collation_policy_preflight: collationPolicyPreflight,
      applies_sql: false,
      secrets_included: false,
    }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  let childStdout = "";
  let childStderr = "";
  let childCode = 0;
  try {
    const result = await execFileAsync(process.execPath, [LEGACY_RUNNER, ...process.argv.slice(2)], {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
    });
    childStdout = result.stdout || "";
    childStderr = result.stderr || "";
  } catch (error) {
    childStdout = error?.stdout || "";
    childStderr = error?.stderr || "";
    childCode = Number(error?.code) || 1;
  }

  const payload = safeJson(childStdout);
  if (payload && typeof payload === "object") {
    payload.collation_policy_preflight = collationPolicyPreflight;
    payload.database_collation_policy_status = collationPolicyPreflight.status;
    payload.secrets_included = false;
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(childStdout);
  }
  if (childStderr) process.stderr.write(childStderr);
  if (childCode) process.exitCode = childCode;
}

main().catch(async (error) => {
  await closeProbePool();
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error?.message || String(error),
    code: error?.code || "governed_migration_collation_preflight_failed",
    applies_sql: false,
    secrets_included: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
});
