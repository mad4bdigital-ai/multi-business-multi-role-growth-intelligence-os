import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("migrations/289_sprint68_external_delivery_policy_scope_alignment.sql", "utf8");

assert(sql.includes("support_ticket_external_delivery_orchestration_readback_policy_v1"), "migration must target External Delivery readback policy");
assert(sql.includes("no_external_send"), "migration must align execution_scope with no_external_send token");
assert(sql.includes("v_platform_orchestration_external_delivery_readiness"), "migration must align affects_layer with External Delivery readiness view token");
assert(/UPDATE\s+execution_policies/i.test(sql), "migration must update execution_policies metadata only");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(sql), "migration must not be destructive");
assert(!/external_send_performed\s*['\"]?\s*,\s*true/i.test(sql), "migration must not certify external send");

console.log("external delivery policy scope alignment guard passed");
