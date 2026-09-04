import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const STAGING_RECOVERY_PHASE_B_CONCURRENCY_CONTRACT = "mad4b.staging-recovery-phase-b-concurrency.v1";

const digest = (value) => createHash("sha256").update(String(value)).digest("hex");

function fail(code, message) {
  throw Object.assign(new Error(message), { code, status: 503, details: { secrets_included: false } });
}

function rootDirectory(root) {
  if (!path.isAbsolute(root || "")) fail("RECOVERY_PHASE_B_SERIAL_ROOT_INVALID", "Phase B serialization requires an absolute server-owned root.");
  return path.join(path.resolve(root), "phase-b-serialization");
}

async function readLease(file) {
  try {
    const raw = await readFile(file, "utf8");
    const lease = JSON.parse(raw);
    return lease && typeof lease === "object" ? lease : null;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function tryClaim(lockFile, scope, leaseMs) {
  const owner = randomUUID();
  const now = Date.now();
  const lease = {
    contract: STAGING_RECOVERY_PHASE_B_CONCURRENCY_CONTRACT,
    scope,
    owner,
    acquired_at: new Date(now).toISOString(),
    expires_at: new Date(now + leaseMs).toISOString(),
    secrets_included: false,
  };
  let handle;
  try {
    handle = await open(lockFile, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(lease)}\n`);
    await handle.sync();
    return lease;
  } catch (error) {
    if (error?.code === "EEXIST") return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function retireExpiredLease(lockFile, observed) {
  const expired = !observed?.expires_at || !Number.isFinite(Date.parse(observed.expires_at)) || Date.parse(observed.expires_at) <= Date.now();
  if (!expired) return false;
  const stale = `${lockFile}.stale.${randomUUID()}`;
  try {
    await rename(lockFile, stale);
    await rm(stale, { force: true });
    return true;
  } catch (error) {
    if (["ENOENT", "EEXIST", "EPERM", "EACCES"].includes(error?.code)) return false;
    throw error;
  }
}

export async function withStagingRecoverySerialFence({ root, scope, leaseMs = 60_000, waitMs = 15_000 } = {}, fn) {
  if (typeof fn !== "function") fail("RECOVERY_PHASE_B_SERIAL_CALLBACK_INVALID", "Phase B serialization requires a callback.");
  const normalizedScope = String(scope || "").trim();
  if (!normalizedScope) fail("RECOVERY_PHASE_B_SERIAL_SCOPE_INVALID", "Phase B serialization requires a non-empty scope.");
  const directory = rootDirectory(root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockFile = path.join(directory, `${digest(normalizedScope)}.lock`);
  const deadline = Date.now() + Math.max(100, Number(waitMs) || 15_000);
  const effectiveLeaseMs = Math.max(1_000, Number(leaseMs) || 60_000);
  let lease = null;

  while (!lease) {
    lease = await tryClaim(lockFile, normalizedScope, effectiveLeaseMs);
    if (lease) break;
    const observed = await readLease(lockFile);
    if (await retireExpiredLease(lockFile, observed)) continue;
    if (Date.now() >= deadline) fail("RECOVERY_PHASE_B_SERIAL_FENCE_BUSY", "Phase B serialization fence is busy and recovery remains fail-closed.");
    await delay(10);
  }

  try {
    return await fn();
  } finally {
    const current = await readLease(lockFile);
    if (current?.owner === lease.owner) await rm(lockFile, { force: true });
  }
}

function wrapMethod(target, method, root, scope) {
  const original = target?.[method];
  if (typeof original !== "function") return original;
  return async (...args) => withStagingRecoverySerialFence({ root, scope: scope(...args) }, () => original.apply(target, args));
}

export function wrapStagingRecoveryAdaptersForPhaseB(adapters, { root } = {}) {
  if (!adapters || typeof adapters !== "object") fail("RECOVERY_PHASE_B_ADAPTERS_INVALID", "Phase B requires the canonical Staging adapter bundle.");
  const store = adapters.recoveryStore;
  const recoveryLock = adapters.recoveryLock;
  if (!store || !recoveryLock) fail("RECOVERY_PHASE_B_ADAPTERS_INCOMPLETE", "Phase B requires durable approval and fenced-lock authorities.");

  const hardenedStore = Object.freeze({
    ...store,
    reserveApproval: wrapMethod(store, "reserveApproval", root, (context = {}) => `approval:${context.approval_id || "missing"}`),
    markApprovalUsed: wrapMethod(store, "markApprovalUsed", root, (approvalId) => `approval:${approvalId || "missing"}`),
    releaseApprovalReservation: wrapMethod(store, "releaseApprovalReservation", root, (context = {}) => `approval:${context.approval_id || "missing"}`),
  });
  const hardenedLock = Object.freeze({
    ...recoveryLock,
    acquire: wrapMethod(recoveryLock, "acquire", root, (context = {}) => `lock:${context.target_key || "missing"}`),
    heartbeat: wrapMethod(recoveryLock, "heartbeat", root, (context = {}) => `lock:${context.target_key || "missing"}`),
    assertFence: wrapMethod(recoveryLock, "assertFence", root, (context = {}) => `lock:${context.target_key || "missing"}`),
    release: wrapMethod(recoveryLock, "release", root, (context = {}) => `lock:${context.target_key || "missing"}`),
  });

  return Object.freeze({ ...adapters, recoveryStore: hardenedStore, recoveryLock: hardenedLock });
}
