import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const policy = readFileSync("supportTicketExternalDeliveryPolicyService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/1001_sprint68_tenant_ticket_admin_gpt_link_support.sql", "utf8");

for (const expected of [
  "DEFAULT_ADMIN_GPT_REPAIR_LINK_BASE_URL",
  "g-69c82c73bd6081918c52e38525b2d154-growth-intelligence-platform-admin-assistant",
  "buildAdminGptRepairPromptState",
  "createAgentHandoffState",
  "admin_gpt_repair_link",
  "admin_gpt_resume_state_id",
  "admin_gpt_repair_prompt_state",
  "resume_state_id=",
  "requested_action=",
  "support_ticket_external_delivery_repair",
  "target_surface: DEFAULT_ADMIN_GPT_AGENT_NAME",
  "one_time_use: false",
  "review_external_delivery",
  "prompt=",
  "external_send_performed: false",
  "secrets_included: false",
]) {
  assert(policy.includes(expected), `external delivery approval policy must include ${expected}`);
}

for (const expected of [
  "resolveMembershipForAdminTenantTicketSimulation",
  "/admin/support/tickets/tenant-user/create-simulation",
  "tenantTicketEnvelope(simulatedReq, membership)",
  "route_equivalent: \"/me/support/tickets\"",
  "support_additive_only: true",
  "secrets_included: false",
]) {
  assert(routes.includes(expected), `support ticket routes must include ${expected}`);
}

for (const expected of [
  "support_ticket.admin_gpt_repair_link",
  "support_ticket_tenant_user_create_simulation",
  "admin_platform_endpoint_tools",
  "support_additive_only",
  "secrets_included",
]) {
  assert(migration.includes(expected), `migration must include ${expected}`);
}

assert(!policy.includes("password"), "repair link state must not include password fields");
assert(!policy.includes("access_token"), "repair link state must not include access token fields");
assert(!policy.includes("state_json=${JSON.stringify(state)}"), "Admin GPT URL must not embed raw handoff state");
const handoffCurrentState = policy.slice(
  policy.indexOf("current_state: {"),
  policy.indexOf("required_checks: repairPromptState.required_checks")
);
assert(!handoffCurrentState.includes("credential_ref"), "governed handoff current_state must not include credential references");
assert(policy.includes("admin_gpt_repair_prompt_state: repairPromptState"), "legacy internal approval payload support must remain additive");
assert(!migration.includes("client_secret"), "migration must not include client secrets");

console.log("tenant ticket Admin GPT link support contract tests passed");
