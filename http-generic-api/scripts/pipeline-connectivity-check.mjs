#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(HERE, "../..");
const DEFAULT_CONTRACT = ".specify/pipeline-connectivity-contract.json";

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function listFiles(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full, predicate);
    return predicate(full) ? [full] : [];
  }).sort();
}

function topLevelBlock(text, key) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*$`).test(line));
  if (start === -1) return "";
  const collected = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z0-9_-]+:\s*/.test(line)) break;
    collected.push(line);
  }
  return collected.join("\n");
}

function indentation(line) {
  return line.match(/^\s*/)?.[0].length || 0;
}

function normalizeExecutableCommand(command) {
  return command
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
    .replace(/\\\s*\n\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function executableCommands(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const commands = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const run = line.match(/^\s*run:\s*(.*?)\s*$/);
    if (!run) continue;

    const value = run[1];
    const blockScalar = /^[|>][-+0-9]*$/.test(value);
    if (!blockScalar) {
      if (value) commands.push(value);
      continue;
    }

    const baseIndent = indentation(line);
    const block = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor];
      if (candidate.trim() && indentation(candidate) <= baseIndent) break;
      block.push(candidate);
      index = cursor;
    }
    commands.push(block.join("\n"));
  }

  return commands.map(normalizeExecutableCommand).filter(Boolean).join("\n");
}

function detectTriggers(text) {
  const block = topLevelBlock(text, "on");
  return ["workflow_dispatch", "pull_request", "push", "schedule", "workflow_run"]
    .filter((trigger) => new RegExp(`^\\s{2}${trigger}:`, "m").test(block));
}

function detectPermission(text, permission) {
  const block = topLevelBlock(text, "permissions");
  return block.match(new RegExp(`^\\s{2}${permission}:\\s*([A-Za-z_-]+)\\s*$`, "m"))?.[1] || null;
}

function uniq(values) {
  return [...new Set(values)];
}

function finding(code, message, details = {}) {
  return { code, message, ...details };
}

function setsEqual(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function validateContractShape(contract, findings) {
  if (contract?.version !== 1) findings.push(finding("UNSUPPORTED_CONTRACT_VERSION", "Pipeline connectivity contract version must equal 1."));
  if (!Array.isArray(contract?.pipelines) || contract.pipelines.length === 0) findings.push(finding("PIPELINES_REQUIRED", "At least one pipeline contract is required."));
  if (!Array.isArray(contract?.artifact_groups) || contract.artifact_groups.length === 0) findings.push(finding("ARTIFACT_GROUPS_REQUIRED", "At least one artifact group is required."));
  if (!Array.isArray(contract?.edges) || contract.edges.length === 0) findings.push(finding("EDGES_REQUIRED", "At least one connectivity edge is required."));
}

export function validatePipelineConnectivity({ repoRoot = DEFAULT_REPO_ROOT, contractPath = DEFAULT_CONTRACT } = {}) {
  const absoluteContract = path.resolve(repoRoot, contractPath);
  const findings = [];
  if (!fs.existsSync(absoluteContract)) {
    return { ok: false, findings: [finding("CONTRACT_MISSING", `Pipeline connectivity contract is missing: ${contractPath}`)] };
  }

  let contract;
  try {
    contract = readJson(absoluteContract);
  } catch (error) {
    return { ok: false, findings: [finding("CONTRACT_INVALID_JSON", error.message)] };
  }

  validateContractShape(contract, findings);
  const pipelineRows = Array.isArray(contract.pipelines) ? contract.pipelines : [];
  const artifactRows = Array.isArray(contract.artifact_groups) ? contract.artifact_groups : [];
  const edgeRows = Array.isArray(contract.edges) ? contract.edges : [];
  const pipelineKeys = pipelineRows.map((row) => row?.key).filter(Boolean);
  const artifactKeys = artifactRows.map((row) => row?.key).filter(Boolean);

  for (const key of uniq(pipelineKeys)) {
    if (pipelineKeys.filter((value) => value === key).length > 1) findings.push(finding("DUPLICATE_PIPELINE_KEY", `Duplicate pipeline key: ${key}`, { pipeline: key }));
  }
  for (const key of uniq(artifactKeys)) {
    if (artifactKeys.filter((value) => value === key).length > 1) findings.push(finding("DUPLICATE_ARTIFACT_KEY", `Duplicate artifact group key: ${key}`, { artifact_group: key }));
  }

  const workflowPathToKey = new Map();
  for (const pipeline of pipelineRows) {
    if (!pipeline?.key || !pipeline?.workflow) {
      findings.push(finding("PIPELINE_IDENTITY_REQUIRED", "Every pipeline requires key and workflow fields."));
      continue;
    }
    const workflowFile = path.resolve(repoRoot, pipeline.workflow);
    const text = readText(workflowFile);
    if (!text) {
      findings.push(finding("WORKFLOW_MISSING", `Workflow is missing or empty: ${pipeline.workflow}`, { pipeline: pipeline.key }));
      continue;
    }
    workflowPathToKey.set(path.resolve(workflowFile), pipeline.key);

    for (const [permission, expected] of Object.entries(pipeline.required_permissions || {})) {
      const actual = detectPermission(text, permission);
      if (actual !== expected) findings.push(finding("PIPELINE_PERMISSION_MISMATCH", `${pipeline.key} requires ${permission}: ${expected}, found ${actual || "unset"}.`, { pipeline: pipeline.key, permission, expected, actual }));
    }

    const triggers = new Set(detectTriggers(text));
    for (const trigger of pipeline.required_triggers || []) {
      if (!triggers.has(trigger)) findings.push(finding("REQUIRED_TRIGGER_DISCONNECTED", `${pipeline.key} is missing required trigger ${trigger}.`, { pipeline: pipeline.key, trigger }));
    }
    for (const trigger of pipeline.forbidden_triggers || []) {
      if (triggers.has(trigger)) findings.push(finding("FORBIDDEN_TRIGGER_CONNECTED", `${pipeline.key} exposes forbidden trigger ${trigger}.`, { pipeline: pipeline.key, trigger }));
    }
    for (const requiredPath of pipeline.required_path_patterns || []) {
      if (!text.includes(requiredPath)) findings.push(finding("REQUIRED_PATH_DISCONNECTED", `${pipeline.key} does not react to ${requiredPath}.`, { pipeline: pipeline.key, path: requiredPath }));
    }
    for (const command of pipeline.required_commands || []) {
      if (!text.includes(command)) findings.push(finding("REQUIRED_COMMAND_DISCONNECTED", `${pipeline.key} is missing required command or guard: ${command}`, { pipeline: pipeline.key, command }));
    }
    for (const command of pipeline.forbidden_commands || []) {
      if (text.includes(command)) findings.push(finding("FORBIDDEN_COMMAND_CONNECTED", `${pipeline.key} contains forbidden command: ${command}`, { pipeline: pipeline.key, command }));
    }
  }

  const allNodeKeys = new Set([...pipelineKeys, ...artifactKeys]);
  const edgeIds = [];
  for (const edge of edgeRows) {
    if (!edge?.from || !edge?.to || !edge?.type) {
      findings.push(finding("EDGE_FIELDS_REQUIRED", "Every edge requires from, to, and type."));
      continue;
    }
    if (!allNodeKeys.has(edge.from)) findings.push(finding("EDGE_SOURCE_MISSING", `Edge source is not declared: ${edge.from}`, { edge }));
    if (!allNodeKeys.has(edge.to)) findings.push(finding("EDGE_TARGET_MISSING", `Edge target is not declared: ${edge.to}`, { edge }));
    edgeIds.push(`${edge.from}|${edge.to}|${edge.type}`);
  }
  for (const edgeId of uniq(edgeIds)) {
    if (edgeIds.filter((value) => value === edgeId).length > 1) findings.push(finding("DUPLICATE_EDGE", `Duplicate connectivity edge: ${edgeId}`));
  }

  const workflowFiles = listFiles(path.join(repoRoot, ".github/workflows"), (file) => /\.ya?ml$/i.test(file));
  for (const artifact of artifactRows) {
    const approvedProducers = new Set(artifact.approved_producers || []);
    const requiredConsumers = new Set(artifact.required_consumers || []);
    const actualProducerPaths = workflowFiles.filter((file) => {
      const commandText = executableCommands(readText(file));
      return (artifact.producer_signatures || []).some((signature) => commandText.includes(signature));
    });
    const actualConsumerPaths = workflowFiles.filter((file) => {
      const commandText = executableCommands(readText(file));
      return (artifact.consumer_signatures || []).some((signature) => commandText.includes(signature));
    });
    const actualProducerKeys = new Set(actualProducerPaths.map((file) => workflowPathToKey.get(path.resolve(file)) || `unregistered:${path.relative(repoRoot, file).replaceAll("\\", "/")}`));
    const actualConsumerKeys = new Set(actualConsumerPaths.map((file) => workflowPathToKey.get(path.resolve(file)) || `unregistered:${path.relative(repoRoot, file).replaceAll("\\", "/")}`));

    for (const file of actualProducerPaths) {
      if (!workflowPathToKey.has(path.resolve(file))) findings.push(finding("UNDECLARED_ARTIFACT_PRODUCER", `Workflow writes ${artifact.key} but has no pipeline contract: ${path.relative(repoRoot, file)}`, { artifact_group: artifact.key }));
    }
    for (const file of actualConsumerPaths) {
      if (!workflowPathToKey.has(path.resolve(file))) findings.push(finding("UNDECLARED_ARTIFACT_CONSUMER", `Workflow validates ${artifact.key} but has no pipeline contract: ${path.relative(repoRoot, file)}`, { artifact_group: artifact.key }));
    }
    if (!setsEqual(actualProducerKeys, approvedProducers)) findings.push(finding("ARTIFACT_PRODUCER_SET_MISMATCH", `${artifact.key} producer set differs from the contract.`, { artifact_group: artifact.key, expected: [...approvedProducers].sort(), actual: [...actualProducerKeys].sort() }));
    for (const consumer of requiredConsumers) {
      if (!actualConsumerKeys.has(consumer)) findings.push(finding("ARTIFACT_CONSUMER_DISCONNECTED", `${artifact.key} is not consumed by required pipeline ${consumer}.`, { artifact_group: artifact.key, pipeline: consumer }));
    }

    for (const producer of approvedProducers) {
      if (!edgeRows.some((edge) => edge.from === producer && edge.to === artifact.key)) findings.push(finding("PRODUCER_EDGE_MISSING", `${producer} has no producer edge to ${artifact.key}.`, { artifact_group: artifact.key, pipeline: producer }));
    }
    for (const consumer of requiredConsumers) {
      if (!edgeRows.some((edge) => edge.from === artifact.key && edge.to === consumer)) findings.push(finding("CONSUMER_EDGE_MISSING", `${artifact.key} has no consumer edge to ${consumer}.`, { artifact_group: artifact.key, pipeline: consumer }));
    }
  }

  return {
    ok: findings.length === 0,
    contract_version: contract?.version ?? null,
    pipeline_count: pipelineRows.length,
    artifact_group_count: artifactRows.length,
    edge_count: edgeRows.length,
    findings,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = validatePipelineConnectivity({
    repoRoot: process.env.PIPELINE_CONNECTIVITY_REPO_ROOT || DEFAULT_REPO_ROOT,
    contractPath: process.env.PIPELINE_CONNECTIVITY_CONTRACT || DEFAULT_CONTRACT,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exit(1);
}
