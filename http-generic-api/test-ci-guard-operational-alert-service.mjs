import assert from "node:assert/strict";
import {
  normalizeCiGuardSignal,
  calculateCiGuardSlo,
  _testingCiGuardOperationalAlerts,
} from "./ciGuardOperationalAlertService.js";

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

const repeatedIncidentEvents = [
  {
    signal_key: "custom_gpt_contract_guard",
    status: "success",
    workflow_run_id: "203",
    observed_at: "2026-07-21T01:50:00.000Z",
    recovery_seconds: 99999,
  },
  {
    signal_key: "custom_gpt_contract_guard",
    status: "failure",
    workflow_run_id: "202",
    observed_at: "2026-07-21T01:10:00.000Z",
    detection_seconds: 62,
  },
  {
    signal_key: "custom_gpt_contract_guard",
    status: "failure",
    workflow_run_id: "201",
    observed_at: "2026-07-21T01:00:00.000Z",
    detection_seconds: 58,
  },
  {
    signal_key: "custom_gpt_contract_guard",
    status: "success",
    workflow_run_id: "200",
    observed_at: "2026-07-21T00:05:00.000Z",
    recovery_seconds: 88888,
  },
  {
    signal_key: "custom_gpt_contract_guard",
    status: "failure",
    workflow_run_id: "199",
    observed_at: "2026-07-21T00:03:00.000Z",
    detection_seconds: 60,
  },
];
assert.deepEqual(
  _testingCiGuardOperationalAlerts.deriveRecoverySamples(repeatedIncidentEvents),
  [120, 3000],
  "recovery must be measured from the first failure of each incident cycle, not historical alert first_seen_at or stored legacy values",
);
const repeatedIncidentSlo = calculateCiGuardSlo(repeatedIncidentEvents, {
  alert_id: "alert-1",
  lifecycle_status: "resolved",
  severity: "high",
}, { generatedAt: now });
assert.equal(repeatedIncidentSlo.overall_status, "pass");
assert.equal(repeatedIncidentSlo.objectives.recovery_time.sample_count, 2);
assert.equal(repeatedIncidentSlo.objectives.recovery_time.maximum_seconds, 3000);

assert.equal(_testingCiGuardOperationalAlerts.DEFAULT_TARGETS.maximum_detection_seconds, 300);
assert.equal(_testingCiGuardOperationalAlerts.DEFAULT_TARGETS.maximum_recovery_seconds, 3600);
console.log("CI guard operational alert service tests passed.");
