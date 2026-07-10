import assert from "node:assert/strict";
import fs from "node:fs";
import {
  classifyShadowMismatchRecord,
  classifyShadowMismatchRun,
} from "./platformShadowMismatchClassificationKernel.js";

const docs = fs.readFileSync(new URL("../docs/platform-shadow-mismatch-classification-kernel.md", import.meta.url), "utf8");
const tasks = fs.readFileSync(new URL("../specs/006-adaptive-authorization-execution-governance/tasks.md", import.meta.url), "utf8");

assert(tasks.includes("- [x] T040 Run the three pilots in shadow mode without provider mutation."));
assert(tasks.includes("- [x] T041 Classify all legacy/adaptive mismatches."));

const match = classifyShadowMismatchRecord({
  capabilityKey: "activation.skills.read",
  resourceClass: "activation_skill",
  effectClass: "read_only",
  legacyDecision: "allow",
  adaptiveDecision: "allow",
  requestShapeHash: "a".repeat(64),
  revisionVectorHash: "b".repeat(64),
});
assert.equal(match.mismatchCategory, "match");
assert.equal(match.rolloutAction, "accept_shadow_match");
assert.equal(match.blocksCanary, false);
assert.equal(match.providerApplyAllowed, false);
assert.equal(match.externalWriteAllowed, false);
assert.equal(match.secretsIncluded, false);

const semantic = classifyShadowMismatchRecord({
  capabilityKey: "platform.output-artifact.write",
  resourceClass: "output_artifact",
  effectClass: "internal_write",
  legacyDecision: "approval_required",
  adaptiveDecision: "conditional",
  requestShapeHash: "c".repeat(64),
  revisionVectorHash: "d".repeat(64),
});
assert.equal(semantic.mismatchCategory, "expected_semantic_translation");
assert.equal(semantic.requiresApproval, false);

const policyDelta = classifyShadowMismatchRecord({
  capabilityKey: "platform.output-artifact.write",
  legacyDecision: "allow",
  adaptiveDecision: "deny",
  requestShapeHash: "e".repeat(64),
  revisionVectorHash: "f".repeat(64),
});
assert.equal(policyDelta.mismatchRisk, "medium");
assert.equal(policyDelta.rolloutAction, "require_human_review");
assert.equal(policyDelta.blocksCanary, true);

const expansion = classifyShadowMismatchRecord({
  capabilityKey: "content.wordpress.publish",
  legacyDecision: "deny",
  adaptiveDecision: "allow",
  requestShapeHash: "g".repeat(64),
  revisionVectorHash: "h".repeat(64),
});
assert.equal(expansion.mismatchCategory, "privilege_expansion");
assert.equal(expansion.mismatchRisk, "critical");
assert.equal(expansion.rolloutAction, "block_rollout");

const missingEvidence = classifyShadowMismatchRecord({
  capabilityKey: "content.wordpress.publish",
  legacyDecision: "deny",
  adaptiveDecision: "deny",
  requestShapeHash: "i".repeat(64),
});
assert.equal(missingEvidence.mismatchCategory, "missing_evidence");
assert.equal(missingEvidence.blocksCanary, true);

const run = classifyShadowMismatchRun([match, semantic]);
assert.equal(run.ok, true);
assert.equal(run.recordCount, 2);
assert.equal(run.blockerCount, 0);
assert.equal(run.reviewRequiredCount, 0);
assert.equal(run.providerApplyAllowed, false);
assert.equal(run.migrationExecutionAuthorized, false);

const blocked = classifyShadowMismatchRun([match, expansion]);
assert.equal(blocked.ok, false);
assert.deepEqual(blocked.unapprovedCategories, ["privilege_expansion"]);
assert.equal(blocked.blockerCount, 1);

assert.throws(() => classifyShadowMismatchRun({}), /records must be an array/);
assert.throws(() => classifyShadowMismatchRecord({ legacyDecision: "allow", adaptiveDecision: "allow" }), /capabilityKey is required/);

assert(docs.includes("classification-only"));
assert(docs.includes("no provider mutation"));
assert(docs.includes("block_rollout"));

console.log("platform shadow mismatch classification kernel tests passed");
