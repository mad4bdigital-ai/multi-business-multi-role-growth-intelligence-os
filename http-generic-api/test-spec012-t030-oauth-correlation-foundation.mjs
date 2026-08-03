import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./test-tenant-gpt-oauth-operation-correlation.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

const record = JSON.parse(read(
  "specs/012-tenant-activation-lifecycle/implementation/pr-2k-t030-oauth-operation-correlation-foundation.json",
));
const narrative = read(
  "specs/012-tenant-activation-lifecycle/implementation/pr-2k-t030-oauth-operation-correlation-foundation.md",
);
const tasks = read("specs/012-tenant-activation-lifecycle/tasks.md");
const inventory = JSON.parse(read(
  "specs/012-tenant-activation-lifecycle/implementation/pr-1-inventory.json",
));

assert.equal(record.task_id, "T030");
assert.equal(record.status, "domain_foundation_complete_runtime_integration_required");
assert.equal(record.correlation_contract.schema_version, 1);
assert.deepEqual(record.correlation_contract.stages, [
  "oauth_authorize",
  "identity_verify",
  "oauth_code_issue",
  "oauth_token_exchange",
  "gateway_verify",
]);
assert.equal(record.correlation_contract.secrets_included, false);
assert.match(tasks, /^- \[ \] \*\*T030\*\*/mu, "T030 must remain open until runtime integration and readback");
assert.match(narrative, /does not close T030/u);
assert.match(narrative, /Runtime integration still required/u);

const oauthMapping = inventory.physical_mappings.oauth_authorization_code;
assert.equal(oauthMapping.tables.includes("tenant_gpt_oauth_authorization_codes"), true);
assert.equal(oauthMapping.gaps.includes("request_correlation_ref"), true);

for (const value of Object.values(record.runtime_integration_gate)) {
  if (typeof value === "boolean") assert.equal(value, false);
}
assert.equal(record.runtime_integration_gate.required_before_completion.length >= 10, true);
assert.equal(record.dependency_boundary.t026_migration_applied, false);
assert.equal(record.dependency_boundary.runtime_wiring_authorized, false);
assert.equal(record.non_effects.oauth_route_changed, false);
assert.equal(record.non_effects.jwt_claim_changed, false);
assert.equal(record.non_effects.gateway_behavior_changed, false);
assert.equal(record.non_effects.database_mutation_performed, false);
assert.equal(record.non_effects.migration_applied, false);
assert.equal(record.non_effects.runtime_wired, false);
assert.equal(record.non_effects.production_deployed, false);
assert.equal(record.non_effects.credential_read_performed, false);
assert.equal(record.non_effects.external_send_performed, false);
assert.equal(record.non_effects.secrets_included, false);

console.log("Spec 012 T030 OAuth correlation foundation tests passed");
