import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const helper = readFileSync(new URL("./preflightLedgerExecutionGate.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/243_sprint67_preflight_execution_gate_helper.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(helper, /requireValidatedPreflightForExecution/);
assert.match(helper, /validatePreflightLedger/);
assert.match(helper, /expectedEnvelopeId/);
assert.match(helper, /expectedDecision = "ready_for_dispatch"/);
assert.match(helper, /ready_for_dispatch/);
assert.match(helper, /preflight_ledger_validated/);
assert.match(helper, /preflightExecutionGateError/);
assert.match(helper, /secrets_included: false/);
assert.doesNotMatch(helper, /fetch\(|axios|GoogleAdsApi|GoogleAdsClient|mutateCampaignBudgets|mutate\(|child_process|exec\(|spawn\(/i);
assert.doesNotMatch(helper, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|refresh_token|client_secret|private_key|value_ciphertext|decryptToken/i);

assert.match(migration, /preflight_execution_gate_helper_policy_v1/);
assert.match(migration, /requireValidatedPreflightForExecution/);
assert.match(migration, /preflight_ledger_validate/);
assert.match(migration, /future_execution_adapters_must_use_helper',true/);
assert.match(migration, /direct_family_ledger_reads_for_execution_forbidden',true/);
assert.match(migration, /does_not_execute_target_capability',true/);
assert.match(migration, /no_provider_call',true/);
assert.match(migration, /no_spend_change',true/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);
assert.match(runner, /243_sprint67_preflight_execution_gate_helper\.sql/);

console.log("Preflight execution gate helper guard passed");
