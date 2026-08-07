import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runner = readFileSync("scripts/spec017-managed-execution-protected-canary.mjs", "utf8");
const workflow = readFileSync("../.github/workflows/spec017-protected-managed-execution-canary.yml", "utf8");

assert.match(runner, /url\.hostname !== "auth\.mad4b\.com"/);
assert.match(runner, /url\.protocol !== "https:"/);
assert.match(runner, /\/auth\/platform-jwt\/issue/);
assert.match(runner, /ttl_seconds: 600/);
assert.match(runner, /managed_execution_principal_scope_mismatch/);
assert.match(runner, /effect_class: "read_only"/);
assert.match(runner, /effect_class: "state_change"/);
assert.match(runner, /mode: "dry_run"/);
assert.doesNotMatch(runner, /mode:\s*"apply"/);
assert.match(runner, /provider_dispatch_executed: false/);
assert.match(runner, /external_business_effect_executed: false/);
assert.match(runner, /migration_apply_executed: false/);
assert.match(runner, /sql_executed_by_canary: false/);
assert.match(runner, /deployment_mutated: false/);
assert.match(runner, /long_lived_user_jwt_secret_used: false/);
assert.match(runner, /tenantToken = ""/);

for (const forbiddenSurface of [
  "/admin/control",
  "/migrations",
  "/migration/",
  "/deploy",
  "/deployment/",
  "/provider",
  "/connector",
  "/tools/execute",
]) {
  assert.equal(runner.includes(forbiddenSurface), false, `protected canary must not call ${forbiddenSurface}`);
}

for (const expectedSurface of [
  "/managed-execution-runs",
  "/steps",
  "/retry",
  "/assignment",
  "/status",
  "/approval-holds/",
  "/rollback",
  "/rollback/finalize",
  "/reconcile",
]) {
  assert.ok(runner.includes(expectedSurface), `protected canary is missing ${expectedSurface}`);
}

assert.match(workflow, /^on:\n\s+issue_comment:/m);
assert.match(workflow, /github\.event\.comment\.user\.id == 271942579/);
assert.match(workflow, /RUN_SPEC017_PROTECTED_MANAGED_EXECUTION_CANARY/);
assert.match(workflow, /expected_main_sha=\(\[0-9a-f\]\{40\}\)/);
assert.match(workflow, /expected_production_sha=\(\[0-9a-f\]\{40\}\)/);
assert.match(workflow, /ref: \$\{\{ steps\.trigger\.outputs\.expected_main_sha \}\}/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /remote_main_sha/);
assert.match(workflow, /remote_production_sha/);
assert.match(workflow, /BACKEND_API_KEY: \$\{\{ secrets\.BACKEND_API_KEY \}\}/);
assert.match(workflow, /RUNTIME_BASE_URL: https:\/\/auth\.mad4b\.com/);
assert.doesNotMatch(workflow, /pull_request_target:/);
assert.doesNotMatch(workflow, /permissions:\s*\n(?:\s+.*\n)*?\s+contents:\s*write/m);
assert.doesNotMatch(workflow, /actions\/checkout@[^\n]+\n(?:.*\n){0,8}\s+ref:\s*\$\{\{ github\.event\.pull_request/m);

console.log(JSON.stringify({
  ok: true,
  contract: "spec017_protected_managed_execution_canary_safety.v1",
  trusted_default_branch_tooling_only: true,
  exact_main_and_production_pinning: true,
  short_lived_platform_jwt_required: true,
  tenant_scope_negative_probe_required: true,
  provider_dispatch_forbidden: true,
  migration_apply_forbidden: true,
  direct_sql_forbidden: true,
  deployment_mutation_forbidden: true,
  reconciliation_apply_forbidden: true,
  secrets_included: false,
}, null, 2));
