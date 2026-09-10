import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _testingStagingRecoveryPhaseB } from "./stagingRecoveryAuthorityBindingPhaseB.js";

const challenge = Object.freeze({
  approval_id: `approval:${"a".repeat(32)}`,
  plan_hash: "b".repeat(64),
  step_id: `step:${"c".repeat(32)}`,
});

test("Phase B reuses one durable server token instead of issuing a second token for the same approval", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-recovery-phase-b-approval-"));
  let issueCount = 0;
  const baseIssuer = Object.freeze({
    async createChallenge() {
      issueCount += 1;
      return {
        authority: "server_managed",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        server_token: "phase-b-single-issued-server-token",
      };
    },
  });

  try {
    const issuer = _testingStagingRecoveryPhaseB.phaseBApprovalIssuer(baseIssuer, root);
    const first = await issuer.createChallenge(challenge);
    const second = await issuer.createChallenge(challenge);

    assert.equal(issueCount, 1, "one approval id must cause exactly one cryptographic token issuance");
    assert.equal(second.server_token, first.server_token, "the internal retry must resolve the exact first token");
    assert.equal(second.expires_at, first.expires_at);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase B refuses to rebind an approval-token handle to a different plan step", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-recovery-phase-b-rebind-"));
  const baseIssuer = Object.freeze({
    async createChallenge() {
      return {
        authority: "server_managed",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        server_token: "phase-b-single-issued-server-token",
      };
    },
  });

  try {
    const issuer = _testingStagingRecoveryPhaseB.phaseBApprovalIssuer(baseIssuer, root);
    await issuer.createChallenge(challenge);
    await assert.rejects(
      () => issuer.createChallenge({ ...challenge, plan_hash: "d".repeat(64) }),
      (error) => error?.code === "RECOVERY_PHASE_B_APPROVAL_TOKEN_BINDING_MISMATCH",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
