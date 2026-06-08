import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyExistingSupportTicket } from "./supportTicketService.js";

const service = readFileSync("supportTicketService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/234_sprint68_ticket_lifecycle_reconciliation_tool.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

const realTickets = [
  {
    title: "Brand access mapping review requested",
    category: "escalation",
    priority: "normal",
    metadata_json: JSON.stringify({ metadata: { tool: "workspace_brands_list", observed_count: 0, diagnostic_counts_used_as_authority: false } }),
    expected: { rule: "brand_authority_missing", queue: "access_authority", state: "permission_review_required", customer: "under_review" },
  },
  {
    title: "Hostinger WordPress Installation Runtime Request for WOVacation",
    category: "escalation",
    priority: "normal",
    metadata_json: JSON.stringify({ body: "Tenant requested direct WordPress installation on wovacation.com using Hostinger credentials and Hostinger Developer API integration." }),
    expected: { rule: "hostinger_wordpress_provisioning", queue: "managed_services", state: "automation_planned", customer: "in_progress" },
  },
  {
    title: "Device installer backend error: localApps is not defined",
    category: "escalation",
    priority: "high",
    metadata_json: JSON.stringify({ metadata: { error_code: "device_install_failed", tool: "connect_device_install", probable_root_cause: "local_apps vs localApps variable mismatch" } }),
    expected: { rule: "device_install_runtime_bug", queue: "platform_engineering", state: "internal_review_required", customer: "under_review" },
  },
  {
    title: "Tenant onboarding escalation",
    category: "escalation",
    priority: "urgent",
    metadata_json: JSON.stringify({ metadata: { onboarding: { state: "workspace_ready_not_activated" } } }),
    expected: { rule: "tenant_onboarding_issue", queue: "tenant_support", state: "triage_pending", customer: "under_review" },
  },
  {
    title: "Fix admin shell run alias passthrough",
    category: "managed_task",
    priority: "urgent",
    metadata_json: JSON.stringify({ problem: "executeAdminControl shell action run cannot pass alias to runner" }),
    expected: { rule: "platform_facade_bug", queue: "platform_engineering", state: "internal_review_required", customer: "under_review" },
  },
  {
    title: "Expose admin/runtime Google Docs getDocument facade",
    category: "managed_task",
    priority: "urgent",
    metadata_json: JSON.stringify({ missing_layer: "admin_tool_facade_runtime_call", required_tool: "google_docs_get_document" }),
    expected: { rule: "platform_facade_bug", queue: "platform_engineering", state: "internal_review_required", customer: "under_review" },
  },
];

for (const ticket of realTickets) {
  const result = classifyExistingSupportTicket(ticket);
  assert.equal(result.matched_rule, ticket.expected.rule, `expected ${ticket.title} to match ${ticket.expected.rule}`);
  assert.equal(result.patch.queue_key, ticket.expected.queue);
  assert.equal(result.patch.lifecycle_state, ticket.expected.state);
  assert.equal(result.patch.customer_status, ticket.expected.customer);
  assert.equal(result.should_update, true);
  assert.equal(result.secrets_included, false);
}

assert(service.includes("reconcileOpenSupportTickets"), "service must expose reconcileOpenSupportTickets");
assert(service.includes("legacy_reconciled"), "reconcile apply must write legacy_reconciled lifecycle events");
assert(routes.includes('/admin/support/tickets/reconcile'), "admin route must expose reconciliation endpoint");
assert(routes.includes("reconcileOpenSupportTickets"), "route must call reconciliation service");
assert(migration.includes("support_ticket_reconcile"), "migration 234 must register support_ticket_reconcile tool");
assert(runner.includes("234_sprint68_ticket_lifecycle_reconciliation_tool.sql"), "runner must allowlist migration 234");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 234 must be additive/non-destructive");

console.log("ticket lifecycle reconciliation tests passed");
