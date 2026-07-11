import assert from "node:assert/strict";
import {
  listTenantResolutionCases,
  getTenantResolutionCase,
  transitionTenantResolutionCase,
  _testingTenantResolutionCaseLifecycleService,
} from "./tenantResolutionCaseLifecycleService.js";

const {
  assertTenantSafeTransition,
  caseProjection,
  eventProjection,
  sanitizeValue,
} = _testingTenantResolutionCaseLifecycleService;

const subject = { tenant_id: "tenant_1", user_id: "user_1" };
const baseCase = {
  case_id: "case_1",
  tenant_id: "tenant_1",
  workspace_id: "workspace_1",
  resource_ref: "workspace://workspace_1",
  root_family: "wordpress_site_health",
  playbook_key: "wordpress_site_doctor_v1",
  status: "detected",
  severity: "critical",
  root_fingerprint_sha256: "a".repeat(64),
  active_case_key: `case.${"b".repeat(64)}`,
  source_alert_keys_json: JSON.stringify(["alert.wpml"]),
  source_refs_json: JSON.stringify(["execution-log://1"]),
  impact_summary: "Publishing blocked",
  current_step_key: "case_created",
  owner_user_id: "user_1",
  last_diagnostic_json: JSON.stringify({ safe: "visible", api_key: "hidden" }),
  last_preflight_json: null,
  readback_status: "not_run",
  last_readback_at: null,
  created_at: "2026-07-11T00:00:00.000Z",
  updated_at: "2026-07-11T00:00:00.000Z",
  closed_at: null,
};

const projectedCase = caseProjection(baseCase);
assert.deepEqual(projectedCase.last_diagnostic, { safe: "visible" });
assert.equal(projectedCase.secrets_included, false);
assert.deepEqual(
  sanitizeValue({ token: "hide", safe: "show", nested: { password: "hide", reason: "ok" } }),
  { safe: "show", nested: { reason: "ok" } }
);
assert.deepEqual(assertTenantSafeTransition("detected", "diagnosing"), { idempotent: false });
assert.deepEqual(assertTenantSafeTransition("diagnosing", "diagnosing"), { idempotent: true });
assert.throws(
  () => assertTenantSafeTransition("detected", "resolved"),
  (error) => error.code === "TENANT_RESOLUTION_INVALID_TRANSITION" && error.status === 409
);
assert.throws(
  () => assertTenantSafeTransition("ready_to_apply", "applying"),
  (error) => error.code === "TENANT_RESOLUTION_INVALID_TRANSITION"
);

class FakeConnection {
  constructor({ rows = [baseCase], events = [], totalCount = null, updateAffectedRows = 1 } = {}) {
    this.rows = rows.map((row) => ({ ...row }));
    this.events = events.map((row) => ({ ...row }));
    this.totalCount = totalCount ?? this.rows.length;
    this.updateAffectedRows = updateAffectedRows;
    this.transactions = [];
    this.queries = [];
    this.insertedEvent = null;
  }

  async beginTransaction() { this.transactions.push("begin"); }
  async commit() { this.transactions.push("commit"); }
  async rollback() { this.transactions.push("rollback"); }
  release() { this.transactions.push("release"); }

  async query(sql, params = []) {
    this.queries.push({ sql, params });
    if (sql.includes("COUNT(*) AS total_count")) {
      return [[{ total_count: this.totalCount }]];
    }
    if (sql.includes("FROM tenant_resolution_cases") && sql.includes("ORDER BY updated_at DESC")) {
      const limit = params.at(-2);
      const offset = params.at(-1);
      return [this.rows.slice(offset, offset + limit)];
    }
    if (sql.includes("FROM tenant_resolution_case_events")) {
      return [this.events];
    }
    if (sql.includes("FOR UPDATE")) {
      return [[this.rows[0]].filter(Boolean)];
    }
    if (sql.includes("UPDATE tenant_resolution_cases")) {
      if (this.updateAffectedRows === 1 && this.rows[0]) {
        this.rows[0] = {
          ...this.rows[0],
          status: params[0],
          current_step_key: params[1],
          active_case_key: params[0] === "cancelled" ? null : this.rows[0].active_case_key,
          closed_at: params[0] === "cancelled" ? "2026-07-11T01:00:00.000Z" : this.rows[0].closed_at,
          updated_at: "2026-07-11T01:00:00.000Z",
        };
      }
      return [{ affectedRows: this.updateAffectedRows }];
    }
    if (sql.includes("INSERT INTO tenant_resolution_case_events")) {
      this.insertedEvent = {
        event_id: params[0],
        case_id: params[1],
        event_type: "status_changed",
        actor_type: params[2],
        actor_id: params[3],
        from_status: params[4],
        to_status: params[5],
        evidence_ref: params[6],
        event_json: params[7],
      };
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM tenant_resolution_cases") && sql.includes("case_id = ?") && sql.includes("tenant_id = ?")) {
      return [[this.rows[0]].filter(Boolean)];
    }
    if (sql.includes("FROM tenant_resolution_cases") && sql.includes("LIMIT 1")) {
      return [[this.rows[0]].filter(Boolean)];
    }
    throw new Error(`unexpected query: ${sql}`);
  }
}

class FakePool {
  constructor(connection) { this.connection = connection; }
  async getConnection() { return this.connection; }
}

const listConnection = new FakeConnection({ rows: [baseCase], totalCount: 3 });
const listed = await listTenantResolutionCases({
  explicitSubject: subject,
  cursor: 0,
  limit: 1,
  workspaceId: "workspace_1",
  status: "detected",
  pool: new FakePool(listConnection),
});
assert.equal(listed.items.length, 1);
assert.equal(listed.page.total_count, 3);
assert.equal(listed.page.has_more, true);
assert.equal(listed.page.next_cursor, 1);
assert.equal(listed.filters.workspace_id, "workspace_1");
assert.equal(listed.policy.provider_call_allowed, false);
assert.equal(listed.secrets_included, false);

const eventRow = {
  event_id: "event_1",
  case_id: "case_1",
  event_type: "case_created",
  actor_type: "tenant_user",
  actor_id: "user_1",
  from_status: null,
  to_status: "detected",
  evidence_ref: "execution-log://1",
  event_json: JSON.stringify({ safe: "ok", token: "hidden" }),
  created_at: "2026-07-11T00:00:00.000Z",
};
assert.deepEqual(eventProjection(eventRow).event, { safe: "ok" });
const getConnection = new FakeConnection({ rows: [baseCase], events: [eventRow] });
const detail = await getTenantResolutionCase({
  explicitSubject: subject,
  caseId: "case_1",
  workspaceId: "workspace_1",
  pool: new FakePool(getConnection),
});
assert.equal(detail.case.case_id, "case_1");
assert.equal(detail.events.length, 1);
assert.equal(detail.policy.workspace_scope_enforced_when_provided, true);

const notFoundConnection = new FakeConnection({ rows: [] });
await assert.rejects(
  () => getTenantResolutionCase({
    explicitSubject: subject,
    caseId: "case_missing",
    workspaceId: "workspace_2",
    pool: new FakePool(notFoundConnection),
  }),
  (error) => error.code === "TENANT_RESOLUTION_CASE_NOT_FOUND" && error.status === 404
);

const transitionConnection = new FakeConnection({ rows: [baseCase] });
const transitioned = await transitionTenantResolutionCase({
  explicitSubject: subject,
  caseId: "case_1",
  workspaceId: "workspace_1",
  input: {
    to_status: "diagnosing",
    note: "Start diagnostic review",
    idempotency_key: "transition-1",
    evidence_ref: "problem://1",
  },
  pool: new FakePool(transitionConnection),
  uuid: () => "33333333-3333-4333-8333-333333333333",
});
assert.equal(transitioned.changed, true);
assert.equal(transitioned.case.status, "diagnosing");
assert.equal(transitioned.event.from_status, "detected");
assert.equal(transitioned.event.to_status, "diagnosing");
assert.equal(transitioned.policy.resolved_transition_allowed, false);
assert.deepEqual(transitionConnection.transactions, ["begin", "commit", "release"]);
assert.equal(JSON.parse(transitionConnection.insertedEvent.event_json).provider_call_allowed, false);

const sameStatusConnection = new FakeConnection({ rows: [{ ...baseCase, status: "diagnosing" }] });
const sameStatus = await transitionTenantResolutionCase({
  explicitSubject: subject,
  caseId: "case_1",
  input: { to_status: "diagnosing" },
  pool: new FakePool(sameStatusConnection),
});
assert.equal(sameStatus.changed, false);
assert.equal(sameStatus.idempotency.same_status_returned, true);
assert.deepEqual(sameStatusConnection.transactions, ["begin", "commit", "release"]);

const invalidConnection = new FakeConnection({ rows: [baseCase] });
await assert.rejects(
  () => transitionTenantResolutionCase({
    explicitSubject: subject,
    caseId: "case_1",
    input: { to_status: "resolved" },
    pool: new FakePool(invalidConnection),
  }),
  (error) => error.code === "TENANT_RESOLUTION_INVALID_TRANSITION" && error.status === 409
);
assert.deepEqual(invalidConnection.transactions, ["begin", "rollback", "release"]);

const conflictConnection = new FakeConnection({ rows: [baseCase], updateAffectedRows: 0 });
await assert.rejects(
  () => transitionTenantResolutionCase({
    explicitSubject: subject,
    caseId: "case_1",
    input: { to_status: "diagnosing" },
    pool: new FakePool(conflictConnection),
  }),
  (error) => error.code === "TENANT_RESOLUTION_CASE_CONFLICT" && error.status === 409
);
assert.deepEqual(conflictConnection.transactions, ["begin", "rollback", "release"]);

await assert.rejects(
  () => listTenantResolutionCases({ explicitSubject: {}, pool: new FakePool(new FakeConnection()) }),
  (error) => error.code === "TENANT_RESOLUTION_TENANT_SCOPE_REQUIRED" && error.status === 403
);
await assert.rejects(
  () => listTenantResolutionCases({ explicitSubject: subject, status: "unknown", pool: new FakePool(new FakeConnection()) }),
  (error) => error.code === "TENANT_RESOLUTION_STATUS_INVALID" && error.status === 400
);

console.log("tenant resolution case lifecycle tests passed");
