#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "scripts", "spec014-refresh-final-work-map-binding.mjs");
const HOSTINGER = "014-governed-hostinger-storage-orchestration";
const RETAIL = "014-retail-commerce-operations-growth-os";

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function run(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: path.resolve(HERE, ".."),
    encoding: "utf8",
  });
  assert.equal(result.status, expectedStatus, `unexpected exit for ${args.join(" ")}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return result;
}

for (const featureKey of [HOSTINGER, RETAIL]) {
  const manifest = path.resolve(HERE, "..", "specs", featureKey, "work-map-integration.json");
  const before = sha256(manifest);
  const result = run(["--feature-key", featureKey, "--check"]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.contract, "mad4b.spec014-final-work-map-binding-check.v1");
  assert.equal(report.feature_key, featureKey);
  assert.equal(report.mode, "check");
  assert.deepEqual(report.changed_files, []);
  assert.equal(report.classification_coverage_percent, 100);
  assert.equal(report.unresolved_schema_objects, 0);
  assert.equal(report.repository_mutation_scope, "none");
  assert.equal(report.secrets_included, false);
  assert.equal(sha256(manifest), before, "check mode must not mutate the manifest");
}

const defaultResult = run(["--check"]);
assert.equal(JSON.parse(defaultResult.stdout).feature_key, HOSTINGER, "default behavior must remain Hostinger-compatible");

const invalidFeature = run(["--feature-key", "../unsafe"], 1);
assert.match(invalidFeature.stderr, /Invalid feature key/);

const missingValue = run(["--feature-key"], 1);
assert.match(missingValue.stderr, /requires a value/);

const unknownArgument = run(["--unexpected"], 1);
assert.match(unknownArgument.stderr, /Unknown argument/);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.spec014-final-work-map-binding-refresh-regression.v1",
  covered_features: [HOSTINGER, RETAIL],
  check_mode_non_mutating: true,
  default_behavior_preserved: true,
  unsafe_feature_keys_rejected: true,
  unknown_arguments_rejected: true
}, null, 2));
