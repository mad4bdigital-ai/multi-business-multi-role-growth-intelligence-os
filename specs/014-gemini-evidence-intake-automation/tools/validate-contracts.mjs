#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
const exists = (relativePath) => fs.existsSync(path.join(ROOT, relativePath));

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function uniqueIndex(items, keyName, label) {
  const index = new Map();
  for (const item of items) {
    const key = item?.[keyName];
    if (!key) fail(`${label} is missing ${keyName}.`, { item });
    if (index.has(key)) fail(`Duplicate ${label} key: ${key}.`);
    index.set(key, item);
  }
  return index;
}

function requireRefs(refs, index, context, refLabel) {
  for (const ref of refs || []) {
    if (!index.has(ref)) fail(`${context} references unknown ${refLabel}: ${ref}.`);
  }
}

function detectCycle(index, dependencySelector, label) {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(key) {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      const start = stack.indexOf(key);
      const cycle = [...stack.slice(start), key];
      fail(`${label} dependency cycle detected: ${cycle.join(" -> ")}.`, { cycle });
    }
    visiting.add(key);
    stack.push(key);
    const item = index.get(key);
    for (const dependency of dependencySelector(item) || []) visit(dependency);
    stack.pop();
    visiting.delete(key);
    visited.add(key);
  }

  for (const key of index.keys()) visit(key);
}

function scanNoSecrets(files) {
  const findings = [];
  const patterns = [
    { key: "google_api_key", regex: /AIza[0-9A-Za-z_-]{30,}/g },
    { key: "github_token", regex: /gh[pousr]_[0-9A-Za-z]{20,}/g },
    { key: "private_key", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
    { key: "bearer_token", regex: /Bearer\s+[A-Za-z0-9._~+\/-]{24,}/g },
    { key: "signed_url", regex: /[?&](?:X-Goog-Signature|X-Amz-Signature|Signature)=[0-9A-Fa-f]{16,}/g }
  ];

  for (const relativePath of files) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) continue;
    const text = fs.readFileSync(absolutePath, "utf8");
    for (const pattern of patterns) {
      if (pattern.regex.test(text)) findings.push({ file: relativePath, type: pattern.key });
      pattern.regex.lastIndex = 0;
    }
  }
  if (findings.length) fail("Potential secrets found in Spec artifacts.", { findings });
}

function validateDevelopmentContract(contract) {
  if (contract.schema_version !== 1) fail("Unsupported development contract schema version.");
  if (contract.authority_boundary?.contract_is_authority !== false) fail("Development contract must not be mutation authority.");
  if (contract.secrets_included !== false) fail("Development contract must declare secrets_included=false.");

  const requirements = uniqueIndex(contract.requirements, "id", "requirement");
  const acceptance = uniqueIndex(contract.acceptance_criteria, "id", "acceptance criterion");
  const operations = uniqueIndex(contract.operation_paths, "id", "operation path");
  const waves = uniqueIndex(contract.implementation_waves, "id", "implementation wave");
  const tasks = uniqueIndex(contract.tasks, "id", "task");
  const decisions = uniqueIndex(contract.open_decisions, "id", "open decision");

  for (const requirement of requirements.values()) {
    requireRefs(requirement.operation_path_refs, operations, requirement.id, "operation path");
    requireRefs(requirement.acceptance_refs, acceptance, requirement.id, "acceptance criterion");
  }

  for (const wave of waves.values()) {
    requireRefs(wave.depends_on, waves, wave.id, "wave dependency");
    requireRefs(wave.task_refs, tasks, wave.id, "task");
    for (const taskRef of wave.task_refs) {
      if (tasks.get(taskRef).wave_ref !== wave.id) {
        fail(`${wave.id} includes ${taskRef}, but the task declares wave_ref=${tasks.get(taskRef).wave_ref}.`);
      }
    }
  }

  for (const task of tasks.values()) {
    if (!waves.has(task.wave_ref)) fail(`${task.id} references unknown wave ${task.wave_ref}.`);
    requireRefs(task.requirement_refs, requirements, task.id, "requirement");
    requireRefs(task.acceptance_refs, acceptance, task.id, "acceptance criterion");
    requireRefs(task.operation_path_refs, operations, task.id, "operation path");
    requireRefs(task.depends_on, tasks, task.id, "task dependency");
    requireRefs(task.decision_refs, decisions, task.id, "open decision");
    if (!task.allowed_paths?.length) fail(`${task.id} has no allowed paths.`);
    if (!task.forbidden_actions?.length) fail(`${task.id} has no forbidden actions.`);
    if (!task.required_tests?.length) fail(`${task.id} has no required tests.`);
    if (!task.completion_evidence?.length) fail(`${task.id} has no completion evidence.`);
    if (!task.resume_key) fail(`${task.id} has no resume key.`);
  }

  detectCycle(tasks, (task) => task.depends_on, "Task");
  detectCycle(waves, (wave) => wave.depends_on, "Wave");

  const requirementsWithoutTasks = [...requirements.keys()].filter((id) => ![...tasks.values()].some((task) => task.requirement_refs.includes(id)));
  if (requirementsWithoutTasks.length) fail("Requirements exist without implementation task coverage.", { requirementsWithoutTasks });

  const acceptanceWithoutTasks = [...acceptance.keys()].filter((id) => ![...tasks.values()].some((task) => task.acceptance_refs.includes(id)));
  if (acceptanceWithoutTasks.length) fail("Acceptance criteria exist without task coverage.", { acceptanceWithoutTasks });

  const completion = contract.completion_policy;
  if (!completion?.complete_requires_no_blockers || !completion?.exact_head_evidence_required) {
    fail("Completion policy must require no blockers and exact-head evidence.");
  }

  return { requirements, acceptance, operations, waves, tasks, decisions };
}

function validateCiContract(contract, developmentIndexes) {
  if (contract.schema_version !== 1) fail("Unsupported CI contract schema version.");
  if (contract.secrets_included !== false) fail("CI contract must declare secrets_included=false.");
  for (const [key, expected] of Object.entries({
    exact_candidate_binding: true,
    changed_scope_fail_closed: true,
    canonical_structured_evidence: true,
    diagnostics_are_not_status_authority: true,
    read_only_validation_by_default: true,
    sole_governed_writer: true,
    least_privilege: true,
    no_secret_evidence: true,
    exact_head_completion: true
  })) {
    if (contract.principles?.[key] !== expected) fail(`CI principle ${key} must be true.`);
  }

  const families = uniqueIndex(contract.test_families, "key", "test family");
  const pipelines = uniqueIndex(contract.pipelines, "key", "pipeline");
  const evidence = uniqueIndex(contract.evidence_contracts, "key", "evidence contract");

  for (const family of families.values()) {
    requireRefs(family.requirement_refs, developmentIndexes.requirements, family.key, "requirement");
    requireRefs(family.task_refs, developmentIndexes.tasks, family.key, "task");
    if (!family.changed_paths?.length || !family.commands?.length) fail(`${family.key} must declare changed paths and commands.`);
  }

  for (const pipeline of pipelines.values()) {
    if (!pipeline.stages?.length) fail(`${pipeline.key} has no stages.`);
    for (const stage of pipeline.stages) {
      if (!evidence.has(stage.evidence_key)) fail(`${pipeline.key}/${stage.key} references unknown evidence key ${stage.evidence_key}.`);
    }
  }

  for (const item of evidence.values()) {
    if (!pipelines.has(item.producer_pipeline)) fail(`${item.key} references unknown producer pipeline ${item.producer_pipeline}.`);
    if (item.secrets_included !== false) fail(`${item.key} must declare secrets_included=false.`);
  }

  const completion = contract.completion_policy;
  requireRefs(completion.required_pipeline_keys, pipelines, "completion_policy", "pipeline");
  requireRefs(completion.required_evidence_keys, evidence, "completion_policy", "evidence contract");

  const writerKey = contract.writer_policy?.writer_pipeline_key;
  if (!writerKey || !pipelines.has(writerKey)) fail("Writer policy references an unknown writer pipeline.");
  if (!pipelines.get(writerKey).remote_write) fail("Governed writer pipeline must declare remote_write=true.");
  if (contract.writer_policy.default_remote_write !== false) fail("Default remote write must be false.");

  const sourceWriterPipelines = [...pipelines.values()].filter((pipeline) => pipeline.remote_write && pipeline.key !== "pr-evidence-publisher");
  if (sourceWriterPipelines.length !== 1 || sourceWriterPipelines[0].key !== writerKey) {
    fail("Exactly one source/generated-artifact writer pipeline is allowed.", { sourceWriterPipelines: sourceWriterPipelines.map((item) => item.key) });
  }

  return { families, pipelines, evidence };
}

function validateManifest(manifest) {
  if (manifest.specification_only !== true) fail("Manifest must remain specification_only=true on this branch.");
  if (manifest.secrets_included !== false) fail("Manifest must declare secrets_included=false.");
  const missingFiles = (manifest.files || []).filter((file) => !exists(file));
  if (missingFiles.length) fail("Manifest references missing files.", { missingFiles });
}

function validateCompletion(completion) {
  if (completion.secrets_included !== false) fail("Completion manifest must declare secrets_included=false.");
  if (completion.status === "complete") {
    if (completion.completion_blockers?.length) fail("A complete feature cannot retain completion blockers.");
    for (const [key, value] of Object.entries(completion.evidence || {})) {
      if (["not_started", "pending", "pending_not_authorized", "draft_blocked", "in_progress"].includes(value?.status)) {
        fail(`Completion status is complete but evidence ${key} remains ${value.status}.`);
      }
    }
  }
}

function main() {
  const manifest = readJson("manifest.json");
  const development = readJson("development-automation.json");
  const ci = readJson("ci-automation.json");
  const completion = readJson("completion.json");

  validateManifest(manifest);
  const developmentIndexes = validateDevelopmentContract(development);
  const ciIndexes = validateCiContract(ci, developmentIndexes);
  validateCompletion(completion);
  scanNoSecrets(manifest.files);

  const report = {
    contract: "mad4b.spec014.contract-integrity-report.v1",
    ok: true,
    spec_key: manifest.spec_key,
    development_contract: {
      requirements: developmentIndexes.requirements.size,
      acceptance_criteria: developmentIndexes.acceptance.size,
      operation_paths: developmentIndexes.operations.size,
      implementation_waves: developmentIndexes.waves.size,
      tasks: developmentIndexes.tasks.size,
      open_decisions: developmentIndexes.decisions.size
    },
    ci_contract: {
      test_families: ciIndexes.families.size,
      pipelines: ciIndexes.pipelines.size,
      evidence_contracts: ciIndexes.evidence.size
    },
    completion_status: completion.status,
    secrets_included: false
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  const report = {
    contract: "mad4b.spec014.contract-integrity-report.v1",
    ok: false,
    error: error.message,
    details: error.details || null,
    secrets_included: false
  };
  process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
}
