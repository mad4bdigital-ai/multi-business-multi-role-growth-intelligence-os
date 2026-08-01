#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");

function normalize(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function globRegex(pattern) {
  const normalized = normalize(pattern);
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    const next = normalized[index + 1];
    if (character === "*" && next === "*") {
      if (normalized[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`${source}$`);
}

export function matchesPattern(file, pattern) {
  return globRegex(pattern).test(normalize(file));
}

function matchesAny(file, patterns = []) {
  return patterns.some((pattern) => matchesPattern(file, pattern));
}

function changedFilesFromGit(root = REPO_ROOT, explicitBase = null, explicitHead = "HEAD") {
  const candidates = [
    explicitBase ? `${explicitBase}...${explicitHead}` : null,
    process.env.GITHUB_BASE_SHA ? `${process.env.GITHUB_BASE_SHA}...${process.env.GITHUB_HEAD_SHA || explicitHead}` : null,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}...${explicitHead}` : null,
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

function specKeyFromFile(file, policy) {
  const prefix = `${normalize(policy.spec_root)}/`;
  const normalized = normalize(file);
  if (!normalized.startsWith(prefix)) return null;
  return normalized.slice(prefix.length).split("/")[0] || null;
}

function contractPathForSpec(feature, policy) {
  return normalize(path.posix.join(policy.spec_root, feature, policy.spec_contract_file));
}

function classifyChanges(changedFiles, policy) {
  const considered = changedFiles.filter((file) => !matchesAny(file, policy.ignored_patterns));
  if (!considered.length) return { changeClass: "empty", considered, runtimeFiles: [], specFiles: [] };
  const runtimeFiles = considered.filter((file) => matchesAny(file, policy.runtime_patterns));
  const specFiles = considered.filter((file) => matchesAny(file, policy.spec_patterns));
  const docsOnly = considered.every((file) => matchesAny(file, policy.docs_only_patterns));
  const governanceOnly = considered.every((file) => matchesAny(file, policy.governance_only_patterns) || matchesAny(file, policy.docs_only_patterns));
  if (docsOnly) return { changeClass: "docs_only", considered, runtimeFiles, specFiles };
  if (governanceOnly) return { changeClass: "governance_only", considered, runtimeFiles: [], specFiles };
  if (runtimeFiles.length || specFiles.length) return { changeClass: "feature", considered, runtimeFiles, specFiles };
  return { changeClass: "repository", considered, runtimeFiles, specFiles };
}

function addFinding(findings, code, details = {}) {
  findings.push({ code, ...details });
}

function validText(value, minimum = 3) {
  return typeof value === "string" && value.trim().length >= minimum;
}

function levelRank(level, policy) {
  return policy.e2e_level_order.indexOf(level);
}

function phaseRank(phase, policy) {
  return policy.phase_order.indexOf(phase);
}

function ensureInside(root, relative) {
  const normalized = normalize(relative);
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) return null;
  const resolved = path.resolve(root, normalized);
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (resolved !== path.resolve(root) && !resolved.startsWith(prefix)) return null;
  return { normalized, resolved };
}

function validateTest(test, context) {
  const { findings, featureKey, journeyId, root, policy } = context;
  if (!test || typeof test !== "object") {
    addFinding(findings, "invalid_test_descriptor", { feature_key: featureKey, journey_id: journeyId });
    return;
  }
  if (!validText(test.id)) addFinding(findings, "missing_test_id", { feature_key: featureKey, journey_id: journeyId });
  if (!policy.allowed_test_runners.includes(test.runner)) {
    addFinding(findings, "unsupported_test_runner", { feature_key: featureKey, journey_id: journeyId, runner: test.runner });
    return;
  }
  const working = ensureInside(root, test.working_directory || ".");
  if (!working || !fs.existsSync(working.resolved) || !fs.statSync(working.resolved).isDirectory()) {
    addFinding(findings, "invalid_test_working_directory", { feature_key: featureKey, journey_id: journeyId, value: test.working_directory });
    return;
  }
  if (!Array.isArray(test.args || [])) addFinding(findings, "invalid_test_args", { feature_key: featureKey, journey_id: journeyId });
  if ((test.args || []).length > policy.max_test_args) addFinding(findings, "too_many_test_args", { feature_key: featureKey, journey_id: journeyId });
  for (const argument of test.args || []) {
    if (typeof argument !== "string" || argument.includes("\0") || argument.includes("\n") || argument.includes("\r")) {
      addFinding(findings, "unsafe_test_argument", { feature_key: featureKey, journey_id: journeyId });
    }
  }
  if (test.runner === "node") {
    const script = ensureInside(working.resolved, test.path);
    if (!script || !fs.existsSync(script.resolved) || !fs.statSync(script.resolved).isFile()) {
      addFinding(findings, "missing_node_test_file", { feature_key: featureKey, journey_id: journeyId, path: test.path });
    }
  }
  if (test.runner === "npm" && !/^[a-zA-Z0-9:_-]+$/.test(test.script || "")) {
    addFinding(findings, "invalid_npm_script", { feature_key: featureKey, journey_id: journeyId, script: test.script });
  }
}

function validateJourney(journey, context) {
  const { findings, featureKey, phaseId, root, policy } = context;
  if (!journey || typeof journey !== "object") {
    addFinding(findings, "invalid_e2e_journey", { feature_key: featureKey, phase: phaseId });
    return;
  }
  if (!validText(journey.id)) addFinding(findings, "missing_journey_id", { feature_key: featureKey, phase: phaseId });
  if (journey.end_to_end !== true) addFinding(findings, "journey_not_declared_end_to_end", { feature_key: featureKey, phase: phaseId, journey_id: journey.id });
  if (!validText(journey.actor)) addFinding(findings, "missing_journey_actor", { feature_key: featureKey, phase: phaseId, journey_id: journey.id });
  if (!validText(journey.entrypoint)) addFinding(findings, "missing_journey_entrypoint", { feature_key: featureKey, phase: phaseId, journey_id: journey.id });
  if (!validText(journey.terminal_outcome)) addFinding(findings, "missing_terminal_outcome", { feature_key: featureKey, phase: phaseId, journey_id: journey.id });
  if (!Array.isArray(journey.steps) || journey.steps.length < 2 || journey.steps.some((step) => !validText(step))) {
    addFinding(findings, "insufficient_journey_steps", { feature_key: featureKey, phase: phaseId, journey_id: journey.id });
  }
  if (!Array.isArray(journey.assertions) || !journey.assertions.length || journey.assertions.some((assertion) => !validText(assertion))) {
    addFinding(findings, "missing_observable_assertions", { feature_key: featureKey, phase: phaseId, journey_id: journey.id });
  }
  const requiredLevel = policy.phase_minimum_e2e_level[phaseId];
  if (levelRank(journey.level, policy) < levelRank(requiredLevel, policy)) {
    addFinding(findings, "journey_level_below_phase_minimum", {
      feature_key: featureKey,
      phase: phaseId,
      journey_id: journey.id,
      actual: journey.level,
      required: requiredLevel
    });
  }
  if (!Array.isArray(journey.tests) || !journey.tests.length) {
    addFinding(findings, "journey_has_no_executable_tests", { feature_key: featureKey, phase: phaseId, journey_id: journey.id });
  } else {
    for (const test of journey.tests) validateTest(test, { findings, featureKey, journeyId: journey.id, root, policy });
  }
  if (!Array.isArray(journey.evidence_paths) || !journey.evidence_paths.length) {
    addFinding(findings, "journey_has_no_evidence_paths", { feature_key: featureKey, phase: phaseId, journey_id: journey.id });
  } else {
    for (const evidencePath of journey.evidence_paths) {
      const evidence = ensureInside(root, evidencePath);
      if (!evidence || !fs.existsSync(evidence.resolved)) {
        addFinding(findings, "missing_journey_evidence", { feature_key: featureKey, phase: phaseId, journey_id: journey.id, path: evidencePath });
      }
    }
  }
}

function validateContract(contract, contractPath, context) {
  const { root, policy, changedFiles, findings } = context;
  const featureKey = contract?.feature_key || normalize(contractPath).split("/").at(-2) || contractPath;
  if (contract?.schema_version !== policy.schema_version) addFinding(findings, "invalid_contract_schema_version", { feature_key: featureKey, contract_path: contractPath });
  if (!validText(contract?.feature_key)) addFinding(findings, "missing_feature_key", { contract_path: contractPath });
  if (!validText(contract?.title)) addFinding(findings, "missing_feature_title", { feature_key: featureKey, contract_path: contractPath });
  if (!policy.delivery_modes.includes(contract?.delivery_mode)) addFinding(findings, "invalid_delivery_mode", { feature_key: featureKey, value: contract?.delivery_mode });
  if (phaseRank(contract?.current_phase, policy) < 0) addFinding(findings, "invalid_current_phase", { feature_key: featureKey, value: contract?.current_phase });
  if (!contract?.merge_contract || contract.merge_contract.minimum_phase !== "mvp") {
    addFinding(findings, "minimum_merge_phase_must_be_mvp", { feature_key: featureKey });
  }
  const scopePatterns = contract?.scope?.include;
  if (!Array.isArray(scopePatterns) || !scopePatterns.length) addFinding(findings, "missing_scope_include", { feature_key: featureKey });
  for (const pattern of scopePatterns || []) {
    if (!validText(pattern, 1) || policy.forbidden_scope_patterns.includes(pattern)) {
      addFinding(findings, "forbidden_or_invalid_scope_pattern", { feature_key: featureKey, pattern });
    }
  }
  const phases = Array.isArray(contract?.phases) ? contract.phases : [];
  if (!phases.length) addFinding(findings, "missing_phase_definitions", { feature_key: featureKey });
  const phaseIds = phases.map((phase) => phase?.id).filter(Boolean);
  if (!phaseIds.includes("mvp")) addFinding(findings, "missing_mvp_phase", { feature_key: featureKey });
  if (!phaseIds.includes(contract?.current_phase)) addFinding(findings, "current_phase_not_defined", { feature_key: featureKey, current_phase: contract?.current_phase });
  const duplicatePhaseIds = phaseIds.filter((value, index) => phaseIds.indexOf(value) !== index);
  if (duplicatePhaseIds.length) addFinding(findings, "duplicate_phase_ids", { feature_key: featureKey, values: [...new Set(duplicatePhaseIds)] });
  for (const phase of phases) {
    if (phaseRank(phase?.id, policy) < 0) {
      addFinding(findings, "unknown_phase", { feature_key: featureKey, phase: phase?.id });
      continue;
    }
    if (!["implemented", "planned", "blocked", "not_applicable"].includes(phase?.status)) {
      addFinding(findings, "invalid_phase_status", { feature_key: featureKey, phase: phase?.id, status: phase?.status });
    }
    if (!validText(phase?.objective)) addFinding(findings, "missing_phase_objective", { feature_key: featureKey, phase: phase?.id });
    if (phase?.status === "implemented") {
      if (!Array.isArray(phase.e2e_journeys) || !phase.e2e_journeys.length) {
        addFinding(findings, "implemented_phase_has_no_e2e_journey", { feature_key: featureKey, phase: phase?.id });
      }
      for (const journey of phase.e2e_journeys || []) validateJourney(journey, { findings, featureKey, phaseId: phase.id, root, policy });
    }
    if (phase?.status === "blocked" && (!Array.isArray(phase.blockers) || !phase.blockers.length)) {
      addFinding(findings, "blocked_phase_has_no_blockers", { feature_key: featureKey, phase: phase?.id });
    }
  }
  const current = phases.find((phase) => phase?.id === contract?.current_phase);
  if (policy.require_current_phase_implemented && current?.status !== "implemented") {
    addFinding(findings, "current_phase_not_implemented", { feature_key: featureKey, current_phase: contract?.current_phase, status: current?.status });
  }
  if (policy.require_mvp_or_later_for_merge && phaseRank(contract?.current_phase, policy) < phaseRank("mvp", policy)) {
    addFinding(findings, "current_phase_below_mvp", { feature_key: featureKey, current_phase: contract?.current_phase });
  }
  const mvp = phases.find((phase) => phase?.id === "mvp");
  if (policy.require_mvp_or_later_for_merge && mvp?.status !== "implemented") {
    addFinding(findings, "mvp_not_implemented", { feature_key: featureKey, status: mvp?.status });
  }
  const contractRuntimeFiles = changedFiles.filter((file) => matchesAny(file, policy.runtime_patterns));
  const covered = contractRuntimeFiles.filter((file) => (scopePatterns || []).some((pattern) => matchesPattern(file, pattern)));
  return {
    featureKey,
    contractPath,
    contract,
    currentPhase: current || null,
    coveredRuntimeFiles: covered,
    digest: sha256(JSON.stringify(contract))
  };
}

function discoverContractPaths(policy, changedFiles) {
  const paths = new Set();
  const changedSpecs = new Set(changedFiles.map((file) => specKeyFromFile(file, policy)).filter(Boolean));
  for (const feature of changedSpecs) paths.add(contractPathForSpec(feature, policy));
  for (const file of changedFiles) {
    if (file.endsWith(`/${policy.spec_contract_file}`) || file === policy.spec_contract_file) paths.add(file);
    if (file.startsWith(`${normalize(policy.non_spec_contract_root)}/`) && file.endsWith(".json")) paths.add(file);
  }
  return [...paths].sort();
}

export function evaluateRepository(options = {}) {
  const root = options.root || REPO_ROOT;
  const policy = options.policy || readJson(options.policyPath || path.join(root, ".specify", "e2e-phase-governance.json"));
  const changedFiles = (options.changedFiles || changedFilesFromGit(root, options.base, options.head)).map(normalize);
  const classification = classifyChanges(changedFiles, policy);
  const findings = [];
  const contracts = [];
  if (classification.changeClass === "feature") {
    const contractPaths = discoverContractPaths(policy, changedFiles);
    if (!contractPaths.length) addFinding(findings, "feature_change_missing_e2e_phase_contract");
    for (const contractPath of contractPaths) {
      const absolute = path.join(root, contractPath);
      if (!fs.existsSync(absolute)) {
        addFinding(findings, "missing_spec_e2e_phase_contract", { contract_path: contractPath });
        continue;
      }
      if (policy.require_changed_contract && !changedFiles.includes(contractPath)) {
        addFinding(findings, "e2e_phase_contract_not_changed_with_feature", { contract_path: contractPath });
      }
      try {
        contracts.push(validateContract(readJson(absolute), contractPath, { root, policy, changedFiles, findings }));
      } catch (error) {
        addFinding(findings, "invalid_e2e_phase_contract_json", { contract_path: contractPath, message: error.message });
      }
    }
    if (policy.require_all_runtime_changes_covered) {
      const uncovered = classification.runtimeFiles.filter((file) => !contracts.some((contract) => contract.coveredRuntimeFiles.includes(file)));
      for (const file of uncovered) addFinding(findings, "runtime_change_not_covered_by_e2e_contract", { file });
    }
  }
  const report = {
    schema_version: 1,
    policy_key: policy.policy_key,
    enforcement_mode: policy.enforcement_mode,
    ok: findings.length === 0,
    change_class: classification.changeClass,
    changed_files: changedFiles,
    runtime_files: classification.runtimeFiles,
    spec_files: classification.specFiles,
    contracts: contracts.map((entry) => ({
      feature_key: entry.featureKey,
      contract_path: entry.contractPath,
      current_phase: entry.contract?.current_phase,
      current_phase_status: entry.currentPhase?.status || null,
      contract_sha256: entry.digest,
      covered_runtime_files: entry.coveredRuntimeFiles
    })),
    findings,
    secrets_included: false
  };
  return { report, policy, contracts };
}

function executableTests(contracts) {
  const tests = [];
  const seen = new Set();
  for (const entry of contracts) {
    if (entry.currentPhase?.status !== "implemented") continue;
    for (const journey of entry.currentPhase.e2e_journeys || []) {
      for (const test of journey.tests || []) {
        const key = JSON.stringify(test);
        if (seen.has(key)) continue;
        seen.add(key);
        tests.push({ featureKey: entry.featureKey, phase: entry.currentPhase.id, journeyId: journey.id, test });
      }
    }
  }
  return tests;
}

export function executePhaseTests(evaluation, options = {}) {
  const root = options.root || REPO_ROOT;
  const tests = executableTests(evaluation.contracts);
  const maxTests = evaluation.policy.max_test_count_per_contract * Math.max(1, evaluation.contracts.length);
  if (tests.length > maxTests) throw new Error(`Refusing to run ${tests.length} tests; policy maximum is ${maxTests}.`);
  const results = [];
  for (const item of tests) {
    const workingDirectory = path.resolve(root, item.test.working_directory || ".");
    let executable;
    let args;
    if (item.test.runner === "node") {
      executable = process.execPath;
      args = [item.test.path, ...(item.test.args || [])];
    } else {
      executable = process.platform === "win32" ? "npm.cmd" : "npm";
      args = ["run", item.test.script, "--", ...(item.test.args || [])];
    }
    const startedAt = Date.now();
    const result = spawnSync(executable, args, {
      cwd: workingDirectory,
      env: { ...process.env, E2E_PHASE_GOVERNANCE: "true", E2E_FEATURE_KEY: item.featureKey, E2E_PHASE: item.phase },
      shell: false,
      encoding: "utf8",
      stdio: "inherit"
    });
    results.push({
      feature_key: item.featureKey,
      phase: item.phase,
      journey_id: item.journeyId,
      test_id: item.test.id,
      runner: item.test.runner,
      status: result.error ? "error" : result.status === 0 ? "passed" : "failed",
      exit_code: result.error ? 1 : (result.status ?? 1),
      duration_ms: Date.now() - startedAt,
      ...(result.error ? { error: result.error.message } : {})
    });
    if (result.error || result.status !== 0) break;
  }
  return {
    ok: results.length === tests.length && results.every((row) => row.status === "passed"),
    test_count: tests.length,
    results,
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
  const options = { command: "check", base: null, head: "HEAD", reportFile: null, executionReportFile: null, root: REPO_ROOT };
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
