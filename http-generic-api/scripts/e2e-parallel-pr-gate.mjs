#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateParallelWork } from "./e2e-parallel-work-governance.mjs";
import { matchesPattern } from "./e2e-phase-governance.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const PARALLEL_MAINTENANCE_CONTEXT_ARTIFACTS = new Set(["work-map-integration.json"]);

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
  for (const candidate of ["refs/remotes/origin/main", "refs/heads/main", "main"]) {
    try {
      execFileSync("git", ["rev-parse", "--verify", `${candidate}^{commit}`], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      return candidate;
    } catch {}
  }
  return null;
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


const DEFAULT_BRANCH_SYNC_GENERATED_RESOLUTION_PATTERNS = [
  /^docs\/work-maps\/[^/]+\.md$/,
  /^http-generic-api\/frontend-(?:operation-governance|surface-dispatch)\.generated\.json$/,
  /^specs\/[^/]+\/work-map-integration\.json$/
];

function changedFilesForRange(root, range) {
  try {
    return execFileSync("git", ["diff", "--name-only", range], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).split(/\r?\n/).map(normalize).filter(Boolean);
  } catch {
    return [];
  }
}

function resolveBlob(root, ref, file) {
  if (!ref || !file) return null;
  try {
    const value = execFileSync("git", ["rev-parse", "--verify", ref + ":" + file], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return /^[0-9a-f]{40}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function isGeneratedReconciliationPath(file) {
  const normalized = normalize(file);
  return DEFAULT_BRANCH_SYNC_GENERATED_RESOLUTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function classifyDefaultBranchSynchronization({ root, headRef, baseRef, headSha, baseSha, changedFiles }) {
  if (headRef === "main" && Boolean(baseRef) && baseRef !== "Production") {
    return { allowed: true, identity: "protected_main" };
  }
  if (
    !/^gpt\/reconcile\/[A-Za-z0-9._/-]+$/.test(headRef || "") ||
    !baseRef ||
    baseRef === "main" ||
    baseRef === "Production" ||
    !/^[0-9a-f]{40}$/.test(headSha || "") ||
    !/^[0-9a-f]{40}$/.test(baseSha || "")
  ) {
    return { allowed: false, identity: null };
  }

  const mainRef = resolveCanonicalMainRef(root);
  const mainSha = resolveCommit(root, mainRef);
  const parents = resolveParents(root, headSha);
  if (
    !mainSha ||
    parents.length !== 2 ||
    parents[1] !== mainSha ||
    !isAncestor(root, baseSha, parents[0]) ||
    !isAncestor(root, baseSha, headSha) ||
    !isAncestor(root, mainSha, headSha)
  ) {
    return { allowed: false, identity: null, main_sha: mainSha };
  }

  const normalizedChangedFiles = [...new Set((changedFiles || []).map(normalize).filter(Boolean))].sort();
  const mainDelta = new Set(changedFilesForRange(root, baseSha + "..." + mainSha));
  const unexpectedFiles = normalizedChangedFiles.filter((file) => !mainDelta.has(file));
  const novelResolutionFiles = normalizedChangedFiles.filter((file) => {
    const headBlob = resolveBlob(root, headSha, file);
    const mainBlob = resolveBlob(root, mainSha, file);
    const firstParentBlob = resolveBlob(root, parents[0], file);
    return headBlob !== mainBlob && headBlob !== firstParentBlob;
  });
  const unsafeResolutionFiles = novelResolutionFiles.filter((file) => !isGeneratedReconciliationPath(file));
  if (!mainDelta.size || unexpectedFiles.length || unsafeResolutionFiles.length) {
    return {
      allowed: false,
      identity: null,
      main_sha: mainSha,
      unexpected_files: unexpectedFiles,
      unsafe_resolution_files: unsafeResolutionFiles
    };
  }
  return {
    allowed: true,
    identity: "history_preserving_feature_branch_main_sync",
    main_sha: mainSha,
    synchronized_file_count: normalizedChangedFiles.length,
    generated_resolution_files: novelResolutionFiles
  };
}

function classifyProductionPromotion({ root, headRef, baseRef, headSha, baseSha }) {
  if (headRef === "main" && baseRef === "Production") {
    return { allowed: true, identity: "protected_main" };
  }
  if (baseRef !== "Production") return { allowed: false, identity: null };

  const match = /^release\/production-candidate-(?:\d{8}-)?([0-9a-f]{8})(?:-v[1-9]\d*)?$/.exec(headRef);
  if (!match) return { allowed: false, identity: null };
  if (!/^[0-9a-f]{40}$/.test(headSha) || !headSha.startsWith(match[1])) {
    return { allowed: false, identity: null };
  }

  const mainRef = resolveCanonicalMainRef(root);
  if (!mainRef) return { allowed: false, identity: null };
  if (isAncestor(root, headSha, mainRef)) {
    return { allowed: true, identity: "immutable_main_snapshot" };
  }

  const mainSha = resolveCommit(root, mainRef);
  const mainTree = resolveTree(root, mainRef);
  const headTree = resolveTree(root, headSha);
  const parents = resolveParents(root, headSha);
  if (
    !mainSha ||
    !mainTree ||
    !headTree ||
    !/^[0-9a-f]{40}$/.test(baseSha || "") ||
    parents.length !== 2 ||
    parents[0] !== mainSha ||
    parents[1] !== baseSha ||
    headTree !== mainTree
  ) {
    return { allowed: false, identity: null };
  }
  return { allowed: true, identity: "history_preserving_main_reconciliation" };
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
  const phaseEvaluationBase = productionPromotion ? resolveFirstParent(options.root, options.head) : null;
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

  const defaultBranchSynchronization = classifyDefaultBranchSynchronization({
    root: options.root,
    headRef: options.headRef,
    baseRef: options.baseRef,
    headSha: options.head,
    baseSha: options.base,
    changedFiles: report.changed_files
  });
  const defaultBranchSync = defaultBranchSynchronization.allowed;

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
  report.default_branch_sync_identity = defaultBranchSynchronization.identity;
  report.default_branch_sync_main_sha = defaultBranchSynchronization.main_sha || null;
  report.default_branch_sync_unexpected_files = defaultBranchSynchronization.unexpected_files || [];
  report.default_branch_sync_unsafe_resolution_files = defaultBranchSynchronization.unsafe_resolution_files || [];
  report.default_branch_sync_generated_resolution_files = defaultBranchSynchronization.generated_resolution_files || [];
  writeAtomic(options.reportFile, report);
  writeOutputs(options.githubOutput, {
    mode,
    feature_key: featureKey,
    contract_path: contractPath,
    workstream_id: workstreamId,
    production_promotion: productionPromotion,
    production_promotion_identity: promotion.identity || "",
    phase_evaluation_base: phaseEvaluationBase || ""
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main();
