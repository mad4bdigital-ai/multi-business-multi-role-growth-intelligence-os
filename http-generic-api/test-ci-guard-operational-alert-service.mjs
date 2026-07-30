import assert from "node:assert/strict";
import {
  normalizeCiGuardSignal,
  calculateCiGuardSlo,
  _testingCiGuardOperationalAlerts,
} from "./ciGuardOperationalAlertService.js";
import {
  classifyCiGuardWorkflowOutcome,
  _testingCiGuardWorkflowOutcome,
} from "./ciGuardWorkflowOutcome.js";

const now = new Date("2026-07-21T00:10:00.000Z");
const failure = normalizeCiGuardSignal({
  signal_key: "custom_gpt_contract_guard",
  status: "failure",
  idempotency_key: "run:100:1:failure",
  workflow_name: "Custom GPT Contract Guard",
  workflow_run_id: "100",
  workflow_attempt: 1,
  job_name: "guard",
  source_ref: "https://github.example/actions/runs/100",
  commit_sha: "a".repeat(40),
  ref_name: "main",
  started_at: "2026-07-21T00:08:30.000Z",
  observed_at: "2026-07-21T00:10:00.000Z",
  evidence: { api_key: "blocked", safe_field: "visible" },
}, now);
assert.equal(failure.failure, true);
assert.equal(failure.detection_seconds, 90);
assert.equal(failure.alert_key, "ci_guard.custom_gpt_contract_guard");
assert.equal(failure.evidence.api_key, undefined);
assert.equal(failure.evidence.safe_field, "visible");

assert.throws(
  () => normalizeCiGuardSignal({
    signal_key: "bad key",
    status: "failure",
    idempotency_key: "x",
    workflow_run_id: "1",
    observed_at: now.toISOString(),
  }, now),
  (error) => error.code === "invalid_ci_guard_signal_key"
);
assert.throws(
  () => normalizeCiGuardSignal({
    signal_key: "guard",
    status: "unknown",
    idempotency_key: "x",
    workflow_run_id: "1",
    observed_at: now.toISOString(),
  }, now),
  (error) => error.code === "invalid_ci_guard_signal_status"
);

const healthy = calculateCiGuardSlo([
  {
    signal_key: "custom_gpt_contract_guard",
    status: "success",
    workflow_run_id: "101",
    observed_at: "2026-07-21T00:10:00.000Z",
  },
], null, { generatedAt: now });
assert.equal(healthy.overall_status, "pass");
assert.equal(healthy.objectives.daily_success.status, "pass");
assert.equal(healthy.objectives.detection_time.status, "not_applicable");
assert.equal(healthy.objectives.recovery_time.status, "not_applicable");

const unresolved = calculateCiGuardSlo([
  {
    signal_key: "custom_gpt_contract_guard",
    status: "failure",
    workflow_run_id: "102",
    observed_at: "2026-07-21T00:10:00.000Z",
    detection_seconds: 45,
  },
], {
  alert_id: "alert-1",
  lifecycle_status: "open",
  severity: "high",
  first_seen_at: "2026-07-21T00:10:00.000Z",
}, { generatedAt: now });
assert.equal(unresolved.overall_status, "fail");
assert.equal(unresolved.objectives.detection_time.status, "pass");
assert.equal(unresolved.objectives.recovery_time.status, "fail");

const recovered = calculateCiGuardSlo([
  {
    signal_key: "custom_gpt_contract_guard",
    status: "success",
    workflow_run_id: "104",
    observed_at: "2026-07-21T00:20:00.000Z",
    recovery_seconds: 600,
  },
  {
    signal_key: "custom_gpt_contract_guard",
    status: "failure",
    workflow_run_id: "103",
    observed_at: "2026-07-21T00:10:00.000Z",
    detection_seconds: 60,
  },
], {
  alert_id: "alert-1",
  lifecycle_status: "resolved",
  severity: "high",
  first_seen_at: "2026-07-21T00:10:00.000Z",
  resolved_at: "2026-07-21T00:20:00.000Z",
}, { generatedAt: now });
assert.equal(recovered.overall_status, "pass");
assert.equal(recovered.objectives.daily_success.status, "pass");
assert.equal(recovered.objectives.detection_time.status, "pass");
assert.equal(recovered.objectives.recovery_time.status, "pass");
assert.equal(recovered.objectives.recovery_time.maximum_seconds, 600);

const currentRun = {
  id: 200,
  run_number: 50,
  workflow_id: 900,
  event: "push",
  head_branch: "main",
};
const superseded = classifyCiGuardWorkflowOutcome({
  guardResult: "cancelled",
  currentRun,
  workflowRuns: [
    currentRun,
    {
      id: 201,
      run_number: 51,
      workflow_id: 900,
      event: "push",
      head_branch: "main",
      html_url: "https://github.example/actions/runs/201",
      status: "in_progress",
      conclusion: null,
    },
  ],
});
assert.equal(superseded.classification, "cancelled_due_to_superseding_run");
assert.equal(superseded.neutral, true);
assert.equal(superseded.superseding_run.id, 201);

const genuineCancellation = classifyCiGuardWorkflowOutcome({
  guardResult: "cancelled",
  currentRun,
  workflowRuns: [
    currentRun,
    { id: 202, run_number: 52, workflow_id: 900, event: "pull_request", head_branch: "feature" },
  ],
});
assert.equal(genuineCancellation.classification, "cancelled");
assert.equal(genuineCancellation.neutral, false);
assert.equal(genuineCancellation.superseding_run, null);

const failureOutcome = classifyCiGuardWorkflowOutcome({
  guardResult: "failure",
  currentRun,
  workflowRuns: [],
});
assert.equal(failureOutcome.classification, "failure");
assert.equal(failureOutcome.neutral, false);
assert.equal(_testingCiGuardWorkflowOutcome.SUPERSEDED_CLASSIFICATION, "cancelled_due_to_superseding_run");

assert.equal(_testingCiGuardOperationalAlerts.DEFAULT_TARGETS.maximum_detection_seconds, 300);
assert.equal(_testingCiGuardOperationalAlerts.DEFAULT_TARGETS.maximum_recovery_seconds, 3600);
console.log("CI guard operational alert service tests passed.");
