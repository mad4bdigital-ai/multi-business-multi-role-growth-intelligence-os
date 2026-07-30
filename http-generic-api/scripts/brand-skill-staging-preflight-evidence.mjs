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
const ARTIFACT_PATH = path.join(API_DIR, "artifacts", "brand-skill-staging-preflight.json");

function sha256(value = "") {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function requireMatch(condition, code) {
  if (condition) return;
  const error = new Error(code);
  error.code = code;
  throw error;
}

async function main() {
  const targetEnvironment = String(process.env.TARGET_ENVIRONMENT || "").trim().toLowerCase();
  const expectedCommitSha = String(process.env.EXPECTED_COMMIT_SHA || "").trim().toLowerCase();
  const checkedOutCommitSha = String(process.env.CHECKED_OUT_COMMIT_SHA || "").trim().toLowerCase();
  const expectedMigrationSha256 = String(process.env.EXPECTED_MIGRATION_SHA256 || "").trim().toLowerCase();

  requireMatch(targetEnvironment === "staging", "BRAND_SKILL_PREFLIGHT_NON_STAGING_TARGET_BLOCKED");
  requireMatch(/^[0-9a-f]{40}$/.test(expectedCommitSha), "BRAND_SKILL_EXPECTED_COMMIT_INVALID");
  requireMatch(checkedOutCommitSha === expectedCommitSha, "BRAND_SKILL_CHECKOUT_COMMIT_MISMATCH");
  requireMatch(/^[0-9a-f]{64}$/.test(expectedMigrationSha256), "BRAND_SKILL_EXPECTED_CHECKSUM_INVALID");

  const sql = await readFile(MIGRATION_PATH, "utf8");
  const observedMigrationSha256 = sha256(sql);
  const statements = splitSqlStatements(sql);
  const staticPreflight = assessMigrationSqlPreflight(MIGRATION_NAME, sql);
  requireMatch(observedMigrationSha256 === expectedMigrationSha256, "BRAND_SKILL_MIGRATION_CHECKSUM_MISMATCH");
  requireMatch(statements.length === 3, "BRAND_SKILL_STATEMENT_COUNT_INVALID");
  requireMatch(staticPreflight.status === "pass", "BRAND_SKILL_STATIC_PREFLIGHT_FAILED");

  const pool = getPool();
  const livePreflight = await assessBrandSkillMigrationPreflight({
    pool,
    requireRuntimeBaseline: true,
  });
  requireMatch(livePreflight.applies_sql === false, "BRAND_SKILL_PREFLIGHT_APPLIED_SQL");

  const artifact = {
    ok: livePreflight.ready === true,
    ready: livePreflight.ready === true,
    status: livePreflight.status,
    evidence_contract: "brand_skill_staging_read_only_preflight_v1",
    target_environment: targetEnvironment,
    commit_sha: checkedOutCommitSha,
    migration: MIGRATION_NAME,
    migration_checksum_sha256: observedMigrationSha256,
    statement_count: statements.length,
    static_preflight: staticPreflight,
    live_preflight: livePreflight,
    applies_sql: false,
    records_ledger: false,
    migration_apply_authorized: false,
    production_authorized: false,
    requires_separate_apply_authorization: true,
    provider_calls: false,
    external_writes: false,
    secrets_included: false,
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  await pool.end();
  if (!artifact.ready) process.exitCode = 2;
}

main().catch(async (error) => {
  const safe = {
    ok: false,
    ready: false,
    status: "fail",
    evidence_contract: "brand_skill_staging_read_only_preflight_v1",
    error_code: error?.code || "BRAND_SKILL_STAGING_PREFLIGHT_FAILED",
    applies_sql: false,
    records_ledger: false,
    migration_apply_authorized: false,
    production_authorized: false,
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
