import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildExecutionTicketPayload,
  computeExecutionTicketHash,
  issueExecutionTicket,
  verifyExecutionTicket,
} from "./recoveryExecutionTicket.js";
import { buildRoleBundleBinding } from "./recoveryExecutionBinding.js";
import { createStagingBootstrapExecutionAuthority } from "./stagingBootstrapExecutionAuthority.js";
import { _testingStagingRecoveryAuthorityBinding } from "./stagingRecoveryAuthorityBinding.js";
import { buildStagingRecoveryAdminContract, _testingStagingRecoveryAdminRoutes } from "./routes/stagingRecoveryAdminRoutes.js";

// frontend-surface-operation: POST /admin/recovery/staging/bootstrap-ticket/verify
// frontend-surface-operation: POST /admin/recovery/staging/bootstrap-ticket/finalize
// frontend-surface-operation: POST /admin/recovery/staging/bootstrap-partial-receipt

const SHA = "a".repeat(40);
const HASH = "b".repeat(64);
const ROLE_FP = { governance: "c".repeat(64), runtime_persistence: "d".repeat(64) };
const ROLE_BUNDLE_BINDINGS = {
  governance: buildRoleBundleBinding({ role: "governance", bundleManifestSha256: "1".repeat(64), roleBundleSha256: "2".repeat(64), statementCount: 2, statementFingerprints: ["3".repeat(64), "4".repeat(64)] }),
  runtime_persistence: buildRoleBundleBinding({ role: "runtime_persistence", bundleManifestSha256: "5".repeat(64), roleBundleSha256: "6".repeat(64), statementCount: 2, statementFingerprints: ["7".repeat(64), "8".repeat(64)] }),
};
const BASE = {
  inspection_run_id: `run:${"1".repeat(32)}`,
  inspection_evidence_hash: "e".repeat(64),
  finding_ids: [`finding:${"2".repeat(32)}`, `finding:${"3".repeat(32)}`],
  selected_roles: ["runtime_persistence", "governance"],
  role_selection_required: true,
  role_selection_hash: "a1".repeat(32),
  role_object_count_fingerprints: ROLE_FP,
  role_bundle_bindings: ROLE_BUNDLE_BINDINGS,
  deployment_attestation_hash: "9".repeat(64),
  approval_id: `approval:${"5".repeat(32)}`,
  approval_hash: "6".repeat(64),
  approval_version: "v1",
  operation: "database.rebuild_empty",
  target_fingerprints: { composite: "f".repeat(64), ...ROLE_FP },
  production_sha: SHA,
  target_key: "production-runtime",
  plan_hash: HASH,
  step_hash: "9".repeat(64),
  step_id: `step:${"4".repeat(32)}`,
  target_role: "governance",
  idempotency_key: "ticket-test-idempotency-001",
  expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  nonce: "nonce:ticket-test-001",
};

const signer = { sign: async ({ ticket_hash }) => `sig:${ticket_hash}` };
const verifier = { verify: async ({ ticket_hash, ticket }) => ticket.signature === `sig:${ticket_hash}` };

async function makeTicket(overrides = {}) {
  return issueExecutionTicket({ ...BASE, ...overrides }, { signer });
}

function stagingEnv(root) {
  return {
    NODE_ENV: "staging",
    DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
    REMOTE_MCP_ENVIRONMENT: "staging",
    RECOVERY_STAGING_READINESS_DIRECTORY: path.join(root, "recovery-readiness"),
    RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY: path.join(root, "recovery-ingress"),
  };
}

test("execution ticket is signed, hash-addressed, single-use, and role-provenance bound", async () => {
  const ticket = await makeTicket();
  assert.equal(ticket.contract, "mad4b.recovery-execution-ticket.v1");
  assert.equal(ticket.ticket_id, `ticket:${ticket.ticket_hash.slice(0, 32)}`);
  assert.equal(ticket.single_use, true);
  assert.equal(ticket.secrets_included, false);
  const verified = await verifyExecutionTicket(ticket, {
    verifier,
    expected: {
      production_sha: SHA,
      plan_hash: HASH,
      step_hash: BASE.step_hash,
      step_id: BASE.step_id,
      target_key: BASE.target_key,
      target_role: BASE.target_role,
      idempotency_key: BASE.idempotency_key,
      selected_roles: ["governance", "runtime_persistence"],
      target_fingerprints: BASE.target_fingerprints,
      role_bundle_bindings: BASE.role_bundle_bindings,
      deployment_attestation_hash: BASE.deployment_attestation_hash,
    },
  });
  assert.equal(verified.valid, true);
  assert.equal(verified.ticket_hash, ticket.ticket_hash);
});

test("execution ticket tampering and cross-plan reuse fail closed", async () => {
  const ticket = await makeTicket();
  await assert.rejects(() => verifyExecutionTicket({ ...ticket, target_key: "other-target" }, { verifier }), /hash mismatch|approval_binding/u);
  await assert.rejects(() => verifyExecutionTicket(ticket, { verifier, expected: { plan_hash: "8".repeat(64) } }), /binding mismatch/u);
  await assert.rejects(() => verifyExecutionTicket(ticket, { verifier, expected: { idempotency_key: "other-idempotency" } }), /binding mismatch/u);
});

test("expired or unsigned execution tickets cannot be issued or verified", async () => {
  await assert.rejects(() => issueExecutionTicket({ ...BASE, expires_at: new Date(Date.now() - 1000).toISOString() }, { signer }), /future/u);
  await assert.rejects(() => issueExecutionTicket(BASE), /signer/u);
  const ticket = await makeTicket();
  await assert.rejects(() => verifyExecutionTicket(ticket, { verifier, now: Date.now() + 10 * 60 * 1000 }), /expired/u);
  await assert.rejects(() => verifyExecutionTicket({ ...ticket, signature: "sig:wrong" }, { verifier }), /hash mismatch|signature/u);
});

test("role-selective ticket requires durable inspection references and complete role fingerprints", () => {
  assert.throws(() => buildExecutionTicketPayload({ ...BASE, inspection_run_id: null }), /durable inspection references/u);
  assert.throws(() => buildExecutionTicketPayload({ ...BASE, role_object_count_fingerprints: { governance: ROLE_FP.governance } }), /Every selected rebuild role/u);
  const payload = buildExecutionTicketPayload(BASE);
  assert.equal(computeExecutionTicketHash(payload).length, 64);
  assert.deepEqual(payload.role_bundle_bindings, ROLE_BUNDLE_BINDINGS);
  assert.equal(payload.deployment_attestation_hash, BASE.deployment_attestation_hash);
});

test("role-bundle binding tampering changes the signed payload and fails verification", async () => {
  const ticket = await makeTicket();
  const tampered = { ...ticket, role_bundle_bindings: { ...ticket.role_bundle_bindings, governance: { ...ticket.role_bundle_bindings.governance, role_bundle_sha256: "a".repeat(64) } } };
  await assert.rejects(() => verifyExecutionTicket(tampered, { verifier }), /hash mismatch|role-bundle|invalid/u);
});

test("grant repair ticket carries and verifies the exact least-privilege grant binding hash", async () => {
  const grantBindingHash = "7".repeat(64);
  const ticket = await makeTicket({ grant_binding_hash: grantBindingHash });
  assert.equal(ticket.grant_binding_hash, grantBindingHash);
  assert.equal((await verifyExecutionTicket(ticket, { verifier, expected: { grant_binding_hash: grantBindingHash } })).valid, true);
  await assert.rejects(
    () => verifyExecutionTicket(ticket, { verifier, expected: { grant_binding_hash: "8".repeat(64) } }),
    /grant_binding_hash binding mismatch/u,
  );
});

test("Staging bootstrap authority verifies, atomically reserves, attests readback, and finalizes the server-issued grant ticket", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-bootstrap-ticket-authority-"));
  try {
    const env = stagingEnv(root);
    const roots = _testingStagingRecoveryAuthorityBinding.roots(env);
    const graph = _testingStagingRecoveryAuthorityBinding.adapters(roots.readiness, env).adapters;
    const targetFingerprint = "c".repeat(64);
    const grantBindingHash = "d".repeat(64);
    const planHash = "e".repeat(64);
    const idempotencyKey = "host-breakglass-correlation-001";
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
      target_fingerprints: { composite: targetFingerprint },
      target_fingerprint: targetFingerprint,
      production_sha: SHA,
      target_key: "staging-runtime",
      plan_hash: planHash,
      step_hash: "4".repeat(64),
      step_id: `step:${"5".repeat(32)}`,
      target_role: "composite",
      idempotency_key: idempotencyKey,
      grant_binding_hash: grantBindingHash,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      nonce: "nonce:staging-bootstrap-grants-001",
    }, { signer: graph.executionTicketSigner });
    await graph.recoveryStore.putExecutionTicket(ticket);

    const authority = createStagingBootstrapExecutionAuthority({ env });
    const expected = {
      production_sha: SHA,
      target_key: "staging-runtime",
      target_fingerprint: targetFingerprint,
      operation: "grants",
      plan_hash: planHash,
      idempotency_key: idempotencyKey,
      grant_binding_hash: grantBindingHash,
    };
    const first = await authority.verifyForBootstrap({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, expected });
    assert.equal(first.valid, true);
    assert.equal(first.reserved, true);
    assert.match(first.reservation_fingerprint, /^[a-f0-9]{64}$/u);
    assert.match(first.reservation_generation, /^[0-9a-f-]{36}$/u);
    assert.equal(first.reservation_receipt.contract, "mad4b.staging-bootstrap-reservation-receipt.v1");

    const replay = await authority.verifyForBootstrap({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, expected });
    assert.equal(replay.valid, false);
    assert.equal(replay.error_code, "RECOVERY_TICKET_ALREADY_RESERVED");
    assert.equal(replay.reconciliation_required, true);
    assert.equal(replay.automatic_rerun_allowed, false);

    await assert.rejects(
      () => authority.finalizeForBootstrap({
        ticket_id: ticket.ticket_id,
        ticket_hash: ticket.ticket_hash,
        expected,
        readback: { verified: true, same_cycle: true, database_mutation_performed: true, evidence_hash: "6".repeat(64) },
      }),
      (error) => error?.code === "RECOVERY_READBACK_UNVERIFIED",
    );

    const attested = await authority.attestReadbackForBootstrap({
      ticket_id: ticket.ticket_id,
      ticket_hash: ticket.ticket_hash,
      expected,
      reservation_receipt: first.reservation_receipt,
      evidence: {
        contract: "mad4b.staging-bootstrap-local-readback-evidence.v1",
        ticket_id: ticket.ticket_id,
        reservation_generation: first.reservation_generation,
        expected_sha: SHA,
        target_key: "staging-runtime",
        target_fingerprint: targetFingerprint,
        operation: "grants",
        plan_hash: planHash,
        idempotency_key: idempotencyKey,
        grant_binding_hash: grantBindingHash,
        role_selection_hash: null,
        status: "apply_grants_complete",
        observed_at: new Date().toISOString(),
        same_cycle: true,
        database_mutation_performed: true,
        grant_readback_by_role: { runtime: { ready: true, evidence_fingerprint: "6".repeat(64) } },
        postconditions_fingerprint: null,
        mutation_evidence_fingerprint: null,
        secrets_included: false,
      },
    });
    assert.equal(attested.verified, true);
    assert.equal(attested.readback_receipt.contract, "mad4b.staging-bootstrap-readback-receipt.v1");

    const finalized = await authority.finalizeForBootstrap({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, expected, readback_receipt: attested.readback_receipt });
    assert.equal(finalized.finalized, true);
    assert.equal(finalized.status, "finalized");
    assert.equal(finalized.audit.repair_key, "staging_database_access_repair");
    assert.equal((await graph.recoveryStore.reserveExecutionTicket({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, idempotency_key: "replay-after-finalize" })).reserved, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Staging Recovery keeps internal bootstrap authority POSTs out of the advertised GPT operation set", () => {
  const contract = buildStagingRecoveryAdminContract();
  assert.deepEqual(contract.operation_policy.advertised_methods, ["GET"]);
  assert.deepEqual(contract.operation_policy.internal_execution_authority_methods, ["POST"]);
  assert.equal(contract.paths.length, 3);
  assert.deepEqual(contract.internal_execution_authority_paths, [
    "/admin/recovery/staging/bootstrap-ticket/verify",
    "/admin/recovery/staging/bootstrap-ticket/finalize",
    "/admin/recovery/staging/bootstrap-partial-receipt",
  ]);
  assert.throws(
    () => _testingStagingRecoveryAdminRoutes.exactBootstrapBinding({ execution_ticket_id: "ticket:12345678", raw_sql: "GRANT ALL" }),
    (error) => error?.code === "RECOVERY_STAGING_BOOTSTRAP_FIELD_FORBIDDEN",
  );

  const frontendPolicy = JSON.parse(fs.readFileSync(new URL("./frontend-surface-policy.json", import.meta.url), "utf8"));
  const governedOperations = new Set(
    frontendPolicy.operation_rules
      .filter((rule) => rule.source_file === "routes/stagingRecoveryAdminRoutes.js")
      .map((rule) => rule.operation),
  );
  for (const internalPath of contract.internal_execution_authority_paths) {
    assert.equal(governedOperations.has(`POST ${internalPath}`), true);
  }
});
