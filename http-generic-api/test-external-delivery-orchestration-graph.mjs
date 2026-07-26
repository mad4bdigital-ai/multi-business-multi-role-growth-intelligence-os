import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("migrations/287_sprint68_external_delivery_orchestration_graph_plugin.sql", "utf8");

assert(sql.includes("support_ticket_external_delivery_orchestrator"), "migration must register the external delivery orchestration plugin");
assert(sql.includes("v_platform_orchestration_external_delivery_readiness"), "migration must expose external delivery readback view");
assert(sql.includes("support_ticket_external_delivery_orchestration_readback_policy_v1"), "migration must seed no-send readback policy");
assert(sql.includes("support_ticket_external_delivery_completion_certify"), "migration must require completion certification tool evidence");
assert(sql.includes("live_external_send_enabled',false") || sql.includes("live_external_send_enabled', false"), "migration must explicitly keep live external send disabled");
assert(sql.includes("no_external_send"), "migration must preserve no_external_send safety contract");
assert(sql.includes("no_raw_secrets"), "migration must preserve no_raw_secrets safety contract");
assert(sql.includes("no_credential_payload_read"), "migration must preserve no credential payload read safety contract");
assert(sql.includes("external_send_performed', false") || sql.includes("external_send_performed',false"), "readback evidence must state no external send was performed");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(sql), "migration must not be destructive");
assert(!/support_ticket_external_delivery_orchestrator[\s\S]*external_send_performed'\s*,\s*true/i.test(sql), "migration must not certify actual external send");

const stageMatches = sql.match(/support_ticket_external\.[a-z_]+/g) || [];
assert(new Set(stageMatches.filter((s) => !s.includes("_to_"))).size >= 7, "migration must define at least seven external delivery stages");
assert(sql.match(/support_ticket_external\.[a-z_]+_to_/g)?.length >= 0 || sql.includes("support_ticket_external.readiness_to_approval"), "migration must define graph edges");

console.log("external delivery orchestration graph guard passed");
