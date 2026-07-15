import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  finalizeManagedGitWorkerLifecycle,
  markManagedGitWorkerRunning,
  prepareManagedGitWorkerLifecycle,
  readManagedGitWorkerLease,
  _testingManagedGitWorkerLifecycleService,
} from "../managedGitWorkerLifecycleService.js";

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

class FakePool {
  constructor() { this.rows = []; }
  async query(sql, params = []) {
    if (/SELECT run_id, owner, repo, branch_name/.test(sql)) return [[]];
    if (/INSERT INTO operation_managed_git_worker_leases/.test(sql)) {
      if (this.rows.some((row) => row.active_lease_key === params[1])) {
        const error = new Error("duplicate"); error.code = "ER_DUP_ENTRY"; throw error;
      }
      this.rows.push({
        worker_id: params[0],
        lease_key_sha256: params[1],
        active_lease_key: params[1],
        principal_scope: params[2],
        tenant_id: params[3],
        user_id: params[4],
        operation_key: params[5],
        owner: params[6],
        repo: params[7],
        branch_name: params[8],
        checkout_strategy: "virtual_git_tree",
        checkout_head_sha: params[9],
        final_head_sha: null,
        workspace_fingerprint: params[10],
        worker_status: "allocated",
        lease_expires_at: params[11],
        allocated_at: new Date("2026-07-15T00:00:00Z"),
        ready_at: null,
        running_at: null,
        cleanup_started_at: null,
        released_at: null,
        readback_json: null,
        error_json: null,
        run_id: null,
      });
      return [{ affectedRows: 1 }];
    }
    if (/WHERE active_lease_key = \?/.test(sql)) {
      return [[this.rows.find((row) => row.active_lease_key === params[0])].filter(Boolean)];
    }
    if (/SET worker_status = 'ready'/.test(sql)) {
      const row = this.rows.find((item) => item.worker_id === params[0]);
      if (row) { row.worker_status = "ready"; row.ready_at = new Date("2026-07-15T00:00:01Z"); }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (/SET worker_status = 'running'/.test(sql)) {
      const row = this.rows.find((item) => item.worker_id === params[0]);
      if (row) { row.worker_status = "running"; row.running_at = new Date("2026-07-15T00:00:02Z"); }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (/SET worker_status = 'cleaning'/.test(sql)) {
      const row = this.rows.find((item) => item.worker_id === params[0]);
      if (row) { row.worker_status = "cleaning"; row.cleanup_started_at = new Date("2026-07-15T00:00:03Z"); }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (/SET run_id = \?, worker_status = \?/.test(sql)) {
      const row = this.rows.find((item) => item.worker_id === params[5]);
      if (row) Object.assign(row, {
        run_id: params[0], worker_status: params[1], final_head_sha: params[2],
        readback_json: params[3], error_json: params[4],
        released_at: new Date("2026-07-15T00:00:04Z"), active_lease_key: null,
      });
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (/FROM operation_managed_git_worker_leases\s+WHERE worker_id = \?/.test(sql)) {
      const [workerId, tenantId, userId] = params;
      const row = this.rows.find((item) =>
        item.worker_id === workerId &&
        (tenantId === undefined || (item.tenant_id === tenantId && item.user_id === userId))
      );
      return [[row].filter(Boolean)];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

const dispatchHeads = (...heads) => {
  const queue = [...heads];
  return async (toolKey, args) => {
    assert.equal(toolKey, "runtime_endpoint_call");
    assert.equal(args.endpoint_key, "github_get_git_ref_head");
    return { status: 200, body: { object: { sha: queue.shift() || heads.at(-1) } } };
  };
};

assert.equal(
  _testingManagedGitWorkerLifecycleService.operationRequiresWorker("repo.change.execute"),
  true,
);
assert.equal(
  _testingManagedGitWorkerLifecycleService.operationRequiresWorker("repo.change.preview"),
  false,
);
for (const invalid of ["../main", "feature lock", "feature~1", "a//b", "a.lock"]) {
  assert.equal(_testingManagedGitWorkerLifecycleService.validGitName(invalid, true), false);
}

const pool = new FakePool();
const prepared = await prepareManagedGitWorkerLifecycle({
  pool,
  auth: { mode: "user_jwt", tenant_id: "tenant-a", user_id: "user-a" },
  input: {
    owner: "owner", repo: "repo", branch: "feature/safe",
    expected_head_sha: HEAD_A, managed_worker_ttl_minutes: 45,
  },
  operationKey: "repo.change.execute",
  dispatch: dispatchHeads(HEAD_A),
  now: new Date("2026-07-15T00:00:00Z"),
});
assert.equal(prepared.status, "ready");
assert.equal(prepared.checkout_head_sha, HEAD_A);
assert.equal(prepared.input.managed_worker_id, prepared.worker_id);
assert.equal(pool.rows[0].principal_scope, "tenant");

const running = await markManagedGitWorkerRunning({ pool, lifecycle: prepared });
assert.equal(running.status, "running");

const finalized = await finalizeManagedGitWorkerLifecycle({
  pool,
  lifecycle: running,
  result: { ok: true, status: "completed", run_id: "run-1" },
  dispatch: dispatchHeads(HEAD_B),
});
assert.equal(finalized.status, "cleaned");
assert.equal(finalized.workspace_released, true);
assert.equal(finalized.readback.head_changed, true);
assert.equal(pool.rows[0].active_lease_key, null);

const ownRead = await readManagedGitWorkerLease(
  { worker_id: prepared.worker_id },
  { pool, auth: { mode: "user_jwt", tenant_id: "tenant-a", user_id: "user-a" } },
);
assert.equal(ownRead.worker.workspace_released, true);

await assert.rejects(
  () => readManagedGitWorkerLease(
    { worker_id: prepared.worker_id },
    { pool, auth: { mode: "user_jwt", tenant_id: "tenant-b", user_id: "user-b" } },
  ),
  (error) => error.status === 404 && error.code === "MANAGED_GIT_WORKER_NOT_FOUND",
);

await assert.rejects(
  () => prepareManagedGitWorkerLifecycle({
    pool: new FakePool(),
    auth: { mode: "backend_api", is_admin: true },
    input: { owner: "owner", repo: "repo", branch: "main", expected_head_sha: HEAD_A },
    operationKey: "repo.change.execute",
    dispatch: dispatchHeads(HEAD_B),
  }),
  (error) => error.status === 409 && error.code === "MANAGED_GIT_WORKER_HEAD_MISMATCH",
);

const migration = readFileSync(
  new URL("../migrations/20260715_operation_managed_git_worker_leases.sql", import.meta.url),
  "utf8",
);
assert.match(migration, /CREATE TABLE IF NOT EXISTS operation_managed_git_worker_leases/);
assert.match(migration, /UNIQUE KEY uq_operation_managed_git_worker_active_lease/);
assert.match(migration, /CHECK \(secrets_included = 0\)/);
assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);

const openapi = readFileSync(
  new URL("../openapi/managed-git-workers.yaml", import.meta.url),
  "utf8",
);
assert.match(openapi, /openapi: 3\.1\.0/);
assert.match(openapi, /\/admin\/operations\/workers\/\{worker_id\}:/);
assert.match(openapi, /\/tenant\/operations\/workers\/\{worker_id\}:/);
assert.match(openapi, /workspace_released/);
assert.match(openapi, /secrets_included/);

console.log("managed Git worker lifecycle tests passed");
