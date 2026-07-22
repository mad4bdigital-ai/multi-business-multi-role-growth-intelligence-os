#!/usr/bin/env node
import { getPool } from "../db.js";
import {
  getAuthEmailOutboxStatus,
  runAuthEmailOutboxWorker,
} from "../authEmailOutboxWorker.js";

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
  const parsed = Number.parseInt(readArg(name, String(fallback)), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function safeError(error) {
  return {
    code: error?.code || "auth_email_outbox_worker_failed",
    message: error?.message || "Auth email outbox worker failed.",
    readiness: error?.readiness || undefined,
  };
}

const action = String(readArg("action", "status")).trim().toLowerCase();
const purposes = readArg("purposes", "support_ticket_admin_notification");
const limit = integerArg("limit", 10, 1, 50);
const confirm = readArg("confirm", "");
const senderConnectionId = readArg("sender-connection-id", "");
const pool = getPool();
let exitCode = 0;

try {
  if (action === "status") {
    print({ action, ...(await getAuthEmailOutboxStatus({ pool, purposes })) });
  } else if (action === "dry-run") {
    print({ action, ...(await runAuthEmailOutboxWorker({ pool, purposes, limit, dryRun: true, senderConnectionId })) });
  } else if (action === "run-once") {
    if (!hasFlag("apply")) {
      const error = new Error("run-once requires --apply; otherwise use --action=dry-run.");
      error.code = "auth_email_outbox_apply_flag_required";
      throw error;
    }
    print({ action, ...(await runAuthEmailOutboxWorker({ pool, purposes, limit, dryRun: false, confirm, senderConnectionId })) });
  } else {
    const error = new Error("Unsupported action; use status, dry-run, or run-once.");
    error.code = "auth_email_outbox_action_unsupported";
    throw error;
  }
} catch (error) {
  exitCode = 1;
  print({ ok: false, action, error: safeError(error), secrets_included: false });
} finally {
  await pool.end().catch(() => {});
}

process.exitCode = exitCode;
