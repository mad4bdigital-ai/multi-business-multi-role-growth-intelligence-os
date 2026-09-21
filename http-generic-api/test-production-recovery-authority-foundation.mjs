import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  createProductionRecoveryApprovalAuthorities,
  createProductionRecoveryAuthorityFoundation,
  createProductionRecoveryExecutionTicketAuthorities,
} from "./productionRecoveryAuthorityFoundation.js";

const SHA = "a".repeat(40);
const HASH = "b".repeat(64);
const TARGET = "c".repeat(64);
const PLAN = "plan:1234567890abcdef";
const STEP = "step:1234567890abcdef";
const actionRef = "approval:1234567890abcdef";

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateJwk: privateKey.export({ format: "jwk" }),
    publicJwk: publicKey.export({ format: "jwk" }),
  };
}

function fakeRecoveryStoreFactory(state = {}) {
  return ({ executionTicketVerifier } = {}) => {
    const ephemeral = new Map();
    const approvals = new Map();
    state.connection_count = 0;
    const store = {
      recovery_store_contract: "mad4b.recovery-durable-store.v1",
      independent_of_target_databases: true,
      target_database_binding: "forbidden",
      provider_accessed: false,
      executionTicketVerifier,
      recoveryLock: Object.freeze({
        acquire() {},
        heartbeat() {},
        assertFence() {},
        release() {},
      }),
      async putEphemeralCapability(value) {
        ephemeral.set(value.capability_id, structuredClone(value));
        return { persisted: true };
      },
      async getEphemeralCapability(id) {
        return ephemeral.get(id) ? structuredClone(ephemeral.get(id)) : null;
      },
      async putApproval(value) {
        approvals.set(`${value.plan_id}:${value.step_id}`, structuredClone(value));
      },
      async getApprovalByPlanStep(planId, stepId) {
        return approvals.get(`${planId}:${stepId}`) ? structuredClone(approvals.get(`${planId}:${stepId}`)) : null;
      },
    };
    state.store = store;
    return store;
  };
}

function challenge() {
  return {
    contract: "mad4b.recovery-approval-challenge.v1",
    approval_id: actionRef,
    plan_id: PLAN,
    plan_hash: HASH,
    step_id: STEP,
    step_hash: "d".repeat(64),
    expected_sha: SHA,
    target_key: "production-runtime",
    target_fingerprint: TARGET,
    step_target_fingerprint: TARGET,
    target_role: "governance",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    used: false,
    secrets_included: false,
  };
}

{
  const { privateJwk, publicJwk } = keys();
  const authority = createProductionRecoveryExecutionTicketAuthorities({
    privateKeyJwk: privateJwk,
    publicKeyJwk: publicJwk,
  });
  const signature = await authority.signer.sign({ ticket_hash: HASH });
  assert.equal(typeof signature, "string");
  assert.equal(await authority.verifier.verify({ ticket: { signature }, ticket_hash: HASH }), true);
  assert.equal(await authority.verifier.verify({ ticket: { signature }, ticket_hash: "e".repeat(64) }), false);
}

{
  const state = {};
  const store = fakeRecoveryStoreFactory(state)({ executionTicketVerifier: { verify() {} } });
  const secret = "approval-secret-material-that-is-at-least-thirty-two-bytes";
  const authority = createProductionRecoveryApprovalAuthorities({ recoveryStore: store, approvalSecret: secret });
  const record = challenge();
  const issued = await authority.issuer.createChallenge(record);
  assert.equal(issued.approval_token_returned, false);
  assert.equal(JSON.stringify(issued).includes(secret), false);
  await authority.approvalStore.putChallenge(record);
  await store.putApproval(record);
  const loaded = await authority.approvalStore.getChallenge(record.plan_hash, record.step_id);
  assert.equal(loaded.approval_id, actionRef);
  const resolved = await authority.approvalStore.resolveApprovedExecutionApproval({
    approval_id: actionRef,
    plan_id: PLAN,
    plan_hash: HASH,
    step_id: STEP,
    step_hash: record.step_hash,
    expected_sha: SHA,
    target_key: record.target_key,
    target_fingerprint: TARGET,
    target_role: "governance",
  });
  assert.equal(resolved.server_resolved, true);
  assert.equal(resolved.token_persisted, false);
  assert.equal(await authority.verifier.verify({ token: resolved.approval_token, approval: record }), true);
  assert.equal(await authority.verifier.verify({ token: `${resolved.approval_token}x`, approval: record }), false);
  assert.equal(JSON.stringify(await store.getEphemeralCapability("missing")).includes(secret), false);
}

{
  const { privateJwk, publicJwk } = keys();
  const state = {};
  const foundation = createProductionRecoveryAuthorityFoundation({
    recoveryStoreFactory: fakeRecoveryStoreFactory(state),
    approvalSecret: "another-server-owned-approval-secret-material-1234567890",
    executionPrivateKeyJwk: privateJwk,
    executionPublicKeyJwk: publicJwk,
    readServerAttestation: async () => ({
      repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      branch: "Production",
      environment: "production",
      sha: SHA,
      recovery_manifest_hash: HASH,
      attestation_hash: "f".repeat(64),
      manifest_bound: true,
      read_only_probe: true,
      database_connection_performed: false,
      database_mutation_performed: false,
      provider_mutation_performed: false,
      secrets_included: false,
    }),
  });
  assert.equal(foundation.phase, "canary_foundation");
  assert.equal(foundation.production_live_enabled, false);
  assert.equal(foundation.activation_eligible, false);
  assert.equal(foundation.complete_authority_graph, false);
  assert.deepEqual(
    foundation.deferred_components,
    ["mutationExecutor", "hostLocalMutationExecutor", "readbackVerifier", "partialReceiptStore", "proofResolver", "migrationLedger"],
  );
  assert.equal(foundation.recoveryStore.executionTicketVerifier, foundation.executionTicketVerifier);
  assert.equal(state.connection_count, 0);
  const attestation = await foundation.deploymentIdentityProvider.readAttestation();
  assert.equal(attestation.sha, SHA);
  assert.equal(attestation.read_only, true);
}

{
  const { privateJwk } = keys();
  assert.throws(
    () => createProductionRecoveryAuthorityFoundation({
      recoveryStoreFactory: () => ({
        recoveryLock: {},
        executionTicketVerifier: { verify() {} },
        putApproval() {},
        getApprovalByPlanStep() {},
        putEphemeralCapability() {},
        getEphemeralCapability() {},
      }),
      approvalSecret: "server-owned-approval-secret-material-1234567890",
      executionPrivateKeyJwk: privateJwk,
      readServerAttestation: async () => ({}),
    }),
    (error) => error?.code === "RECOVERY_PRODUCTION_TICKET_VERIFIER_IDENTITY_MISMATCH",
  );
}

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.production-recovery-authority-foundation-regression.v1",
  production_live_enabled: false,
  database_connection_performed: false,
  provider_accessed: false,
  secrets_included: false,
}));
