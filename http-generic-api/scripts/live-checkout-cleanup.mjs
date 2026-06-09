#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(API_DIR, "..");
const CONFIRM_TOKEN = "APPLY_LIVE_CHECKOUT_CLEANUP";
const CAPABILITY_EXECUTION_REF = "live_checkout_cleanup:apply";

const ALLOWED_CLEANUP_PATHS = new Set([
  "http-generic-api/test-tenant-gpt-customer-safe-resource-escalation.mjs",
]);
const ALLOWED_ROOT_LOGS = new Set(["console.log", "stderr.log"]);
const ACCEPTED_CAPABILITY_INTENTS = Object.freeze([
  "live_checkout_cleanup",
  "live_checkout_cleanup_apply",
  "repo_mutation",
  "repo_patch_apply",
]);

function parseArgs(argv = process.argv.slice(2)) {
  const args = { mode: "dry_run", paths: [], deleteLogs: false, confirm: "", capabilityEnvelopeId: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const item = String(argv[i] || "");
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item === "--dry-run") args.mode = "dry_run";
    else if (item === "--apply") args.mode = "apply";
    else if (item.startsWith("--path")) { args.paths.push(String(value || "")); if (consume) i += 1; }
    else if (item === "--delete-logs") args.deleteLogs = true;
    else if (item.startsWith("--confirm")) { args.confirm = String(value || ""); if (consume) i += 1; }
    else if (item.startsWith("--capability-envelope-id") || item.startsWith("--capability_envelope_id")) { args.capabilityEnvelopeId = String(value || "").trim(); if (consume) i += 1; }
    else throw new Error(`Unsupported argument: ${item}`);
  }
  if (!args.paths.length) {
    args.paths = [
      "http-generic-api/test-tenant-gpt-customer-safe-resource-escalation.mjs",
      "console.log",
      "stderr.log",
    ];
  }
  return args;
}

function cleanRepoPath(input = "") {
  const value = String(input || "").replace(/\\/g, "/").trim();
  if (!value || value.startsWith("/") || value.includes("..") || /[\0\n\r;&|`$<>!{}]/.test(value)) {
    const err = new Error("Path is not allowed for live checkout cleanup.");
    err.code = "live_checkout_cleanup_path_not_allowed";
    throw err;
  }
  if (!ALLOWED_CLEANUP_PATHS.has(value) && !ALLOWED_ROOT_LOGS.has(value)) {
    const err = new Error("Path is outside the live checkout cleanup allowlist.");
    err.code = "live_checkout_cleanup_path_not_allowlisted";
    throw err;
  }
  return value;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function normalizeLf(buffer) {
  return Buffer.from(buffer.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
}

function git(args, options = {}) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: options.encoding || "buffer", stdio: ["ignore", "pipe", "pipe"] });
}

function statusFor(repoPath) {
  try {
    return String(git(["status", "--porcelain=v1", "--", repoPath], { encoding: "utf8" })).trim();
  } catch (error) {
    return `status_error:${error.message}`;
  }
}

function headBuffer(repoPath) {
  return git(["show", `HEAD:${repoPath}`]);
}

function gitText(args) {
  try {
    return String(git(args, { encoding: "utf8" })).trim();
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    return `git_error:${error.status || error.code || "unknown"}${stderr ? `:${stderr.split(/\n/)[0]}` : ""}`;
  }
}

function metadataDiagnostics(repoPath) {
  return {
    ls_files_stage: gitText(["ls-files", "--stage", "--", repoPath]),
    ls_files_eol: gitText(["ls-files", "--eol", "--", repoPath]),
    diff_summary: gitText(["diff", "--summary", "--", repoPath]),
    diff_numstat: gitText(["diff", "--numstat", "--", repoPath]),
    diff_cached_summary: gitText(["diff", "--cached", "--summary", "--", repoPath]),
    diff_cached_numstat: gitText(["diff", "--cached", "--numstat", "--", repoPath]),
    secrets_included: false,
  };
}

function analyzeTrackedPath(repoPath) {
  const absolutePath = path.join(REPO_ROOT, repoPath);
  const exists = existsSync(absolutePath);
  const status = statusFor(repoPath);
  if (!exists) {
    return { path: repoPath, kind: "tracked", exists, status, cleanable: false, reason: "working_tree_file_missing", secrets_included: false };
  }
  const work = readFileSync(absolutePath);
  const head = headBuffer(repoPath);
  const workHash = sha256(work);
  const headHash = sha256(head);
  const normalizedWorkHash = sha256(normalizeLf(work));
  const normalizedHeadHash = sha256(normalizeLf(head));
  const exactEqual = workHash === headHash;
  const normalizedLfEqual = normalizedWorkHash === normalizedHeadHash;
  const cleanable = Boolean(status) && (exactEqual || normalizedLfEqual);
  return {
    path: repoPath,
    kind: "tracked",
    exists,
    status,
    cleanable,
    clean_strategy: exactEqual ? "git_update_index_refresh" : normalizedLfEqual ? "git_checkout_restore_eol_only" : "blocked_content_diff",
    exact_equal: exactEqual,
    normalized_lf_equal: normalizedLfEqual,
    work_sha256: workHash,
    head_sha256: headHash,
    metadata_diagnostics: metadataDiagnostics(repoPath),
    secrets_included: false,
  };
}

function analyzeLogPath(repoPath) {
  const absolutePath = path.join(REPO_ROOT, repoPath);
  const exists = existsSync(absolutePath);
  const status = statusFor(repoPath);
  return {
    path: repoPath,
    kind: "root_log",
    exists,
    status,
    cleanable: exists,
    clean_strategy: "allowlisted_root_log_delete",
    secrets_included: false,
  };
}

function analyzePath(repoPath) {
  const cleanPath = cleanRepoPath(repoPath);
  if (ALLOWED_ROOT_LOGS.has(cleanPath)) return analyzeLogPath(cleanPath);
  return analyzeTrackedPath(cleanPath);
}

async function loadCapabilityEnvelopeDeps() {
  const [guardModule, dbModule] = await Promise.all([
    import("../capabilityResolutionEnvelopeGuard.js"),
    import("../db.js"),
  ]);
  return {
    capabilityEnvelopeError: guardModule.capabilityEnvelopeError,
    markCapabilityEnvelopeReferenced: guardModule.markCapabilityEnvelopeReferenced,
    resolveCapabilityExecutionEnvelope: guardModule.resolveCapabilityExecutionEnvelope,
    getPool: dbModule.getPool,
  };
}

async function loadAuditDeps() {
  const { writeAuditLogAsync } = await import("../auditLogger.js");
  return { writeAuditLogAsync };
}

async function requireApplyCapabilityEnvelope(args = {}) {
  if (args.mode !== "apply") {
    return { required: false, ok: true, secrets_included: false };
  }
  const envelopeId = String(args.capabilityEnvelopeId || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(envelopeId)) {
    const err = new Error("--capability-envelope-id is required for live checkout cleanup apply.");
    err.code = "live_checkout_cleanup_capability_envelope_required";
    throw err;
  }
  const {
    capabilityEnvelopeError,
    markCapabilityEnvelopeReferenced,
    resolveCapabilityExecutionEnvelope,
    getPool,
  } = await loadCapabilityEnvelopeDeps();
  const pool = getPool();
  const resolved = await resolveCapabilityExecutionEnvelope({
    pool,
    source: { capability_envelope_id: envelopeId },
    acceptedAppKeys: ["github"],
    acceptedIntents: ACCEPTED_CAPABILITY_INTENTS,
  });
  if (!resolved.ok) {
    throw capabilityEnvelopeError(resolved, "Live checkout cleanup apply requires a valid capability resolution envelope.");
  }
  await markCapabilityEnvelopeReferenced({ pool, envelopeId: resolved.envelope_id, executionRef: CAPABILITY_EXECUTION_REF });
  return {
    required: true,
    ok: true,
    envelope_id: resolved.envelope_id,
    operation_intent: resolved.operation_intent || null,
    selected_runtime_surface: resolved.selected_runtime_surface || null,
    secrets_included: false,
  };
}

function applyCleanup(report, args) {
  if (!report.cleanable) return { ...report, applied: false, apply_reason: "not_cleanable" };
  if (args.confirm !== CONFIRM_TOKEN) return { ...report, applied: false, apply_reason: "missing_confirmation" };
  if (report.kind === "root_log") {
    if (!args.deleteLogs) return { ...report, applied: false, apply_reason: "delete_logs_flag_required" };
    rmSync(path.join(REPO_ROOT, report.path), { force: true });
    return { ...report, applied: true, after_status: statusFor(report.path), secrets_included: false };
  }
  if (report.clean_strategy === "git_update_index_refresh") {
    try {
      git(["update-index", "--refresh", "--", report.path], { encoding: "utf8" });
    } catch (error) {
      if (!report.normalized_lf_equal) throw error;
      git(["checkout", "HEAD", "--", report.path], { encoding: "utf8" });
      return { ...report, applied: true, fallback_strategy: "git_checkout_head_after_refresh_warning", after_status: statusFor(report.path), secrets_included: false };
    }
  } else if (report.clean_strategy === "git_checkout_restore_eol_only") {
    git(["checkout", "--", report.path], { encoding: "utf8" });
  } else {
    return { ...report, applied: false, apply_reason: "blocked_content_diff" };
  }
  return { ...report, applied: true, after_status: statusFor(report.path), secrets_included: false };
}

export async function runLiveCheckoutCleanup(rawArgs = parseArgs()) {
  const args = Array.isArray(rawArgs) ? parseArgs(rawArgs) : rawArgs;
  const capability_envelope = await requireApplyCapabilityEnvelope(args);
  const reports = args.paths.map(analyzePath);
  const applied = args.mode === "apply" ? reports.map((report) => applyCleanup(report, args)) : [];
  const result = {
    ok: true,
    mode: args.mode,
    repo_root: REPO_ROOT,
    confirm_required: args.mode === "apply" ? CONFIRM_TOKEN : undefined,
    capability_envelope,
    paths_checked: reports.length,
    reports,
    applied,
    ready_for_apply: reports.every((report) => report.cleanable) && args.mode === "dry_run",
    secrets_included: false,
  };
  if (args.mode === "apply") {
    const { writeAuditLogAsync } = await loadAuditDeps();
    writeAuditLogAsync({
      actor_type: "service",
      action: "live_checkout_cleanup.apply",
      resource_type: "repository_checkout",
      resource_id: REPO_ROOT,
      service_mode: "admin_control",
      metadata: {
        capability_envelope,
        paths_checked: reports.length,
        applied_count: applied.filter((item) => item.applied === true).length,
        blocked_count: applied.filter((item) => item.applied !== true).length,
        delete_logs: args.deleteLogs === true,
        secrets_included: false,
      },
      outcome: applied.every((item) => item.applied === true) ? "completed" : "partial_or_blocked",
    });
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(`${JSON.stringify(await runLiveCheckoutCleanup(parseArgs()), null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: error.code || "live_checkout_cleanup_failed", message: error.message, details: error.details || undefined }, secrets_included: false }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
