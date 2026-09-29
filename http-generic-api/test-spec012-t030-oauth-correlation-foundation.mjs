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
const correlationMigration = read(
  "http-generic-api/migrations/20260929_tenant_gpt_oauth_authorization_code_correlation_ref.sql",
);
const authorizationCodeStore = read("http-generic-api/tenantGptOAuthAuthorizationCodeStore.js");
const authRoutes = read("http-generic-api/routes/authRoutes.js");
const tokenRoutes = read("http-generic-api/routes/tenantGptOAuthTokenExchangeRoutes.js");
const accessVerifier = read("http-generic-api/tenantGptAccessTokenVerifier.js");

assert.equal(record.task_id, "T030");
assert.equal(record.status, "runtime_chain_wired_schema_apply_readback_required");
assert.equal(record.correlation_contract.schema_version, 1);
assert.deepEqual(record.correlation_contract.stages, [
  "oauth_authorize",
  "identity_verify",
  "oauth_code_issue",
  "oauth_token_exchange",
  "gateway_verify",
]);
assert.equal(record.correlation_contract.secrets_included, false);
assert.match(tasks, /^- \[ \] \*\*T030\*\*/mu, "T030 must remain open until governed schema apply/readback and exact-SHA Staging verification");
assert.match(narrative, /Repository runtime wiring implemented/u);
assert.match(narrative, /Remaining T030 closure work/u);
assert.match(narrative, /No parallel ledger is introduced/u);

const oauthMapping = inventory.physical_mappings.oauth_authorization_code;
assert.equal(oauthMapping.tables.includes("tenant_gpt_oauth_authorization_codes"), true);
assert.equal(oauthMapping.gaps.includes("request_correlation_ref"), true);

for (const key of [
  "oauth_authorize_context_created",
  "signed_correlation_ticket_carried",
  "oauth_code_claim_bound",
  "authorization_code_store_bound",
  "oauth_token_claim_propagated",
  "access_token_claim_propagated",
  "gateway_request_context_attached",
]) {
  assert.equal(record.runtime_integration_gate[key], true, `${key} must be wired repository-side`);
}
for (const key of [
  "activation_operation_projection_persisted",
  "stage_attempt_evidence_persisted",
  "same_cycle_ledger_readback_complete",
  "schema_apply_readback_complete",
  "exact_sha_staging_runtime_verified",
  "task_complete",
]) {
  assert.equal(record.runtime_integration_gate[key], false, `${key} must remain open`);
}
assert.equal(record.runtime_integration_gate.required_before_completion.length >= 5, true);
assert.equal(record.dependency_boundary.migration_in_repository, true);
assert.equal(record.dependency_boundary.migration_applied, false);
assert.equal(record.dependency_boundary.activation_run_fk_added, false);
assert.equal(record.dependency_boundary.synthetic_activation_run_allowed, false);
assert.equal(record.dependency_boundary.parallel_correlation_ledger_allowed, false);
assert.equal(record.dependency_boundary.oauth_server_correlation_source_available, false);
assert.equal(record.dependency_boundary.callback_received_resolved, false);
assert.equal(record.dependency_boundary.receipt_signed, false);
assert.equal(record.non_effects.oauth_route_changed, true);
assert.equal(record.non_effects.jwt_claim_changed, true);
assert.equal(record.non_effects.gateway_behavior_changed, true);
assert.equal(record.non_effects.database_mutation_performed, false);
assert.equal(record.non_effects.migration_applied, false);
assert.equal(record.non_effects.runtime_wired, true);
assert.equal(record.non_effects.activation_run_created, false);
assert.equal(record.non_effects.activation_projection_written, false);
assert.equal(record.non_effects.oauth_source_branding_enabled, false);
assert.equal(record.non_effects.production_deployed, false);
assert.equal(record.non_effects.credential_read_performed, false);
assert.equal(record.non_effects.external_send_performed, false);
assert.equal(record.non_effects.secrets_included, false);

assert.match(correlationMigration, /request_correlation_ref.*VARCHAR\(36\).*NULL/su);
assert.match(correlationMigration, /idx_tenant_gpt_oauth_codes_correlation_ref/u);
assert.doesNotMatch(correlationMigration, /FOREIGN KEY/u);
assert.match(authorizationCodeStore, /request_correlation_ref/u);
assert.match(authRoutes, /issueTenantGptOAuthCorrelationTicket/u);
assert.match(authRoutes, /oauth_correlation/u);
assert.match(tokenRoutes, /oauth_token_exchange/u);
assert.match(tokenRoutes, /request_correlation_ref/u);
assert.match(accessVerifier, /gateway_verify/u);
assert.match(accessVerifier, /oauth_operation_id/u);

console.log("Spec 012 T030 OAuth correlation foundation tests passed");
