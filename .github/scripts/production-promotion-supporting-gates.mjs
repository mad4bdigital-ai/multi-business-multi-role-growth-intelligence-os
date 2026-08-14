#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";

const CONTRACT = "mad4b.production-promotion-supporting-gates.v1";
const MODES = new Set(["human", "ai_policy"]);
const TOP_LEVEL_KEYS = new Set(["contract", "version", "gates", "safety"]);
const GATE_KEYS = new Set(["id", "label", "workflow", "required", "effect", "modes", "inputs"]);
const SAFETY_KEYS = new Set([
  "production_merge",
  "deployment",
  "migration_apply",
  "grant_apply",
  "provider_mutation",
  "credential_payload_read",
  "secrets_included",
]);
const PLACEHOLDERS = new Set(["release_branch", "candidate_sha"]);
const SECRETISH = /(secret|token|password|credential|private[_-]?key|authorization)/iu;
const FULL_SHA = /^[0-9a-f]{40}$/u;
const WORKFLOW = /^[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/u;
const GATE_ID = /^[a-z][a-z0-9_]{2,79}$/u;

function fail(message) {
  throw new Error(message);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
}

function assertExactKeys(value, keys, label) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) fail(`${label} contains unsupported field: ${key}`);
  }
}

function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateTemplate(value, label) {
  if (typeof value !== "string" || value.length > 200 || /[\r\n\0]/u.test(value)) {
    fail(`${label} must be a bounded single-line string`);
  }
  const matches = [...value.matchAll(/\{\{([a-z_]+)\}\}/gu)];
  for (const match of matches) {
    if (!PLACEHOLDERS.has(match[1])) fail(`${label} uses unsupported placeholder: ${match[1]}`);
  }
  const scrubbed = value.replace(/\{\{[a-z_]+\}\}/gu, "");
  if (/[{}]/u.test(scrubbed)) fail(`${label} contains malformed template braces`);
}

export function validateGateRegistry(registry) {
  assertObject(registry, "registry");
  assertExactKeys(registry, TOP_LEVEL_KEYS, "registry");
  if (registry.contract !== CONTRACT) fail(`registry contract must equal ${CONTRACT}`);
  if (registry.version !== 1) fail("registry version must equal 1");
  if (!Array.isArray(registry.gates) || registry.gates.length === 0 || registry.gates.length > 20) {
    fail("registry.gates must contain between 1 and 20 entries");
  }
  assertObject(registry.safety, "registry.safety");
  assertExactKeys(registry.safety, SAFETY_KEYS, "registry.safety");
  for (const key of SAFETY_KEYS) {
    if (registry.safety[key] !== false) fail(`registry.safety.${key} must remain false`);
  }

  const ids = new Set();
  const workflows = new Set();
  for (const [index, gate] of registry.gates.entries()) {
    const label = `registry.gates[${index}]`;
    assertObject(gate, label);
    assertExactKeys(gate, GATE_KEYS, label);
    if (typeof gate.id !== "string" || !GATE_ID.test(gate.id)) fail(`${label}.id is invalid`);
    if (ids.has(gate.id)) fail(`duplicate gate id: ${gate.id}`);
    ids.add(gate.id);
    if (typeof gate.label !== "string" || gate.label.length < 3 || gate.label.length > 120 || /[\r\n]/u.test(gate.label)) {
      fail(`${label}.label is invalid`);
    }
    if (typeof gate.workflow !== "string" || !WORKFLOW.test(gate.workflow)) fail(`${label}.workflow is invalid`);
    if (workflows.has(gate.workflow)) fail(`duplicate gate workflow: ${gate.workflow}`);
    workflows.add(gate.workflow);
    if (gate.required !== true) fail(`${label}.required must be true for the current critical promotion registry`);
    if (gate.effect !== "read_only") fail(`${label}.effect must be read_only`);
    if (!Array.isArray(gate.modes) || gate.modes.length === 0) fail(`${label}.modes must be non-empty`);
    const modeSet = new Set(gate.modes);
    if (modeSet.size !== gate.modes.length) fail(`${label}.modes contains duplicates`);
    for (const mode of gate.modes) if (!MODES.has(mode)) fail(`${label}.modes contains unsupported mode: ${mode}`);
    assertObject(gate.inputs, `${label}.inputs`);
    if (Object.keys(gate.inputs).length > 12) fail(`${label}.inputs exceeds the bounded field count`);
    for (const [key, value] of Object.entries(gate.inputs)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key)) fail(`${label}.inputs contains invalid key: ${key}`);
      if (SECRETISH.test(key)) fail(`${label}.inputs contains secret-like key: ${key}`);
      validateTemplate(value, `${label}.inputs.${key}`);
    }
  }
  return registry;
}

function resolveTemplate(value, context) {
  return value.replace(/\{\{([a-z_]+)\}\}/gu, (_, key) => context[key]);
}

export function resolveSupportingGates(registry, { reviewMode, releaseBranch, candidateSha }) {
  validateGateRegistry(registry);
  if (!MODES.has(reviewMode)) fail(`unsupported review mode: ${reviewMode}`);
  if (typeof releaseBranch !== "string" || releaseBranch.length < 3 || releaseBranch.length > 180 || /[\s~^:?*\[\\]/u.test(releaseBranch)) {
    fail("releaseBranch is invalid");
  }
  if (releaseBranch === "main" || releaseBranch === "Production" || releaseBranch.startsWith("refs/")) {
    fail("releaseBranch must be a non-protected branch");
  }
  if (!FULL_SHA.test(candidateSha)) fail("candidateSha must be an exact lowercase SHA");
  const context = { release_branch: releaseBranch, candidate_sha: candidateSha };
  const gates = registry.gates
    .filter((gate) => gate.modes.includes(reviewMode))
    .map((gate) => ({
      id: gate.id,
      label: gate.label,
      workflow: gate.workflow,
      required: gate.required,
      effect: gate.effect,
      ref: releaseBranch,
      expected_head_sha: candidateSha,
      inputs: Object.fromEntries(Object.entries(gate.inputs).map(([key, value]) => [key, resolveTemplate(value, context)])),
    }));
  if (gates.length === 0) fail(`no supporting gates registered for review mode: ${reviewMode}`);
  return {
    contract: "mad4b.production-promotion-supporting-gate-plan.v1",
    review_mode: reviewMode,
    release_branch: releaseBranch,
    candidate_sha: candidateSha,
    registry_sha256: crypto.createHash("sha256").update(canonicalStringify(registry)).digest("hex"),
    gates,
    safety: { ...registry.safety },
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).replace(/-/gu, "_");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${token} requires a value`);
    args[key] = value;
    index += 1;
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv);
  if (!args.registry || !args.review_mode || !args.release_branch || !args.candidate_sha) {
    fail("required arguments: --registry --review-mode --release-branch --candidate-sha");
  }
  const raw = fs.readFileSync(args.registry, "utf8");
  const registry = JSON.parse(raw);
  const plan = resolveSupportingGates(registry, {
    reviewMode: args.review_mode,
    releaseBranch: args.release_branch,
    candidateSha: args.candidate_sha,
  });
  const output = `${JSON.stringify(plan, null, 2)}\n`;
  if (args.output) fs.writeFileSync(args.output, output);
  process.stdout.write(output);
}
