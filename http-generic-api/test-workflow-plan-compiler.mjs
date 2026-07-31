import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileImmutableWorkflowPlan } from "./src/domain/growthControlPlane/workflowPlanCompiler.js";

const SHA = "a".repeat(64);
function activityPack(overrides = {}) {
  const workflow = {
    workflowKey: "travel.growth",
    version: 1,
    extensionPoints: [{ extensionPointKey: "analysis.extensions", anchorNodeId: "analysis", allowedPositions: ["pre", "post"] }],
    nodes: [
      { id: "intent", capability: "intent.generate", outputSchema: { type: "object", additionalProperties: false, required: ["intentKey"], properties: { intentKey: { type: "string", minLength: 3 } } } },
      { id: "analysis", capability: "analysis.generate", depends_on: ["intent"], inputSchema: { type: "object", additionalProperties: false, required: ["intentKey"], properties: { intentKey: { type: "string", minLength: 3 } } }, approvalCheckpoint: { checkpointKey: "analysis.approval", policyKey: "travel.internal.review" }, compensationNodeId: "rollback" },
      { id: "review", capability: "review.perform", depends_on: ["analysis"], verificationCheckpoint: { checkpointKey: "review.verification" } }
    ],
    compensationNodes: [{ id: "rollback", capability: "rollback.perform" }],
    ...overrides
  };
  return {
    identity: { activityPackKey: "travel.reference_pack", version: 1 },
    entitySchemas: { request: { type: "object", additionalProperties: false, required: ["requestKey"], properties: { requestKey: { type: "string", minLength: 3 } } } },
    knowledgeProfile: { pointerKey: "travel_knowledge_profile" },
    kpiTaxonomy: ["qualified_lead_rate"],
    capabilities: [{ capabilityKey: "intent.generate", version: 1 }, { capabilityKey: "analysis.generate", version: 1 }, { capabilityKey: "review.perform", version: 1 }, { capabilityKey: "rollback.perform", version: 1 }],
    workflows: [workflow],
    policies: [{ policyKey: "travel.internal.review", capabilities: ["intent.generate", "analysis.generate", "review.perform", "rollback.perform"], workflows: ["travel.growth"] }],
    providerCompatibility: [],
    tests: { fixtures: ["travel-workflow-compiler-v1"], compatibilityDeclarations: [] }
  };
}
const extensions = [
  { extensionKey: "quality.pre", extensionPointKey: "analysis.extensions", position: "pre", order: 1, nodes: [{ id: "check", capability: "review.perform", inputSchema: { type: "object", properties: { candidateKey: { type: "string" } } } }] },
  { extensionKey: "quality.post", extensionPointKey: "analysis.extensions", position: "post", order: 1, nodes: [{ id: "audit", capability: "review.perform" }] }
];
const first = compileImmutableWorkflowPlan({ manifest: activityPack(), workflowKey: "travel.growth", extensions, generation: { generated: true, validationStatus: "validated", validationSha256: SHA, generatedBy: "workflow.generator" }, settingsSnapshotHash: SHA });
const second = compileImmutableWorkflowPlan({ manifest: JSON.parse(JSON.stringify(activityPack())), workflowKey: "travel.growth", extensions: JSON.parse(JSON.stringify(extensions)), generation: { generated: true, validationStatus: "validated", validationSha256: SHA, generatedBy: "workflow.generator" }, settingsSnapshotHash: SHA });
assert.equal(first.contractVersion, "spec-006-workflow-compiled-plan-v1");
assert.deepEqual(first.normalizedDag.topologicalOrder, ["intent", "quality.pre.check", "analysis", "quality.post.audit", "review"]);
assert.deepEqual(first.normalizedDag.entryNodeIds, ["intent"]);
assert.deepEqual(first.normalizedDag.terminalNodeIds, ["review"]);
assert.deepEqual(first.requiredCapabilities, ["analysis.generate", "intent.generate", "review.perform", "rollback.perform"]);
assert.deepEqual(first.candidateAdapterClasses, ["internal"]);
assert.equal(first.approvalCheckpoints[0].nodeId, "analysis");
assert.equal(first.verificationCheckpoints[0].nodeId, "review");
assert.deepEqual(first.compensationGraph.triggers, [{ sourceNodeId: "analysis", compensationNodeId: "rollback" }]);
assert.equal(first.generation.generated, true);
assert.equal(first.providerCalls, false);
assert.equal(first.providerDispatchAllowed, false);
assert.equal(first.providerApplyAllowed, false);
assert.equal(first.externalWrites, false);
assert.equal(first.secretsIncluded, false);
assert.match(first.canonicalHashSha256, /^[a-f0-9]{64}$/);
assert.equal(first.canonicalHashSha256, second.canonicalHashSha256);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.normalizedDag.nodes), true);
assert.throws(() => compileImmutableWorkflowPlan({ manifest: activityPack({ extensionPoints: [], nodes: [{ id: "alpha", capability: "intent.generate", depends_on: ["bravo"] }, { id: "bravo", capability: "analysis.generate", depends_on: ["alpha"] }] }), workflowKey: "travel.growth" }), (error) => error.code === "GROWTH_CONTROL_ACTIVITY_PACK_INVALID" || error.code === "GROWTH_CONTROL_WORKFLOW_DAG_INVALID");
assert.throws(() => compileImmutableWorkflowPlan({ manifest: activityPack({ extensionPoints: [], nodes: [{ id: "alpha", capability: "intent.generate" }, { id: "bravo", capability: "analysis.generate", depends_on: ["alpha"], join: { strategy: "all" } }] }), workflowKey: "travel.growth" }), (error) => error.code === "GROWTH_CONTROL_WORKFLOW_JOIN_INVALID");
assert.throws(() => compileImmutableWorkflowPlan({ manifest: activityPack(), workflowKey: "travel.growth", extensions: [{ extensionKey: "unknown.extension", extensionPointKey: "missing.extension", position: "pre", nodes: [{ id: "check", capability: "review.perform" }] }] }), (error) => error.code === "GROWTH_CONTROL_WORKFLOW_EXTENSION_INVALID" && error.details[0].issue === "not_declared");
assert.throws(() => compileImmutableWorkflowPlan({ manifest: activityPack(), workflowKey: "travel.growth", generation: { generated: true, validationStatus: "pending", generatedBy: "workflow.generator" } }), (error) => error.code === "GROWTH_CONTROL_WORKFLOW_GENERATION_INVALID");
assert.throws(() => compileImmutableWorkflowPlan({ manifest: activityPack(), workflowKey: "travel.growth", extensions: [{ extensionKey: "unsafe.extension", extensionPointKey: "analysis.extensions", position: "pre", nodes: [{ id: "check", capability: "review.perform", credentialPayload: { token: "forbidden" } }] }] }), (error) => error.code === "GROWTH_CONTROL_WORKFLOW_COMPILE_SENSITIVE_INPUT");
assert.throws(() => compileImmutableWorkflowPlan({ manifest: activityPack({ compensationNodes: [] }), workflowKey: "travel.growth" }), (error) => error.code === "GROWTH_CONTROL_WORKFLOW_COMPENSATION_INVALID");
assert.throws(() => compileImmutableWorkflowPlan({ manifest: activityPack(), workflowKey: "travel.growth", settingsSnapshotHash: "not-a-sha" }), (error) => error.code === "GROWTH_CONTROL_WORKFLOW_COMPILE_INVALID");
const compilerSource = readFileSync("src/domain/growthControlPlane/workflowPlanCompiler.js", "utf8");
assert.equal(/(?:INSERT\s+INTO|UPDATE\s+[A-Za-z0-9_`]+\s+SET|DELETE\s+FROM)\s+/i.test(compilerSource), false);
assert.equal(compilerSource.includes("providerCalls: true"), false);
assert.equal(compilerSource.includes("providerDispatchAllowed: true"), false);
assert.equal(compilerSource.includes("providerApplyAllowed: true"), false);
assert.equal(compilerSource.includes("externalWrites: true"), false);
console.log("workflow plan compiler tests passed");
