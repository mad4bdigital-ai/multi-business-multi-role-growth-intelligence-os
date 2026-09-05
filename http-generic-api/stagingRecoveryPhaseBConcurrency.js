import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const STAGING_RECOVERY_PHASE_B_CONCURRENCY_CONTRACT = "mad4b.staging-recovery-phase-b-concurrency.v2";

const digest = (value) => createHash("sha256").update(String(value)).digest("hex");

function fail(code, message) {
  throw Object.assign(new Error(message), { code, status: 503, details: { secrets_included: false } });
}

function rootDirectory(root) {
  if (!path.isAbsolute(root || "")) fail("RECOVERY_PHASE_B_SERIAL_ROOT_INVALID", "Phase B serialization requires an absolute server-owned root.");
  return path.join(path.resolve(root), "phase-b-serialization");
}

function scopePaths(root, scope) {
  const directory = rootDirectory(root);
  const scopeHash = digest(scope);
  return {
    directory,
    scopeHash,
    lockFile: path.join(directory, `${scopeHash}.lock`),
    transitionDirectory: path.join(directory, `${scopeHash}.transition`),
    heartbeatPrefix: `${scopeHash}.heartbeat.`,
  };
}

async function readJson(file) {
  try {
    const raw = await readFile(file, "utf8");
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : null;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function immutableWrite(file, value) {
  let handle;
  try {
    handle = await open(file, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function withTransitionGate(paths, waitMs, fn) {
  const deadline = Date.now() + Math.max(100, Number(waitMs) || 15_000);
  while (true) {
    try {
      await mkdir(paths.transitionDirectory, { mode: 0o700 });
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        fail("RECOVERY_PHASE_B_TRANSITION_GATE_BUSY", "Phase B generation transition gate is busy; automatic stale-gate deletion is forbidden.");
      }
      await delay(10);
    }
  }
  try {
    return await fn();
  } finally {
    await rm(paths.transitionDirectory, { recursive: true, force: true });
  }
}

async function heartbeatRecords(paths, generationId) {
  let names = [];
  try {
    names = await readdir(paths.directory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const prefix = `${paths.heartbeatPrefix}${generationId}.`;
  const records = [];
  for (const name of names.filter((entry) => entry.startsWith(prefix))) {
    const record = await readJson(path.join(paths.directory, name));
    if (record?.generation_id === generationId && Number.isFinite(Date.parse(record.expires_at))) records.push(record);
  }
  return records;
}

async function readLeaseState(paths) {
  const lease = await readJson(paths.lockFile);
  if (!lease) return null;
  const heartbeats = await heartbeatRecords(paths, lease.generation_id);
  const effectiveExpiry = [lease.expires_at, ...heartbeats.map((entry) => entry.expires_at)]
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
  return {
    ...lease,
    effective_expires_at: Number.isFinite(effectiveExpiry) ? new Date(effectiveExpiry).toISOString() : null,
    heartbeat_count: heartbeats.length,
  };
}

async function removeGenerationHeartbeats(paths, generationId) {
  let names = [];
  try {
    names = await readdir(paths.directory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const prefix = `${paths.heartbeatPrefix}${generationId}.`;
  await Promise.all(names.filter((entry) => entry.startsWith(prefix))
    .map((entry) => rm(path.join(paths.directory, entry), { force: true })));
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true; // Unknown owner is fail-closed.
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    return true; // EPERM/unknown means do not take over.
  }
}

async function claimGeneration(paths, scope, leaseMs, {
  now = Date.now(),
  ownerPid = process.pid,
  waitMs = 15_000,
} = {}) {
  return withTransitionGate(paths, waitMs, async () => {
    if (await readJson(paths.lockFile)) return null;
    const generationId = randomUUID();
    const owner = randomUUID();
    const lease = {
      contract: STAGING_RECOVERY_PHASE_B_CONCURRENCY_CONTRACT,
      scope,
      generation_id: generationId,
      owner,
      owner_pid: ownerPid,
      acquired_at: new Date(now).toISOString(),
      expires_at: new Date(now + leaseMs).toISOString(),
      secrets_included: false,
    };
    return await immutableWrite(paths.lockFile, lease) ? lease : null;
  });
}

async function renewGeneration(paths, lease, leaseMs, { waitMs = 15_000, now = Date.now() } = {}) {
  return withTransitionGate(paths, waitMs, async () => {
    const current = await readJson(paths.lockFile);
    if (!current || current.generation_id !== lease.generation_id || current.owner !== lease.owner) return false;
    const heartbeat = {
      contract: STAGING_RECOVERY_PHASE_B_CONCURRENCY_CONTRACT,
      scope: lease.scope,
      generation_id: lease.generation_id,
      owner: lease.owner,
      owner_pid: lease.owner_pid,
      renewed_at: new Date(now).toISOString(),
      expires_at: new Date(now + leaseMs).toISOString(),
      secrets_included: false,
    };
    const file = path.join(paths.directory, `${paths.heartbeatPrefix}${lease.generation_id}.${now}.${randomUUID()}.json`);
    return immutableWrite(file, heartbeat);
  });
}

async function retireExpiredGeneration(paths, observed, {
  waitMs = 15_000,
  now = Date.now(),
  isOwnerAlive = processAlive,
} = {}) {
  if (!observed?.generation_id || !observed?.owner) return false;
  return withTransitionGate(paths, waitMs, async () => {
    const current = await readLeaseState(paths);
    if (!current
      || current.generation_id !== observed.generation_id
      || current.owner !== observed.owner) return false;
    const expiry = Date.parse(current.effective_expires_at || current.expires_at || "");
    if (!Number.isFinite(expiry) || expiry > now) return false;
    if (isOwnerAlive(current.owner_pid) !== false) return false;
    await rm(paths.lockFile, { force: true });
    await removeGenerationHeartbeats(paths, current.generation_id);
    return true;
  });
}

async function releaseGeneration(paths, lease, { waitMs = 15_000 } = {}) {
  if (!lease?.generation_id || !lease?.owner) return false;
  return withTransitionGate(paths, waitMs, async () => {
    const current = await readJson(paths.lockFile);
    if (!current
      || current.generation_id !== lease.generation_id
      || current.owner !== lease.owner) return false;
    await rm(paths.lockFile, { force: true });
    await removeGenerationHeartbeats(paths, lease.generation_id);
    return true;
  });
}

async function assertGenerationOwned(paths, lease) {
  const current = await readLeaseState(paths);
  return Boolean(current
    && current.generation_id === lease.generation_id
    && current.owner === lease.owner
    && (Date.parse(current.effective_expires_at || current.expires_at || "") > Date.now() || current.owner_pid === process.pid));
}

export async function withStagingRecoverySerialFence({
  root,
  scope,
  leaseMs = 60_000,
  waitMs = 15_000,
} = {}, fn) {
  if (typeof fn !== "function") fail("RECOVERY_PHASE_B_SERIAL_CALLBACK_INVALID", "Phase B serialization requires a callback.");
  const normalizedScope = String(scope || "").trim();
  if (!normalizedScope) fail("RECOVERY_PHASE_B_SERIAL_SCOPE_INVALID", "Phase B serialization requires a non-empty scope.");
  const paths = scopePaths(root, normalizedScope);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + Math.max(100, Number(waitMs) || 15_000);
  const effectiveLeaseMs = Math.max(200, Number(leaseMs) || 60_000);
  let lease = null;

  while (!lease) {
    lease = await claimGeneration(paths, normalizedScope, effectiveLeaseMs, { waitMs });
    if (lease) break;
    const observed = await readLeaseState(paths);
    if (observed && await retireExpiredGeneration(paths, observed, { waitMs })) continue;
    if (Date.now() >= deadline) fail("RECOVERY_PHASE_B_SERIAL_FENCE_BUSY", "Phase B serialization fence is busy and recovery remains fail-closed.");
    await delay(10);
  }

  let stopHeartbeat = false;
  let heartbeatFailure = null;
  const heartbeatAbort = new AbortController();
  const heartbeatIntervalMs = Math.max(50, Math.min(Math.floor(effectiveLeaseMs / 3), 5_000));
  const heartbeatLoop = (async () => {
    while (!stopHeartbeat) {
      try {
        await delay(heartbeatIntervalMs, undefined, { signal: heartbeatAbort.signal });
      } catch (error) {
        if (error?.name === "AbortError" && stopHeartbeat) break;
        heartbeatFailure = error;
        break;
      }
      if (stopHeartbeat) break;
      try {
        const renewed = await renewGeneration(paths, lease, effectiveLeaseMs, { waitMs });
        if (!renewed) {
          heartbeatFailure = Object.assign(new Error("Phase B serialization generation was lost during callback execution."), {
            code: "RECOVERY_PHASE_B_SERIAL_GENERATION_LOST",
            status: 503,
            details: { secrets_included: false },
          });
          break;
        }
      } catch (error) {
        heartbeatFailure = error;
        break;
      }
    }
  })();

  try {
    const result = await fn(Object.freeze({
      generation_id: lease.generation_id,
      owner: lease.owner,
      assert_owned: async () => {
        if (!await assertGenerationOwned(paths, lease)) {
          fail("RECOVERY_PHASE_B_SERIAL_GENERATION_LOST", "Phase B serialization generation is no longer current.");
        }
        return true;
      },
    }));
    if (heartbeatFailure) throw heartbeatFailure;
    return result;
  } finally {
    stopHeartbeat = true;
    heartbeatAbort.abort();
    await heartbeatLoop.catch(() => {});
    await releaseGeneration(paths, lease, { waitMs });
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

export const _testingStagingRecoveryPhaseBConcurrency = Object.freeze({
  scopePaths,
  readLeaseState,
  claimGeneration,
  renewGeneration,
  retireExpiredGeneration,
  releaseGeneration,
  assertGenerationOwned,
});
