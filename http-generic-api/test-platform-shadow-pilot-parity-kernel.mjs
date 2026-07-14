import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PILOT_CAPABILITIES,
  buildShadowPilotEvidence,
  classifyShadowPilotMismatch,
  getShadowPilotDefinitions,
  runShadowPilotParity,
} from "./platformShadowPilotParityKernel.js";

const manifest = JSON.parse(fs.readFileSync(new URL("../specs/006-adaptive-authorization-execution-governance/manifest.json", import.meta.url), "utf8"));
const authorityMap = fs.readFileSync(new URL("../specs/006-adaptive-authorization-execution-governance/sql-authority-map-2026-06-29.md", import.meta.url), "utf8");
const testing = fs.readFileSync(new URL("../specs/006-adaptive-authorization-execution-governance/testing-and-parity-strategy.md", import.meta.url), "utf8");

assert.deepEqual(manifest.pilot_capabilities, PILOT_CAPABILITIES);
for (const capabilityKey of PILOT_CAPABILITIES) {
  assert(authorityMap.includes(capabilityKey));
  assert(testing.includes(capabilityKey));
}

const definitions = getShadowPilotDefinitions();
assert.equal(definitions.length, 3);
assert.equal(definitions[0].providerApplyAllowed, false);
assert.equal(definitions[1].mutationAllowed, false);
assert.equal(definitions[2].externalWriteAllowed, false);

const run = runShadowPilotParity([
  { capabilityKey: "activation.skills.read", legacyDecision: "allow", adaptiveDecision: "allow", requestShape: { tenant: "t" }, revisionVector: { grants: "r1" } },
  { capabilityKey: "platform.output-artifact.write", legacyDecision: "approval_required", adaptiveDecision: "conditional", requestShape: { artifact: "a" }, revisionVector: { grants: "r2" }, idempotencyKeyHash: "i".repeat(64), readbackContractHash: "r".repeat(64) },
  { capabilityKey: "content.wordpress.publish", legacyDecision: "deny", adaptiveDecision: "deny", requestShape: { post: "p" }, revisionVector: { site: "s" }, idempotencyKeyHash: "j".repeat(64), readbackContractHash: "k".repeat(64), providerBindingHash: "b".repeat(64) },
]);

assert.equal(run.ok, true);
assert.equal(run.mode, "shadow");
assert.equal(run.pilotCount, 3);
assert.deepEqual(run.missingCapabilities, []);
assert.equal(run.criticalMismatchCount, 0);
assert.equal(run.providerApplyAllowed, false);
assert.equal(run.externalWriteAllowed, false);
assert.equal(run.mutationAllowed, false);
assert.equal(run.enforcementCutover, false);
assert.equal(run.secretsIncluded, false);
for (const record of run.records) {
  assert.equal(record.status, "shadow_recorded");
  assert.equal(record.providerApplyAllowed, false);
  assert.equal(record.rawPayloadIncluded, false);
  assert.equal(record.promptIncluded, false);
  assert.equal(record.secretsIncluded, false);
  assert.match(record.requestShapeHash, /^[a-f0-9]{64}$/);
  assert.match(record.revisionVectorHash, /^[a-f0-9]{64}$/);
}

assert.equal(classifyShadowPilotMismatch({ legacyDecision: "deny", adaptiveDecision: "allow" }).risk, "critical");
assert.equal(classifyShadowPilotMismatch({ legacyDecision: "approval_required", adaptiveDecision: "conditional" }).category, "expected_semantic_translation");
assert.throws(() => buildShadowPilotEvidence({ capabilityKey: "content.wordpress.publish", legacyDecision: "allow", adaptiveDecision: "allow", idempotencyKeyHash: "i".repeat(64), readbackContractHash: "r".repeat(64), providerBindingHash: "b".repeat(64), providerMutationPerformed: true }), /provider mutation/);
assert.throws(() => buildShadowPilotEvidence({ capabilityKey: "platform.output-artifact.write", legacyDecision: "allow", adaptiveDecision: "allow" }), /idempotencyKeyHash/);

console.log("platform shadow pilot parity kernel tests passed");
