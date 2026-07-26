import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/247_sprint67_google_ads_credential_readiness_policy_fix.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(migration, /google_ads_credential_readiness_policy_readback_fix_v1/);
assert.match(migration, /google_ads_budget_execution_adapter_skeleton_policy_v1/);
assert.match(migration, /JSON_MERGE_PATCH/);
assert.match(migration, /future_execution_contract/);
assert.match(migration, /credential_readiness_gate_required/);
assert.match(migration, /google_ads_credential_readiness_gate/);
assert.match(migration, /real_google_ads_user_connection_required/);
assert.match(migration, /preflight_execution_gate_helper_required/);
assert.match(migration, /execution_enablement_still_required/);
assert.match(migration, /no_credential_read/);
assert.match(migration, /no_provider_call/);
assert.match(migration, /no_spend_change/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);
assert.match(runner, /247_sprint67_google_ads_credential_readiness_policy_fix\.sql/);

console.log("Google Ads credential readiness policy fix guard passed");
