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


// The immutable plan has the safe flag secrets_included:false. Do not reject
// that field's name, but continue rejecting actual secrets and nested true flags.
import { spawnSync } from "node:child_process";

const planValidator = bridgeSource.match(
  /jq -e --arg sha "\$\{expected_sha\}" '([\s\S]*?)' "\$\{plan_file\}" >\/dev\/null/u,
);
assert.ok(planValidator, "Missing exact Production Recovery plan validator");
const receiptEnd = bridgeSource.indexOf("' \"" + "$" + "{result_file}\" >/dev/null");
const receiptStart = bridgeSource.lastIndexOf("jq -e '", receiptEnd);
assert.ok(receiptEnd > 0 && receiptStart >= 0, "Missing exact apply-receipt validator");

const validators = [
  {
    name: "plan",
    expression: planValidator[1],
    argv: ["--arg", "sha", "6dbb8760dc7ee1b7fa69ce2fdc3a58889c09a12b"],
    fixture: {
      contract: "mad4b.production-recovery-control-store-bootstrap-plan.v1",
      expected_sha: "6dbb8760dc7ee1b7fa69ce2fdc3a58889c09a12b",
      secrets_included: false,
      execution_allowed: false,
      action: "blocked_control_store_configuration",
      control_store: { ready: false, secrets_included: false },
    },
  },
  {
    name: "apply receipt",
    expression: bridgeSource.slice(receiptStart + "jq -e '".length, receiptEnd),
    argv: [],
    fixture: { secrets_included: false, status: "control_store_schema_ready",
      control_store: { secrets_included: false } },
  },
];
for (const { name, expression } of validators) {
  assert.match(expression, /\.secrets_included\? \| select\(\. != null\)/u,
    name + ": nested safe flag must be verified");
  assert.match(expression, /select\(\. != "secrets_included" and test\(/u,
    name + ": exclude only the exact harmless evidence field");
}
const jq = spawnSync("jq", ["--version"], { encoding: "utf8" });
if (!jq.error && jq.status === 0) {
  for (const { name, expression, argv, fixture } of validators) {
    const run = (obj) => spawnSync("jq", ["-e", ...argv, expression], {
      input: JSON.stringify(obj), encoding: "utf8", timeout: 5000,
    });
    assert.equal(run(fixture).status, 0, name + ": rejects safe false flag");
    const rejected = [
      { ...fixture, secrets_included: true },
      { ...fixture, control_store: { secrets_included: true } },
      { ...fixture, private_key: "never-publish" },
      { ...fixture, credential_value: "never-publish" },
      { ...fixture, control_store: { password: "never-publish" } },
    ];
    for (const unsafe of rejected) {
      assert.notEqual(run(unsafe).status, 0, name + ": accepted secret-bearing evidence");
    }
  }
  const plan = validators[0];
  assert.notEqual(
    spawnSync("jq", ["-e", ...plan.argv, plan.expression], {
      input: JSON.stringify({ ...plan.fixture, expected_sha: "f".repeat(40) }),
      encoding: "utf8", timeout: 5000,
    }).status,
    0, "Production Control Store plan must reject a stale SHA",
  );
} else {
  console.log("jq unavailable; source-only validator assertions passed");
}
