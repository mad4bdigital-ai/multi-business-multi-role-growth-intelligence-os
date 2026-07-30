import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  REPOSITORY_RECONCILIATION_LEASE_CONFIRMATIONS,
  buildRepositoryReconciliationLeaseAcquireInput,
  runRepositoryReconciliationLeaseControl,
} from "./repositoryReconciliationLeaseControl.js";

const baseArgs = {
  action: "acquire",
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  branch: "gpt/013-system-tool-catalog-v2",
  default_branch: "main",
  expected_base_sha: "a".repeat(40),
  expected_branch_sha: "b".repeat(40),
  operation_key: "repo.pr.reconcile_and_finalize",
  holder_run_id: "reconcile-run-lease-control-1",
  holder_actor_type: "platform_orchestrator",
  holder_actor_id: "admin-gpt",
  ttl_seconds: 300,
  capability_envelope_id: "11111111-1111-4111-8111-111111111111",
  confirm: REPOSITORY_RECONCILIATION_LEASE_CONFIRMATIONS.acquire,
};

const built = buildRepositoryReconciliationLeaseAcquireInput(baseArgs);
assert.equal(built.repository_owner, baseArgs.owner);
assert.equal(built.repository_name, baseArgs.repo);
assert.equal(built.branch_name, baseArgs.branch);
assert.match(built.operation_fingerprint, /^[0-9a-f]{64}$/);
assert.equal(
  buildRepositoryReconciliationLeaseAcquireInput({ ...baseArgs }).operation_fingerprint,
  built.operation_fingerprint,
);
assert.notEqual(
  buildRepositoryReconciliationLeaseAcquireInput({
    ...baseArgs,
    expected_base_sha: "c".repeat(40),
  }).operation_fingerprint,
  built.operation_fingerprint,
);

assert.throws(
  () => buildRepositoryReconciliationLeaseAcquireInput({ ...baseArgs, branch: "main" }),
  (error) => error?.code === "repository_reconciliation_lease_control_protected_branch" && error?.status === 403,
);
assert.throws(
  () => buildRepositoryReconciliationLeaseAcquireInput({ ...baseArgs, force: true }),
  (error) => error?.code === "repository_reconciliation_lease_control_force_forbidden" && error?.status === 403,
);
assert.throws(
  () => buildRepositoryReconciliationLeaseAcquireInput({ ...baseArgs, operation_fingerprint: "f".repeat(64) }),
  (error) => error?.code === "repository_reconciliation_lease_control_operation_fingerprint_mismatch",
);

function fakeDeps(overrides = {}) {
  const order = [];
  const calls = {};
  return {
    order,
    calls,
    pool: { name: "fake-pool" },
    auth: {
      tenant_id: "00000000-0000-0000-0000-000000000000",
      user_id: "admin-user",
      caller_type: "admin",
    },
    async resolveCapabilityExecutionEnvelope(input) {
      order.push("resolve-envelope");
      calls.envelope = input;
      return { ok: true, envelope_id: baseArgs.capability_envelope_id };
    },
    capabilityEnvelopeError(result, message) {
      const error = new Error(message);
      error.code = result?.reason_code || "capability_envelope_required";
      error.status = 403;
      return error;
    },
    async markCapabilityEnvelopeReferenced(input) {
      order.push("mark-envelope");
      calls.mark = input;
    },
    async acquireRepositoryOperationLease(input, deps) {
      order.push("acquire-lease");
      calls.acquire = { input, deps };
      return {
        ok: true,
        classification: "repository_operation_lease_acquired",
        reused: false,
        lease: {
          lease_id: "22222222-2222-4222-8222-222222222222",
          resource_fingerprint: "d".repeat(64),
          status: "active",
          secrets_included: false,
        },
        secrets_included: false,
      };
    },
    async renewRepositoryOperationLease(input, deps) {
      order.push("renew-lease");
      calls.renew = { input, deps };
      return { ok: true, classification: "repository_operation_lease_renewed", lease: { ...input, status: "active" }, secrets_included: false };
    },
    async releaseRepositoryOperationLease(input, deps) {
      order.push("release-lease");
      calls.release = { input, deps };
      return { ok: true, classification: "repository_operation_lease_released", lease: { ...input, status: "released" }, secrets_included: false };
    },
    ...overrides,
  };
}

const acquireDeps = fakeDeps();
const acquired = await runRepositoryReconciliationLeaseControl(baseArgs, acquireDeps);
assert.equal(acquired.ok, true);
assert.equal(acquired.action, "acquire");
assert.equal(acquired.capability_envelope_id, baseArgs.capability_envelope_id);
assert.equal(acquired.operation_binding.expected_base_sha, baseArgs.expected_base_sha);
assert.equal(acquired.secrets_included, false);
assert.deepEqual(acquireDeps.order, ["resolve-envelope", "mark-envelope", "acquire-lease"]);
assert.equal(acquireDeps.calls.acquire.input.operation_fingerprint, built.operation_fingerprint);
assert.equal(acquireDeps.calls.acquire.deps.pool, acquireDeps.pool);
assert.deepEqual(acquireDeps.calls.envelope.acceptedAppKeys, ["github"]);
assert.ok(acquireDeps.calls.envelope.acceptedIntents.includes("repository_reconciliation_lease_acquire"));
assert.match(acquireDeps.calls.mark.executionRef, /^repository_reconciliation_lease_control:acquire:/);

const lifecycleBase = {
  lease_id: "22222222-2222-4222-8222-222222222222",
  holder_run_id: baseArgs.holder_run_id,
  resource_fingerprint: "d".repeat(64),
  capability_envelope_id: baseArgs.capability_envelope_id,
};
const renewDeps = fakeDeps();
const renewed = await runRepositoryReconciliationLeaseControl({
  action: "renew",
  ...lifecycleBase,
  ttl_seconds: 600,
  confirm: REPOSITORY_RECONCILIATION_LEASE_CONFIRMATIONS.renew,
}, renewDeps);
assert.equal(renewed.action, "renew");
assert.equal(renewDeps.calls.renew.input.ttl_seconds, 600);
assert.deepEqual(renewDeps.order, ["resolve-envelope", "mark-envelope", "renew-lease"]);

const releaseDeps = fakeDeps();
const released = await runRepositoryReconciliationLeaseControl({
  action: "release",
  ...lifecycleBase,
  release_reason: "catalog_v2_reconciliation_complete",
  confirm: REPOSITORY_RECONCILIATION_LEASE_CONFIRMATIONS.release,
}, releaseDeps);
assert.equal(released.action, "release");
assert.equal(releaseDeps.calls.release.input.release_reason, "catalog_v2_reconciliation_complete");
assert.equal(released.lease.status, "released");

const wrongConfirmationDeps = fakeDeps();
await assert.rejects(
  runRepositoryReconciliationLeaseControl({ ...baseArgs, confirm: "YES" }, wrongConfirmationDeps),
  (error) => error?.code === "repository_reconciliation_lease_control_confirmation_required" && error?.status === 409,
);
assert.deepEqual(wrongConfirmationDeps.order, []);

const nonAdminDeps = fakeDeps({ auth: { caller_type: "tenant", tenant_id: "tenant-1", user_id: "user-1" } });
await assert.rejects(
  runRepositoryReconciliationLeaseControl(baseArgs, nonAdminDeps),
  (error) => error?.code === "repository_reconciliation_lease_control_admin_required" && error?.status === 403,
);
assert.deepEqual(nonAdminDeps.order, []);

const rejectedEnvelopeDeps = fakeDeps({
  async resolveCapabilityExecutionEnvelope() {
    rejectedEnvelopeDeps.order.push("resolve-envelope");
    return { ok: false, reason_code: "capability_envelope_not_ready" };
  },
});
await assert.rejects(
  runRepositoryReconciliationLeaseControl(baseArgs, rejectedEnvelopeDeps),
  (error) => error?.code === "capability_envelope_not_ready" && error?.status === 403,
);
assert.deepEqual(rejectedEnvelopeDeps.order, ["resolve-envelope"]);

const routes = readFileSync(new URL("./routes/repositoryAutomationRoutes.js", import.meta.url), "utf8");
assert.match(routes, /runRepositoryReconciliationLeaseControl/);
assert.match(routes, /\/admin\/repository-automation\/reconciliation-lease/);
assert.match(routes, /\.\.\.requireAdmin/);
assert.match(routes, /repository_reconciliation_lease_control_failed/);

console.log("repository reconciliation lease control tests passed");
