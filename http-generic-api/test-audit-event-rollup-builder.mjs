import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/audit-event-rollup-builder.mjs", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");

assert.match(script, /APPLY_AUDIT_EVENT_ROLLUP_BUILDER/);
assert.match(script, /db_change_audit_events/);
assert.match(script, /asset_audit_events/);
assert.match(script, /checkpoint_auto_rollups/);
assert.match(script, /NOT EXISTS/);
assert.match(script, /COLLATE utf8mb4_unicode_ci/);
assert.match(script, /raw_payload_stored: false/);
assert.match(script, /raw_before_after_stored: false/);
assert.match(script, /secrets_included: false/);
assert.match(script, /process\.exit\(0\)/);
assert.match(script, /process\.exit\(1\)/);
assert.doesNotMatch(script, /DELETE\s+FROM|UPDATE\s+platform_audit_event_bus|DROP\s+TABLE|TRUNCATE/i);
assert.doesNotMatch(script, /before_json|after_json|payload_json|secret_value|token_value/i);

assert.match(adminCli, /audit_event_rollup_builder/);
assert.match(adminCli, /audit_event_rollup_builder_tick/);
assert.match(adminCli, /APPLY_AUDIT_EVENT_ROLLUP_BUILDER/);
assert.match(adminCli, /allow_extra_args: false/);

console.log("Dynamic audit rollup builder guard passed");
