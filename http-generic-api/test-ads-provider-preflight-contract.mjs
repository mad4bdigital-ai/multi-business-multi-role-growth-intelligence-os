import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const validator = readFileSync(new URL("./scripts/ads-provider-preflight-contract-validate.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/253_sprint67_ads_provider_preflight_contract.sql", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(validator, /validateAdsProviderPreflightContract/);
assert.match(validator, /ads_provider_capability_profile_registry/);
assert.match(validator, /ready_for_preflight_surface_design/);
assert.match(validator, /ready_existing_preflight_surface_contract/);
assert.match(validator, /blocked_ads_provider_preflight_contract/);
assert.match(validator, /execution_enabled_default_must_be_false/);
assert.match(validator, /no_provider_call: true/);
assert.match(validator, /no_spend_change: true/);
assert.match(validator, /secrets_included: false/);
assert.doesNotMatch(validator, /fetch\(|axios|GoogleAdsApi|MetaAds|TikTok|mutateCampaignBudgets|mutate\(|child_process|exec\(|spawn\(/i);
assert.doesNotMatch(validator, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|META_ACCESS_TOKEN|TIKTOK_ACCESS_TOKEN|refresh_token|client_secret|private_key|value_ciphertext|decryptToken|encrypted_credentials/i);

assert.match(migration, /CREATE TABLE IF NOT EXISTS ads_provider_preflight_contract_registry/);
assert.match(migration, /ads_provider_preflight_contract_v1/);
assert.match(migration, /ads_provider_preflight_contract_policy_v1/);
assert.match(migration, /ads_provider_preflight_contract_validate/);
assert.match(migration, /provider_specific_preflight_surface_requires_contract_validation/);
assert.match(migration, /draft_profile_can_pass_contract_for_design_only/);
assert.match(migration, /does_not_create_provider_surfaces',true/);
assert.match(migration, /does_not_execute_target_capability',true/);
assert.match(migration, /no_provider_call',true/);
assert.match(migration, /no_spend_change',true/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|META_ACCESS_TOKEN|TIKTOK_ACCESS_TOKEN|OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);

assert.match(adminCli, /ads_provider_preflight_contract_validate/);
assert.match(adminCli, /scripts\/ads-provider-preflight-contract-validate\.mjs/);
assert.match(runner, /253_sprint67_ads_provider_preflight_contract\.sql/);

console.log("Ads provider preflight contract guard passed");
