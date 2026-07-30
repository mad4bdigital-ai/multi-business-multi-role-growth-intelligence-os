import assert from "node:assert/strict";
import { _testingOperationOrchestratorRoutes as hooks } from "./routes/operationOrchestratorRoutes.js";

const lifecycle = {
  required: true,
  worker_id: "11111111-1111-4111-8111-111111111111",
  checkout_head_sha: "a".repeat(40),
  input: {
    owner: "owner",
    repo: "repo",
    branch: "feature/safe",
    expected_head_sha: "a".repeat(40),
  },
};
const binding = Object.freeze({ credential_binding_id: "binding-1" });
const fakeSession = Object.freeze({
  worker_id: lifecycle.worker_id,
  remote_fetch_performed: true,
  remote_checkout_performed: true,
  credential_secret_exposed: false,
  persistent_credential_file_created: false,
  workspace_path_exposed: false,
  secrets_included: false,
});

assert.equal(await hooks.prepareRemoteTransportForWorker({
  lifecycle: { required: false },
  credentialBinding: binding,
  prepareTransport: async () => assert.fail("transport factory must not run"),
}), null);
assert.equal(await hooks.prepareRemoteTransportForWorker({
  lifecycle,
  credentialBinding: null,
  prepareTransport: async () => assert.fail("transport factory must not run"),
}), null);

let captured = null;
const prepared = await hooks.prepareRemoteTransportForWorker({
  lifecycle,
  credentialBinding: binding,
  resolveWorkspacePath: () => "/internal/workspace/path",
  prepareTransport: async (input) => {
    captured = input;
    return fakeSession;
  },
});
assert.equal(prepared, fakeSession);
assert.deepEqual(captured, {
  worker_id: lifecycle.worker_id,
  owner: "owner",
  repo: "repo",
  branch: "feature/safe",
  expected_head_sha: "a".repeat(40),
  workspace_path: "/internal/workspace/path",
  credential_binding: binding,
  now: captured.now,
});
assert.ok(captured.now instanceof Date);

const deps = {
  pool: { marker: "pool" },
  auth: { marker: "auth" },
  dispatch: async () => ({ ok: true }),
};
const executionDeps = hooks.depsWithManagedGitTransport(deps, fakeSession);
assert.notEqual(executionDeps, deps);
assert.equal(executionDeps.pool, deps.pool);
assert.equal(executionDeps.auth, deps.auth);
assert.equal(executionDeps.managed_git_transport.session, fakeSession);
assert.equal(typeof executionDeps.managed_git_transport.read, "function");
assert.equal(typeof executionDeps.managed_git_transport.commit, "function");
assert.equal(typeof executionDeps.managed_git_transport.push, "function");
assert.equal(Object.prototype.propertyIsEnumerable.call(executionDeps, "managed_git_transport"), false);
assert.equal(Object.keys(executionDeps).includes("managed_git_transport"), false);
assert.equal(JSON.stringify(executionDeps).includes("/internal/workspace/path"), false);

assert.deepEqual(hooks.safeRemoteTransportSnapshot(null), {
  required: false,
  status: "not_required",
  remote_fetch_performed: false,
  remote_checkout_performed: false,
  remote_commit_performed: false,
  remote_push_performed: false,
  credential_secret_exposed: false,
  persistent_credential_file_created: false,
  workspace_path_exposed: false,
  secrets_included: false,
});

console.log("operation orchestrator managed Git transport tests passed");
