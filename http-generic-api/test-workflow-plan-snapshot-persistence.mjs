import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  stableSha256
} from "./src/domain/growthControlPlane/growthControlPlane.js";
import {
  createWorkflowPlanSnapshotService
} from "./src/application/growthControlPlane/workflowPlanSnapshotService.js";
import {
  createWorkflowPlanSnapshotRepository
} from "./src/infrastructure/growthControlPlane/workflowPlanSnapshotRepository.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const ACTIVITY_BINDING_ID = "33333333-3333-4333-8333-333333333333";
const CONFIG_RESOLUTION_ID = "44444444-4444-4444-8444-444444444444";
const ACTIVITY_PACK_VERSION_ID = "55555555-5555-4555-8555-555555555555";
const CONFIG_HASH = "a".repeat(64);
const MANIFEST_HASH = "b".repeat(64);
const POLICY_VERSION_HASH = "c".repeat(64);
const RESOLVED_VERSION_HASH = "d".repeat(64);
const NOW = new Date("2026-07-31T00:00:00.000Z");

const planWithoutHash = {
  contractVersion: "spec-006-workflow-compiled-plan-v1",
  compilerVersion: "spec-006-workflow-compiler-v1",
  workflowIdentity: {
    workflowKey: "travel.content.generate",
    workflowVersion: 2,
    activityPackKey: "travel.reference",
    activityPackVersion: 3,
    manifestChecksumSha256: MANIFEST_HASH
  },
  normalizedDag: {
    nodes: [],
    edges: [],
    topologicalOrder: [],
    entryNodeIds: [],
    terminalNodeIds: []
  },
  extensionComposition: { extensionPoints: [], extensions: [] },
  requiredCapabilities: [],
  candidateAdapterClasses: [],
  approvalCheckpoints: [],
  verificationCheckpoints: [],
  compensationGraph: {
    nodes: [],
    edges: [],
    topologicalOrder: [],
    entryNodeIds: [],
    terminalNodeIds: [],
    triggers: []
  },
  generation: {
    generated: false,
    validationStatus: "not_applicable",
    validationSha256: null,
    generatedBy: null
  },
  settingsSnapshotHash: CONFIG_HASH,
  immutable: true,
  providerCalls: false,
  providerDispatchAllowed: false,
  providerApplyAllowed: false,
  externalWrites: false,
  secretsIncluded: false
};
const compiledPlan = {
  ...planWithoutHash,
  canonicalHashSha256: stableSha256(planWithoutHash)
};
const compiledPolicy = {
  contractVersion: "spec-011-compiled-policy-snapshot-v1",
  decisions: [{
    policyKey: "content.internal.only",
    outcome: "allow_internal_draft"
  }]
};

let configSnapshot = {
  resolution_id: CONFIG_RESOLUTION_ID,
  resolved_sha256: CONFIG_HASH,
  secrets_included: 0
};
const policyRows = new Map();
const planRows = new Map();
const transactionEvents = [];
const statements = [];
let tamperReadback = false;
let insertCount = 0;

function joinedRow(plan) {
  if (!plan) return null;
  const policy = policyRows.get(plan.policy_snapshot_id);
  if (!policy) return null;
  const row = {
    ...plan,
    policy_versions_json: policy.policy_versions_json,
    policy_snapshot_json: policy.policy_snapshot_json
  };
  if (tamperReadback) return { ...row, bundle_hash_sha256: "f".repeat(64) };
  return row;
}

async function execute(statement, params = []) {
  statements.push({ statement, params });
  if (statement.includes("WHERE p.idempotency_key=?")) {
    const found = [...planRows.values()].find((row) => row.idempotency_key === params[0]);
    return [found ? [joinedRow(found)] : []];
  }
  if (statement.includes("FROM growth_control_config_resolution_snapshots")) {
    return [configSnapshot && configSnapshot.resolution_id === params[0] ? [{ ...configSnapshot }] : []];
  }
  if (statement.includes("INSERT INTO growth_control_compiled_policy_snapshots")) {
    insertCount += 1;
    policyRows.set(params[0], {
      policy_snapshot_id: params[0],
      tenant_id: params[1],
      workspace_id: params[2],
      brand_key: params[3],
      activity_binding_id: params[4],
      workflow_key: params[5],
      workflow_version: params[6],
      policy_versions_json: params[7],
      policy_snapshot_json: params[8],
      policy_hash_sha256: params[9],
      version_set_hash_sha256: params[10],
      idempotency_key: params[11],
      created_by: params[12],
      created_at: NOW,
      provider_calls: 0,
      provider_dispatch_allowed: 0,
      provider_apply_allowed: 0,
      external_writes: 0,
      secrets_included: 0
    });
    return [{ affectedRows: 1 }];
  }
  if (statement.includes("INSERT INTO growth_control_compiled_plan_snapshots")) {
    insertCount += 1;
    planRows.set(params[0], {
      plan_snapshot_id: params[0],
      policy_snapshot_id: params[1],
      config_resolution_id: params[2],
      tenant_id: params[3],
      workspace_id: params[4],
      brand_key: params[5],
      activity_binding_id: params[6],
      activity_pack_version_id: params[7],
      workflow_key: params[8],
      workflow_version: params[9],
      resolved_versions_json: params[10],
      plan_snapshot_json: params[11],
      config_hash_sha256: params[12],
      policy_hash_sha256: params[13],
      plan_hash_sha256: params[14],
      version_set_hash_sha256: params[15],
      bundle_hash_sha256: params[16],
      idempotency_key: params[17],
      created_by: params[18],
      created_at: NOW,
      immutable: 1,
      provider_calls: 0,
      provider_dispatch_allowed: 0,
      provider_apply_allowed: 0,
      external_writes: 0,
      secrets_included: 0
    });
    return [{ affectedRows: 1 }];
  }
  if (statement.includes("WHERE p.plan_snapshot_id=?")) {
    return [[joinedRow(planRows.get(params[0]))].filter(Boolean)];
  }
  throw new Error(`Unexpected SQL in workflow plan snapshot persistence test: ${statement}`);
}

const connection = {
  execute,
  async beginTransaction() { transactionEvents.push("begin"); },
  async commit() { transactionEvents.push("commit"); },
  async rollback() { transactionEvents.push("rollback"); },
  release() { transactionEvents.push("release"); }
};
const pool = {
  async getConnection() { return connection; }
};
const repository = createWorkflowPlanSnapshotRepository({
  resolvePool: async () => pool
});
const uuids = [
  "66666666-6666-4666-8666-666666666666",
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
  "99999999-9999-4999-8999-999999999999",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
];
const service = createWorkflowPlanSnapshotService({
  repository,
  uuid: () => uuids.shift()
});

function request(idempotencyKey = "t403-success") {
  return {
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    brandKey: "example.brand",
    activityBindingId: ACTIVITY_BINDING_ID,
    activityPackVersionId: ACTIVITY_PACK_VERSION_ID,
    configResolutionId: CONFIG_RESOLUTION_ID,
    configHashSha256: CONFIG_HASH,
    compiledPlan,
    compiledPolicy,
    policyVersionReferences: [{
      authorityType: "policy",
      authorityKey: "content.internal.only",
      versionRef: "7",
      hashSha256: POLICY_VERSION_HASH
    }],
    resolvedVersionReferences: [{
      authorityType: "capability",
      authorityKey: "content.generate",
      versionRef: "12",
      hashSha256: RESOLVED_VERSION_HASH
    }],
    idempotencyKey
  };
}

const result = await service.persistWorkflowPlanSnapshot(request(), { actorId: "admin-user" });
assert.equal(result.replayed, false);
assert.equal(result.immutable, true);
assert.equal(result.providerCalls, false);
assert.equal(result.providerDispatchAllowed, false);
assert.equal(result.providerApplyAllowed, false);
assert.equal(result.externalWrites, false);
assert.equal(result.secretsIncluded, false);
assert.equal(result.configHashSha256, CONFIG_HASH);
assert.equal(result.planHashSha256, compiledPlan.canonicalHashSha256);
assert.match(result.policyHashSha256, /^[a-f0-9]{64}$/);
assert.match(result.versionSetHashSha256, /^[a-f0-9]{64}$/);
assert.match(result.bundleHashSha256, /^[a-f0-9]{64}$/);
assert.deepEqual(transactionEvents.slice(0, 3), ["begin", "commit", "release"]);
assert.equal(insertCount, 2);
assert(statements.some(({ statement }) => statement.includes("LIMIT 1 FOR UPDATE")));
assert(statements.some(({ statement }) => statement.includes("growth_control_config_resolution_snapshots")));
assert(statements.some(({ statement }) => statement.includes("growth_control_compiled_policy_snapshots")));
assert(statements.some(({ statement }) => statement.includes("growth_control_compiled_plan_snapshots")));

const replay = await service.persistWorkflowPlanSnapshot(request(), { actorId: "different-actor" });
assert.equal(replay.replayed, true);
assert.equal(replay.planSnapshotId, result.planSnapshotId);
assert.equal(replay.policySnapshotId, result.policySnapshotId);
assert.equal(replay.bundleHashSha256, result.bundleHashSha256);
assert.equal(insertCount, 2, "Idempotent replay must not append duplicate rows");

await assert.rejects(
  () => service.persistWorkflowPlanSnapshot({
    ...request("t403-plan-tamper"),
    compiledPlan: {
      ...compiledPlan,
      canonicalHashSha256: "e".repeat(64)
    }
  }),
  (error) => error?.code === "GROWTH_CONTROL_PLAN_SNAPSHOT_PLAN_HASH_MISMATCH"
);

await assert.rejects(
  () => service.persistWorkflowPlanSnapshot({
    ...request("t403-sensitive"),
    compiledPolicy: {
      ...compiledPolicy,
      prompt_body: "must-never-persist"
    }
  }),
  (error) => error?.code === "GROWTH_CONTROL_PLAN_SNAPSHOT_SENSITIVE"
);

const rollbackBeforeConfigMismatch = transactionEvents.filter((event) => event === "rollback").length;
configSnapshot = { ...configSnapshot, resolved_sha256: "0".repeat(64) };
await assert.rejects(
  () => service.persistWorkflowPlanSnapshot(request("t403-config-mismatch")),
  (error) => error?.code === "GROWTH_CONTROL_CONFIG_SNAPSHOT_HASH_MISMATCH"
);
assert.equal(
  transactionEvents.filter((event) => event === "rollback").length,
  rollbackBeforeConfigMismatch + 1
);
configSnapshot = { ...configSnapshot, resolved_sha256: CONFIG_HASH };

const rollbackBeforeReadbackMismatch = transactionEvents.filter((event) => event === "rollback").length;
tamperReadback = true;
await assert.rejects(
  () => service.persistWorkflowPlanSnapshot(request("t403-readback-mismatch")),
  (error) => error?.code === "GROWTH_CONTROL_PLAN_SNAPSHOT_READBACK_MISMATCH"
);
assert.equal(
  transactionEvents.filter((event) => event === "rollback").length,
  rollbackBeforeReadbackMismatch + 1
);
tamperReadback = false;

const originalConfig = configSnapshot;
configSnapshot = null;
await assert.rejects(
  () => service.persistWorkflowPlanSnapshot(request("t403-config-missing")),
  (error) => error?.code === "GROWTH_CONTROL_CONFIG_SNAPSHOT_NOT_FOUND"
);
configSnapshot = originalConfig;

const migration = readFileSync(
  "migrations/20260731_growth_control_plan_snapshot_persistence.sql",
  "utf8"
);
assert(migration.includes("growth_control_compiled_policy_snapshots"));
assert(migration.includes("growth_control_compiled_plan_snapshots"));
assert(migration.includes("UNIQUE KEY `uq_gc_policy_snapshot_idempotency`"));
assert(migration.includes("UNIQUE KEY `uq_gc_plan_snapshot_idempotency`"));
assert(migration.includes("FOREIGN KEY (`config_resolution_id`)"));
assert(migration.includes("CHECK (`immutable` = 1)"));
assert(migration.includes("provider_dispatch_allowed"));
assert(migration.includes("provider_apply_allowed"));
assert(migration.includes("external_writes"));
assert(migration.includes("secrets_included"));
assert.equal(/\bDROP\s+(TABLE|VIEW)\b/i.test(migration), false);
assert.equal(/\bALTER\s+TABLE\b/i.test(migration), false);
assert.equal(/UPDATE\s+growth_control_compiled_(policy|plan)_snapshots/i.test(migration), false);
assert.equal(/DELETE\s+FROM\s+growth_control_compiled_(policy|plan)_snapshots/i.test(migration), false);

const repositorySource = readFileSync(
  "src/infrastructure/growthControlPlane/workflowPlanSnapshotRepository.js",
  "utf8"
);
assert(repositorySource.includes("beginTransaction"));
assert(repositorySource.includes("rollback"));
assert(repositorySource.includes("FOR UPDATE"));
assert.equal(/\bUPDATE\s+growth_control_compiled_/i.test(repositorySource), false);
assert.equal(/\bDELETE\s+FROM\s+growth_control_compiled_/i.test(repositorySource), false);

const serviceSource = readFileSync(
  "src/application/growthControlPlane/workflowPlanSnapshotService.js",
  "utf8"
);
assert(serviceSource.includes("stableSha256"));
assert(serviceSource.includes("versionSetHashSha256"));
assert(serviceSource.includes("bundleHashSha256"));
assert(serviceSource.includes("providerDispatchAllowed: false"));
assert(serviceSource.includes("providerApplyAllowed: false"));

console.log("workflow plan snapshot persistence tests passed");
