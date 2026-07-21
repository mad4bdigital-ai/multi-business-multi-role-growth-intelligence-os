import assert from "node:assert/strict";
import {
  verifyTenantTaskSourceRepair,
  _testingTenantTaskSourceRepairVerificationService,
} from "./tenantTaskSourceRepairVerificationService.js";

const {
  normalizeInput,
  inspectTaskQuality,
  validateEvidence,
  buildVerification,
  sameVerification,
} = _testingTenantTaskSourceRepairVerificationService;

const fingerprint = "a".repeat(64);
const subject = { tenant_id: "tenant_1", user_id: "user_1" };
const taskId = "11111111-1111-4111-8111-111111111111";
const envelopeId = "env_apply_1";

assert.throws(
  () => normalizeInput({ expected_preview_fingerprint_sha256: "bad" }),
  (error) => error.code === "TENANT_TASK_SOURCE_VERIFY_FINGERPRINT_INVALID"
);
assert.equal(
  inspectTaskQuality({ task_id: taskId, task_key: "", title: "Title", source_surface: "surface", source_ref: "ref", owner_scope: "tenant", tenant_id: "tenant_1" })[0].field,
  "task_key"
);

const preflight = {
  preview_fingerprint_sha256: fingerprint,
  task_identity: { task_id: taskId, task_key: "old.key" },
  changes: [
    { field: "task_key", from: "old.key", to: "new.key" },
    { field: "title", from: "Old title", to: "New title" },
    { field: "source_surface", from: "legacy", to: "tenant_resolution" },
    { field: "source_ref", from: "legacy://task", to: "tenant-resolution://case/case_1" },
  ],
};

const applyEvidence = {
  phase: "applied_pending_verification",
  applied_at: "2026-07-17T01:00:00.000Z",
  preview_fingerprint_sha256: fingerprint,
  capability_envelope_id: envelopeId,
  approval_hold_id: "hold_1",
  task_id: taskId,
  changed_fields: ["task_key", "title", "source_surface", "source_ref"],
  mutation_readback: {
    status: "passed",
    checked_fields: ["task_key", "title", "source_surface", "source_ref"],
  },
  lifecycle_readback_status: "not_run",
  provider_call_allowed: false,
  external_write_allowed: false,
  resolved_transition_allowed: false,
  secrets_included: false,
};

const baseCase = {
  case_id: "case_1",
  tenant_id: "tenant_1",
  workspace_id: "workspace_1",
  root_family: "task_source_quality",
  playbook_key: "task_source_repair_v1",
  status: "verifying",
  current_step_key: "task_source_repair_verifying",
  readback_status: "not_run",
  last_preflight_json: JSON.stringify(preflight),
  last_result_json: JSON.stringify(applyEvidence),
  playbook_status: "active",
  playbook_tenant_visible: 1,
  readback_required: 1,
};

const baseEnvelope = {
  envelope_id: envelopeId,
  tenant_id: "tenant_1",
  user_id: "user_1",
  execution_status: "executed",
  secrets_included: 0,
};

const baseTask = {
  task_id: taskId,
  task_key: "new.key",
  title: "New title",
  owner_scope: "tenant",
  tenant_id: "tenant_1",
  source_surface: "tenant_resolution",
  source_ref: "tenant-resolution://case/case_1",
  context_json: JSON.stringify({ source: "tenant_resolution" }),
  updated_at: "2026-07-17T01:00:01.000Z",
};

assert.throws(
  () => validateEvidence({ ...baseCase, last_result_json: JSON.stringify({ ...applyEvidence, preview_fingerprint_sha256: "b".repeat(64) }) }, fingerprint),
  (error) => error.code === "TENANT_TASK_SOURCE_VERIFY_FINGERPRINT_MISMATCH"
);

const directVerification = buildVerification({
  task: baseTask,
  tenantId: "tenant_1",
  taskId,
  expectedValues: {
    task_key: "new.key",
    title: "New title",
    source_surface: "tenant_resolution",
    source_ref: "tenant-resolution://case/case_1",
  },
  fingerprint,
  apply: applyEvidence,
  checkedAt: "2026-07-17T02:00:00.000Z",
  previousVerification: null,
});
assert.equal(directVerification.status, "passed");
assert.equal(directVerification.no_side_effect_evidence.task_registry_write_allowed, false);
assert.equal(sameVerification(directVerification, { ...directVerification, checked_at: "later" }), true);

class FakeConnection {
  constructor({
    caseRow = baseCase,
    envelopeRow = baseEnvelope,
    taskRow = baseTask,
    applyEvents = [{ event_type: "task_source_repair_applied", created_at: "2026-07-17T01:00:01.000Z" }],
    failEventInsert = false,
  } = {}) {
    this.caseRow = caseRow ? { ...caseRow } : null;
    this.envelopeRow = envelopeRow ? { ...envelopeRow } : null;
    this.taskRow = taskRow ? { ...taskRow } : null;
    this.applyEvents = applyEvents;
    this.failEventInsert = failEventInsert;
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
      return [[this.caseRow].filter(Boolean)];
    }
    if (sql.includes("FROM capability_resolution_envelope_ledger")) {
      return [[this.envelopeRow].filter(Boolean)];
    }
    if (sql.includes("FROM tenant_resolution_case_events") && sql.includes("task_source_repair_apply_conflict")) {
      return [this.applyEvents];
    }
    if (sql.includes("FROM platform_pending_tasks") && sql.includes("FOR SHARE")) {
      return [[this.taskRow].filter(Boolean)];
    }
    if (sql.includes("UPDATE tenant_resolution_cases")) {
      if (!this.caseRow || this.caseRow.status !== "verifying" || this.caseRow.current_step_key !== params[5]) {
        return [{ affectedRows: 0 }];
      }
      this.caseRow.current_step_key = params[0];
      this.caseRow.readback_status = params[1];
      this.caseRow.last_result_json = params[2];
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("INSERT INTO tenant_resolution_case_events")) {
      if (this.failEventInsert) throw new Error("event persistence failed");
      this.events.push({
        event_id: params[0],
        event_type: params[2],
        payload: JSON.parse(params[5]),
      });
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
}

class FakePool {
  constructor(connection) { this.connection = connection; }
  async getConnection() { return this.connection; }
}

async function run(connection, input = {}) {
  return verifyTenantTaskSourceRepair({
    explicitSubject: subject,
    caseId: "case_1",
    workspaceId: "workspace_1",
    input: {
      expected_preview_fingerprint_sha256: fingerprint,
      ...input,
    },
    pool: new FakePool(connection),
    uuid: () => "event_verify_1",
    now: () => new Date("2026-07-17T02:00:00.000Z"),
  });
}

const happyConnection = new FakeConnection();
const happy = await run(happyConnection);
assert.equal(happy.changed, true);
assert.equal(happy.case.status, "verifying");
assert.equal(happy.case.current_step_key, "task_source_repair_verified");
assert.equal(happy.case.readback_status, "passed");
assert.equal(happy.verification.status, "passed");
assert.equal(happyConnection.events.length, 1);
assert.equal(happyConnection.events[0].event_type, "task_source_repair_verification_passed");
assert.deepEqual(happyConnection.transactions, ["begin", "commit", "release"]);
assert.equal(
  happyConnection.queries.some(({ sql }) => sql.includes("UPDATE platform_pending_tasks")),
  false
);

const mismatchConnection = new FakeConnection({
  taskRow: { ...baseTask, title: "Changed after apply" },
});
const mismatch = await run(mismatchConnection);
assert.equal(mismatch.case.status, "verifying");
assert.equal(mismatch.case.current_step_key, "task_source_repair_verification_failed");
assert.equal(mismatch.case.readback_status, "failed");
assert.equal(mismatch.verification.failure_reasons.some((reason) => reason.code === "expected_value_mismatch"), true);
assert.equal(mismatchConnection.events[0].event_type, "task_source_repair_verification_failed");

const missingTaskConnection = new FakeConnection({ taskRow: null });
const missingTask = await run(missingTaskConnection);
assert.equal(missingTask.verification.status, "failed");
assert.equal(missingTask.verification.failure_reasons[0].code, "task_missing");

const badScopeConnection = new FakeConnection({
  taskRow: { ...baseTask, owner_scope: "platform" },
});
const badScope = await run(badScopeConnection);
assert.equal(badScope.verification.failure_reasons.some((reason) => reason.code === "tenant_scope_mismatch"), true);

const malformedConnection = new FakeConnection({
  taskRow: { ...baseTask, source_ref: "" },
});
const malformed = await run(malformedConnection);
assert.equal(malformed.verification.failure_reasons.some((reason) => reason.code === "quality_issue_remaining"), true);

const envelopeConnection = new FakeConnection({
  envelopeRow: { ...baseEnvelope, execution_status: "not_executed" },
});
await assert.rejects(
  () => run(envelopeConnection),
  (error) => error.code === "TENANT_TASK_SOURCE_VERIFY_ENVELOPE_NOT_EXECUTED"
);
assert.deepEqual(envelopeConnection.transactions, ["begin", "rollback", "release"]);

const wrongStatusConnection = new FakeConnection({
  caseRow: { ...baseCase, status: "ready_to_apply" },
});
await assert.rejects(
  () => run(wrongStatusConnection),
  (error) => error.code === "TENANT_TASK_SOURCE_VERIFY_STATUS_INVALID"
);

const missingCaseConnection = new FakeConnection({ caseRow: null });
await assert.rejects(
  () => run(missingCaseConnection),
  (error) => error.code === "TENANT_TASK_SOURCE_VERIFY_CASE_NOT_FOUND"
);

const eventConflictConnection = new FakeConnection({ failEventInsert: true });
await assert.rejects(
  () => run(eventConflictConnection),
  (error) => error.message === "event persistence failed"
);
assert.deepEqual(eventConflictConnection.transactions, ["begin", "rollback", "release"]);

const existingVerification = {
  ...directVerification,
  checked_at: "2026-07-17T01:30:00.000Z",
};
const idempotentCase = {
  ...baseCase,
  current_step_key: "task_source_repair_verified",
  readback_status: "passed",
  last_result_json: JSON.stringify({
    ...applyEvidence,
    lifecycle_readback_status: "passed",
    verification: existingVerification,
  }),
};
const idempotentConnection = new FakeConnection({ caseRow: idempotentCase });
const idempotent = await run(idempotentConnection);
assert.equal(idempotent.changed, false);
assert.equal(idempotent.existing_readback_returned, true);
assert.equal(idempotentConnection.events.length, 0);
assert.equal(
  idempotentConnection.queries.some(({ sql }) => sql.includes("UPDATE tenant_resolution_cases")),
  false
);

const changedAfterPassConnection = new FakeConnection({
  caseRow: idempotentCase,
  taskRow: { ...baseTask, updated_at: "2026-07-17T03:00:00.000Z" },
});
const changedAfterPass = await run(changedAfterPassConnection);
assert.equal(changedAfterPass.changed, true);
assert.equal(changedAfterPass.verification.status, "failed");
assert.equal(
  changedAfterPass.verification.failure_reasons.some((reason) => reason.code === "new_drift_detected"),
  true
);

await assert.rejects(
  () => verifyTenantTaskSourceRepair({ explicitSubject: {}, caseId: "case_1", input: {} }),
  (error) => error.code === "TENANT_TASK_SOURCE_VERIFY_SUBJECT_REQUIRED"
);

console.log("tenant task source repair verification tests passed");
