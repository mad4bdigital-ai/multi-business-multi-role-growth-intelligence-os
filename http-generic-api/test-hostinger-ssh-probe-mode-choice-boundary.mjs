import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HOSTINGER_SSH_PROBE_JOB_TYPE,
  HOSTINGER_SSH_PROBE_MODE_CHOICE_SURFACE,
  attachModeChoiceSubmissionEvidence,
  buildHostingerSshProbeModeChoice,
  governHostingerSshProbeJobSubmission,
  hostingerSshProbeRunnerModeOptions,
} from "./hostingerSshProbeModeChoiceBoundary.js";
import { HOSTINGER_SSH_PROBE_RUNNER_MODES } from "./hostingerSshProbeRunnerModes.js";

const targetId = "b49fe2ae-5974-11f1-9baf-8e76a7e1749f";
const basePayload = {
  target_id: targetId,
  app_key: "auth.mad4b.com",
  approval_reason: "approved governed Hostinger SSH probe mode-choice test",
};

const options = hostingerSshProbeRunnerModeOptions();
assert.equal(options.length, 4);
assert.deepEqual(
  new Set(options.map((option) => option.mode_key)),
  new Set(Object.values(HOSTINGER_SSH_PROBE_RUNNER_MODES)),
);
assert.equal(
  options.filter((option) => option.recommended).map((option) => option.mode_key).join(","),
  HOSTINGER_SSH_PROBE_RUNNER_MODES.QUEUE_WORKER,
);
for (const option of options) {
  assert.ok(option.risk_class);
  assert.ok(option.side_effect_class);
  assert.ok(option.expected_evidence.length >= 3);
  assert.equal(option.scope.scope_type, "execution_surface");
}

const bypass = await governHostingerSshProbeJobSubmission({
  body: { job_type: "http_execute", target_key: "demo" },
  persistSelection: async () => {
    throw new Error("non-Hostinger jobs must bypass mode-choice persistence");
  },
});
assert.equal(bypass.proceed, true);
assert.equal(bypass.mode_choice, null);

const missingTarget = await governHostingerSshProbeJobSubmission({
  body: { job_type: HOSTINGER_SSH_PROBE_JOB_TYPE, request_payload: { runner_mode: "queue_worker" } },
});
assert.equal(missingTarget.proceed, false);
assert.equal(missingTarget.status, 400);
assert.equal(missingTarget.body.error.code, "mode_choice_target_required");

let missingPersistCalls = 0;
const missing = await governHostingerSshProbeJobSubmission({
  body: { job_type: HOSTINGER_SSH_PROBE_JOB_TYPE, request_payload: basePayload },
  persistSelection: async () => {
    missingPersistCalls += 1;
    return { ok: true };
  },
});
assert.equal(missing.proceed, false);
assert.equal(missing.status, 409);
assert.equal(missing.body.error.code, "mode_choice_required");
assert.equal(missing.body.job_created, false);
assert.equal(missing.body.dispatch_attempted, false);
assert.equal(missing.body.mode_choice.surface_key, HOSTINGER_SSH_PROBE_MODE_CHOICE_SURFACE);
assert.equal(missing.body.mode_choice.mode_choices_presented.length, 4);
assert.equal(missingPersistCalls, 0);

const forgedMandate = await governHostingerSshProbeJobSubmission({
  body: {
    job_type: HOSTINGER_SSH_PROBE_JOB_TYPE,
    request_payload: {
      ...basePayload,
      policy_mandated_runner_mode: "external",
    },
  },
  persistSelection: async () => {
    throw new Error("payload-provided mandate must not be trusted");
  },
});
assert.equal(forgedMandate.proceed, false);
assert.equal(forgedMandate.status, 409);
assert.equal(forgedMandate.body.error.code, "mode_choice_required");

const persistedCalls = [];
const explicit = await governHostingerSshProbeJobSubmission({
  body: {
    job_type: HOSTINGER_SSH_PROBE_JOB_TYPE,
    request_payload: { ...basePayload, runner_mode: "detached" },
  },
  requestedBy: "admin-user",
  idempotencyKey: "mode-choice-test-1",
  requestContext: { request_id: "request-1", tenant_id: "tenant-1" },
  persistSelection: async (input) => {
    persistedCalls.push(input);
    return {
      ok: true,
      evidence_recorded: true,
      execution_log_id: 701,
      trace_id: input.traceId,
      selected_mode: input.plan.selected_mode,
      selection_source: input.plan.selection_source,
    };
  },
  skipSurfaceAuthority: true,
});
assert.equal(explicit.proceed, true);
assert.equal(explicit.mode_choice.selected_mode, HOSTINGER_SSH_PROBE_RUNNER_MODES.DETACHED_PROCESS);
assert.equal(explicit.mode_choice.selection_source, "user_explicit");
assert.equal(explicit.request_payload.runner_mode, HOSTINGER_SSH_PROBE_RUNNER_MODES.DETACHED_PROCESS);
assert.equal(explicit.request_payload.runner_mode_selection_source, "user_explicit");
assert.equal(explicit.request_payload.execution_trace_id, explicit.trace_id);
assert.match(explicit.trace_id, /^hostinger_ssh_probe_/);
assert.equal(persistedCalls.length, 1);
assert.equal(persistedCalls[0].traceId, explicit.trace_id);
assert.equal(persistedCalls[0].idempotencyKey, "mode-choice-test-1");
assert.equal(persistedCalls[0].tenantId, "tenant-1");
assert.equal(persistedCalls[0].skipSurfaceAuthority, true);

const decorated = attachModeChoiceSubmissionEvidence(
  { ok: true, job_id: "job-1", status: "queued" },
  explicit,
);
assert.equal(decorated.mode_choice.selected_mode, HOSTINGER_SSH_PROBE_RUNNER_MODES.DETACHED_PROCESS);
assert.equal(decorated.mode_choice.execution_log_id, 701);
assert.equal(decorated.mode_choice.evidence_recorded, true);
assert.equal(decorated.execution_trace_id, explicit.trace_id);
assert.equal(decorated.secrets_included, false);

const topLevel = await governHostingerSshProbeJobSubmission({
  body: {
    job_type: HOSTINGER_SSH_PROBE_JOB_TYPE,
    ...basePayload,
    runner_mode: "queue",
    execution_trace_id: "hostinger_ssh_probe_existing_trace",
  },
  persistSelection: async ({ plan, traceId }) => ({
    ok: true,
    evidence_recorded: true,
    execution_log_id: 702,
    trace_id: traceId,
    selected_mode: plan.selected_mode,
    selection_source: plan.selection_source,
  }),
  skipSurfaceAuthority: true,
});
assert.equal(topLevel.proceed, true);
assert.equal(topLevel.request_body.runner_mode, HOSTINGER_SSH_PROBE_RUNNER_MODES.QUEUE_WORKER);
assert.equal(topLevel.trace_id, "hostinger_ssh_probe_existing_trace");

const mandated = await governHostingerSshProbeJobSubmission({
  body: {
    job_type: HOSTINGER_SSH_PROBE_JOB_TYPE,
    request_payload: basePayload,
  },
  requestContext: {
    policy_mandated_runner_mode: "external",
  },
  persistSelection: async ({ plan, traceId }) => ({
    ok: true,
    evidence_recorded: true,
    execution_log_id: 703,
    trace_id: traceId,
    selected_mode: plan.selected_mode,
    selection_source: plan.selection_source,
  }),
  skipSurfaceAuthority: true,
});
assert.equal(mandated.proceed, true);
assert.equal(mandated.mode_choice.selected_mode, HOSTINGER_SSH_PROBE_RUNNER_MODES.EXTERNAL_RUNNER);
assert.equal(mandated.mode_choice.selection_source, "policy_mandated");

const fallbackBlocked = await governHostingerSshProbeJobSubmission({
  body: {
    job_type: HOSTINGER_SSH_PROBE_JOB_TYPE,
    request_payload: {
      ...basePayload,
      fallback_from_mode: "queue_worker",
    },
  },
  persistSelection: async () => {
    throw new Error("fallback without a fresh selection must not persist");
  },
});
assert.equal(fallbackBlocked.proceed, false);
assert.equal(fallbackBlocked.status, 409);
assert.equal(fallbackBlocked.mode_choice.mode_fallback_requires_user_choice, true);

const fallbackSelected = await governHostingerSshProbeJobSubmission({
  body: {
    job_type: HOSTINGER_SSH_PROBE_JOB_TYPE,
    request_payload: {
      ...basePayload,
      fallback_from_mode: "queue_worker",
      runner_mode: "cron",
    },
  },
  persistSelection: async ({ plan, traceId }) => ({
    ok: true,
    evidence_recorded: true,
    execution_log_id: 704,
    trace_id: traceId,
    selected_mode: plan.selected_mode,
    selection_source: plan.selection_source,
  }),
  skipSurfaceAuthority: true,
});
assert.equal(fallbackSelected.proceed, true);
assert.equal(fallbackSelected.mode_choice.selected_mode, HOSTINGER_SSH_PROBE_RUNNER_MODES.CRON_WORKER);
assert.equal(fallbackSelected.mode_choice.mode_fallback_requires_user_choice, true);

const invalid = await governHostingerSshProbeJobSubmission({
  body: {
    job_type: HOSTINGER_SSH_PROBE_JOB_TYPE,
    request_payload: { ...basePayload, runner_mode: "invented_runner" },
  },
});
assert.equal(invalid.proceed, false);
assert.equal(invalid.status, 400);
assert.equal(invalid.body.error.code, "mode_choice_selected_mode_invalid");

const evidenceFailure = await governHostingerSshProbeJobSubmission({
  body: {
    job_type: HOSTINGER_SSH_PROBE_JOB_TYPE,
    request_payload: { ...basePayload, runner_mode: "queue_worker" },
  },
  persistSelection: async () => {
    const error = new Error("execution-log readback missing");
    error.status = 503;
    error.code = "mode_choice_evidence_write_failed";
    throw error;
  },
});
assert.equal(evidenceFailure.proceed, false);
assert.equal(evidenceFailure.status, 503);
assert.equal(evidenceFailure.body.error.code, "mode_choice_evidence_write_failed");

const directPlan = buildHostingerSshProbeModeChoice({
  job_type: HOSTINGER_SSH_PROBE_JOB_TYPE,
  request_payload: { ...basePayload, runner_mode: "cron_worker" },
});
assert.equal(directPlan.applies, true);
assert.equal(directPlan.plan.execution_allowed, true);
assert.equal(directPlan.plan.mode_default_used, false);
assert.equal(directPlan.plan.secrets_included, false);

const routeSource = readFileSync(new URL("./routes/jobRoutes.js", import.meta.url), "utf8");
const governanceCall = routeSource.indexOf("await governJobSubmission");
const submitCall = routeSource.indexOf("await executionFacade.submitJob");
assert.ok(governanceCall >= 0, "job route must invoke mode-choice governance");
assert.ok(submitCall > governanceCall, "mode-choice governance must run before job submission");
assert.ok(routeSource.includes("if (!governance.proceed)"), "blocked choices must return before job creation");
assert.ok(routeSource.includes("governance.request_body"), "the governed trace and selected mode must reach job submission");
assert.ok(routeSource.includes("attachJobSubmissionEvidence"), "job responses must expose selected-mode readback evidence");
assert.ok(!routeSource.includes("executionFacade.submitJob(req.body"), "raw request bodies must not bypass the governance boundary");
assert.ok(!routeSource.includes("policy_mandated_runner_mode: req.body"), "untrusted request payloads must not supply policy mandates");

console.log("Hostinger SSH probe mode-choice boundary tests passed.");
