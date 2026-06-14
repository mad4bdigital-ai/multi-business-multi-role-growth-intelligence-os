import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/google-ads-budget-change-execution-adapter.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/245_sprint67_google_ads_execution_adapter_skeleton.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(script, /runGoogleAdsBudgetChangeExecutionAdapter/);
assert.match(script, /requireValidatedPreflightForExecution/);
assert.match(script, /google_ads_budget/);
assert.match(script, /blocked_google_ads_execution_adapter_not_implemented/);
assert.match(script, /provider_execution_not_implemented/);
assert.match(script, /google_ads_budget_execution_gate_audit/);
assert.match(script, /no_provider_call: true/);
assert.match(script, /no_spend_change: true/);
assert.match(script, /secrets_included: false/);
assert.doesNotMatch(script, /fetch\(|axios|GoogleAdsApi|GoogleAdsClient|mutateCampaignBudgets|mutate\(|child_process|exec\(|spawn\(/i);
assert.doesNotMatch(script, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|refresh_token|client_secret|private_key|value_ciphertext|decryptToken/i);

assert.match(migration, /CREATE TABLE IF NOT EXISTS google_ads_budget_execution_gate_audit/);
assert.match(migration, /chk_google_ads_execution_gate_no_provider_call/);
assert.match(migration, /chk_google_ads_execution_gate_no_spend_change/);
assert.match(migration, /chk_google_ads_execution_gate_no_secrets/);
assert.match(migration, /google_ads_budget_execution_adapter_skeleton_policy_v1/);
assert.match(migration, /requires_preflight_execution_gate_helper',true/);
assert.match(migration, /provider_execution_implemented',false/);
assert.match(migration, /always_blocks_provider_execution',true/);
assert.match(migration, /real_google_ads_credentials_required_for_future_execution',true/);
assert.match(migration, /no_provider_call',true/);
assert.match(migration, /no_credential_read',true/);
assert.match(migration, /no_spend_change',true/);
assert.match(migration, /secrets_included',false/);
assert.match(migration, /is_enabled, sort_order\r?\n\) VALUES \([\s\S]*\r?\n  0,\r?\n  236\r?\n\)/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);

assert.match(adminCli, /google_ads_budget_change_execution_adapter/);
assert.match(adminCli, /scripts\/google-ads-budget-change-execution-adapter\.mjs/);
assert.match(runner, /245_sprint67_google_ads_execution_adapter_skeleton\.sql/);

console.log("Google Ads execution adapter skeleton guard passed");
