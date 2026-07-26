import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/tool-bus-descriptor-dry-run.mjs", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");

assert.match(script, /runtime_endpoint_call/);
assert.match(script, /v_platform_exports_current_v2/);
assert.match(script, /recursiveWrappers/);
assert.match(script, /collisionReport/);
assert.match(script, /dispatch_executed: false/);
assert.match(script, /provider_call_performed: false/);
assert.match(script, /external_write_performed: false/);
assert.match(script, /credential_payload_read: false/);
assert.match(script, /secrets_included: false/);
assert.match(routes, /tool_bus_descriptor_dry_run/);
assert.match(routes, /tool-bus-descriptor-dry-run\.mjs/);

console.log(JSON.stringify({ ok: true, test: "tool_bus_descriptor_dry_run_static" }));
