import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const workflowPath = path.join(root, ".github", "workflows", "production-runtime-parity-evidence.yml");
const standalonePath = path.join(root, ".github", "workflows", "production-recovery-control-store-bootstrap.yml");
const source = fs.readFileSync(workflowPath, "utf8");

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
