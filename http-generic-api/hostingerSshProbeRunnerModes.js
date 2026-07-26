import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PORT as DEFAULT_PORT } from "./config.js";

export const HOSTINGER_SSH_PROBE_RUNNER_MODES = Object.freeze({
  QUEUE_WORKER: "queue_worker",
  DETACHED_PROCESS: "detached_process",
  CRON_WORKER: "cron_worker",
  EXTERNAL_RUNNER: "external_runner",
});

export const HOSTINGER_SSH_PROBE_RUNNER_MODE_SET = new Set(Object.values(HOSTINGER_SSH_PROBE_RUNNER_MODES));

const MODE_ALIASES = new Map([
  ["queue", HOSTINGER_SSH_PROBE_RUNNER_MODES.QUEUE_WORKER],
  ["queue_worker", HOSTINGER_SSH_PROBE_RUNNER_MODES.QUEUE_WORKER],
  ["bullmq", HOSTINGER_SSH_PROBE_RUNNER_MODES.QUEUE_WORKER],
  ["detached", HOSTINGER_SSH_PROBE_RUNNER_MODES.DETACHED_PROCESS],
  ["detached_process", HOSTINGER_SSH_PROBE_RUNNER_MODES.DETACHED_PROCESS],
  ["one_shot", HOSTINGER_SSH_PROBE_RUNNER_MODES.DETACHED_PROCESS],
  ["cron", HOSTINGER_SSH_PROBE_RUNNER_MODES.CRON_WORKER],
  ["cron_worker", HOSTINGER_SSH_PROBE_RUNNER_MODES.CRON_WORKER],
  ["external", HOSTINGER_SSH_PROBE_RUNNER_MODES.EXTERNAL_RUNNER],
  ["external_runner", HOSTINGER_SSH_PROBE_RUNNER_MODES.EXTERNAL_RUNNER],
  ["dedicated", HOSTINGER_SSH_PROBE_RUNNER_MODES.EXTERNAL_RUNNER],
]);

export function normalizeHostingerSshProbeRunnerMode(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return HOSTINGER_SSH_PROBE_RUNNER_MODES.QUEUE_WORKER;
  return MODE_ALIASES.get(raw) || raw;
}

export function validateHostingerSshProbeRunnerMode(value = "") {
  const mode = normalizeHostingerSshProbeRunnerMode(value);
  return HOSTINGER_SSH_PROBE_RUNNER_MODE_SET.has(mode)
    ? []
    : [`runner_mode must be one of: ${Array.from(HOSTINGER_SSH_PROBE_RUNNER_MODE_SET).join(", ")}.`];
}

export function describeHostingerSshProbeRunnerMode(modeValue = "") {
  const mode = normalizeHostingerSshProbeRunnerMode(modeValue);
  const base = { runner_mode: mode, secrets_included: false };
  switch (mode) {
    case HOSTINGER_SSH_PROBE_RUNNER_MODES.DETACHED_PROCESS:
      return {
        ...base,
        execution_surface: "detached_local_node_process",
        behavior: "Spawns a one-shot Node runner that executes the probe outside the HTTP request/Cloudflare path and writes the terminal job result to Redis.",
        request_waits_for_ssh: false,
      };
    case HOSTINGER_SSH_PROBE_RUNNER_MODES.CRON_WORKER:
      return {
        ...base,
        execution_surface: "cron_or_daemon_runner",
        behavior: "Leaves the job queued for a scheduled runner to claim by runner_mode=cron_worker and write the terminal result.",
        request_waits_for_ssh: false,
      };
    case HOSTINGER_SSH_PROBE_RUNNER_MODES.EXTERNAL_RUNNER:
      return {
        ...base,
        execution_surface: "external_dedicated_runner",
        behavior: "Leaves the job queued for a dedicated local/VPS runner. The web app only stores and reports job status.",
        request_waits_for_ssh: false,
      };
    case HOSTINGER_SSH_PROBE_RUNNER_MODES.QUEUE_WORKER:
    default:
      return {
        ...base,
        execution_surface: "bullmq_worker",
        behavior: "Uses the existing BullMQ worker execution path.",
        request_waits_for_ssh: false,
      };
  }
}

function moduleDirname() {
  return dirname(fileURLToPath(import.meta.url));
}

export function startDetachedHostingerSshProbeRunner({ jobId, mode = "detached_process", reason = "" } = {}) {
  const normalizedJobId = String(jobId || "").trim();
  if (!normalizedJobId) {
    return { ok: false, error: { code: "job_id_required", message: "jobId is required." }, secrets_included: false };
  }
  const runnerMode = normalizeHostingerSshProbeRunnerMode(mode);
  if (runnerMode !== HOSTINGER_SSH_PROBE_RUNNER_MODES.DETACHED_PROCESS) {
    return { ok: false, error: { code: "detached_runner_mode_required", message: "Detached runner starter only supports detached_process mode." }, secrets_included: false };
  }
  const scriptPath = join(moduleDirname(), "scripts", "hostingerSshProbeDetachedRunner.mjs");
  const child = spawn(process.execPath, [scriptPath, "--job-id", normalizedJobId, "--mode", "detached_process"], {
    cwd: moduleDirname(),
    detached: true,
    stdio: "ignore",
    shell: false,
    env: {
      ...process.env,
      HOSTINGER_SSH_PROBE_RUNNER_REASON: String(reason || "").slice(0, 500),
      HOSTINGER_SSH_PROBE_RUNNER_PARENT_PID: String(process.pid || ""),
      HOSTINGER_SSH_PROBE_RUNNER_BASE_URL: process.env.HOSTINGER_SSH_PROBE_RUNNER_BASE_URL || `http://127.0.0.1:${DEFAULT_PORT}`,
    },
  });
  child.unref();
  return {
    ok: true,
    job_id: normalizedJobId,
    runner_mode: runnerMode,
    pid: child.pid || null,
    started: true,
    secrets_included: false,
  };
}
