#!/usr/bin/env node
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runDynamicAuditCycle } from "../dynamicAuditRuntime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const CONFIRM = "APPLY_GOVERNED_PLATFORM_AUTOMATION_TICK";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    apply: false,
    confirm: "",
    migrationLimit: 100,
    auditLimit: 1000,
    includeMigrationReconciliation: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = String(argv[i] || "");
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item === "--dry-run") args.apply = false;
    else if (item === "--apply") args.apply = true;
    else if (item === "--skip-migration-reconciliation") args.includeMigrationReconciliation = false;
    else if (item.startsWith("--confirm")) { args.confirm = String(value || ""); if (consume) i += 1; }
    else if (item.startsWith("--migration-limit")) { args.migrationLimit = Math.max(1, Math.min(Number(value || 100), 2000)); if (consume) i += 1; }
    else if (item.startsWith("--audit-limit")) { args.auditLimit = Math.max(1, Math.min(Number(value || 1000), 5000)); if (consume) i += 1; }
    else throw new Error(`Unsupported argument: ${item}`);
  }
  return args;
}

function parseStructuredOutput(value = "") {
  const lines = String(value || "").trim().split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    try {
      let parsed = JSON.parse(line);
      for (let depth = 0; depth < 4; depth += 1) {
        if (!parsed || typeof parsed !== "object" || typeof parsed.message !== "string") break;
        try { parsed = JSON.parse(parsed.message); } catch { break; }
      }
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Continue scanning earlier lines.
    }
  }
  return null;
}

function boundedReconciliation(output) {
  if (!output || typeof output !== "object") return output;
  const items = Array.isArray(output.items) ? output.items : [];
  return {
    ok: output.ok === true,
    run_id: output.run_id || null,
    mode: output.mode || null,
    policy_available: output.policy_available === true,
    policy_key: output.policy_key || null,
    migration_count: Number(output.migration_count || items.length || 0),
    ready_count: Number(output.ready_count || 0),
    executed_count: Number(output.executed_count || 0),
    blocked_count: Number(output.blocked_count || 0),
    item_sample: items.slice(0, 20).map((item) => ({
      migration: item.migration,
      action: item.decision?.action || null,
      status: item.decision?.status || null,
      reason: item.decision?.reason || null,
      execution_ok: item.execution?.ok ?? null,
    })),
    items_omitted: Math.max(0, items.length - 20),
    secrets_included: false,
  };
}

function runReconciliation(options) {
  if (!options.includeMigrationReconciliation) {
    return { ok: true, skipped: true, reason: "explicitly_skipped", secrets_included: false };
  }
  const args = options.apply
    ? ["--apply", "--confirm=APPLY_GOVERNED_MIGRATION_RECONCILIATION", `--limit=${options.migrationLimit}`]
    : ["--dry-run", `--limit=${options.migrationLimit}`];
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "governed-migration-reconciler.mjs"), ...args],
    {
      cwd: API_DIR,
      env: process.env,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    }
  );
  const output = parseStructuredOutput(result.stdout) || parseStructuredOutput(result.stderr);
  return {
    ok: result.status === 0 && output?.ok === true,
    exit_code: result.status,
    output: boundedReconciliation(output),
  };
}

async function main() {
  const options = parseArgs();
  if (options.apply && options.confirm !== CONFIRM) {
    throw new Error(`Apply requires --confirm=${CONFIRM}`);
  }

  const migrationReconciliation = runReconciliation(options);
  const dynamicAudit = options.apply
    ? await runDynamicAuditCycle({
        mode: "governed_platform_automation_tick",
        batch_limit: options.auditLimit,
        source_limit: Math.min(options.auditLimit, 1000),
        checkpoint_batch_limit: options.auditLimit,
      })
    : {
        ok: true,
        mode: "dry_run",
        skipped: true,
        reason: "dynamic_audit_mutations_require_apply",
        secrets_included: false,
      };

  const result = {
    ok: migrationReconciliation.ok && dynamicAudit.ok,
    mode: options.apply ? "apply" : "dry_run",
    stages: {
      migration_reconciliation: migrationReconciliation,
      dynamic_audit: dynamicAudit,
    },
    required_confirmation: CONFIRM,
    scheduler_mode: "internal_runtime_interval_with_mysql_advisory_lock",
    continuous_scheduler_external: false,
    database_trigger_created: false,
    raw_payload_stored: false,
    secrets_included: false,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: {
      code: error.code || "governed_platform_automation_tick_failed",
      message: error.message,
    },
    secrets_included: false,
  }, null, 2)}\n`);
  process.exit(1);
});
