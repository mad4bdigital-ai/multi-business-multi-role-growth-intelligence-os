import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { issueExecutionTicket } from "./recoveryExecutionTicket.js";
import { createStagingBootstrapExecutionAuthority } from "./stagingBootstrapExecutionAuthority.js";
import { _testingStagingRecoveryAuthorityBinding } from "./stagingRecoveryAuthorityBinding.js";

// frontend-surface-operation: POST /admin/recovery/staging/bootstrap-ticket/verify
// frontend-surface-operation: POST /admin/recovery/staging/bootstrap-ticket/finalize

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

async function createGrantTicket(graph, suffix = "001") {
  const idempotencyKey = `staging-readback-attestation-${suffix}`;
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
    nonce: `nonce:staging-readback-${suffix}`,
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

function evidence(ticketId, idempotencyKey, reservationGeneration, overrides = {}) {
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
    ...overrides,
  };
}

test("reserved ticket rejects fabricated booleans and arbitrary readback SHA", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-readback-attestation-"));
  try {
    const env = stagingEnv(root);
    const roots = _testingStagingRecoveryAuthorityBinding.roots(env);
    const graph = _testingStagingRecoveryAuthorityBinding.adapters(roots.readiness, env).adapters;
    const { ticket, idempotencyKey } = await createGrantTicket(graph, "fabricated");
    const authority = createStagingBootstrapExecutionAuthority({ env });
    const reservation = await authority.verifyForBootstrap({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, expected: expected(idempotencyKey) });
    assert.equal(reservation.valid, true);
    assert.equal(reservation.reserved, true);
    assert.match(reservation.reservation_generation, /^[0-9a-f-]{36}$/u);
    assert.equal(reservation.reservation_receipt.contract, "mad4b.staging-bootstrap-reservation-receipt.v1");

    await assert.rejects(
      () => authority.finalizeForBootstrap({
        ticket_id: ticket.ticket_id,
        ticket_hash: ticket.ticket_hash,
        expected: expected(idempotencyKey),
        readback: { verified: true, same_cycle: true, database_mutation_performed: true, evidence_hash: "f".repeat(64) },
      }),
      (error) => error?.code === "RECOVERY_READBACK_UNVERIFIED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("server attests canonical same-cycle readback and finalizes with durable audit metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-readback-attestation-"));
  try {
    const env = stagingEnv(root);
    const roots = _testingStagingRecoveryAuthorityBinding.roots(env);
    const graph = _testingStagingRecoveryAuthorityBinding.adapters(roots.readiness, env).adapters;
    const { ticket, idempotencyKey } = await createGrantTicket(graph, "success");
    const authority = createStagingBootstrapExecutionAuthority({ env });
    const reservation = await authority.verifyForBootstrap({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, expected: expected(idempotencyKey) });
    const attested = await authority.attestReadbackForBootstrap({
      ticket_id: ticket.ticket_id,
      ticket_hash: ticket.ticket_hash,
      expected: expected(idempotencyKey),
      reservation_receipt: reservation.reservation_receipt,
      evidence: evidence(ticket.ticket_id, idempotencyKey, reservation.reservation_generation),
    });
    assert.equal(attested.verified, true);
    assert.equal(attested.lifecycle_state, "verifying");
    assert.match(attested.evidence_hash, /^[0-9a-f]{64}$/u);
    assert.match(attested.result_fingerprint, /^[0-9a-f]{64}$/u);

    const tampered = { ...attested.readback_receipt, evidence_hash: "0".repeat(64) };
    await assert.rejects(
      () => authority.finalizeForBootstrap({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, expected: expected(idempotencyKey), readback_receipt: tampered }),
      (error) => error?.code === "RECOVERY_READBACK_UNVERIFIED",
    );

    const finalized = await authority.finalizeForBootstrap({
      ticket_id: ticket.ticket_id,
      ticket_hash: ticket.ticket_hash,
      expected: expected(idempotencyKey),
      readback_receipt: attested.readback_receipt,
    });
    assert.equal(finalized.finalized, true);
    assert.equal(finalized.lifecycle_state, "finalized");
    assert.equal(finalized.audit.ticket_id, ticket.ticket_id);
    assert.equal(finalized.audit.run_id, idempotencyKey);
    assert.equal(finalized.audit.expected_sha, SHA);
    assert.equal(finalized.audit.repair_key, "staging_database_access_repair");
    assert.equal(finalized.audit.plan_hash, PLAN_HASH);
    assert.match(finalized.audit.binding_hash, /^[0-9a-f]{64}$/u);
    assert.equal(finalized.audit.evidence_hash, attested.evidence_hash);
    assert.equal(finalized.audit.result_fingerprint, attested.result_fingerprint);
    assert.ok(Date.parse(finalized.audit.finalized_at) > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("wrong-SHA and stale readback evidence fail closed before finalization", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-readback-attestation-"));
  try {
    const env = stagingEnv(root);
    const roots = _testingStagingRecoveryAuthorityBinding.roots(env);
    const graph = _testingStagingRecoveryAuthorityBinding.adapters(roots.readiness, env).adapters;

    const first = await createGrantTicket(graph, "wrong-sha");
    const firstAuthority = createStagingBootstrapExecutionAuthority({ env });
    const firstReservation = await firstAuthority.verifyForBootstrap({ ticket_id: first.ticket.ticket_id, ticket_hash: first.ticket.ticket_hash, expected: expected(first.idempotencyKey) });
    await assert.rejects(
      () => firstAuthority.attestReadbackForBootstrap({
        ticket_id: first.ticket.ticket_id,
        ticket_hash: first.ticket.ticket_hash,
        expected: expected(first.idempotencyKey),
        reservation_receipt: firstReservation.reservation_receipt,
        evidence: evidence(first.ticket.ticket_id, first.idempotencyKey, firstReservation.reservation_generation, { expected_sha: "b".repeat(40) }),
      }),
      (error) => error?.code === "STAGING_SHA_MISMATCH",
    );

    const second = await createGrantTicket(graph, "stale");
    const secondAuthority = createStagingBootstrapExecutionAuthority({ env });
    const secondReservation = await secondAuthority.verifyForBootstrap({ ticket_id: second.ticket.ticket_id, ticket_hash: second.ticket.ticket_hash, expected: expected(second.idempotencyKey) });
    await assert.rejects(
      () => secondAuthority.attestReadbackForBootstrap({
        ticket_id: second.ticket.ticket_id,
        ticket_hash: second.ticket.ticket_hash,
        expected: expected(second.idempotencyKey),
        reservation_receipt: secondReservation.reservation_receipt,
        evidence: evidence(second.ticket.ticket_id, second.idempotencyKey, secondReservation.reservation_generation, { observed_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() }),
      }),
      (error) => error?.code === "RECOVERY_READBACK_STALE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
