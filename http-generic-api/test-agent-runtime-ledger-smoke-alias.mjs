import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/agent-runtime-ledger-smoke.mjs", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");

assert.match(script, /runLogicWithModel/);
assert.match(script, /fake_ledger_smoke_provider/);
assert.match(script, /fake_ledger_smoke_model/);
assert.match(script, /ledger_smoke_readonly_tool/);
assert.match(script, /agent_model_runs/);
assert.match(script, /agent_tool_calls/);
assert.match(script, /external_model_called: false/);
assert.match(script, /provider_dispatch_used: false/);
assert.match(script, /raw_prompt_stored: false/);
assert.match(script, /raw_tool_args_stored: false/);
assert.match(script, /raw_tool_result_stored: false/);
assert.match(script, /secrets_included: false/);
assert.doesNotMatch(script, /buildCallModel|OPENROUTER|OPENAI|ANTHROPIC|GEMINI|fetch\(|axios|https\.request|http\.request/);
assert.doesNotMatch(script, /INSERT\s+INTO\s+agent_model_runs|INSERT\s+INTO\s+agent_tool_calls/i);

assert.match(adminCli, /agent_runtime_ledger_smoke/);
assert.match(adminCli, /agent-runtime-ledger-smoke\.mjs/);
assert.match(adminCli, /allow_extra_args: false/);

console.log("Agent runtime ledger smoke alias guard passed");
