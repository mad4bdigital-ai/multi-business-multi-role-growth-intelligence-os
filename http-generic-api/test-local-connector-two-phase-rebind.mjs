import assert from "node:assert/strict";
import test from "node:test";
import { createLocalConnectorTwoPhaseRebindExecutor } from "./localConnectorTwoPhaseRebind.js";

const SHA = "a".repeat(40);
const STEP = Object.freeze({
  expected_sha: SHA,
  run_id: "run:platform-recovery:fixture",
  plan_hash: "b".repeat(64),
  step_id: "step:" + "c".repeat(32),
  idempotency_key: "platform-recovery-step:fixture:connector",
  approval: Object.freeze({
    approval_id: "approval:" + "d".repeat(32),
    server_verified: true,
    single_use: true,
    secrets_included: false,
  }),
  secrets_included: false,
});

function baseContext() {
  return {
    device_id: "device:fixture-001",
    user_ref: "user:fixture-001",
    tenant_ref: "tenant:fixture-001",
    old_credential_ref: "credential:old-fixture",
    device_authentication_verified: true,
    fresh_user_authorization_verified: true,
    secrets_included: false,
  };
}

test("two-phase rebind commits only after authenticated probe", async () => {
  const calls = [];
  const executor = createLocalConnectorTwoPhaseRebindExecutor({
    resolveBoundDeviceContext: async () => ({ ...baseContext() }),
    preparePendingCredential: async () => {
      calls.push("prepare");
      return {
        pending_credential_ref: "credential:pending-fixture",
        old_credential_active: true,
        old_credential_revoked: false,
        secrets_included: false,
      };
    },
    installPendingCredentialLocally: async () => {
      calls.push("install");
      return {
        local_atomic_install_verified: true,
        old_credential_revoked: false,
        secrets_included: false,
      };
    },
    probePendingCredential: async () => {
      calls.push("probe");
      return {
        authenticated: true,
        http_status: 200,
        old_credential_revoked: false,
        request_id: "request:probe-fixture",
        secrets_included: false,
      };
    },
    commitPendingCredential: async ({ probe_evidence_hash }) => {
      calls.push("commit");
      assert.match(probe_evidence_hash, /^[0-9a-f]{64}$/u);
      return {
        new_credential_active: true,
        old_credential_revoked: true,
        commit_readback_verified: true,
        secrets_included: false,
      };
    },
  });

  const result = await executor(STEP);
  assert.deepEqual(calls, ["prepare", "install", "probe", "commit"]);
  assert.equal(result.status, "pass");
  assert.equal(result.new_credential_probe_verified, true);
  assert.equal(result.old_credential_revoked_after_probe, true);
  assert.equal(result.old_credential_revoked_before_probe, false);
  assert.equal(result.credential_material_returned_to_orchestrator, false);
  assert.equal(result.authority_verified, true);
  assert.equal(result.readback_verified, true);
});

test("failed probe cancels pending credential and retains old authority", async () => {
  const calls = [];
  const executor = createLocalConnectorTwoPhaseRebindExecutor({
    resolveBoundDeviceContext: async () => ({ ...baseContext() }),
    preparePendingCredential: async () => ({
      pending_credential_ref: "credential:pending-failure",
      old_credential_active: true,
      old_credential_revoked: false,
      secrets_included: false,
    }),
    installPendingCredentialLocally: async () => ({
      local_atomic_install_verified: true,
      old_credential_revoked: false,
      secrets_included: false,
    }),
    probePendingCredential: async () => ({
      authenticated: false,
      http_status: 401,
      old_credential_revoked: false,
      request_id: "request:probe-failure",
      secrets_included: false,
    }),
    commitPendingCredential: async () => {
      calls.push("commit");
      throw new Error("commit must not run");
    },
    cancelPendingCredential: async ({ retain_old_credential }) => {
      calls.push("cancel");
      assert.equal(retain_old_credential, true);
    },
  });

  await assert.rejects(executor(STEP), (error) => error.code === "LOCAL_CONNECTOR_REBIND_PROBE_FAILED");
  assert.deepEqual(calls, ["cancel"]);
});

test("fresh device and user authorization are required before prepare", async () => {
  let prepared = false;
  const executor = createLocalConnectorTwoPhaseRebindExecutor({
    resolveBoundDeviceContext: async () => ({
      ...baseContext(),
      fresh_user_authorization_verified: false,
    }),
    preparePendingCredential: async () => {
      prepared = true;
      return {};
    },
    installPendingCredentialLocally: async () => ({}),
    probePendingCredential: async () => ({}),
    commitPendingCredential: async () => ({}),
  });

  await assert.rejects(executor(STEP), (error) => error.code === "LOCAL_CONNECTOR_REBIND_FRESH_AUTH_REQUIRED");
  assert.equal(prepared, false);
});

test("credential material is rejected if an adapter attempts to return it", async () => {
  const executor = createLocalConnectorTwoPhaseRebindExecutor({
    resolveBoundDeviceContext: async () => ({ ...baseContext() }),
    preparePendingCredential: async () => ({
      pending_credential_ref: "credential:pending-secret",
      old_credential_active: true,
      old_credential_revoked: false,
      secret: "must-not-cross-coordinator",
      secrets_included: false,
    }),
    installPendingCredentialLocally: async () => ({}),
    probePendingCredential: async () => ({}),
    commitPendingCredential: async () => ({}),
  });

  await assert.rejects(executor(STEP), (error) => error.code === "LOCAL_CONNECTOR_REBIND_SECRET_MATERIAL_FORBIDDEN");
});


test("canonical recovery proof boundary rejects nested token and client-secret material", async () => {
  for (const forbiddenReceipt of [
    { metadata: { access_token: "must-not-cross" } },
    { metadata: { refresh_token: "must-not-cross" } },
    { metadata: { client_secret: "must-not-cross" } },
    { metadata: { bearer_token: "must-not-cross" } },
    { metadata: { nested: { private_key: "must-not-cross" } } },
  ]) {
    const executor = createLocalConnectorTwoPhaseRebindExecutor({
      resolveBoundDeviceContext: async () => ({
        ...baseContext(),
        ...forbiddenReceipt,
      }),
      preparePendingCredential: async () => ({}),
      installPendingCredentialLocally: async () => ({}),
      probePendingCredential: async () => ({}),
      commitPendingCredential: async () => ({}),
    });

    await assert.rejects(
      executor(STEP),
      (error) => error.code === "LOCAL_CONNECTOR_REBIND_SECRET_MATERIAL_FORBIDDEN",
    );
  }
});

test("opaque credential references remain allowed by the canonical proof boundary", async () => {
  const executor = createLocalConnectorTwoPhaseRebindExecutor({
    resolveBoundDeviceContext: async () => ({ ...baseContext() }),
    preparePendingCredential: async () => ({
      pending_credential_ref: "credential:pending-opaque-ref",
      old_credential_active: true,
      old_credential_revoked: false,
      secrets_included: false,
    }),
    installPendingCredentialLocally: async () => ({
      local_atomic_install_verified: true,
      old_credential_revoked: false,
      secrets_included: false,
    }),
    probePendingCredential: async () => ({
      authenticated: true,
      http_status: 200,
      old_credential_revoked: false,
      request_id: "request:opaque-ref-probe",
      secrets_included: false,
    }),
    commitPendingCredential: async () => ({
      new_credential_active: true,
      old_credential_revoked: true,
      commit_readback_verified: true,
      secrets_included: false,
    }),
  });

  const result = await executor(STEP);
  assert.equal(result.status, "pass");
  assert.equal(result.credential_material_returned_to_orchestrator, false);
});


test("commit transport failure becomes unknown outcome and requires reconciliation", async () => {
  const executor = createLocalConnectorTwoPhaseRebindExecutor({
    resolveBoundDeviceContext: async () => ({ ...baseContext() }),
    preparePendingCredential: async () => ({
      pending_credential_ref: "credential:pending-unknown-outcome",
      old_credential_active: true,
      old_credential_revoked: false,
      secrets_included: false,
    }),
    installPendingCredentialLocally: async () => ({
      local_atomic_install_verified: true,
      old_credential_revoked: false,
      secrets_included: false,
    }),
    probePendingCredential: async () => ({
      authenticated: true,
      http_status: 200,
      old_credential_revoked: false,
      request_id: "request:probe-unknown-outcome",
      secrets_included: false,
    }),
    commitPendingCredential: async () => {
      const error = new Error("commit transport timed out after request dispatch");
      error.code = "LOCAL_CONNECTOR_REBIND_COMMIT_TRANSPORT_TIMEOUT";
      throw error;
    },
  });

  await assert.rejects(
    executor(STEP),
    (error) => {
      assert.equal(error.code, "LOCAL_CONNECTOR_REBIND_COMMIT_TRANSPORT_TIMEOUT");
      assert.equal(error.unknown_outcome, true);
      assert.equal(error.reconciliation_required, true);
      assert.equal(error.automatic_retry_allowed, false);
      assert.equal(error.commit_attempted, true);
      assert.equal(error.mutation_performed, null);
      assert.equal(error.request_id, "request:probe-unknown-outcome");
      return true;
    },
  );
});

test("explicit proof that commit did not mutate remains a normal retryable failure", async () => {
  const executor = createLocalConnectorTwoPhaseRebindExecutor({
    resolveBoundDeviceContext: async () => ({ ...baseContext() }),
    preparePendingCredential: async () => ({
      pending_credential_ref: "credential:pending-no-mutation",
      old_credential_active: true,
      old_credential_revoked: false,
      secrets_included: false,
    }),
    installPendingCredentialLocally: async () => ({
      local_atomic_install_verified: true,
      old_credential_revoked: false,
      secrets_included: false,
    }),
    probePendingCredential: async () => ({
      authenticated: true,
      http_status: 200,
      old_credential_revoked: false,
      request_id: "request:probe-no-mutation",
      secrets_included: false,
    }),
    commitPendingCredential: async () => {
      const error = new Error("provider rejected commit before mutation");
      error.code = "LOCAL_CONNECTOR_REBIND_COMMIT_REJECTED";
      error.mutation_performed = false;
      throw error;
    },
  });

  await assert.rejects(
    executor(STEP),
    (error) => {
      assert.equal(error.code, "LOCAL_CONNECTOR_REBIND_COMMIT_REJECTED");
      assert.notEqual(error.unknown_outcome, true);
      assert.equal(error.mutation_performed, false);
      return true;
    },
  );
});
