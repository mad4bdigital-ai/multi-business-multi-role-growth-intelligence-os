import IORedis from "ioredis";
import { Queue, Worker } from "bullmq";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
export const QUEUE_NAME = process.env.JOB_QUEUE_NAME || "http-generic-api";
export const WORKER_CONCURRENCY = Math.max(
  1,
  Number(process.env.WORKER_CONCURRENCY || 2)
);
const JOB_KEY_TTL = 60 * 60 * 24 * 7;  // 7 days
const IDEM_KEY_TTL = 60 * 60 * 24;     // 1 day

function newRedis() {
  const client = new IORedis(REDIS_URL, {
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

export const redis = newRedis();

export const jobQueue = new Queue(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: false,
    removeOnFail: false
  }
});

export function getRedisRuntimeStatus() {
  const status = String(redis?.status || "").trim().toLowerCase();
  return {
    url: REDIS_URL,
    status: status || "unknown",
    connected: status === "ready"
  };
}

export async function getWaitingCountSafe() {
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
  const id = String(job?.job_id || "").trim();
  if (!id) return;
  try {
    await redis.set(`job:${id}`, JSON.stringify(job), "EX", JOB_KEY_TTL);
  } catch (err) {
    console.error("REDIS_JOB_WRITE_FAILED:", err?.message);
  }
}

export async function getAllJobsFromRedis() {
  const keys = await redis.keys("job:*");
  if (!keys.length) return [];
  const values = await redis.mget(...keys);
  return values
    .filter(Boolean)
    .map(v => { try { return JSON.parse(v); } catch { return null; } })
    .filter(Boolean);
}

// ---- idempotency in Redis ----

export async function getIdempotencyEntry(key) {
  const k = String(key || "").trim();
  return k ? redis.get(`idem:${k}`) : null;
}

export async function setIdempotencyEntry(key, jobId) {
  const k = String(key || "").trim();
  if (!k) return;
  await redis.set(`idem:${k}`, String(jobId || "").trim(), "EX", IDEM_KEY_TTL);
}

export async function deleteIdempotencyEntry(key) {
  const k = String(key || "").trim();
  if (k) await redis.del(`idem:${k}`);
}

export async function hasIdempotencyEntry(key) {
  const k = String(key || "").trim();
  return k ? (await redis.exists(`idem:${k}`)) === 1 : false;
}

// ---- worker factory ----

export function createWorker(processorFn) {
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
  await jobQueue.close();
  await redis.quit();
}
