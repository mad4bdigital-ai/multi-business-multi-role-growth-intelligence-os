import assert from "node:assert/strict";
import { createResourceApiService } from "./src/application/resourceApi/resourceApiService.js";
import { createResourceRepository } from "./src/infrastructure/resourceApi/resourceRepository.js";

// frontend-surface-operation: POST /me/workspaces/{tenant_id}/resources/{resourceKey}
// frontend-surface-operation: PATCH /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}
// frontend-surface-operation: DELETE /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}
// frontend-surface-operation: POST /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}/restore

function createFakeRepository(overrides = {}) {
  const sessions = new Map([
    ["session-owned", { session_id: "session-owned", tenant_id: "tenant-1", user_id: "user-1", created_at: "2026-06-22T00:00:00Z" }],
    ["session-other", { session_id: "session-other", tenant_id: "tenant-1", user_id: "user-2", created_at: "2026-06-22T00:00:00Z" }],
  ]);
  const assets = new Map([
    ["asset-owned", { asset_id: "asset-owned", tenant_id: "tenant-1", created_by: "user-1", lifecycle_status: "active", created_at: "2026-06-22T00:00:00Z" }],
    ["asset-other", { asset_id: "asset-other", tenant_id: "tenant-1", created_by: "user-2", lifecycle_status: "active", created_at: "2026-06-22T00:00:00Z" }],
  ]);

  let repository = null;
  repository = {
    async withTransaction(operation) {
      const assetSnapshot = new Map([...assets].map(([key, value]) => [key, { ...value }]));
      try {
        return await operation(repository);
      } catch (error) {
        assets.clear();
        for (const [key, value] of assetSnapshot) assets.set(key, value);
        throw error;
      }
    },
    async findMembership(userId, tenantId) {
      if (tenantId !== "tenant-1") return null;
      return { user_id: userId, tenant_id: tenantId, role: userId === "user-owner" ? "owner" : "member", status: "active", tenant_status: "active" };
    },
    async listResource(resourceKey) {
      if (resourceKey === "sessions") return { items: [...sessions.values()], count: sessions.size, nextPageToken: null };
      if (resourceKey === "assets") return { items: [...assets.values()], count: assets.size, nextPageToken: null };
      return { items: [], count: 0, nextPageToken: null };
    },
    async getResource(resourceKey, resourceId, context = null) {
      const item = resourceKey === "sessions" ? sessions.get(resourceId) : assets.get(resourceId);
      if (!item) return null;
      if (context && item.tenant_id !== context.tenantId) return null;
      return { ...item };
    },
    async insertAsset({ tenantId, actorId, input }) {
      const id = input.asset_id || "asset-created";
      assets.set(id, {
        asset_id: id,
        tenant_id: tenantId,
        created_by: actorId,
        asset_type: input.asset_type,
        display_name: input.display_name,
        lifecycle_status: "active",
        created_at: "2026-06-22T00:00:00Z",
      });
      return id;
    },
    async updateAssetFields(assetId, input) {
      const item = assets.get(assetId);
      if (!item || Object.keys(input).length === 0) return false;
      assets.set(assetId, { ...item, ...input, updated_at: "2026-06-22T01:00:00Z" });
      return true;
    },
    async setAssetLifecycle(assetId, lifecycleStatus) {
      const item = assets.get(assetId);
      assets.set(assetId, { ...item, lifecycle_status: lifecycleStatus, updated_at: "2026-06-22T01:00:00Z" });
    },
    async listRevisions(resourceKey, resourceId) {
      if (resourceKey === "sessions" && sessions.has(resourceId)) return { supported: true, revisions: [] };
      return null;
    },
    async listChanges(resourceKey) {
      return { items: [{ resourceKey, resourceId: "r1", changeType: "snapshot" }], nextPageToken: null };
    },
    async getSessionSummary(sessionId) {
      const session = sessions.get(sessionId);
      return session ? { session: { ...session }, summary: { summary_id: "summary-1", summary_text: "done" } } : null;
    },
    async listSessionTurns(sessionId) {
      const session = sessions.get(sessionId);
      return session ? { session: { ...session }, items: [{ turn_index: 1, role: "user", content_preview: "hello" }], nextAfter: null } : null;
    },
    async listSessionEvents(sessionId) {
      const session = sessions.get(sessionId);
      return session ? { session: { ...session }, items: [] } : null;
    },
    inspectAsset(assetId) {
      const item = assets.get(assetId);
      return item ? { ...item } : null;
    },
    ...overrides,
  };
  return repository;
}

function failNextReadbackAfter(repository, mutationMethod) {
  const mutate = repository[mutationMethod].bind(repository);
  const read = repository.getResource.bind(repository);
  let failNextReadback = false;
  repository[mutationMethod] = async (...args) => {
    const result = await mutate(...args);
    failNextReadback = true;
    return result;
  };
  repository.getResource = async (...args) => {
    if (failNextReadback) {
      failNextReadback = false;
      return null;
    }
    return read(...args);
  };
  return repository;
}

const userAuth = { mode: "user_jwt", user_id: "user-1", tenant_id: "tenant-1" };
const ownerAuth = { mode: "user_jwt", user_id: "user-owner", tenant_id: "tenant-1" };
const adminAuth = { mode: "backend_api_key", is_admin: true };
let auditInput = null;
let summaryInput = null;
const service = createResourceApiService({
  repository: createFakeRepository(),
  deploymentCommitSha: "abc123",
  runCoverageAudit: async (input) => {
    auditInput = input;
    return { status: "complete", findings: [] };
  },
  summarizeSession: async (input) => {
    summaryInput = input;
    return { generated: true };
  },
});

assert.equal(service.listResourceTypes().resources.length >= 5, true);
assert.equal(service.getResourceType("sessions").resource.resource_key, "sessions");

assert.throws(
  () => service.getResourceType("unknown"),
  (error) => error.code === "resource_type_not_found" && error.status === 404
);

await assert.rejects(
  () => service.adminCreateResource("assets", { display_name: "Missing type", tenant_id: "tenant-1" }, adminAuth),
  (error) => error.code === "asset_fields_required" && error.status === 400
);

const created = await service.adminCreateResource(
  "assets",
  { asset_id: "asset-new", tenant_id: "tenant-1", asset_type: "document", display_name: "New asset" },
  adminAuth
);
assert.equal(created.id, "asset-new");
assert.equal(created.capabilities.canPurge, false);

const tenantOwned = await service.tenantGetResource("tenant-1", "assets", "asset-owned", userAuth);
assert.equal(tenantOwned.resource.capabilities.canUpdate, true);

const tenantCreated = await service.tenantCreateResource(
  "tenant-1",
  "assets",
  { asset_id: "asset-tenant-created", asset_type: "document", display_name: "Tenant asset" },
  userAuth
);
assert.equal(tenantCreated.id, "asset-tenant-created", "create must return repository readback");

const tenantUpdated = await service.tenantUpdateResource(
  "tenant-1",
  "assets",
  "asset-owned",
  { display_name: "Updated asset" },
  userAuth
);
assert.equal(tenantUpdated.data.display_name, "Updated asset", "update must return same-cycle repository readback");

const tenantArchived = await service.tenantSetResourceLifecycle("tenant-1", "assets", "asset-owned", "archived", ownerAuth);
assert.equal(tenantArchived.data.lifecycle_status, "archived", "archive must return lifecycle readback");
const tenantRestored = await service.tenantSetResourceLifecycle("tenant-1", "assets", "asset-owned", "active", ownerAuth);
assert.equal(tenantRestored.data.lifecycle_status, "active", "restore must return lifecycle readback");

const createRollbackRepository = failNextReadbackAfter(createFakeRepository(), "insertAsset");
const createRollbackService = createResourceApiService({ repository: createRollbackRepository });
await assert.rejects(
  () => createRollbackService.tenantCreateResource(
    "tenant-1",
    "assets",
    { asset_id: "asset-rollback-create", asset_type: "document", display_name: "Rollback create" },
    userAuth
  ),
  (error) => error.code === "resource_not_found"
);
assert.equal(createRollbackRepository.inspectAsset("asset-rollback-create"), null, "failed create readback must roll back insertion");

const updateRollbackRepository = failNextReadbackAfter(createFakeRepository(), "updateAssetFields");
const updateRollbackService = createResourceApiService({ repository: updateRollbackRepository });
await assert.rejects(
  () => updateRollbackService.tenantUpdateResource(
    "tenant-1",
    "assets",
    "asset-owned",
    { display_name: "Must roll back" },
    userAuth
  ),
  (error) => error.code === "resource_not_found"
);
assert.notEqual(updateRollbackRepository.inspectAsset("asset-owned").display_name, "Must roll back", "failed update readback must restore the before-state");

const archiveRollbackRepository = failNextReadbackAfter(createFakeRepository(), "setAssetLifecycle");
const archiveRollbackService = createResourceApiService({ repository: archiveRollbackRepository });
await assert.rejects(
  () => archiveRollbackService.tenantSetResourceLifecycle("tenant-1", "assets", "asset-owned", "archived", ownerAuth),
  (error) => error.code === "resource_not_found"
);
assert.equal(archiveRollbackRepository.inspectAsset("asset-owned").lifecycle_status, "active", "failed archive readback must restore active state");

const restoreRollbackRepository = createFakeRepository();
await restoreRollbackRepository.setAssetLifecycle("asset-owned", "archived");
failNextReadbackAfter(restoreRollbackRepository, "setAssetLifecycle");
const restoreRollbackService = createResourceApiService({ repository: restoreRollbackRepository });
await assert.rejects(
  () => restoreRollbackService.tenantSetResourceLifecycle("tenant-1", "assets", "asset-owned", "active", ownerAuth),
  (error) => error.code === "resource_not_found"
);
assert.equal(restoreRollbackRepository.inspectAsset("asset-owned").lifecycle_status, "archived", "failed restore readback must restore archived state");

await assert.rejects(
  () => service.tenantUpdateResource("tenant-1", "assets", "asset-other", { display_name: "blocked" }, userAuth),
  (error) => error.code === "asset_update_forbidden" && error.status === 403
);

await assert.rejects(
  () => service.tenantCatalog("tenant-2", userAuth),
  (error) => error.code === "active_membership_required" && error.status === 403
);

assert.equal((await service.getSession("session-owned", userAuth)).session_id, "session-owned");
await assert.rejects(
  () => service.getSession("session-other", userAuth),
  (error) => error.code === "forbidden" && error.status === 403
);
assert.equal((await service.getSession("session-other", adminAuth)).session_id, "session-other");

await assert.rejects(
  () => service.getSessionTranscript("session-owned", { mode: "full" }, userAuth),
  (error) => error.code === "full_transcript_adapter_required" && error.status === 409
);
const transcript = await service.getSessionTranscript("session-owned", {}, userAuth);
assert.equal(transcript.transcript[0].content_preview, "hello");
assert.equal("content" in transcript.transcript[0], false);

const audit = await service.adminCoverageAudit({ persist: false, findingLimit: 17 });
assert.equal(audit.status, "complete");
assert.deepEqual(auditInput, {
  triggerSource: "admin_api",
  commitSha: "abc123",
  persist: false,
  findingLimit: 17,
});

const generated = await service.generateSessionSummary("session-owned", { force: true }, userAuth);
assert.equal(generated.generation.generated, true);
assert.equal(generated.summary.summary_id, "summary-1");
assert.equal(summaryInput.session.session_id, "session-owned");
assert.equal(summaryInput.force, true);

function createTransactionPool() {
  const calls = [];
  let persistedAsset = null;
  const connection = {
    async beginTransaction() { calls.push("begin"); },
    async commit() { calls.push("commit"); },
    async rollback() { calls.push("rollback"); },
    release() { calls.push("release"); },
    async query(sql, params = []) {
      calls.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
      if (sql.includes("FROM workspace_assets") && sql.includes("WHERE tenant_id=? AND asset_type=? AND asset_ref=?")) {
        return [[]];
      }
      if (sql.includes("INSERT INTO workspace_assets")) {
        persistedAsset = {
          asset_id: params[0],
          tenant_id: params[1],
          asset_type: params[3],
          asset_ref: params[4],
          brand_ref: params[6],
          lifecycle_status: params[11],
          metadata_json: params[12],
          created_by: params[13],
          created_at: "2026-06-22T00:00:00Z",
        };
        return [{ affectedRows: 1 }];
      }
      if (/^SELECT\s+/i.test(sql) && sql.includes("FROM workspace_assets")) {
        return [persistedAsset ? [persistedAsset] : []];
      }
      return [{ affectedRows: 1 }];
    },
  };
  return {
    calls,
    async getConnection() {
      calls.push("getConnection");
      return connection;
    },
    async query() {
      throw new Error("transactional resource queries must use the acquired connection");
    },
  };
}

const commitPool = createTransactionPool();
const transactionalRepository = createResourceRepository({ pool: commitPool });
const transactionReadback = await transactionalRepository.withTransaction(async (activeRepository) => {
  await activeRepository.insertAsset({
    tenantId: "tenant-1",
    actorId: "user-1",
    input: { asset_id: "asset-transaction", asset_type: "document", display_name: "Transactional" },
  });
  return activeRepository.getResource("assets", "asset-transaction");
});
assert.equal(transactionReadback.asset_id, "asset-transaction");
assert.deepEqual(
  commitPool.calls.filter((entry) => ["getConnection", "begin", "commit", "rollback", "release"].includes(entry)),
  ["getConnection", "begin", "commit", "release"],
  "successful mutation and readback must commit one connection-scoped transaction"
);

const rollbackPool = createTransactionPool();
const rollbackRepository = createResourceRepository({ pool: rollbackPool });
await assert.rejects(
  () => rollbackRepository.withTransaction(async (activeRepository) => {
    await activeRepository.updateAssetFields("asset-transaction", { display_name: "Rollback" });
    throw Object.assign(new Error("readback failed"), { code: "forced_readback_failure" });
  }),
  (error) => error.code === "forced_readback_failure"
);
assert.deepEqual(
  rollbackPool.calls.filter((entry) => ["getConnection", "begin", "commit", "rollback", "release"].includes(entry)),
  ["getConnection", "begin", "rollback", "release"],
  "a failed same-cycle readback must roll back and release the transaction connection"
);

console.log("resource API application service tests passed");
