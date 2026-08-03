import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./test-tenant-gpt-oauth-authorization-code-store.mjs";
import "./test-tenant-gpt-oauth-token-exchange-outcome-policy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

const record = JSON.parse(read(
  "specs/012-tenant-activation-lifecycle/implementation/pr-2l-t031-oauth-code-consumption-hardening.json",
));
const narrative = read(
  "specs/012-tenant-activation-lifecycle/implementation/pr-2l-t031-oauth-code-consumption-hardening.md",
);
const tasks = read("specs/012-tenant-activation-lifecycle/tasks.md");
const authRoutes = read("http-generic-api/routes/authRoutes.js");
const storeSource = read("http-generic-api/tenantGptOAuthAuthorizationCodeStore.js");
const policySource = read("http-generic-api/tenantGptOAuthTokenExchangeOutcomePolicy.js");

assert.equal(record.task_id, "T031");
assert.equal(record.status, "foundation_complete_live_token_route_wiring_required");
assert.match(tasks, /^- \[ \] \*\*T031\*\*/mu, "T031 must remain open until live route wiring and smoke");
assert.match(narrative, /does \*\*not\*\* close T031/u);
assert.match(narrative, /Runtime integration still required/u);

assert.equal(record.foundation_capabilities.atomic_compare_and_set_consumption, true);
assert.equal(record.foundation_capabilities.one_success_per_concurrent_race, true);
assert.equal(record.foundation_capabilities.post_failure_status_readback, true);
assert.equal(record.foundation_capabilities.same_code_replay_blocked_when_outcome_unknown, true);
assert.equal(record.foundation_capabilities.raw_code_returned, false);
assert.equal(record.foundation_capabilities.raw_token_returned, false);
assert.equal(record.foundation_capabilities.raw_client_secret_returned, false);
assert.equal(record.foundation_capabilities.secrets_included, false);

assert.deepEqual(record.consumption_outcomes, [
  "consumed",
  "not_found",
  "binding_mismatch",
  "expired",
  "already_consumed",
  "revoked",
  "issued_not_consumed",
  "consumption_outcome_unknown",
  "store_unavailable_code_still_issued",
]);

for (const [name, value] of Object.entries(record.live_integration_gate)) {
  if (name === "required_before_completion") continue;
  assert.equal(value, false, `${name} must remain false before live token-route integration`);
}
assert.equal(record.live_integration_gate.required_before_completion.length >= 8, true);

for (const [name, value] of Object.entries(record.non_effects)) {
  assert.equal(value, false, `${name} must remain false in this repository-only foundation`);
}

assert.match(storeSource, /UPDATE `tenant_gpt_oauth_authorization_codes`/u);
assert.match(storeSource, /status = 'issued'/u);
assert.match(storeSource, /consumed_at IS NULL/u);
assert.match(storeSource, /expires_at > UTC_TIMESTAMP\(3\)/u);
assert.match(storeSource, /consumption_outcome_unknown/u);
assert.match(storeSource, /store_unavailable_code_still_issued/u);
assert.match(storeSource, /oauth_consumption/u);

assert.match(policySource, /consumed_without_committed_token_response/u);
assert.match(policySource, /oauth_code_consumption_outcome_unknown/u);
assert.match(policySource, /retry_same_code: false/u);
assert.match(policySource, /operator_reconciliation_required: true/u);
assert.match(policySource, /secrets_included: false/u);

assert.equal(
  authRoutes.includes("tenantGptOAuthTokenExchangeOutcomePolicy.js"),
  false,
  "Live auth route must not be represented as wired by this foundation PR",
);

console.log("Spec 012 T031 OAuth code-consumption readiness tests passed");
