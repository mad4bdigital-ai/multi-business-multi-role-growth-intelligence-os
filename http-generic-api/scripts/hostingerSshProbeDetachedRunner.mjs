#!/usr/bin/env node
import process from "node:process";
import {
  getJobFromRedis,
  setJobInRedis,
  getAllJobsFromRedis,
  closeQueue,
} from "../queue.js";
import { nowIso, normalizeJobStatus, buildStaleJobTimeoutPayload } from "../jobUtils.js";
import {
  HOSTINGER_SSH_TARGET_PROBE_JOB_TYPE,
  runHostingerSshTargetProbeJob,
} from "../hostingerSshDeployExecutor.js";
import {
  HOSTINGER_SSH_PROBE_RUNNER_MODES,
  normalizeHostingerSshProbeRunnerMode,
} from "../hostingerSshProbeRunnerModes.js";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function safeError(err, fallbackCode = "detached_probe_runner_failed") {
  return {
    ok: false,
    error: {
      code: err?.code || fallbackCode,
      message: err?.message || String(err),
      details: err?.details || null,
    },
    secrets_included: false,
  };
}

function shouldClaim(job, mode) {
  if (!job || String(job.job_type || "").trim() !== HOSTINGER_SSH_TARGET_PROBE_JOB_TYPE) return false;
  if (normalizeJobStatus(job.status) !== "queued") return false;
  const requestedMode = normalizeHostingerSshProbeRunnerMode(job.request_payload?.runner_mode || job.runner_mode || "queue_worker");
  return requestedMode === mode;
}

async function runOne(job, mode) {
  const startedAt = nowIso();
  job.status = "running";
  job.updated_at = startedAt;
  job.attempt_count = Number(job.attempt_count || 0) + 1;
  job.runner_mode = mode;
  job.runner_started_at = startedAt;
  await setJobInRedis(job);

  const timeoutMs = Math.max(1000, Math.min(Number(job.request_payload?.timeout_ms || 45000), 75000)) + 15000;
  let timer = null;
  try {
    const timeoutOutcome = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, stale_timeout: true }), timeoutMs);
    });
    const probePromise = runHostingerSshTargetProbeJob({ ...(job.request_payload || {}), worker_job_id: job.job_id, runner_mode: mode });
    const result = await Promise.race([probePromise, timeoutOutcome]);
    if (result?.stale_timeout) {
      job.status = "failed";
      job.completed_at = nowIso();
      job.result_payload = null;
      job.error_payload = buildStaleJobTimeoutPayload(job);
    } else if (result?.ok === true) {
      job.status = "succeeded";
      job.completed_at = nowIso();
      job.result_payload = { ...result, worker_job_id: job.job_id, runner_mode: mode, secrets_included: false };
      job.error_payload = null;
    } else {
      job.status = "failed";
      job.completed_at = nowIso();
      job.result_payload = null;
      job.error_payload = { ...(result || { ok: false, error: { code: "hostinger_probe_failed", message: "Hostinger SSH probe failed." } }), worker_job_id: job.job_id, runner_mode: mode, secrets_included: false };
    }
  } catch (err) {
    job.status = "failed";
    job.completed_at = nowIso();
    job.result_payload = null;
    job.error_payload = { ...safeError(err), worker_job_id: job.job_id, runner_mode: mode };
  } finally {
    if (timer) clearTimeout(timer);
    job.updated_at = nowIso();
    await setJobInRedis(job);
  }
  return job;
}

async function main() {
  const mode = normalizeHostingerSshProbeRunnerMode(argValue("--mode") || process.env.HOSTINGER_SSH_PROBE_RUNNER_MODE || HOSTINGER_SSH_PROBE_RUNNER_MODES.DETACHED_PROCESS);
  const jobId = argValue("--job-id") || process.env.HOSTINGER_SSH_PROBE_JOB_ID || "";
  const limit = Math.max(1, Math.min(Number(argValue("--limit") || process.env.HOSTINGER_SSH_PROBE_RUNNER_LIMIT || 5), 25));
  const jobs = [];
  if (jobId) {
    const job = await getJobFromRedis(jobId);
    if (job && shouldClaim(job, mode)) jobs.push(job);
  } else if (mode === HOSTINGER_SSH_PROBE_RUNNER_MODES.CRON_WORKER) {
    const all = await getAllJobsFromRedis();
    jobs.push(...all.filter(job => shouldClaim(job, mode)).slice(0, limit));
  }

  if (!jobs.length) {
    console.log(JSON.stringify({ ok: true, claimed: 0, runner_mode: mode, secrets_included: false }));
    return;
  }

  const results = [];
  for (const job of jobs) {
    const finished = await runOne(job, mode);
    results.push({ job_id: finished.job_id, status: finished.status, error_code: finished.error_payload?.error?.code || "", secrets_included: false });
  }
  console.log(JSON.stringify({ ok: true, runner_mode: mode, claimed: results.length, results, secrets_included: false }));
}

main()
  .catch((err) => {
    console.error(JSON.stringify(safeError(err)));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueue().catch(() => {});
  });
