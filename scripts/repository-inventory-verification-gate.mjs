#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CONTRACT = "mad4b.repository-inventory-verification-gate.v2";
const OUTPUTS = [
  "docs/repository-inventory.json",
  "docs/repository-inventory-summary.json",
  "docs/repository-inventory.md",
];
const FULL_SHA = /^[0-9a-f]{40}$/u;

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2).replace(/-/gu, "_");
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argv[i]} requires a value`);
    out[key] = value; i += 1;
  }
  return out;
}
function run(command, argv, { allowFailure = false } = {}) {
  const result = spawnSync(command, argv, { cwd: process.cwd(), encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: process.env });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) throw new Error(`${command} ${argv.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result;
}
function git(argv, options) { return run("git", argv, options); }
function hashOutputs() {
  return Object.fromEntries(OUTPUTS.map((file) => [file, crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")]));
}
function sameHashes(a, b) { return OUTPUTS.every((file) => a[file] === b[file]); }
function write(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  console.log(JSON.stringify(value));
}
function restoreOutputs() {
  git(["checkout", "--", ...OUTPUTS], { allowFailure: true });
}
const input = args(process.argv);
const output = input.output || "repository-inventory-verification.json";
const expected = input.expected_head_sha || process.env.GITHUB_SHA || "";
const actual = git(["rev-parse", "HEAD"]).stdout.trim();
const registry = JSON.parse(fs.readFileSync(".github/derived-state-governance.json", "utf8"));
const artifact = (registry.artifacts || []).find((entry) => entry.artifact_id === "repository_inventory");
if (!artifact) throw new Error("repository_inventory artifact is not registered");
if (!FULL_SHA.test(expected) || actual !== expected) {
  write(output, { contract: CONTRACT, outcome: "failed", reason: "exact_head_mismatch", expected_head_sha: expected, actual_head_sha: actual, blocking: true });
  process.exit(1);
}
const before = Object.fromEntries(OUTPUTS.map((file) => [file, fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null]));
let first, second;
try {
  run(process.execPath, ["scripts/repository-inventory.mjs"]);
  first = hashOutputs();
  run("npm", ["run", "inventory:check"]);
  run("npm", ["run", "inventory:test"]);
  run(process.execPath, ["scripts/repository-inventory.mjs"]);
  second = hashOutputs();
  run("npm", ["run", "inventory:check"]);
  run("npm", ["run", "inventory:test"]);
} catch (error) {
  restoreOutputs();
  write(output, {
    contract: CONTRACT, outcome: "failed", reason: "generation_or_contract_failure",
    expected_head_sha: expected, actual_head_sha: actual, blocking: true,
    diagnostic: String(error.message).slice(0, 3000),
  });
  process.exit(1);
}
if (!sameHashes(first, second)) {
  restoreOutputs();
  write(output, { contract: CONTRACT, outcome: "failed", reason: "nondeterministic_generation", blocking: true, first, second });
  process.exit(1);
}
const changed = OUTPUTS.filter((file) => before[file] !== second[file]);
restoreOutputs();
if (!changed.length) {
  write(output, {
    contract: CONTRACT, outcome: "passed", inventory_state: "current", current: true,
    blocking: false, artifact_class: artifact.artifact_class, merge_blocking: artifact.merge_blocking,
    exact_head_sha: actual, deterministic_generation_verified: true, followup_required: false,
  });
  process.exit(0);
}
if (artifact.artifact_class === "observability" && artifact.merge_blocking === false && registry.policy?.observability_artifacts_publish_post_merge_only === true) {
  write(output, {
    contract: CONTRACT, outcome: "advisory", inventory_state: "stale_observability",
    current: false, blocking: false, artifact_class: artifact.artifact_class,
    merge_blocking: artifact.merge_blocking, exact_head_sha: actual,
    deterministic_generation_verified: true, dirty_files: changed,
    followup_required: true, followup_mode: "post_merge_observability_publish",
    objection: {
      policy_id: "derived-state:repository_inventory",
      severity: "advisory",
      remediation: "Publish Repository Inventory after merge; pre-merge feature-branch mutation is forbidden."
    }
  });
  process.exit(0);
}
write(output, {
  contract: CONTRACT, outcome: "failed", inventory_state: "stale_blocking",
  current: false, blocking: true, artifact_class: artifact.artifact_class,
  merge_blocking: artifact.merge_blocking, exact_head_sha: actual,
  deterministic_generation_verified: true, dirty_files: changed,
});
process.exit(1);
