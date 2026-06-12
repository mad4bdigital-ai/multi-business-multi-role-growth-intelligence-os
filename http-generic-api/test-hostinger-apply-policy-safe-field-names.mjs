import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/965_sprint68_hostinger_apply_policy_safe_field_names.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const manifest = readFileSync("scripts/test-manifest.mjs", "utf8");

for (const expected of [
  "965_sprint68_hostinger_apply_policy_safe_field_names.sql",
  "No provider calls",
  "no credential",
  "no raw secrets",
  "no external sends",
  "no deploy execution",
  "secrets_included=false",
  "JSON_REMOVE",
  "$.inline_secret_allowed",
  "$.raw_secret_response_allowed",
  "inline_runtime_value_allowed', false",
  "raw_response_value_return_allowed', false",
  "freeform_shell_allowed', false",
  "CREATE OR REPLACE VIEW v_hostinger_apply_policy_safe_field_readiness",
  "has_inline_secret_allowed_key",
  "has_raw_secret_response_allowed_key",
]) {
  assert.ok(migration.includes(expected), `migration missing ${expected}`);
}

assert.ok(!migration.includes("inline_secret_allowed', false"), "must not set sensitive-looking inline secret key");
assert.ok(!migration.includes("raw_secret_response_allowed', false"), "must not set sensitive-looking raw secret key");
assert.ok(runner.includes("965_sprint68_hostinger_apply_policy_safe_field_names.sql"), "runner must allowlist 965");
assert.ok(manifest.includes("node test-hostinger-apply-policy-safe-field-names.mjs"), "manifest must include safe field names test");

console.log("Official Hostinger apply policy safe field-name migration contract OK");
