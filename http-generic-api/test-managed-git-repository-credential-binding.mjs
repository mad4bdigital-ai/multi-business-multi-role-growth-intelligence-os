import assert from "node:assert/strict";
import {
  ManagedGitRepositoryCredentialBindingError,
  createManagedGitRepositoryCredentialBinding,
  readManagedGitRepositoryCredentialBinding,
  releaseManagedGitRepositoryCredentialBinding,
  withManagedGitRepositoryCredential,
  _testingManagedGitRepositoryCredentialBinding,
} from "./managedGitRepositoryCredentialBinding.js";

const NOW = new Date("2026-07-29T02:00:00Z");
const SCOPE = Object.freeze({
  worker_id: "11111111-1111-4111-8111-111111111111",
  owner: "owner",
  repo: "repo",
});

{
  let resolverInput = null;
  const binding = await createManagedGitRepositoryCredentialBinding({
    ...SCOPE,
    pool: { marker: "pool" },
    auth: { mode: "user_jwt", tenant_id: "tenant-a", user_id: "user-a" },
    connection_id: "22222222-2222-4222-8222-222222222222",
    credential_action_key: "repository.read",
    credential_target_key: "owner.repo",
    credential_role: "repository_token",
    allow_platform_fallback: false,
    ttl_seconds: 300,
    now: NOW,
    resolve_credential: async (input) => {
      resolverInput = input;
      return {
        secret: "tenant-token-value",
        credential_source: "user_app_connection",
        owner_type: "user",
        credential_binding_id: "33333333-3333-4333-8333-333333333333",
        connection_id: input.connectionId,
      };
    },
  });

  assert.equal(resolverInput.includeSecret, true);
  assert.equal(resolverInput.allowPlatformFallback, false);
  assert.equal(resolverInput.providerFamily, "github");
  assert.equal(binding.credential_source, "user_app_connection");
  assert.equal(binding.credential_owner_type, "user");
  assert.equal(binding.ttl_seconds, 300);
  assert.equal(binding.credential_payload_read, true);
  assert.equal(binding.credential_secret_exposed, false);
  assert.equal(binding.persistent_credential_file_created, false);
  assert.equal(binding.provider_calls_performed, false);
  assert.ok(!JSON.stringify(binding).includes("tenant-token-value"));

  const first = await withManagedGitRepositoryCredential(binding, SCOPE, async (secret, evidence) => {
    assert.equal(secret.toString("utf8"), "tenant-token-value");
    assert.equal(evidence.credential_secret_exposed, false);
    secret.fill(0x78);
    return "used";
  }, { now: new Date("2026-07-29T02:01:00Z") });
  assert.equal(first, "used");

  const second = await withManagedGitRepositoryCredential(binding, SCOPE, async (secret) => secret.toString("utf8"), {
    now: new Date("2026-07-29T02:02:00Z"),
  });
  assert.equal(second, "tenant-token-value");

  await assert.rejects(
    () => withManagedGitRepositoryCredential(binding, { ...SCOPE, worker_id: "44444444-4444-4444-8444-444444444444" }, async () => null),
    (error) => error instanceof ManagedGitRepositoryCredentialBindingError && error.code === "MANAGED_GIT_CREDENTIAL_SCOPE_MISMATCH",
  );

  const snapshot = readManagedGitRepositoryCredentialBinding(binding, { now: new Date("2026-07-29T02:03:00Z") });
  assert.equal(snapshot.active, true);
  assert.equal(snapshot.expired, false);
  assert.equal(snapshot.released, false);
  assert.ok(!JSON.stringify(snapshot).includes("tenant-token-value"));

  const released = releaseManagedGitRepositoryCredentialBinding(binding);
  assert.equal(released.credential_zeroized, true);
  assert.equal(released.already_released, false);
  assert.equal(releaseManagedGitRepositoryCredentialBinding(binding).already_released, true);
  await assert.rejects(
    () => withManagedGitRepositoryCredential(binding, SCOPE, async () => null),
    (error) => error.code === "MANAGED_GIT_CREDENTIAL_BINDING_RELEASED",
  );
}

{
  let fallbackCalls = 0;
  const binding = await createManagedGitRepositoryCredentialBinding({
    ...SCOPE,
    allow_platform_fallback: true,
    ttl_seconds: 900,
    now: NOW,
    resolve_credential: async () => {
      const error = new Error("not found");
      error.code = "CREDENTIAL_BINDING_NOT_FOUND";
      throw error;
    },
    resolve_github_app_token: async ({ owner, repo }) => {
      fallbackCalls += 1;
      assert.equal(owner, "owner");
      assert.equal(repo, "repo");
      return {
        token: "github-app-token",
        installationId: "12345",
        expiresAt: "2026-07-29T02:05:00Z",
      };
    },
  });
  assert.equal(fallbackCalls, 1);
  assert.equal(binding.credential_source, "github_app_installation_token");
  assert.equal(binding.credential_owner_type, "platform");
  assert.equal(binding.installation_id, "12345");
  assert.equal(binding.ttl_seconds, 300);
  assert.equal(binding.provider_calls_performed, true);
  const value = await withManagedGitRepositoryCredential(binding, SCOPE, async (secret) => secret.toString("utf8"), {
    now: new Date("2026-07-29T02:04:00Z"),
  });
  assert.equal(value, "github-app-token");
  releaseManagedGitRepositoryCredentialBinding(binding);
}

await assert.rejects(
  () => createManagedGitRepositoryCredentialBinding({
    ...SCOPE,
    allow_platform_fallback: false,
    now: NOW,
    resolve_credential: async () => {
      const error = new Error("not found");
      error.code = "CREDENTIAL_BINDING_NOT_FOUND";
      throw error;
    },
  }),
  (error) => error.code === "CREDENTIAL_BINDING_NOT_FOUND",
);

{
  const binding = await createManagedGitRepositoryCredentialBinding({
    ...SCOPE,
    ttl_seconds: _testingManagedGitRepositoryCredentialBinding.MIN_TTL_SECONDS,
    now: NOW,
    resolve_credential: async () => ({ secret: "short-token", credential_source: "credential_binding" }),
  });
  await assert.rejects(
    () => withManagedGitRepositoryCredential(binding, SCOPE, async () => null, { now: new Date("2026-07-29T02:00:31Z") }),
    (error) => error.code === "MANAGED_GIT_CREDENTIAL_BINDING_EXPIRED" && error.status === 410,
  );
  releaseManagedGitRepositoryCredentialBinding(binding);
}

await assert.rejects(
  () => createManagedGitRepositoryCredentialBinding({
    ...SCOPE,
    ttl_seconds: _testingManagedGitRepositoryCredentialBinding.MAX_TTL_SECONDS + 1,
    resolve_credential: async () => ({ secret: "token" }),
  }),
  (error) => error.code === "MANAGED_GIT_CREDENTIAL_TTL_INVALID",
);

await assert.rejects(
  () => createManagedGitRepositoryCredentialBinding({
    ...SCOPE,
    now: NOW,
    resolve_credential: async () => ({ secret: "token", expires_at: "2026-07-29T01:59:59Z" }),
  }),
  (error) => error.code === "MANAGED_GIT_CREDENTIAL_PROVIDER_EXPIRY_INVALID",
);

console.log("managed Git repository credential binding tests passed");
