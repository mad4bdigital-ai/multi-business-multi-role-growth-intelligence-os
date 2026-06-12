#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const CONFIRM = "APPLY_GOVERNED_PLATFORM_AUTOMATION_TICK";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { apply: false, confirm: "", migrationLimit: 500, auditLimit: 1000 };
  for (let i = 0; i < argv.length; i += 1) {
    const item = String(argv[i] || "");
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item === "--dry-run") args.apply = false;
    else if (item === "--apply") args.apply = true;
    else if (item.startsWith("--confirm")) { args.confirm = String(value || ""); if (consume) i += 1; }
    else if (item.startsWith("--migration-limit")) { args.migrationLimit = Math.max(1, Math.min(Number(value || 500), 2000)); if (consume) i += 1; }
    else if (item.startsWith("--audit-limit")) { args.auditLimit = Math.max(1, Math.min(Number(value || 1000), 5000)); if (consume) i += 1; }
    else throw new Error(`Unsupported argument: ${item}`);
  }
  return args;
}

function run(script, args) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: API_DIR,
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  let output = null;
  try { output = JSON.parse(String(result.stdout || result.stderr || "").trim()); } catch {}
  return { ok: result.status === 0 && Boolean(output?.ok), exit_code: result.status, output };
}

const options = parseArgs();
if (options.apply && options.confirm !== CONFIRM) throw new Error(`Apply requires --confirm=${CONFIRM}`);

const reconcileArgs = options.apply
  ? ["--apply", "--confirm=APPLY_GOVERNED_MIGRATION_RECONCILIATION", `--limit=${options.migrationLimit}`]
  : ["--dry-run", `--limit=${options.migrationLimit}`];
const auditArgs = options.apply
  ? ["--apply", "--confirm=APPLY_AUDIT_LOG_EVENT_BUS_BRIDGE", `--limit=${options.auditLimit}`]
  : [`--limit=${options.auditLimit}`];
const rollupArgs = options.apply
  ? ["--apply", "--confirm=APPLY_AUDIT_EVENT_ROLLUP_BUILDER", `--limit=${options.auditLimit}`]
  : [`--limit=${options.auditLimit}`];

const stages = [
  { stage: "migration_reconciliation", ...run("governed-migration-reconciler.mjs", reconcileArgs) },
  { stage: "audit_log_event_bus_bridge", ...run("audit-log-event-bus-bridge.mjs", auditArgs) },
  { stage: "audit_event_rollup_builder", ...run("audit-event-rollup-builder.mjs", rollupArgs) },
];
const result = {
  ok: stages.every((stage) => stage.ok),
  mode: options.apply ? "apply" : "dry_run",
  stages,
  required_confirmation: CONFIRM,
  continuous_scheduler_external: true,
  database_trigger_created: false,
  secrets_included: false,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 2;
