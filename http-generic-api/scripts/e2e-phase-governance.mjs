#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPO_ROOT,
  matchesPattern,
  evaluateRepository as evaluateCoreRepository,
  executePhaseTests
} from "./e2e-phase-governance-core.mjs";

export { REPO_ROOT, matchesPattern, executePhaseTests };

const E2E_OWNERSHIP_NEUTRAL_SPEC_ARTIFACTS = new Set(["work-map-integration.json"]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function normalize(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function currentPhase(contract) {
  return (contract.phases || []).find((phase) => phase.id === contract.current_phase) || null;
}

function ownershipNeutralSpecContractPaths(changedFiles, policy) {
  const specRoot = normalize(policy.spec_root).replace(/\/+$/, "");
  const prefix = `${specRoot}/`;
  const filesByFeature = new Map();

  for (const rawFile of changedFiles) {
    const file = normalize(rawFile);
    if (!file.startsWith(prefix)) continue;
    const [feature, ...relativeParts] = file.slice(prefix.length).split("/");
    if (!feature || !relativeParts.length) continue;
    if (!filesByFeature.has(feature)) filesByFeature.set(feature, []);
    filesByFeature.get(feature).push(relativeParts.join("/"));
  }

  const contractPaths = new Set();
  for (const [feature, relativeFiles] of filesByFeature) {
    if (
      relativeFiles.length > 0
      && relativeFiles.every((file) => E2E_OWNERSHIP_NEUTRAL_SPEC_ARTIFACTS.has(file))
    ) {
      contractPaths.add(normalize(path.posix.join(specRoot, feature, policy.spec_contract_file)));
    }
  }
  return contractPaths;
}

function applyOwnershipNeutralSpecArtifactException(evaluation) {
  const { report, policy } = evaluation;
  const neutralContractPaths = ownershipNeutralSpecContractPaths(report.changed_files, policy);
  if (!neutralContractPaths.size) return evaluation;

  report.findings = report.findings.filter((finding) =>
    finding.code !== "missing_spec_e2e_phase_contract"
    || !neutralContractPaths.has(normalize(finding.contract_path))
  );
  report.ok = report.findings.length === 0;
  return evaluation;
}

function maintenanceCandidate({ root, policy, changedFiles, runtimeFiles }) {
  const contractRoot = normalize(policy.non_spec_contract_root || ".changes/e2e").replace(/\/+$/, "");
  const candidates = [];
  for (const contractPath of changedFiles.filter((file) => file.startsWith(`${contractRoot}/`) && file.endsWith(".json")).sort()) {
    const absolute = path.join(root, contractPath);
    if (!fs.existsSync(absolute)) continue;
    const contract = readJson(absolute);
    const scope = contract.scope?.include || [];
    if (
      contract.delivery_mode === "single_pr"
      && currentPhase(contract)?.status === "implemented"
      && contract.secrets_included === false
      && Array.isArray(scope)
      && runtimeFiles.every((file) => scope.some((pattern) => matchesPattern(file, pattern)))
    ) candidates.push({ contractPath, contract });
  }
  if (candidates.length === 0) return { status: "missing", candidate: null };
  if (candidates.length > 1) return { status: "ambiguous", candidate: null };
  const [candidate] = candidates;
  return { status: "unique", candidate };
}

function integratedParallelContract(root, contractPath) {
  const absolute = path.join(root, contractPath);
  if (!fs.existsSync(absolute)) return false;
  const contract = readJson(absolute);
  if (contract.delivery_mode !== "multi_pr" || contract.parallel_work?.enabled !== true || currentPhase(contract)?.status !== "implemented") return false;
  const workstreams = new Map((contract.parallel_work.workstreams || []).map((row) => [row.id, row]));
  const required = contract.parallel_work.integration?.required_workstreams || [];
  return required.length > 0 && required.every((id) => workstreams.get(id)?.status === "integrated");
}

function applySinglePrMaintenanceException(evaluation, options) {
  const { report, policy } = evaluation;
  const root = options.root || REPO_ROOT;
  const baseRef = options.baseRef || process.env.GITHUB_BASE_REF || "";
  const stale = report.findings.filter((finding) => finding.code === "e2e_phase_contract_not_changed_with_feature");
  if (baseRef !== "main" || !report.runtime_files.length || !stale.length) return evaluation;

  const resolution = maintenanceCandidate({
    root,
    policy,
    changedFiles: report.changed_files,
    runtimeFiles: report.runtime_files
  });
  if (resolution.status !== "unique" || !resolution.candidate) return evaluation;
  const candidate = resolution.candidate;

  const stalePaths = [...new Set(stale.map((finding) => finding.contract_path).filter(Boolean))].sort();
  if (!stalePaths.length || !stalePaths.every((contractPath) => integratedParallelContract(root, contractPath))) return evaluation;

  const staleSet = new Set(stalePaths);
  report.findings = report.findings.filter((finding) =>
    finding.code !== "e2e_phase_contract_not_changed_with_feature" || !staleSet.has(finding.contract_path)
  );
  report.ok = report.findings.length === 0;
  report.single_pr_maintenance_contract = {
    feature_key: candidate.contract.feature_key || null,
    contract_path: candidate.contractPath,
    runtime_files: report.runtime_files,
    affected_parallel_contract_paths: stalePaths
  };
  return evaluation;
}

export function evaluateRepository(options = {}) {
  const ownershipAware = applyOwnershipNeutralSpecArtifactException(evaluateCoreRepository(options));
  return applySinglePrMaintenanceException(ownershipAware, options);
}

function writeAtomic(file, data) {
  if (!file) return;
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temporary, resolved);
}

function appendSummary(report, execution = null) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (!summary) return;
  const lines = [
    "## E2E Phase Governance",
    "",
    `- Result: **${report.ok && (!execution || execution.ok) ? "PASS" : "FAIL"}**`,
    `- Change class: \`${report.change_class}\``,
    `- Contracts: ${report.contracts.length}`,
    `- Findings: ${report.findings.length}`
  ];
  for (const contract of report.contracts) lines.push(`- ${contract.feature_key}: \`${contract.current_phase}\` (${contract.current_phase_status})`);
  if (execution) lines.push(`- Executed phase tests: ${execution.test_count}`);
  if (report.findings.length) {
    lines.push("", "### Blocking findings", "");
    for (const finding of report.findings.slice(0, 50)) lines.push(`- \`${finding.code}\`${finding.file ? ` — ${finding.file}` : ""}`);
  }
  fs.appendFileSync(summary, `${lines.join("\n")}\n`);
}

function parseArgs(argv) {
  const options = { command: "check", base: null, baseRef: null, head: "HEAD", reportFile: null, executionReportFile: null, root: REPO_ROOT };
  if (argv[0] && !argv[0].startsWith("--")) options.command = argv.shift();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const read = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      index += 1;
      return value;
    };
    if (arg === "--base") options.base = read();
    else if (arg.startsWith("--base=")) options.base = arg.slice(7);
    else if (arg === "--base-ref") options.baseRef = read();
    else if (arg.startsWith("--base-ref=")) options.baseRef = arg.slice(11);
    else if (arg === "--head") options.head = read();
    else if (arg.startsWith("--head=")) options.head = arg.slice(7);
    else if (arg === "--report-file") options.reportFile = read();
    else if (arg.startsWith("--report-file=")) options.reportFile = arg.slice(14);
    else if (arg === "--execution-report-file") options.executionReportFile = read();
    else if (arg.startsWith("--execution-report-file=")) options.executionReportFile = arg.slice(24);
    else if (arg === "--root") options.root = path.resolve(read());
    else if (arg.startsWith("--root=")) options.root = path.resolve(arg.slice(7));
    else if (arg === "--ci" || arg === "--changed") {}
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const evaluation = evaluateRepository(options);
  writeAtomic(options.reportFile, evaluation.report);
  if (!evaluation.report.ok) {
    appendSummary(evaluation.report);
    console.error(JSON.stringify(evaluation.report, null, 2));
    process.exit(1);
  }
  let execution = null;
  if (options.command === "run") {
    execution = executePhaseTests(evaluation, options);
    writeAtomic(options.executionReportFile, execution);
    if (!execution.ok) {
      appendSummary(evaluation.report, execution);
      console.error(JSON.stringify(execution, null, 2));
      process.exit(1);
    }
  } else if (options.command !== "check") {
    throw new Error(`Unknown command: ${options.command}`);
  }
  appendSummary(evaluation.report, execution);
  console.log(JSON.stringify({ ...evaluation.report, execution }, null, 2));
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main();
