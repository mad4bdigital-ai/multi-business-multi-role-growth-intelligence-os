#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchesPattern } from "./e2e-phase-governance.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const VALID_STATUSES = new Set(["planned", "in_progress", "blocked", "ready_for_integration", "integrated"]);
const READY_STATUSES = new Set(["ready_for_integration", "integrated"]);
const VALID_OWNER_TYPES = new Set(["human", "ai_agent", "mixed", "unassigned"]);
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

function normalize(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function changedFilesFromGit(root, base, head = "HEAD") {
  const candidates = [
    base ? `${base}...${head}` : null,
    process.env.GITHUB_BASE_SHA ? `${process.env.GITHUB_BASE_SHA}...${process.env.GITHUB_HEAD_SHA || head}` : null,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}...${head}` : null,
    "origin/main...HEAD",
    "HEAD~1...HEAD"
  ].filter(Boolean);
  for (const range of candidates) {
    try {
      return execFileSync("git", ["diff", "--name-only", range], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).split(/\r?\n/).map(normalize).filter(Boolean);
    } catch {}
  }
  return [];
}

function addFinding(findings, code, details = {}) {
  findings.push({ code, ...details });
}

function validText(value, minimum = 3) {
  return typeof value === "string" && value.trim().length >= minimum;
}

function specKeyFromFile(file, policy) {
  const prefix = `${normalize(policy.spec_root)}/`;
  const normalized = normalize(file);
  if (!normalized.startsWith(prefix)) return null;
  return normalized.slice(prefix.length).split("/")[0] || null;
}

function discoverContractPaths(changedFiles, policy) {
  const paths = new Set();
  for (const file of changedFiles) {
    const feature = specKeyFromFile(file, policy);
    if (feature) paths.add(normalize(path.posix.join(policy.spec_root, feature, policy.spec_contract_file)));
    if (file.endsWith(`/${policy.spec_contract_file}`)) paths.add(file);
    if (file.startsWith(`${normalize(policy.non_spec_contract_root)}/`) && file.endsWith(".json")) paths.add(file);
  }
  return [...paths].sort();
}

function patternPrefix(pattern) {
  const normalized = normalize(pattern);
  const wildcard = normalized.search(/[?*]/);
  return wildcard < 0 ? normalized : normalized.slice(0, wildcard);
}

function patternsMayOverlap(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return true;
  if (!/[?*]/.test(a) && matchesPattern(a, b)) return true;
  if (!/[?*]/.test(b) && matchesPattern(b, a)) return true;
  const aPrefix = patternPrefix(a);
  const bPrefix = patternPrefix(b);
  return Boolean(aPrefix && bPrefix && (aPrefix.startsWith(bPrefix) || bPrefix.startsWith(aPrefix)));
}

function declaredOverlapFor(overlaps, leftId, rightId, file = null) {
  return overlaps.some((row) => {
    const workstreams = new Set(row.workstreams || []);
    if (!workstreams.has(leftId) || !workstreams.has(rightId)) return false;
    return !file || (row.patterns || []).some((pattern) => matchesPattern(file, pattern));
  });
}

function validateDag(workstreams, findings, featureKey) {
  const byId = new Map(workstreams.map((row) => [row.id, row]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, trail = []) => {
    if (visiting.has(id)) {
      addFinding(findings, "parallel_work_dependency_cycle", { feature_key: featureKey, cycle: [...trail, id] });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const row = byId.get(id);
    for (const dependency of row?.depends_on || []) visit(dependency, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
}

function isAncestor(root, commit, head = "HEAD") {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, head], {
      cwd: root,
      stdio: ["ignore", "ignore", "ignore"]
    });
    return true;
  } catch {
    return false;
  }
}

function validateTestDescriptor(test, findings, context) {
  const { featureKey, location } = context;
  if (!test || typeof test !== "object") {
    addFinding(findings, "parallel_work_invalid_test_descriptor", { feature_key: featureKey, location });
    return;
  }
  if (!validText(test.id)) addFinding(findings, "parallel_work_missing_test_id", { feature_key: featureKey, location });
  if (!["node", "npm"].includes(test.runner)) addFinding(findings, "parallel_work_invalid_test_runner", { feature_key: featureKey, location, runner: test.runner });
  if (!validText(test.working_directory, 1)) addFinding(findings, "parallel_work_missing_test_working_directory", { feature_key: featureKey, location });
  if (test.runner === "node" && !validText(test.path, 1)) addFinding(findings, "parallel_work_missing_node_test_path", { feature_key: featureKey, location });
  if (test.runner === "npm" && !/^[A-Za-z0-9:_-]+$/.test(test.script || "")) addFinding(findings, "parallel_work_invalid_npm_script", { feature_key: featureKey, location });
  if (!Array.isArray(test.args || [])) addFinding(findings, "parallel_work_invalid_test_args", { feature_key: featureKey, location });
}

function validateParallelContract(contract, contractPath, context) {
  const { root, changedFiles, policy, headRef, headSha, findings } = context;
  const featureKey = contract.feature_key || contractPath;
  const parallel = contract.parallel_work;
  if (!parallel?.enabled) return null;

  if (parallel.strategy !== "dependency_dag") addFinding(findings, "parallel_work_strategy_must_be_dependency_dag", { feature_key: featureKey });
  if (parallel.file_ownership !== "exclusive_by_default") addFinding(findings, "parallel_work_file_ownership_must_be_exclusive", { feature_key: featureKey });
  if (parallel.merge_policy !== "workstream_commits_then_e2e_rollup") addFinding(findings, "parallel_work_invalid_merge_policy", { feature_key: featureKey });
  if (parallel.no_partial_feature_merge !== true) addFinding(findings, "parallel_work_partial_feature_merge_must_be_forbidden", { feature_key: featureKey });

  const workstreams = Array.isArray(parallel.workstreams) ? parallel.workstreams : [];
  if (workstreams.length < 2) addFinding(findings, "parallel_work_requires_multiple_workstreams", { feature_key: featureKey });
  const ids = workstreams.map((row) => row?.id).filter(Boolean);
  const duplicateIds = ids.filter((value, index) => ids.indexOf(value) !== index);
  if (duplicateIds.length) addFinding(findings, "parallel_work_duplicate_workstream_ids", { feature_key: featureKey, values: [...new Set(duplicateIds)] });
  const idSet = new Set(ids);
  const byId = new Map(workstreams.filter((row) => validText(row?.id)).map((row) => [row.id, row]));
  const overlaps = Array.isArray(parallel.declared_overlaps) ? parallel.declared_overlaps : [];

  for (const row of overlaps) {
    if (!validText(row.id)) addFinding(findings, "parallel_work_overlap_missing_id", { feature_key: featureKey });
    if (!Array.isArray(row.workstreams) || row.workstreams.length < 2 || row.workstreams.some((id) => !idSet.has(id))) {
      addFinding(findings, "parallel_work_overlap_invalid_workstreams", { feature_key: featureKey, overlap_id: row.id });
    }
    if (!Array.isArray(row.patterns) || !row.patterns.length) addFinding(findings, "parallel_work_overlap_missing_patterns", { feature_key: featureKey, overlap_id: row.id });
    if (!validText(row.reason)) addFinding(findings, "parallel_work_overlap_missing_reason", { feature_key: featureKey, overlap_id: row.id });
    if (!validText(row.coordinator)) addFinding(findings, "parallel_work_overlap_missing_coordinator", { feature_key: featureKey, overlap_id: row.id });
  }

  for (const row of workstreams) {
    const id = row?.id;
    if (!validText(id)) {
      addFinding(findings, "parallel_work_missing_workstream_id", { feature_key: featureKey });
      continue;
    }
    if (!validText(row.title)) addFinding(findings, "parallel_work_missing_workstream_title", { feature_key: featureKey, workstream_id: id });
    if (!VALID_STATUSES.has(row.status)) addFinding(findings, "parallel_work_invalid_workstream_status", { feature_key: featureKey, workstream_id: id, status: row.status });
    if (!VALID_OWNER_TYPES.has(row.owner_type)) addFinding(findings, "parallel_work_invalid_owner_type", { feature_key: featureKey, workstream_id: id, owner_type: row.owner_type });
    if (!validText(row.branch_pattern)) addFinding(findings, "parallel_work_missing_branch_pattern", { feature_key: featureKey, workstream_id: id });
    if (["*", "**", "**/**"].includes(row.branch_pattern)) addFinding(findings, "parallel_work_forbidden_branch_pattern", { feature_key: featureKey, workstream_id: id });
    const scope = row.scope?.include;
    if (!Array.isArray(scope) || !scope.length) addFinding(findings, "parallel_work_missing_scope", { feature_key: featureKey, workstream_id: id });
    for (const pattern of scope || []) {
      if (!validText(pattern, 1) || policy.forbidden_scope_patterns.includes(pattern)) {
        addFinding(findings, "parallel_work_forbidden_scope_pattern", { feature_key: featureKey, workstream_id: id, pattern });
      }
    }
    if (!Array.isArray(row.depends_on)) addFinding(findings, "parallel_work_dependencies_must_be_array", { feature_key: featureKey, workstream_id: id });
    for (const dependency of row.depends_on || []) {
      if (dependency === id) addFinding(findings, "parallel_work_self_dependency", { feature_key: featureKey, workstream_id: id });
      if (!idSet.has(dependency)) addFinding(findings, "parallel_work_unknown_dependency", { feature_key: featureKey, workstream_id: id, dependency });
    }
    if (!Array.isArray(row.deliverables) || !row.deliverables.length) addFinding(findings, "parallel_work_missing_deliverables", { feature_key: featureKey, workstream_id: id });
    if (!Array.isArray(row.integration_points)) addFinding(findings, "parallel_work_integration_points_must_be_array", { feature_key: featureKey, workstream_id: id });
    for (const test of row.required_tests || []) validateTestDescriptor(test, findings, { featureKey, location: `workstream:${id}` });

    if (READY_STATUSES.has(row.status)) {
      if (!Array.isArray(row.required_tests) || !row.required_tests.length) addFinding(findings, "parallel_work_ready_workstream_missing_tests", { feature_key: featureKey, workstream_id: id });
      const evidence = row.commit_evidence || {};
      if (!Array.isArray(evidence.commits) || !evidence.commits.length || evidence.commits.some((sha) => !SHA_PATTERN.test(sha))) {
        addFinding(findings, "parallel_work_ready_workstream_missing_commit_evidence", { feature_key: featureKey, workstream_id: id });
      }
      if (!SHA_PATTERN.test(evidence.head_sha || "")) addFinding(findings, "parallel_work_ready_workstream_missing_head_sha", { feature_key: featureKey, workstream_id: id });
      for (const dependency of row.depends_on || []) {
        if (!READY_STATUSES.has(byId.get(dependency)?.status)) {
          addFinding(findings, "parallel_work_ready_before_dependency", { feature_key: featureKey, workstream_id: id, dependency, dependency_status: byId.get(dependency)?.status });
        }
      }
    }
  }

  validateDag(workstreams, findings, featureKey);

  for (let leftIndex = 0; leftIndex < workstreams.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < workstreams.length; rightIndex += 1) {
      const left = workstreams[leftIndex];
      const right = workstreams[rightIndex];
      for (const leftPattern of left.scope?.include || []) {
        for (const rightPattern of right.scope?.include || []) {
          if (patternsMayOverlap(leftPattern, rightPattern) && !declaredOverlapFor(overlaps, left.id, right.id)) {
            addFinding(findings, "parallel_work_undeclared_scope_overlap", {
              feature_key: featureKey,
              left_workstream: left.id,
              right_workstream: right.id,
              left_pattern: leftPattern,
              right_pattern: rightPattern
            });
          }
        }
      }
    }
  }

  const integration = parallel.integration || {};
  if (!validText(integration.branch_pattern)) addFinding(findings, "parallel_work_missing_integration_branch_pattern", { feature_key: featureKey });
  if (integration.branch_pattern && ["*", "**", "**/**"].includes(integration.branch_pattern)) addFinding(findings, "parallel_work_forbidden_integration_branch_pattern", { feature_key: featureKey });
  if (!Array.isArray(integration.required_workstreams) || integration.required_workstreams.some((id) => !idSet.has(id))) {
    addFinding(findings, "parallel_work_invalid_required_workstreams", { feature_key: featureKey });
  }
  if (!Array.isArray(integration.e2e_journey_ids) || !integration.e2e_journey_ids.length) {
    addFinding(findings, "parallel_work_missing_integration_e2e_journeys", { feature_key: featureKey });
  }
  for (const test of integration.convergence_tests || []) validateTestDescriptor(test, findings, { featureKey, location: "integration" });

  const activeWorkstreams = headRef
    ? workstreams.filter((row) => row.branch_pattern && matchesPattern(headRef, row.branch_pattern))
    : [];
  const integrationActive = Boolean(headRef && integration.branch_pattern && matchesPattern(headRef, integration.branch_pattern));
  if (headRef && activeWorkstreams.length > 1) addFinding(findings, "parallel_work_branch_matches_multiple_workstreams", { feature_key: featureKey, head_ref: headRef, workstreams: activeWorkstreams.map((row) => row.id) });
  if (headRef && integrationActive && activeWorkstreams.length) addFinding(findings, "parallel_work_branch_matches_workstream_and_integration", { feature_key: featureKey, head_ref: headRef });

  const runtimeFiles = changedFiles.filter((file) => policy.runtime_patterns.some((pattern) => matchesPattern(file, pattern)));
  if (activeWorkstreams.length === 1) {
    const active = activeWorkstreams[0];
    for (const file of runtimeFiles) {
      const matching = workstreams.filter((row) => (row.scope?.include || []).some((pattern) => matchesPattern(file, pattern)));
      const activeOwns = matching.some((row) => row.id === active.id);
      const overlapAllows = matching.some((row) => row.id !== active.id && declaredOverlapFor(overlaps, active.id, row.id, file));
      if (!activeOwns && !overlapAllows) addFinding(findings, "parallel_work_change_outside_active_workstream", { feature_key: featureKey, workstream_id: active.id, file });
    }
  }

  if (integrationActive) {
    if (contract.phases?.find((phase) => phase.id === contract.current_phase)?.status === "implemented") {
      if (!Array.isArray(integration.convergence_tests) || !integration.convergence_tests.length) addFinding(findings, "parallel_work_implemented_integration_missing_convergence_tests", { feature_key: featureKey });
      for (const id of integration.required_workstreams || []) {
        if (byId.get(id)?.status !== "integrated") addFinding(findings, "parallel_work_integration_missing_integrated_workstream", { feature_key: featureKey, workstream_id: id, status: byId.get(id)?.status });
      }
    }
    for (const row of workstreams.filter((item) => item.status === "integrated")) {
      for (const commit of row.commit_evidence?.commits || []) {
        if (SHA_PATTERN.test(commit) && !isAncestor(root, commit, headSha || "HEAD")) {
          addFinding(findings, "parallel_work_commit_not_in_integration_head", { feature_key: featureKey, workstream_id: row.id, commit, head_sha: headSha || null });
        }
      }
    }
  }

  return {
    feature_key: featureKey,
    contract_path: contractPath,
    enabled: true,
    workstream_count: workstreams.length,
    active_workstream: activeWorkstreams[0]?.id || null,
    integration_active: integrationActive,
    head_ref: headRef || null
  };
}

export function evaluateParallelWork(options = {}) {
  const root = options.root || REPO_ROOT;
  const policy = options.policy || readJson(path.join(root, ".specify", "e2e-phase-governance.json"));
  const changedFiles = (options.changedFiles || changedFilesFromGit(root, options.base, options.head)).map(normalize);
  const headRef = options.headRef ?? process.env.GITHUB_HEAD_REF ?? "";
  const headSha = options.headSha ?? process.env.GITHUB_HEAD_SHA ?? options.head ?? "HEAD";
  const findings = [];
  const contracts = [];
  for (const contractPath of discoverContractPaths(changedFiles, policy)) {
    const absolute = path.join(root, contractPath);
    if (!fs.existsSync(absolute)) continue;
    try {
      const result = validateParallelContract(readJson(absolute), contractPath, { root, changedFiles, policy, headRef, headSha, findings });
      if (result) contracts.push(result);
    } catch (error) {
      addFinding(findings, "parallel_work_invalid_contract_json", { contract_path: contractPath, message: error.message });
    }
  }
  return {
    schema_version: 1,
    policy_key: policy.policy_key,
    ok: findings.length === 0,
    changed_files: changedFiles,
    head_ref: headRef || null,
    contracts,
    findings,
    secrets_included: false
  };
}

function writeAtomic(file, data) {
  if (!file) return;
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temporary, resolved);
}

function appendSummary(report) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const lines = [
    "## Parallel Work Governance",
    "",
    `- Result: **${report.ok ? "PASS" : "FAIL"}**`,
    `- Contracts: ${report.contracts.length}`,
    `- Findings: ${report.findings.length}`
  ];
  for (const contract of report.contracts) lines.push(`- ${contract.feature_key}: ${contract.workstream_count} workstreams; active=${contract.active_workstream || "integration/none"}`);
  for (const finding of report.findings.slice(0, 50)) lines.push(`- \`${finding.code}\`${finding.file ? ` — ${finding.file}` : ""}`);
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}

function parseArgs(argv) {
  const options = { root: REPO_ROOT, base: null, head: "HEAD", headRef: null, reportFile: null };
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
    else if (arg === "--report-file") options.reportFile = read();
    else if (arg.startsWith("--report-file=")) options.reportFile = arg.slice(14);
    else if (arg === "check" || arg === "--ci" || arg === "--changed") {}
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = evaluateParallelWork(options);
  writeAtomic(options.reportFile, report);
  appendSummary(report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main();
