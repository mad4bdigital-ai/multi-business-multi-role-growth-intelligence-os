import assert from "node:assert/strict";
import {
  assertOperationRunAccess,
  extractOperationRunId,
  recordOperationRunOwnership,
  _testingOperationRunOwnershipService,
} from "../operationRunOwnershipService.js";

assert.equal(extractOperationRunId({ run_id: "run-1" }), "run-1");
assert.equal(extractOperationRunId({ run: { run_id: "run-2" } }), "run-2");
assert.equal(_testingOperationRunOwnershipService.principalClass({ mode: "backend_api", is_admin: true }), "admin");
assert.equal(_testingOperationRunOwnershipService.principalClass({ mode: "user_jwt", user_id: "u", tenant_id: "t" }), "tenant");

const ownershipRows = new Map();
const pool = {
  async query(sql, params) {
    if (sql.includes("INSERT INTO operation_run_ownership")) {
      const [runId, tenantId, workspaceId, userId, resourceUri, operationKey] = params;
      if (!ownershipRows.has(runId)) {
        ownershipRows.set(runId, {
          run_id: runId,
          tenant_id: tenantId,
          workspace_id: workspaceId,
          user_id: userId,
          resource_uri: resourceUri,
          operation_key: operationKey,
        });
      }
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM operation_run_ownership")) {
      const [runId, tenantId, userId] = params;
      const row = ownershipRows.get(runId);
      if (!row) return [[]];
      if (tenantId && (row.tenant_id !== tenantId || row.user_id !== userId)) return [[]];
      return [[row]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
};

const tenantAuth = { mode: "user_jwt", tenant_id: "tenant-a", user_id: "user-a" };
const recorded = await recordOperationRunOwnership({
  pool,
  auth: tenantAuth,
  input: { owner: "mad4bdigital-ai", repo: "repo", workspace_id: "workspace-a" },
  result: { run_id: "run-a" },
  operationKey: "repo.change.execute",
});
assert.equal(recorded.recorded, true);
assert.equal(recorded.resource_uri, "github://mad4bdigital-ai/repo");

const allowed = await assertOperationRunAccess({ pool, auth: tenantAuth, runId: "run-a" });
assert.equal(allowed.allowed, true);
assert.equal(allowed.ownership.tenant_id, "tenant-a");

await assert.rejects(
  () => assertOperationRunAccess({
    pool,
    auth: { mode: "user_jwt", tenant_id: "tenant-b", user_id: "user-b" },
    runId: "run-a",
  }),
  (error) => error.code === "OPERATION_RUN_ACCESS_DENIED" && error.status === 403,
);

const adminAllowed = await assertOperationRunAccess({
  pool,
  auth: { mode: "backend_api", is_admin: true },
  runId: "legacy-run",
});
assert.equal(adminAllowed.allowed, true);

console.log("operation run ownership tests passed");
