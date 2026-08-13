#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));

function parseArgs(argv) {
  const options = { task: null, allowBlocked: false, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--task") options.task = argv[++index];
    else if (value === "--allow-blocked") options.allowBlocked = true;
    else if (value === "--output") options.output = argv[++index];
    else if (value === "--help" || value === "-h") {
      process.stdout.write("Usage: node tools/generate-work-packet.mjs --task T001 [--allow-blocked] [--output file.json]\n");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.task) throw new Error("--task is required.");
  return options;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function terminalTaskState(state) {
  return ["implemented", "verified", "deferred", "cancelled", "closed"].includes(state);
}

function terminalWaveState(state) {
  return ["implemented", "verified", "deferred", "cancelled", "closed"].includes(state);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const development = readJson("development-automation.json");
  const ci = readJson("ci-automation.json");
  const workMaps = readJson("work-map-integration.json");

  const tasks = new Map(development.tasks.map((item) => [item.id, item]));
  const waves = new Map(development.implementation_waves.map((item) => [item.id, item]));
  const requirements = new Map(development.requirements.map((item) => [item.id, item]));
  const acceptance = new Map(development.acceptance_criteria.map((item) => [item.id, item]));
  const operations = new Map(development.operation_paths.map((item) => [item.id, item]));
  const decisions = new Map(development.open_decisions.map((item) => [item.id, item]));

  const task = tasks.get(options.task);
  if (!task) throw new Error(`Unknown task: ${options.task}`);
  const wave = waves.get(task.wave_ref);
  if (!wave) throw new Error(`Task ${task.id} references unknown wave ${task.wave_ref}.`);

  const blockers = [];
  for (const dependencyRef of task.depends_on || []) {
    const dependency = tasks.get(dependencyRef);
    if (!dependency || !terminalTaskState(dependency.state)) {
      blockers.push({ type: "task_dependency", ref: dependencyRef, state: dependency?.state || "missing" });
    }
  }
  for (const dependencyRef of wave.depends_on || []) {
    const dependency = waves.get(dependencyRef);
    if (!dependency || !terminalWaveState(dependency.state)) {
      blockers.push({ type: "wave_dependency", ref: dependencyRef, state: dependency?.state || "missing" });
    }
  }
  for (const decisionRef of task.decision_refs || []) {
    const decision = decisions.get(decisionRef);
    if (!decision || decision.state === "open") {
      blockers.push({ type: "open_decision", ref: decisionRef, state: decision?.state || "missing", question: decision?.question || null });
    }
  }
  if (workMaps.review_state !== "ready_for_implementation" || workMaps.implementation_readiness?.status !== "ready") {
    blockers.push({
      type: "work_map_readiness",
      ref: "work-map-integration.json",
      state: `${workMaps.review_state}/${workMaps.implementation_readiness?.status || "missing"}`,
      blocking_dimensions: workMaps.implementation_readiness?.blocking_dimensions || []
    });
  }
  if (!["ready", "in_progress"].includes(task.state)) {
    blockers.push({ type: "task_state", ref: task.id, state: task.state });
  }

  const families = ci.test_families.filter((family) => family.task_refs.includes(task.id));
  const requiredPipelines = ci.pipelines.filter((pipeline) => pipeline.required_for_completion);
  const source = {
    spec_key: development.spec_key,
    contract_key: development.contract_key,
    contract_review_state: development.review_state,
    base_branch: development.source_revision.base_branch,
    base_sha: development.source_revision.base_sha,
    work_map_fingerprint: development.source_revision.work_map_fingerprint || null
  };

  const packetCore = {
    contract: "mad4b.spec014.development-work-packet.v1",
    source,
    task: {
      id: task.id,
      title: task.title,
      state: task.state,
      owner_class: task.owner_class,
      resume_key: task.resume_key,
      parallel_safe: task.parallel_safe || false
    },
    wave: {
      id: wave.id,
      title: wave.title,
      state: wave.state,
      recommended_pr_title: wave.recommended_pr_title || null
    },
    requirements: task.requirement_refs.map((ref) => requirements.get(ref)),
    acceptance_criteria: task.acceptance_refs.map((ref) => acceptance.get(ref)),
    operation_paths: task.operation_path_refs.map((ref) => operations.get(ref)),
    scope: {
      allowed_paths: task.allowed_paths,
      forbidden_actions: task.forbidden_actions,
      rollback_posture: task.rollback_posture
    },
    dependencies: {
      tasks: task.depends_on,
      waves: wave.depends_on,
      decisions: (task.decision_refs || []).map((ref) => decisions.get(ref))
    },
    tests: {
      task_required_tests: task.required_tests,
      families: families.map((family) => ({
        key: family.key,
        title: family.title,
        changed_paths: family.changed_paths,
        commands: family.commands,
        shardable: family.shardable,
        canonical_report: family.canonical_report,
        required_for_completion: family.required_for_completion || false
      }))
    },
    gates: {
      task: task.required_gates,
      wave_entry: wave.entry_gates,
      wave_exit: wave.exit_gates,
      required_pipelines: requiredPipelines.map((pipeline) => ({ key: pipeline.key, candidate_binding: pipeline.candidate_binding }))
    },
    completion_evidence: task.completion_evidence,
    authority: {
      contract_is_authority: development.authority_boundary.contract_is_authority,
      nested_authority_required: development.authority_boundary.nested_authority_required,
      forbidden_automation: development.authority_boundary.forbidden_automation
    },
    status: blockers.length ? "blocked" : "ready",
    blockers,
    secrets_included: false
  };

  const planHash = hash(packetCore);
  const packet = {
    ...packetCore,
    work_packet_id: `WORKPACKET-${task.id}-${planHash.slice(0, 16)}`,
    plan_hash_sha256: planHash,
    generated_at: new Date().toISOString()
  };

  const output = `${JSON.stringify(packet, null, 2)}\n`;
  if (options.output) {
    fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
    fs.writeFileSync(path.resolve(options.output), output);
  } else {
    process.stdout.write(output);
  }

  if (blockers.length && !options.allowBlocked) process.exitCode = 3;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    contract: "mad4b.spec014.development-work-packet-error.v1",
    ok: false,
    error: error.message,
    secrets_included: false
  }, null, 2)}\n`);
  process.exitCode = 1;
}
