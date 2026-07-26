import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/google-ads-budget-change-preflight.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/238_sprint67_google_ads_budget_change_preflight.sql", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(script, /runGoogleAdsBudgetChangePreflight/);
assert.match(script, /resolveCapabilityExecutionEnvelope/);
assert.match(script, /runBudgetQuotaAuthorityDryRun/);
assert.match(script, /acceptedAppKeys: \["google_ads"\]/);
assert.match(script, /google_ads_budget_change/);
assert.match(script, /spend_budget_update/);
assert.match(script, /blocked_missing_budget_quota_authority|budget_quota_authority_not_ready/);
assert.match(script, /ready_for_dispatch/);
assert.match(script, /no_provider_call: true/);
assert.match(script, /no_spend_change: true/);
assert.match(script, /secrets_included: false/);
assert.doesNotMatch(script, /fetch\(|axios|GoogleAdsApi|GoogleAdsClient|mutateCampaignBudgets|mutate\(|child_process|exec\(|spawn\(/i);
assert.doesNotMatch(script, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|refresh_token|client_secret|private_key|value_ciphertext|decryptToken/i);

assert.match(migration, /google_ads_budget_change_preflight_policy_v1/);
assert.match(migration, /google_ads_budget_change_preflight/);
assert.match(migration, /requires_capability_envelope',true/);
assert.match(migration, /requires_budget_quota_authority',true/);
assert.match(migration, /missing_budget_authority_blocks_execution',true/);
assert.match(migration, /limit_exceeded_blocks_execution',true/);
assert.match(migration, /no_provider_call',true/);
assert.match(migration, /no_credential_read',true/);
assert.match(migration, /no_spend_change',true/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);

assert.match(adminCli, /google_ads_budget_change_preflight/);
assert.match(adminCli, /scripts\/google-ads-budget-change-preflight\.mjs/);
assert.match(runner, /238_sprint67_google_ads_budget_change_preflight\.sql/);

console.log("Google Ads budget change preflight guard passed");
