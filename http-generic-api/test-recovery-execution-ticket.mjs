import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExecutionTicketPayload,
  computeExecutionTicketHash,
  issueExecutionTicket,
  verifyExecutionTicket,
} from "./recoveryExecutionTicket.js";
import { buildRoleBundleBinding } from "./recoveryExecutionBinding.js";

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
