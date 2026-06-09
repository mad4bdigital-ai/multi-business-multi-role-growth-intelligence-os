import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ledger = readFileSync(new URL("./agentRuntimeLedger.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("./modelAdapter.js", import.meta.url), "utf8");
const router = readFileSync(new URL("./modelAdapterRouter.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./agentLoopRunner.js", import.meta.url), "utf8");

assert.match(ledger, /agent_model_runs/);
assert.match(ledger, /agent_tool_calls/);
assert.match(ledger, /no_raw_thinking_stored/);
assert.match(ledger, /raw_content_stored: false/);
assert.match(ledger, /raw_args_stored: false/);
assert.match(ledger, /raw_result_stored: false/);
assert.match(ledger, /secrets_included: false/);
assert.match(ledger, /non-blocking ledger/);
assert.doesNotMatch(ledger, /JSON\.stringify\(messages\)|JSON\.stringify\(args\)|JSON\.stringify\(result\)/);

assert.match(adapter, /recordAgentModelRunStarted/);
assert.match(adapter, /recordAgentModelRunCompleted/);
assert.match(adapter, /recordAgentModelRunFailed/);
assert.match(adapter, /recordAgentToolCallStarted/);
assert.match(adapter, /recordAgentToolCallCompleted/);
assert.match(adapter, /recordAgentToolCallFailed/);
assert.match(adapter, /ledger_tool_call_id/);
assert.match(adapter, /runToolCalls\(response\.tool_calls, \{ \.\.\.context, execution_trace_id \}, deps, modelRunId\)/);
assert.match(adapter, /deps\.callModel\?\.provider_key/);
assert.match(adapter, /deps\.callModel\?\.model_key/);

assert.match(router, /callModel\.provider_key = provider/);
assert.match(router, /callModel\.model_key = modelKey/);
assert.match(router, /provider_key: provider/);
assert.match(router, /model_key: modelKey/);

assert.match(runner, /context\.run_id = run_id/);
assert.match(runner, /context\.decision_run_id = plan\.decision_run_id \|\| plan\.plan_id \|\| run_id/);

console.log("Agent runtime ledger wiring guard passed");
