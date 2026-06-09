import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/265_sprint68_platform_orchestration_capability_binding.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "platform_orchestration",
  "app_integrations",
  "app_integration_action_bindings",
  "app_integration_tool_bindings",
  "platform_orchestration_readback",
  "ads_provider_governance_snapshot_propose",
  "ads_provider_governance_snapshot_record",
  "credential_source",
  "'none'",
  "provider_calls_allowed",
  "secrets_included",
]) {
  assert(migration.includes(expected), `migration must include ${expected}`);
}

assert(migration.includes("ON DUPLICATE KEY UPDATE"), "migration must be idempotent");
assert(runner.includes("265_sprint68_platform_orchestration_capability_binding.sql"), "governed migration runner must allowlist migration 265");
const forbiddenSql = /\b(DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i;
assert(!forbiddenSql.test(migration), "capability binding migration must not contain destructive SQL");

console.log("platform orchestration capability binding is no-credential, idempotent, and runner-allowlisted");
