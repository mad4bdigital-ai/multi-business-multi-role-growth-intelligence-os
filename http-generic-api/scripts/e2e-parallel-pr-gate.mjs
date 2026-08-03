#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateParallelWork } from "./e2e-parallel-work-governance.mjs";
import { matchesPattern } from "./e2e-phase-governance.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

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

  const productionPromotion = options.headRef === "main" && options.baseRef === "Production";
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
  } else if (report.contracts.length && options.headRef && !options.headRef.startsWith("gh-readonly-queue/") && !productionPromotion) {
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
  writeAtomic(options.reportFile, report);
  writeOutputs(options.githubOutput, {
    mode,
    feature_key: featureKey,
    contract_path: contractPath,
    workstream_id: workstreamId,
    production_promotion: productionPromotion
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main();