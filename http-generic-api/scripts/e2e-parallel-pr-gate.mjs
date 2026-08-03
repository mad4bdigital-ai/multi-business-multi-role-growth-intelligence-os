#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateParallelWork } from "./e2e-parallel-work-governance.mjs";
import { matchesPattern } from "./e2e-phase-governance.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const IMMUTABLE_RELEASE_PATTERN = /^release\/production-candidate-\d{8}-([0-9a-f]{8})-v([1-9][0-9]*)$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseArgs(argv) {
  const options = {
    root: REPO_ROOT,
    base: null,
    head: "HEAD",
    headRef: process.env.GITHUB_HEAD_REF || "",
    baseRef: process.env.GITHUB_BASE_REF || "",
    mainRef: process.env.E2E_CANONICAL_MAIN_REF || "refs/remotes/origin/main",
    reportFile: null,
    githubOutput: process.env.GITHUB_OUTPUT || null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const read = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      index += 1;
      return value;
    };
    if (arg === "--root") options.root = path.resolve(read());
    else if (arg.startsWith("--root=")) options.root = path.resolve(arg.slice(7));
    else if (arg === "--base") options.base = read();
    else if (arg.startsWith("--base=")) options.base = arg.slice(7);
    else if (arg === "--head") options.head = read();
    else if (arg.startsWith("--head=")) options.head = arg.slice(7);
    else if (arg === "--head-ref") options.headRef = read();
    else if (arg.startsWith("--head-ref=")) options.headRef = arg.slice(11);
    else if (arg === "--base-ref") options.baseRef = read();
    else if (arg.startsWith("--base-ref=")) options.baseRef = arg.slice(11);
    else if (arg === "--main-ref") options.mainRef = read();
    else if (arg.startsWith("--main-ref=")) options.mainRef = arg.slice(11);
    else if (arg === "--report-file") options.reportFile = read();
    else if (arg.startsWith("--report-file=")) options.reportFile = arg.slice(14);
    else if (arg === "--github-output") options.githubOutput = read();
    else if (arg.startsWith("--github-output=")) options.githubOutput = arg.slice(16);
    else if (arg === "check" || arg === "--ci" || arg === "--changed") {}
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function addFinding(report, code, details = {}) {
  report.findings.push({ code, ...details });
  report.ok = false;
}

function writeAtomic(file, data) {
  if (!file) return;
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temporary, resolved);
}

function writeOutputs(file, outputs) {
  if (!file) return;
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${String(value ?? "")}`);
  fs.appendFileSync(file, `${lines.join("\n")}\n`);
}

function runGit(root, args) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function resolveCommit(root, ref) {
  if (!ref) return null;
  const result = runGit(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
  if (result.status !== 0) return null;
  const sha = String(result.stdout || "").trim();
  return EXACT_SHA_PATTERN.test(sha) ? sha : null;
}

function resolveCanonicalMain(root, mainRef) {
  let sha = resolveCommit(root, mainRef);
  if (sha || mainRef !== "refs/remotes/origin/main") return sha;

  const fetch = runGit(root, [
    "fetch",
    "--no-tags",
    "origin",
    "+refs/heads/main:refs/remotes/origin/main"
  ]);
  if (fetch.status !== 0) return null;
  sha = resolveCommit(root, mainRef);
  return sha;
}

function classifyProductionPromotion(options) {
  const directMainPromotion = options.headRef === "main" && options.baseRef === "Production";
  if (directMainPromotion) {
    return {
      intent: true,
      accepted: true,
      kind: "direct_main",
      canonicalMainSha: null,
      finding: null
    };
  }

  const releaseMatch = IMMUTABLE_RELEASE_PATTERN.exec(options.headRef);
  const immutableIntent = options.baseRef === "Production" && Boolean(releaseMatch);
  if (!immutableIntent) {
    return {
      intent: false,
      accepted: false,
      kind: null,
      canonicalMainSha: null,
      finding: null
    };
  }

  const requestedShortSha = releaseMatch[1];
  const headSha = resolveCommit(options.root, options.head);
  if (!headSha || !headSha.startsWith(requestedShortSha)) {
    return {
      intent: true,
      accepted: false,
      kind: "immutable_main_snapshot",
      canonicalMainSha: null,
      finding: {
        code: "production_promotion_release_head_sha_mismatch",
        head_ref: options.headRef,
        head_sha: headSha,
        required_short_sha: requestedShortSha
      }
    };
  }

  const canonicalMainSha = resolveCanonicalMain(options.root, options.mainRef);
  if (!canonicalMainSha) {
    return {
      intent: true,
      accepted: false,
      kind: "immutable_main_snapshot",
      canonicalMainSha: null,
      finding: {
        code: "production_promotion_canonical_main_unavailable",
        head_ref: options.headRef,
        main_ref: options.mainRef
      }
    };
  }

  const ancestry = runGit(options.root, ["merge-base", "--is-ancestor", headSha, canonicalMainSha]);
  if (ancestry.status !== 0) {
    return {
      intent: true,
      accepted: false,
      kind: "immutable_main_snapshot",
      canonicalMainSha,
      finding: {
        code: "production_promotion_release_snapshot_not_in_main",
        head_ref: options.headRef,
        head_sha: headSha,
        canonical_main_sha: canonicalMainSha
      }
    };
  }

  return {
    intent: true,
    accepted: true,
    kind: "immutable_main_snapshot",
    canonicalMainSha,
    finding: null
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = evaluateParallelWork({
    root: options.root,
    base: options.base,
    head: options.head,
    headRef: options.headRef,
    headSha: options.head
  });

  const active = [];
  const integrations = [];
  for (const summary of report.contracts) {
    const contract = readJson(path.join(options.root, summary.contract_path));
    const parallel = contract.parallel_work;
    if (summary.active_workstream) {
      const workstream = parallel.workstreams.find((row) => row.id === summary.active_workstream);
      active.push({ summary, contract, workstream });
      if (options.baseRef && !matchesPattern(options.baseRef, parallel.integration.branch_pattern)) {
        addFinding(report, "parallel_work_workstream_must_target_integration_branch", {
          feature_key: contract.feature_key,
          workstream_id: workstream.id,
          base_ref: options.baseRef,
          required_pattern: parallel.integration.branch_pattern
        });
      }
      if (workstream.status !== "ready_for_integration") {
        addFinding(report, "parallel_work_pr_workstream_not_ready_for_integration", {
          feature_key: contract.feature_key,
          workstream_id: workstream.id,
          status: workstream.status
        });
      }
    }
    if (summary.integration_active) integrations.push({ summary, contract });
  }

  if (active.length > 1) addFinding(report, "parallel_work_pr_must_have_single_active_workstream", { active: active.map((row) => `${row.contract.feature_key}:${row.workstream.id}`) });
  if (integrations.length > 1) addFinding(report, "parallel_work_pr_must_have_single_integration_contract", { active: integrations.map((row) => row.contract.feature_key) });
  if (active.length && integrations.length) addFinding(report, "parallel_work_pr_cannot_be_workstream_and_integration", {});

  const promotion = classifyProductionPromotion(options);
  if (promotion.finding) {
    const { code, ...details } = promotion.finding;
    addFinding(report, code, details);
  }
  const productionPromotion = promotion.accepted;

  let mode = "standard";
  let featureKey = "";
  let contractPath = "";
  let workstreamId = "";
  if (active.length === 1) {
    mode = "workstream";
    featureKey = active[0].contract.feature_key;
    contractPath = active[0].summary.contract_path;
    workstreamId = active[0].workstream.id;
  } else if (integrations.length === 1) {
    mode = "integration";
    featureKey = integrations[0].contract.feature_key;
    contractPath = integrations[0].summary.contract_path;
  } else if (
    report.contracts.length
    && options.headRef
    && !options.headRef.startsWith("gh-readonly-queue/")
    && !productionPromotion
    && !promotion.intent
  ) {
    const runtimeChanged = report.changed_files.some((file) => {
      const policy = readJson(path.join(options.root, ".specify", "e2e-phase-governance.json"));
      return policy.runtime_patterns.some((pattern) => matchesPattern(file, pattern));
    });
    if (runtimeChanged) addFinding(report, "parallel_work_pr_branch_not_declared", { head_ref: options.headRef, contracts: report.contracts.map((row) => row.feature_key) });
  }

  report.pr_mode = mode;
  report.feature_key = featureKey || null;
  report.contract_path = contractPath || null;
  report.workstream_id = workstreamId || null;
  report.base_ref = options.baseRef || null;
  report.production_promotion = productionPromotion;
  report.production_promotion_kind = productionPromotion ? promotion.kind : null;
  report.canonical_main_sha = promotion.canonicalMainSha || null;
  writeAtomic(options.reportFile, report);
  writeOutputs(options.githubOutput, {
    mode,
    feature_key: featureKey,
    contract_path: contractPath,
    workstream_id: workstreamId,
    production_promotion: productionPromotion,
    production_promotion_kind: report.production_promotion_kind,
    canonical_main_sha: report.canonical_main_sha
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main();
