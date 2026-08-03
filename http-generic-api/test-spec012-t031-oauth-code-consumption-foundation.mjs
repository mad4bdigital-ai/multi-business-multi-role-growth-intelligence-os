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
  "specs/012-tenant-activation-lifecycle/implementation/pr-2l-t031-oauth-code-consumption-foundation.json",
));
const narrative = read(
  "specs/012-tenant-activation-lifecycle/implementation/pr-2l-t031-oauth-code-consumption-foundation.md",
);
const tasks = read("specs/012-tenant-activation-lifecycle/tasks.md");
const store = read("http-generic-api/tenantGptOAuthAuthorizationCodeStore.js");
const policy = read("http-generic-api/tenantGptOAuthTokenExchangeOutcomePolicy.js");
const authRoutes = read("http-generic-api/routes/authRoutes.js");

assert.equal(record.task_id, "T031");
assert.equal(record.status, "live_store_hardening_complete_route_policy_wiring_required");
assert.equal(record.authority.concern, "C-007");
assert.equal(record.authority.operation_path, "OP-003");
assert.equal(record.effects.authorization_code_store_runtime_behavior_changed, true);
assert.equal(record.effects.classified_consumption_readback_active, true);
assert.equal(record.effects.zero_row_conflict_readback_active, true);
assert.equal(record.effects.transport_error_readback_active, true);
assert.equal(record.effects.route_policy_runtime_wired, false);
assert.equal(record.effects.oauth_response_contract_changed, false);
assert.equal(record.consumption_contract.atomic_update, true);
assert.equal(record.consumption_contract.readback_after_zero_affected_rows, true);
assert.equal(record.consumption_contract.readback_after_store_transport_error, true);
assert.equal(record.consumption_contract.raw_code_returned, false);
assert.equal(record.ambiguity_policy.unknown_consumption_replay_allowed, false);
assert.equal(record.ambiguity_policy.consumed_code_replay_allowed, false);
assert.equal(record.ambiguity_policy.restart_authorization_only_for_verified_invalid_grant, true);
assert.equal(record.ambiguity_policy.route_wiring_status, "not_wired");
assert.equal(record.runtime_integration_gate.auth_token_route_reordered_before_consumption, false);
assert.equal(record.runtime_integration_gate.consumption_outcome_policy_wired, false);
assert.equal(record.runtime_integration_gate.live_exchange_readback_complete, false);
assert.equal(record.runtime_integration_gate.required_before_completion.length >= 10, true);
assert.match(tasks, /^- \[ \] \*\*T031\*\*/mu, "T031 must remain open until route wiring and exact readback");
assert.match(narrative, /does \*\*not\*\* close T031/u);
assert.match(narrative, /Route integration still required/u);
assert.match(narrative, /store's runtime behavior is changed/u);
assert.match(narrative, /live route does not import this policy/u);

assert.match(store, /SET status = 'consumed', consumed_at = UTC_TIMESTAMP\(3\)/u);
assert.match(store, /status = 'issued'/u);
assert.match(store, /consumed_at IS NULL/u);
assert.match(store, /expires_at > UTC_TIMESTAMP\(3\)/u);
assert.match(store, /SELECT status, expires_at, consumed_at/u);
assert.match(store, /consumption_outcome_unknown/u);
assert.match(store, /store_unavailable_code_still_issued/u);
assert.doesNotMatch(store, /return \{[^}]*jti:/su, "store results must not expose raw JTI");

assert.match(policy, /oauth_token_response_not_committed/u);
assert.match(policy, /oauth_code_consumption_outcome_unknown/u);
assert.match(policy, /retry_same_code: false/u);
assert.match(policy, /operator_reconciliation_required: true/u);
assert.match(policy, /restart_authorization: true/u);
assert.match(policy, /secrets_included: false/u);

assert.match(authRoutes, /consumeTenantGptOAuthAuthorizationCode/u,
  "the live token route must still use the hardened store");
assert.doesNotMatch(authRoutes, /classifyTenantGptOAuthTokenExchangeOutcome/u,
  "the record must not claim route-policy wiring before it exists");
assert.doesNotMatch(authRoutes, /buildTenantGptOAuthTokenErrorResponse/u,
  "the record must not claim live response wiring before it exists");

for (const [key, value] of Object.entries(record.non_effects)) {
  assert.equal(value, false, `${key} must remain false`);
}
assert.equal(Object.hasOwn(record.non_effects, "runtime_wired"), false,
  "non-effects must not deny the live store behavior change");

console.log("Spec 012 T031 OAuth code-consumption hardening tests passed");
