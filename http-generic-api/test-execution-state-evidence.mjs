import { buildExecutionStateEvidence } from "./execution.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`[PASS] ${label}`);
    passed++;
  } else {
    console.error(`[FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

const routed = buildExecutionStateEvidence({
  routeStatus: "matched",
  routeSource: "registry_task_routes",
  matchedRowId: "TR-0134",
  intakeValidationStatus: "validated",
  executionReadyStatus: "ready",
  failureReason: "no_failure",
  recoveryAction: "no_recovery_action",
  isDirectValidation: false
});

assert("routed route_status", routed.route_status === "matched", JSON.stringify(routed));
assert("routed route_source", routed.route_source === "registry_task_routes", JSON.stringify(routed));
assert("routed matched_row_id", routed.matched_row_id === "TR-0134", JSON.stringify(routed));
assert("routed intake_validation_status", routed.intake_validation_status === "validated", JSON.stringify(routed));
assert("routed execution_ready_status", routed.execution_ready_status === "ready", JSON.stringify(routed));
assert("routed failure_reason", routed.failure_reason === "no_failure", JSON.stringify(routed));
assert("routed recovery_action", routed.recovery_action === "no_recovery_action", JSON.stringify(routed));

const validation = buildExecutionStateEvidence({ isDirectValidation: true });

assert("validation route_status sentinel", validation.route_status === "direct_validation", JSON.stringify(validation));
assert("validation route_source sentinel", validation.route_source === "system_bootstrap", JSON.stringify(validation));
assert("validation matched_row_id sentinel", validation.matched_row_id === "not_applicable", JSON.stringify(validation));
assert("validation intake_validation_status sentinel", validation.intake_validation_status === "validated", JSON.stringify(validation));
assert("validation execution_ready_status sentinel", validation.execution_ready_status === "ready", JSON.stringify(validation));
assert("validation failure_reason sentinel", validation.failure_reason === "no_failure", JSON.stringify(validation));
assert("validation recovery_action sentinel", validation.recovery_action === "no_recovery_action", JSON.stringify(validation));

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
