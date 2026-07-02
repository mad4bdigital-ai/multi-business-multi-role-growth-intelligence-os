import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createGateResult,
  createSecurityDecision,
} from "./src/domain/capability/securityDecision.js";

const decision = createSecurityDecision({
  trace_id: "contract-trace-1",
  execution_mode: "dispatch",
  approval_required: true,
  gates: [
    createGateResult({ key: "principal", state: "pass", reason: "tenant_authorized" }),
    createGateResult({ key: "approval", state: "deny", reason: "approval_required", code: "APPROVAL_REQUIRED" }),
  ],
});

assert.equal(decision.trace.schema_version, "security_decision_trace.v1");
assert.equal(decision.trace.trace_id, "contract-trace-1");
assert.equal(decision.trace.outcome, "deny");
assert.equal(decision.trace.dispatch_ready, false);
assert.equal(decision.trace.will_execute, false);
assert.equal(decision.trace.approval_required, true);
assert.deepEqual(decision.trace.denied_gates, ["approval"]);
assert.deepEqual(decision.trace.unevaluated_required_gates, []);
assert.deepEqual(decision.trace.gate_events.map((event) => event.type), ["gate_evaluated", "gate_evaluated"]);
assert.deepEqual(decision.trace.gate_events.map((event) => event.gate_key), ["principal", "approval"]);
assert.equal(decision.trace.gate_events[1].code, "APPROVAL_REQUIRED");
assert.equal(decision.trace.invariant_results.preview_mode_cannot_execute, true);
assert.equal(decision.trace.secrets_included, false);

const source = await readFile(new URL("./src/domain/capability/securityDecision.js", import.meta.url), "utf8");
assert(source.includes("createSecurityDecisionTrace"));
assert(source.includes("schema_version: \"security_decision_trace.v1\""));
assert(source.includes("detail_keys"));
assert(!source.includes("details: gate.details"), "trace must not copy raw gate details");

console.log("security decision trace contract tests passed");
