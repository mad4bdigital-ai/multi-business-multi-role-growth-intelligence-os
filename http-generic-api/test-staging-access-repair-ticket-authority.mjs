import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyExecutionTicket } from "./recoveryExecutionTicket.js";
import {
  createStagingAccessRepairTicketAuthority,
  STAGING_ACCESS_REPAIR_CAPABILITY,
  STAGING_ACCESS_REPAIR_TICKET_AUTHORITY_CONTRACT,
} from "./stagingAccessRepairTicketAuthority.js";
import { createStagingBootstrapExecutionAuthority } from "./stagingBootstrapExecutionAuthority.js";
import { _testingStagingRecoveryAuthorityBinding } from "./stagingRecoveryAuthorityBinding.js";
import { _testingStagingRecoveryAdminRoutes } from "./routes/stagingRecoveryAdminRoutes.js";

const SHA = "a".repeat(40);
const TREE = "b".repeat(40);
const CONTEXT = "c".repeat(64);
const GRANT_BINDING_HASH = "d".repeat(64);

function stagingEnv(root) {
  return {
    NODE_ENV: "staging",
    DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
    REMOTE_MCP_ENVIRONMENT: "staging",
    RECOVERY_SERVER_MANAGED_BINDING_MODE: "injected_non_live",
    RECOVERY_SERVER_MANAGED_BINDING_MODULE: "./stagingRecoveryAuthorityBinding.js",
    RECOVERY_STAGING_READINESS_DIRECTORY: path.join(root, "recovery-readiness"),
    RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY: path.join(root, "recovery-ingress"),
    DEPLOYMENT_MANIFEST_JSON: JSON.stringify({
      repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      branch: "main",
      commit_sha: SHA,
      tree_sha: TREE,
      context_file_set_sha256: CONTEXT,
      build_source: "staging_access_repair_ticket_authority_test",
      secrets_included: false,
    }),
  };
}

test("high-level Staging access-repair approval issues one exact signed grant ticket that reaches executing only through the bootstrap authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-access-repair-ticket-"));
  try {
    const env = stagingEnv(root);
    const roots = _testingStagingRecoveryAuthorityBinding.roots(env);
    const graph = _testingStagingRecoveryAuthorityBinding.adapters(roots.readiness, env).adapters;
    const attestation = await graph.deploymentIdentityProvider.readAttestation();
    const targetFingerprint = attestation.target_fingerprint;
    assert.match(targetFingerprint, /^[a-f0-9]{64}$/u);

    const authority = createStagingAccessRepairTicketAuthority({ env });
    const prepared = await authority.prepare({
      expected_sha: SHA,
      target_key: "staging-runtime",
      target_fingerprint: targetFingerprint,
      grant_binding_hash: GRANT_BINDING_HASH,
      idempotency_key: "staging-access-repair-prepare-001",
    });

    assert.equal(prepared.ok, true);
    assert.equal(prepared.contract, STAGING_ACCESS_REPAIR_TICKET_AUTHORITY_CONTRACT);
    assert.equal(prepared.capability, STAGING_ACCESS_REPAIR_CAPABILITY);
    assert.equal(prepared.status, "approval_required");
    assert.equal(prepared.expected_sha, SHA);
    assert.equal(prepared.target_key, "staging-runtime");
    assert.equal(prepared.target_fingerprint, targetFingerprint);
    assert.equal(prepared.grant_binding_hash, GRANT_BINDING_HASH);
    assert.equal(prepared.raw_sql_allowed, false);
    assert.equal(prepared.caller_command_allowed, false);
    assert.equal(prepared.database_mutation_performed, false);
    assert.equal(prepared.approval_token_not_returned, true);
    assert.equal(prepared.execution_ticket_not_returned, true);
    assert.equal(Object.hasOwn(prepared, "server_token"), false);
    assert.equal(Object.hasOwn(prepared, "signature"), false);
    assert.match(prepared.approval_confirmation, /^APPROVE_STAGING_DATABASE_ACCESS_REPAIR:/u);

    await assert.rejects(
      () => authority.approveAndIssue({
        plan_id: prepared.plan_id,
        plan_hash: prepared.plan_hash,
        step_id: prepared.step_id,
        idempotency_key: "staging-access-repair-execute-001",
        approval_confirmation: `${prepared.approval_confirmation}:tampered`,
      }),
      (error) => error?.code === "RECOVERY_APPROVAL_INVALID",
    );

    const issued = await authority.approveAndIssue({
      plan_id: prepared.plan_id,
      plan_hash: prepared.plan_hash,
      step_id: prepared.step_id,
      idempotency_key: "staging-access-repair-execute-001",
      approval_confirmation: prepared.approval_confirmation,
    });

    assert.equal(issued.ok, true);
    assert.equal(issued.status, "ticket_issued");
    assert.equal(issued.single_use, true);
    assert.equal(issued.signature_not_returned, true);
    assert.equal(issued.approval_token_not_returned, true);
    assert.equal(issued.raw_sql_allowed, false);
    assert.equal(issued.caller_command_allowed, false);
    assert.equal(issued.database_mutation_performed, false);
    assert.equal(Object.hasOwn(issued, "signature"), false);
    assert.equal(Object.hasOwn(issued, "server_token"), false);

    const ticket = await graph.recoveryStore.getExecutionTicket(issued.ticket_id);
    assert.ok(ticket);
    assert.equal(ticket.ticket_hash, issued.ticket_hash);
    assert.equal(ticket.operation, "grants");
    assert.equal(ticket.production_sha, SHA);
    assert.equal(ticket.target_key, "staging-runtime");
    assert.equal(ticket.target_fingerprint, targetFingerprint);
    assert.equal(ticket.plan_hash, prepared.plan_hash);
    assert.equal(ticket.step_id, prepared.step_id);
    assert.equal(ticket.grant_binding_hash, GRANT_BINDING_HASH);
    assert.equal(ticket.single_use, true);
    assert.equal(typeof ticket.signature, "string");
    assert.ok(ticket.signature.length > 0);

    const expected = {
      production_sha: SHA,
      target_key: "staging-runtime",
      target_fingerprint: targetFingerprint,
      operation: "grants",
      plan_hash: prepared.plan_hash,
      step_id: prepared.step_id,
      idempotency_key: "staging-access-repair-execute-001",
      grant_binding_hash: GRANT_BINDING_HASH,
    };
    const verified = await verifyExecutionTicket(ticket, {
      verifier: graph.executionTicketVerifier,
      expected,
    });
    assert.equal(verified.valid, true);

    await assert.rejects(
      () => verifyExecutionTicket(ticket, {
        verifier: graph.executionTicketVerifier,
        expected: { grant_binding_hash: "e".repeat(64) },
      }),
      /grant_binding_hash binding mismatch|binding mismatch/u,
    );

    const bootstrap = createStagingBootstrapExecutionAuthority({ env });
    const reservation = await bootstrap.verifyForBootstrap({
      ticket_id: issued.ticket_id,
      ticket_hash: issued.ticket_hash,
      expected,
    });
    assert.equal(reservation.valid, true);
    assert.equal(reservation.reserved, true);
    assert.equal(reservation.lifecycle_state, "reserved");
    assert.equal(reservation.reservation_receipt.ticket_id, issued.ticket_id);

    const executing = await bootstrap.markExecutingForBootstrap({
      ticket_id: issued.ticket_id,
      ticket_hash: issued.ticket_hash,
      expected,
      reservation_receipt: reservation.reservation_receipt,
    });
    assert.equal(executing.executing, true);
    assert.equal(executing.lifecycle_state, "executing");
    assert.equal(executing.reservation_generation, reservation.reservation_generation);
    assert.equal(executing.execution_receipt.contract, "mad4b.staging-bootstrap-execution-receipt.v1");
    assert.equal(executing.execution_receipt.reservation_receipt_hash, reservation.reservation_receipt.receipt_hash);

    await assert.rejects(
      () => authority.approveAndIssue({
        plan_id: prepared.plan_id,
        plan_hash: prepared.plan_hash,
        step_id: prepared.step_id,
        idempotency_key: "staging-access-repair-execute-replay-002",
        approval_confirmation: prepared.approval_confirmation,
      }),
      (error) => error?.code === "RECOVERY_APPROVAL_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("access-repair and execution-start route binding reject raw SQL, commands, and caller-selected operations", () => {
  assert.throws(
    () => _testingStagingRecoveryAdminRoutes.exactAccessRepairPrepare({
      authority_action: "prepare_access_repair",
      expected_sha: SHA,
      target_key: "staging-runtime",
      target_fingerprint: "e".repeat(64),
      grant_binding_hash: GRANT_BINDING_HASH,
      idempotency_key: "staging-access-repair-prepare-002",
      raw_sql: "GRANT ALL",
    }),
    (error) => error?.code === "RECOVERY_STAGING_BOOTSTRAP_FIELD_FORBIDDEN",
  );
  assert.throws(
    () => _testingStagingRecoveryAdminRoutes.exactAccessRepairApprove({
      authority_action: "approve_access_repair",
      plan_id: `plan:${"1".repeat(32)}`,
      plan_hash: "2".repeat(64),
      step_id: `step:${"3".repeat(32)}`,
      idempotency_key: "staging-access-repair-approve-002",
      approval_confirmation: "APPROVE_STAGING_DATABASE_ACCESS_REPAIR:bounded",
      operation: "grants",
    }),
    (error) => error?.code === "RECOVERY_STAGING_BOOTSTRAP_FIELD_FORBIDDEN",
  );
  assert.throws(
    () => _testingStagingRecoveryAdminRoutes.exactAccessRepairPrepare({
      authority_action: "prepare_access_repair",
      expected_sha: SHA,
      target_key: "production-runtime",
      target_fingerprint: "e".repeat(64),
      grant_binding_hash: GRANT_BINDING_HASH,
      idempotency_key: "staging-access-repair-prepare-003",
      command: "do-something",
    }),
    (error) => error?.code === "RECOVERY_STAGING_BOOTSTRAP_FIELD_FORBIDDEN",
  );
  assert.throws(
    () => _testingStagingRecoveryAdminRoutes.exactBootstrapExecutionStart({
      authority_action: "mark_executing",
      execution_ticket_id: `ticket:${"1".repeat(32)}`,
      execution_ticket_hash: "2".repeat(64),
      expected_sha: SHA,
      target_key: "staging-runtime",
      target_fingerprint: "3".repeat(64),
      operation: "grants",
      plan_hash: "4".repeat(64),
      idempotency_key: "staging-execution-start-001",
      role_selection_hash: null,
      grant_binding_hash: GRANT_BINDING_HASH,
      reservation_receipt: { contract: "mad4b.staging-bootstrap-reservation-receipt.v1", secrets_included: false },
      raw_sql: "GRANT ALL",
    }),
    (error) => error?.code === "RECOVERY_STAGING_BOOTSTRAP_FIELD_FORBIDDEN",
  );
});
