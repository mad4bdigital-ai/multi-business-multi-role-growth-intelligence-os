import assert from "node:assert/strict";
import {
  applyTenantTaskSourceRepair,
  _testingTenantTaskSourceRepairApplyService,
} from "./tenantTaskSourceRepairApplyService.js";

const {
  typedConfirmation,
  normalizeInput,
  validatePreflight,
  verifyNoDrift,
} = _testingTenantTaskSourceRepairApplyService;

const fingerprint = "a".repeat(64);
const envelopeId = "env_apply_1";
const holdId = "hold_apply_1";
const subject = { tenant_id: "tenant_1", user_id: "user_1" };
const confirm = typedConfirmation(fingerprint);

assert.equal(confirm, "APPLY_TASK_SOURCE_REPAIR_AAAAAAAAAAAA");
assert.throws(
  () => normalizeInput({ preview_fingerprint_sha256: fingerprint, capability_envelope_id: envelopeId, approval_hold_id: holdId, confirm: "WRONG" }),
  (error) => error.code === "TENANT_TASK_SOURCE_APPLY_CONFIRMATION_MISMATCH"
);
assert.throws(
  () => validatePreflight({ preview_fingerprint_sha256: fingerprint, ready_for_apply_gate: true, unresolved_issues: [], changes: [{ field: "task_id", from: "a", to: "b" }] }, fingerprint),
  (error) => error.code === "TENANT_TASK_SOURCE_APPLY_FIELD_FORBIDDEN"
);
assert.throws(
  () => verifyNoDrift({ title: "changed" }, [{ field: "title", from: "old", to: "new" }]),
  (error) => error.code === "TENANT_TASK_SOURCE_APPLY_DRIFT_DETECTED"
);

const preflight = {
  preview_id: "preview_1",
  preview_fingerprint_sha256: fingerprint,
  ready_for_apply_gate: true,
  unresolved_issues: [],
  task_identity: { task_id: "11111111-1111-4111-8111-111111111111", task_key: "old.key" },
  changes: [
    { field: "task_key", from: "old.key", to: "new.key" },
    { field: "title", from: "Old title", to: "New title" },
    { field: "source_surface", from: "legacy", to: "tenant_resolution" },
    { field: "source_ref", from: "legacy://task", to: "tenant-resolution://case/case_1" },
  ],
};

const baseCase = {
  case_id: "case_1",
  tenant_id: "tenant_1",
  workspace_id: "workspace_1",
  root_family: "task_source_quality",
  playbook_key: "task_source_repair_v1",
  status: "ready_to_apply",
  last_preflight_json: JSON.stringify(preflight),
  playbook_status: "active",
  playbook_tenant_visible: 1,
  required_capability_key: "tenant_task_source_repair",
  approval_required: 1,
  readback_required: 1,
};

const baseEnvelope = {
  envelope_id: envelopeId,
  tenant_id: "tenant_1",
  user_id: "user_1",
  workspace_id: "workspace_1",
  workspace_key: "workspace_1",
  brand_key: null,
  app_key: "platform_orchestration",
  capability_key: "tenant_task_source_repair",
  operation_intent: "tenant_resolution_apply",
  risk_class: "C",
  selected_source_tier: "tenant_managed",
  selected_runtime_surface: "tenant_resolution_apply",
  authority_status: "resolved",
  decision: "allow",
  envelope_status: "ready_for_dispatch",
  dispatch_allowed: 1,
  apply_allowed: 1,
  approval_required: 0,
  quota_required: 0,
  audit_required: 1,
  readback_required: 1,
  blocking_gap_count: 0,
  execution_status: "not_executed",
  expires_at: "2030-01-01T00:00:00.000Z",
  secrets_included: 0,
  envelope_sha256: "b".repeat(64),
  envelope_json: JSON.stringify({}),
};

const baseHold = {
  hold_id: holdId,
  tenant_id: "tenant_1",
  user_id: "user_1",
  run_id: envelopeId,
  request_id: envelopeId,
  hold_type: "supervisor_approval",
  status: "approved",
  decision_by: "owner_1",
  decision_note: "Approved after preview review.",
  decided_at: "2026-07-17T00:00:00.000Z",
  expires_at: "2030-01-01T00:00:00.000Z",
  execution_context_json: JSON.stringify({ capability_envelope_id: envelopeId }),
};

const baseTask = {
  task_id: "11111111-1111-4111-8111-111111111111",
  task_key: "old.key",
  title: "Old title",
  owner_scope: "tenant",
  tenant_id: "tenant_1",
  source_surface: "legacy",
  source_ref: "legacy://task",
  updated_at: "2026-07-17T00:00:00.000Z",
};

class FakeConnection {
  constructor({ caseRow = baseCase, envelopeRow = baseEnvelope, holdRow = baseHold, taskRow = baseTask } = {}) {
    this.caseRow = caseRow ? { ...caseRow } : null;
    this.envelopeRow = envelopeRow ? { ...envelopeRow } : null;
    this.holdRow = holdRow ? { ...holdRow } : null;
    this.taskRow = taskRow ? { ...taskRow } : null;
    this.transactions = [];
    this.events = [];
    this.queries = [];
    this.envelopeConsumed = false;
  }
  async beginTransaction() { this.transactions.push("begin"); }
  async commit() { this.transactions.push("commit"); }
  async rollback() { this.transactions.push("rollback"); }
  release() { this.transactions.push("release"); }

  async query(sql, params = []) {
    this.queries.push({ sql, params });
    if (sql.includes("FROM tenant_resolution_cases c") && sql.includes("FOR UPDATE")) {
      return [[this.caseRow].filter(Boolean)];
    }
    if (sql.includes("FROM capability_resolution_envelope_ledger") && sql.includes("LIMIT 1")) {
      return [[this.envelopeRow].filter(Boolean)];
    }
    if (sql.includes("FROM approval_holds") && sql.includes("FOR UPDATE")) {
      return [[this.holdRow].filter(Boolean)];
    }
    if (sql.includes("FROM platform_pending_tasks") && sql.includes("FOR UPDATE")) {
      return [[this.taskRow].filter(Boolean)];
    }
    if (sql.includes("SET status = 'applying'")) {
      if (!this.caseRow || this.caseRow.status !== "ready_to_apply") return [{ affectedRows: 0 }];
      this.caseRow.status = "applying";
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("INSERT INTO tenant_resolution_case_events")) {
      this.events.push({ params, payload: JSON.parse(params[7]) });
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("UPDATE platform_pending_tasks")) {
      const assignments = [...sql.matchAll(/`(task_key|title|source_surface|source_ref)` = \?/g)].map((match) => match[1]);
      assignments.forEach((field, index) => { this.taskRow[field] = params[index]; });
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM platform_pending_tasks") && !sql.includes("FOR UPDATE")) {
      return [[this.taskRow].filter(Boolean)];
    }
    if (sql.includes("SET status = 'verifying'")) {
      if (!this.caseRow || this.caseRow.status !== "applying") return [{ affectedRows: 0 }];
      this.caseRow.status = "verifying";
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("SET execution_status = 'executed'")) {
      if (!this.envelopeRow || !["not_executed", "referenced"].includes(this.envelopeRow.execution_status)) return [{ affectedRows: 0 }];
      this.envelopeRow.execution_status = "executed";
      this.envelopeRow.dispatch_allowed = 0;
      this.envelopeRow.apply_allowed = 0;
      this.envelopeConsumed = true;
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected query: ${sql}`);
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

const happyConnection = new FakeConnection();
const happy = await applyTenantTaskSourceRepair({
  explicitSubject: subject,
  caseId: "case_1",
  workspaceId: "workspace_1",
  input: {
    preview_fingerprint_sha256: fingerprint,
    capability_envelope_id: envelopeId,
    approval_hold_id: holdId,
    confirm,
  },
  pool: new FakePool(happyConnection),
  uuid: uuidSequence(["event_applying", "event_verifying"]),
  now: () => new Date("2026-07-17T01:00:00.000Z"),
});
assert.equal(happy.changed, true);
assert.equal(happy.case.status, "verifying");
assert.equal(happy.case.readback_status, "not_run");
assert.equal(happy.task.task_key, "new.key");
assert.equal(happy.task.title, "New title");
assert.equal(happy.apply.mutation_readback.status, "passed");
assert.equal(happy.envelope.consumed, true);
assert.equal(happyConnection.envelopeConsumed, true);
assert.equal(happyConnection.events.length, 2);
assert.deepEqual(happyConnection.transactions, ["begin", "commit", "release"]);

const envelopeBlocked = new FakeConnection({ envelopeRow: { ...baseEnvelope, apply_allowed: 0 } });
await assert.rejects(
  () => applyTenantTaskSourceRepair({
    explicitSubject: subject,
    caseId: "case_1",
    input: { preview_fingerprint_sha256: fingerprint, capability_envelope_id: envelopeId, approval_hold_id: holdId, confirm },
    pool: new FakePool(envelopeBlocked),
  }),
  (error) => error.code === "TENANT_TASK_SOURCE_APPLY_ENVELOPE_POLICY_MISMATCH"
);
assert.deepEqual(envelopeBlocked.transactions, ["begin", "rollback", "release"]);
assert.equal(envelopeBlocked.envelopeConsumed, false);

const missingHold = new FakeConnection({ holdRow: null });
await assert.rejects(
  () => applyTenantTaskSourceRepair({
    explicitSubject: subject,
    caseId: "case_1",
    input: { preview_fingerprint_sha256: fingerprint, capability_envelope_id: envelopeId, approval_hold_id: holdId, confirm },
    pool: new FakePool(missingHold),
  }),
  (error) => error.code === "TENANT_TASK_SOURCE_APPLY_APPROVAL_HOLD_INVALID"
);
assert.equal(missingHold.envelopeConsumed, false);

const driftTask = new FakeConnection({ taskRow: { ...baseTask, title: "Changed after preview" } });
await assert.rejects(
  () => applyTenantTaskSourceRepair({
    explicitSubject: subject,
    caseId: "case_1",
    input: { preview_fingerprint_sha256: fingerprint, capability_envelope_id: envelopeId, approval_hold_id: holdId, confirm },
    pool: new FakePool(driftTask),
  }),
  (error) => error.code === "TENANT_TASK_SOURCE_APPLY_DRIFT_DETECTED"
);
assert.equal(driftTask.envelopeConsumed, false);

const wrongStatus = new FakeConnection({ caseRow: { ...baseCase, status: "diagnosing" } });
await assert.rejects(
  () => applyTenantTaskSourceRepair({
    explicitSubject: subject,
    caseId: "case_1",
    input: { preview_fingerprint_sha256: fingerprint, capability_envelope_id: envelopeId, approval_hold_id: holdId, confirm },
    pool: new FakePool(wrongStatus),
  }),
  (error) => error.code === "TENANT_TASK_SOURCE_APPLY_STATUS_INVALID"
);

await assert.rejects(
  () => applyTenantTaskSourceRepair({ explicitSubject: {}, caseId: "case_1", input: {} }),
  (error) => error.code === "TENANT_TASK_SOURCE_APPLY_SUBJECT_REQUIRED"
);

console.log("tenant task source repair apply tests passed");
