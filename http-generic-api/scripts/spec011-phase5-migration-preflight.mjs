#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";
import {
  STRUCTURED_DIAGNOSIS_SCHEMA_VERSION,
  authorizeMigrationApply,
  buildStructuredDiagnosis,
} from "../spec011Phase5ValidationCi.js";
import { evaluateMigrationEnginePreflight } from "../spec011Phase5MigrationPreflight.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const ARTIFACT_PATH = path.join(API_DIR, "artifacts", "spec011-phase5-migration-preflight.json");

function assertDisposableTarget() {
  if (process.env.DELEGATION_MARIADB_CERTIFICATION_MODE !== "disposable") {
    throw Object.assign(new Error("Disposable validation mode is required."), {
      code: "MIGRATION_PREFLIGHT_DISPOSABLE_MODE_REQUIRED",
    });
  }
  if (!/^spec011_delegation_cert_[a-z0-9_]+$/i.test(String(process.env.DB_NAME || ""))) {
    throw Object.assign(new Error("Disposable database prefix is required."), {
      code: "MIGRATION_PREFLIGHT_DISPOSABLE_DATABASE_REQUIRED",
    });
  }
}

async function writeArtifact(value) {
  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function querySingle(pool, sql) {
  const [rows] = await pool.query(sql);
  return rows?.[0] || {};
}

async function collectTransactionIsolation(pool) {
  try {
    const row = await querySingle(pool, "SELECT @@transaction_isolation AS transaction_isolation");
    return String(row.transaction_isolation || "");
  } catch {
    const row = await querySingle(pool, "SELECT @@tx_isolation AS transaction_isolation");
    return String(row.transaction_isolation || "");
  }
}

async function verifyCheckConstraintEnforcement(pool) {
  await pool.query("DROP TEMPORARY TABLE IF EXISTS spec011_phase5_preflight_check_probe");
  await pool.query(`CREATE TEMPORARY TABLE spec011_phase5_preflight_check_probe (
    value_int INT NOT NULL,
    CONSTRAINT chk_spec011_phase5_preflight CHECK (value_int = 0)
  ) ENGINE=InnoDB`);
  let rejected = false;
  try {
    await pool.query("INSERT INTO spec011_phase5_preflight_check_probe (value_int) VALUES (1)");
  } catch (error) {
    rejected = /check constraint|constraint.*failed|ER_CONSTRAINT_FAILED/i.test(String(error?.message || ""));
    if (!rejected) throw error;
  } finally {
    await pool.query("DROP TEMPORARY TABLE IF EXISTS spec011_phase5_preflight_check_probe");
  }
  return rejected;
}

async function collectEngine(pool) {
  const engine = await querySingle(
    pool,
    `SELECT VERSION() AS version,
            @@version_comment AS version_comment,
            @@sql_mode AS sql_mode,
            @@character_set_server AS character_set_server,
            @@collation_server AS collation_server`,
  );
  const jsonSupport = await querySingle(pool, `SELECT JSON_VALID('{"ok":true}') AS json_supported`);
  const transactionIsolation = await collectTransactionIsolation(pool);
  return {
    family: /mariadb/i.test(`${engine.version} ${engine.version_comment}`) ? "MariaDB" : "MySQL-compatible",
    version: String(engine.version || ""),
    sql_mode: String(engine.sql_mode || ""),
    character_set: String(engine.character_set_server || ""),
    collation: String(engine.collation_server || ""),
    check_constraints_enforced: await verifyCheckConstraintEnforcement(pool),
    transaction_isolation: transactionIsolation,
    transaction_isolation_verified: /READ-COMMITTED|REPEATABLE-READ|SERIALIZABLE/i.test(transactionIsolation),
    json_supported: Number(jsonSupport.json_supported) === 1,
    secrets_included: false,
  };
}

async function main() {
  assertDisposableTarget();
  const pool = getPool();
  const preflight = evaluateMigrationEnginePreflight({
    engine: await collectEngine(pool),
    disposableTarget: true,
    productionAuthorized: false,
  });
  const authorization = authorizeMigrationApply({
    mode: "apply",
    validation: preflight,
    evidenceRef: "artifact://spec011/spec011-phase5-migration-preflight.json",
  });
  const diagnosis = buildStructuredDiagnosis({
    gateId: "migration_engine_preflight",
    status: preflight.status === "pass" && authorization.apply_authorized ? "pass" : "blocked",
    code: preflight.status === "pass" && authorization.apply_authorized
      ? "PASS"
      : "MIGRATION_ENGINE_PREFLIGHT_BLOCKED",
    summary: "Validate MariaDB-compatible engine properties before governed migration apply.",
    blockers: [...preflight.blockers, ...authorization.blockers],
    evidenceRefs: ["database://disposable/spec011-delegation-certification"],
    remediation: preflight.status === "pass" && authorization.apply_authorized
      ? []
      : ["Correct the disposable engine blocker and rerun preflight before migration apply."],
    metadata: {
      preflight_fingerprint: preflight.evidence_fingerprint,
      apply_authorized: authorization.apply_authorized,
    },
  });
  const report = {
    ok: diagnosis.status === "pass",
    report_type: "spec011_phase5_migration_preflight_report",
    schema_version: STRUCTURED_DIAGNOSIS_SCHEMA_VERSION,
    status: diagnosis.status,
    diagnosis,
    preflight,
    migration_apply_authorization: authorization,
    production_authorized: false,
    generated_at: new Date().toISOString(),
    secrets_included: false,
  };
  await writeArtifact(report);
  console.log(JSON.stringify(report, null, 2));
  await pool.end();
  if (!report.ok) process.exit(1);
}

main().catch(async (error) => {
  const rawCode = String(error?.code || "MIGRATION_ENGINE_PREFLIGHT_FAILED").slice(0, 128);
  const code = /^[A-Z0-9_:-]+$/.test(rawCode) ? rawCode : "MIGRATION_ENGINE_PREFLIGHT_FAILED";
  const diagnosis = buildStructuredDiagnosis({
    gateId: "migration_engine_preflight",
    status: "fail",
    code,
    summary: "Migration engine preflight did not complete before apply.",
    blockers: [code],
    evidenceRefs: ["workflow://spec-011-delegation-mariadb-certification"],
    remediation: ["Inspect the exact-head preflight logs and resolve the blocker before migration apply."],
    metadata: { failure_stage: "pre_apply_engine_validation" },
  });
  const report = {
    ok: false,
    report_type: "spec011_phase5_migration_preflight_report",
    schema_version: STRUCTURED_DIAGNOSIS_SCHEMA_VERSION,
    status: "failed",
    diagnosis,
    production_authorized: false,
    secrets_included: false,
  };
  try { await writeArtifact(report); } catch {}
  console.error(JSON.stringify(report, null, 2));
  try { await getPool().end(); } catch {}
  process.exit(1);
});
