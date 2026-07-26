import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lookup = readFileSync(new URL("./scripts/ads-provider-profile-lookup.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/251_sprint67_ads_provider_capability_profile_registry.sql", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(lookup, /lookupAdsProviderProfile/);
assert.match(lookup, /ads_provider_capability_profile_registry/);
assert.match(lookup, /no_provider_call: true/);
assert.match(lookup, /no_spend_change: true/);
assert.match(lookup, /secrets_included: false/);
assert.doesNotMatch(lookup, /fetch\(|axios|GoogleAdsApi|MetaAds|TikTok|mutateCampaignBudgets|mutate\(|child_process|exec\(|spawn\(/i);
assert.doesNotMatch(lookup, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|refresh_token|client_secret|private_key|value_ciphertext|decryptToken|encrypted_credentials/i);

assert.match(migration, /CREATE TABLE IF NOT EXISTS ads_provider_capability_profile_registry/);
assert.match(migration, /uq_ads_provider_profile_key/);
assert.match(migration, /chk_ads_provider_profile_no_secrets/);
assert.match(migration, /chk_ads_provider_profile_execution_default_disabled/);
assert.match(migration, /provider_key, display_name/);
assert.match(migration, /'google_ads'/);
assert.match(migration, /google_ads_budget_change/);
assert.match(migration, /google_ads_budget_preflight_ledger/);
assert.match(migration, /google_ads_credential_readiness_ledger/);
assert.match(migration, /execution_enabled_default',false/);
assert.match(migration, /ads_provider_capability_profile_registry_policy_v1/);
assert.match(migration, /new_ads_provider_must_have_profile/);
assert.match(migration, /provider_execution_requires_preflight_ledger/);
assert.match(migration, /provider_execution_requires_credential_readiness_ledger/);
assert.match(migration, /provider_execution_requires_execution_enablement_gate/);
assert.match(migration, /ads_provider_profile_lookup/);
assert.match(migration, /no_provider_call',true/);
assert.match(migration, /no_spend_change',true/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);

assert.match(adminCli, /ads_provider_profile_lookup/);
assert.match(adminCli, /scripts\/ads-provider-profile-lookup\.mjs/);
assert.match(runner, /251_sprint67_ads_provider_capability_profile_registry\.sql/);

console.log("Ads provider capability profile registry guard passed");
