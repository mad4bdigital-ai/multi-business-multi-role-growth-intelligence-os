import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/google-ads-credential-readiness-gate.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/250_sprint67_google_ads_credential_readiness_ledger.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(script, /recordGoogleAdsCredentialReadiness/);
assert.match(script, /google_ads_credential_readiness_ledger/);
assert.match(script, /credential_readiness_id/);
assert.match(script, /readiness_sha256/);
assert.match(script, /credential_readiness_recorded: true/);
assert.match(script, /credential_readiness_recorded: false/);
assert.match(script, /ER_NO_SUCH_TABLE/);
assert.match(script, /no_credential_payload_read: true/);
assert.match(script, /no_provider_call: true/);
assert.match(script, /no_spend_change: true/);
assert.match(script, /secrets_included: false/);
assert.doesNotMatch(script, /encrypted_credentials|value_ciphertext|decryptToken|client_secret|private_key|refresh_token|GOOGLE_ADS_DEVELOPER_TOKEN/i);
assert.doesNotMatch(script, /fetch\(|axios|GoogleAdsApi|GoogleAdsClient|mutateCampaignBudgets|mutate\(|child_process|exec\(|spawn\(/i);

assert.match(migration, /CREATE TABLE IF NOT EXISTS google_ads_credential_readiness_ledger/);
assert.match(migration, /uq_google_ads_credential_readiness_id/);
assert.match(migration, /readiness_sha256 CHAR\(64\)/);
assert.match(migration, /chk_google_ads_credential_readiness_no_payload/);
assert.match(migration, /chk_google_ads_credential_readiness_no_provider_call/);
assert.match(migration, /chk_google_ads_credential_readiness_no_spend/);
assert.match(migration, /chk_google_ads_credential_readiness_no_secrets/);
assert.match(migration, /google_ads_credential_readiness_ledger_policy_v1/);
assert.match(migration, /future_google_ads_execution_adapter_must_require_credential_readiness_id/);
assert.match(migration, /credential_readiness_hash_readback_required/);
assert.match(migration, /does_not_read_encrypted_credentials',true/);
assert.match(migration, /does_not_decrypt_credentials',true/);
assert.match(migration, /no_credential_payload_read',true/);
assert.match(migration, /no_provider_call',true/);
assert.match(migration, /no_spend_change',true/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);
assert.match(runner, /250_sprint67_google_ads_credential_readiness_ledger\.sql/);

console.log("Google Ads credential readiness ledger guard passed");
