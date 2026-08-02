import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createOrAppendSupportTicketWithIntegrityAtomic,
  _testingSupportTicketLifecycleIntegrityCreation,
} from "./supportTicketLifecycleIntegrityCreationService.js";
import {
  computeSupportTicketDedupeKeyV2,
  computeSupportTicketSlaStatusV2,
  deriveSupportTicketIntegrity,
  listSupportTicketsWithIntegrity,
  resolveSupportTicketLifecyclePatch,
} from "./supportTicketLifecycleIntegrityService.js";

const baseEnvelope = {
  tenant_id: "tenant-a",
  user_id: "user-a",
  ticket_type: "managed_service_request",
  target_capability: "wordpress_tenant_safe_self_repair",
  resource: { type: "site", ref: "site://wovacation", relationship: "subject" },
};

const parentA = computeSupportTicketDedupeKeyV2({ ...baseEnvelope, intended_parent_ticket_id: "parent-a" });
const parentB = computeSupportTicketDedupeKeyV2({ ...baseEnvelope, intended_parent_ticket_id: "parent-b" });
assert.notEqual(parentA, parentB);
assert.match(parentA, /^ticket:v2:[a-f0-9]{64}$/);
assert.notEqual(
  computeSupportTicketDedupeKeyV2({ ...baseEnvelope, is_test: false, environment: "production" }),
  computeSupportTicketDedupeKeyV2({ ...baseEnvelope, is_test: true, environment: "production" }),
);
assert.notEqual(
  computeSupportTicketDedupeKeyV2({ ...baseEnvelope, environment: "production", visibility_class: "customer_visible" }),
  computeSupportTicketDedupeKeyV2({ ...baseEnvelope, environment: "sandbox", visibility_class: "partner_visible" }),
);

assert.equal(deriveSupportTicketIntegrity({ title: "Production test failure" }).is_test, false);
assert.equal(deriveSupportTicketIntegrity({
  title: "QA outage",
  environment: "staging",
  is_test: false,
  metadata_json: { admin_simulation: true },
}).is_test, false);
assert.equal(deriveSupportTicketIntegrity({ metadata_json: { admin_simulation: true } }).is_test, true);
assert.equal(deriveSupportTicketIntegrity({ environment: "qa" }).visibility_class, "internal_test");

const now = new Date("2026-08-01T12:00:00Z");
assert.equal(computeSupportTicketSlaStatusV2({
  status: "open",
  first_response_due_at: "2026-08-01T08:00:00Z",
  first_response_at: "2026-08-01T07:55:00Z",
  triage_due_at: "2026-08-01T09:00:00Z",
  triaged_at: "2026-08-01T08:30:00Z",
  resolution_due_at: "2026-08-03T00:00:00Z",
}, now).status, "on_track");
assert.equal(computeSupportTicketSlaStatusV2({
  status: "resolved",
  sla_status: "on_track",
  resolution_due_at: "2026-08-01T10:00:00Z",
}, now).reason, "ticket_not_open");
assert.equal(resolveSupportTicketLifecyclePatch({
  status: "open",
  lifecycle_state: "resolved_runtime_validated",
  customer_status: "resolved_runtime_validated",
}).status, "resolved");

const { REQUIRED_INTEGRITY_COLUMNS, REQUIRED_INTEGRITY_TABLES } = _testingSupportTicketLifecycleIntegrityCreation();
function buildConnection({ columns = REQUIRED_INTEGRITY_COLUMNS, tables = REQUIRED_INTEGRITY_TABLES, persistError = null } = {}) {
  const events = [];
  return {
    events,
    async query(sql, params = []) {
      if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) {
        events.push("schema_columns");
        return [columns.map((COLUMN_NAME) => ({ COLUMN_NAME }))];
      }
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) {
        events.push("schema_tables");
        return [tables.map((TABLE_NAME) => ({ TABLE_NAME }))];
      }
      if (sql.includes("INSERT INTO support_ticket_dedupe_claims")) {
        events.push("claim_insert");
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("FROM support_ticket_dedupe_claims") && sql.includes("FOR UPDATE")) {
        events.push("claim_lock");
        return [[{ tenant_id: params[0], dedupe_key: params[1] }]];
      }
      if (sql.includes("UPDATE tickets")) {
        events.push("persist");
        if (persistError) throw persistError;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async beginTransaction() { events.push("begin"); },
    async commit() { events.push("commit"); },
    async rollback() { events.push("rollback"); },
    release() { events.push("release"); },
  };
}

const successConnection = buildConnection();
const created = await createOrAppendSupportTicketWithIntegrityAtomic(
  { ...baseEnvelope, title: "Atomic creation", environment: "sandbox", visibility_class: "partner_visible" },
  {
    pool: { async getConnection() { return successConnection; } },
    async createOrAppendSupportTicketFn(envelope, options) {
      successConnection.events.push("create");
      assert.equal(options.connection, successConnection);
      assert.match(envelope.dedupe_key, /^ticket:v2:/);
      return { ok: true, created: true, deduped: false, ticket: { ticket_id: "ticket-a" } };
    },
  },
);
assert.equal(created.integrity.dedupe_serialized, true);
assert.equal(created.integrity.environment, "sandbox");
assert.deepEqual(successConnection.events, [
  "schema_columns", "schema_tables", "begin", "claim_insert", "claim_lock", "create", "persist", "commit", "release",
]);

const missingTableConnection = buildConnection({ tables: [] });
await assert.rejects(
  createOrAppendSupportTicketWithIntegrityAtomic(
    { ...baseEnvelope, title: "Missing claim table" },
    { pool: { async getConnection() { return missingTableConnection; } } },
  ),
  (error) => error?.code === "support_ticket_integrity_schema_not_ready"
    && error?.schema?.missing_tables?.includes("support_ticket_dedupe_claims"),
);
assert.deepEqual(missingTableConnection.events, ["schema_columns", "schema_tables", "release"]);

const rollbackConnection = buildConnection({ persistError: new Error("persist failed") });
await assert.rejects(
  createOrAppendSupportTicketWithIntegrityAtomic(
    { ...baseEnvelope, title: "Rollback" },
    {
      pool: { async getConnection() { return rollbackConnection; } },
      async createOrAppendSupportTicketFn() {
        rollbackConnection.events.push("create");
        return { ok: true, created: true, ticket: { ticket_id: "ticket-b" } };
      },
    },
  ),
  /persist failed/,
);
assert.deepEqual(rollbackConnection.events, [
  "schema_columns", "schema_tables", "begin", "claim_insert", "claim_lock", "create", "persist", "rollback", "release",
]);

const listQueries = [];
const listConnection = {
  async query(sql) {
    listQueries.push(sql);
    if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) {
      return [REQUIRED_INTEGRITY_COLUMNS.map((COLUMN_NAME) => ({ COLUMN_NAME }))];
    }
    return [[{
      ticket_id: "safe-ticket",
      tenant_id: "tenant-a",
      title: "Visible",
      category: "support",
      status: "open",
      occurrence_count: 1,
      metadata_json: {},
      is_test: 0,
      environment: "production",
      visibility_class: "customer_visible",
      internal_summary: "hidden",
      actor_id: "hidden",
      source_tool: "hidden",
    }]];
  },
  release() {},
};
const listed = await listSupportTicketsWithIntegrity(
  { tenant_id: "tenant-a", user_id: "user-a", include_test: false, limit: 10 },
  { pool: { async getConnection() { return listConnection; } } },
);
assert.doesNotMatch(listQueries[1], /SELECT\s+\*/i);
assert.match(listQueries[1], /\(t\.user_id = \? OR t\.user_id IS NULL\)/);
assert.match(listQueries[1], /ticket_lifecycle_events/);
assert.equal("internal_summary" in listed.tickets[0], false);
assert.equal("actor_id" in listed.tickets[0], false);
assert.equal("source_tool" in listed.tickets[0], false);

const routeSource = await readFile(new URL("./routes/supportTicketLifecycleIntegrityRoutes.js", import.meta.url), "utf8");
assert.match(routeSource, /createUserJwtMiddleware/);
assert.match(routeSource, /reconcileSupportTicketIntegrityWithEffectiveLifecycle/);
assert.match(routeSource, /ORDER BY m\.granted_at ASC, m\.id ASC\s+LIMIT 2/);
assert.match(routeSource, /tenant_context_required/);
assert.match(routeSource, /tenant_membership_ambiguous/);
assert.doesNotMatch(routeSource, /rows\s*\[\s*0\s*\]/);
assert.doesNotMatch(routeSource, /from\s+["']jsonwebtoken["']/);

console.log("support ticket lifecycle, customer-safe projection, structured dedupe, schema preflight, atomic rollback, and centralized auth contracts passed");
