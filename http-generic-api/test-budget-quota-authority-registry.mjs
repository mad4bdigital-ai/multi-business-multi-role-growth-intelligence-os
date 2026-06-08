import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/budget-quota-authority-dry-run.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/236_sprint67_budget_quota_authority_registry.sql", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(script, /runBudgetQuotaAuthorityDryRun/);
assert.match(script, /budget_quota_authority_registry/);
assert.match(script, /blocked_missing_budget_quota_authority/);
assert.match(script, /ready_requires_approval/);
assert.match(script, /ready_for_dispatch/);
assert.match(script, /requested_amount_exceeds_budget_authority/);
assert.match(script, /requested_units_exceed_quota_authority/);
assert.match(script, /secrets_included: false/);
assert.doesNotMatch(script, /fetch\(|axios|child_process|exec\(|spawn\(/);
assert.doesNotMatch(script, /decryptToken|value_ciphertext|encrypted_credentials|oauth_token|private_key|api_key_value/i);

assert.match(migration, /CREATE TABLE IF NOT EXISTS budget_quota_authority_registry/);
assert.match(migration, /chk_budget_quota_authority_no_secrets/);
assert.match(migration, /budget_quota_authority_registry_policy_v1/);
assert.match(migration, /budget_quota_authority_dry_run/);
assert.match(migration, /spend_changing_tools_must_check_authority/);
assert.match(migration, /missing_authority_blocks_execution/);
assert.match(migration, /limit_exceeded_blocks_execution/);
assert.match(migration, /approval_required_flows_through_capability_envelope_approve/);
assert.match(migration, /no_provider_call_or_connector_forwarding_in_dry_run/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);

assert.match(adminCli, /budget_quota_authority_dry_run/);
assert.match(adminCli, /scripts\/budget-quota-authority-dry-run\.mjs/);
assert.match(runner, /236_sprint67_budget_quota_authority_registry\.sql/);

console.log("Budget quota authority registry guard passed");
