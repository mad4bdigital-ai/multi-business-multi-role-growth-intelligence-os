import {
  getJobFromRedis,
  setJobInRedis,
  getIdempotencyEntry,
  setIdempotencyEntry,
  deleteIdempotencyEntry,
  hasIdempotencyEntry
} from "./queue.js";

// In-memory job store (per-worker). Writes through to Redis on every mutation.
const inMemoryJobs = new Map();

export const jobRepository = {
  get(jobId) {
    return inMemoryJobs.get(String(jobId || "").trim()) || null;
  },
  set(job) {
    const id = String(job?.job_id || "").trim();
    if (!id) return null;
    inMemoryJobs.set(id, job);
    setJobInRedis(job);
    return inMemoryJobs.get(id);
  },
  delete(jobId) {
    const id = String(jobId || "").trim();
    if (!id) return;
    inMemoryJobs.delete(id);
  },
  values() {
    return [...inMemoryJobs.values()];
  },
  size() {
    return inMemoryJobs.size;
  }
};

// Idempotency — fully async, backed by Redis.
export const idempotencyRepository = {
  async get(key) {
    return getIdempotencyEntry(key);
  },
  async set(key, jobId) {
    return setIdempotencyEntry(key, jobId);
  },
  async delete(key) {
    return deleteIdempotencyEntry(key);
  },
  async has(key) {
    return hasIdempotencyEntry(key);
  }
};

// Resolve a job by ID: in-memory first, then Redis fallback (cross-instance).
export async function resolveJob(jobId) {
  return jobRepository.get(jobId) || await getJobFromRedis(jobId);
}

export async function failAsyncSubmission(job, idempotencyLookupKey, enqueueResult) {
  if (job?.job_id) {
    jobRepository.delete(job.job_id);
  }
  if (idempotencyLookupKey) {
    await idempotencyRepository.delete(idempotencyLookupKey);
  }

  return {
    ok: false,
    error: {
      code: enqueueResult?.error?.code || "queue_unavailable",
      message: "Async job queue is unavailable.",
      details: {
        queue_error: enqueueResult?.error || null
      }
    }
  };
}
