import assert from "node:assert/strict";
import { createResourceApiService } from "./src/application/resourceApi/resourceApiService.js";

function createFakeRepository(overrides = {}) {
  const sessions = new Map([
    ["session-owned", { session_id: "session-owned", tenant_id: "tenant-1", user_id: "user-1", created_at: "2026-06-22T00:00:00Z" }],
    ["session-other", { session_id: "session-other", tenant_id: "tenant-1", user_id: "user-2", created_at: "2026-06-22T00:00:00Z" }],
  ]);
  const assets = new Map([
    ["asset-owned", { asset_id: "asset-owned", tenant_id: "tenant-1", created_by: "user-1", lifecycle_status: "active", created_at: "2026-06-22T00:00:00Z" }],
    ["asset-other", { asset_id: "asset-other", tenant_id: "tenant-1", created_by: "user-2", lifecycle_status: "active", created_at: "2026-06-22T00:00:00Z" }],
  ]);

  const repository = {
    async findMembership(userId, tenantId) {
      if (tenantId !== "tenant-1") return null;
      return { user_id: userId, tenant_id: tenantId, role: "member", status: "active", tenant_status: "active" };
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
    ...overrides,
  };
  return repository;
}

const userAuth = { mode: "user_jwt", user_id: "user-1", tenant_id: "tenant-1" };
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

console.log("resource API application service tests passed");
