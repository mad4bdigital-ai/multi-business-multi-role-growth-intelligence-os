import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gate = readFileSync(new URL("./scripts/execution-enablement-gate.mjs", import.meta.url), "utf8");
const skeleton = readFileSync(new URL("./scripts/google-ads-budget-change-execution-adapter.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/248_sprint67_execution_enablement_registry.sql", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(gate, /runExecutionEnablementGate/);
assert.match(gate, /execution_enablement_registry/);
assert.match(gate, /blocked_execution_enablement_missing_or_disabled/);
assert.match(gate, /blocked_execution_enablement_registry_missing/);
assert.match(gate, /ready_for_provider_execution_enablement/);
assert.match(gate, /no_provider_call: true/);
assert.match(gate, /no_spend_change: true/);
assert.match(gate, /secrets_included: false/);
assert.doesNotMatch(gate, /fetch\(|axios|GoogleAdsApi|GoogleAdsClient|mutateCampaignBudgets|mutate\(|child_process|exec\(|spawn\(/i);
assert.doesNotMatch(gate, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|refresh_token|client_secret|private_key|value_ciphertext|decryptToken/i);

assert.match(skeleton, /runExecutionEnablementGate/);
assert.match(skeleton, /blocked_execution_enablement_missing_or_disabled/);
assert.match(skeleton, /enablement/);
assert.match(skeleton, /google_ads_budget_change_execution_adapter/);
assert.match(skeleton, /no_provider_call: true/);
assert.match(skeleton, /no_spend_change: true/);
assert.match(skeleton, /secrets_included: false/);
assert.doesNotMatch(skeleton, /fetch\(|axios|GoogleAdsApi|GoogleAdsClient|mutateCampaignBudgets|mutate\(|child_process|exec\(|spawn\(/i);
assert.doesNotMatch(skeleton, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|refresh_token|client_secret|private_key|value_ciphertext|decryptToken/i);

assert.match(migration, /CREATE TABLE IF NOT EXISTS execution_enablement_registry/);
assert.match(migration, /chk_execution_enablement_no_secrets/);
assert.match(migration, /execution_enablement_registry_policy_v1/);
assert.match(migration, /execution_enablement_gate/);
assert.match(migration, /default_decision_without_row','blocked_execution_enablement_missing_or_disabled/);
assert.match(migration, /requires_explicit_enablement_row',true/);
assert.match(migration, /execution_enabled_default',false/);
assert.match(migration, /missing_enablement_blocks_provider_execution/);
assert.match(migration, /no_provider_call',true/);
assert.match(migration, /no_spend_change',true/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /INSERT INTO execution_enablement_registry/i);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);

assert.match(adminCli, /execution_enablement_gate/);
assert.match(adminCli, /scripts\/execution-enablement-gate\.mjs/);
assert.match(runner, /248_sprint67_execution_enablement_registry\.sql/);

console.log("Execution enablement registry guard passed");
