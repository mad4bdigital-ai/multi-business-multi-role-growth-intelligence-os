import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/google-ads-credential-readiness-gate.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/246_sprint67_google_ads_credential_readiness_gate.sql", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(script, /runGoogleAdsCredentialReadinessGate/);
assert.match(script, /user_app_connections/);
assert.match(script, /credential_bindings/);
assert.match(script, /blocked_google_ads_connection_missing/);
assert.match(script, /ready_for_dispatch/);
assert.match(script, /no_credential_payload_read: true/);
assert.match(script, /no_provider_call: true/);
assert.match(script, /no_spend_change: true/);
assert.match(script, /secrets_included: false/);
assert.doesNotMatch(script, /encrypted_credentials|value_ciphertext|decryptToken|client_secret|private_key|refresh_token|GOOGLE_ADS_DEVELOPER_TOKEN/i);
assert.doesNotMatch(script, /fetch\(|axios|GoogleAdsApi|GoogleAdsClient|mutateCampaignBudgets|mutate\(|child_process|exec\(|spawn\(/i);

assert.match(migration, /google_ads_credential_readiness_gate_policy_v1/);
assert.match(migration, /google_ads_credential_readiness_gate/);
assert.match(migration, /requires_active_user_app_connection',true/);
assert.match(migration, /requires_credential_ref_present',true/);
assert.match(migration, /requires_active_credential_binding',true/);
assert.match(migration, /does_not_read_encrypted_credentials',true/);
assert.match(migration, /does_not_decrypt_credentials',true/);
assert.match(migration, /does_not_call_google_ads',true/);
assert.match(migration, /does_not_mutate_spend',true/);
assert.match(migration, /credential_readiness_gate_required/);
assert.match(migration, /real_google_ads_user_connection_required/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);

assert.match(adminCli, /google_ads_credential_readiness_gate/);
assert.match(adminCli, /scripts\/google-ads-credential-readiness-gate\.mjs/);
assert.match(runner, /246_sprint67_google_ads_credential_readiness_gate\.sql/);

console.log("Google Ads credential readiness gate guard passed");
