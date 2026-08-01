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
  reconcileSupportTicketIntegrity,
  resolveSupportTicketLifecyclePatch,
} from "./supportTicketLifecycleIntegrityService.js";

const baseEnvelope = {
  tenant_id: "tenant-a",
  user_id: "user-a",
  ticket_type: "managed_service_request",
  target_capability: "wordpress_tenant_safe_self_repair",
  resource: { type: "site", ref: "site://wovacation", relationship: "subject" },
};

const parentA = computeSupportTicketDedupeKeyV2({
  ...baseEnvelope,
  intended_parent_ticket_id: "b48a7b04-fa30-4e7d-ac5b-7a97515e7dd4",
});
const parentB = computeSupportTicketDedupeKeyV2({
  ...baseEnvelope,
  intended_parent_ticket_id: "bae08982-cec1-4527-8be2-68d501706345",
});
assert.notEqual(parentA, parentB, "intended parent ticket must participate in dedupe identity");
assert.equal(parentA, computeSupportTicketDedupeKeyV2({
  ...baseEnvelope,
  intended_parent_ticket_id: "b48a7b04-fa30-4e7d-ac5b-7a97515e7dd4",
}), "canonical dedupe key must be stable");
assert.match(parentA, /^ticket:v2:[a-f0-9]{64}$/);

const capabilityA = computeSupportTicketDedupeKeyV2({ ...baseEnvelope, target_capability: "capability-a" });
const capabilityB = computeSupportTicketDedupeKeyV2({ ...baseEnvelope, target_capability: "capability-b" });
assert.notEqual(capabilityA, capabilityB, "target capability must participate in dedupe identity");

const productionIdentity = computeSupportTicketDedupeKeyV2({
  ...baseEnvelope,
  environment: "production",
  is_test: false,
  visibility_class: "customer_visible",
});
const simulationIdentity = computeSupportTicketDedupeKeyV2({
  ...baseEnvelope,
  environment: "production",
  is_test: true,
  visibility_class: "internal_test",
});
const sandboxIdentity = computeSupportTicketDedupeKeyV2({
  ...baseEnvelope,
  environment: "sandbox",
  is_test: false,
  visibility_class: "partner_visible",
});
assert.notEqual(productionIdentity, simulationIdentity, "test and production tickets must not share a dedupe identity");
assert.notEqual(productionIdentity, sandboxIdentity, "environment and visibility must participate in dedupe identity");

const explicitlyTestTicket = deriveSupportTicketIntegrity({
  title: "Smoke test - support ticket email routing after governed outbox tools",
  environment: "production",
  is_test: true,
});
assert.equal(explicitlyTestTicket.is_test, true);
assert.equal(explicitlyTestTicket.environment, "production");
assert.equal(explicitlyTestTicket.visibility_class, "internal_test");

const ordinaryProductionTestFailure = deriveSupportTicketIntegrity({
  title: "Production test failure after provider deploy",
  environment: "production",
});
assert.equal(
  ordinaryProductionTestFailure.is_test,
  false,
  "ordinary title words must not hide a genuine production ticket",
);
assert.equal(ordinaryProductionTestFailure.visibility_class, "customer_visible");

const explicitFalseWins = deriveSupportTicketIntegrity({
  title: "QA outage affecting customers",
  environment: "staging",
  is_test: false,
  metadata_json: { admin_simulation: true },
});
assert.equal(explicitFalseWins.is_test, false, "explicit false must override inference");
assert.equal(explicitFalseWins.visibility_class, "customer_visible");

const simulationTicket = deriveSupportTicketIntegrity({
  title: "Tenant user simulation: WhatsApp channel repair link",
  metadata_json: { admin_simulation: true },
});
assert.equal(simulationTicket.is_test, true);
assert.equal(simulationTicket.visibility_class, "internal_test");

const customerTicket = deriveSupportTicketIntegrity({
  title: "Brand-scoped manager invitation required",
  environment: "production",
  visibility_class: "partner_visible",
});
assert.equal(customerTicket.is_test, false);
assert.equal(customerTicket.visibility_class, "partner_visible");

const now = new Date("2026-08-01T12:00:00Z");
const completedMilestones = computeSupportTicketSlaStatusV2({
  status: "open",
  first_response_due_at: "2026-08-01T08:00:00Z",
  first_response_at: "2026-08-01T07:55:00Z",
  triage_due_at: "2026-08-01T09:00:00Z",
  triaged_at: "2026-08-01T08:30:00Z",
  resolution_due_at: "2026-08-03T00:00:00Z",
}, now);
assert.equal(completedMilestones.status, "on_track", "completed milestones must not breach after their due timestamps");
assert.deepEqual(completedMilestones.breached_milestones, []);

const resolutionBreach = computeSupportTicketSlaStatusV2({
  status: "open",
  first_response_due_at: "2026-08-01T08:00:00Z",
  first_response_at: "2026-08-01T07:55:00Z",
  triage_due_at: "2026-08-01T09:00:00Z",
  triaged_at: "2026-08-01T08:30:00Z",
  resolution_due_at: "2026-08-01T10:00:00Z",
}, now);
assert.equal(resolutionBreach.status, "breached");
assert.equal(resolutionBreach.reason, "resolution_past_due");
assert.deepEqual(resolutionBreach.breached_milestones, ["resolution"]);

const lifecycleContradiction = resolveSupportTicketLifecyclePatch({
  ticket_id: "685dc4d9-c137-4941-81f4-de13306a8508",
  status: "open",
  lifecycle_state: "resolved_runtime_validated",
  customer_status: "resolved_runtime_validated",
});
assert.equal(lifecycleContradiction.should_update, true);
assert.equal(lifecycleContradiction.status, "resolved");

const creationContract = _testingSupportTicketLifecycleIntegrityCreation();
const requiredIntegrityColumns = creationContract.REQUIRED_INTEGRITY_COLUMNS;
const requiredIntegrityTables = creationContract.REQUIRED_INTEGRITY_TABLES;

function buildConnection({
  schemaColumns = requiredIntegrityColumns,
  schemaTables = requiredIntegrityTables,
  persistAffectedRows = 1,
  persistError = null,
} = {}) {
  const events = [];
  return {
    events,
    lastPersistSql: null,
    lastPersistParams: null,
    async query(sql, params = []) {
      if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) {
        events.push("schema_columns");
        return [schemaColumns.map((COLUMN_NAME) => ({ COLUMN_NAME }))];
      }
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) {
        events.push("schema_tables");
        return [schemaTables.map((TABLE_NAME) => ({ TABLE_NAME }))];
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
        this.lastPersistSql = sql;
        this.lastPersistParams = params;
        if (persistError) throw persistError;
        return [{ affectedRows: persistAffectedRows }];
      }
      throw new Error(`Unexpected query in atomic integrity test: ${sql}`);
    },
    async beginTransaction() { events.push("begin"); },
    async commit() { events.push("commit"); },
    async rollback() { events.push("rollback"); },
    release() { events.push("release"); },
  };
}

const successConnection = buildConnection();
const successResult = await createOrAppendSupportTicketWithIntegrityAtomic(
  {
    ...baseEnvelope,
    title: "Atomic integrity creation",
    environment: "sandbox",
    visibility_class: "partner_visible",
    is_test: false,
  },
  {
    pool: { async getConnection() { return successConnection; } },
    async createOrAppendSupportTicketFn(envelope, options) {
      successConnection.events.push("create");
      assert.equal(options.connection, successConnection);
      assert.match(envelope.dedupe_key, /^ticket:v2:[a-f0-9]{64}$/);
      return {
        ok: true,
        created: true,
        deduped: false,
        ticket: { ticket_id: "ticket-success" },
        secrets_included: false,
      };
    },
  },
);
assert.equal(successResult.integrity.persisted, true);
assert.equal(successResult.integrity.schema_ready, true);
assert.equal(successResult.integrity.dedupe_serialized, true);
assert.equal(successResult.integrity.dedupe_coordination.mode, "transaction_row_claim");
assert.equal(successResult.integrity.environment, "sandbox");
assert.equal(successResult.integrity.visibility_class, "partner_visible");
assert.match(successConnection.lastPersistSql, /environment = \?/);
assert.match(successConnection.lastPersistSql, /visibility_class = \?/);
assert.doesNotMatch(successConnection.lastPersistSql, /COALESCE\(NULLIF\(environment/);
assert.doesNotMatch(successConnection.lastPersistSql, /COALESCE\(NULLIF\(visibility_class/);
assert.deepEqual(successConnection.events, [
  "schema_columns",
  "schema_tables",
  "begin",
  "claim_insert",
  "claim_lock",
  "create",
  "persist",
  "commit",
  "release",
]);

const missingSchemaConnection = buildConnection({
  schemaColumns: requiredIntegrityColumns.filter((column) => column !== "triaged_at"),
});
let preflightCreateCalls = 0;
await assert.rejects(
  createOrAppendSupportTicketWithIntegrityAtomic(
    { ...baseEnvelope, title: "Pre-migration rejection" },
    {
      pool: { async getConnection() { return missingSchemaConnection; } },
      async createOrAppendSupportTicketFn() {
        preflightCreateCalls += 1;
        throw new Error("create must not run before schema readiness");
      },
    },
  ),
  (error) => error?.status === 409
    && error?.code === "support_ticket_integrity_schema_not_ready"
    && error?.schema?.missing_columns?.includes("triaged_at"),
);
assert.equal(preflightCreateCalls, 0);
assert.deepEqual(missingSchemaConnection.events, ["schema_columns", "schema_tables", "release"]);

const missingClaimTableConnection = buildConnection({ schemaTables: [] });
await assert.rejects(
  createOrAppendSupportTicketWithIntegrityAtomic(
    { ...baseEnvelope, title: "Missing dedupe claim table" },
    { pool: { async getConnection() { return missingClaimTableConnection; } } },
  ),
  (error) => error?.status === 409
    && error?.code === "support_ticket_integrity_schema_not_ready"
    && error?.schema?.missing_tables?.includes("support_ticket_dedupe_claims"),
);
assert.deepEqual(missingClaimTableConnection.events, ["schema_columns", "schema_tables", "release"]);

const rollbackConnection = buildConnection({ persistError: new Error("integrity update failed") });
await assert.rejects(
  createOrAppendSupportTicketWithIntegrityAtomic(
    { ...baseEnvelope, title: "Rollback integrity failure" },
    {
      pool: { async getConnection() { return rollbackConnection; } },
      async createOrAppendSupportTicketFn(_envelope, options) {
        rollbackConnection.events.push("create");
        assert.equal(options.connection, rollbackConnection);
        return {
          ok: true,
          created: true,
          deduped: false,
          ticket: { ticket_id: "ticket-rollback" },
          secrets_included: false,
        };
      },
    },
  ),
  /integrity update failed/,
);
assert.deepEqual(rollbackConnection.events, [
  "schema_columns",
  "schema_tables",
  "begin",
  "claim_insert",
  "claim_lock",
  "create",
  "persist",
  "rollback",
  "release",
]);

const listQueries = [];
const listConnection = {
  async query(sql, params = []) {
    listQueries.push({ sql, params });
    if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) {
      return [requiredIntegrityColumns.map((COLUMN_NAME) => ({ COLUMN_NAME }))];
    }
    return [[{
      ticket_id: "ticket-customer-safe",
      tenant_id: "tenant-a",
      user_id: "user-a",
      title: "Customer-visible ticket",
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
      dedupe_key: "ticket:v2:safe",
      occurrence_count: 1,
      customer_message: "We received your request.",
      created_at: now,
      updated_at: now,
      last_seen_at: now,
      latest_activity_at: now,
      first_response_due_at: now,
      triage_due_at: now,
      resolution_due_at: now,
      first_response_at: null,
      triaged_at: null,
      sla_status: "on_track",
      metadata_json: JSON.stringify({ customer_safe: true }),
      is_test: 0,
      environment: "production",
      visibility_class: "customer_visible",
      target_capability: null,
      related_ticket_id: null,
      parent_ticket_id: null,
      supersedes_ticket_id: null,
      internal_summary: "must never be returned",
      actor_id: "internal-actor",
      source_tool: "internal-tool",
    }]];
  },
  release() {},
};
const listed = await listSupportTicketsWithIntegrity(
  { tenant_id: "tenant-a", user_id: "user-a", include_test: false, limit: 10 },
  { pool: { async getConnection() { return listConnection; } } },
);
const listSql = listQueries[1].sql;
assert.doesNotMatch(listSql, /SELECT\s+\*/i);
assert.doesNotMatch(listSql, /customer_message\s+IS\s+NOT\s+NULL/i);
assert.match(listSql, /\(t\.user_id = \? OR t\.user_id IS NULL\)/);
assert.match(listSql, /ticket_lifecycle_events/);
assert.equal(listed.tickets.length, 1);
assert.equal("internal_summary" in listed.tickets[0], false);
assert.equal("actor_id" in listed.tickets[0], false);
assert.equal("source_tool" in listed.tickets[0], false);

const reconcileQueries = [];
const reconciliationRows = [
  {
    ticket_id: "ticket-newer",
    tenant_id: "tenant-a",
    title: "Newer",
    status: "open",
    lifecycle_state: "triage_pending",
    customer_status: "received",
    priority: "normal",
    assigned_to: null,
    sla_status: "breached",
    first_response_due_at: "2026-08-01T08:00:00Z",
    triage_due_at: "2026-08-01T09:00:00Z",
    resolution_due_at: "2026-08-03T00:00:00Z",
    stored_first_response_at: null,
    stored_triaged_at: null,
    first_response_at: "2026-08-01T07:55:00Z",
    triaged_at: "2026-08-01T08:30:00Z",
    last_seen_at: now,
    updated_at: now,
    created_at: now,
    reconciliation_activity_at: "2026-08-01T11:00:00Z",
    metadata_json: {},
    is_test: 0,
    environment: "production",
    visibility_class: "customer_visible",
  },
  {
    ticket_id: "ticket-middle",
    tenant_id: "tenant-a",
    title: "Middle",
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
    first_response_at: null,
    triaged_at: null,
    last_seen_at: now,
    updated_at: now,
    created_at: now,
    reconciliation_activity_at: "2026-08-01T10:00:00Z",
    metadata_json: {},
    is_test: 0,
    environment: "production",
    visibility_class: "customer_visible",
  },
  {
    ticket_id: "ticket-older",
    tenant_id: "tenant-a",
    title: "Older",
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
    first_response_at: null,
    triaged_at: null,
    last_seen_at: now,
    updated_at: now,
    created_at: now,
    reconciliation_activity_at: "2026-08-01T09:00:00Z",
    metadata_json: {},
    is_test: 0,
    environment: "production",
    visibility_class: "customer_visible",
  },
];
const reconcileConnection = {
  async query(sql, params = []) {
    reconcileQueries.push({ sql, params });
    if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) {
      return [requiredIntegrityColumns.map((COLUMN_NAME) => ({ COLUMN_NAME }))];
    }
    return [reconciliationRows];
  },
  release() {},
};
const reconciliation = await reconcileSupportTicketIntegrity(
  { tenant_id: "tenant-a", limit: 2, apply: false },
  { pool: { async getConnection() { return reconcileConnection; } } },
);
assert.equal(reconciliation.count, 2);
assert.equal(reconciliation.has_more, true);
assert.deepEqual(reconciliation.next_cursor, {
  activity_at: "2026-08-01T10:00:00Z",
  ticket_id: "ticket-middle",
});
assert.equal(reconciliation.findings[0].milestone_evidence.first_response_backfill_required, true);
assert.equal(reconciliation.findings[0].milestone_evidence.triage_backfill_required, true);
assert.match(reconcileQueries[1].sql, /stored_first_response_at/);
assert.match(reconcileQueries[1].sql, /ticket_lifecycle_events/);
assert.equal(reconcileQueries[1].params.at(-1), 3, "reconciliation must fetch one extra row for has_more");

await assert.rejects(
  reconcileSupportTicketIntegrity(
    { limit: 2, cursor_activity_at: "2026-08-01T10:00:00Z" },
    { pool: { async getConnection() { return reconcileConnection; } } },
  ),
  (error) => error?.status === 400 && error?.code === "support_ticket_integrity_cursor_incomplete",
);

const migration = await readFile(new URL("./migrations/1042_sprint69_support_ticket_lifecycle_sla_dedupe.sql", import.meta.url), "utf8");
for (const column of [
  "is_test",
  "environment",
  "visibility_class",
  "target_capability",
  "related_ticket_id",
  "parent_ticket_id",
  "supersedes_ticket_id",
  "first_response_at",
  "triaged_at",
]) {
  assert.match(migration, new RegExp(`\\b${column}\\b`), `migration must contain ${column}`);
}
assert.match(migration, /CREATE TABLE IF NOT EXISTS support_ticket_dedupe_claims/);
assert.match(migration, /PRIMARY KEY \(tenant_id, dedupe_key\)/);
assert.match(migration, /310f39c8-d2f7-4523-95db-9a783c59f9cf/);
assert.match(migration, /b48a7b04-fa30-4e7d-ac5b-7a97515e7dd4/);
assert.match(migration, /685dc4d9-c137-4941-81f4-de13306a8508/);
assert.match(migration, /GREATEST\(/);
assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|INDEX)/i);
assert.doesNotMatch(migration, /DELETE\s+FROM/i);

const routeSource = await readFile(new URL("./routes/supportTicketLifecycleIntegrityRoutes.js", import.meta.url), "utf8");
assert.match(routeSource, /router\.post\("\/me\/support\/tickets"/);
assert.match(routeSource, /router\.get\("\/me\/support\/tickets"/);
assert.match(routeSource, /include_test:\s*false/);
assert.match(routeSource, /APPLY_SUPPORT_TICKET_INTEGRITY_RECONCILIATION/);
assert.match(routeSource, /cursor_activity_at/);
assert.match(routeSource, /cursor_ticket_id/);
assert.match(routeSource, /import\s+\{\s*createUserJwtMiddleware\s*\}\s+from\s+"\.\.\/userJwtAuth\.js"/);
assert.match(routeSource, /deps\.requireUserJwt\s*\|\|\s*createUserJwtMiddleware/);
assert.doesNotMatch(routeSource, /from\s+["']jsonwebtoken["']/);
assert.doesNotMatch(routeSource, /development_fallback_secret_only/);
assert.doesNotMatch(routeSource, /function\s+(?:verifyUserJwt|requireUserJwt)\s*\(/);
assert.match(routeSource, /ORDER BY m\.granted_at ASC, m\.id ASC\s+LIMIT 2/);
assert.match(routeSource, /if \(rows\.length > 1\)/);
assert.match(routeSource, /tenant_context_required/);
assert.match(routeSource, /tenant_membership_ambiguous/);
assert.match(routeSource, /const \[membership = null\] = rows/);
assert.doesNotMatch(routeSource, /rows\s*\[\s*0\s*\]/);
assert.doesNotMatch(routeSource, /LIMIT\s+1/);
assert.match(routeSource, /createOrAppendSupportTicketWithIntegrityAtomic/);
assert.match(routeSource, /reconcileSupportTicketIntegrityWithEffectiveLifecycle/);
assert.doesNotMatch(routeSource, /createOrAppendSupportTicketWithIntegrity\(/);

const creationSource = await readFile(new URL("./supportTicketLifecycleIntegrityCreationService.js", import.meta.url), "utf8");
const schemaPreflightIndex = creationSource.indexOf("const schema = await readIntegritySchema(connection)");
const claimIndex = creationSource.indexOf("dedupeClaim = await acquireDedupeClaim");
const mutationIndex = creationSource.indexOf("const result = await createTicket");
assert.ok(schemaPreflightIndex >= 0 && claimIndex > schemaPreflightIndex, "schema preflight must precede dedupe claim");
assert.ok(mutationIndex > claimIndex, "dedupe claim must precede ticket mutation");
assert.match(creationSource, /support_ticket_integrity_schema_not_ready/);
assert.match(creationSource, /support_ticket_dedupe_claims/);
assert.match(creationSource, /ON DUPLICATE KEY UPDATE claim_token = claim_token/);
assert.match(creationSource, /FOR UPDATE/);
assert.match(creationSource, /await connection\.beginTransaction\(\)/);
assert.match(creationSource, /await connection\.commit\(\)/);
assert.match(creationSource, /await connection\.rollback\(\)/);
assert.match(creationSource, /connection,\s*\n\s*\}\)/);
assert.match(creationSource, /environment = \?/);
assert.match(creationSource, /visibility_class = \?/);

const integritySource = await readFile(new URL("./supportTicketLifecycleIntegrityService.js", import.meta.url), "utf8");
assert.doesNotMatch(integritySource, /TEST_TITLE_PATTERN/);
assert.doesNotMatch(integritySource, /customer_message IS NOT NULL/);
assert.match(integritySource, /CUSTOMER_SAFE_TICKET_SELECT/);
assert.match(integritySource, /FIRST_RESPONSE_EVIDENCE_SQL/);
assert.match(integritySource, /TRIAGE_EVIDENCE_SQL/);
assert.match(integritySource, /first_response_at = COALESCE\(first_response_at, \?\)/);
assert.match(integritySource, /triaged_at = COALESCE\(triaged_at, \?\)/);
assert.match(integritySource, /support_ticket_integrity_cursor_incomplete/);
assert.match(integritySource, /has_more: hasMore/);
assert.match(integritySource, /next_cursor: nextCursor/);

const reconciliationSource = await readFile(
  new URL("./supportTicketLifecycleIntegrityReconciliationService.js", import.meta.url),
  "utf8",
);
assert.match(reconciliationSource, /resolveSupportTicketLifecyclePatch\(row\)/);
assert.match(reconciliationSource, /computeSupportTicketSlaStatusV2\(effectiveRow, now\)/);
assert.match(reconciliationSource, /FROM tickets[\s\S]*FOR UPDATE/);
assert.match(reconciliationSource, /support_ticket_integrity_apply_target_missing/);

const indexSource = await readFile(new URL("./routes/index.js", import.meta.url), "utf8");
const integrityMount = indexSource.indexOf("buildSupportTicketLifecycleIntegrityRoutes");
const legacyMount = indexSource.indexOf("buildSupportTicketRoutes");
assert.ok(integrityMount >= 0, "integrity router must be registered");
assert.ok(legacyMount >= 0, "legacy support router must remain registered");
assert.ok(integrityMount < legacyMount, "integrity router must mount before legacy support router");

console.log("support ticket lifecycle, SLA evidence, customer-safe projection, test isolation, pagination, centralized JWT, tenant ambiguity, schema preflight, serialized atomic rollback, and effective reconciliation tests passed");
