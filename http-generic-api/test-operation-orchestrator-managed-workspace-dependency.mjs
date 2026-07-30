import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getManagedGitWorkerWorkspacePath,
  prepareManagedGitWorkerLifecycle,
} from "./managedGitWorkerLifecycleService.js";
import { _testingOperationOrchestratorRoutes } from "./routes/operationOrchestratorRoutes.js";

const HEAD = "a".repeat(40);

class PrepareOnlyPool {
  async query(sql) {
    if (/SELECT run_id, owner, repo, branch_name/.test(sql)) return [[]];
    if (/INSERT INTO operation_managed_git_worker_leases/.test(sql)) return [{ affectedRows: 1 }];
    if (/SET worker_status = 'ready'/.test(sql)) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

const root = await mkdtemp(join(tmpdir(), "managed-workspace-route-t500-"));
try {
  const lifecycle = await prepareManagedGitWorkerLifecycle({
    pool: new PrepareOnlyPool(),
    auth: { mode: "backend_api", is_admin: true },
    input: {
      owner: "owner",
      repo: "repo",
      branch: "feature/safe",
      expected_head_sha: HEAD,
    },
    operationKey: "repo.change.execute",
    dispatch: async (toolKey, args) => {
      assert.equal(toolKey, "runtime_endpoint_call");
      assert.equal(args.endpoint_key, "github_get_git_ref_head");
      return { status: 200, body: { object: { sha: HEAD } } };
    },
    workspaceRoot: root,
    now: new Date("2026-07-28T00:00:00Z"),
  });

  const baseDeps = {
    pool: { marker: "pool" },
    auth: { marker: "auth" },
    dispatch: async () => ({ ok: true }),
  };
  const executionDeps = _testingOperationOrchestratorRoutes.depsWithManagedGitWorkspace(baseDeps, lifecycle);
  const workspacePath = getManagedGitWorkerWorkspacePath(lifecycle);

  assert.notEqual(executionDeps, baseDeps);
  assert.equal(executionDeps.pool, baseDeps.pool);
  assert.equal(executionDeps.auth, baseDeps.auth);
  assert.equal(executionDeps.dispatch, baseDeps.dispatch);
  assert.equal(executionDeps.managed_git_workspace.worker_id, lifecycle.worker_id);
  assert.equal(executionDeps.managed_git_workspace.checkout_strategy, "ephemeral_checkout");
  assert.equal(executionDeps.managed_git_workspace.workspace_path, workspacePath);
  assert.equal(Object.prototype.propertyIsEnumerable.call(executionDeps, "managed_git_workspace"), false);
  assert.equal(Object.keys(executionDeps).includes("managed_git_workspace"), false);
  assert.ok(!JSON.stringify(executionDeps).includes(workspacePath));
  assert.equal("managed_git_workspace" in lifecycle.input, false);
  assert.ok(!JSON.stringify(lifecycle.input).includes(workspacePath));
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("operation orchestrator managed workspace dependency tests passed");
