#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateParallelWork } from "./e2e-parallel-work-governance.mjs";
import { matchesPattern } from "./e2e-phase-governance.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const PARALLEL_MAINTENANCE_CONTEXT_ARTIFACTS = new Set(["work-map-integration.json"]);
const MAX_PRODUCTION_PROMOTION_REARM_DEPTH = 4;

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

function normalize(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function resolveParallelMaintenanceSummaries({ root, changedFiles, policy, parallelSummaries }) {
  const summariesByPath = new Map(
    parallelSummaries.map((summary) => [normalize(summary.contract_path), summary])
  );
  const specRoot = normalize(policy.spec_root).replace(/\/+$/, "");
  const specPrefix = `${specRoot}/`;

  for (const rawFile of changedFiles) {
    const file = normalize(rawFile);
    if (!file.startsWith(specPrefix)) continue;
    const [feature, ...relativeParts] = file.slice(specPrefix.length).split("/");
    const relativePath = relativeParts.join("/");
    if (!feature || !PARALLEL_MAINTENANCE_CONTEXT_ARTIFACTS.has(relativePath)) continue;

    const contractPath = normalize(path.posix.join(specRoot, feature, policy.spec_contract_file));
    if (summariesByPath.has(contractPath)) continue;
    const absolute = path.join(root, contractPath);
    if (!fs.existsSync(absolute)) continue;
    const contract = readJson(absolute);
    if (contract.parallel_work?.enabled !== true) continue;
    summariesByPath.set(contractPath, {
      feature_key: contract.feature_key || feature,
      contract_path: contractPath
    });
  }

  return [...summariesByPath.values()].sort((left, right) =>
    normalize(left.contract_path).localeCompare(normalize(right.contract_path))
  );
}

function resolveSinglePrMaintenanceContract({ root, changedFiles, runtimeFiles, policy, parallelSummaries, baseRef }) {
  if (baseRef !== "main" || !runtimeFiles.length || !parallelSummaries.length) return null;

  const allParallelContractsIntegrated = parallelSummaries.every((summary) => {
    const contract = readJson(path.join(root, summary.contract_path));
    const currentPhase = (contract.phases || []).find((phase) => phase.id === contract.current_phase);
    const workstreams = new Map((contract.parallel_work?.workstreams || []).map((row) => [row.id, row]));
    const requiredWorkstreams = contract.parallel_work?.integration?.required_workstreams || [];
    return currentPhase?.status === "implemented"
      && requiredWorkstreams.length > 0
      && requiredWorkstreams.every((id) => workstreams.get(id)?.status === "integrated");
  });
  if (!allParallelContractsIntegrated) return null;

  const contractRoot = normalize(policy.non_spec_contract_root || ".changes/e2e").replace(/\/+$/, "");
  const candidates = changedFiles
    .filter((file) => file.startsWith(`${contractRoot}/`) && file.endsWith(".json"))
    .sort();

  const matches = [];
  for (const contractPath of candidates) {
    const absolute = path.join(root, contractPath);
    if (!fs.existsSync(absolute)) continue;
    const contract = readJson(absolute);
    const currentPhase = (contract.phases || []).find((phase) => phase.id === contract.current_phase);
    const scope = contract.scope?.include || [];
    if (
      contract.delivery_mode === "single_pr"
      && currentPhase?.status === "implemented"
      && contract.secrets_included === false
      && Array.isArray(scope)
      && runtimeFiles.every((file) => scope.some((pattern) => matchesPattern(file, pattern)))
    ) {
      matches.push({
        feature_key: contract.feature_key || null,
        contract_path: contractPath,
        runtime_files: runtimeFiles
      });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function resolveCanonicalMainRef(root) {
  const mainRef = "refs/remotes/origin/main";
  const result = spawnSync("git", ["rev-parse", "--verify", `${mainRef}^{commit}`], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.error || result.status !== 0) return null;
  return mainRef;
}

function resolveLiveProtectedSha(root, name) {
  const result = spawnSync("git", ["ls-remote", "--heads", "origin", `refs/heads/${name}`], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.error || result.status !== 0) return null;
  const output = String(result.stdout || "").trim();
  const rows = output.split(/\r?\n/).filter(Boolean);
  if (rows.length !== 1) return null;
  const [onlyRow] = rows;
  const [sha, ref] = onlyRow.trim().split(/\s+/);
  if (!/^[0-9a-f]{40}$/.test(sha) || ref !== `refs/heads/${name}`) return null;
  return sha;
}

function isAncestor(root, ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: root,
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}

function resolveFirstParent(root, headSha) {
  if (!/^[0-9a-f]{40}$/.test(headSha)) return null;
  try {
    const value = execFileSync("git", ["rev-parse", "--verify", `${headSha}^1`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return /^[0-9a-f]{40}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function resolveCommit(root, ref) {
  if (!ref) return null;
  try {
    const value = execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return /^[0-9a-f]{40}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function resolveTree(root, ref) {
  if (!ref) return null;
  try {
    const value = execFileSync("git", ["rev-parse", "--verify", `${ref}^{tree}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return /^[0-9a-f]{40}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function resolveParents(root, headSha) {
  if (!/^[0-9a-f]{40}$/.test(headSha)) return [];
  try {
    const value = execFileSync("git", ["show", "-s", "--format=%P", headSha], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (!value) return [];
    const parents = value.split(/\s+/);
    return parents.every((parent) => /^[0-9a-f]{40}$/.test(parent)) ? parents : [];
  } catch {
    return [];
  }
}

function parseProductionCandidateRef(headRef) {
  const bridge = /^release\/production-candidate-([0-9a-f]{12})-([0-9a-f]{12})-bridge-([1-9]\d*)$/.exec(headRef);
  if (bridge) {
    return {
      kind: "governed_dispatch_bridge",
      main_prefix: bridge[1],
      production_prefix: bridge[2],
      dispatch_run_id: bridge[3]
    };
  }

  const shaBound = /^release\/production-candidate-(?:\d{8}-)?([0-9a-f]{8})(?:-v[1-9]\d*)?$/.exec(headRef);
  if (shaBound) {
    return {
      kind: "sha_bound",
      candidate_prefix: shaBound[1]
    };
  }
  return null;
}

function resolveProductionReconciliationAnchor({ root, headSha, mainSha, baseSha, mainTree }) {
  let current = headSha;
  for (let depth = 0; depth <= MAX_PRODUCTION_PROMOTION_REARM_DEPTH; depth += 1) {
    const currentTree = resolveTree(root, current);
    if (!currentTree || currentTree !== mainTree) return null;

    const parents = resolveParents(root, current);
    if (parents.length === 2 && parents[0] === mainSha && parents[1] === baseSha) {
      return { anchor_sha: current, rearm_depth: depth };
    }
    if (parents.length !== 1) return null;
    current = parents[0];
  }
  return null;
}

function classifyProductionPromotion({ root, headRef, baseRef, headSha, baseSha }) {
  if (headRef === "main" && baseRef === "Production") {
    return { allowed: true, identity: "protected_main", phase_evaluation_base: resolveFirstParent(root, headSha) };
  }
  if (baseRef !== "Production") return { allowed: false, identity: null, phase_evaluation_base: null };
  if (!/^[0-9a-f]{40}$/.test(headSha || "") || !/^[0-9a-f]{40}$/.test(baseSha || "")) {
    return { allowed: false, identity: null, phase_evaluation_base: null };
  }

  const candidateRef = parseProductionCandidateRef(headRef);
  if (!candidateRef) return { allowed: false, identity: null, phase_evaluation_base: null };

  const mainRef = resolveCanonicalMainRef(root);
  if (!mainRef) return { allowed: false, identity: null, phase_evaluation_base: null };
  const mainSha = resolveCommit(root, mainRef);
  const mainTree = resolveTree(root, mainRef);
  if (!mainSha || !mainTree) return { allowed: false, identity: null, phase_evaluation_base: null };

  if (candidateRef.kind === "governed_dispatch_bridge") {
    const liveMainSha = resolveLiveProtectedSha(root, "main");
    const liveProductionSha = resolveLiveProtectedSha(root, "Production");
    if (
      !liveMainSha
      || liveMainSha !== mainSha
      || !liveProductionSha
      || liveProductionSha !== baseSha
      || !liveMainSha.startsWith(candidateRef.main_prefix)
      || !liveProductionSha.startsWith(candidateRef.production_prefix)
    ) {
      return { allowed: false, identity: null, phase_evaluation_base: null };
    }
    const reconciliation = resolveProductionReconciliationAnchor({ root, headSha, mainSha, baseSha, mainTree });
    if (!reconciliation) return { allowed: false, identity: null, phase_evaluation_base: null };
    return {
      allowed: true,
      identity: "history_preserving_main_reconciliation",
      phase_evaluation_base: mainSha,
      promotion_anchor_sha: reconciliation.anchor_sha,
      rearm_depth: reconciliation.rearm_depth
    };
  }

  if (!headSha.startsWith(candidateRef.candidate_prefix)) {
    return { allowed: false, identity: null, phase_evaluation_base: null };
  }
  if (isAncestor(root, headSha, mainRef)) {
    return {
      allowed: true,
      identity: "immutable_main_snapshot",
      phase_evaluation_base: resolveFirstParent(root, headSha),
      promotion_anchor_sha: headSha,
      rearm_depth: 0
    };
  }

  const headTree = resolveTree(root, headSha);
  const parents = resolveParents(root, headSha);
  if (
    !headTree
    || parents.length !== 2
    || parents[0] !== mainSha
    || parents[1] !== baseSha
    || headTree !== mainTree
  ) {
    return { allowed: false, identity: null, phase_evaluation_base: null };
  }
  return {
    allowed: true,
    identity: "history_preserving_main_reconciliation",
    phase_evaluation_base: mainSha,
    promotion_anchor_sha: headSha,
    rearm_depth: 0
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

  const promotion = classifyProductionPromotion({
    root: options.root,
    headRef: options.headRef,
    baseRef: options.baseRef,
    headSha: options.head,
    baseSha: options.base
  });
  const productionPromotion = promotion.allowed;
  const phaseEvaluationBase = productionPromotion ? promotion.phase_evaluation_base : null;
  if (productionPromotion && !phaseEvaluationBase) {
    addFinding(report, "production_promotion_phase_evaluation_base_unavailable", {
      head_sha: options.head,
      promotion_identity: promotion.identity
    });
  }
  if (options.baseRef === "Production" && !productionPromotion) {
    addFinding(report, "production_promotion_identity_invalid", {
      head_ref: options.headRef || null,
      head_sha: options.head || null,
      base_sha: options.base || null
    });
  }

  const active = [];
  const integrations = [];
  for (const summary of report.contracts) {
    const contract = readJson(path.join(options.root, summary.contract_path));
    const parallel = contract.parallel_work;
    if (summary.active_workstream) {
      const workstream = parallel.workstreams.find((row) => row.id === summary.active_workstream);
      active.push({ summary, contract, workstream });
      if (!productionPromotion && options.baseRef && !matchesPattern(options.baseRef, parallel.integration.branch_pattern)) {
        addFinding(report, "parallel_work_workstream_must_target_integration_branch", {
          feature_key: contract.feature_key,
          workstream_id: workstream.id,
          base_ref: options.baseRef,
          required_pattern: parallel.integration.branch_pattern
        });
      }
      if (!productionPromotion && workstream.status !== "ready_for_integration") {
        addFinding(report, "parallel_work_pr_workstream_not_ready_for_integration", {
          feature_key: contract.feature_key,
          workstream_id: workstream.id,
          status: workstream.status
        });
      }
    }
    if (summary.integration_active) integrations.push({ summary, contract });
  }

  if (!productionPromotion && active.length > 1) addFinding(report, "parallel_work_pr_must_have_single_active_workstream", { active: active.map((row) => `${row.contract.feature_key}:${row.workstream.id}`) });
  if (!productionPromotion && integrations.length > 1) addFinding(report, "parallel_work_pr_must_have_single_integration_contract", { active: integrations.map((row) => row.contract.feature_key) });
  if (!productionPromotion && active.length && integrations.length) addFinding(report, "parallel_work_pr_cannot_be_workstream_and_integration", {});

  const defaultBranchSync = options.headRef === "main"
    && Boolean(options.baseRef)
    && options.baseRef !== "Production";

  let mode = "standard";
  let featureKey = "";
  let contractPath = "";
  let workstreamId = "";
  let singlePrMaintenanceContract = null;
  if (defaultBranchSync) {
    mode = "default_branch_sync";
  } else if (!productionPromotion && active.length === 1) {
    mode = "workstream";
    featureKey = active[0].contract.feature_key;
    contractPath = active[0].summary.contract_path;
    workstreamId = active[0].workstream.id;
  } else if (!productionPromotion && integrations.length === 1) {
    mode = "integration";
    featureKey = integrations[0].contract.feature_key;
    contractPath = integrations[0].summary.contract_path;
  } else if (options.baseRef && options.headRef && !options.headRef.startsWith("gh-readonly-queue/") && !productionPromotion) {
    const policy = readJson(path.join(options.root, ".specify", "e2e-phase-governance.json"));
    const runtimeFiles = report.changed_files.filter((file) =>
      policy.runtime_patterns.some((pattern) => matchesPattern(file, pattern))
    );
    const maintenanceParallelSummaries = resolveParallelMaintenanceSummaries({
      root: options.root,
      changedFiles: report.changed_files,
      policy,
      parallelSummaries: report.contracts
    });
    if (maintenanceParallelSummaries.length) {
      singlePrMaintenanceContract = resolveSinglePrMaintenanceContract({
        root: options.root,
        changedFiles: report.changed_files,
        runtimeFiles,
        policy,
        parallelSummaries: maintenanceParallelSummaries,
        baseRef: options.baseRef
      });
      if (runtimeFiles.length && !singlePrMaintenanceContract) {
        addFinding(report, "parallel_work_pr_branch_not_declared", {
          head_ref: options.headRef,
          contracts: maintenanceParallelSummaries.map((row) => row.feature_key)
        });
      }
    }
  }

  report.pr_mode = mode;
  report.feature_key = featureKey || null;
  report.contract_path = contractPath || null;
  report.workstream_id = workstreamId || null;
  report.single_pr_maintenance_contract = singlePrMaintenanceContract;
  report.base_ref = options.baseRef || null;
  report.production_promotion = productionPromotion;
  report.production_promotion_identity = promotion.identity;
  report.phase_evaluation_base = phaseEvaluationBase;
  report.production_promotion_anchor_sha = promotion.promotion_anchor_sha || null;
  report.production_promotion_rearm_depth = Number.isInteger(promotion.rearm_depth) ? promotion.rearm_depth : null;
  writeAtomic(options.reportFile, report);
  writeOutputs(options.githubOutput, {
    mode,
    feature_key: featureKey,
    contract_path: contractPath,
    workstream_id: workstreamId,
    production_promotion: productionPromotion,
    production_promotion_identity: promotion.identity || "",
    phase_evaluation_base: phaseEvaluationBase || "",
    production_promotion_anchor_sha: promotion.promotion_anchor_sha || "",
    production_promotion_rearm_depth: Number.isInteger(promotion.rearm_depth) ? promotion.rearm_depth : ""
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main();
