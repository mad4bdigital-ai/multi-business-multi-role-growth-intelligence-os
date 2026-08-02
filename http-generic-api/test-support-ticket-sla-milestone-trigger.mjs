import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { splitMigrationSqlStatements } from "./migrationSqlStatements.js";
import {
  createOrAppendSupportTicketWithIntegrityAtomic,
  _testingSupportTicketLifecycleIntegrityCreation,
} from "./supportTicketLifecycleIntegrityCreationService.js";
import {
  normalizeReconciliationFindingForEffectiveLifecycle,
  reconcileSupportTicketIntegrityWithEffectiveLifecycle,
} from "./supportTicketLifecycleIntegrityReconciliationService.js";

const migration = await readFile(
  new URL("./migrations/1042_sprint69_support_ticket_lifecycle_sla_dedupe.sql", import.meta.url),
  "utf8",
);
assert.match(migration, /CREATE TABLE IF NOT EXISTS support_ticket_dedupe_claims/);
assert.match(migration, /PRIMARY KEY \(tenant_id, dedupe_key\)/);
assert.match(migration, /CREATE OR REPLACE TRIGGER trg_ticket_lifecycle_sla_milestones/);
assert.match(migration, /AFTER INSERT ON ticket_lifecycle_events/);
assert.match(migration, /NEW\.visibility = 'customer'/);
assert.match(migration, /COALESCE\(first_response_at, NEW\.created_at\)/);
assert.match(migration, /COALESCE\(triaged_at, NEW\.created_at\)/);
assert.match(migration, /dedupe_claim_table_count/);
assert.match(migration, /ticket_lifecycle_events activity_event/);
assert.doesNotMatch(migration, /DELIMITER/i);
assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|INDEX|TRIGGER)/i);
assert.doesNotMatch(migration, /DELETE\s+FROM/i);

const statements = splitMigrationSqlStatements(migration);
assert.equal(statements.filter((statement) => /^CREATE TABLE IF NOT EXISTS support_ticket_dedupe_claims/i.test(statement)).length, 1);
assert.equal(statements.filter((statement) => /CREATE OR REPLACE TRIGGER trg_ticket_lifecycle_sla_milestones/i.test(statement)).length, 1);
const slaStatements = statements.filter((statement) => /^UPDATE tickets t\s+JOIN/i.test(statement) && /computed_sla_status/i.test(statement));
assert.equal(slaStatements.length, 1);
assert.match(slaStatements[0], /COALESCE\(t\.sla_status, ''\) <> computed\.computed_sla_status/);
assert.doesNotMatch(slaStatements[0], /updated_at\s*=/i);

const { REQUIRED_INTEGRITY_COLUMNS, REQUIRED_INTEGRITY_TABLES } = _testingSupportTicketLifecycleIntegrityCreation();
const shared = { locked: false, waiters: [], ticket: null, index: 0 };
async function acquireClaim() {
  if (!shared.locked) {
    shared.locked = true;
    return;
  }
  await new Promise((resolve) => shared.waiters.push(resolve));
  shared.locked = true;
}
function releaseClaim() {
  shared.locked = false;
  shared.waiters.shift()?.();
}
function connection(name) {
  const events = [];
  return {
    name,
    events,
    async query(sql, params = []) {
      if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) return [REQUIRED_INTEGRITY_COLUMNS.map((COLUMN_NAME) => ({ COLUMN_NAME }))];
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [REQUIRED_INTEGRITY_TABLES.map((TABLE_NAME) => ({ TABLE_NAME }))];
      if (sql.includes("INSERT INTO support_ticket_dedupe_claims")) {
        events.push("claim_insert");
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("FROM support_ticket_dedupe_claims") && sql.includes("FOR UPDATE")) {
        events.push("claim_wait");
        await acquireClaim();
        events.push("claim_acquired");
        return [[{ tenant_id: params[0], dedupe_key: params[1] }]];
      }
      if (sql.includes("UPDATE tickets")) {
        events.push("persist");
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async beginTransaction() { events.push("begin"); },
    async commit() { events.push("commit"); releaseClaim(); },
    async rollback() { events.push("rollback"); releaseClaim(); },
    release() { events.push("release"); },
  };
}
const connections = [connection("one"), connection("two")];
const pool = { async getConnection() { return connections[shared.index++]; } };
const envelope = {
  tenant_id: "tenant-concurrent",
  user_id: "user-concurrent",
  ticket_type: "managed_service_request",
  target_capability: "wordpress_tenant_safe_self_repair",
  resource: { type: "site", ref: "site://concurrent", relationship: "subject" },
};
async function createTicket() {
  if (!shared.ticket) {
    shared.ticket = { ticket_id: "ticket-concurrent" };
    return { ok: true, created: true, deduped: false, ticket: shared.ticket };
  }
  return { ok: true, created: false, deduped: true, ticket: shared.ticket };
}
const results = await Promise.all([
  createOrAppendSupportTicketWithIntegrityAtomic(envelope, { pool, createOrAppendSupportTicketFn: createTicket }),
  createOrAppendSupportTicketWithIntegrityAtomic(envelope, { pool, createOrAppendSupportTicketFn: createTicket }),
]);
assert.equal(results.filter((result) => result.created).length, 1);
assert.equal(results.filter((result) => result.deduped).length, 1);
assert.ok(results.every((result) => result.integrity.dedupe_serialized));
assert.ok(connections.every((item) => item.events.includes("claim_acquired")));
assert.ok(connections.every((item) => item.events.at(-1) === "release"));

const normalized = normalizeReconciliationFindingForEffectiveLifecycle({
  ticket_id: "resolved-ticket",
  tenant_id: "tenant-a",
  lifecycle: {
    should_update: true,
    status: "resolved",
    lifecycle_state: "resolved_runtime_validated",
    customer_status: "resolved_runtime_validated",
    reason: "internally_resolved_ticket_still_open",
  },
  sla: {
    current_status: "on_track",
    computed_status: "breached",
    reason: "resolution_past_due",
    should_update: true,
    breached_milestones: ["resolution"],
    warning_milestones: [],
  },
  should_update: true,
});
assert.equal(normalized.sla.computed_status, "on_track");
assert.equal(normalized.sla.reason, "ticket_not_open");
assert.deepEqual(normalized.sla.breached_milestones, []);

const applyEvents = [];
let updateParams = null;
const applyConnection = {
  async query(sql, params = []) {
    if (sql.includes("FROM tickets t") && sql.includes("FOR UPDATE")) {
      applyEvents.push("lock");
      return [[{
        title: "Locked current ticket",
        priority: "urgent",
        assigned_to: null,
        status: "open",
        lifecycle_state: "resolved_runtime_validated",
        customer_status: "resolved_runtime_validated",
        sla_status: "on_track",
        first_response_due_at: "2026-08-01T08:00:00Z",
        first_response_at: "2026-08-01T07:00:00Z",
        effective_first_response_at: "2026-08-01T07:00:00Z",
        triage_due_at: "2026-08-01T09:00:00Z",
        triaged_at: "2026-08-01T08:00:00Z",
        effective_triaged_at: "2026-08-01T08:00:00Z",
        resolution_due_at: "2026-08-01T10:00:00Z",
        last_seen_at: "2026-08-01T09:00:00Z",
        updated_at: "2026-08-01T09:00:00Z",
        created_at: "2026-08-01T06:00:00Z",
        metadata_json: JSON.stringify({
          ticket_integrity_contract: "support-ticket-integrity-v2",
          is_test: false,
          environment: "production",
          visibility_class: "customer_visible",
          target_capability: "locked-capability",
          intended_parent_ticket_id: "locked-parent",
          related_ticket_id: "locked-related",
          supersedes_ticket_id: "locked-supersedes",
        }),
        is_test: 0,
        environment: "production",
        visibility_class: "customer_visible",
        target_capability: "locked-capability",
        parent_ticket_id: "locked-parent",
        related_ticket_id: "locked-related",
        supersedes_ticket_id: "locked-supersedes",
      }]];
    }
    if (sql.includes("UPDATE tickets")) {
      applyEvents.push("update");
      updateParams = params;
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("INSERT INTO ticket_lifecycle_events")) {
      applyEvents.push("event");
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected apply SQL: ${sql}`);
  },
  async beginTransaction() { applyEvents.push("begin"); },
  async commit() { applyEvents.push("commit"); },
  async rollback() { applyEvents.push("rollback"); },
  release() { applyEvents.push("release"); },
};
const plannedFinding = {
  ...normalized,
  integrity: {
    is_test: true,
    environment: "qa",
    visibility_class: "internal_test",
    target_capability: "stale-capability",
    parent_ticket_id: "stale-parent",
    related_ticket_id: "stale-related",
    supersedes_ticket_id: "stale-supersedes",
  },
  milestone_evidence: { first_response_at: null, triaged_at: null },
};
const applied = await reconcileSupportTicketIntegrityWithEffectiveLifecycle(
  { apply: true, actor_id: "admin-a", actor_type: "admin" },
  {
    pool: { async getConnection() { return applyConnection; } },
    async planReconciliationFn() {
      return {
        ok: true,
        schema: { ready: true, missing_columns: [] },
        findings: [plannedFinding],
        count: 1,
        update_count: 1,
        secrets_included: false,
      };
    },
  },
);
assert.equal(applied.findings[0].lifecycle.status, "resolved");
assert.equal(applied.findings[0].sla.computed_status, "on_track");
assert.equal(applied.findings[0].integrity.is_test, false);
assert.equal(applied.findings[0].integrity.target_capability, "locked-capability");
assert.equal(applied.findings[0].urgent_unassigned, true);
assert.equal(updateParams[0], "resolved");
assert.equal(updateParams[3], "on_track");
assert.equal(updateParams[6], 0);
assert.equal(updateParams[7], "production");
assert.equal(updateParams[8], "customer_visible");
assert.equal(updateParams[9], "locked-capability");
assert.equal(updateParams[10], "locked-parent");
assert.equal(updateParams[11], "locked-related");
assert.equal(updateParams[12], "locked-supersedes");
assert.deepEqual(applyEvents, ["begin", "lock", "update", "event", "commit", "release"]);

console.log("support ticket milestone trigger, governed splitter, concurrent dedupe, locked-state reconciliation, effective lifecycle SLA, and activity preservation contracts passed");
