import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inferRequiredOutputSinks } from "./outputSinkRouter.js";

assert.deepEqual(
  inferRequiredOutputSinks({ execution_class: "standard", artifact_type: "Operational" }),
  ["output_artifact"]
);
assert.deepEqual(
  inferRequiredOutputSinks({ execution_class: "rule_based", artifact_type: "Operational" }),
  ["output_artifact", "adaptation_record"]
);
assert.deepEqual(
  inferRequiredOutputSinks({ execution_class: "authority", artifact_type: "Report", linked_workflows: "workflow.a|workflow.b" }),
  ["output_artifact", "reporting_view", "audit_log", "chain_event"]
);
assert.deepEqual(
  inferRequiredOutputSinks({ execution_class: "standard", artifact_type: "Analysis", linked_workflows: "[]" }),
  ["output_artifact", "reporting_view"]
);

const sinkRouter = readFileSync(new URL("./outputSinkRouter.js", import.meta.url), "utf8");
const connector = readFileSync(new URL("./connectorExecutor.js", import.meta.url), "utf8");

for (const token of [
  "confirmSinkReadback",
  "required_sink_readback_failed",
  "required_output_sink_failed",
  "missing_required_sinks",
  "side_effect_confirmed_by_readback: ok",
  "SINK_READBACK_TARGETS",
]) {
  assert(sinkRouter.includes(token), `output sink router must include ${token}`);
}

assert(sinkRouter.includes('const requiredSinks = new Set(inferRequiredOutputSinks'));
assert(sinkRouter.includes('const audit_id = await writeAuditLog'));
assert(sinkRouter.includes('await confirmAndDispatch("audit_log", audit_id)'));
assert.equal(sinkRouter.includes("return { ok: true, run_id, execution_class, artifact_type, dispatched }"), false);

const routeIndex = connector.indexOf("sinkResult = await routeOutput");
const finaliseIndex = connector.indexOf("finaliseWorkflowRun(run_id, final_status");
assert(routeIndex >= 0, "connector must await output sink routing");
assert(finaliseIndex > routeIndex, "workflow finalization must happen after output sink routing");
assert(connector.includes("const succeeded = dispatchSucceeded && sinkSucceeded"));
assert(connector.includes("side_effect_confirmed_by_readback: sinkResult?.side_effect_confirmed_by_readback === true"));
assert(connector.includes("sink_readback_confirmed: sinkResult?.side_effect_confirmed_by_readback === true"));
assert(connector.includes('code: "required_output_sink_failed"'));
assert.equal(connector.includes("non-blocking — never fail the main response"), false);
assert.equal(connector.includes("[outputSinkRouter] non-fatal"), false);

console.log("required output sink hardening tests passed");
