import assert from "node:assert/strict";

import {
  deriveSupportTicketIntegrity,
  listSupportTicketsWithIntegrity,
  reconcileSupportTicketIntegrity,
} from "./supportTicketLifecycleIntegrityService.js";

const legacySimulation = deriveSupportTicketIntegrity({
  is_test: 0,
  environment: "production",
  visibility_class: "customer_visible",
  metadata_json: { admin_simulation: true, environment: "qa" },
}, { stored_row: true });
assert.equal(legacySimulation.is_test, true);
assert.equal(legacySimulation.visibility_class, "internal_test");

const explicitFalse = deriveSupportTicketIntegrity({
  is_test: 0,
  environment: "production",
  visibility_class: "customer_visible",
  metadata_json: { is_test: false, admin_simulation: true, environment: "qa" },
}, { stored_row: true });
assert.equal(explicitFalse.is_test, false);

const listQueries = [];
const listConnection = {
  async query(sql) {
    listQueries.push(sql);
    if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) return [[]];
    return [[{
      ticket_id: "legacy-ticket",
      tenant_id: "tenant-a",
      title: "Legacy visible ticket",
      status: "open",
      occurrence_count: 1,
      metadata_json: {},
      latest_activity_at: "2026-08-01T12:00:00Z",
      first_response_at: null,
      triaged_at: null,
    }]];
  },
  release() {},
};
const listed = await listSupportTicketsWithIntegrity(
  { tenant_id: "tenant-a", user_id: "user-a", include_test: false },
  { pool: { async getConnection() { return listConnection; } } },
);
assert.equal(listed.schema_ready, false);
assert.equal(listed.tickets.length, 1);
const listSql = listQueries[1];
for (const migrationColumn of [
  "t.is_test",
  "t.environment",
  "t.visibility_class",
  "t.target_capability",
  "t.related_ticket_id",
  "t.parent_ticket_id",
  "t.supersedes_ticket_id",
  "t.first_response_at",
  "t.triaged_at",
]) {
  assert.doesNotMatch(listSql, new RegExp(migrationColumn.replace(".", "\\.")));
}
assert.match(listSql, /ticket_lifecycle_events activity_event/);
assert.match(listSql, /ORDER BY latest_activity_at DESC/);

const reconcileQueries = [];
const reconcileConnection = {
  async query(sql, params = []) {
    reconcileQueries.push({ sql, params });
    if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) return [[]];
    return [[{
      ticket_id: "legacy-ticket",
      tenant_id: "tenant-a",
      title: "Legacy simulation",
      status: "open",
      lifecycle_state: "triage_pending",
      customer_status: "received",
      priority: "normal",
      assigned_to: null,
      sla_status: "on_track",
      first_response_due_at: "2026-08-02T08:00:00Z",
      triage_due_at: "2026-08-02T09:00:00Z",
      resolution_due_at: "2026-08-03T00:00:00Z",
      stored_first_response_at: null,
      stored_triaged_at: null,
      first_response_at: "2026-08-01T08:00:00Z",
      triaged_at: "2026-08-01T09:00:00Z",
      last_seen_at: "2026-08-01T07:00:00Z",
      updated_at: "2026-08-01T07:00:00Z",
      created_at: "2026-08-01T06:00:00Z",
      reconciliation_activity_at: "2026-08-01T10:00:00Z",
      metadata_json: { admin_simulation: true, environment: "qa" },
    }]];
  },
  release() {},
};
const reconciliation = await reconcileSupportTicketIntegrity(
  { tenant_id: "tenant-a", limit: 10, apply: false },
  { pool: { async getConnection() { return reconcileConnection; } } },
);
assert.equal(reconciliation.schema.ready, false);
assert.equal(reconciliation.findings[0].integrity.is_test, true);
assert.equal(reconciliation.findings[0].milestone_evidence.first_response_backfill_required, true);
assert.equal(reconciliation.findings[0].milestone_evidence.triage_backfill_required, true);
const reconcileSql = reconcileQueries[1].sql;
assert.match(reconcileSql, /NULL AS stored_first_response_at/);
assert.match(reconcileSql, /ticket_lifecycle_events/);
assert.match(reconcileSql, /reconciliation_activity_at/);
assert.doesNotMatch(reconcileSql, /t\.first_response_at/);
assert.doesNotMatch(reconcileSql, /t\.triaged_at/);

await assert.rejects(
  reconcileSupportTicketIntegrity(
    { cursor_activity_at: "2026-08-01T10:00:00Z" },
    { pool: { async getConnection() { return reconcileConnection; } } },
  ),
  (error) => error?.code === "support_ticket_integrity_cursor_incomplete",
);

console.log("support ticket pre-migration projection, legacy test evidence, milestone fallback, and lifecycle-event activity contracts passed");
