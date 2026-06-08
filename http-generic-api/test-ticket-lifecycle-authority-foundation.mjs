import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  _testingTicketClassification,
  computeSupportTicketDedupeKey,
  sanitizeTicketMetadata,
} from "./supportTicketService.js";

const migration = readFileSync("migrations/233_sprint68_ticket_lifecycle_authority_foundation.sql", "utf8");
const service = readFileSync("supportTicketService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const connectRoutes = readFileSync("routes/connectRoutes.js", "utf8");
const routeIndex = readFileSync("routes/index.js", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

const classification = _testingTicketClassification().ISSUE_CLASSIFICATION;

// Realistic use case 1: Tenant GPT cannot confirm brands from workspace authority.
assert.equal(classification.brand_authority_missing.queue_key, "access_authority");
assert.equal(classification.brand_authority_missing.lifecycle_state, "permission_review_required");
assert.equal(classification.brand_authority_missing.customer_status, "under_review");

const brandDedupeA = computeSupportTicketDedupeKey({
  tenant_id: "tenant-1",
  user_id: "user-1",
  source_event: "brand_authority_missing",
  resource: { type: "brand", ref: "all-royal-egypt" },
});
const brandDedupeB = computeSupportTicketDedupeKey({
  tenant_id: "tenant-1",
  user_id: "user-1",
  ticket_type: "brand_authority_missing",
  resource_type: "brand",
  resource_ref: "all-royal-egypt",
});
assert.equal(brandDedupeA, brandDedupeB, "same real brand authority issue must dedupe to one open ticket");

// Realistic use case 2: connector outage should route to connector operations with higher severity.
assert.equal(classification.connector_unreachable.queue_key, "connector_operations");
assert.equal(classification.connector_unreachable.severity, "sev2");
assert.equal(classification.connector_unreachable.customer_status, "in_progress");

const connectorDedupe = computeSupportTicketDedupeKey({
  tenant_id: "tenant-1",
  user_id: "user-1",
  source_event: "connector_unreachable",
  resource: { type: "device", ref: "mohammedlap" },
});
assert.notEqual(brandDedupeA, connectorDedupe, "unrelated resource incidents must not collapse into the same ticket");

// Realistic use case 3: secrets must never be retained raw in ticket metadata.
const redacted = sanitizeTicketMetadata({
  safe: "ok",
  nested: { access_token: "abc", note: "visible" },
  password: "super-secret",
});
assert.equal(redacted.safe, "ok");
assert.equal(redacted.nested.note, "visible");
assert.equal(redacted.nested.access_token, "[redacted]");
assert.equal(redacted.password, "[redacted]");

// Migration 233 must be additive and expose tenant/admin tools.
for (const expected of [
  "ticket_lifecycle_events",
  "ticket_resource_links",
  "ticket_permission_snapshots",
  "ticket_workflow_links",
  "support_ticket_create",
  "support_ticket_list",
  "support_ticket_get",
  "support_ticket_event_append",
  "support_ticket_admin_list",
  "support_ticket_transition",
  "support_ticket_assign",
]) {
  assert(migration.includes(expected), `migration 233 must include ${expected}`);
}
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 233 must remain additive/non-destructive");
assert(runner.includes("233_sprint68_ticket_lifecycle_authority_foundation.sql"), "governed runner must allowlist migration 233");

// Tenant routes must require user JWT; admin routes must use backend/admin guards.
assert(routes.includes('router.post("/me/support/tickets", requireUserJwt'), "tenant create route must be user-JWT protected");
assert(routes.includes('router.get("/me/support/tickets", requireUserJwt'), "tenant list route must be user-JWT protected");
assert(routes.includes('router.get("/admin/support/tickets", ...adminGuards'), "admin list route must be admin/backend protected");
assert(routes.includes('createOrAppendSupportTicket(tenantTicketEnvelope(req, membership))'), "tenant ticket create must use centralized service");

// Route ordering must expose tenant-safe /me/support before root protected routers.
assert(routeIndex.includes('import { buildSupportTicketRoutes } from "./supportTicketRoutes.js";'), "support routes must be registered in route index");
assert(routeIndex.indexOf("app.use(buildWorkspaceResourceRoutes())") < routeIndex.indexOf("app.use(buildSupportTicketRoutes"), "support routes should mount in the tenant-safe route block");
assert(routeIndex.indexOf("app.use(buildSupportTicketRoutes") < routeIndex.indexOf("app.use(buildAdminWorkspaceAuthorityRoutes"), "support routes must mount before later admin authority routes");

// connect_escalate must no longer create a ticket through a private one-off insert.
assert(connectRoutes.includes('import { createOrAppendSupportTicket } from "../supportTicketService.js";'), "connect escalation must import centralized ticket service");
assert(!connectRoutes.includes('INSERT INTO `tickets`'), "connect escalation must not directly insert tickets anymore");
assert(connectRoutes.includes("onboarding_escalations"), "connect escalation must still preserve onboarding escalation linkage");

// Service must create timeline, audit, permission snapshot, resource link, and dedupe event.
for (const expected of [
  "ticket_lifecycle_events",
  "timeline_events",
  "audit_log",
  "ticket_resource_links",
  "ticket_permission_snapshots",
  "dedupe_matched",
  "queue_assigned",
]) {
  assert(service.includes(expected), `support service must include ${expected}`);
}

console.log("ticket lifecycle authority foundation tests passed");
