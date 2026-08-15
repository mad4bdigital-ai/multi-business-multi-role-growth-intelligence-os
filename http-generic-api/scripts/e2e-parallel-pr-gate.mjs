#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export { resolveParallelMaintenanceScope } from "./e2e-parallel-pr-gate-legacy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const LEGACY_GATE = path.join(HERE, "e2e-parallel-pr-gate-legacy.mjs");
const CERTIFIED_RELEASE_CUT_REF = /^release\/production-candidate-([0-9a-f]{12})-([0-9a-f]{12})-([1-9]\d*)-([1-9]\d*)$/;

export function parseCertifiedReleaseCutRef(headRef) {
  const match = CERTIFIED_RELEASE_CUT_REF.exec(String(headRef || ""));
  if (!match) return null;
  return Object.freeze({
    release_cut_prefix: match[1],
    production_prefix: match[2],
    launcher_run_id: match[3],
    launcher_run_attempt: match[4]
  });
}

function parseArgs(argv) {
  const options = {
    root: REPO_ROOT,
    base: null,
    head: "HEAD",
    headRef: process.env.GITHUB_HEAD_REF || "",
    baseRef: process.env.GITHUB_BASE_REF || "",
    reportFile: null,
    githubOutput: process.env.GITHUB_OUTPUT || null,
    passthroughFlags: []
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
    else if (arg === "--report-file") options.reportFile = read();
    else if (arg.startsWith("--report-file=")) options.reportFile = arg.slice(14);
    else if (arg === "--github-output") options.githubOutput = read();
    else if (arg.startsWith("--github-output=")) options.githubOutput = arg.slice(16);
    else if (arg === "check" || arg === "--ci" || arg === "--changed") options.passthroughFlags.push(arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function runGit(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout || "").trim();
}

function resolveParents(root, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha || "")) return [];
  const value = runGit(root, ["show", "-s", "--format=%P", sha]);
  if (value == null || !value) return [];
  const parents = value.split(/\s+/);
  return parents.every((parent) => /^[0-9a-f]{40}$/.test(parent)) ? parents : [];
}

function resolveTree(root, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha || "")) return null;
  const value = runGit(root, ["rev-parse", "--verify", `${sha}^{tree}`]);
  return /^[0-9a-f]{40}$/.test(value || "") ? value : null;
}

function isAncestor(root, ancestor, descendant) {
  if (!/^[0-9a-f]{40}$/.test(ancestor || "") || !/^[0-9a-f]{40}$/.test(descendant || "")) return false;
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: root,
    stdio: "ignore"
  });
  return !result.error && result.status === 0;
}

function resolveLiveProtectedSha(root, name) {
  const token = String(process.env.GITHUB_TOKEN_FOR_REF_LOOKUP || "").trim();
  if (token) {
    const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return null;
    const childEnv = { ...process.env, GH_TOKEN: token };
    delete childEnv.GITHUB_TOKEN_FOR_REF_LOOKUP;
    const result = spawnSync(
      "gh",
      ["api", `repos/${repository}/git/ref/heads/${name}`, "--jq", ".object.sha"],
      {
        cwd: root,
        encoding: "utf8",
        env: childEnv,
        stdio: ["ignore", "pipe", "ignore"]
      }
    );
    if (result.error || result.status !== 0) return null;
    const sha = String(result.stdout || "").trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  }

  const result = spawnSync("git", ["ls-remote", "--heads", "origin", `refs/heads/${name}`], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.error || result.status !== 0) return null;
  const rows = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  if (rows.length !== 1) return null;
  const [row] = rows;
  const [sha, ref] = row.trim().split(/\s+/);
  if (!/^[0-9a-f]{40}$/.test(sha || "") || ref !== `refs/heads/${name}`) return null;
  return sha;
}

function remoteAncestorProof(root, ancestor, descendant) {
  if (ancestor === descendant) return true;
  if (isAncestor(root, ancestor, descendant)) return true;

  const token = String(process.env.GITHUB_TOKEN_FOR_REF_LOOKUP || "").trim();
  const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
  if (!token || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return false;

  const childEnv = { ...process.env, GH_TOKEN: token };
  delete childEnv.GITHUB_TOKEN_FOR_REF_LOOKUP;
  const result = spawnSync(
    "gh",
    ["api", `repos/${repository}/compare/${ancestor}...${descendant}`],
    {
      cwd: root,
      encoding: "utf8",
      env: childEnv,
      stdio: ["ignore", "pipe", "ignore"]
    }
  );
  if (result.error || result.status !== 0) return false;
  try {
    const payload = JSON.parse(String(result.stdout || "{}"));
    return Number(payload.behind_by) === 0 && (payload.status === "ahead" || payload.status === "identical");
  } catch {
    return false;
  }
}

export function validateCertifiedReleaseCutCandidate({ root, headRef, baseRef, headSha, baseSha }) {
  const ref = parseCertifiedReleaseCutRef(headRef);
  if (!ref || baseRef !== "Production") return Object.freeze({ ok: false, reason: "unsupported_ref" });
  if (!/^[0-9a-f]{40}$/.test(headSha || "") || !/^[0-9a-f]{40}$/.test(baseSha || "")) {
    return Object.freeze({ ok: false, reason: "invalid_sha" });
  }

  const liveMainSha = resolveLiveProtectedSha(root, "main");
  const liveProductionSha = resolveLiveProtectedSha(root, "Production");
  if (!liveMainSha || !liveProductionSha) return Object.freeze({ ok: false, reason: "protected_ref_unavailable" });
  if (liveProductionSha !== baseSha || !liveProductionSha.startsWith(ref.production_prefix)) {
    return Object.freeze({ ok: false, reason: "production_ref_moved" });
  }

  const parents = resolveParents(root, headSha);
  if (parents.length !== 2) return Object.freeze({ ok: false, reason: "candidate_parent_count" });
  const [releaseCutSha, productionParentSha] = parents;
  if (!releaseCutSha.startsWith(ref.release_cut_prefix)) {
    return Object.freeze({ ok: false, reason: "release_cut_prefix_mismatch" });
  }
  if (productionParentSha !== baseSha) return Object.freeze({ ok: false, reason: "production_parent_mismatch" });

  const headTree = resolveTree(root, headSha);
  const releaseCutTree = resolveTree(root, releaseCutSha);
  if (!headTree || !releaseCutTree || headTree !== releaseCutTree) {
    return Object.freeze({ ok: false, reason: "candidate_tree_mismatch" });
  }
  if (!isAncestor(root, baseSha, releaseCutSha)) {
    return Object.freeze({ ok: false, reason: "production_not_in_release_cut" });
  }
  if (!remoteAncestorProof(root, releaseCutSha, liveMainSha)) {
    return Object.freeze({ ok: false, reason: "release_cut_not_in_current_main" });
  }

  return Object.freeze({
    ok: true,
    releaseCutSha,
    liveMainSha,
    liveProductionSha,
    launcherRunId: ref.launcher_run_id,
    launcherRunAttempt: ref.launcher_run_attempt
  });
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

function delegateLegacy(argv) {
  const result = spawnSync(process.execPath, [LEGACY_GATE, ...argv], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"]
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.error ? 1 : (result.status ?? 1);
}

function invokeCertifiedReleaseCutAdapter(options, validation) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-certified-release-cut-"));
  try {
    execFileSync("git", ["clone", "--quiet", "--shared", "--no-checkout", options.root, temporaryRoot], {
      cwd: options.root,
      stdio: "ignore"
    });
    execFileSync("git", ["checkout", "--quiet", "--detach", options.head], { cwd: temporaryRoot, stdio: "ignore" });
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", validation.releaseCutSha], { cwd: temporaryRoot, stdio: "ignore" });
    execFileSync("git", ["update-ref", "refs/heads/main", validation.releaseCutSha], { cwd: temporaryRoot, stdio: "ignore" });
    execFileSync("git", ["update-ref", "refs/remotes/origin/Production", options.base], { cwd: temporaryRoot, stdio: "ignore" });

    const legacyArgs = [
      "--root", temporaryRoot,
      "--base", options.base,
      "--head", options.head,
      "--head-ref", `release/production-candidate-${options.head.slice(0, 8)}`,
      "--base-ref", "Production",
      ...options.passthroughFlags
    ];
    const childEnv = { ...process.env, GITHUB_OUTPUT: "" };
    const result = spawnSync(process.execPath, [LEGACY_GATE, ...legacyArgs], {
      cwd: process.cwd(),
      env: childEnv,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"]
    });
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error || result.status !== 0) {
      if (result.stdout) process.stdout.write(result.stdout);
      return result.error ? 1 : (result.status ?? 1);
    }

    let report;
    try {
      report = JSON.parse(String(result.stdout || "{}"));
    } catch {
      if (result.stdout) process.stdout.write(result.stdout);
      process.stderr.write("Certified release-cut adapter could not parse legacy classifier output.\n");
      return 1;
    }

    report.production_promotion = true;
    report.production_promotion_identity = "certified_release_cut_reconciliation";
    report.phase_evaluation_base = validation.releaseCutSha;
    report.production_promotion_anchor_sha = options.head;
    report.production_promotion_rearm_depth = 0;
    report.production_release_cut_sha = validation.releaseCutSha;
    report.production_release_cut_current_main_sha = validation.liveMainSha;
    report.production_release_cut_mode = true;
    report.production_ref_stable = true;
    report.main_tip_may_advance = true;

    writeAtomic(options.reportFile, report);
    writeOutputs(options.githubOutput, {
      mode: report.pr_mode || "standard",
      feature_key: report.feature_key || "",
      contract_path: report.contract_path || "",
      workstream_id: report.workstream_id || "",
      production_promotion: true,
      production_promotion_identity: report.production_promotion_identity,
      phase_evaluation_base: validation.releaseCutSha,
      production_promotion_anchor_sha: options.head,
      production_promotion_rearm_depth: 0,
      production_release_cut_sha: validation.releaseCutSha,
      production_release_cut_current_main_sha: validation.liveMainSha,
      production_release_cut_mode: true,
      production_ref_stable: true,
      main_tip_may_advance: true
    });
    console.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Certified release-cut adapter failed closed: ${error?.message || String(error)}\n`);
    return 1;
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function main() {
  const argv = process.argv.slice(2);
  const options = parseArgs(argv);
  const ref = parseCertifiedReleaseCutRef(options.headRef);
  if (!ref || options.baseRef !== "Production") process.exit(delegateLegacy(argv));

  const validation = validateCertifiedReleaseCutCandidate({
    root: options.root,
    headRef: options.headRef,
    baseRef: options.baseRef,
    headSha: options.head,
    baseSha: options.base
  });
  if (!validation.ok) process.exit(delegateLegacy(argv));
  process.exit(invokeCertifiedReleaseCutAdapter(options, validation));
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) main();
