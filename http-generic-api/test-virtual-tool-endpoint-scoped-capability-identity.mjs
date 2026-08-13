import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(new URL("./migrations/20260813_virtual_tool_endpoint_scoped_capability_identity.sql", import.meta.url), "utf8");
const runner = fs.readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(migration, /UPDATE platform_tool_dispatch_bindings[\s\S]*github_pr_ci_readback/u);
assert.match(migration, /GROUP BY tool_key, parent_action_key, endpoint_key/u);
assert.match(migration, /i\.tool_key = b\.tool_key[\s\S]*?i\.parent_action_key = b\.parent_action_key[\s\S]*?i\.endpoint_key = b\.endpoint_key/u);
assert.match(migration, /virtual_tool_export\.', b\.tool_key, '\.', b\.parent_action_key, '\.', b\.endpoint_key/u);
assert.match(migration, /identity_scope.*tool_parent_action_endpoint/u);
assert.match(migration, /CHAR_LENGTH\(CONCAT\('virtual_tool_export\.'/u);
assert.match(migration, /platform_capability_readback_contracts/u);
assert.match(migration, /export_status = 'disabled'/u);
assert.match(migration, /CAPABILITY_IDENTITY_MISSING/u);
assert.match(migration, /CAPABILITY_AMBIGUOUS/u);
assert.match(migration, /allow_record_only, allow_apply/u);
assert.match(runner, /20260813_virtual_tool_endpoint_scoped_capability_identity\.sql/u);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.virtual-tool-endpoint-scoped-capability-identity.v1",
  identity_scope: "tool_parent_action_endpoint",
  apply_enabled: false,
  secrets_included: false,
}));
