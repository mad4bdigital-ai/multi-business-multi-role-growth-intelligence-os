#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyLineEndingDrift,
  classifySensitiveChanges,
  buildVerificationPlan,
  compareDirectDependencyVersions,
  compareContinuitySnapshots,
  nodeVersionSatisfiesEngine,
  parseGitPorcelainZ,
  shouldFailReadiness,
  summarizeReadiness,
} from "../interruptionReadiness.js";

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(API_ROOT, "..");
const packageJson = JSON.parse(readFileSync(path.join(API_ROOT, "package.json"), "utf8"));
const packageLock = readJsonSafe(path.join(API_ROOT, "package-lock.json")) || {};
const requireFromApi = createRequire(path.join(API_ROOT, "package.json"));

function readJsonSafe(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function isCommitSha(value) {
  return /^[a-f0-9]{40}$/i.test(String(value || "").trim());
}

function readPullRequestBaseSha() {
  const eventPath = String(process.env.GITHUB_EVENT_PATH || "").trim();
  if (!eventPath) return null;
  const event = readJsonSafe(eventPath);
  const baseSha = String(event?.pull_request?.base?.sha || "").trim();
  return isCommitSha(baseSha) ? baseSha : null;
}

function parseArgs(argv) {
  const options = {
    ci: false,
    json: false,
    reportFile: null,
    verifyEvidence: null,
    maxAgeMinutes: 360,
    target: "origin/main",
    targetExplicit: false,
    dependencies: true,
    merge: true,
    worktree: true,
    engine: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--ci") options.ci = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--skip-dependencies") options.dependencies = false;
    else if (arg === "--skip-merge") options.merge = false;
    else if (arg === "--skip-worktree") options.worktree = false;
    else if (arg === "--skip-engine") options.engine = false;
    else if (arg === "--target") {
      options.target = argv[++index];
      options.targetExplicit = true;
    } else if (arg.startsWith("--target=")) {
      options.target = arg.slice("--target=".length);
      options.targetExplicit = true;
    } else if (arg === "--report-file") options.reportFile = argv[++index];
    else if (arg.startsWith("--report-file=")) options.reportFile = arg.slice("--report-file=".length);
    else if (arg === "--verify-evidence") options.verifyEvidence = argv[++index];
    else if (arg.startsWith("--verify-evidence=")) options.verifyEvidence = arg.slice("--verify-evidence=".length);
    else if (arg === "--max-age-minutes") options.maxAgeMinutes = Number(argv[++index]);
    else if (arg.startsWith("--max-age-minutes=")) options.maxAgeMinutes = Number(arg.slice("--max-age-minutes=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.maxAgeMinutes) || options.maxAgeMinutes < 0) throw new Error("--max-age-minutes must be a non-negative number");
  if (options.ci && !options.targetExplicit) options.target = readPullRequestBaseSha() || options.target;
  delete options.targetExplicit;
  return options;
}

function runGit(args, { allowFailure = false, trim = true } = {}) {
  const result = spawnSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return {
    status: result.status ?? 1,
    stdout: trim ? (result.stdout || "").trim() : (result.stdout || ""),
    stderr: trim ? (result.stderr || "").trim() : (result.stderr || ""),
  };
}

function addCheck(checks, id, level, message, evidence = {}) {
  checks.push({ id, level, message, evidence });
}

function checkEngine(checks, options) {
  const engine = packageJson.engines?.node;
  if (!engine) return;
  const compatible = nodeVersionSatisfiesEngine(process.version, engine);
  addCheck(
    checks,
    "node_engine",
    compatible ? "info" : options.ci ? "blocker" : "warning",
    compatible
      ? `Node ${process.version} satisfies ${engine}.`
      : `Node ${process.version} does not satisfy ${engine}; use the CI/runtime major before trusting results.`,
    { actual: process.version, required: engine },
  );
}

function checkDependencies(checks) {
  const installed = {};
  for (const dependency of Object.keys(packageJson.dependencies || {})) {
    try {
      requireFromApi.resolve(dependency);
      installed[dependency] = JSON.parse(readFileSync(path.join(API_ROOT, "node_modules", dependency, "package.json"), "utf8")).version;
    } catch {
      installed[dependency] = null;
    }
  }
  const expected = Object.fromEntries(
    Object.keys(packageJson.dependencies || {}).map((dependency) => [
      dependency,
      packageLock.packages?.[`node_modules/${dependency}`]?.version || null,
    ]),
  );
  const comparison = compareDirectDependencyVersions(expected, installed);
  const dependencyProblems = [
    comparison.missing.length ? `missing: ${comparison.missing.join(", ")}` : null,
    comparison.mismatched.length ? `version mismatch: ${comparison.mismatched.map((item) => `${item.name} (${item.installed} != ${item.expected})`).join(", ")}` : null,
    comparison.unlocked.length ? `missing lock entries: ${comparison.unlocked.join(", ")}` : null,
  ].filter(Boolean);
  addCheck(
    checks,
    "dependencies",
    comparison.ready ? "info" : "blocker",
    comparison.ready
      ? "All direct API dependencies resolve and match package-lock.json."
      : `Direct dependency readiness failed (${dependencyProblems.join("; ")}). Restore lock parity and run npm ci before tests.`,
    { ...comparison, expected, installed },
  );
}

function splitLines(value) {
  return value ? value.split(/\r?\n/).filter(Boolean) : [];
}

function sha256File(file) {
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

function repoRelativePath(file) {
  if (!file) return null;
  const relative = path.relative(REPO_ROOT, path.resolve(process.cwd(), file)).replaceAll("\\", "/");
  return relative.startsWith("../") || path.isAbsolute(relative) ? null : relative;
}

function worktreeSha256(excludedFiles = []) {
  const hash = createHash("sha256");
  hash.update(runGit(["diff", "--binary", "HEAD"], { trim: false }).stdout);
  hash.update(runGit(["diff", "--cached", "--binary", "HEAD"], { trim: false }).stdout);
  const excluded = new Set(excludedFiles.map(repoRelativePath).filter(Boolean));
  const untracked = runGit(["ls-files", "--others", "--exclude-standard", "-z"], { trim: false }).stdout
    .split("\0")
    .filter(Boolean)
    .filter((file) => !excluded.has(file))
    .sort();
  for (const file of untracked) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(path.join(REPO_ROOT, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function currentContinuitySnapshot(options) {
  const target = runGit(["rev-parse", "--verify", options.target], { allowFailure: true });
  const targetSha = target.status === 0 ? target.stdout : null;
  const mergeBase = targetSha ? runGit(["merge-base", "HEAD", options.target], { allowFailure: true }).stdout || null : null;
  const installedDirectDependencies = Object.fromEntries(
    Object.keys(packageJson.dependencies || {}).map((dependency) => {
      try {
        return [dependency, JSON.parse(readFileSync(path.join(API_ROOT, "node_modules", dependency, "package.json"), "utf8")).version];
      } catch {
        return [dependency, null];
      }
    }),
  );
  return {
    generated_at: new Date().toISOString(),
    head_sha: runGit(["rev-parse", "HEAD"]).stdout,
    target_ref: options.target,
    target_sha: targetSha,
    merge_base: mergeBase,
    package_lock_sha256: sha256File(path.join(API_ROOT, "package-lock.json")),
    direct_dependencies_sha256: createHash("sha256").update(JSON.stringify(installedDirectDependencies)).digest("hex"),
    worktree_sha256: worktreeSha256([options.reportFile, options.verifyEvidence]),
  };
}

function checkMerge(checks, options, report) {
  const targetExists = runGit(["rev-parse", "--verify", options.target], { allowFailure: true });
  if (targetExists.status !== 0) {
    addCheck(checks, "merge_target", "blocker", `Merge target ${options.target} is unavailable; fetch it before validation.`);
    return;
  }

  const mergeBase = runGit(["merge-base", "HEAD", options.target]).stdout;
  const branchFiles = splitLines(runGit(["diff", "--name-only", `${mergeBase}..HEAD`]).stdout);
  const targetFiles = splitLines(runGit(["diff", "--name-only", `${mergeBase}..${options.target}`]).stdout);
  const overlap = classifySensitiveChanges(branchFiles, targetFiles);
  const mergeTree = runGit(["merge-tree", "--write-tree", "HEAD", options.target], { allowFailure: true });
  const counts = runGit(["rev-list", "--left-right", "--count", `HEAD...${options.target}`]).stdout.split(/\s+/);

  report.merge = {
    target: options.target,
    merge_base: mergeBase,
    ahead: Number(counts[0] || 0),
    behind: Number(counts[1] || 0),
    sensitive_touched: overlap.touched,
    sensitive_overlap: overlap.overlapping,
    recommended_tests: overlap.tests,
    branch_files: branchFiles,
    target_files: targetFiles,
  };

  addCheck(
    checks,
    "merge_conflicts",
    mergeTree.status === 0 ? "info" : "blocker",
    mergeTree.status === 0
      ? `HEAD is mergeable with ${options.target}.`
      : `HEAD conflicts with ${options.target}; reconcile in an isolated worktree before merge.`,
    { target: options.target, details: mergeTree.status === 0 ? [] : splitLines(`${mergeTree.stdout}\n${mergeTree.stderr}`).slice(0, 20) },
  );
  if (overlap.overlapping.length) {
    addCheck(
      checks,
      "sensitive_overlap",
      "warning",
      `Both sides changed sensitive runtime surfaces: ${overlap.overlapping.join(", ")}.`,
      { files: overlap.overlapping, recommended_tests: overlap.tests },
    );
  } else if (overlap.touched.length) {
    addCheck(
      checks,
      "sensitive_surface_tests",
      "info",
      `Sensitive surfaces changed; run ${overlap.tests.length} targeted test(s).`,
      { files: overlap.touched, recommended_tests: overlap.tests },
    );
  }
}

function checkWorktree(checks, options, report) {
  const entries = parseGitPorcelainZ(runGit(["status", "--porcelain=v1", "-z"], { trim: false }).stdout);
  const tracked = entries.filter((entry) => entry.status !== "??");
  const untracked = entries.filter((entry) => entry.status === "??").map((entry) => entry.file);
  const lineEndingOnly = [];
  const contentChanges = [];

  for (const entry of tracked) {
    const changed = runGit(["diff", "--quiet", "--", entry.file], { allowFailure: true }).status !== 0;
    const equalIgnoringEol = runGit(["diff", "--ignore-space-at-eol", "--quiet", "--", entry.file], { allowFailure: true }).status === 0;
    const classification = classifyLineEndingDrift({ changed, equalIgnoringEol });
    if (classification === "eol_or_trailing_whitespace_only") lineEndingOnly.push(entry.file);
    else contentChanges.push(entry.file);
  }

  report.worktree = { tracked: tracked.map((entry) => entry.file), untracked, line_ending_only: lineEndingOnly };
  if (lineEndingOnly.length) {
    addCheck(
      checks,
      "line_ending_drift",
      options.ci ? "blocker" : "warning",
      `Line-ending/trailing-whitespace-only drift can block branch switching: ${lineEndingOnly.join(", ")}.`,
      { files: lineEndingOnly, recovery: "Keep the file untouched and perform integration in an isolated clean worktree." },
    );
  }
  if (contentChanges.length || untracked.length) {
    addCheck(
      checks,
      "dirty_worktree",
      "warning",
      `Worktree has ${contentChanges.length} tracked content change(s) and ${untracked.length} untracked path(s).`,
      { tracked_content_changes: contentChanges, untracked },
    );
  } else if (!lineEndingOnly.length) {
    addCheck(checks, "dirty_worktree", "info", "Worktree is clean.");
  }
}

function checkEvidenceFreshness(checks, options, report) {
  if (!options.verifyEvidence) return;
  const baselineReport = JSON.parse(readFileSync(path.resolve(process.cwd(), options.verifyEvidence), "utf8"));
  const result = compareContinuitySnapshots(baselineReport.continuity_snapshot, report.continuity_snapshot, {
    maxAgeMinutes: options.maxAgeMinutes,
  });
  addCheck(
    checks,
    "evidence_freshness",
    result.fresh ? "info" : "blocker",
    result.fresh
      ? "Baseline evidence remains fresh; HEAD, target, merge base, and package lock are unchanged."
      : `Baseline evidence is stale: ${result.reasons.join(", ")}.`,
    { baseline_schema_version: baselineReport.schema_version || null, reasons: result.reasons },
  );
}

function renderHuman(report) {
  console.log(`Interruption readiness: ${report.status.toUpperCase()}`);
  for (const check of report.checks) {
    console.log(`[${check.level.toUpperCase()}] ${check.id}: ${check.message}`);
  }
  const tests = report.verification_plan?.commands || [];
  if (tests.length) {
    console.log("Recommended targeted tests:");
    tests.forEach((test) => console.log(`- ${test}`));
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const checks = [];
  const report = {
    schema_version: "interruption_readiness.v1",
    generated_at: new Date().toISOString(),
    mode: options.ci ? "ci" : "local",
    coverage: {
      engine: options.engine,
      dependencies: options.dependencies,
      merge: options.merge,
      worktree: options.worktree,
    },
    checks,
  };
  report.continuity_snapshot = currentContinuitySnapshot(options);

  if (options.engine) checkEngine(checks, options);
  if (options.dependencies) checkDependencies(checks);
  if (options.merge) checkMerge(checks, options, report);
  if (options.worktree) checkWorktree(checks, options, report);
  const changedFiles = [
    ...(report.merge?.branch_files || []),
    ...(report.worktree?.tracked || []),
    ...(report.worktree?.untracked || []),
  ];
  report.verification_plan = buildVerificationPlan(changedFiles);
  checkEvidenceFreshness(checks, options, report);

  report.summary = summarizeReadiness(checks);
  report.status = shouldFailReadiness(checks) ? "blocked" : report.summary.warning ? "warning" : "ready";

  if (options.reportFile) {
    writeFileSync(path.resolve(process.cwd(), options.reportFile), `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else renderHuman(report);
  process.exitCode = report.status === "blocked" ? 1 : 0;
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error);
  process.exit(1);
}
