import assert from "node:assert/strict";
import fs from "node:fs";
import YAML from "yaml";
import {
  canViewTenantAdminTicketEvents,
  decodeTenantRequestCursor,
  encodeTenantRequestCursor,
  getTenantRequestInboxItem,
  listTenantRequestInbox,
  redactTenantRequestValue,
} from "./tenantRequestInboxService.js";
import {
  GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS,
  inspectGovernedResponseChunkSchema,
} from "./governedToolResponseChunkStore.js";

const ticketId = "bae08982-cec1-4527-8be2-68d501706345";
const caseId = "723da749-a434-4e69-a231-98dfe95e17b8";
const tenantId = "00000000-0000-4000-a000-000000000001";
const lastSeenAt = "2026-07-29T05:34:19.000Z";

const cursor = encodeTenantRequestCursor({ latestActivityAt: lastSeenAt, ticketId });
assert.deepEqual(decodeTenantRequestCursor(cursor), { latestActivityAt: lastSeenAt, ticketId });
assert.throws(() => decodeTenantRequestCursor("not-a-cursor"), (error) => error.code === "tenant_request_cursor_invalid");
assert.deepEqual(
  redactTenantRequestValue({ ok: true, access_token: "unsafe", nested: { private_key: "unsafe" } }),
  { ok: true, access_token: "[redacted]", nested: { private_key: "[redacted]" } },
);
assert.equal(canViewTenantAdminTicketEvents({ role: "member" }), false);
assert.equal(canViewTenantAdminTicketEvents({ role: "manager" }), false);
assert.equal(canViewTenantAdminTicketEvents({ role: "admin" }), true);
assert.equal(canViewTenantAdminTicketEvents({ role: "owner" }), true);
assert.equal(canViewTenantAdminTicketEvents({ role: "platform_owner" }), true);
assert.equal(canViewTenantAdminTicketEvents({ isAdmin: true, role: "member" }), true);

function fakePool(steps) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      const step = steps.shift();
      assert(step, `unexpected query: ${sql}`);
      if (step.assert) step.assert(sql, params);
      if (step.error) throw step.error;
      return [step.rows || []];
    },
  };
}

const listPool = fakePool([
  {
    rows: [{ role: "member" }],
    assert(sql, params) {
      assert.match(sql, /FROM memberships/u);
      assert.deepEqual(params, ["user-1", tenantId]);
    },
  },
  {
    rows: [{ present: 1 }],
    assert(sql) { assert.match(sql, /information_schema\.columns/u); },
  },
  {
    rows: [{
      ticket_id: ticketId,
      tenant_id: tenantId,
      title: "Tenant runtime failure",
      ticket_type: "platform_tool_surface_bug",
      category: "escalation",
      ticket_status: "open",
      priority: "urgent",
      severity: "sev2",
      occurrence_count: 5,
      queue_key: "tenant_support",
      assigned_to: "platform-ops",
      customer_status: "under_review",
      sla_status: "at_risk",
      last_seen_at: lastSeenAt,
      ticket_created_at: "2026-07-28T01:00:00.000Z",
      ticket_updated_at: lastSeenAt,
      case_id: caseId,
      case_status: "escalated",
      case_severity: "high",
      root_family: "general_operational_review",
      playbook_key: "tenant_resolution_triage_v1",
      current_step_key: "escalated_to_platform",
      readback_status: "not_run",
      resource_ref: `ticket://${ticketId}`,
      case_created_at: "2026-07-28T01:05:00.000Z",
      case_updated_at: lastSeenAt,
      latest_activity_at: lastSeenAt,
    }],
    assert(sql, params) {
      assert.match(sql, /c2\.ticket_id = t\.ticket_id/u);
      assert.match(sql, /ORDER BY latest_activity_at DESC, t\.ticket_id DESC/u);
      assert.match(sql, /SELECT MAX\(tle\.created_at\)/u, "latest activity must include visible ticket lifecycle events");
      assert.match(sql, /tle\.visibility = 'customer'/u, "ordinary member latest activity must ignore tenant-admin and internal-support events");
      assert.match(sql, /FROM tenant_resolution_case_events trce/u, "latest activity must include resolution-case events");
      assert.match(sql, /FROM tenant_resolution_readbacks trr/u, "latest activity must include readbacks");
      assert.doesNotMatch(sql, /OFFSET/u);
      assert.equal(params.at(-1), 51);
    },
  },
]);
const list = await listTenantRequestInbox(
  { tenant_id: tenantId, limit: 50 },
  { auth: { user_id: "user-1", is_admin: false }, pool: listPool },
);
assert.equal(list.items.length, 1);
assert.equal(list.items[0].ticket.ticketId, ticketId);
assert.equal(list.items[0].ticket.status, "open");
assert.equal(list.items[0].ticket.occurrenceCount, 5);
assert.equal(list.items[0].resolutionCase.resolutionCaseId, caseId);
assert.equal(list.items[0].resolutionCase.status, "escalated");
assert.notEqual(list.items[0].ticket.status, list.items[0].resolutionCase.status, "ticket and case states must remain independent");
assert.equal(list.page.hasMore, false);

const forbiddenPool = fakePool([{ rows: [] }]);
await assert.rejects(
  () => listTenantRequestInbox(
    { tenant_id: tenantId },
    { auth: { user_id: "other-user", is_admin: false }, pool: forbiddenPool },
  ),
  (error) => error.code === "tenant_request_scope_violation" && error.status === 403,
);

const detailPool = fakePool([
  { rows: [{ role: "member" }] },
  { rows: [{ present: 1 }] },
  { rows: [{
    ticket_id: ticketId,
    tenant_id: tenantId,
    ticket_status: "open",
    priority: "urgent",
    occurrence_count: 5,
    last_seen_at: lastSeenAt,
    ticket_updated_at: lastSeenAt,
    case_id: caseId,
    case_status: "escalated",
    case_updated_at: lastSeenAt,
    latest_activity_at: lastSeenAt,
  }] },
  {
    rows: [
      { event_id: "ticket-public", event_type: "customer_reply", visibility: "customer", summary: "Visible", payload_json: JSON.stringify({ token: "unsafe", safe: true }), created_at: "2026-07-29T05:00:00.000Z" },
      { event_id: "ticket-tenant-admin", event_type: "tenant_admin_note", visibility: "tenant_admin", summary: "Admin only", payload_json: "{}", created_at: "2026-07-29T05:00:30.000Z" },
      { event_id: "ticket-internal", event_type: "internal_note", visibility: "internal_support", summary: "Hidden", payload_json: "{}", created_at: "2026-07-29T05:01:00.000Z" },
    ],
    assert(sql) {
      assert.match(sql, /visibility = 'customer'/u, "ordinary tenant members must be filtered to customer-visible ticket events at SQL level");
      assert.doesNotMatch(sql, /tenant_admin/u, "ordinary tenant member queries must not request tenant-admin events");
      assert.match(sql, /ORDER BY created_at DESC, id DESC[\s\S]*LIMIT 500/u, "ticket events must bound the newest rows first");
      assert.match(sql, /bounded_ticket_events[\s\S]*ORDER BY created_at ASC, id ASC/u, "bounded ticket events must be restored to chronological order");
    },
  },
  {
    rows: [{ event_id: "case-event", event_type: "case_escalated", actor_type: "system", actor_id: "ops", from_status: "diagnosing", to_status: "escalated", evidence_ref: "internal://evidence", event_json: JSON.stringify({ secret: "unsafe", reason: "platform" }), created_at: "2026-07-29T05:02:00.000Z" }],
    assert(sql) {
      assert.match(sql, /ORDER BY created_at DESC, id DESC[\s\S]*LIMIT 500/u, "case events must bound the newest rows first");
      assert.match(sql, /bounded_case_events[\s\S]*ORDER BY created_at ASC, id ASC/u);
    },
  },
  {
    rows: [{ readback_id: "readback-1", decision: "still_active", expected_state_json: "{}", observed_state_json: JSON.stringify({ api_key: "unsafe" }), blocking_reasons_json: "[]", source_alerts_remaining_json: "[]", created_at: "2026-07-29T05:03:00.000Z" }],
    assert(sql) {
      assert.match(sql, /ORDER BY created_at DESC, id DESC[\s\S]*LIMIT 200/u, "readbacks must bound the newest rows first");
      assert.match(sql, /bounded_readbacks[\s\S]*ORDER BY created_at ASC, id ASC/u);
    },
  },
]);
const detail = await getTenantRequestInboxItem(
  { tenant_id: tenantId, ticket_id: ticketId },
  { auth: { user_id: "user-1", is_admin: false }, pool: detailPool },
);
assert.equal(detail.timeline.some((event) => event.eventId === "ticket-internal"), false, "tenant timeline must hide internal ticket events");
assert.equal(detail.timeline.some((event) => event.eventId === "ticket-tenant-admin"), false, "ordinary tenant members must not receive tenant-admin ticket events even if a database adapter returns one");
assert.equal(detail.authorization.role, "member");
assert.equal(detail.authorization.tenantAdminEventsVisible, false);
const tenantCaseEvent = detail.timeline.find((event) => event.eventId === "case-event");
assert.equal(Object.hasOwn(tenantCaseEvent, "evidenceRef"), false, "tenant case timeline must omit internal evidence refs");
assert.equal(Object.hasOwn(tenantCaseEvent, "event"), false, "tenant case timeline must omit internal event payloads");
const tenantReadback = detail.timeline.find((event) => event.readbackId === "readback-1");
assert.equal(Object.hasOwn(tenantReadback, "observedState"), false, "tenant readbacks must expose decision only");

const schemaPool = fakePool([{
  rows: GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS
    .filter((column) => column !== "owner_workspace_id")
    .map((column_name) => ({ column_name })),
}]);
const schema = await inspectGovernedResponseChunkSchema({ pool: schemaPool, operation: "test_schema" });
assert.equal(schema.ready, false);
assert.deepEqual(schema.missing_columns, ["owner_workspace_id"]);
assert.equal(schema.operation, "test_schema");
assert.equal(schema.secrets_included, false);

const inboxService = fs.readFileSync(new URL("./tenantRequestInboxService.js", import.meta.url), "utf8");
assert.match(inboxService, /const \[membership\] = rows;/u, "membership scope resolution must bind the verified query result without a second unproven first-candidate lookup");
assert.doesNotMatch(inboxService, /role:\s*rows\[0\]\.role/u, "membership role projection must not select rows[0] directly");

const migration = fs.readFileSync(new URL("./migrations/1041_sprint69_tenant_request_inbox_and_chunk_store_hardening.sql", import.meta.url), "utf8");
assert.match(migration, /ADD COLUMN ticket_id CHAR\(36\)/u);
// Match the SQL contract literally: a regex here would interpret its character class and quantifier instead of checking the migration text.
assert.ok(
  migration.includes("resource_ref REGEXP '^ticket://[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'"),
  "migration must backfill only canonical ticket UUID resource refs",
);
assert.match(migration, /idx_tickets_tenant_status_last_seen/u);
assert.match(migration, /idx_resolution_cases_ticket_status_updated/u);
assert.match(migration, /v_governed_response_chunk_runtime_schema_readiness/u);
assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|INDEX)/iu);
assert.doesNotMatch(migration, /DELETE\s+FROM/iu);

const resolutionService = fs.readFileSync(new URL("./supportTicketResolutionService.js", import.meta.url), "utf8");
assert.match(
  resolutionService,
  /INSERT INTO tenant_resolution_cases[\s\S]*?ticket_id[\s\S]*?resource_ref/u,
  "resolution case creation must persist the explicit ticket link",
);
assert.match(resolutionService, /c\.ticket_id = \?/u, "resolution reads must prefer the explicit ticket link");

const routes = fs.readFileSync(new URL("./routes/supportTicketRoutes.js", import.meta.url), "utf8");
for (const route of [
  "/admin/tenant-requests",
  "/admin/tenant-requests/:ticketId",
  "/tenants/:tenantId/requests",
  "/tenants/:tenantId/requests/:ticketId",
]) assert(routes.includes(route), `missing tenant request route ${route}`);

const gptTools = fs.readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
assert.match(gptTools, /response_chunk_persistence_unavailable/u);
assert.match(gptTools, /buildBoundedInlineChunkFallback/u, "large tool responses must fall back to bounded inline output when durable persistence is unavailable");
assert.match(gptTools, /request_id/u, "chunk fallback diagnostics must retain a request identifier without logging response content");

const openapi = YAML.parse(fs.readFileSync(new URL("./openapi/tenant-requests.openapi.yaml", import.meta.url), "utf8"));
assert.equal(openapi.openapi, "3.1.0");
assert(openapi.paths["/admin/tenant-requests"]);
assert(openapi.paths["/tenants/{tenantId}/requests/{ticketId}"]);
assert(
  openapi.components.parameters.TicketStatus.schema.enum.includes("resolved"),
  "ticket status filter contract must include the runtime-supported resolved state",
);
assert.equal(openapi.components.schemas.TenantRequestInboxPage.properties.items.maxItems, 100);
assert.equal(openapi.components.schemas.TenantRequestItem.properties.secretsIncluded.const, false);
assert.deepEqual(
  openapi.paths["/admin/tenant-requests"].get.security,
  [{ adminBearerAuth: [] }, { backendApiKeyAuth: [] }],
  "admin tenant request list must declare the same auth alternatives enforced by runtime guards",
);
assert.deepEqual(
  openapi.paths["/admin/tenant-requests/{ticketId}"].get.security,
  [{ adminBearerAuth: [] }, { backendApiKeyAuth: [] }],
  "admin tenant request detail must declare the same auth alternatives enforced by runtime guards",
);
assert.deepEqual(
  openapi.paths["/tenants/{tenantId}/requests"].get.security,
  [{ userJwtAuth: [] }],
  "tenant request list must require a user JWT before membership scoping",
);
assert.deepEqual(
  openapi.paths["/tenants/{tenantId}/requests/{ticketId}"].get.security,
  [{ userJwtAuth: [] }],
  "tenant request detail must require a user JWT before object-level tenant scoping",
);
for (const scheme of ["adminBearerAuth", "backendApiKeyAuth", "userJwtAuth"]) {
  assert(openapi.components.securitySchemes[scheme], `missing OpenAPI security scheme ${scheme}`);
}

console.log("tenant request inbox and chunk hardening tests passed");
