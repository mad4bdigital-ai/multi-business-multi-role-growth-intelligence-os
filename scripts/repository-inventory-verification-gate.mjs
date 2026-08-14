#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CONTRACT = "mad4b.repository-inventory-verification-gate.v1";
const OUTPUTS = [
  "docs/repository-inventory.json",
  "docs/repository-inventory-summary.json",
  "docs/repository-inventory.md",
];
const REQUIRED_AUTHORITY_CHANGES = [
  ".github/workflows/governed-generated-artifact-refresh.yml",
  ".github/workflows/repository-inventory-autofix-dispatch.yml",
  ".github/workflows/repository-inventory.yml",
  "http-generic-api/scripts/maintenance-tools/generated-artifact-refresh.mjs",
];
const TRUSTED_GENERATOR_PATHS = [
  "scripts/repository-inventory.mjs",
  "package.json",
  "package-lock.json",
];
const GOVERNED_BRANCH = /^(?:gpt|fix|feat|chore|docs|release)\/[A-Za-z0-9._/-]+$/u;
const FULL_SHA = /^[0-9a-f]{40}$/u;
const ALLOWED_BOOTSTRAP_EVENTS = new Set(["pull_request", "workflow_dispatch"]);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).replace(/-/gu, "_");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    const error = new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return result;
}

function lines(value) {
  return String(value || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function git(args, options) {
  return run("git", args, options);
}

function outputHashes() {
  return Object.fromEntries(OUTPUTS.map((file) => {
    const content = fs.readFileSync(file);
    return [file, crypto.createHash("sha256").update(content).digest("hex")];
  }));
}

function sameHashes(first, second) {
  return OUTPUTS.every((file) => first[file] === second[file]);
}

function parsePorcelainPaths(raw) {
  return String(raw || "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const value = line.slice(3).trim();
      return value.includes(" -> ") ? value.split(" -> ").at(-1) : value;
    });
}

function writeEvidence(outputPath, evidence) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence)}\n`);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

const args = parseArgs(process.argv);
const eventName = args.event_name || process.env.GITHUB_EVENT_NAME || "unknown";
const repository = args.repository || process.env.GITHUB_REPOSITORY || "";
const headRepository = args.head_repository || repository;
const baseRef = args.base_ref || "main";
const targetRef = args.target_ref || process.env.GITHUB_REF_NAME || "";
const expectedHeadSha = args.expected_head_sha || process.env.GITHUB_SHA || "";
const outputPath = args.output || "repository-inventory-verification.json";

const baseEvidence = {
  contract: CONTRACT,
  event_name: eventName,
  target_ref: targetRef,
  expected_head_sha: expectedHeadSha,
  permissions: { contents: "read" },
  repository_mutation: false,
  protected_branch_mutation: false,
  force_push: false,
  secrets_included: false,
};

function fail(code, detail, extra = {}) {
  const evidence = {
    ...baseEvidence,
    outcome: "failed",
    inventory_state: "blocked",
    current: false,
    bootstrap_pending: false,
    followup_required: true,
    first_failure: { code, diagnostic_tail: String(detail).slice(0, 2000) },
    ...extra,
  };
  writeEvidence(outputPath, evidence);
  process.exit(1);
}

let actualHeadSha;
try {
  actualHeadSha = git(["rev-parse", "HEAD"]).stdout.trim();
} catch (error) {
  fail("head_resolution_failed", error.message);
}

if (!FULL_SHA.test(expectedHeadSha) || actualHeadSha !== expectedHeadSha) {
  fail("expected_head_sha_mismatch", `expected=${expectedHeadSha} actual=${actualHeadSha}`, { actual_head_sha: actualHeadSha });
}

if (headRepository === repository && GOVERNED_BRANCH.test(targetRef)) {
  const remote = git(["ls-remote", "--exit-code", "origin", `refs/heads/${targetRef}`], { allowFailure: true });
  const remoteHeadSha = lines(remote.stdout)[0]?.split(/\s+/u)[0] || "";
  if (remote.status !== 0 || remoteHeadSha !== expectedHeadSha) {
    fail("remote_head_sha_mismatch", `expected=${expectedHeadSha} remote=${remoteHeadSha || "missing"}`, { actual_head_sha: actualHeadSha, remote_head_sha: remoteHeadSha || null });
  }
}

let firstHashes;
let secondHashes;
try {
  run(process.execPath, ["scripts/repository-inventory.mjs"]);
  firstHashes = outputHashes();
  run("npm", ["run", "inventory:check"]);
  run("npm", ["run", "inventory:test"]);
  run(process.execPath, ["scripts/repository-inventory.mjs"]);
  secondHashes = outputHashes();
  run("npm", ["run", "inventory:check"]);
  run("npm", ["run", "inventory:test"]);
} catch (error) {
  fail("inventory_generation_or_contract_failed", `${error.message}\n${error.stderr || ""}`, { actual_head_sha: actualHeadSha });
}

if (!sameHashes(firstHashes, secondHashes)) {
  fail("repository_inventory_not_deterministic", "Two consecutive generation passes produced different SHA-256 output identities.", {
    actual_head_sha: actualHeadSha,
    first_output_sha256: firstHashes,
    second_output_sha256: secondHashes,
  });
}

const dirtyOutputs = lines(git(["diff", "--name-only", "--", ...OUTPUTS]).stdout);
if (dirtyOutputs.length === 0) {
  writeEvidence(outputPath, {
    ...baseEvidence,
    outcome: "passed",
    inventory_state: "current",
    actual_head_sha: actualHeadSha,
    current: true,
    bootstrap_pending: false,
    deterministic_generation_verified: true,
    output_sha256: secondHashes,
    followup_required: false,
  });
  process.exit(0);
}

if (!ALLOWED_BOOTSTRAP_EVENTS.has(eventName)) {
  fail("repository_inventory_stale", `Inventory differs from HEAD during event=${eventName}; bootstrap evidence is allowed only for pull_request or workflow_dispatch.`, {
    actual_head_sha: actualHeadSha,
    dirty_files: dirtyOutputs,
    deterministic_generation_verified: true,
    output_sha256: secondHashes,
  });
}

if (headRepository !== repository) {
  fail("cross_repository_bootstrap_forbidden", `head_repository=${headRepository} repository=${repository}`, { actual_head_sha: actualHeadSha });
}
if (baseRef !== "main") {
  fail("unexpected_base_branch", `base_ref=${baseRef}`, { actual_head_sha: actualHeadSha });
}
if (!GOVERNED_BRANCH.test(targetRef) || targetRef === "main" || targetRef === "Production") {
  fail("invalid_governed_work_branch", `target_ref=${targetRef}`, { actual_head_sha: actualHeadSha });
}

const fetchMain = git(["fetch", "--no-tags", "origin", "main"], { allowFailure: true });
if (fetchMain.status !== 0) {
  fail("trusted_main_fetch_failed", fetchMain.stderr || fetchMain.stdout, { actual_head_sha: actualHeadSha });
}
const trustedMainSha = git(["rev-parse", "origin/main"]).stdout.trim();
const mergeBaseSha = git(["merge-base", "HEAD", "origin/main"]).stdout.trim();
if (mergeBaseSha !== trustedMainSha) {
  fail("branch_requires_reconciliation", `trusted_main_sha=${trustedMainSha} merge_base_sha=${mergeBaseSha}`, {
    actual_head_sha: actualHeadSha,
    trusted_main_sha: trustedMainSha,
    merge_base_sha: mergeBaseSha,
  });
}

const generatorDiff = git(["diff", "--quiet", "origin/main...HEAD", "--", ...TRUSTED_GENERATOR_PATHS], { allowFailure: true });
if (generatorDiff.status !== 0) {
  fail("trusted_generator_or_package_changed", "The self-hosting bootstrap requires the canonical Inventory generator and root package contract to be byte-unchanged from trusted main.", {
    actual_head_sha: actualHeadSha,
    trusted_main_sha: trustedMainSha,
  });
}

let e2eContract;
try {
  e2eContract = JSON.parse(fs.readFileSync(".changes/e2e/repository-inventory-governed-regeneration.json", "utf8"));
} catch (error) {
  fail("bootstrap_contract_missing_or_invalid", error.message, { actual_head_sha: actualHeadSha, trusted_main_sha: trustedMainSha });
}
if (e2eContract.feature_key !== "repository-inventory-governed-regeneration" || e2eContract.merge_contract?.minimum_phase !== "mvp") {
  fail("bootstrap_contract_identity_invalid", "The repository-inventory-governed-regeneration contract is missing the required MVP merge identity.", {
    actual_head_sha: actualHeadSha,
    trusted_main_sha: trustedMainSha,
  });
}

const sourceChanges = new Set(lines(git(["diff", "--name-only", "origin/main...HEAD"]).stdout));
const missingAuthority = REQUIRED_AUTHORITY_CHANGES.filter((file) => !sourceChanges.has(file));
const trustedAuthorityOnMain = REQUIRED_AUTHORITY_CHANGES.every((file) =>
  git(["cat-file", "-e", `origin/main:${file}`], { allowFailure: true }).status === 0,
);
if (!trustedAuthorityOnMain && missingAuthority.length) {
  fail("self_hosting_authority_installation_not_proven", `Missing required authority changes: ${missingAuthority.join(", ")}`, {
    actual_head_sha: actualHeadSha,
    trusted_main_sha: trustedMainSha,
    trusted_authority_on_main: false,
  });
}

const expectedOutputs = [...OUTPUTS].sort();
const actualOutputs = [...dirtyOutputs].sort();
if (actualOutputs.length !== expectedOutputs.length || actualOutputs.some((file, index) => file !== expectedOutputs[index])) {
  fail("dirty_set_exceeds_inventory_outputs", `dirty_outputs=${actualOutputs.join(",")}`, {
    actual_head_sha: actualHeadSha,
    trusted_main_sha: trustedMainSha,
    dirty_files: actualOutputs,
  });
}

const worktreePaths = parsePorcelainPaths(git(["status", "--porcelain", "--untracked-files=all"]).stdout).sort();
if (worktreePaths.length !== expectedOutputs.length || worktreePaths.some((file, index) => file !== expectedOutputs[index])) {
  fail("worktree_dirty_set_exceeds_inventory_outputs", `worktree_paths=${worktreePaths.join(",")}`, {
    actual_head_sha: actualHeadSha,
    trusted_main_sha: trustedMainSha,
    dirty_files: actualOutputs,
    worktree_dirty_files: worktreePaths,
  });
}

writeEvidence(outputPath, {
  ...baseEvidence,
  outcome: "bootstrap_pending",
  inventory_state: "self_hosting_bootstrap_pending",
  actual_head_sha: actualHeadSha,
  trusted_main_sha: trustedMainSha,
  current: false,
  bootstrap_pending: true,
  behind_by_zero: true,
  trusted_generator_unchanged: true,
  trusted_authority_on_main: trustedAuthorityOnMain,
  deterministic_generation_verified: true,
  output_sha256: secondHashes,
  dirty_files: actualOutputs,
  followup_required: true,
  followup_mode: "trusted_post_merge_work_branch",
});
