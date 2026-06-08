import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/google-ads-budget-change-preflight.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/241_sprint67_google_ads_budget_preflight_ledger.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(script, /recordGoogleAdsBudgetPreflight/);
assert.match(script, /google_ads_budget_preflight_ledger/);
assert.match(script, /preflight_id/);
assert.match(script, /preflight_sha256/);
assert.match(script, /preflight_recorded: true/);
assert.match(script, /preflight_recorded: false/);
assert.match(script, /ER_NO_SUCH_TABLE/);
assert.match(script, /no_provider_call: true/);
assert.match(script, /no_spend_change: true/);
assert.match(script, /secrets_included: false/);
assert.doesNotMatch(script, /fetch\(|axios|GoogleAdsApi|GoogleAdsClient|mutateCampaignBudgets|mutate\(|child_process|exec\(|spawn\(/i);
assert.doesNotMatch(script, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|refresh_token|client_secret|private_key|value_ciphertext|decryptToken/i);

assert.match(migration, /CREATE TABLE IF NOT EXISTS google_ads_budget_preflight_ledger/);
assert.match(migration, /uq_google_ads_budget_preflight_id/);
assert.match(migration, /preflight_sha256 CHAR\(64\)/);
assert.match(migration, /chk_google_ads_budget_preflight_no_provider_call/);
assert.match(migration, /chk_google_ads_budget_preflight_no_spend_change/);
assert.match(migration, /chk_google_ads_budget_preflight_no_secrets/);
assert.match(migration, /google_ads_budget_preflight_ledger_policy_v1/);
assert.match(migration, /future_google_ads_execution_adapter_must_require_preflight_id/);
assert.match(migration, /preflight_hash_readback_required/);
assert.match(migration, /no_provider_call',true/);
assert.match(migration, /no_credential_read',true/);
assert.match(migration, /no_spend_change',true/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);
assert.match(runner, /241_sprint67_google_ads_budget_preflight_ledger\.sql/);

console.log("Google Ads budget preflight ledger guard passed");
