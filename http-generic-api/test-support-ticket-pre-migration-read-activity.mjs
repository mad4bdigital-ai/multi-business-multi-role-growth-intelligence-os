import assert from "node:assert/strict";

import {
  deriveSupportTicketIntegrity,
  listSupportTicketsWithIntegrity,
  reconcileSupportTicketIntegrity,
} from "./supportTicketLifecycleIntegrityService.js";

const legacySimulation = deriveSupportTicketIntegrity({
  ticket_id: "legacy-simulation",
  is_test: 0,
  environment: "production",
  visibility_class: "customer_visible",
  metadata_json: {
    admin_simulation: true,
    runtime_environment: "production",
  },
}, { stored_row: true });
assert.equal(legacySimulation.is_test, true, "legacy simulation metadata must override migration defaults");
assert.equal(legacySimulation.visibility_class, "internal_test");

const legacyStaging = deriveSupportTicketIntegrity({
  ticket_id: "legacy-staging",
  is_test: 0,
  environment: "production",
  visibility_class: "customer_visible",
  metadata_json: { runtime_environment: "staging" },
}, { stored_row: true });
assert.equal(legacyStaging.is_test, true, "legacy test environments must override migration defaults");
assert.equal(legacyStaging.environment, "staging");

const legacyExplicitFalse = deriveSupportTicketIntegrity({
  ticket_id: "legacy-explicit-production",
  is_test: 0,
  environment: "production",
  visibility_class: "customer_visible",
  metadata_json: { is_test: false, admin_simulation: true },
}, { stored_row: true });
assert.equal(legacyExplicitFalse.is_test, false, "legacy explicit false must still win over simulation inference");
assert.equal(legacyExplicitFalse.visibility_class, "customer_visible");

const v2Stored = deriveSupportTicketIntegrity({
  ticket_id: "v2-production",
  is_test: 0,
  environment: "production",
  visibility_class: "partner_visible",
  metadata_json: {
    ticket_integrity_contract: "support-ticket-integrity-v2",
    is_test: false,
    admin_simulation: true,
  },
}, { stored_row: true });
assert.equal(v2Stored.is_test, false, "v2 persisted fields remain authoritative");
assert.equal(v2Stored.visibility_class, "partner_visible");

function buildPreMigrationConnection({ rows = [] } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) return [[]];
      return [rows];
    },
    release() {},
  };
}

const activityAt = new Date("2026-08-01T12:00:00Z");
const listConnection = buildPreMigrationConnection({
  rows: [{
    ticket_id: "legacy-visible-ticket",
    tenant_id: "tenant-a",
    title: "Legacy visible ticket",
    category: "support",
    ticket_type: "general_support",
    priority: "normal",
    severity: "sev4",
    status: "open",
    lifecycle_state: "triage_pending",
    customer_status: "received",
    queue_key: "tenant_support",
    assignment_status: "queue_assigned",
    assigned_to: null,
    service_mode: "managed",
    dedupe_key: "legacy-key",
    occurrence_count: 1,
    customer_message: "Received.",
    created_at: activityAt,
    updated_at: activityAt,
    last_seen_at: activityAt,
    first_response_due_at: null,
    triage_due_at: null,
    resolution_due_at: null,
    sla_status: "on_track",
    metadata_json: JSON.stringify({ customer_safe: true }),
    is_test: 0,
    environment: "production",
    visibility_class: "customer_visible",
    target_capability: null,
    related_ticket_id: null,
    parent_ticket_id: null,
    supersedes_ticket_id: null,
    first_response_at: null,
    triaged_at: null,
    latest_activity_at: activityAt,
  }],
});
const listed = await listSupportTicketsWithIntegrity(
  { tenant_id: "tenant-a", user_id: "user-a", include_test: false, limit: 10 },
  { pool: { async getConnection() { return listConnection; } } },
);
assert.equal(listed.schema_ready, false);
assert.equal(listed.tickets.length, 1);
const preMigrationListSql = listConnection.queries[1].sql;
for (const forbiddenReference of [
  /t\.is_test\b/,
  /t\.environment\b/,
  /t\.visibility_class\b/,
  /t\.target_capability\b/,
  /t\.related_ticket_id\b/,
  /t\.parent_ticket_id\b/,
  /t\.supersedes_ticket_id\b/,
  /t\.first_response_at\b/,
  /t\.triaged_at\b/,
]) {
  assert.doesNotMatch(preMigrationListSql, forbiddenReference, `pre-migration list must avoid ${forbiddenReference}`);
}
assert.match(preMigrationListSql, /0 AS is_test/);
assert.match(preMigrationListSql, /NOT \(/);
assert.match(preMigrationListSql, /\$\.admin_simulation/);
assert.match(preMigrationListSql, /MAX\(activity_event\.created_at\)/);
assert.match(preMigrationListSql, /ORDER BY latest_activity_at DESC, t\.ticket_id DESC/);

const reconcileConnection = buildPreMigrationConnection({ rows: [] });
const reconciliation = await reconcileSupportTicketIntegrity(
  { tenant_id: "tenant-a", limit: 10, apply: false },
  { pool: { async getConnection() { return reconcileConnection; } } },
);
assert.equal(reconciliation.schema.ready, false);
assert.equal(reconciliation.count, 0);
const preMigrationReconcileSql = reconcileConnection.queries[1].sql;
assert.doesNotMatch(preMigrationReconcileSql, /t\.first_response_at\b/);
assert.doesNotMatch(preMigrationReconcileSql, /t\.triaged_at\b/);
assert.match(preMigrationReconcileSql, /NULL AS stored_first_response_at/);
assert.match(preMigrationReconcileSql, /NULL AS stored_triaged_at/);
assert.match(preMigrationReconcileSql, /MAX\(activity_event\.created_at\)/);

console.log("support ticket pre-migration read safety, legacy evidence, and lifecycle activity ordering passed");
