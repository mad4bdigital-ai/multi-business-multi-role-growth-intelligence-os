import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runner = readFileSync("scripts/spec017-fixture-context-readback.mjs", "utf8");
const workflow = readFileSync("../.github/workflows/spec017-fixture-context-readback.yml", "utf8");

assert.match(runner, /url\.hostname !== "auth\.mad4b\.com"/);
assert.match(runner, /\/admin\/tenant-requests\//);
assert.match(runner, /\/auth\/platform-jwt\/issue/);
assert.match(runner, /ttl_seconds: 600/);
assert.match(runner, /\/me\/workspaces\/\$\{encodeURIComponent\(tenantId\)\}\/resource-grants/);
assert.match(runner, /fixture_user_candidate_cardinality/);
assert.match(runner, /fixture_resource_candidate_cardinality/);
assert.match(runner, /fixture_capability_candidate_cardinality/);
assert.match(runner, /fixture_effective_grant_ambiguous/);
assert.match(runner, /resource_grant_created: false/);
assert.match(runner, /capability_created: false/);
assert.match(runner, /resource_created: false/);
assert.match(runner, /provider_dispatch_executed: false/);
assert.match(runner, /migration_apply_executed: false/);
assert.match(runner, /sql_executed_by_readback: false/);
assert.doesNotMatch(runner, /\/admin\/control/);
assert.doesNotMatch(runner, /\/migrations?\b/);
assert.doesNotMatch(runner, /\/providers?\b/);
assert.doesNotMatch(runner, /\/connectors?\b/);
assert.doesNotMatch(runner, /\/deploy(?:ment)?\b/);
assert.doesNotMatch(runner, /mode:\s*"apply"/);
assert.doesNotMatch(runner, /resource-grants[^\n]*method:\s*"POST"/);

assert.match(workflow, /^on:\n\s+issue_comment:/m);
assert.match(workflow, /github\.event\.comment\.user\.id == 271942579/);
assert.match(workflow, /RUN_SPEC017_FIXTURE_CONTEXT_READBACK/);
assert.match(workflow, /expected_main_sha=\(\[0-9a-f\]\{40\}\)/);
assert.match(workflow, /expected_production_sha=\(\[0-9a-f\]\{40\}\)/);
assert.match(workflow, /ref: \$\{\{ steps\.trigger\.outputs\.expected_main_sha \}\}/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /BACKEND_API_KEY: \$\{\{ secrets\.BACKEND_API_KEY \}\}/);
assert.match(workflow, /RUNTIME_BASE_URL: https:\/\/auth\.mad4b\.com/);
assert.doesNotMatch(workflow, /pull_request_target:/);
assert.doesNotMatch(workflow, /^\s+contents:\s*write\s*$/m);

console.log(JSON.stringify({
  ok: true,
  contract: "spec017_fixture_context_readback_safety.v1",
  trusted_default_branch_tooling_only: true,
  exact_main_and_production_pinning: true,
  known_ticket_only: true,
  short_lived_platform_jwt_only: true,
  existing_grant_read_only: true,
  grant_creation_forbidden: true,
  provider_dispatch_forbidden: true,
  migration_apply_forbidden: true,
  direct_sql_forbidden: true,
  secrets_included: false,
}, null, 2));
