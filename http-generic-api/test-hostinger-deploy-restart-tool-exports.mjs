import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/963_sprint68_hostinger_deploy_restart_tool_exports.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const manifest = readFileSync("scripts/test-manifest.mjs", "utf8");

for (const expected of [
  "963_sprint68_hostinger_deploy_restart_tool_exports.sql",
  "hostinger_api.remote_runtime_hostinger_deploy_release.admin_export",
  "hostinger_api.hostinger_ssh_restart_app.admin_export",
  "remote_runtime_hostinger_deploy_release",
  "hostinger_ssh_restart_app",
  "bind_tool_hostinger_remote_runtime_deploy_release",
  "bind_tool_hostinger_ssh_restart_app",
  "requires_capability_envelope_for_apply",
  "requires_expected_sha",
  "requires_path_allowlist",
  "requires_post_restart_readback",
  "freeform_shell_allowed',false",
  "inline_secret_allowed',false",
  "CREATE OR REPLACE VIEW v_hostinger_recovery_option_readiness",
  "secrets_included",
]) {
  assert.ok(migration.includes(expected), `migration missing ${expected}`);
}

assert.ok(!migration.includes("inline_secret_allowed',true"), "must not allow inline secrets");
assert.ok(!migration.includes("freeform_shell_allowed',true"), "must not allow freeform shell");
assert.ok(!migration.includes("deploy_write_allowed',true"), "restart export must not authorize deploy writes");
assert.ok(runner.includes("963_sprint68_hostinger_deploy_restart_tool_exports.sql"), "runner must allowlist 963");
assert.ok(manifest.includes("node test-hostinger-deploy-restart-tool-exports.mjs"), "manifest must include Hostinger exports test");

console.log("Hostinger deploy/restart tool export contract OK");
