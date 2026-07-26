import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const blueprint = readFileSync(new URL("./scripts/ads-provider-preflight-surface-blueprint.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/254_sprint67_ads_provider_preflight_surface_blueprint.sql", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(blueprint, /buildAdsProviderPreflightSurfaceBlueprint/);
assert.match(blueprint, /validateAdsProviderPreflightContract/);
assert.match(blueprint, /ads_provider_preflight_surface_blueprint_registry/);
assert.match(blueprint, /ready_existing_preflight_surface_blueprint/);
assert.match(blueprint, /ready_proposed_preflight_surface_blueprint/);
assert.match(blueprint, /creates_surfaces: false/);
assert.match(blueprint, /creates_tables: false/);
assert.match(blueprint, /creates_tools: false/);
assert.match(blueprint, /creates_credentials: false/);
assert.match(blueprint, /creates_execution_adapter: false/);
assert.match(blueprint, /no_provider_call: true/);
assert.match(blueprint, /no_spend_change: true/);
assert.match(blueprint, /secrets_included: false/);
assert.doesNotMatch(blueprint, /INSERT\s+INTO|UPDATE\s+|CREATE\s+TABLE|fetch\(|axios|GoogleAdsApi|MetaAds|TikTok|mutateCampaignBudgets|mutate\(|child_process|exec\(|spawn\(/i);
assert.doesNotMatch(blueprint, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|META_ACCESS_TOKEN|TIKTOK_ACCESS_TOKEN|refresh_token|client_secret|private_key|value_ciphertext|decryptToken|encrypted_credentials/i);

assert.match(migration, /CREATE TABLE IF NOT EXISTS ads_provider_preflight_surface_blueprint_registry/);
assert.match(migration, /ads_provider_preflight_surface_blueprint_v1/);
assert.match(migration, /ads_provider_preflight_surface_blueprint_policy_v1/);
assert.match(migration, /ads_provider_preflight_surface_blueprint/);
assert.match(migration, /does_not_create_provider_surfaces',true/);
assert.match(migration, /does_not_create_tables',true/);
assert.match(migration, /does_not_create_tools',true/);
assert.match(migration, /does_not_create_credentials',true/);
assert.match(migration, /does_not_create_execution_adapter',true/);
assert.match(migration, /provider_specific_surface_creation_requires_separate_pr/);
assert.match(migration, /provider_specific_surface_creation_requires_governed_migration/);
assert.match(migration, /no_provider_call',true/);
assert.match(migration, /no_spend_change',true/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|META_ACCESS_TOKEN|TIKTOK_ACCESS_TOKEN|OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);

assert.match(adminCli, /ads_provider_preflight_surface_blueprint/);
assert.match(adminCli, /scripts\/ads-provider-preflight-surface-blueprint\.mjs/);
assert.match(runner, /254_sprint67_ads_provider_preflight_surface_blueprint\.sql/);

console.log("Ads provider preflight surface blueprint guard passed");
