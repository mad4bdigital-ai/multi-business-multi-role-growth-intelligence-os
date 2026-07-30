#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";
import { collectDelegationGrantMariaDbReadinessEvidence } from "../delegationGrantMariaDbReadinessCollector.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const MIGRATION = "20260725_agent_delegation_grant_persistence_contract.sql";
const APPLY_CONFIRMATION = "APPLY_20260725_AGENT_DELEGATION_GRANT_PERSISTENCE_CONTRACT";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseArgs(argv = process.argv.slice(2)) {
  const args = { action: "status", confirm: "", capabilityEnvelopeId: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = String(argv[index] || "");
    if (value === "--action") args.action = String(argv[++index] || "");
    else if (value.startsWith("--action=")) args.action = value.slice("--action=".length);
    else if (value === "--confirm") args.confirm = String(argv[++index] || "");
    else if (value.startsWith("--confirm=")) args.confirm = value.slice("--confirm=".length);
    else if (value === "--capability-envelope-id") args.capabilityEnvelopeId = String(argv[++index] || "");
    else if (value.startsWith("--capability-envelope-id=")) {
      args.capabilityEnvelopeId = value.slice("--capability-envelope-id=".length);
    } else throw new Error(`Unsupported argument: ${value}`);
  }
  args.action = String(args.action || "status").trim().toLowerCase();
  if (!["status", "dry-run", "apply"].includes(args.action)) {
    throw new Error("--action must be status, dry-run, or apply.");
  }
  return args;
}

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function assertProductionApplyGate(args) {
  if (process.env.DELEGATION_MARIADB_PRODUCTION_APPLY_MODE !== "authorized") {
    throw new Error("DELEGATION_MARIADB_PRODUCTION_APPLY_MODE=authorized is required for production apply.");
  }
  if (/^spec011_delegation_cert_/i.test(String(process.env.DB_NAME || ""))) {
    throw new Error("Production apply cannot target a disposable certification schema.");
  }
  if (args.confirm !== APPLY_CONFIRMATION) {
    throw new Error(`Production apply requires --confirm=${APPLY_CONFIRMATION}`);
  }
  if (!UUID_PATTERN.test(args.capabilityEnvelopeId)) {
    throw new Error("Production apply requires a valid --capability-envelope-id UUID.");
  }
}

function runRunner({ apply, capabilityEnvelopeId = "" } = {}) {
  const runnerArgs = [
    "scripts/governed-migration-runner.mjs",
    apply ? "--apply" : "--dry-run",
    `--migration=${MIGRATION}`,
  ];
  if (apply) runnerArgs.push(`--confirm=${APPLY_CONFIRMATION}`);
  if (capabilityEnvelopeId) runnerArgs.push(`--capability-envelope-id=${capabilityEnvelopeId}`);
  const child = spawnSync(process.execPath, runnerArgs, {
    cwd: API_DIR,
    env: process.env,
    encoding: "utf8",
  });
  const output = String(child.stdout || child.stderr || "").trim();
  if (child.status !== 0) throw new Error(output || "Governed migration runner failed.");
  return JSON.parse(output);
}

async function main() {
  const args = parseArgs();
  const sql = await readFile(path.join(API_DIR, "migrations", MIGRATION), "utf8");
  const checksum = sha256(sql);
  const pool = getPool();

  if (args.action === "status") {
    const readiness = await collectDelegationGrantMariaDbReadinessEvidence({
      pool,
      expectedMigrationChecksum: checksum,
      runtimeAuthorityEnabled: false,
    });
    console.log(JSON.stringify({
      ok: true,
      report_type: "spec011_delegation_mariadb_production_cycle_status",
      action: "status",
      migration_file: MIGRATION,
      expected_migration_checksum_sha256: checksum,
      readiness,
      mutation_performed: false,
      production_apply_authorized: false,
      secrets_included: false,
    }, null, 2));
    await pool.end();
    return;
  }

  if (args.action === "dry-run") {
    const dryRun = runRunner({ apply: false, capabilityEnvelopeId: args.capabilityEnvelopeId });
    console.log(JSON.stringify({
      ok: true,
      report_type: "spec011_delegation_mariadb_production_cycle_dry_run",
      action: "dry-run",
      migration_file: MIGRATION,
      expected_migration_checksum_sha256: checksum,
      dry_run: dryRun,
      mutation_performed: false,
      production_apply_authorized: false,
      required_confirmation: APPLY_CONFIRMATION,
      secrets_included: false,
    }, null, 2));
    await pool.end();
    return;
  }

  assertProductionApplyGate(args);
  const apply = runRunner({ apply: true, capabilityEnvelopeId: args.capabilityEnvelopeId });
  const readiness = await collectDelegationGrantMariaDbReadinessEvidence({
    pool,
    expectedMigrationChecksum: checksum,
    runtimeAuthorityEnabled: false,
  });
  if (readiness.status !== "verified_applied" || readiness.checksum_pin_match !== true) {
    throw new Error("Migration apply completed but same-cycle readiness certification failed closed.");
  }
  console.log(JSON.stringify({
    ok: true,
    report_type: "spec011_delegation_mariadb_production_cycle_apply",
    action: "apply",
    migration_file: MIGRATION,
    expected_migration_checksum_sha256: checksum,
    apply,
    readiness,
    mutation_performed: true,
    runtime_binding_enabled: false,
    runtime_policy_ready_promoted: false,
    secrets_included: false,
  }, null, 2));
  await pool.end();
}

main().catch(async (error) => {
  console.error(JSON.stringify({
    ok: false,
    report_type: "spec011_delegation_mariadb_production_cycle",
    error: error?.message || String(error),
    code: error?.code || null,
    secrets_included: false,
  }, null, 2));
  try { await getPool().end(); } catch {}
  process.exit(1);
});
