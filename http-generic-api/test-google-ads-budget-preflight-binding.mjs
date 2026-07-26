import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/239_sprint67_google_ads_budget_preflight_binding.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(migration, /google_ads_budget_preflight_binding_policy_v1/);
assert.match(migration, /google_ads_budget_change_preflight_binding_v1/);
assert.match(migration, /google_ads_budget_change_preflight/);
assert.match(migration, /googleads_api/);
assert.match(migration, /'none'/);
assert.match(migration, /'user_connection'/);
assert.match(migration, /allows_envelope_without_google_ads_connection',true/);
assert.match(migration, /allows_provider_execution_without_google_ads_connection',false/);
assert.match(migration, /no_provider_call',true/);
assert.match(migration, /no_credential_read',true/);
assert.match(migration, /no_spend_change',true/);
assert.match(migration, /secrets_included',false/);
assert.match(migration, /runtime_dispatch_certification_registry/);
assert.match(migration, /dispatch_allowed, apply_allowed/);
assert.match(migration, /1,\r?\n  0,\r?\n  1,\r?\n  1,\r?\n  1,\r?\n  1/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|refresh_token|client_secret|private_key|value_ciphertext|decryptToken|sk-[A-Za-z0-9_\-]{12,}/i);
assert.match(runner, /239_sprint67_google_ads_budget_preflight_binding\.sql/);

console.log("Google Ads budget preflight binding guard passed");
