#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VALID_STAGES = new Set(["manifest", "development", "ci", "completion", "secrets"]);
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
const exists = (relativePath) => fs.existsSync(path.join(ROOT, relativePath));

function parseArgs(argv) {
  const requested = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--only") {
      const stage = argv[++index];
      if (!VALID_STAGES.has(stage)) throw new Error(`Unsupported --only stage: ${stage || "missing"}.`);
      requested.push(stage);
    } else if (value === "--help" || value === "-h") {
      process.stdout.write("Usage: node tools/validate-contracts.mjs [--only manifest|development|ci|completion|secrets]...\n");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${value}`);
  }
  return requested.length ? [...new Set(requested)] : [...VALID_STAGES];
}

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function uniqueIndex(items, keyName, label) {
  if (!Array.isArray(items)) fail(`${label} collection must be an array.`);
  const index = new Map();
  for (const item of items) {
    const key = item?.[keyName];
    if (!key) fail(`${label} is missing ${keyName}.`, { item });
    if (index.has(key)) fail(`Duplicate ${label} key: ${key}.`);
    index.set(key, item);
  }
  return index;
}

function requireRefs(refs, index, context, label) {
  for (const ref of refs || []) if (!index.has(ref)) fail(`${context} references unknown ${label}: ${ref}.`);
}

function detectCycle(index, dependencySelector, label) {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const visit = (key) => {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      const start = stack.indexOf(key);
      fail(`${label} dependency cycle detected: ${[...stack.slice(start), key].join(" -> ")}.`);
    }
    visiting.add(key);
    stack.push(key);
    for (const dependency of dependencySelector(index.get(key)) || []) visit(dependency);
    stack.pop();
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of index.keys()) visit(key);
}

function scanNoSecrets(files) {
  const findings = [];
  const patterns = [
    ["google_api_key", /AIza[0-9A-Za-z_-]{30,}/g],
    ["github_token", /gh[pousr]_[0-9A-Za-z]{20,}/g],
    ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ["bearer_token", /Bearer\s+[A-Za-z0-9._~+\/-]{24,}/g],
    ["signed_url", /[?&](?:X-Goog-Signature|X-Amz-Signature|Signature)=[0-9A-Fa-f]{16,}/g]
  ];
  for (const relativePath of files) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) continue;
    const text = fs.readFileSync(absolutePath, "utf8");
    for (const [type, regex] of patterns) {
      if (regex.test(text)) findings.push({ file: relativePath, type });
      regex.lastIndex = 0;
    }
  }
  if (findings.length) fail("Potential secrets found in Spec artifacts.", { findings });
  return { scanned_files: files.length, finding_count: 0 };
}

function validateCoverageBindings(bindingContract, indexes) {
  if (bindingContract.schema_version !== 1) fail("Unsupported implementation-binding schema version.");
  if (bindingContract.feature_key !== "014-gemini-evidence-intake-automation") fail("Implementation bindings target the wrong feature.");
  if (bindingContract.secrets_included !== false) fail("Implementation bindings must declare secrets_included=false.");
  const bindings = uniqueIndex(bindingContract.bindings, "binding_key", "implementation binding");
  for (const binding of bindings.values()) {
    requireRefs([binding.task_ref], indexes.tasks, binding.binding_key, "task");
    requireRefs(binding.requirement_refs, indexes.requirements, binding.binding_key, "requirement");
    requireRefs(binding.acceptance_refs, indexes.acceptance, binding.binding_key, "acceptance criterion");
    if (!binding.implementation_refs?.length) fail(`${binding.binding_key} has no implementation refs.`);
    if (!binding.rationale) fail(`${binding.binding_key} has no rationale.`);
  }
  return bindings;
}

function validateDevelopmentContract(contract, bindingContract) {
  if (contract.schema_version !== 1) fail("Unsupported development contract schema version.");
  if (contract.authority_boundary?.contract_is_authority !== false) fail("Development contract must not be mutation authority.");
  if (contract.authority_boundary?.nested_authority_required !== true) fail("Development contract must require nested authority.");
  if (contract.secrets_included !== false) fail("Development contract must declare secrets_included=false.");

  const requirements = uniqueIndex(contract.requirements, "id", "requirement");
  const acceptance = uniqueIndex(contract.acceptance_criteria, "id", "acceptance criterion");
  const operations = uniqueIndex(contract.operation_paths, "id", "operation path");
  const waves = uniqueIndex(contract.implementation_waves, "id", "implementation wave");
  const tasks = uniqueIndex(contract.tasks, "id", "task");
  const decisions = uniqueIndex(contract.open_decisions, "id", "open decision");
  const indexes = { requirements, acceptance, operations, waves, tasks, decisions };

  for (const requirement of requirements.values()) {
    requireRefs(requirement.operation_path_refs, operations, requirement.id, "operation path");
    requireRefs(requirement.acceptance_refs, acceptance, requirement.id, "acceptance criterion");
  }
  for (const wave of waves.values()) {
    requireRefs(wave.depends_on, waves, wave.id, "wave dependency");
    requireRefs(wave.task_refs, tasks, wave.id, "task");
    for (const taskRef of wave.task_refs) if (tasks.get(taskRef).wave_ref !== wave.id) fail(`${wave.id} includes ${taskRef}, but it declares ${tasks.get(taskRef).wave_ref}.`);
  }
  for (const task of tasks.values()) {
    requireRefs([task.wave_ref], waves, task.id, "wave");
    requireRefs(task.requirement_refs, requirements, task.id, "requirement");
    requireRefs(task.acceptance_refs, acceptance, task.id, "acceptance criterion");
    requireRefs(task.operation_path_refs, operations, task.id, "operation path");
    requireRefs(task.depends_on, tasks, task.id, "task dependency");
    requireRefs(task.decision_refs, decisions, task.id, "open decision");
    for (const [field, label] of [["allowed_paths", "allowed paths"], ["forbidden_actions", "forbidden actions"], ["required_tests", "required tests"], ["completion_evidence", "completion evidence"]]) {
      if (!task[field]?.length) fail(`${task.id} has no ${label}.`);
    }
    if (!task.resume_key) fail(`${task.id} has no resume key.`);
  }

  detectCycle(tasks, (task) => task.depends_on, "Task");
  detectCycle(waves, (wave) => wave.depends_on, "Wave");
  const bindings = validateCoverageBindings(bindingContract, indexes);
  const boundRequirements = new Set([...bindings.values()].flatMap((binding) => binding.requirement_refs));
  const boundAcceptance = new Set([...bindings.values()].flatMap((binding) => binding.acceptance_refs));
  const requirementsWithoutTasks = [...requirements.keys()].filter((id) => ![...tasks.values()].some((task) => task.requirement_refs.includes(id)) && !boundRequirements.has(id));
  if (requirementsWithoutTasks.length) fail("Requirements exist without task or explicit implementation-binding coverage.", { requirementsWithoutTasks });
  const acceptanceWithoutTasks = [...acceptance.keys()].filter((id) => ![...tasks.values()].some((task) => task.acceptance_refs.includes(id)) && !boundAcceptance.has(id));
  if (acceptanceWithoutTasks.length) fail("Acceptance criteria exist without task or explicit implementation-binding coverage.", { acceptanceWithoutTasks });

  const completion = contract.completion_policy;
  if (!completion?.complete_requires_no_blockers || !completion?.exact_head_evidence_required) fail("Completion policy must require no blockers and exact-head evidence.");
  return { ...indexes, bindings };
}

function validateCiContract(contract, development) {
  if (contract.schema_version !== 1) fail("Unsupported CI contract schema version.");
  if (contract.secrets_included !== false) fail("CI contract must declare secrets_included=false.");
  for (const key of ["exact_candidate_binding", "changed_scope_fail_closed", "canonical_structured_evidence", "diagnostics_are_not_status_authority", "read_only_validation_by_default", "sole_governed_writer", "least_privilege", "no_secret_evidence", "exact_head_completion"]) {
    if (contract.principles?.[key] !== true) fail(`CI principle ${key} must be true.`);
  }
  const families = uniqueIndex(contract.test_families, "key", "test family");
  const pipelines = uniqueIndex(contract.pipelines, "key", "pipeline");
  const evidence = uniqueIndex(contract.evidence_contracts, "key", "evidence contract");
  for (const family of families.values()) {
    requireRefs(family.requirement_refs, development.requirements, family.key, "requirement");
    requireRefs(family.task_refs, development.tasks, family.key, "task");
    if (!family.changed_paths?.length || !family.commands?.length) fail(`${family.key} must declare changed paths and commands.`);
  }
  const stageEvidenceKeys = new Set();
  for (const pipeline of pipelines.values()) {
    if (!pipeline.stages?.length) fail(`${pipeline.key} has no stages.`);
    for (const stage of pipeline.stages) {
      if (!stage.evidence_key) fail(`${pipeline.key}/${stage.key} is missing an evidence key.`);
      stageEvidenceKeys.add(stage.evidence_key);
    }
  }
  for (const item of evidence.values()) {
    requireRefs([item.producer_pipeline], pipelines, item.key, "producer pipeline");
    if (item.secrets_included !== false) fail(`${item.key} must declare secrets_included=false.`);
    if (!stageEvidenceKeys.has(item.key)) fail(`${item.key} is declared but no stage produces it.`);
  }
  requireRefs(contract.completion_policy.required_pipeline_keys, pipelines, "completion_policy", "pipeline");
  requireRefs(contract.completion_policy.required_evidence_keys, evidence, "completion_policy", "canonical evidence contract");
  for (const key of contract.completion_policy.required_evidence_keys) if (!["canonical_status", "completion"].includes(evidence.get(key).authority)) fail(`Completion evidence ${key} is not canonical.`);
  const writerKey = contract.writer_policy?.writer_pipeline_key;
  requireRefs([writerKey], pipelines, "writer_policy", "pipeline");
  if (contract.writer_policy.default_remote_write !== false || !pipelines.get(writerKey).remote_write) fail("Governed writer policy is invalid.");
  const sourceWriters = [...pipelines.values()].filter((pipeline) => pipeline.remote_write && pipeline.key !== "pr-evidence-publisher");
  if (sourceWriters.length !== 1 || sourceWriters[0].key !== writerKey) fail("Exactly one source/generated-artifact writer is allowed.", { sourceWriters: sourceWriters.map((item) => item.key) });
  return { families, pipelines, evidence, stageEvidenceKeys };
}

function validateManifest(manifest) {
  if (manifest.specification_only !== true || manifest.secrets_included !== false) fail("Manifest authority or no-secret boundary is invalid.");
  const missingFiles = (manifest.files || []).filter((file) => !exists(file));
  if (missingFiles.length) fail("Manifest references missing files.", { missingFiles });
  return { file_count: manifest.files.length };
}

function validateCompletion(completion) {
  if (completion.secrets_included !== false) fail("Completion manifest must declare secrets_included=false.");
  if (completion.status === "complete") {
    if (completion.completion_blockers?.length) fail("A complete feature cannot retain blockers.");
    for (const [key, value] of Object.entries(completion.evidence || {})) if (["not_started", "pending", "pending_not_authorized", "draft_blocked", "in_progress"].includes(value?.status)) fail(`Completion evidence ${key} remains ${value.status}.`);
  }
  return { status: completion.status, blocker_count: completion.completion_blockers?.length || 0 };
}

function main() {
  const selected = parseArgs(process.argv.slice(2));
  const manifest = readJson("manifest.json");
  const results = {};
  let development = null;
  const run = (stage, fn) => { results[stage] = fn(); };
  if (selected.includes("manifest")) run("manifest", () => validateManifest(manifest));
  if (selected.includes("development") || selected.includes("ci")) run("development", () => {
    development = validateDevelopmentContract(readJson("development-automation.json"), readJson("development-implementation-bindings.json"));
    return { requirements: development.requirements.size, acceptance_criteria: development.acceptance.size, operation_paths: development.operations.size, implementation_waves: development.waves.size, tasks: development.tasks.size, open_decisions: development.decisions.size, additive_bindings: development.bindings.size };
  });
  if (selected.includes("ci")) run("ci", () => {
    const ci = validateCiContract(readJson("ci-automation.json"), development);
    return { test_families: ci.families.size, pipelines: ci.pipelines.size, canonical_evidence_contracts: ci.evidence.size, stage_evidence_keys: ci.stageEvidenceKeys.size };
  });
  if (selected.includes("completion")) run("completion", () => validateCompletion(readJson("completion.json")));
  if (selected.includes("secrets")) run("secrets", () => scanNoSecrets(manifest.files));
  process.stdout.write(`${JSON.stringify({ contract: "mad4b.spec014.contract-integrity-report.v1", ok: true, spec_key: manifest.spec_key, selected_stages: selected, stage_results: results, secrets_included: false }, null, 2)}\n`);
}

try { main(); }
catch (error) {
  process.stderr.write(`${JSON.stringify({ contract: "mad4b.spec014.contract-integrity-report.v1", ok: false, error: error.message, details: error.details || null, secrets_included: false }, null, 2)}\n`);
  process.exitCode = 1;
}
