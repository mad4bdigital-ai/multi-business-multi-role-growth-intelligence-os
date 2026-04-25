import IORedis from "ioredis";
import { Queue, Worker } from "bullmq";

// Redis is only created when explicitly configured.
// Absence of REDIS_URL means queue features are disabled — no connection attempt.
const REDIS_URL = process.env.REDIS_URL || "";
const QUEUE_WORKER_EXPLICITLY_ENABLED =
  String(process.env.QUEUE_WORKER_ENABLED || "").trim().toUpperCase() === "TRUE";
export const REDIS_ENABLED = !!REDIS_URL || QUEUE_WORKER_EXPLICITLY_ENABLED;
const EFFECTIVE_REDIS_URL = REDIS_URL || "redis://localhost:6379";

export const QUEUE_NAME = process.env.JOB_QUEUE_NAME || "http-generic-api";
export const WORKER_CONCURRENCY = Math.max(
  1,
  Number(process.env.WORKER_CONCURRENCY || 2)
);
const JOB_KEY_TTL = 60 * 60 * 24 * 7;  // 7 days
const IDEM_KEY_TTL = 60 * 60 * 24;     // 1 day

function newRedis() {
  const client = new IORedis(EFFECTIVE_REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      return Math.min(times * 1000, 30_000);
    },
    reconnectOnError(err) {
      return err.message.includes("READONLY");
    }
  });
  client.on("error", err => {
    if (err?.code !== "ECONNREFUSED") console.error("REDIS_ERROR:", err?.message || err);
  });
  return client;
}

export const redis = REDIS_ENABLED ? newRedis() : null;

export const jobQueue = REDIS_ENABLED
  ? new Queue(QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        removeOnComplete: false,
        removeOnFail: false
      }
    })
  : null;

if (!REDIS_ENABLED) {
  console.log("QUEUE_DISABLED: REDIS_URL not set and QUEUE_WORKER_ENABLED is not TRUE — queue features disabled.");
}

export function getRedisRuntimeStatus() {
  if (!redis) {
    return { url: "", status: "disabled", connected: false };
  }
  const status = String(redis?.status || "").trim().toLowerCase();
  return {
    url: EFFECTIVE_REDIS_URL,
    status: status || "unknown",
    connected: status === "ready"
  };
}

export async function getWaitingCountSafe() {
  if (!jobQueue) {
    return { ok: false, count: null, error: { code: "queue_disabled", message: "Queue is disabled on this instance." } };
  }
  try {
    return {
      ok: true,
      count: await jobQueue.getWaitingCount()
    };
  } catch (err) {
    return {
      ok: false,
      count: null,
      error: {
        code: err?.code || "queue_unavailable",
        message: err?.message || String(err)
      }
    };
  }
}

// ---- job state in Redis ----

export async function getJobFromRedis(jobId) {
  if (!redis) return null;
  const id = String(jobId || "").trim();
  if (!id) return null;
  try {
    const raw = await redis.get(`job:${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setJobInRedis(job) {
  if (!redis) return;
  const id = String(job?.job_id || "").trim();
  if (!id) return;
  try {
    await redis.set(`job:${id}`, JSON.stringify(job), "EX", JOB_KEY_TTL);
  } catch (err) {
    console.error("REDIS_JOB_WRITE_FAILED:", err?.message);
  }
}

export async function getAllJobsFromRedis() {
  if (!redis) return [];
  try {
    const keys = await redis.keys("job:*");
    if (!keys.length) return [];
    const values = await redis.mget(...keys);
    return values
      .filter(Boolean)
      .map(v => { try { return JSON.parse(v); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---- idempotency in Redis ----

export async function getIdempotencyEntry(key) {
  if (!redis) return null;
  const k = String(key || "").trim();
  if (!k) return null;
  try {
    return await redis.get(`idem:${k}`);
  } catch {
    return null;
  }
}

export async function setIdempotencyEntry(key, jobId) {
  if (!redis) return;
  const k = String(key || "").trim();
  if (!k) return;
  try {
    await redis.set(`idem:${k}`, String(jobId || "").trim(), "EX", IDEM_KEY_TTL);
  } catch (err) {
    console.error("REDIS_IDEM_WRITE_FAILED:", err?.message);
  }
}

export async function deleteIdempotencyEntry(key) {
  if (!redis) return;
  const k = String(key || "").trim();
  if (!k) return;
  try {
    await redis.del(`idem:${k}`);
  } catch {
    // degraded — idempotency key not removed
  }
}

export async function hasIdempotencyEntry(key) {
  if (!redis) return false;
  const k = String(key || "").trim();
  if (!k) return false;
  try {
    return (await redis.exists(`idem:${k}`)) === 1;
  } catch {
    return false;
  }
}

// ---- worker factory ----

export function createWorker(processorFn) {
  if (!REDIS_ENABLED) {
    console.log("QUEUE_WORKER_DISABLED: Redis not configured, skipping worker creation.");
    return null;
  }
  const workerRedis = newRedis();
  const worker = new Worker(QUEUE_NAME, processorFn, {
    connection: workerRedis,
    concurrency: WORKER_CONCURRENCY
  });
  worker.on("error", err => {
    if (err?.code !== "ECONNREFUSED") console.error("BULLMQ_WORKER_ERROR:", err?.message || err);
  });
  return worker;
}

// ---- shutdown ----

export async function closeQueue() {
  if (jobQueue) await jobQueue.close();
  if (redis) await redis.quit();
}
