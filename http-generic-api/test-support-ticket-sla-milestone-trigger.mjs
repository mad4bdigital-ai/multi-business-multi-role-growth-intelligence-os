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

const addColumnsIndex = migration.indexOf("ADD COLUMN IF NOT EXISTS first_response_at");
const dedupeClaimIndex = migration.indexOf("CREATE TABLE IF NOT EXISTS support_ticket_dedupe_claims");
const evidenceBackfillIndex = migration.indexOf("derived_first_response_at");
const triggerIndex = migration.indexOf("CREATE OR REPLACE TRIGGER trg_ticket_lifecycle_sla_milestones");
const slaReconciliationIndex = migration.indexOf("-- Milestone-aware SLA reconciliation");

assert.ok(addColumnsIndex >= 0, "migration must add milestone columns");
assert.ok(dedupeClaimIndex > addColumnsIndex, "dedupe claim table must follow ticket integrity columns");
assert.ok(evidenceBackfillIndex > dedupeClaimIndex, "event evidence backfill must run after dedupe claim schema");
assert.ok(triggerIndex > evidenceBackfillIndex, "trigger must be created after legacy evidence backfill");
assert.ok(slaReconciliationIndex > triggerIndex, "SLA reconciliation must run after milestone evidence is durable");

assert.match(migration, /CREATE TABLE IF NOT EXISTS support_ticket_dedupe_claims/);
assert.match(migration, /PRIMARY KEY \(tenant_id, dedupe_key\)/);
assert.match(migration, /FROM ticket_lifecycle_events e/);
assert.match(migration, /CREATE OR REPLACE TRIGGER trg_ticket_lifecycle_sla_milestones/);
assert.match(migration, /AFTER INSERT ON ticket_lifecycle_events/);
assert.match(migration, /NEW\.visibility = 'customer'/);
assert.match(migration, /NEW\.event_type NOT IN \('ticket_created', 'dedupe_matched', 'queue_assigned'\)/);
assert.match(migration, /NEW\.event_type IN \('triaged', 'ticket_triaged', 'assignee_changed', 'diagnostic_started'\)/);
assert.match(migration, /NEW\.event_type = 'state_transition'/);
assert.match(migration, /LOWER\(COALESCE\(NEW\.actor_type, 'system'\)\) NOT IN \('tenant_user', 'customer', 'user'\)/);
assert.match(migration, /COALESCE\(first_response_at, NEW\.created_at\)/);
assert.match(migration, /COALESCE\(triaged_at, NEW\.created_at\)/);
assert.match(migration, /milestone_trigger_count/);
assert.match(migration, /dedupe_claim_table_count/);

assert.doesNotMatch(migration, /DELIMITER/i, "single-statement trigger must not rely on client delimiter commands");
assert.doesNotMatch(migration, /CREATE OR REPLACE TRIGGER[\s\S]*?BEGIN/i, "trigger must remain a single SQL statement for the migration runner");
assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|INDEX|TRIGGER)/i);
assert.doesNotMatch(migration, /DELETE\s+FROM/i);

const statements = splitMigrationSqlStatements(migration);
const triggerStatements = statements.filter((statement) => /CREATE OR REPLACE TRIGGER trg_ticket_lifecycle_sla_milestones/i.test(statement));
assert.equal(triggerStatements.length, 1, "governed splitter must expose one standalone trigger statement");
assert.match(triggerStatements[0], /^CREATE OR REPLACE TRIGGER/i);
assert.doesNotMatch(triggerStatements[0], /UPDATE tickets t\s+JOIN/i, "trigger must not be merged into the evidence-backfill statement");
assert.ok(
  statements.some((statement) => /^UPDATE tickets t\s+JOIN/i.test(statement) && /derived_first_response_at/i.test(statement)),
  "governed splitter must expose the lifecycle-evidence backfill independently",
);
const claimTableStatements = statements.filter((statement) => /^CREATE TABLE IF NOT EXISTS support_ticket_dedupe_claims/i.test(statement));
assert.equal(claimTableStatements.length, 1, "governed splitter must expose the dedupe claim table independently");
const slaStatements = statements.filter((statement) => /^UPDATE tickets t\s+JOIN/i.test(statement) && /computed_sla_status/i.test(statement));
assert.equal(slaStatements.length, 1, "governed splitter must expose one bounded SLA backfill statement");
assert.match(slaStatements[0], /COALESCE\(t\.sla_status, ''\) <> computed\.computed_sla_status/);
assert.doesNotMatch(slaStatements[0], /updated_at\s*=/i, "SLA migration must preserve ticket activity timestamps");

const { REQUIRED_INTEGRITY_COLUMNS, REQUIRED_INTEGRITY_TABLES } = _testingSupportTicketLifecycleIntegrityCreation();
const shared = {
  locked: false,
  waiters: [],
  ticket: null,
  connectionCounter: 0,
};

async function acquireSharedClaim() {
  if (!shared.locked) {
    shared.locked = true;
    return;
  }
  await new Promise((resolve) => shared.waiters.push(resolve));
  shared.locked = true;
}

function releaseSharedClaim() {
  shared.locked = false;
  const next = shared.waiters.shift();
  if (next) next();
}

function buildConcurrentConnection(name) {
  const events = [];
  return {
    name,
    events,
    async query(sql, params = []) {
      if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) {
        events.push("schema_columns");
        return [REQUIRED_INTEGRITY_COLUMNS.map((COLUMN_NAME) => ({ COLUMN_NAME }))];
      }
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) {
        events.push("schema_tables");
        return [REQUIRED_INTEGRITY_TABLES.map((TABLE_NAME) => ({ TABLE_NAME }))];
      }
      if (sql.includes("INSERT INTO support_ticket_dedupe_claims")) {
        events.push("claim_insert");
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("FROM support_ticket_dedupe_claims") && sql.includes("FOR UPDATE")) {
        events.push("claim_wait");
        await acquireSharedClaim();
        events.push("claim_acquired");
        return [[{ tenant_id: params[0], dedupe_key: params[1] }]];
      }
      if (sql.includes("UPDATE tickets")) {
        events.push("persist");
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected concurrent creation SQL: ${sql}`);
    },
    async beginTransaction() { events.push("begin"); },
    async commit() {
      events.push("commit");
      releaseSharedClaim();
    },
    async rollback() {
      events.push("rollback");
      releaseSharedClaim();
    },
    release() { events.push("release"); },
  };
}

const concurrentConnections = [buildConcurrentConnection("one"), buildConcurrentConnection("two")];
const concurrentPool = {
  async getConnection() {
    const connection = concurrentConnections[shared.connectionCounter];
    shared.connectionCounter += 1;
    return connection;
  },
};
const concurrentEnvelope = {
  tenant_id: "tenant-concurrent",
  user_id: "user-concurrent",
  ticket_type: "managed_service_request",
  target_capability: "wordpress_tenant_safe_self_repair",
  resource: { type: "site", ref: "site://concurrent", relationship: "subject" },
  title: "Concurrent canonical dedupe creation",
};
async function concurrentCreate(envelope) {
  if (!shared.ticket) {
    shared.ticket = { ticket_id: "ticket-concurrent" };
    return { ok: true, created: true, deduped: false, ticket: shared.ticket, envelope };
  }
  return { ok: true, created: false, deduped: true, ticket: shared.ticket, envelope };
}
const concurrentResults = await Promise.all([
  createOrAppendSupportTicketWithIntegrityAtomic(concurrentEnvelope, {
    pool: concurrentPool,
    createOrAppendSupportTicketFn: concurrentCreate,
  }),
  createOrAppendSupportTicketWithIntegrityAtomic(concurrentEnvelope, {
    pool: concurrentPool,
    createOrAppendSupportTicketFn: concurrentCreate,
  }),
]);
assert.equal(concurrentResults.filter((result) => result.created).length, 1);
assert.equal(concurrentResults.filter((result) => result.deduped).length, 1);
assert.ok(concurrentResults.every((result) => result.integrity.dedupe_serialized === true));
assert.ok(concurrentConnections.every((connection) => connection.events.includes("claim_acquired")));
assert.ok(concurrentConnections.every((connection) => connection.events.includes("commit")));
assert.ok(concurrentConnections.every((connection) => connection.events.at(-1) === "release"));
assert.ok(
  concurrentConnections[1].events.indexOf("claim_acquired") > concurrentConnections[1].events.indexOf("claim_wait"),
  "second transaction must acquire the same claim before create-or-append",
);

const normalizedResolvedFinding = normalizeReconciliationFindingForEffectiveLifecycle({
  ticket_id: "ticket-resolved",
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
assert.equal(normalizedResolvedFinding.sla.computed_status, "on_track");
assert.equal(normalizedResolvedFinding.sla.reason, "ticket_not_open");
assert.deepEqual(normalizedResolvedFinding.sla.breached_milestones, []);

const applyEvents = [];
let appliedUpdateParams = null;
const applyConnection = {
  async query(sql, params = []) {
    if (sql.includes("SELECT status") && sql.includes("FOR UPDATE")) {
      applyEvents.push("lock_ticket");
      return [[{
        status: "open",
        lifecycle_state: "resolved_runtime_validated",
        customer_status: "resolved_runtime_validated",
        sla_status: "on_track",
        first_response_due_at: "2026-08-01T08:00:00Z",
        first_response_at: "2026-08-01T07:00:00Z",
        triage_due_at: "2026-08-01T09:00:00Z",
        triaged_at: "2026-08-01T08:00:00Z",
        resolution_due_at: "2026-08-01T10:00:00Z",
        last_seen_at: "2026-08-01T09:00:00Z",
        updated_at: "2026-08-01T09:00:00Z",
        created_at: "2026-08-01T06:00:00Z",
      }]];
    }
    if (sql.includes("UPDATE tickets")) {
      applyEvents.push("update_ticket");
      appliedUpdateParams = params;
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("INSERT INTO ticket_lifecycle_events")) {
      applyEvents.push("insert_event");
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected effective reconciliation SQL: ${sql}`);
  },
  async beginTransaction() { applyEvents.push("begin"); },
  async commit() { applyEvents.push("commit"); },
  async rollback() { applyEvents.push("rollback"); },
  release() { applyEvents.push("release"); },
};
const plannedFinding = {
  ticket_id: "ticket-resolved",
  tenant_id: "tenant-a",
  lifecycle: normalizedResolvedFinding.lifecycle,
  sla: {
    current_status: "on_track",
    computed_status: "breached",
    reason: "resolution_past_due",
    should_update: true,
    breached_milestones: ["resolution"],
    warning_milestones: [],
  },
  integrity: {
    is_test: false,
    environment: "production",
    visibility_class: "customer_visible",
    target_capability: null,
    parent_ticket_id: null,
    related_ticket_id: null,
    supersedes_ticket_id: null,
  },
  milestone_evidence: { first_response_at: null, triaged_at: null },
  backfill_last_seen_at: false,
  urgent_unassigned: false,
  should_update: true,
  secrets_included: false,
};
const applied = await reconcileSupportTicketIntegrityWithEffectiveLifecycle(
  { apply: true, actor_id: "admin-a", actor_type: "admin" },
  {
    pool: { async getConnection() { return applyConnection; } },
    async planReconciliationFn() {
      return {
        ok: true,
        mode: "dry_run",
        count: 1,
        update_count: 1,
        urgent_unassigned_count: 0,
        test_ticket_count: 0,
        has_more: false,
        next_cursor: null,
        schema: { ready: true, missing_columns: [], missing_tables: [] },
        findings: [plannedFinding],
        secrets_included: false,
      };
    },
  },
);
assert.equal(applied.findings[0].lifecycle.status, "resolved");
assert.equal(applied.findings[0].sla.computed_status, "on_track");
assert.equal(applied.findings[0].sla.reason, "ticket_not_open");
assert.equal(appliedUpdateParams[0], "resolved");
assert.equal(appliedUpdateParams[3], "on_track");
assert.deepEqual(applyEvents, ["begin", "lock_ticket", "update_ticket", "insert_event", "commit", "release"]);

console.log("support ticket SLA milestones, dedupe serialization, effective lifecycle apply, activity preservation, and governed splitter contract passed");
