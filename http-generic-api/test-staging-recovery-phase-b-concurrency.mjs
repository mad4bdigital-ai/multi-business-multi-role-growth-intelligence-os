import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  STAGING_RECOVERY_PHASE_B_CONCURRENCY_CONTRACT,
  wrapStagingRecoveryAdaptersForPhaseB,
  withStagingRecoverySerialFence,
} from "./stagingRecoveryPhaseBConcurrency.js";

function fakeAdapters() {
  const state = {
    approval: { approval_id: "approval:phase-b", plan_hash: "plan-hash", step_id: "step:phase-b", reserved: false, used: false },
    lease: { target_key: "staging-recovery", lease_id: "lease:old", fencing_token: "fence:old", expires_at: new Date(Date.now() - 1000).toISOString() },
  };
  const recoveryStore = {
    async reserveApproval(context) {
      await delay(15);
      if (state.approval.used || state.approval.reserved || context.plan_hash !== state.approval.plan_hash || context.step_id !== state.approval.step_id) return { reserved: false };
      state.approval.reserved = true;
      return { reserved: true };
    },
    async markApprovalUsed(id) {
      await delay(5);
      if (id !== state.approval.approval_id || state.approval.used) return { already_finalized: true };
      state.approval.used = true;
      return { finalized: true };
    },
    async releaseApprovalReservation(context) {
      if (context.approval_id === state.approval.approval_id && !state.approval.used) state.approval.reserved = false;
      return { released: true };
    },
  };
  const recoveryLock = {
    async acquire(context) {
      await delay(15);
      if (state.lease && Date.parse(state.lease.expires_at) > Date.now()) return { acquired: false };
      state.lease = { target_key: context.target_key, lease_id: "lease:new", fencing_token: "fence:new", expires_at: new Date(Date.now() + 60_000).toISOString() };
      return { acquired: true, ...state.lease };
    },
    async heartbeat(context) {
      await delay(5);
      if (!state.lease || state.lease.lease_id !== context.lease_id || state.lease.fencing_token !== context.fencing_token || Date.parse(state.lease.expires_at) <= Date.now()) return { valid: false, renewed: false };
      state.lease.expires_at = new Date(Date.now() + 60_000).toISOString();
      return { valid: true, renewed: true, ...state.lease };
    },
    async assertFence(context) {
      return { valid: Boolean(state.lease && state.lease.lease_id === context.lease_id && state.lease.fencing_token === context.fencing_token) };
    },
    async release({ target_key, lock }) {
      if (state.lease?.target_key === target_key && state.lease.lease_id === lock?.lease_id && state.lease.fencing_token === lock?.fencing_token) state.lease = null;
      return { released: true };
    },
  };
  return { state, adapters: { recoveryStore, recoveryLock } };
}

test("Phase B serialization fence is cross-call, durable-root scoped and fail-closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recovery-phase-b-fence-"));
  try {
    const events = [];
    await Promise.all([
      withStagingRecoverySerialFence({ root, scope: "approval:one" }, async () => { events.push("a:start"); await delay(25); events.push("a:end"); }),
      withStagingRecoverySerialFence({ root, scope: "approval:one" }, async () => { events.push("b:start"); events.push("b:end"); }),
    ]);
    assert.deepEqual(events, ["a:start", "a:end", "b:start", "b:end"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approval reserve and finalize cannot interleave across the same approval identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recovery-phase-b-approval-"));
  try {
    const { state, adapters } = fakeAdapters();
    const wrapped = wrapStagingRecoveryAdaptersForPhaseB(adapters, { root });
    await Promise.all([
      wrapped.recoveryStore.reserveApproval({ approval_id: state.approval.approval_id, plan_hash: state.approval.plan_hash, step_id: state.approval.step_id, idempotency_key: "idem:a" }),
      wrapped.recoveryStore.markApprovalUsed(state.approval.approval_id),
    ]);
    assert.equal(state.approval.used, true);
    const replay = await wrapped.recoveryStore.reserveApproval({ approval_id: state.approval.approval_id, plan_hash: state.approval.plan_hash, step_id: state.approval.step_id, idempotency_key: "idem:replay" });
    assert.equal(replay.reserved, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("heartbeat and release cannot resurrect or delete a takeover lease", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recovery-phase-b-lock-"));
  try {
    const { state, adapters } = fakeAdapters();
    const wrapped = wrapStagingRecoveryAdaptersForPhaseB(adapters, { root });
    const old = { target_key: "staging-recovery", lease_id: "lease:old", fencing_token: "fence:old" };
    const [takeover] = await Promise.all([
      wrapped.recoveryLock.acquire({ target_key: old.target_key, plan_hash: "plan-hash", ttl_seconds: 60 }),
      wrapped.recoveryLock.heartbeat(old),
      wrapped.recoveryLock.release({ target_key: old.target_key, lock: old }),
    ]);
    assert.equal(takeover.acquired, true);
    assert.equal(state.lease.lease_id, "lease:new");
    assert.equal(state.lease.fencing_token, "fence:new");
    assert.equal((await wrapped.recoveryLock.assertFence({ target_key: old.target_key, lease_id: "lease:new", fencing_token: "fence:new" })).valid, true);
    assert.equal((await wrapped.recoveryLock.assertFence(old)).valid, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase B concurrency contract remains secret-free", () => {
  assert.equal(STAGING_RECOVERY_PHASE_B_CONCURRENCY_CONTRACT, "mad4b.staging-recovery-phase-b-concurrency.v1");
});
