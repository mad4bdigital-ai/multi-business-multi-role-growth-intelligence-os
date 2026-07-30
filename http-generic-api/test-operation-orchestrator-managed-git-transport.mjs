import assert from "node:assert/strict";
import { _testingOperationOrchestrator as hooks } from "./operationOrchestrator.js";

const workerId = "11111111-1111-4111-8111-111111111111";
const binding = Object.freeze({ credential_binding_id: "binding-1" });
const fakeSession = Object.freeze({
  worker_id: workerId,
  remote_fetch_performed: true,
  remote_checkout_performed: true,
  credential_secret_exposed: false,
  persistent_credential_file_created: false,
  workspace_path_exposed: false,
  secrets_included: false,
});
const input = {
  owner: "owner",
  repo: "repo",
  branch: "feature/safe",
  expected_head_sha: "a".repeat(40),
};

const baseDeps = {
  pool: { marker: "pool" },
  auth: { marker: "auth" },
  dispatch: async () => ({ ok: true }),
};
let factoryCalls = 0;
const skipped = await hooks.prepareManagedGitTransportDependency(input, baseDeps, {
  prepareTransport: async () => {
    factoryCalls += 1;
    return fakeSession;
  },
});
assert.equal(factoryCalls, 0);
assert.equal(skipped.deps, baseDeps);
assert.equal(skipped.session, null);
assert.deepEqual(skipped.snapshot, hooks.notRequiredTransportSnapshot());

const deps = { ...baseDeps };
Object.defineProperty(deps, "managed_git_workspace", {
  value: Object.freeze({
    worker_id: workerId,
    checkout_strategy: "ephemeral_checkout",
    workspace_path: "/internal/workspace/path",
  }),
  enumerable: false,
});
Object.defineProperty(deps, "managed_git_credential_binding", {
  value: binding,
  enumerable: false,
});

let captured = null;
const prepared = await hooks.prepareManagedGitTransportDependency(input, deps, {
  now: new Date("2026-07-30T09:00:00Z"),
  prepareTransport: async (value) => {
    captured = value;
    return fakeSession;
  },
});
assert.deepEqual(captured, {
  worker_id: workerId,
  owner: "owner",
  repo: "repo",
  branch: "feature/safe",
  expected_head_sha: "a".repeat(40),
  workspace_path: "/internal/workspace/path",
  credential_binding: binding,
  now: new Date("2026-07-30T09:00:00Z"),
});
assert.equal(prepared.session, fakeSession);
assert.equal(prepared.snapshot.required, true);
assert.equal(prepared.snapshot.status, "read_failed");
assert.notEqual(prepared.deps, deps);
assert.equal(prepared.deps.pool, deps.pool);
assert.equal(prepared.deps.auth, deps.auth);
assert.equal(prepared.deps.managed_git_workspace, deps.managed_git_workspace);
assert.equal(prepared.deps.managed_git_credential_binding, binding);
assert.equal(prepared.deps.managed_git_transport.session, fakeSession);
assert.equal(typeof prepared.deps.managed_git_transport.read, "function");
assert.equal(typeof prepared.deps.managed_git_transport.commit, "function");
assert.equal(typeof prepared.deps.managed_git_transport.push, "function");
assert.equal(Object.prototype.propertyIsEnumerable.call(prepared.deps, "managed_git_transport"), false);
assert.equal(Object.keys(prepared.deps).includes("managed_git_transport"), false);
assert.equal(JSON.stringify(prepared.deps).includes("/internal/workspace/path"), false);

const direct = hooks.depsWithManagedGitTransport(baseDeps, fakeSession, {
  readTransport: () => ({ ok: true }),
  commitTransport: async () => ({ committed: true }),
  pushTransport: async () => ({ pushed: true }),
});
assert.deepEqual(direct.managed_git_transport.read(), { ok: true });
assert.deepEqual(await direct.managed_git_transport.commit(), { committed: true });
assert.deepEqual(await direct.managed_git_transport.push(), { pushed: true });

console.log("operation orchestrator managed Git transport tests passed");
