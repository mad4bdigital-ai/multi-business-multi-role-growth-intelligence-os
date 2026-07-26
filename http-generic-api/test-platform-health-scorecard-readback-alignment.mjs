import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("migrations/291_sprint68_platform_health_scorecard_readback_alignment.sql", "utf8");

for (const migration of [
  "908_sprint68_ticket_external_hostinger_gmail_provider_options.sql",
  "909_sprint68_ticket_external_dynamic_recipient_allowlist.sql",
  "956_sprint68_external_delivery_allowlist_readiness_view_updated_at.sql",
]) {
  assert(sql.includes(migration), `migration must reconcile authorization for ${migration}`);
}

assert(sql.includes("CREATE OR REPLACE VIEW `v_platform_health_scorecard_components`"), "migration must replace scorecard component view");
assert(sql.includes("system_layer_tenant_tools_active"), "scorecard must distinguish explicit system-layer tenant tools from recursive wrappers");
assert(sql.includes("tags NOT LIKE '%system_layer_tool%'"), "recursive wrapper count must exclude named system-layer tools");
assert(sql.includes("unauthorized_recent_migration_count"), "scorecard must continue checking unauthorized recent migrations");
assert(sql.includes("platform_health_scorecard_reconciliation"), "historical authorizations must be traceable to scorecard reconciliation source");
assert(sql.includes("no_provider_call"), "migration must retain no-provider-call metadata evidence");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(sql), "migration must not be destructive");
assert(!/secret\s*=\s*['\"][^'\"]+/i.test(sql), "migration must not include inline secrets");

console.log("platform health scorecard readback alignment guard passed");
