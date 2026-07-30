import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDelegationGrantMariaDbRuntimeBinding,
  _testingDelegationGrantMariaDbRuntimeBinding,
} from "./delegationGrantMariaDbRuntimeBinding.js";
import {
  planDelegationGrantCreateShadow,
  _testingDelegationGrantLifecycleShadow,
} from "./delegationGrantLifecycleShadowService.js";

const HASH = "a".repeat(64);
const TENANT_ID = randomUUID();

function fakePool() {
  return {
    async query() { return [[]]; },
    async getConnection() { throw new Error("not used"); },
  };
}

function plan(action = "create") {
  return {
    action,
    command_preview: { action },
    request_fingerprint: "b".repeat(64),
  };
}

function verifiedReadiness(overrides = {}) {
  return {
    status: "verified_applied",
    migration_applied: true,
    readback_complete: true,
    checksum_pin_match: true,
    migration_checksum_sha256: HASH,
    statement_count: 2,
    schema_readback_fingerprint: "c".repeat(64),
    blockers: [],
    ...overrides,
  };
}

{
  const env = {};
  const binding = createDelegationGrantMariaDbRuntimeBinding({
    pool: fakePool(),
    env,
    readinessCollector: async () => verifiedReadiness(),
    repositoryFactory: () => ({ marker: true }),
    mutationExecutor: async () => ({ ok: true }),
  });
  assert.equal(binding.status().runtime_enabled, false);
  await assert.rejects(
    binding.execute({ plan: plan(), tenantId: TENANT_ID, authorization: {} }),
    (error) => error.code === "DELEGATION_MARIADB_RUNTIME_DISABLED",
  );
}

{
  const env = {
    DELEGATION_GRANT_MARIADB_RUNTIME_ENABLED: "true",
    DELEGATION_GRANT_MARIADB_RUNTIME_CERTIFIED: "true",
    DELEGATION_GRANT_MARIADB_RUNTIME_ALLOWED_ACTIONS: "create,revoke,expire",
    DELEGATION_GRANT_MARIADB_EXPECTED_MIGRATION_SHA256: HASH,
    DELEGATION_GRANT_MARIADB_READINESS_TTL_MS: "0",
  };
  let repositorySeen = null;
  let executorInput = null;
  const binding = createDelegationGrantMariaDbRuntimeBinding({
    pool: fakePool(),
    env,
    readinessCollector: async ({ expectedMigrationChecksum }) => {
      assert.equal(expectedMigrationChecksum, HASH);
      return verifiedReadiness();
    },
    repositoryFactory: ({ pool }) => {
      repositorySeen = pool;
      return { repository: true };
    },
    mutationExecutor: async (input) => {
      executorInput = input;
      return { ok: true, decision: "verified_success", mutation_applied: true };
    },
  });
  const result = await binding.execute({
    plan: plan("create"),
    tenantId: TENANT_ID,
    authorization: { approved: true },
    now: "2026-07-30T07:20:00.000Z",
  });
  assert.ok(repositorySeen);
  assert.equal(executorInput.schemaReadiness.status, "verified_applied");
  assert.equal(result.runtime_binding_enabled, true);
  assert.equal(result.runtime_policy_ready_promoted, false);
  assert.equal(result.public_route_added, false);
}

{
  const env = {
    DELEGATION_GRANT_MARIADB_RUNTIME_ENABLED: "1",
    DELEGATION_GRANT_MARIADB_RUNTIME_CERTIFIED: "1",
    DELEGATION_GRANT_MARIADB_RUNTIME_ALLOWED_ACTIONS: "create",
    DELEGATION_GRANT_MARIADB_EXPECTED_MIGRATION_SHA256: HASH,
  };
  const binding = createDelegationGrantMariaDbRuntimeBinding({
    pool: fakePool(),
    env,
    readinessCollector: async () => verifiedReadiness(),
    repositoryFactory: () => ({}),
    mutationExecutor: async () => ({ ok: true }),
  });
  await assert.rejects(
    binding.execute({ plan: plan("revoke"), tenantId: TENANT_ID, authorization: {} }),
    (error) => error.code === "DELEGATION_MARIADB_RUNTIME_ACTION_NOT_ALLOWED",
  );
}

{
  const env = {
    DELEGATION_GRANT_MARIADB_RUNTIME_ENABLED: "1",
    DELEGATION_GRANT_MARIADB_RUNTIME_CERTIFIED: "1",
    DELEGATION_GRANT_MARIADB_RUNTIME_ALLOWED_ACTIONS: "create",
    DELEGATION_GRANT_MARIADB_EXPECTED_MIGRATION_SHA256: HASH,
  };
  const binding = createDelegationGrantMariaDbRuntimeBinding({
    pool: fakePool(),
    env,
    readinessCollector: async () => verifiedReadiness({
      checksum_pin_match: false,
      migration_checksum_sha256: "d".repeat(64),
    }),
    repositoryFactory: () => ({}),
    mutationExecutor: async () => ({ ok: true }),
  });
  await assert.rejects(
    binding.execute({ plan: plan("create"), tenantId: TENANT_ID, authorization: {} }),
    (error) => error.code === "DELEGATION_MARIADB_RUNTIME_SCHEMA_NOT_READY",
  );
}

{
  const lifecyclePlan = planDelegationGrantCreateShadow({
    preview: {
      decision: "eligible_preview",
      grant_hash: "d".repeat(64),
      grant: {
        schema_version: "spec011-delegation-grant-shadow-v1",
        grant_id: randomUUID(),
        delegated_by: "user-1",
        delegated_to: "agent-1",
        approval_mode: "delegated_plan_bound",
        plan_id: randomUUID(),
        plan_hash: HASH,
        resource_scope: [{ resource_uri: "github://owner/repo", snapshot_hash: "e".repeat(64) }],
        allowed_intents: ["repo.patch.apply"],
        denied_intents: ["repo.pr.merge"],
        max_risk_tier: "medium",
        limits: { max_mutations: 1, max_retries: 1, max_pull_requests: 1 },
        require_readback: true,
        stop_on_drift: true,
        policy_version: "policy-v1",
        status: "preview",
        created_at: "2026-07-30T07:00:00.000Z",
        expires_at: "2026-07-30T09:00:00.000Z",
        revoked_at: null,
        secrets_included: false,
      },
    },
    schemaReadiness: verifiedReadiness(),
    operationId: randomUUID(),
    stepId: randomUUID(),
    idempotencyKey: "active-hash-regression",
    requestedBy: "user-1",
    now: "2026-07-30T07:30:00.000Z",
  });
  assert.equal(lifecyclePlan.command_preview.grant.status, "active");
  assert.equal(
    lifecyclePlan.command_preview.canonical_grant_hash,
    _testingDelegationGrantLifecycleShadow.canonicalGrantHash(lifecyclePlan.command_preview.grant),
  );
}

assert.deepEqual(
  [..._testingDelegationGrantMariaDbRuntimeBinding.allowedActions("EXPIRE,create,invalid")].sort(),
  ["create", "expire"],
);

console.log("delegation grant MariaDB runtime binding tests passed");
