import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/964_sprint68_hostinger_stored_credential_apply_policy.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const manifest = readFileSync("scripts/test-manifest.mjs", "utf8");

for (const expected of [
  "964_sprint68_hostinger_stored_credential_apply_policy.sql",
  "hostinger_deploy_release_apply_policy_v1",
  "hostinger_restart_app_apply_policy_v1",
  "allow_credential_binding = 1",
  "stored_credential_binding_allowed', true",
  "credential_payload_read_allowed', false",
  "inline_secret_allowed', false",
  "raw_secret_response_allowed', false",
  "freeform_shell_allowed', false",
  "requires_post_deploy_readback",
  "requires_post_restart_readback",
  "CREATE OR REPLACE VIEW v_hostinger_apply_policy_readiness",
  "secrets_included",
]) {
  assert.ok(migration.includes(expected), `migration missing ${expected}`);
}

assert.ok(!migration.includes("credential_payload_read_allowed', true"), "must not allow credential payload reads");
assert.ok(!migration.includes("inline_secret_allowed', true"), "must not allow inline secrets");
assert.ok(!migration.includes("raw_secret_response_allowed', true"), "must not allow raw secret response");
assert.ok(!migration.includes("freeform_shell_allowed', true"), "must not allow freeform shell");
assert.ok(runner.includes("964_sprint68_hostinger_stored_credential_apply_policy.sql"), "runner must allowlist 964");
assert.ok(manifest.includes("node test-hostinger-stored-credential-apply-policy.mjs"), "manifest must include Hostinger stored credential policy test");

console.log("Hostinger stored credential apply policy contract OK");
