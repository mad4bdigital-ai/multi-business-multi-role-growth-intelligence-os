const inMemoryJobs = new Map();

export function getInMemoryJobs() {
  return inMemoryJobs;
}

export function createJobRepository({ setJobInRedis, getJobFromRedis, debugLog }) {
  return {
    get(id) {
      return inMemoryJobs.get(String(id || "").trim()) || null;
    },

    async getWithFallback(id) {
      const normalizedId = String(id || "").trim();
      if (!normalizedId) return null;

      const local = inMemoryJobs.get(normalizedId);
      if (local) return local;

      try {
        const fromRedis = await getJobFromRedis(normalizedId);
        if (fromRedis) {
          inMemoryJobs.set(normalizedId, fromRedis);
          return fromRedis;
        }
      } catch (err) {
        if (debugLog) debugLog("jobRepository.getWithFallback redis error", err?.message || err);
      }

      return null;
    },

    async set(job) {
      const id = String(job?.job_id || "").trim();
      if (!id) return null;
      inMemoryJobs.set(id, job);
      await setJobInRedis(job);
      return job;
    },

    delete(id) {
      const normalizedId = String(id || "").trim();
      if (!normalizedId) return;
      inMemoryJobs.delete(normalizedId);
    },

    has(id) {
      return inMemoryJobs.has(String(id || "").trim());
    },

    values() {
      return [...inMemoryJobs.values()];
    },

    size() {
      return inMemoryJobs.size;
    }
  };
}

export function createIdempotencyRepository({ getByIdempotencyKey, setByIdempotencyKey, deleteByIdempotencyKey, hasByIdempotencyKey }) {
  return {
    async get(key) {
      return getByIdempotencyKey(key);
    },
    async set(key, value) {
      return setByIdempotencyKey(key, value);
    },
    async delete(key) {
      return deleteByIdempotencyKey(key);
    },
    async has(key) {
      return hasByIdempotencyKey(key);
    }
  };
}

export async function resolveJob(jobRepository, id) {
  return jobRepository.getWithFallback(id);
}

export async function failAsyncSubmission(jobRepository, idempotencyRepository, job, errorLike, idempotencyLookupKey) {
  const message =
    errorLike?.message ||
    (typeof errorLike === "string" ? errorLike : "Async submission failed");

  const failed = {
    ...job,
    status: "failed",
    error: message,
    finished_at: new Date().toISOString()
  };

  await jobRepository.set(failed);

  if (idempotencyLookupKey && idempotencyRepository) {
    await idempotencyRepository.delete(idempotencyLookupKey);
  }

  return {
    ok: false,
    error: {
      code: errorLike?.code || "queue_unavailable",
      message: "Async job queue is unavailable.",
      details: {
        queue_error: errorLike || null
      }
    }
  };
}
