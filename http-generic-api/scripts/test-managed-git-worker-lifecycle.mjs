import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expireManagedGitWorkerLeases,
  finalizeManagedGitWorkerLifecycle,
  getManagedGitWorkerWorkspacePath,
  markManagedGitWorkerRunning,
  prepareManagedGitWorkerLifecycle,
  readManagedGitWorkerLease,
  _testingManagedGitWorkerLifecycleService,
} from "../managedGitWorkerLifecycleService.js";
import { listManagedGitEphemeralRootEntries } from "../managedGitEphemeralCheckoutExecutor.js";

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

class FakePool {
  constructor({ failReadyTransition = false } = {}) {
    this.rows = [];
    this.failReadyTransition = failReadyTransition;
  }

  async query(sql, params = []) {
    if (/SELECT run_id, owner, repo, branch_name/.test(sql)) return [[]];

    if (/INSERT INTO operation_managed_git_worker_leases/.test(sql)) {
      if (this.rows.some((row) => row.active_lease_key === params[1])) {
        const error = new Error("duplicate");
        error.code = "ER_DUP_ENTRY";
        throw error;
      }
      this.rows.push({
        worker_id: params[0],
        lease_key_sha256: params[1],
        active_lease_key: params[2],
        principal_scope: params[3],
        tenant_id: params[4],
        user_id: params[5],
        operation_key: params[6],
        owner: params[7],
        repo: params[8],
        branch_name: params[9],
        checkout_strategy: "ephemeral_checkout",
        checkout_head_sha: params[10],
        final_head_sha: null,
        workspace_fingerprint: params[11],
        worker_status: "allocated",
        lease_expires_at: params[12],
        allocated_at: new Date("2026-07-28T00:00:00Z"),
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
      if (this.failReadyTransition) {
        const error = new Error("synthetic ready transition failure");
        error.code = "ER_READY_TRANSITION_FAILED";
        throw error;
      }
      const row = this.rows.find((item) => item.worker_id === params[0]);
      if (row) {
        row.worker_status = "ready";
        row.ready_at = new Date("2026-07-28T00:00:01Z");
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }

    if (/SET worker_status = 'failed', active_lease_key = NULL, error_json = \?/.test(sql)) {
      const row = this.rows.find((item) => item.worker_id === params[1]);
      if (row) {
        row.worker_status = "failed";
        row.active_lease_key = null;
        row.error_json = params[0];
        row.released_at = new Date("2026-07-28T00:00:01Z");
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }

    if (/SET worker_status = 'running'/.test(sql)) {
      const row = this.rows.find((item) => item.worker_id === params[0]);
      if (row) {
        row.worker_status = "running";
        row.running_at = new Date("2026-07-28T00:00:02Z");
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }

    if (/SET worker_status = 'cleaning'/.test(sql)) {
      const row = this.rows.find((item) => item.worker_id === params[0]);
      if (row) {
        row.worker_status = "cleaning";
        row.cleanup_started_at = new Date("2026-07-28T00:00:03Z");
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }

    if (/SET run_id = \?, worker_status = \?/.test(sql)) {
      const row = this.rows.find((item) => item.worker_id === params[5]);
      if (row) Object.assign(row, {
        run_id: params[0],
        worker_status: params[1],
        final_head_sha: params[2],
        readback_json: params[3],
        error_json: params[4],
        released_at: new Date("2026-07-28T00:00:04Z"),
        active_lease_key: null,
      });
      return [{ affectedRows: row ? 1 : 0 }];
    }

    if (/SELECT worker_id\s+FROM operation_managed_git_worker_leases\s+WHERE lease_expires_at <= NOW\(\)/.test(sql)) {
      return [this.rows
        .filter((row) => ["allocated", "ready", "running", "cleaning"].includes(row.worker_status))
        .map((row) => ({ worker_id: row.worker_id }))];
    }

    if (/SET worker_status = 'expired', active_lease_key = NULL/.test(sql)) {
      const row = this.rows.find((item) => item.worker_id === params[2]);
      if (row) Object.assign(row, {
        worker_status: "expired",
        active_lease_key: null,
        readback_json: params[0],
        error_json: params[1],
        released_at: new Date("2026-07-28T00:00:05Z"),
      });
      return [{ affectedRows: row ? 1 : 0 }];
    }

    if (/FROM operation_managed_git_worker_leases\s+WHERE worker_id = \?/.test(sql)) {
      const [workerId, tenantId, userId] = params;
      const row = this.rows.find((item) => (
        item.worker_id === workerId
        && (tenantId === undefined || (item.tenant_id === tenantId && item.user_id === userId))
      ));
      return [[row].filter(Boolean)];
    }

    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

function dispatchHeads(...heads) {
  const queue = [...heads];
  return async (toolKey, args) => {
    assert.equal(toolKey, "runtime_endpoint_call");
    assert.equal(args.endpoint_key, "github_get_git_ref_head");
    return { status: 200, body: { object: { sha: queue.shift() || heads.at(-1) } } };
  };
}

function workerInput() {
  return {
    owner: "owner",
    repo: "repo",
    branch: "feature/safe",
    expected_head_sha: HEAD_A,
    managed_worker_ttl_minutes: 45,
  };
}

assert.equal(_testingManagedGitWorkerLifecycleService.operationRequiresWorker("repo.change.execute"), true);
assert.equal(_testingManagedGitWorkerLifecycleService.operationRequiresWorker("repo.change.preview"), false);
for (const invalid of ["../main", "feature lock", "feature~1", "a//b", "a.lock"]) {
  assert.equal(_testingManagedGitWorkerLifecycleService.validGitName(invalid, true), false);
}

const root = await mkdtemp(join(tmpdir(), "managed-git-lifecycle-t500-"));
try {
  const pool = new FakePool();
  const prepared = await prepareManagedGitWorkerLifecycle({
    pool,
    auth: { mode: "user_jwt", tenant_id: "tenant-a", user_id: "user-a" },
    input: workerInput(),
    operationKey: "repo.change.execute",
    dispatch: dispatchHeads(HEAD_A),
    workspaceRoot: root,
    now: new Date("2026-07-28T00:00:00Z"),
  });

  const workspacePath = getManagedGitWorkerWorkspacePath(prepared);
  assert.equal(prepared.checkout_strategy, "ephemeral_checkout");
  assert.equal(prepared.workspace_created, true);
  assert.equal(prepared.git_repository_initialized, true);
  assert.equal(prepared.remote_fetch_performed, false);
  assert.equal(prepared.remote_checkout_performed, false);
  assert.equal(prepared.credentials_read, false);
  assert.equal(prepared.workspace_path_exposed, false);
  assert.equal((await stat(join(workspacePath, ".git"))).isDirectory(), true);
  assert.ok(!JSON.stringify(prepared).includes(workspacePath));

  const running = await markManagedGitWorkerRunning({ pool, lifecycle: prepared });
  assert.equal(getManagedGitWorkerWorkspacePath(running), workspacePath);

  const finalized = await finalizeManagedGitWorkerLifecycle({
    pool,
    lifecycle: running,
    result: { ok: true, status: "completed", run_id: "run-1" },
    dispatch: dispatchHeads(HEAD_B),
  });
  assert.equal(finalized.status, "cleaned");
  assert.equal(finalized.workspace_released, true);
  assert.equal(finalized.cleanup_verified, true);
  assert.equal(finalized.workspace_path_exposed, false);
  await assert.rejects(() => stat(workspacePath), (error) => error?.code === "ENOENT");

  const ownRead = await readManagedGitWorkerLease(
    { worker_id: prepared.worker_id },
    { pool, auth: { mode: "user_jwt", tenant_id: "tenant-a", user_id: "user-a" } },
  );
  assert.equal(ownRead.worker.workspace_created, true);
  assert.equal(ownRead.worker.workspace_released, true);
  assert.equal(ownRead.worker.cleanup_verified, true);
  assert.equal(ownRead.worker.workspace_path_exposed, false);

  await assert.rejects(
    () => readManagedGitWorkerLease(
      { worker_id: prepared.worker_id },
      { pool, auth: { mode: "user_jwt", tenant_id: "tenant-b", user_id: "user-b" } },
    ),
    (error) => error.status === 404 && error.code === "MANAGED_GIT_WORKER_NOT_FOUND",
  );

  const createFailurePool = new FakePool();
  await assert.rejects(
    () => prepareManagedGitWorkerLifecycle({
      pool: createFailurePool,
      auth: { mode: "backend_api", is_admin: true },
      input: workerInput(),
      operationKey: "repo.change.execute",
      dispatch: dispatchHeads(HEAD_A),
      workspaceRoot: root,
      createWorkspace: async () => {
        const error = new Error("create failed");
        error.code = "SYNTHETIC_CREATE_FAILURE";
        throw error;
      },
    }),
    (error) => error.code === "SYNTHETIC_CREATE_FAILURE",
  );
  assert.equal(createFailurePool.rows[0].worker_status, "failed");
  assert.equal(createFailurePool.rows[0].active_lease_key, null);

  const readyFailurePool = new FakePool({ failReadyTransition: true });
  await assert.rejects(
    () => prepareManagedGitWorkerLifecycle({
      pool: readyFailurePool,
      auth: { mode: "backend_api", is_admin: true },
      input: workerInput(),
      operationKey: "repo.change.execute",
      dispatch: dispatchHeads(HEAD_A),
      workspaceRoot: root,
    }),
    (error) => error.code === "MANAGED_GIT_WORKER_READY_TRANSITION_FAILED"
      && error.details?.cleanup_verified === true
      && error.details?.retryable === true,
  );
  assert.equal(readyFailurePool.rows[0].worker_status, "failed");
  assert.deepEqual(await listManagedGitEphemeralRootEntries(root), []);

  const cleanupPool = new FakePool();
  const cleanupPrepared = await prepareManagedGitWorkerLifecycle({
    pool: cleanupPool,
    auth: { mode: "backend_api", is_admin: true },
    input: workerInput(),
    operationKey: "repo.change.execute",
    dispatch: dispatchHeads(HEAD_A),
    workspaceRoot: root,
  });
  const cleanupPath = getManagedGitWorkerWorkspacePath(cleanupPrepared);
  const cleanupRunning = await markManagedGitWorkerRunning({ pool: cleanupPool, lifecycle: cleanupPrepared });
  const cleanupFailed = await finalizeManagedGitWorkerLifecycle({
    pool: cleanupPool,
    lifecycle: cleanupRunning,
    result: { ok: false, status: "failed" },
    dispatch: dispatchHeads(HEAD_A),
    releaseWorkspace: async () => {
      const error = new Error("cleanup failed");
      error.code = "SYNTHETIC_CLEANUP_FAILURE";
      throw error;
    },
  });
  assert.equal(cleanupFailed.status, "failed");
  assert.equal(cleanupFailed.workspace_released, false);
  assert.equal(cleanupFailed.cleanup_verified, false);
  assert.equal((await stat(cleanupPath)).isDirectory(), true);

  const cleanupRead = await readManagedGitWorkerLease(
    { worker_id: cleanupPrepared.worker_id },
    { pool: cleanupPool, auth: { mode: "backend_api", is_admin: true } },
  );
  assert.equal(cleanupRead.worker.released_at !== null, true);
  assert.equal(cleanupRead.worker.workspace_released, false);
  assert.equal(cleanupRead.worker.cleanup_verified, false);

  const expiredPool = new FakePool();
  expiredPool.rows.push({
    worker_id: "11111111-1111-4111-8111-111111111111",
    active_lease_key: "active",
    principal_scope: "admin",
    tenant_id: null,
    user_id: null,
    operation_key: "repo.change.execute",
    owner: "owner",
    repo: "repo",
    branch_name: "main",
    checkout_strategy: "ephemeral_checkout",
    worker_status: "running",
    checkout_head_sha: HEAD_A,
    final_head_sha: null,
    workspace_fingerprint: "f".repeat(64),
    lease_expires_at: new Date("2026-07-27T00:00:00Z"),
    allocated_at: new Date("2026-07-27T00:00:00Z"),
    ready_at: null,
    running_at: null,
    cleanup_started_at: null,
    released_at: null,
    readback_json: null,
    error_json: null,
    run_id: null,
  });
  const expired = await expireManagedGitWorkerLeases({
    pool: expiredPool,
    workspaceRoot: root,
    releaseExpiredWorkspaces: async ({ worker_id }) => ({
      worker_id,
      workspace_released: true,
      cleanup_verified: true,
      cleanup_count: 1,
      workspace_path_exposed: false,
      secrets_included: false,
    }),
  });
  assert.equal(expired.ok, true);
  assert.equal(expired.expired_count, 1);
  assert.equal(expired.cleanup_failure_count, 0);

  const baseMigration = readFileSync(
    new URL("../migrations/20260715_operation_managed_git_worker_leases.sql", import.meta.url),
    "utf8",
  );
  assert.match(baseMigration, /CREATE TABLE IF NOT EXISTS operation_managed_git_worker_leases/);
  assert.doesNotMatch(baseMigration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);

  const additiveMigration = readFileSync(
    new URL("../migrations/20260728_operation_managed_git_ephemeral_checkout.sql", import.meta.url),
    "utf8",
  );
  assert.match(additiveMigration, /ENUM\('virtual_git_tree', 'ephemeral_checkout'\)/);
  assert.doesNotMatch(additiveMigration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);

  const openapi = readFileSync(new URL("../openapi/managed-git-workers.yaml", import.meta.url), "utf8");
  assert.match(openapi, /openapi: 3\.1\.0/);
  assert.match(openapi, /enum: \[virtual_git_tree, ephemeral_checkout\]/);
  assert.match(openapi, /workspace_created/);
  assert.match(openapi, /workspace_released/);
  assert.match(openapi, /cleanup_verified/);
  assert.match(openapi, /workspace_path_exposed/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("managed Git worker lifecycle tests passed");
