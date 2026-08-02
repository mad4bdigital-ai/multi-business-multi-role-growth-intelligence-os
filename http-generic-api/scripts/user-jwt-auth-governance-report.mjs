import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HARDENED_AUTH_FILES,
  addedLineViolations,
  addedLinesFromDiff,
  hardenedFileViolations,
  resolveBaselineRef,
} from "./user-jwt-auth-governance.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(API_ROOT, "..");

function git(args) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function parseArgs(argv) {
  const baseline = argv.find((arg) => arg.startsWith("--baseline-ref="));
  const report = argv.find((arg) => arg.startsWith("--report-file="));
  return {
    baselineRef: baseline ? baseline.slice("--baseline-ref=".length) : "",
    reportFile: report ? report.slice("--report-file=".length) : "",
  };
}

function uniqueViolations(items = []) {
  return [...new Map(items.map((item) => [JSON.stringify(item), item])).values()];
}

function safeViolation(item = {}) {
  const evidenceFingerprint = item.text
    ? createHash("sha256").update(String(item.text)).digest("hex")
    : null;
  return {
    file: String(item.file || "").slice(0, 512),
    rule: String(item.rule || "unknown").slice(0, 128),
    evidence_fingerprint: evidenceFingerprint,
    raw_source_included: false,
  };
}

function safeError(error = {}) {
  const message = String(error?.message || "diagnostic generation failed")
    .replace(/[A-Za-z0-9_+/=-]{48,}/g, "[redacted]")
    .slice(0, 500);
  return {
    stage: String(error?.diagnosticStage || "unknown").slice(0, 128),
    name: String(error?.name || "Error").slice(0, 128),
    code: error?.code ? String(error.code).slice(0, 128) : null,
    message,
    raw_stderr_included: false,
  };
}

function writeReport(reportFile, report) {
  if (!reportFile) {
    throw new Error("--report-file is required.");
  }
  mkdirSync(dirname(resolve(reportFile)), { recursive: true });
  writeFileSync(resolve(reportFile), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function buildReport({ baselineRef = "", violations = [], failure = null } = {}) {
  const candidateSha = String(
    process.env.CANDIDATE_SHA || process.env.GITHUB_SHA || git(["rev-parse", "HEAD"]),
  ).trim();
  const safeViolations = violations.map(safeViolation);
  return {
    contract: "mad4b.user-jwt-auth-governance-summary.v1",
    generated_at: new Date().toISOString(),
    candidate_kind: "head",
    candidate_sha: candidateSha,
    candidate_ref: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || null,
    baseline_ref: baselineRef || null,
    outcome: failure ? "error" : safeViolations.length ? "blocked" : "passed",
    decision_detail: failure
      ? "diagnostic_generation_failed"
      : safeViolations.length
        ? "user_jwt_auth_governance_violations"
        : "no_blocking_finding",
    hardened_file_count: HARDENED_AUTH_FILES.length,
    violation_count: safeViolations.length,
    violations: safeViolations,
    diagnostic_error: failure ? safeError(failure) : null,
    integrity_findings: [],
    job_logs_consulted: false,
    repository_mutation: false,
    provider_dispatch: false,
    credential_access: false,
    secrets_included: false,
  };
}

function stage(name, callback) {
  try {
    return callback();
  } catch (error) {
    error.diagnosticStage = name;
    throw error;
  }
}

function collectViolations(explicitBaselineRef = "") {
  const baselineRef = stage("resolve_baseline", () => resolveBaselineRef(explicitBaselineRef));
  const diffs = [];
  if (baselineRef) {
    diffs.push(stage("diff_baseline_to_head", () =>
      git(["diff", "--unified=0", `${baselineRef}...HEAD`, "--", "*.js", "*.mjs"]),
    ));
  }
  diffs.push(stage("diff_worktree_to_head", () =>
    git(["diff", "--unified=0", "HEAD", "--", "*.js", "*.mjs"]),
  ));
  const hardened = stage("scan_hardened_files", () => hardenedFileViolations());
  const added = stage("scan_added_lines", () =>
    addedLineViolations(addedLinesFromDiff(diffs.filter(Boolean).join("\n"))),
  );
  return { baselineRef, violations: uniqueViolations([...hardened, ...added]) };
}

const { baselineRef: requestedBaselineRef, reportFile } = parseArgs(process.argv.slice(2));

try {
  const { baselineRef, violations } = collectViolations(requestedBaselineRef);
  const report = buildReport({ baselineRef, violations });
  writeReport(reportFile, report);
  console.log(
    `User JWT auth governance diagnostic ${report.outcome}: ${report.violation_count} violation(s); report=${resolve(reportFile)}`,
  );
} catch (error) {
  const report = buildReport({ baselineRef: requestedBaselineRef, violations: [], failure: error });
  writeReport(reportFile, report);
  console.log(`User JWT auth governance diagnostic error at ${report.diagnostic_error.stage}; report=${resolve(reportFile)}`);
}
