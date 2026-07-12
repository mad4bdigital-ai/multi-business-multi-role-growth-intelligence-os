import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HOSTINGER_SSH_PROBE_RUNNER_MODES,
  normalizeHostingerSshProbeRunnerMode,
  validateHostingerSshProbeRunnerMode,
  describeHostingerSshProbeRunnerMode,
} from "./hostingerSshProbeRunnerModes.js";
import {
  normalizeHostingerSshTargetProbeJobPayload,
  normalizeSshPasswordTransport,
  resolveSshPasswordTransport,
  validateHostingerSshTargetProbeJobPayload,
} from "./hostingerSshDeployExecutor.js";

const basePayload = {
  target_id: "b49fe2ae-5974-11f1-9baf-8e76a7e1749f",
  app_key: "auth.mad4b.com",
  app_path: "/home/u338416126/domains/auth.mad4b.com/nodejs",
  expected_commit_sha: "1f1659c0023dc73b316e7b3230e9966859f778c6",
  ssh_auth_mode: "password",
  activate_on_success: true,
  approval_reason: "approved read-only Hostinger SSH probe runner mode test",
};

assert.equal(normalizeHostingerSshProbeRunnerMode("queue"), HOSTINGER_SSH_PROBE_RUNNER_MODES.QUEUE_WORKER);
assert.equal(normalizeHostingerSshProbeRunnerMode("detached"), HOSTINGER_SSH_PROBE_RUNNER_MODES.DETACHED_PROCESS);
assert.equal(normalizeHostingerSshProbeRunnerMode("one_shot"), HOSTINGER_SSH_PROBE_RUNNER_MODES.DETACHED_PROCESS);
assert.equal(normalizeHostingerSshProbeRunnerMode("cron"), HOSTINGER_SSH_PROBE_RUNNER_MODES.CRON_WORKER);
assert.equal(normalizeHostingerSshProbeRunnerMode("dedicated"), HOSTINGER_SSH_PROBE_RUNNER_MODES.EXTERNAL_RUNNER);
assert.deepEqual(validateHostingerSshProbeRunnerMode("bad_mode").length, 1);

for (const runner_mode of Object.values(HOSTINGER_SSH_PROBE_RUNNER_MODES)) {
  const payload = normalizeHostingerSshTargetProbeJobPayload({ ...basePayload, runner_mode });
  assert.equal(payload.runner_mode, runner_mode);
  assert.deepEqual(validateHostingerSshTargetProbeJobPayload(payload), []);
  const description = describeHostingerSshProbeRunnerMode(runner_mode);
  assert.equal(description.runner_mode, runner_mode);
  assert.equal(description.request_waits_for_ssh, false);
  assert.equal(description.secrets_included, false);
}

assert.equal(normalizeSshPasswordTransport("SSHPASS"), "sshpass");
assert.equal(normalizeSshPasswordTransport("askpass"), "askpass");
assert.equal(normalizeSshPasswordTransport("auto"), "auto");
assert.equal(resolveSshPasswordTransport("sshpass", () => false), "sshpass");
assert.equal(resolveSshPasswordTransport("askpass", () => true), "askpass");
assert.equal(resolveSshPasswordTransport("auto", () => true), "sshpass");
assert.equal(resolveSshPasswordTransport("auto", () => false), "askpass");

for (const ssh_transport_mode of ["auto", "sshpass", "askpass"]) {
  const payload = normalizeHostingerSshTargetProbeJobPayload({ ...basePayload, ssh_transport_mode });
  assert.equal(payload.ssh_transport_mode, ssh_transport_mode);
  assert.deepEqual(validateHostingerSshTargetProbeJobPayload({ ...basePayload, ssh_transport_mode }), []);
}

const legacyTransportAliasPayload = normalizeHostingerSshTargetProbeJobPayload({
  ...basePayload,
  ssh_password_transport: "askpass",
});
assert.equal(legacyTransportAliasPayload.ssh_transport_mode, "askpass");
assert.equal(Object.hasOwn(legacyTransportAliasPayload, "ssh_password_transport"), false);

const invalidTransportErrors = validateHostingerSshTargetProbeJobPayload({
  ...basePayload,
  ssh_transport_mode: "unsupported_transport",
});
assert.equal(
  invalidTransportErrors.some((message) => message.includes("ssh_transport_mode must be auto, sshpass, or askpass")),
  true,
  "unknown SSH transport modes must be rejected explicitly"
);

const asyncSource = readFileSync(new URL("./executionAsync.js", import.meta.url), "utf8");
assert(asyncSource.includes("HOSTINGER_SSH_PROBE_RUNNER_MODES.DETACHED_PROCESS"), "async submission must support detached_process mode");
assert(asyncSource.includes("HOSTINGER_SSH_PROBE_RUNNER_MODES.CRON_WORKER"), "async submission must support cron_worker mode");
assert(asyncSource.includes("HOSTINGER_SSH_PROBE_RUNNER_MODES.EXTERNAL_RUNNER"), "async submission must support external_runner mode");
assert(asyncSource.includes("queued_in_bullmq: false"), "non-queue runner modes must not enqueue to BullMQ by default");
const firstPersist = asyncSource.indexOf("await jobRepository.set(job)");
const detachedStart = asyncSource.indexOf("const detached = startDetachedHostingerSshProbeRunner");
assert(firstPersist >= 0, "async submission must await durable job persistence before runner dispatch");
assert(detachedStart > firstPersist, "detached runner must start only after the job is persisted for Redis-backed claiming");

const runnerSource = readFileSync(new URL("./scripts/hostingerSshProbeDetachedRunner.mjs", import.meta.url), "utf8");
assert(runnerSource.includes("runHostingerSshTargetProbeJob"), "detached runner must execute the governed Hostinger probe job entrypoint");
assert(runnerSource.includes("getAllJobsFromRedis"), "cron_worker mode must scan Redis-backed queued jobs");
assert(runnerSource.includes("setJobInRedis"), "runner must persist terminal job state in Redis");
assert(!runnerSource.includes("SSHPASS"), "runner must not use SSHPASS env");

console.log("Hostinger SSH probe runner mode contract tests passed.");
