import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECONCILER_PATH = path.join(__dirname, "scripts", "governed-migration-reconciler.mjs");

export const GOVERNED_MIGRATION_RECONCILIATION_CONFIRMATION =
  "APPLY_GOVERNED_MIGRATION_RECONCILIATION";
export const GOVERNED_MIGRATION_RECONCILIATION_LOCK =
  "governed_migration_reconciliation.v1";

function parseStructuredOutput(value = "") {
  const lines = String(value || "").trim().split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    try {
      let parsed = JSON.parse(line);
      for (let depth = 0; depth < 4; depth += 1) {
        if (!parsed || typeof parsed !== "object" || typeof parsed.message !== "string") break;
        try { parsed = JSON.parse(parsed.message); }
        catch { break; }
      }
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Continue scanning for the last structured object.
    }
  }
  return null;
}

function boundedReconciliation(output) {
  if (!output || typeof output !== "object") {
    return {
      ok: false,
      error: { code: "governed_migration_reconciliation_output_invalid" },
      secrets_included: false,
    };
  }
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
    raw_payload_stored: false,
    secrets_included: false,
  };
}

function runtimeFailure(error) {
  const output = parseStructuredOutput(error?.stdout) || parseStructuredOutput(error?.stderr);
  return {
    ok: false,
    exit_code: Number.isInteger(error?.code) ? error.code : null,
    error: {
      code: output?.error?.code || error?.code || "governed_migration_reconciliation_runtime_failed",
      message: String(
        output?.error?.message
        || output?.error
        || error?.message
        || "Reconciliation failed.",
      ).slice(0, 1000),
    },
    output: boundedReconciliation(output),
    raw_payload_stored: false,
    secrets_included: false,
  };
}

function operationalError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeAdvisoryLockResult(value) {
  if (value === 0 || value === 1) return value;
  if (value === "0" || value === "1") return Number(value);
  return null;
}

export async function runGovernedMigrationReconciliationRuntime(options = {}, dependencies = {}) {
  const apply = options.apply === true;
  const limit = Math.max(1, Math.min(Number(options.limit || 2000), 2000));
  const timeoutMs = Math.max(10_000, Math.min(Number(options.timeout_ms || 600_000), 600_000));
  const migration = String(options.migration || "").trim();
  const args = apply
    ? ["--apply", `--confirm=${GOVERNED_MIGRATION_RECONCILIATION_CONFIRMATION}`, `--limit=${limit}`]
    : ["--dry-run", `--limit=${limit}`];
  if (migration) args.push(`--migration=${path.basename(migration)}`);

  const execute = dependencies.execFileAsync || execFileAsync;
  let connection = null;
  let lockAcquired = false;
  let response = null;

  try {
    const pool = dependencies.pool || getPool();
    connection = await pool.getConnection();
    const [lockRows] = await connection.query(
      "SELECT GET_LOCK(?, 0) AS acquired",
      [GOVERNED_MIGRATION_RECONCILIATION_LOCK],
    );
    const lockResult = normalizeAdvisoryLockResult(lockRows?.[0]?.acquired);

    if (lockResult === 0) {
      response = {
        ok: true,
        skipped: true,
        reason: "governed_migration_reconciliation_lock_busy",
        lock_key: GOVERNED_MIGRATION_RECONCILIATION_LOCK,
        mode: apply ? "apply" : "dry_run",
        secrets_included: false,
      };
    } else if (lockResult !== 1) {
      throw operationalError(
        "governed_migration_reconciliation_lock_failed",
        "The migration reconciliation advisory lock could not be evaluated.",
      );
    } else {
      lockAcquired = true;
      const result = await execute(process.execPath, [RECONCILER_PATH, ...args], {
        cwd: __dirname,
        env: process.env,
        encoding: "utf8",
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
      });
      const output = parseStructuredOutput(result?.stdout) || parseStructuredOutput(result?.stderr);
      const bounded = boundedReconciliation(output);
      response = {
        ok: bounded.ok,
        exit_code: 0,
        output: bounded,
        lock_key: GOVERNED_MIGRATION_RECONCILIATION_LOCK,
        secrets_included: false,
      };
    }
  } catch (error) {
    response = runtimeFailure(error);
  } finally {
    let releaseError = null;
    if (connection && lockAcquired) {
      try {
        const [releaseRows] = await connection.query(
          "SELECT RELEASE_LOCK(?) AS released",
          [GOVERNED_MIGRATION_RECONCILIATION_LOCK],
        );
        if (Number(releaseRows?.[0]?.released) !== 1) {
          throw operationalError(
            "governed_migration_reconciliation_lock_release_failed",
            "The migration reconciliation advisory lock was not released cleanly.",
          );
        }
      } catch (error) {
        releaseError = error?.code
          ? error
          : operationalError(
            "governed_migration_reconciliation_lock_release_failed",
            error?.message || "The migration reconciliation advisory lock release failed.",
          );
        if (typeof connection.destroy === "function") {
          connection.destroy();
        } else if (typeof connection.end === "function") {
          await connection.end().catch(() => {});
        }
        connection = null;
      }
    }

    if (connection && typeof connection.release === "function") connection.release();

    if (releaseError) {
      if (response?.ok === true) {
        response = runtimeFailure(releaseError);
      } else {
        response = {
          ...(response || runtimeFailure(releaseError)),
          lock_cleanup: {
            ok: false,
            code: releaseError.code,
            message: String(releaseError.message || "Lock cleanup failed.").slice(0, 1000),
          },
          secrets_included: false,
        };
      }
    }
  }

  return response || runtimeFailure(
    operationalError(
      "governed_migration_reconciliation_runtime_failed",
      "The migration reconciliation runtime produced no result.",
    ),
  );
}
