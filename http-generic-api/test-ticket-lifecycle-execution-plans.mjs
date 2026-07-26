import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _testingTicketClassification } from "./supportTicketService.js";

const service = readFileSync("supportTicketService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/236_sprint68_ticket_lifecycle_execution_plans.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const { executionPlanTemplateForTicket } = _testingTicketClassification();

const brandTemplate = executionPlanTemplateForTicket({ ticket_type: "brand_authority_missing" });
assert.equal(brandTemplate.workflow_key, "workspace_brand_authority_diagnostic");
assert.equal(brandTemplate.target_key, "access_authority");
assert.equal(brandTemplate.access_decision, "REQUIRE_REVIEW");
assert(brandTemplate.steps.some((step) => step.key === "read_brand_grants"));

const hostingerTemplate = executionPlanTemplateForTicket({ source_event: "hostinger_wordpress_provisioning" });
assert.equal(hostingerTemplate.workflow_key, "managed_hostinger_wordpress_provisioning");
assert.equal(hostingerTemplate.access_decision, "ROUTE_TO_MANAGED_SERVICE");
assert(hostingerTemplate.steps.some((step) => step.key === "request_approval"));

const platformTemplate = executionPlanTemplateForTicket({ ticket_type: "platform_tool_surface_bug" });
assert.equal(platformTemplate.workflow_key, "platform_tool_surface_bug_remediation");
assert.equal(platformTemplate.target_key, "platform_engineering");

const fallbackTemplate = executionPlanTemplateForTicket({ ticket_type: "unknown" });
assert.equal(fallbackTemplate.workflow_key, "support_ticket_general_review");

for (const expected of [
  "createSupportTicketExecutionPlan",
  "executionPlanTemplateForTicket",
  "INSERT INTO execution_plans",
  "INSERT INTO ticket_workflow_links",
  "execution_plan_created",
  "support_ticket_execution_plan_created",
]) {
  assert(service.includes(expected), `supportTicketService must include ${expected}`);
}

assert(routes.includes('/admin/support/tickets/:ticket_id/execution-plan'), "route must expose execution-plan endpoint");
assert(routes.includes("createSupportTicketExecutionPlan"), "route must call execution plan service");
assert(migration.includes("support_ticket_create_execution_plan"), "migration 236 must register support_ticket_create_execution_plan");
assert(runner.includes("236_sprint68_ticket_lifecycle_execution_plans.sql"), "runner must allowlist migration 236");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 236 must be additive/non-destructive");

console.log("ticket lifecycle execution plan tests passed");
