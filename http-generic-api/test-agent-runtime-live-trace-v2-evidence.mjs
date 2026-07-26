import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/agent-runtime-live-trace-smoke.mjs", import.meta.url), "utf8");

assert.match(script, /agent_runtime_live_trace_smoke_v2/);
assert.match(script, /brandEvidence/);
assert.match(script, /businessActivityEvidence/);
assert.match(script, /resourceAuthorityEvidence/);
assert.match(script, /budgetAuthorityEvidence/);
assert.match(script, /platform_admin_control/);
assert.match(script, /agent_runtime_provider_smoke/);
assert.match(script, /preview_authorized_no_target_write/);
assert.match(script, /bounded_max_tokens_32_policy/);
assert.match(script, /external_write: false/);
assert.match(script, /external_send: false/);
assert.match(script, /credential_payload_returned: false/);
assert.match(script, /secrets_included: false/);

console.log(JSON.stringify({ ok: true, test: "agent_runtime_live_trace_v2_evidence_static" }));
