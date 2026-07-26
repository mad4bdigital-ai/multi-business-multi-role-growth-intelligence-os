import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/preflight-ledger-validate.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/242_sprint67_preflight_ledger_validator.sql", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(script, /validatePreflightLedger/);
assert.match(script, /LEDGER_TABLE_ALLOWLIST/);
assert.match(script, /google_ads_budget_preflight_ledger/);
assert.match(script, /preflight_ledger_validator_registry/);
assert.match(script, /preflight_ledger_hash_mismatch/);
assert.match(script, /preflight_ledger_envelope_mismatch/);
assert.match(script, /preflight_ledger_not_ready_for_dispatch/);
assert.match(script, /no_provider_call/);
assert.match(script, /no_spend_change/);
assert.match(script, /secrets_included: false/);
assert.match(script, /hash_verified: true/);
assert.doesNotMatch(script, /fetch\(|axios|GoogleAdsApi|GoogleAdsClient|mutateCampaignBudgets|mutate\(|child_process|exec\(|spawn\(/i);
assert.doesNotMatch(script, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|refresh_token|client_secret|private_key|value_ciphertext|decryptToken/i);

assert.match(migration, /CREATE TABLE IF NOT EXISTS preflight_ledger_validator_registry/);
assert.match(migration, /chk_preflight_validator_no_secrets/);
assert.match(migration, /google_ads_budget/);
assert.match(migration, /google_ads_budget_preflight_ledger/);
assert.match(migration, /preflight_ledger_validator_policy_v1/);
assert.match(migration, /preflight_ledger_validate/);
assert.match(migration, /validates_hash',true/);
assert.match(migration, /validates_ready_for_dispatch',true/);
assert.match(migration, /validates_envelope_match_when_expected',true/);
assert.match(migration, /does_not_execute_target_capability',true/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);

assert.match(adminCli, /preflight_ledger_validate/);
assert.match(adminCli, /scripts\/preflight-ledger-validate\.mjs/);
assert.match(runner, /242_sprint67_preflight_ledger_validator\.sql/);

console.log("Preflight ledger validator guard passed");
