import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVATION_OPERATION_AGGREGATE_OVERLAY_STATES,
  ACTIVATION_OPERATION_CORE_NONTERMINAL_STATES,
  ACTIVATION_OPERATION_STABLE_REPORTED_STATES,
  ACTIVATION_OPERATION_STABLE_RETRY_STATES,
  ACTIVATION_OPERATION_STATUSES,
  ACTIVATION_OPERATION_TERMINAL_WITHOUT_RETRY,
  ACTIVATION_OPERATION_TRANSITIONS,
  ACTIVATION_STAGE_ATTEMPT_STATUSES,
  ACTIVATION_STAGE_ATTEMPT_TERMINAL_STATES,
  ACTIVATION_STAGE_ATTEMPT_TRANSITIONS,
  applyActivationAggregateOverlay,
  assertActivationOperationTransition,
  assertActivationStageAttemptTransition,
  classifyActivationOperationState,
  getAllowedActivationOperationTransitions,
  getAllowedActivationStageAttemptTransitions,
  isActivationOperationStableRetryState,
  isActivationOperationTerminalWithoutRetry,
  isActivationStageAttemptTerminal,
} from "./activationLifecycleStateMachine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractPath = path.join(
  __dirname,
  "..",
  "specs",
  "012-tenant-activation-lifecycle",
  "implementation",
  "pr-2a-lifecycle-contracts.json",
);
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));

assert.equal(contract.runtime_authority, false);
assert.deepEqual(ACTIVATION_OPERATION_STATUSES, contract.operation.declared_statuses);
assert.deepEqual(
  ACTIVATION_OPERATION_CORE_NONTERMINAL_STATES,
  contract.operation.core_nonterminal_states,
);
assert.deepEqual(
  ACTIVATION_OPERATION_AGGREGATE_OVERLAY_STATES,
  contract.operation.aggregate_overlay_states,
);
assert.deepEqual(
  ACTIVATION_OPERATION_STABLE_REPORTED_STATES,
  contract.operation.stable_reported_states,
);
assert.deepEqual(
  ACTIVATION_OPERATION_TERMINAL_WITHOUT_RETRY,
  contract.operation.terminal_without_retry,
);
assert.deepEqual(
  ACTIVATION_OPERATION_STABLE_RETRY_STATES,
  contract.operation.stable_retry_requires_governed_request,
);
assert.deepEqual(ACTIVATION_OPERATION_TRANSITIONS, contract.operation.transitions);

const classified = new Set();
for (const status of ACTIVATION_OPERATION_CORE_NONTERMINAL_STATES) {
  assert.equal(classifyActivationOperationState(status), "core_nonterminal");
  classified.add(status);
}
for (const status of ACTIVATION_OPERATION_AGGREGATE_OVERLAY_STATES) {
  assert.equal(classifyActivationOperationState(status), "aggregate_overlay");
  classified.add(status);
}
for (const status of ACTIVATION_OPERATION_STABLE_REPORTED_STATES) {
  assert.equal(classifyActivationOperationState(status), "stable_reported");
  classified.add(status);
}
assert.deepEqual([...classified].sort(), [...ACTIVATION_OPERATION_STATUSES].sort());

for (const [from, targets] of Object.entries(ACTIVATION_OPERATION_TRANSITIONS)) {
  assert.deepEqual(getAllowedActivationOperationTransitions(from), targets);
  for (const to of targets) {
    assert.deepEqual(assertActivationOperationTransition(from, to), {
      allowed: true,
      from_status: from,
      to_status: to,
    });
  }
}

for (const status of ACTIVATION_OPERATION_TERMINAL_WITHOUT_RETRY) {
  assert.equal(isActivationOperationTerminalWithoutRetry(status), true);
}
for (const status of ACTIVATION_OPERATION_STABLE_RETRY_STATES) {
  assert.equal(isActivationOperationStableRetryState(status), true);
}

assert.throws(
  () => assertActivationOperationTransition("created", "active"),
  (error) => error?.code === "activation_operation_transition_invalid" && error?.status === 409,
);
assert.throws(
  () => assertActivationOperationTransition("active", "ready"),
  (error) => error?.code === "activation_operation_terminal" && error?.status === 409,
);
assert.throws(
  () => assertActivationOperationTransition("degraded", "retry_scheduled"),
  (error) =>
    error?.code === "activation_operation_governed_retry_required" && error?.status === 409,
);
assert.throws(
  () => assertActivationOperationTransition("delivery_pending", "active"),
  (error) =>
    error?.code === "activation_operation_overlay_transition_invalid" && error?.status === 409,
);
assert.throws(
  () => assertActivationOperationTransition("ready", "delivery_pending"),
  (error) =>
    error?.code === "activation_operation_overlay_transition_invalid" && error?.status === 409,
);
assert.throws(
  () => assertActivationOperationTransition("ready", "ready"),
  (error) => error?.code === "activation_operation_transition_invalid" && error?.status === 409,
);
assert.throws(
  () => classifyActivationOperationState("invented"),
  (error) => error?.code === "activation_operation_status_invalid" && error?.status === 400,
);

assert.deepEqual(applyActivationAggregateOverlay("active", "delivery_pending"), {
  operation_status: "active",
  overlay_status: "delivery_pending",
  execution_outcome_rewritten: false,
});
assert.deepEqual(
  applyActivationAggregateOverlay("failed", "acknowledgement_pending"),
  {
    operation_status: "failed",
    overlay_status: "acknowledgement_pending",
    execution_outcome_rewritten: false,
  },
);
assert.throws(
  () => applyActivationAggregateOverlay("delivery_pending", "acknowledgement_pending"),
  (error) => error?.code === "activation_operation_overlay_base_invalid" && error?.status === 409,
);

assert.deepEqual(ACTIVATION_STAGE_ATTEMPT_STATUSES, contract.stage_attempt.statuses);
assert.deepEqual(ACTIVATION_STAGE_ATTEMPT_TRANSITIONS, contract.stage_attempt.transitions);
assert.deepEqual(
  ACTIVATION_STAGE_ATTEMPT_TERMINAL_STATES,
  contract.stage_attempt.terminal_states,
);
for (const [from, targets] of Object.entries(ACTIVATION_STAGE_ATTEMPT_TRANSITIONS)) {
  assert.deepEqual(getAllowedActivationStageAttemptTransitions(from), targets);
  for (const to of targets) {
    assert.deepEqual(assertActivationStageAttemptTransition(from, to), {
      allowed: true,
      from_status: from,
      to_status: to,
    });
  }
}
for (const status of ACTIVATION_STAGE_ATTEMPT_TERMINAL_STATES) {
  assert.equal(isActivationStageAttemptTerminal(status), true);
}
assert.throws(
  () => assertActivationStageAttemptTransition("succeeded", "running"),
  (error) => error?.code === "activation_stage_attempt_terminal" && error?.status === 409,
);
assert.throws(
  () => assertActivationStageAttemptTransition("pending", "succeeded"),
  (error) =>
    error?.code === "activation_stage_attempt_transition_invalid" && error?.status === 409,
);

for (const runtimeFile of [
  "server.js",
  "activationSessionLifecycleService.js",
  "activationHardResponseService.js",
]) {
  const source = fs.readFileSync(path.join(__dirname, runtimeFile), "utf8");
  assert.doesNotMatch(
    source,
    /activationLifecycleStateMachine/,
    `${runtimeFile} must not wire the T027 domain foundation`,
  );
}

const ci = fs.readFileSync(
  path.join(__dirname, "..", ".github", "workflows", "ci.yml"),
  "utf8",
);
assert.match(ci, /node test-activation-lifecycle-state-machine\.mjs/);

console.log("activation lifecycle state machine tests passed");
