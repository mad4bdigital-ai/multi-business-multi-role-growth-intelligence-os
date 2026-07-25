// frontend-surface-operation: POST /tenant/resolution/cases/{caseId}/task-source-repair/preview
// frontend-state-change-proof: POST /tenant/resolution/cases/{caseId}/task-source-repair/preview

import assert from "node:assert/strict";
import {
  previewTenantTaskSourceRepair,
  _testingTenantTaskSourceRepairPreviewService,
} from "./tenantTaskSourceRepairPreviewService.js";

const {
  referenceLookup,
  normalizeLookup,
  normalizeProposedValues,
  inspectTaskQuality,
  buildProposal,
  sanitizeValue,
} = _testingTenantTaskSourceRepairPreviewService;

const subject = { tenant_id: "tenant_1", user_id: "user_1" };
const baseCase = {
  case_id: "case_1",
  tenant_id: "tenant_1",
  workspace_id: "workspace_1",
  resource_ref: "platform-pending-task://11111111-1111-4111-8111-111111111111",
  source_refs_json: JSON.stringify([]),
  root_family: "task_source_quality",
  playbook_key: "task_source_repair_v1",
  status: "needs_approval",
  severity: "high",
  current_step_key: "diagnostic_needs_approval",
  last_preflight_json: null,
  updated_at: "2026-07-14T00:00:00.000Z",
  playbook_status: "active",
  playbook_tenant_visible: 1,
  required_capability_key: "tenant_task_source_repair",
  approval_required: 1,
  readback_required: 1,
  playbook_policy_json: JSON.stringify({ malformed_row_count_must_reach_zero: true }),
};
const malformedTask = {
  task_id: "11111111-1111-4111-8111-111111111111",
  task_key: "",
  title: "",
  task_type: "system_repair",
  priority: "P0",
  status: "pending",
  blocker_level: "critical",
  owner_scope: "tenant",
  tenant_id: "tenant_1",
  source_surface: "",
  source_ref: "",
  conversation_context_ref: null,
  context_json: "{invalid-json",
  created_at: "2026-07-13T00:00:00.000Z",
  updated_at: "2026-07-14T00:00:00.000Z",
};

assert.deepEqual(referenceLookup("task-id:11111111-1111-4111-8111-111111111111"), {
  task_id: "11111111-1111-4111-8111-111111111111",
});
assert.deepEqual(referenceLookup("task-key:repair.task.source"), {
  task_key: "repair.task.source",
});
assert.equal(referenceLookup("unsupported://value"), null);
assert.deepEqual(
  sanitizeValue({ token: "hidden", safe: "visible", nested: { password: "hidden", reason: "ok" } }),
  { safe: "visible", nested: { reason: "ok" } }
);
assert.throws(
  () => normalizeLookup({ task_id: "22222222-2222-4222-8222-222222222222" }, baseCase),
  (error) => error.code === "TENANT_TASK_SOURCE_REPAIR_CASE_BINDING_MISMATCH" && error.status === 409
);
assert.throws(
  () => normalizeLookup({}, { ...baseCase, resource_ref: null, source_refs_json: "[]" }),
  (error) => error.code === "TENANT_TASK_SOURCE_REPAIR_LOOKUP_REQUIRED" && error.status === 400
);
assert.throws(
  () => normalizeProposedValues({ proposed_values: { title: "   " } }),
  (error) => error.code === "TENANT_TASK_SOURCE_REPAIR_PROPOSED_VALUE_INVALID" && error.status === 400
);

const issues = inspectTaskQuality(malformedTask);
assert.deepEqual(
  issues.map((issue) => `${issue.field}:${issue.issue}`).sort(),
  [
    "context_json:invalid_json",
    "source_ref:missing_or_blank",
    "source_surface:missing_or_blank",
    "task_key:missing_or_blank",
    "title:missing_or_blank",
  ].sort()
);

const proposalA = buildProposal(
  malformedTask,
  issues,
  {
    task_key: "tenant.task-source-repair",
    title: "Repair malformed tenant task source",
    source_surface: "tenant_resolution",
    source_ref: "tenant-resolution://case/case_1",
  },
  baseCase,
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "2026-07-14T01:00:00.000Z"
);
const proposalB = buildProposal(
  malformedTask,
  issues,
  {
    task_key: "tenant.task-source-repair",
    title: "Repair malformed tenant task source",
    source_surface: "tenant_resolution",
    source_ref: "tenant-resolution://case/case_1",
  },
  baseCase,
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "2026-07-14T02:00:00.000Z"
);
assert.equal(proposalA.preview_fingerprint_sha256, proposalB.preview_fingerprint_sha256);
assert.equal(proposalA.ready_for_apply_gate, false, "invalid context_json remains unresolved without an apply-safe proposal");
assert.equal(proposalA.repair_apply_allowed, false);
assert.equal(proposalA.task_registry_write_allowed, false);

class FakeConnection {
  constructor({ caseRow = baseCase, taskRow = malformedTask, updateAffectedRows = 1 } = {}) {
    this.caseRow = caseRow ? { ...caseRow } : null;
    this.taskRow = taskRow ? { ...taskRow } : null;
    this.updateAffectedRows = updateAffectedRows;
    this.transactions = [];
    this.queries = [];
    this.events = [];
    this.taskMutationCount = 0;
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
    if (sql.includes("FROM platform_pending_tasks") && sql.includes("FOR UPDATE")) {
      return [[this.taskRow].filter(Boolean)];
    }
    if (sql.includes("UPDATE tenant_resolution_cases")) {
      if (this.updateAffectedRows === 1 && this.caseRow) {
        this.caseRow.current_step_key = "task_source_repair_previewed";
        this.caseRow.last_preflight_json = params[0];
      }
      return [{ affectedRows: this.updateAffectedRows }];
    }
    if (sql.includes("INSERT INTO tenant_resolution_case_events")) {
      this.events.push({
        event_id: params[0],
        case_id: params[1],
        actor_id: params[2],
        from_status: params[3],
        to_status: params[4],
        evidence_ref: params[5],
        event: JSON.parse(params[6]),
      });
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE\s+platform_pending_tasks/i.test(sql) || /INSERT\s+INTO\s+platform_pending_tasks/i.test(sql)) {
      this.taskMutationCount += 1;
      throw new Error("task registry mutation is forbidden in preview tests");
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

const happyConnection = new FakeConnection();
const happy = await previewTenantTaskSourceRepair({
  explicitSubject: subject,
  caseId: "case_1",
  workspaceId: "workspace_1",
  input: {
    proposed_values: {
      task_key: "tenant.task-source-repair",
      title: "Repair malformed tenant task source",
      source_surface: "tenant_resolution",
      source_ref: "tenant-resolution://case/case_1",
    },
    evidence_ref: "evidence://task-source/1",
  },
  pool: new FakePool(happyConnection),
  uuid: uuidSequence([
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  ]),
  now: () => new Date("2026-07-14T01:00:00.000Z"),
});
assert.equal(happy.changed, true);
assert.equal(happy.activation_layer, "tenant_task_source_repair_preview");
assert.equal(happy.case.current_step_key, "task_source_repair_previewed");
assert.equal(happy.preview.task_registry_write_allowed, false);
assert.equal(happy.policy.repair_apply_allowed, false);
assert.equal(happyConnection.taskMutationCount, 0);
assert.equal(happyConnection.events.length, 1);
assert.equal(happyConnection.events[0].event.preview_fingerprint_sha256, happy.preview.preview_fingerprint_sha256);
assert.deepEqual(happyConnection.transactions, ["begin", "commit", "release"]);

const idempotentConnection = new FakeConnection({
  caseRow: {
    ...baseCase,
    current_step_key: "task_source_repair_previewed",
    last_preflight_json: JSON.stringify(happy.preview),
  },
});
const idempotent = await previewTenantTaskSourceRepair({
  explicitSubject: subject,
  caseId: "case_1",
  input: {
    proposed_values: {
      task_key: "tenant.task-source-repair",
      title: "Repair malformed tenant task source",
      source_surface: "tenant_resolution",
      source_ref: "tenant-resolution://case/case_1",
    },
  },
  pool: new FakePool(idempotentConnection),
  uuid: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  now: () => new Date("2026-07-14T03:00:00.000Z"),
});
assert.equal(idempotent.changed, false);
assert.equal(idempotent.idempotency.existing_preview_returned, true);
assert.equal(idempotentConnection.events.length, 0);
assert.equal(idempotentConnection.queries.some(({ sql }) => sql.includes("UPDATE tenant_resolution_cases")), false);

await assert.rejects(
  () => previewTenantTaskSourceRepair({
    explicitSubject: subject,
    caseId: "case_1",
    input: {},
    pool: new FakePool(new FakeConnection({
      caseRow: { ...baseCase, root_family: "wordpress_site_health", playbook_key: "wordpress_site_doctor_v1" },
    })),
  }),
  (error) => error.code === "TENANT_TASK_SOURCE_REPAIR_CASE_INCOMPATIBLE" && error.status === 409
);

await assert.rejects(
  () => previewTenantTaskSourceRepair({
    explicitSubject: subject,
    caseId: "case_missing",
    input: { task_key: "tenant.task-source-repair" },
    pool: new FakePool(new FakeConnection({ caseRow: null })),
  }),
  (error) => error.code === "TENANT_TASK_SOURCE_REPAIR_CASE_NOT_FOUND" && error.status === 404
);

await assert.rejects(
  () => previewTenantTaskSourceRepair({
    explicitSubject: subject,
    caseId: "case_1",
    input: {},
    pool: new FakePool(new FakeConnection({ taskRow: null })),
  }),
  (error) => error.code === "TENANT_TASK_SOURCE_REPAIR_TASK_NOT_FOUND" && error.status === 404
);

const conflictConnection = new FakeConnection({ updateAffectedRows: 0 });
await assert.rejects(
  () => previewTenantTaskSourceRepair({
    explicitSubject: subject,
    caseId: "case_1",
    input: {
      proposed_values: {
        task_key: "tenant.task-source-repair",
        title: "Repair malformed tenant task source",
        source_surface: "tenant_resolution",
        source_ref: "tenant-resolution://case/case_1",
      },
    },
    pool: new FakePool(conflictConnection),
  }),
  (error) => error.code === "TENANT_TASK_SOURCE_REPAIR_CASE_CONFLICT" && error.status === 409
);
assert.deepEqual(conflictConnection.transactions, ["begin", "rollback", "release"]);

await assert.rejects(
  () => previewTenantTaskSourceRepair({
    explicitSubject: {},
    caseId: "case_1",
    input: {},
    pool: new FakePool(new FakeConnection()),
  }),
  (error) => error.code === "TENANT_TASK_SOURCE_REPAIR_TENANT_SCOPE_REQUIRED" && error.status === 403
);

console.log("tenant task source repair preview tests passed");
