import assert from "node:assert/strict";

import { createExecutionPlanService } from "./contextKernel/application/executionPlanService.js";

const fixedNow = new Date("2026-07-28T00:00:00.000Z");
const currentContext = {
  contextRevision: "revision-a",
  contextHash: "context-hash-a",
  selectedCandidate: { stableRef: "connection-a" },
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  connectionRef: "connection-a",
};
const resolution = {
  status: "resolved",
  context: currentContext,
  selectedCandidate: currentContext.selectedCandidate,
  capabilityReadiness: {
    capabilityKey: "wordpress.post.publish",
    dispatchAllowed: true,
    applyAllowed: true,
    currentManifest: {
      manifestHash: "manifest-hash-a",
      manifestVersion: 7,
    },
  },
};

const service = createExecutionPlanService({
  idFactory: () => "plan-a",
  clock: () => fixedNow,
  defaultTtlMs: 10 * 60 * 1000,
});
const plan = service.compile({
  resolution,
  operationIntent: "publish_wordpress_post",
  operationKind: "mutation",
  riskClass: "high",
  capabilityKey: "wordpress.post.publish",
  idempotencyKey: "idem-a",
});

assert.equal(plan.manifestHash, "manifest-hash-a");
assert.equal(plan.manifestVersion, 7);
assert.equal(plan.requiresApproval, true);

function approval(overrides = {}) {
  return {
    approvalRef: "approval-a",
    status: "approved",
    planRef: plan.planRef,
    planHash: plan.planHash,
    contextRevision: plan.contextRevision,
    manifestHash: plan.manifestHash,
    manifestVersion: plan.manifestVersion,
    expiresAt: "2026-07-28T00:05:00.000Z",
    ...overrides,
  };
}

const valid = service.validate({
  plan,
  currentContext,
  approval: approval(),
  now: new Date("2026-07-28T00:01:00.000Z"),
});
assert.equal(valid.valid, true);
assert.equal(valid.executionAllowed, true);
assert.equal(valid.approvalBindingVerified, true);
assert.equal(valid.approvalRef, "approval-a");
assert.deepEqual(valid.reasonCodes, []);
assert.equal(valid.secretsIncluded, false);

const legacyUnbound = service.validate({
  plan,
  currentContext,
  approvalRef: "approval-a",
  now: new Date("2026-07-28T00:01:00.000Z"),
});
assert.equal(legacyUnbound.valid, false);
assert.deepEqual(legacyUnbound.reasonCodes, ["approval_binding_required"]);

const consumedReplay = service.validate({
  plan,
  currentContext,
  approval: approval({
    status: "consumed",
    consumedAt: "2026-07-28T00:00:30.000Z",
  }),
  now: new Date("2026-07-28T00:01:00.000Z"),
});
assert.equal(consumedReplay.valid, false);
assert.ok(consumedReplay.reasonCodes.includes("approval_consumed"));
assert.equal(consumedReplay.approvalBindingVerified, false);

const revoked = service.validate({
  plan,
  currentContext,
  approval: approval({
    status: "revoked",
    revokedAt: "2026-07-28T00:00:30.000Z",
  }),
  now: new Date("2026-07-28T00:01:00.000Z"),
});
assert.ok(revoked.reasonCodes.includes("approval_revoked"));

const expired = service.validate({
  plan,
  currentContext,
  approval: approval({ expiresAt: "2026-07-28T00:00:30.000Z" }),
  now: new Date("2026-07-28T00:01:00.000Z"),
});
assert.ok(expired.reasonCodes.includes("approval_expired"));

const inactive = service.validate({
  plan,
  currentContext,
  approval: approval({ status: "pending" }),
  now: new Date("2026-07-28T00:01:00.000Z"),
});
assert.ok(inactive.reasonCodes.includes("approval_status_not_approved"));

const mismatchCases = [
  ["approval_ref_mismatch", approval({ approvalRef: "approval-b" }), "approval-a"],
  ["approval_plan_ref_mismatch", approval({ planRef: "plan-b" })],
  ["approval_plan_hash_mismatch", approval({ planHash: "plan-hash-b" })],
  ["approval_context_revision_mismatch", approval({ contextRevision: "revision-b" })],
  ["approval_manifest_hash_mismatch", approval({ manifestHash: "manifest-hash-b" })],
  ["approval_manifest_version_mismatch", approval({ manifestVersion: 8 })],
];
for (const [reasonCode, evidence, expectedApprovalRef = null] of mismatchCases) {
  const result = service.validate({
    plan,
    currentContext,
    approval: evidence,
    approvalRef: expectedApprovalRef,
    now: new Date("2026-07-28T00:01:00.000Z"),
  });
  assert.equal(result.valid, false, reasonCode);
  assert.ok(result.reasonCodes.includes(reasonCode), reasonCode);
  assert.equal(result.executionAllowed, false, reasonCode);
}

const readPlan = service.compile({
  resolution,
  operationIntent: "read_wordpress_post",
  operationKind: "read",
  riskClass: "read",
  capabilityKey: "wordpress.post.publish",
});
const readValidation = service.validate({
  plan: readPlan,
  currentContext,
  now: new Date("2026-07-28T00:01:00.000Z"),
});
assert.equal(readValidation.valid, true);
assert.equal(readValidation.executionAllowed, true);
assert.equal(readValidation.approvalBindingVerified, false);
assert.equal(readValidation.approvalRef, null);

assert.throws(
  () =>
    service.compile({
      resolution: {
        ...resolution,
        capabilityReadiness: {
          ...resolution.capabilityReadiness,
          currentManifest: null,
        },
      },
      operationIntent: "unsafe_unbound_mutation",
      operationKind: "mutation",
      riskClass: "high",
    }),
  (error) => error.code === "capability_manifest_required"
);

console.log("context kernel approval binding tests passed");
