// frontend-surface-operation: POST /tenant/resolution/cases/{caseId}/diagnostics
// frontend-state-change-proof: POST /tenant/resolution/cases/{caseId}/diagnostics

import assert from "node:assert/strict";
import {
  runTenantResolutionDiagnosticAction,
  _testingTenantResolutionDiagnosticService,
} from "./tenantResolutionDiagnosticService.js";

const {
  normalizeDiagnosticInput,
  sanitizeValue,
  determineDiagnosticOutcome,
  playbookProjection,
} = _testingTenantResolutionDiagnosticService;

const subject = { tenant_id: "tenant_1", user_id: "user_1" };
const baseRow = {
  case_id: "case_1",
  tenant_id: "tenant_1",
  workspace_id: "workspace_1",
  resource_ref: "workspace://workspace_1",
  root_family: "wordpress_site_health",
  playbook_key: "wordpress_site_doctor_v1",
  status: "detected",
  severity: "high",
  current_step_key: "case_created",
  owner_user_id: null,
  last_diagnostic_json: null,
  last_preflight_json: null,
  escalation_ref: null,
  updated_at: "2026-07-14T00:00:00.000Z",
  playbook_status: "active",
  playbook_tenant_visible: 1,
  playbook_risk_level: "high",
  required_capability_key: "wordpress_site_diagnostic",
  diagnostic_tool_key: "tenant_resolution_diagnose",
  decision_tool_key: "tenant_resolution_decide",
  apply_tool_key: null,
  readback_tool_key: "tenant_resolution_readback",
  approval_required: 0,
  readback_required: 1,
  playbook_policy_json: JSON.stringify({ diagnostic_only: true, api_key: "hidden" }),
};

assert.deepEqual(
  sanitizeValue({ token: "hidden", safe: "visible", nested: { password: "hidden", reason: "ok" } }),
  { safe: "visible", nested: { reason: "ok" } }
);
assert.throws(
  () => normalizeDiagnosticInput({ mode: "apply" }),
  (error) => error.code === "TENANT_RESOLUTION_DIAGNOSTIC_MODE_INVALID" && error.status === 400
);
const normalized = normalizeDiagnosticInput({
  mode: "diagnose",
  observations: {
    connection_ready: true,
    authority_ready: "true",
    evidence_refs: ["evidence://1", "evidence://1"],
    token: "ignored",
  },
});
assert.equal(normalized.observations.capability_ready, true);
assert.equal(normalized.observations.authority_ready, true);
assert.deepEqual(normalized.observations.evidence_refs, ["evidence://1"]);

const playbook = playbookProjection(baseRow);
assert.equal(playbook.policy.api_key, undefined);
assert.equal(
  determineDiagnosticOutcome(baseRow, playbook, {
    capability_ready: false,
    approval_ready: null,
    authority_ready: true,
    policy_allows_next_step: true,
    escalation_required: false,
    blocked_reasons: [],
  }).next_status,
  "needs_connection"
);
assert.equal(
  determineDiagnosticOutcome(baseRow, { ...playbook, required_capability_key: null, approval_required: true }, {
    capability_ready: null,
    approval_ready: false,
    authority_ready: true,
    policy_allows_next_step: true,
    escalation_required: false,
    blocked_reasons: [],
  }).next_status,
  "needs_approval"
);
assert.equal(
  determineDiagnosticOutcome(baseRow, { ...playbook, required_capability_key: null }, {
    capability_ready: null,
    approval_ready: true,
    authority_ready: false,
    policy_allows_next_step: true,
    escalation_required: false,
    blocked_reasons: [],
  }).next_status,
  "blocked_missing_authority"
);
assert.equal(
  determineDiagnosticOutcome(baseRow, { ...playbook, required_capability_key: null }, {
    capability_ready: null,
    approval_ready: true,
    authority_ready: true,
    policy_allows_next_step: false,
    escalation_required: false,
    blocked_reasons: [],
  }).next_status,
  "deferred_by_policy"
);
assert.equal(
  determineDiagnosticOutcome(baseRow, { ...playbook, required_capability_key: null }, {
    capability_ready: null,
    approval_ready: true,
    authority_ready: true,
    policy_allows_next_step: true,
    escalation_required: false,
    blocked_reasons: [],
  }).next_status,
  "ready_to_apply"
);

class FakeConnection {
  constructor({ row = baseRow, updateAffectedRows = 1 } = {}) {
    this.row = row ? { ...row } : null;
    this.updateAffectedRows = updateAffectedRows;
    this.transactions = [];
    this.events = [];
    this.queries = [];
  }

  async beginTransaction() { this.transactions.push("begin"); }
  async commit() { this.transactions.push("commit"); }
  async rollback() { this.transactions.push("rollback"); }
  release() { this.transactions.push("release"); }

  async query(sql, params = []) {
    this.queries.push({ sql, params });
    if (sql.includes("FROM tenant_resolution_cases c") && sql.includes("FOR UPDATE")) {
      return [[this.row].filter(Boolean)];
    }
    if (sql.includes("INSERT INTO tenant_resolution_case_events")) {
      this.events.push({
        event_id: params[0],
        case_id: params[1],
        event_type: params[2],
        actor_id: params[3],
        from_status: params[4],
        to_status: params[5],
        evidence_ref: params[6],
        event: JSON.parse(params[7]),
      });
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("last_diagnostic_json = ?")) {
      if (this.updateAffectedRows === 1 && this.row) {
        this.row.status = params[0];
        this.row.current_step_key = params[1];
        this.row.last_diagnostic_json = params[2];
      }
      return [{ affectedRows: this.updateAffectedRows }];
    }
    if (sql.includes("last_preflight_json = ?")) {
      if (this.updateAffectedRows === 1 && this.row) {
        this.row.current_step_key = "plan_previewed";
        this.row.last_preflight_json = params[0];
      }
      return [{ affectedRows: this.updateAffectedRows }];
    }
    if (sql.includes("escalation_ref = ?")) {
      if (this.updateAffectedRows === 1 && this.row) {
        this.row.status = "escalated";
        this.row.current_step_key = "escalated";
        this.row.escalation_ref = params[0];
      }
      return [{ affectedRows: this.updateAffectedRows }];
    }
    if (sql.includes("SET status = ?") && sql.includes("owner_user_id")) {
      if (this.updateAffectedRows === 1 && this.row) {
        this.row.status = params[0];
        this.row.current_step_key = params[1];
      }
      return [{ affectedRows: this.updateAffectedRows }];
    }
    throw new Error(`unexpected query: ${sql}`);
  }
}

class FakePool {
  constructor(connection) { this.connection = connection; }
  async getConnection() { return this.connection; }
}

function uuidSequence(values) {
  const queue = [...values];
  return () => queue.shift() || "99999999-9999-4999-8999-999999999999";
}

const diagnoseConnection = new FakeConnection();
const diagnosed = await runTenantResolutionDiagnosticAction({
  explicitSubject: subject,
  caseId: "case_1",
  workspaceId: "workspace_1",
  input: {
    mode: "diagnose",
    observations: {
      capability_ready: false,
      authority_ready: true,
      policy_allows_next_step: true,
      evidence_refs: ["evidence://diagnostic/1"],
      api_key: "ignored",
    },
  },
  pool: new FakePool(diagnoseConnection),
  uuid: uuidSequence([
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ]),
  now: () => new Date("2026-07-14T01:00:00.000Z"),
});
assert.equal(diagnosed.mode, "diagnose");
assert.equal(diagnosed.case.status, "needs_connection");
assert.equal(diagnosed.diagnostic.next_status, "needs_connection");
assert.equal(diagnosed.diagnostic.provider_call_allowed, false);
assert.equal(diagnosed.policy.execution_dispatched, false);
assert.deepEqual(diagnoseConnection.transactions, ["begin", "commit", "release"]);
assert.deepEqual(diagnoseConnection.events.map((event) => event.event_type), ["diagnostic_started", "diagnostic_completed"]);
assert.equal(diagnoseConnection.events[1].event.observations.api_key, undefined);

const readyConnection = new FakeConnection({
  row: { ...baseRow, required_capability_key: null, status: "diagnosing" },
});
const ready = await runTenantResolutionDiagnosticAction({
  explicitSubject: subject,
  caseId: "case_1",
  input: {
    mode: "diagnose",
    observations: {
      authority_ready: true,
      policy_allows_next_step: true,
    },
  },
  pool: new FakePool(readyConnection),
  uuid: uuidSequence([
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555",
  ]),
  now: () => new Date("2026-07-14T02:00:00.000Z"),
});
assert.equal(ready.case.status, "ready_to_apply");
assert.equal(readyConnection.events.length, 1);
assert.equal(readyConnection.events[0].event_type, "diagnostic_completed");

const previewConnection = new FakeConnection({
  row: {
    ...baseRow,
    status: "ready_to_apply",
    required_capability_key: null,
    last_diagnostic_json: JSON.stringify({ diagnostic_id: "diag_1", next_status: "ready_to_apply" }),
  },
});
const preview = await runTenantResolutionDiagnosticAction({
  explicitSubject: subject,
  caseId: "case_1",
  input: {
    mode: "plan_preview",
    observations: {
      authority_ready: true,
      policy_allows_next_step: true,
      evidence_refs: ["evidence://preview/1"],
    },
  },
  pool: new FakePool(previewConnection),
  uuid: uuidSequence([
    "66666666-6666-4666-8666-666666666666",
    "77777777-7777-4777-8777-777777777777",
  ]),
  now: () => new Date("2026-07-14T03:00:00.000Z"),
});
assert.equal(preview.case.status, "ready_to_apply");
assert.equal(preview.plan_preview.execution_dispatched, false);
assert.equal(previewConnection.events[0].event_type, "plan_previewed");

const escalationConnection = new FakeConnection({
  row: { ...baseRow, status: "needs_connection" },
});
const escalated = await runTenantResolutionDiagnosticAction({
  explicitSubject: subject,
  caseId: "case_1",
  input: {
    mode: "escalate",
    escalation_reason: "Tenant operator needs platform support.",
  },
  pool: new FakePool(escalationConnection),
  uuid: uuidSequence(["88888888-8888-4888-8888-888888888888"]),
  now: () => new Date("2026-07-14T04:00:00.000Z"),
});
assert.equal(escalated.case.status, "escalated");
assert.match(escalated.escalation.escalation_ref, /^tenant-resolution:\/\/case\/case_1\/escalation\//);
assert.equal(escalationConnection.events[0].event_type, "case_escalated");

const alreadyEscalatedConnection = new FakeConnection({
  row: { ...baseRow, status: "escalated", escalation_ref: "escalation://existing" },
});
const alreadyEscalated = await runTenantResolutionDiagnosticAction({
  explicitSubject: subject,
  caseId: "case_1",
  input: { mode: "escalate" },
  pool: new FakePool(alreadyEscalatedConnection),
});
assert.equal(alreadyEscalated.changed, false);
assert.equal(alreadyEscalated.escalation.already_escalated, true);
assert.equal(alreadyEscalatedConnection.events.length, 0);

const terminalConnection = new FakeConnection({ row: { ...baseRow, status: "resolved" } });
await assert.rejects(
  () => runTenantResolutionDiagnosticAction({
    explicitSubject: subject,
    caseId: "case_1",
    input: { mode: "diagnose" },
    pool: new FakePool(terminalConnection),
  }),
  (error) => error.code === "TENANT_RESOLUTION_DIAGNOSTIC_NOT_ALLOWED" && error.status === 409
);
assert.deepEqual(terminalConnection.transactions, ["begin", "rollback", "release"]);

const missingConnection = new FakeConnection({ row: null });
await assert.rejects(
  () => runTenantResolutionDiagnosticAction({
    explicitSubject: subject,
    caseId: "case_missing",
    workspaceId: "workspace_2",
    input: { mode: "diagnose" },
    pool: new FakePool(missingConnection),
  }),
  (error) => error.code === "TENANT_RESOLUTION_CASE_NOT_FOUND" && error.status === 404
);

const conflictConnection = new FakeConnection({ updateAffectedRows: 0 });
await assert.rejects(
  () => runTenantResolutionDiagnosticAction({
    explicitSubject: subject,
    caseId: "case_1",
    input: { mode: "diagnose" },
    pool: new FakePool(conflictConnection),
  }),
  (error) => error.code === "TENANT_RESOLUTION_CASE_CONFLICT" && error.status === 409
);
assert.deepEqual(conflictConnection.transactions, ["begin", "rollback", "release"]);

await assert.rejects(
  () => runTenantResolutionDiagnosticAction({
    explicitSubject: {},
    caseId: "case_1",
    input: { mode: "diagnose" },
    pool: new FakePool(new FakeConnection()),
  }),
  (error) => error.code === "TENANT_RESOLUTION_TENANT_SCOPE_REQUIRED" && error.status === 403
);

console.log("tenant resolution diagnostic core tests passed");
