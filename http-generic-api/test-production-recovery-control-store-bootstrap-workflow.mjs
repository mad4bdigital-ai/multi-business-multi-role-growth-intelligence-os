import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const workflowPath = path.join(root, ".github", "workflows", "production-runtime-parity-evidence.yml");
const standalonePath = path.join(root, ".github", "workflows", "production-recovery-control-store-bootstrap.yml");
const source = fs.readFileSync(workflowPath, "utf8");
const bridgeSource = fs.readFileSync(path.join(root, ".github", "workflows", "governed-production-promotion-dispatch-bridge.yml"), "utf8");

assert.equal(
  fs.existsSync(standalonePath),
  false,
  "Recovery Control Store bootstrap must reuse the existing Production parity workflow instead of adding CI workflow surface.",
);

for (const required of [
  "control_store_status",
  "control_store_plan",
  "control_store_apply_schema",
  "bootstrap_control_store_plan_sha256",
  "bootstrap_control_store_confirmation",
  "APPLY_PRODUCTION_RECOVERY_CONTROL_STORE_SCHEMA",
  "https://auth.mad4b.com/admin/recovery-bootstrap",
  "/status?expected_sha=",
  "/plan",
  "/apply",
  "environment: Production",
  "x-api-key",
  "same_cycle_readback_performed",
  "target_database_mutation_performed",
  "provider_mutation_performed",
  "production_runtime_mutation_performed",
  "secrets_included",
]) {
  assert(source.includes(required), `Production parity workflow missing bounded control-store contract: ${required}`);
}

for (const forbidden of [
  "RECOVERY_CONTROL_DB_PASSWORD:",
  "HOSTINGER_API_TOKEN:",
  "control_store_raw_sql",
  "control_store_database_name",
  "control_store_username",
  "control_store_password",
]) {
  assert(!source.includes(forbidden), `Control-store workflow integration must not expose forbidden caller input: ${forbidden}`);
}

assert.match(
  source,
  /inputs\.bootstrap_target_source == 'repository_allowlist' && inputs\.bootstrap_mode != 'plan' && !startsWith\(inputs\.bootstrap_mode, 'control_store_'\)/u,
);
assert.match(source, /BOOTSTRAP_CONTROL_STORE_PLAN_SHA256.*\{\{ inputs\.bootstrap_control_store_plan_sha256 \}\}/u);
assert.match(source, /BOOTSTRAP_CONTROL_STORE_CONFIRMATION.*\{\{ inputs\.bootstrap_control_store_confirmation \}\}/u);
assert.match(source, /\^\[0-9a-fA-F\]\{64\}\$/u);
assert.match(source, /\^\[0-9a-fA-F\]\{40\}\$/u);
assert.match(source, /control_store_bootstrap_unrelated_authority_denied/u);
assert.match(source, /startsWith\(inputs\.bootstrap_mode, 'control_store_'\)/u);

console.log("production recovery control-store bootstrap workflow integration tests passed");


for (const required of [
  "PLAN_PRODUCTION_RECOVERY_CONTROL_STORE:",
  "APPLY_PRODUCTION_RECOVERY_CONTROL_STORE_SCHEMA:",
  "production-recovery-control-store-plan",
  "production-recovery-control-store-apply",
  "https://auth.mad4b.com/admin/recovery-bootstrap",
  "mad4b.production-recovery-control-store-bootstrap-plan.v1",
  "same_cycle_readback_performed",
  "automatic_replay_allowed",
]) {
  assert(bridgeSource.includes(required), `Governed issue bridge missing bounded Control Store contract: ${required}`);
}

assert.match(bridgeSource, /github\.event\.issue\.number == 6813/u);
assert.match(bridgeSource, /\^PLAN_PRODUCTION_RECOVERY_CONTROL_STORE:\(\[0-9a-f\]\{40\}\)\$/u);
assert.match(bridgeSource, /\^APPLY_PRODUCTION_RECOVERY_CONTROL_STORE_SCHEMA:\(\[0-9a-f\]\{40\}\):\(\[0-9a-f\]\{64\}\)\$/u);
assert.match(bridgeSource, /APPLY_PRODUCTION_RECOVERY_CONTROL_STORE_SCHEMA/u);
assert.match(bridgeSource, /target_database_mutation_performed/u);
assert.match(bridgeSource, /provider_mutation_performed/u);
assert.match(bridgeSource, /production_runtime_mutation_performed/u);
assert.doesNotMatch(bridgeSource, /RECOVERY_CONTROL_DB_PASSWORD:/u);
assert.doesNotMatch(bridgeSource, /control_store_raw_sql/u);

// Regression: GET-only Control Store plan has "secrets_included":false.
// Extract the real jq expressions; never waive checks for credential fields.
import { spawnSync } from "node:child_process";

const planValidation = bridgeSource.match(/jq -e --arg sha "\$\{expected_sha\}" '([\s\S]*?)' "\$\{plan_file\}" >\/dev\/null/u);
assert.ok(planValidation, "Missing exact Control Store plan jq validator");
const resultEnd = bridgeSource.indexOf("' \"" + "$" + "{result_file}\" >/dev/null");
const resultStart = bridgeSource.lastIndexOf("jq -e '", resultEnd);
assert.ok(resultEnd > 0 && resultStart >= 0, "Missing exact Control Store apply-receipt jq validator");
const validators = [
  { name: "plan", expression: planValidation[1], args: ["--arg", "sha", "e0c07f6fba431650b87d7a6f3dde76a364be6223"] },
  { name: "apply receipt", expression: bridgeSource.slice(resultStart + "jq -e '".length, resultEnd), args: [] },
];
for (const { name, expression } of validators) {
  assert.match(expression, /\.secrets_included\? \| select\(\. != null\)/u, name + " must inspect nested flags");
  assert.match(expression, /select\(\. != "secrets_included" and test\(/u, name + " must exclude only the harmless boolean flag");
}

const jqAvailable = spawnSync("jq", ["--version"], { encoding: "utf8" });
if (!jqAvailable.error && jqAvailable.status === 0) {
  const exactSha = "e0c07f6fba431650b87d7a6f3dde76a364be6223";
  const goodPlan = {
    contract: "mad4b.production-recovery-control-store-bootstrap-plan.v1",
    expected_sha: exactSha,
    secrets_included: false,
    execution_allowed: false,
    action: "blocked_control_store_configuration",
    control_store: { ready: false },
  };
  const goodReceipt = { secrets_included: false, status: "control_store_schema_ready" };
  for (const { name, expression, args } of validators) {
    const fixture = name === "plan" ? goodPlan : goodReceipt;
    const run = (data) => spawnSync("jq", ["-e", ...args, expression], {
      input: JSON.stringify(data), encoding: "utf8",
    });
    const good = run(fixture);
    assert.equal(good.status, 0, name + " should accept a safe false flag: " + good.stderr);
    for (const [reason, changes] of [
      ["actual credential field", { credential_value: "must-reject" }],
      ["private key field", { private_key: "must-reject" }],
      ["positive flag", { secrets_included: true }],
      ["nested positive flag", { control_store: { secrets_included: true } }],
    ]) {
      assert.notEqual(run({ ...fixture, ...changes }).status, 0, name + " accepted unsafe " + reason);
    }
  }
  const wrongSha = spawnSync("jq", ["-e", ...validators[0].args, validators[0].expression], {
    input: JSON.stringify({ ...goodPlan, expected_sha: "f".repeat(40) }), encoding: "utf8",
  });
  assert.notEqual(wrongSha.status, 0, "Control Store plan must reject unexpected Production SHA");
} else {
  console.log("jq not found: static validator guards tested (runtime jq fixtures skipped)");
}

