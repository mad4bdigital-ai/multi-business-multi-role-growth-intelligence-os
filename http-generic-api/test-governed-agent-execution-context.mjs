import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assembleAgentSystemPrompt } from "./agentPromptAssembler.js";
import { writeAuthorityBridgeDriftEvidence } from "./authorityBridgeEvidence.js";
import { buildGovernedAgentExecutionContext } from "./governedAgentExecutionContext.js";
import { runLogicWithModel } from "./modelAdapter.js";

const baseDeps = {
  pool: { query: async () => [[]] },
  resolveTaskRouteCandidates: async () => ({
    candidates: [
      { route_id: "route.allowed", evaluation: { allowed: true, score: 100, reasons: [] }, requirements: { logging_required: true } },
      { route_id: "route.denied", evaluation: { allowed: false, score: 0, reasons: ["actor_role_not_allowed"] }, blocked_action: "deny" },
    ],
  }),
  resolveWorkflowCandidates: async () => ({
    candidates: [
      { workflow_key: "workflow.allowed", evaluation: { allowed: true, score: 100, reasons: [] }, requirements: { review_required: true } },
      { workflow_key: "workflow.denied", evaluation: { allowed: false, score: 0, reasons: ["admin_only_workflow"] }, blocked_action: "deny" },
    ],
  }),
  resolveAgentResponseProfile: async () => ({ language: "ar", tone: "direct", verbosity: "concise", execution_authority: false }),
  resolveResearchSourcePolicy: async () => ({ policy_key: "internal_first", source_order: ["internal_registry"], internal_first: true }),
  resolveMemoryScope: async () => ({ primary_scope: { scope_type: "workflow", scope_ref: "workflow.allowed" }, cross_scope_default: "deny" }),
};

const observed = await buildGovernedAgentExecutionContext({
  plan_id: "plan-1",
  tenant_id: "tenant-1",
  intent_key: "route.denied",
  workflow_key: "workflow.denied",
  agent_id: "agent-1",
}, { ...baseDeps, enforcementMode: "observe_only" });
assert.equal(observed.authority_bridge.mode, "observe_only");
assert.equal(observed.authority_bridge.allowed, true);
assert.equal(observed.authority_bridge.blocker_count, 2);
assert.equal(observed.prompt_envelope.response_profile.language, "ar");
assert.deepEqual(observed.prompt_envelope.research_policy.source_order, ["internal_registry"]);
assert.equal(observed.prompt_envelope.memory_scope.cross_scope_default, "deny");

const enforced = await buildGovernedAgentExecutionContext({
  plan_id: "plan-1",
  tenant_id: "tenant-1",
  intent_key: "route.denied",
  workflow_key: "workflow.denied",
}, { ...baseDeps, enforcementMode: "enforce" });
assert.equal(enforced.authority_bridge.allowed, false);
assert.equal(enforced.authority_bridge.blocker_count, 2);

let driftEvidenceInput;
const driftEvidence = await writeAuthorityBridgeDriftEvidence(
  { plan_id: "plan-1", tenant_id: "tenant-1", agent_id: "agent-1" },
  observed.authority_bridge,
  {
    writeExecutionEvidence: async (input) => {
      driftEvidenceInput = input;
      return { ok: true, row: { id: 991, execution_status: input.executionStatus }, trace_id: input.traceId };
    },
  }
);
assert.equal(driftEvidence.ok, true);
assert.equal(driftEvidence.execution_log_id, 991);
assert.equal(driftEvidenceInput.entryType, "agent_authority_bridge_drift");
assert.equal(driftEvidenceInput.outputSummary.blocker_count, 2);
assert.equal("user_input" in driftEvidenceInput.outputSummary, false);

const prompt = assembleAgentSystemPrompt({
  logicBody: { system_prompt: "Perform the governed analysis." },
  context: observed,
});
assert(prompt.includes("Governed execution envelope"));
assert(prompt.includes("internal_first"));
assert.equal(prompt.includes("User request:"), false);

let capturedMessages;
await runLogicWithModel(
  {
    logic_key: "logic-1",
    logic_body: { system_prompt: "Perform the governed analysis." },
    user_input: "private user request",
    context: observed,
  },
  {
    callModel: async (messages) => {
      capturedMessages = messages;
      return { content: "done", tokens_used: 1 };
    },
    dispatchTool: async () => ({ ok: true }),
  }
);
assert.equal(capturedMessages[0].role, "system");
assert.equal(capturedMessages[0].content.includes("private user request"), false);
assert.equal(capturedMessages[1].role, "user");
assert.equal(capturedMessages[1].content, "private user request");

const runtime = readFileSync("agentRuntime.js", "utf8");
const loop = readFileSync("agentLoopRunner.js", "utf8");
assert(runtime.includes("buildGovernedAgentExecutionContext"));
assert(runtime.includes("buildGovernedContext"));
assert(loop.includes("governed_agent_execution_authority_denied"));
assert(loop.includes("writeAuthorityBridgeDriftEvidence"));

console.log("governed agent execution context tests passed");
