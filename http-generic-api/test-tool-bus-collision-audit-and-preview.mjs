import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const collisionAudit = readFileSync(new URL("./scripts/tool-bus-collision-audit.mjs", import.meta.url), "utf8");
const preview = readFileSync(new URL("./scripts/tool-bus-preview.mjs", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");

assert.match(collisionAudit, /intentional_admin_tenant_dual_surface/);
assert.match(collisionAudit, /legacy_bootstrap_export_duplicate/);
assert.match(collisionAudit, /kernel_transition_export_duplicate/);
assert.match(collisionAudit, /actual_collision_requires_review/);
assert.match(collisionAudit, /dispatch_executed: false/);
assert.match(collisionAudit, /credential_payload_read: false/);
assert.match(preview, /tool_bus_preview_only/);
assert.match(preview, /execute_adapter: false/);
assert.match(preview, /provider_call: false/);
assert.match(preview, /target_write: false/);
assert.match(preview, /credential_payload_read: false/);
assert.match(routes, /tool_bus_collision_audit/);
assert.match(routes, /tool_bus_preview/);

console.log(JSON.stringify({ ok: true, test: "tool_bus_collision_audit_and_preview_static" }));
