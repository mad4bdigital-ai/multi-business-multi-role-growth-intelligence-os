import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { issueExecutionTicket } from "./recoveryExecutionTicket.js";
import { createStagingBootstrapExecutionAuthority } from "./stagingBootstrapExecutionAuthority.js";
import { _testingStagingRecoveryAuthorityBinding } from "./stagingRecoveryAuthorityBinding.js";

const SHA = "a".repeat(40);
const TARGET_FINGERPRINT = "b".repeat(64);
const PLAN_HASH = "c".repeat(64);
const GRANT_BINDING_HASH = "d".repeat(64);

function stagingEnv(root) {
  return {
    NODE_ENV: "staging",
    DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
    REMOTE_MCP_ENVIRONMENT: "staging",
    RECOVERY_STAGING_READINESS_DIRECTORY: path.join(root, "recovery-readiness"),
    RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY: path.join(root, "recovery-ingress"),
  };
}

async function createTicket(graph, suffix) {
  const idempotencyKey = `staging-ticket-idempotency-${suffix}`;
  const ticket = await issueExecutionTicket({
    finding_ids: [`finding:${"1".repeat(32)}`],
    selected_roles: ["composite"],
    role_selection_required: false,
    role_object_count_fingerprints: {},
    role_bundle_bindings: {},
    approval_id: `approval:${"2".repeat(32)}`,
    approval_hash: "3".repeat(64),
    approval_version: "v1",
    operation: "grants",
    target_fingerprints: { composite: TARGET_FINGERPRINT },
    target_fingerprint: TARGET_FINGERPRINT,
    production_sha: SHA,
    target_key: "staging-runtime",
    plan_hash: PLAN_HASH,
    step_hash: "4".repeat(64),
    step_id: `step:${"5".repeat(32)}`,
    target_role: "composite",
    idempotency_key: idempotencyKey,
    grant_binding_hash: GRANT_BINDING_HASH,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    nonce: `nonce:ticket-idempotency-${suffix}`,
  }, { signer: graph.executionTicketSigner });
  await graph.recoveryStore.putExecutionTicket(ticket);
  return { ticket, idempotencyKey };
}

function expected(idempotencyKey) {
  return {
    production_sha: SHA,
    target_key: "staging-runtime",
    target_fingerprint: TARGET_FINGERPRINT,
    operation: "grants",
    plan_hash: PLAN_HASH,
    idempotency_key: idempotencyKey,
    grant_binding_hash: GRANT_BINDING_HASH,
  };
}

function readbackEvidence(ticketId, idempotencyKey, reservationGeneration) {
  return {
    contract: "mad4b.staging-bootstrap-local-readback-evidence.v1",
    ticket_id: ticketId,
    reservation_generation: reservationGeneration,
    expected_sha: SHA,
    target_key: "staging-runtime",
    target_fingerprint: TARGET_FINGERPRINT,
    operation: "grants",
    plan_hash: PLAN_HASH,
    idempotency_key: idempotencyKey,
    grant_binding_hash: GRANT_BINDING_HASH,
    role_selection_hash: null,
    status: "apply_grants_complete",
    observed_at: new Date().toISOString(),
    same_cycle: true,
    database_mutation_performed: true,
    grant_readback_by_role: {
      runtime: { ready: true, evidence_fingerprint: "6".repeat(64) },
      governance: { ready: true, evidence_fingerprint: "7".repeat(64) },
      runtime_persistence: { ready: true, evidence_fingerprint: "8".repeat(64) },
    },
    postconditions_fingerprint: "9".repeat(64),
    mutation_evidence_fingerprint: "a".repeat(64),
    secrets_included: false,
  };
}

test("reservation, execution-start, readback and finalization are replay-safe for the same idempotency binding", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-ticket-idempotency-"));
  try {
    const env = stagingEnv(root);
    const roots = _testingStagingRecoveryAuthorityBinding.roots(env);
    const graph = _testingStagingRecoveryAuthorityBinding.adapters(roots.readiness, env).adapters;
    const { ticket, idempotencyKey } = await createTicket(graph, "full-cycle");
    const authority = createStagingBootstrapExecutionAuthority({ env });
    const binding = expected(idempotencyKey);

    const reserved = await authority.verifyForBootstrap({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, expected: binding });
    const reservedRetry = await authority.verifyForBootstrap({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, expected: binding });
    assert.equal(reservedRetry.valid, true);
    assert.equal(reservedRetry.idempotent_replay, true);
    assert.equal(reservedRetry.reservation_generation, reserved.reservation_generation);
    assert.deepEqual(reservedRetry.reservation_receipt, reserved.reservation_receipt);

    const executing = await authority.markExecutingForBootstrap({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, expected: binding, reservation_receipt: reserved.reservation_receipt });
    const executingRetry = await authority.markExecutingForBootstrap({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, expected: binding, reservation_receipt: reserved.reservation_receipt });
    assert.equal(executingRetry.executing, true);
    assert.equal(executingRetry.idempotent_replay, true);
    assert.deepEqual(executingRetry.execution_receipt, executing.execution_receipt);

    const evidence = readbackEvidence(ticket.ticket_id, idempotencyKey, reserved.reservation_generation);
    const readback = await authority.attestReadbackForBootstrap({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, expected: binding, reservation_receipt: reserved.reservation_receipt, execution_receipt: executing.execution_receipt, evidence });
    const readbackRetry = await authority.attestReadbackForBootstrap({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, expected: binding, reservation_receipt: reserved.reservation_receipt, execution_receipt: executing.execution_receipt, evidence });
    assert.equal(readbackRetry.verified, true);
    assert.equal(readbackRetry.idempotent_replay, true);
    assert.deepEqual(readbackRetry.readback_receipt, readback.readback_receipt);

    const finalized = await authority.finalizeForBootstrap({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, expected: binding, readback_receipt: readback.readback_receipt });
    const finalizedRetry = await authority.finalizeForBootstrap({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, expected: binding, readback_receipt: readback.readback_receipt });
    assert.equal(finalized.finalized, true);
    assert.equal(finalizedRetry.finalized, true);
    assert.equal(finalizedRetry.idempotent_replay, true);
    assert.equal(finalizedRetry.result_fingerprint, finalized.result_fingerprint);
    assert.equal(finalizedRetry.audit.ticket_id, ticket.ticket_id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("same idempotency key cannot be rebound to another ticket lifecycle", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-ticket-idempotency-conflict-"));
  try {
    const env = stagingEnv(root);
    const roots = _testingStagingRecoveryAuthorityBinding.roots(env);
    const graph = _testingStagingRecoveryAuthorityBinding.adapters(roots.readiness, env).adapters;
    const first = await createTicket(graph, "conflict-a");
    const authority = createStagingBootstrapExecutionAuthority({ env });
    await authority.verifyForBootstrap({ ticket_id: first.ticket.ticket_id, ticket_hash: first.ticket.ticket_hash, expected: expected(first.idempotencyKey) });

    const secondTicket = await issueExecutionTicket({
      finding_ids: [`finding:${"a".repeat(32)}`], selected_roles: ["composite"], role_selection_required: false, role_object_count_fingerprints: {}, role_bundle_bindings: {},
      approval_id: `approval:${"b".repeat(32)}`, approval_hash: "c".repeat(64), approval_version: "v1", operation: "grants",
      target_fingerprints: { composite: TARGET_FINGERPRINT }, target_fingerprint: TARGET_FINGERPRINT, production_sha: SHA, target_key: "staging-runtime", plan_hash: PLAN_HASH,
      step_hash: "d".repeat(64), step_id: `step:${"e".repeat(32)}`, target_role: "composite", idempotency_key: first.idempotencyKey,
      grant_binding_hash: GRANT_BINDING_HASH, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), nonce: "nonce:conflict-second-ticket",
    }, { signer: graph.executionTicketSigner });
    await graph.recoveryStore.putExecutionTicket(secondTicket);
    await assert.rejects(
      () => authority.verifyForBootstrap({ ticket_id: secondTicket.ticket_id, ticket_hash: secondTicket.ticket_hash, expected: expected(first.idempotencyKey) }),
      (error) => error?.code === "RECOVERY_IDEMPOTENCY_CONFLICT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
