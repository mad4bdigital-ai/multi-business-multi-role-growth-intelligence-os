import assert from "node:assert/strict";
import { createManagedGitRepositoryCredentialBinding } from "./managedGitRepositoryCredentialBinding.js";
import { _testingOperationOrchestratorRoutes as hooks } from "./routes/operationOrchestratorRoutes.js";

const now = new Date("2026-07-29T11:00:00Z");
const lifecycle = {
  required: true,
  worker_id: "11111111-1111-4111-8111-111111111111",
  lease_expires_at: "2026-07-29T11:10:00Z",
};
const input = {
  owner: "owner",
  repo: "repo",
  connection_id: "22222222-2222-4222-8222-222222222222",
};
const deps = {
  pool: {},
  auth: { mode: "user_jwt", tenant_id: "tenant-a", user_id: "user-a" },
};

assert.equal(
  await hooks.prepareCredentialBindingForWorker({
    deps,
    lifecycle,
    input: { owner: input.owner, repo: input.repo },
    now,
    createCredentialBinding: async () => assert.fail("factory must not run"),
  }),
  null,
);

let captured = null;
const binding = await hooks.prepareCredentialBindingForWorker({
  deps,
  lifecycle,
  input,
  now,
  createCredentialBinding: async (value) => {
    captured = value;
    return createManagedGitRepositoryCredentialBinding({
      ...value,
      resolve_credential: async (request) => {
        assert.equal(request.includeSecret, true);
        assert.equal(request.allowPlatformFallback, false);
        return {
          secret: "route-scoped-secret",
          credential_source: "user_app_connection",
          owner_type: "user",
          connection_id: input.connection_id,
        };
      },
    });
  },
});

assert.equal(captured.connection_id, input.connection_id);
assert.equal(captured.allow_platform_fallback, false);
assert.equal(captured.ttl_seconds, 600);
assert.ok(!JSON.stringify(binding).includes("route-scoped-secret"));

const executionDeps = hooks.depsWithManagedGitCredential(deps, binding);
assert.equal(executionDeps.managed_git_credential_binding, binding);
assert.equal(Object.prototype.propertyIsEnumerable.call(executionDeps, "managed_git_credential_binding"), false);
assert.ok(!JSON.stringify(executionDeps).includes("route-scoped-secret"));

const released = hooks.finalizeCredentialSafely(binding);
assert.equal(released.status, "released");
assert.equal(released.credential_zeroized, true);
assert.equal(released.credential_secret_exposed, false);
assert.ok(!JSON.stringify(released).includes("route-scoped-secret"));
assert.equal(hooks.finalizeCredentialSafely(null).status, "not_required");
assert.equal(hooks.finalizeCredentialSafely({ credential_binding_id: "forged" }).status, "release_failed");

await assert.rejects(
  () => hooks.prepareCredentialBindingForWorker({
    deps,
    lifecycle: { ...lifecycle, lease_expires_at: "2026-07-29T11:00:29Z" },
    input,
    now,
    createCredentialBinding: async () => ({ unexpected: true }),
  }),
  (error) => error.code === "MANAGED_GIT_CREDENTIAL_LEASE_TOO_SHORT"
    && error.status === 409
    && error.details?.credential_secret_exposed === false,
);

console.log("operation orchestrator repository credential tests passed");
