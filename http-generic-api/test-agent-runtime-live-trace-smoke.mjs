import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/agent-runtime-live-trace-smoke.mjs", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");

assert.match(script, /runOpenRouterProviderSmoke/);
assert.match(script, /recordAgentModelRunStarted/);
assert.match(script, /recordAgentModelRunCompleted/);
assert.match(script, /recordAgentToolCallStarted/);
assert.match(script, /recordAgentToolCallCompleted/);
assert.match(script, /writeExecutionEvidence/);
assert.match(script, /agent_runtime_live_trace_smoke/);
assert.match(script, /promoteActive: false/);
assert.match(script, /external_write: false/);
assert.match(script, /external_send: false/);
assert.match(script, /credential_payload_returned: false/);
assert.match(script, /secrets_included: false/);
assert.match(script, /raw_args_stored: false/);
assert.doesNotMatch(script, /PROMOTE_OPENROUTER_PROVIDER_ACTIVE_AFTER_LIVE_SMOKE/);
assert.match(routes, /agent_runtime_live_trace_smoke/);
assert.match(routes, /agent-runtime-live-trace-smoke\.mjs/);

console.log(JSON.stringify({ ok: true, test: "agent_runtime_live_trace_smoke_static" }));
