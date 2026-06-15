import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/audit-log-event-bus-bridge.mjs", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");

assert.match(script, /APPLY_AUDIT_LOG_EVENT_BUS_BRIDGE/);
assert.match(script, /export async function runAuditLogEventBusBridge/);
assert.match(script, /GET_LOCK/);
assert.match(script, /RELEASE_LOCK/);
assert.match(script, /platform_audit_event_bus/);
assert.match(script, /audit_log:/);
assert.match(script, /INSERT IGNORE INTO platform_audit_event_bus/);
assert.match(script, /'pending_rollup'/);
assert.match(script, /remaining_count/);
assert.match(script, /NOT EXISTS/);
assert.match(script, /COLLATE utf8mb4_unicode_ci/);
assert.match(script, /dry_run_only/);
assert.match(script, /missing_audit_bridge_confirmation/);
assert.match(script, /raw_payload_stored: false/);
assert.match(script, /raw_before_after_stored: false/);
assert.match(script, /secrets_included: false/);
assert.doesNotMatch(script, /before_json\s*[:=]\s*row\.before_json|after_json\s*[:=]\s*row\.after_json/);
assert.doesNotMatch(script, /DELETE\s+FROM|UPDATE\s+audit_log|DROP\s+TABLE|TRUNCATE/i);

assert.match(adminCli, /audit_log_event_bus_bridge/);
assert.match(adminCli, /audit_log_event_bus_bridge_tick/);
assert.match(adminCli, /APPLY_AUDIT_LOG_EVENT_BUS_BRIDGE/);
assert.match(adminCli, /allow_extra_args: false/);
assert.match(adminCli, /audit-log-event-bus-bridge\.mjs/);

console.log("Audit log event bus bridge guard passed");
