import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/244_sprint67_preflight_execution_gate_policy_readback_fix.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(migration, /preflight_execution_gate_policy_readback_fix_v1/);
assert.match(migration, /preflight_ledger_validator_policy_v1/);
assert.match(migration, /JSON_MERGE_PATCH/);
assert.match(migration, /future_execution_contract/);
assert.match(migration, /future_execution_adapters_must_use_preflight_execution_gate_helper/);
assert.match(migration, /direct_family_ledger_reads_for_execution_forbidden/);
assert.match(migration, /requires_hash_readback/);
assert.match(migration, /requires_no_provider_call_marker/);
assert.match(migration, /requires_no_spend_change_marker/);
assert.match(migration, /preflightLedgerExecutionGate\.js/);
assert.match(migration, /secrets_included', false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);
assert.match(runner, /244_sprint67_preflight_execution_gate_policy_readback_fix\.sql/);

console.log("Preflight execution gate policy readback fix guard passed");
