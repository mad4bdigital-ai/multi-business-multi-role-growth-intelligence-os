import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/257_sprint68_agent_runtime_ledger_readiness.sql", import.meta.url), "utf8");

assert.match(migration, /v_agent_runtime_ledger_counts/);
assert.match(migration, /v_agent_runtime_ledger_quality/);
assert.match(migration, /v_agent_runtime_ledger_readiness/);
assert.match(migration, /agent_model_runs/);
assert.match(migration, /agent_tool_calls/);
assert.match(migration, /tool_call_missing_trace_total/);
assert.match(migration, /raw_content_issue_rows/);
assert.match(migration, /secret_issue_rows/);
assert.match(migration, /agent_runtime_ledger_smoke/);
assert.match(migration, /secrets_included/);
assert.doesNotMatch(migration, /INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
assert.doesNotMatch(migration, /prompt_text|raw_prompt|raw_args|raw_result|secret_value|token_value/i);

console.log("Agent runtime ledger readiness migration guard passed");
