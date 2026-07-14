#!/usr/bin/env node
import { getPool } from "../db.js";
import {
  getPlatformOutboxStatus,
  runPlatformOutboxLoop,
  runPlatformOutboxWorker,
} from "../platformOutbox.js";

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] || fallback) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function integerArg(name, fallback, minimum, maximum) {
  const value = Number.parseInt(readArg(name, String(fallback)), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, minimum), maximum);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function safeError(error) {
  return {
    code: error?.code || "platform_outbox_worker_failed",
    message: error?.message || "Platform outbox worker failed.",
    readiness: error?.readiness || undefined,
  };
}

const action = String(readArg("action", "status")).trim().toLowerCase();
const consumerKey = String(readArg("consumer", "prod_shadow_v1")).trim();
const limit = integerArg("limit", 100, 1, 500);
const intervalMs = integerArg("interval-ms", 5000, 1000, 300000);
const pool = getPool();

let exitCode = 0;
try {
  if (action === "status") {
    print({ action, ...(await getPlatformOutboxStatus({ pool })) });
  } else if (action === "dry-run") {
    print({
      action,
      ...(await runPlatformOutboxWorker({ pool, consumerKey, limit, dryRun: true })),
    });
  } else if (action === "run-once") {
    if (!hasFlag("apply")) {
      const error = new Error("run-once requires --apply; otherwise use --action=dry-run.");
      error.code = "outbox_apply_flag_required";
      throw error;
    }
    print({
      action,
      ...(await runPlatformOutboxWorker({ pool, consumerKey, limit, dryRun: false })),
    });
  } else if (action === "loop") {
    if (!hasFlag("apply")) {
      const error = new Error("loop requires --apply; otherwise use --action=dry-run.");
      error.code = "outbox_apply_flag_required";
      throw error;
    }
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    print({
      ok: true,
      action,
      consumer_key: consumerKey,
      interval_ms: intervalMs,
      limit,
      started: true,
      secrets_included: false,
    });
    const result = await runPlatformOutboxLoop({
      pool,
      consumerKey,
      limit,
      intervalMs,
      signal: controller.signal,
      onIteration: async ({ iteration, result: iterationResult }) => {
        print({ action: "loop_iteration", iteration, ...iterationResult });
      },
    });
    print({ action: "loop_stopped", ...result });
  } else {
    const error = new Error("Unsupported action; use status, dry-run, run-once, or loop.");
    error.code = "outbox_action_unsupported";
    throw error;
  }
} catch (error) {
  exitCode = 1;
  print({ ok: false, action, error: safeError(error), secrets_included: false });
} finally {
  await pool.end().catch(() => {});
}

process.exitCode = exitCode;
