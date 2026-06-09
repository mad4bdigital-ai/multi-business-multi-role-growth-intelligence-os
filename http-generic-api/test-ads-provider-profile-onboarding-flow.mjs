import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const request = readFileSync(new URL("./scripts/ads-provider-profile-request.mjs", import.meta.url), "utf8");
const approve = readFileSync(new URL("./scripts/ads-provider-profile-approve.mjs", import.meta.url), "utf8");
const disable = readFileSync(new URL("./scripts/ads-provider-profile-disable.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/252_sprint67_ads_provider_profile_onboarding_flow.sql", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

for (const source of [request, approve, disable]) {
  assert.match(source, /ads_provider/);
  assert.match(source, /no_provider_call: true/);
  assert.match(source, /no_spend_change: true/);
  assert.match(source, /secrets_included: false/);
  assert.doesNotMatch(source, /fetch\(|axios|GoogleAdsApi|MetaAds|TikTok|mutateCampaignBudgets|mutate\(|child_process|exec\(|spawn\(/i);
  assert.doesNotMatch(source, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|META_ACCESS_TOKEN|TIKTOK_ACCESS_TOKEN|refresh_token|client_secret|private_key|value_ciphertext|decryptToken|encrypted_credentials/i);
}

assert.match(request, /ads_provider_profile_onboarding_requests/);
assert.match(request, /approval_holds/);
assert.match(request, /ads_provider_profile_request_tenant_id_required/);
assert.match(request, /pending_approval/);
assert.match(approve, /status='draft'/);
assert.match(approve, /execution_enabled_default=0/);
assert.match(approve, /primary_api_action_key=NULL/);
assert.match(approve, /preflight_tool_key=NULL/);
assert.match(disable, /status='disabled'/);
assert.match(disable, /execution_enabled_default=0/);

assert.match(migration, /CREATE TABLE IF NOT EXISTS ads_provider_profile_onboarding_requests/);
assert.match(migration, /chk_ads_provider_profile_request_no_secrets/);
assert.match(migration, /ads_provider_profile_onboarding_flow_policy_v1/);
assert.match(migration, /approved_profile_status','draft/);
assert.match(migration, /approved_profile_execution_enabled_default',false/);
assert.match(migration, /provider_specific_surfaces_not_created_by_onboarding',true/);
assert.match(migration, /ads_provider_profile_request/);
assert.match(migration, /ads_provider_profile_approve/);
assert.match(migration, /ads_provider_profile_disable/);
assert.match(migration, /no_provider_call',true/);
assert.match(migration, /no_spend_change',true/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|META_ACCESS_TOKEN|TIKTOK_ACCESS_TOKEN|OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);

assert.match(adminCli, /ads_provider_profile_request/);
assert.match(adminCli, /ads_provider_profile_approve/);
assert.match(adminCli, /ads_provider_profile_disable/);
assert.match(runner, /252_sprint67_ads_provider_profile_onboarding_flow\.sql/);

console.log("Ads provider profile onboarding flow guard passed");
