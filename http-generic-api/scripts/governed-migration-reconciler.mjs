#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";
import {
  assessMigrationSqlPreflight,
  extractMigrationReadinessRequirementsFromSql,
  splitSqlStatements,
} from "../releaseReadiness.js";
import { classifyMigrationReconciliationDecision } from "../governedMigrationReconciliationPolicy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(API_DIR, "migrations");
const RUNNER_PATH = path.join(__dirname, "governed-migration-runner.mjs");
const APPLY_CONFIRMATION = "APPLY_GOVERNED_MIGRATION_RECONCILIATION";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { mode: "dry_run", migration: "", limit: 500, confirm: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const item = String(argv[i] || "");
    if (item === "--dry-run") args.mode = "dry_run";
    else if (item === "--apply") args.mode = "apply";
    else if (item === "--migration") args.migration = path.basename(String(argv[++i] || ""));
    else if (item.startsWith("--migration=")) args.migration = path.basename(item.slice("--migration=".length));
    else if (item === "--limit") args.limit = Number(argv[++i] || 500);
    else if (item.startsWith("--limit=")) args.limit = Number(item.slice("--limit=".length));
    else if (item === "--confirm") args.confirm = String(argv[++i] || "");
    else if (item.startsWith("--confirm=")) args.confirm = item.slice("--confirm=".length);
    else throw new Error(`Unsupported argument: ${item}`);
  }
  args.limit = Math.min(Math.max(Number.isFinite(args.limit) ? Math.trunc(args.limit) : 500, 1), 2000);
  return args;
}

function sha256(value = "") {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function runnerConfirmation(migration, action) {
  const prefix = action === "record_only" ? "RECORD" : "APPLY";
  return `${prefix}_${migration.replace(/\.sql$/i, "").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
}

function parseJsonLine(value = "") {
  const lines = String(value || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .reverse();

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed.message === "string") {
        try {
          const nested = JSON.parse(parsed.message);
          if (nested && typeof nested === "object") return nested;
        } catch {
          // The structured log message is not JSON; fall back to the outer envelope.
        }
      }
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Continue scanning earlier output lines for the last valid JSON object.
    }
  }
  return null;
}

async function tableExists(tableName) {
  const [rows] = await getPool().query(
    "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [tableName]
  );
  return Number(rows?.[0]?.count || 0) > 0;
}

async function listMigrationFiles(selectedMigration = "", limit = 500) {
  if (selectedMigration) return [selectedMigration];
  const names = await fs.readdir(MIGRATIONS_DIR);
  return names.filter((name) => name.endsWith(".sql")).sort().slice(0, limit);
}

async function existingSchemaObjects(names = []) {
  const wanted = [...new Set((names || []).filter(Boolean))];
  if (!wanted.length) return [];
  const [rows] = await getPool().query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?) ORDER BY table_name",
    [wanted]
  );
  return rows.map((row) => row.table_name);
}

async function readPolicy() {
  const required = [
    "platform_engine_registry",
    "platform_engine_policy_registry",
    "platform_engine_policy_rules",
    "platform_engine_strategy_registry",
    "platform_engine_execution_runs",
    "platform_audit_event_bus",
  ];
  const states = await Promise.all(required.map(async (name) => [name, await tableExists(name)]));
  const missing = states.filter(([, exists]) => !exists).map(([name]) => name);
  if (missing.length) return { available: false, missing, policy: null, rules: new Map() };

  const [policyRows] = await getPool().query(
    `SELECT policy_key, mode, risk_default, approval_required_min_risk,
            require_scope_guard, require_audit, require_validators
       FROM platform_engine_policy_registry
      WHERE engine_key = 'governed_migration_reconciliation_engine' AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1`
  );
  const policy = policyRows?.[0] || null;
  if (!policy) return { available: false, missing: ["active_policy"], policy: null, rules: new Map() };

  const [ruleRows] = await getPool().query(
    `SELECT r.rule_key, r.resource_pattern AS migration_file, r.strategy_key, r.risk_level,
            r.auto_apply_allowed AS auto_execute, r.approval_required, r.condition_json, r.notes,
            s.status AS strategy_status, s.executes_dynamic_code
       FROM platform_engine_policy_rules r
       JOIN platform_engine_strategy_registry s ON s.strategy_key = r.strategy_key
      WHERE r.policy_key = ? AND r.engine_key = 'governed_migration_reconciliation_engine'
        AND r.task_class = 'migration_reconcile' AND r.status = 'active'`,
    [policy.policy_key]
  );
  return {
    available: true,
    missing: [],
    policy,
    rules: new Map(ruleRows.map((row) => [row.migration_file, row])),
  };
}

async function readAuthorization(migration) {
  const [rows] = await getPool().query(
    `SELECT migration_file, authorization_status, authorization_source, policy_key, risk_tier,
            requires_preflight, requires_confirmation, allow_record_only, allow_apply
       FROM governed_migration_authorization_registry
      WHERE migration_file = ?
      LIMIT 1`,
    [migration]
  );
  return rows?.[0] || null;
}

async function readLedger(migration, checksum) {
  const [rows] = await getPool().query(
    `SELECT run_id, mode, applied_at
       FROM governed_migration_ledger
      WHERE migration_file = ? AND migration_checksum_sha256 = ?
      ORDER BY applied_at DESC
      LIMIT 1`,
    [migration, checksum]
  );
  return rows?.[0] || null;
}

async function inspectMigration(migration, policyState) {
  const sql = await fs.readFile(path.join(MIGRATIONS_DIR, migration), "utf8");
  const checksum = sha256(sql);
  const requirements = extractMigrationReadinessRequirementsFromSql(sql);
  const requiredSchemaObjects = [...new Set(requirements.schema_objects || [])];
  const existing = await existingSchemaObjects(requiredSchemaObjects);
  const [authorization, ledger] = await Promise.all([
    readAuthorization(migration),
    readLedger(migration, checksum),
  ]);
  const preflight = assessMigrationSqlPreflight(migration, sql);
  const statementCount = splitSqlStatements(sql).length;
  const rule = policyState.rules.get(migration) || null;
  const decision = classifyMigrationReconciliationDecision({
    policyState,
    rule,
    authorization,
    ledger,
    preflight,
    required: requiredSchemaObjects,
    existing,
    checksum,
  });
  return {
    migration,
    checksum,
    authorization,
    ledger,
    rule,
    preflight_status: preflight.status,
    preflight_risk_count: Number(preflight.risk_count || 0),
    statement_count: statementCount,
    required_schema_objects: requiredSchemaObjects,
    existing_schema_objects: existing,
    missing_schema_objects: requiredSchemaObjects.filter((name) => !existing.includes(name)),
    decision,
  };
}

function runGovernedRunner(item) {
  const recordOnlyArgs = item.decision.action === "record_only" ? ["--record-ledger"] : [];
  const args = [
    RUNNER_PATH,
    ...recordOnlyArgs,
    "--apply",
    `--migration=${item.migration}`,
    `--confirm=${runnerConfirmation(item.migration, item.decision.action)}`,
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: API_DIR,
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = parseJsonLine(result.stdout) || parseJsonLine(result.stderr);
  return {
    ok: result.status === 0 && Boolean(output?.ok),
    exit_code: result.status,
    output: output || { ok: false, error: "governed_runner_output_not_json" },
  };
}

async function recordRun({ runId, args, policyState, items }) {
  if (!policyState.available) return;
  const ready = items.filter((item) => item.decision.status === "ready");
  const executed = items.filter((item) => item.execution?.ok);
  const blocked = items.filter((item) => item.decision.action === "blocked");
  const plan = items.slice(0, 500).map((item) => ({
    migration: item.migration,
    action: item.decision.action,
    status: item.decision.status,
    reason: item.decision.reason,
    rule_key: item.rule?.rule_key || null,
    execution_ok: item.execution?.ok ?? null,
  }));
  await getPool().query(
    `INSERT INTO platform_engine_execution_runs
      (run_id, run_key, engine_key, task_class, mode, policy_key, rules_matched_json,
       skills_selected_json, plan_json, risk_level, approval_status, apply_status,
       validation_status, blocked_reasons_json, outcome_json, trace_id, completed_at)
     VALUES (?, ?, 'governed_migration_reconciliation_engine', 'migration_reconcile', ?, ?, ?, ?, ?,
             'high', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE outcome_json = VALUES(outcome_json), completed_at = CURRENT_TIMESTAMP`,
    [
      runId,
      `governed_migration_reconciliation:${runId}`,
      args.mode === "apply" ? "apply" : "dry_run",
      policyState.policy.policy_key,
      JSON.stringify(items.map((item) => item.rule?.rule_key).filter(Boolean)),
      JSON.stringify(["governed_migration_reconciliation"]),
      JSON.stringify(plan),
      args.mode === "apply" ? "granted" : "not_required",
      args.mode === "apply" && ready.length ? (executed.length === ready.length ? "applied" : "failed") : "not_requested",
      blocked.length ? "blocked" : "passed",
      JSON.stringify(blocked.map((item) => ({ migration: item.migration, reason: item.decision.reason }))),
      JSON.stringify({ decision_count: items.length, ready_count: ready.length, executed_count: executed.length, blocked_count: blocked.length, secrets_included: false }),
      runId,
    ]
  );
  await getPool().query(
    `INSERT IGNORE INTO platform_audit_event_bus
      (event_key, source_family, source_key, event_type, resource_kind, resource_key,
       event_status, evidence_json, notes, created_at, updated_at)
     VALUES (?, 'governed_migration_reconciliation', ?, 'governed_migration_reconciliation.completed',
             'database_migration', ?, 'observed', ?, 'Summary-only governed reconciliation evidence.', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [
      `governed_migration_reconciliation:${runId}`,
      runId,
      policyState.policy.policy_key,
      JSON.stringify({ run_id: runId, mode: args.mode, decision_count: items.length, ready_count: ready.length, executed_count: executed.length, blocked_count: blocked.length, raw_payload_stored: false, secrets_included: false }),
    ]
  );
}

async function main() {
  const args = parseArgs();
  if (args.mode === "apply" && args.confirm !== APPLY_CONFIRMATION) {
    throw new Error(`Apply requires --confirm=${APPLY_CONFIRMATION}`);
  }

  const runId = randomUUID();
  const policyState = await readPolicy();
  const migrations = await listMigrationFiles(args.migration, args.limit);
  const items = [];
  for (const migration of migrations) {
    const item = await inspectMigration(migration, policyState);
    if (args.mode === "apply" && item.decision.status === "ready") {
      item.execution = runGovernedRunner(item);
    }
    items.push(item);
  }
  await recordRun({ runId, args, policyState, items });

  const result = {
    ok: items.every((item) => !item.execution || item.execution.ok),
    run_id: runId,
    mode: args.mode,
    policy_available: policyState.available,
    policy_key: policyState.policy?.policy_key || null,
    policy_missing: policyState.missing,
    migration_count: items.length,
    ready_count: items.filter((item) => item.decision.status === "ready").length,
    executed_count: items.filter((item) => item.execution?.ok).length,
    blocked_count: items.filter((item) => item.decision.action === "blocked").length,
    required_confirmation: APPLY_CONFIRMATION,
    items,
    secrets_included: false,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

async function closePoolQuietly() {
  try {
    await getPool().end();
  } catch {
    // Best-effort cleanup only.
  }
}

main()
  .then(closePoolQuietly)
  .catch(async (error) => {
    console.error(JSON.stringify({ ok: false, error: error?.message || String(error), secrets_included: false }, null, 2));
    await closePoolQuietly();
    process.exit(1);
  });
