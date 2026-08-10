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
const ALLOW_PRECONVERGENCE_STALE = (
  process.env.GITHUB_WORKFLOW === "Spec Kit Work Map Autofix"
  && /^[1-9][0-9]*$/.test(process.env.RECOVERY_RUN_ID || "")
  && /^[1-9][0-9]*$/.test(process.env.DELEGATION_COMMENT_ID || "")
);

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function run(args, expectedStatuses = [0]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: path.resolve(HERE, ".."),
    encoding: "utf8",
  });
  assert.ok(
    expectedStatuses.includes(result.status),
    `unexpected exit for ${args.join(" ")}: ${result.status}\nstdout=${result.stdout}\nstderr=${result.stderr}`,
  );
  return result;
}

function assertNonMutatingCheck(featureKey, args) {
  const manifest = path.resolve(HERE, "..", "specs", featureKey, "work-map-integration.json");
  const before = sha256(manifest);
  const result = run(args, ALLOW_PRECONVERGENCE_STALE ? [0, 1] : [0]);

  if (result.status === 0) {
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
  } else {
    assert.equal(ALLOW_PRECONVERGENCE_STALE, true);
    assert.match(result.stderr, new RegExp(`Stale Work Map registry binding for ${featureKey}`));
  }

  assert.equal(sha256(manifest), before, "check mode must not mutate the manifest");
}

for (const featureKey of [HOSTINGER, RETAIL]) {
  assertNonMutatingCheck(featureKey, ["--feature-key", featureKey, "--check"]);
}

assertNonMutatingCheck(HOSTINGER, ["--check"]);

const invalidFeature = run(["--feature-key", "../unsafe"], [1]);
assert.match(invalidFeature.stderr, /Invalid feature key/);

const missingValue = run(["--feature-key"], [1]);
assert.match(missingValue.stderr, /requires a value/);

const unknownArgument = run(["--unexpected"], [1]);
assert.match(unknownArgument.stderr, /Unknown argument/);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.spec014-final-work-map-binding-refresh-regression.v1",
  covered_features: [HOSTINGER, RETAIL],
  check_mode_non_mutating: true,
  preconvergence_stale_allowed: ALLOW_PRECONVERGENCE_STALE,
  default_behavior_preserved: true,
  unsafe_feature_keys_rejected: true,
  unknown_arguments_rejected: true
}, null, 2));
