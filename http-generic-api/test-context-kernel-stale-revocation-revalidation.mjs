import assert from "node:assert/strict";

import { createExecutionPlanService } from "./contextKernel/application/executionPlanService.js";
import {
  createAuthenticatedPrincipal,
  createEffectiveSubject,
} from "./contextKernel/domain/model.js";
import {
  createSupportDelegationEvidence,
  evaluateSupportDelegation,
} from "./contextKernel/domain/supportDelegationPolicy.js";

const compileTime = new Date("2026-07-29T00:00:00.000Z");
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
    manifestHash: "manifest-hash-a",
    manifestVersion: 3,
  },
};
const planService = createExecutionPlanService({
  idFactory: () => "plan-revalidation-a",
  clock: () => compileTime,
  defaultTtlMs: 10 * 60 * 1000,
});
const plan = planService.compile({
  resolution,
  operationIntent: "publish_wordpress_post",
  operationKind: "mutation",
  riskClass: "high",
  capabilityKey: "wordpress.post.publish",
  idempotencyKey: "idem-revalidation-a",
});

function approval(overrides = {}) {
  return {
    approvalRef: "approval-revalidation-a",
    status: "approved",
    planRef: plan.planRef,
    planHash: plan.planHash,
    contextRevision: plan.contextRevision,
    manifestHash: plan.manifestHash,
    manifestVersion: plan.manifestVersion,
    expiresAt: "2026-07-29T00:20:00.000Z",
    ...overrides,
  };
}

const validPlan = planService.validate({
  plan,
  currentContext,
  approval: approval(),
  now: new Date("2026-07-29T00:01:00.000Z"),
});
assert.equal(validPlan.valid, true);
assert.equal(validPlan.executionAllowed, true);
assert.equal(validPlan.approvalBindingVerified, true);
assert.deepEqual(validPlan.reasonCodes, []);

const staleRevision = planService.validate({
  plan,
  currentContext: {
    ...currentContext,
    contextRevision: "revision-b",
  },
  approval: approval(),
  now: new Date("2026-07-29T00:01:00.000Z"),
});
assert.equal(staleRevision.valid, false);
assert.equal(staleRevision.executionAllowed, false);
assert.ok(staleRevision.reasonCodes.includes("context_revision_mismatch"));

const expiredPlan = planService.validate({
  plan,
  currentContext,
  approval: approval(),
  now: new Date("2026-07-29T00:11:00.000Z"),
});
assert.equal(expiredPlan.valid, false);
assert.equal(expiredPlan.executionAllowed, false);
assert.ok(expiredPlan.reasonCodes.includes("context_expired"));

const revokedApproval = planService.validate({
  plan,
  currentContext,
  approval: approval({
    status: "revoked",
    revokedAt: "2026-07-29T00:00:30.000Z",
  }),
  now: new Date("2026-07-29T00:01:00.000Z"),
});
assert.equal(revokedApproval.valid, false);
assert.equal(revokedApproval.executionAllowed, false);
assert.equal(revokedApproval.approvalBindingVerified, false);
assert.ok(revokedApproval.reasonCodes.includes("approval_revoked"));

const consumedApproval = planService.validate({
  plan,
  currentContext,
  approval: approval({
    status: "consumed",
    consumedAt: "2026-07-29T00:00:30.000Z",
  }),
  now: new Date("2026-07-29T00:01:00.000Z"),
});
assert.equal(consumedApproval.valid, false);
assert.equal(consumedApproval.executionAllowed, false);
assert.equal(consumedApproval.approvalBindingVerified, false);
assert.ok(consumedApproval.reasonCodes.includes("approval_consumed"));

const supportPrincipal = createAuthenticatedPrincipal({
  principalType: "service_principal",
  principalRef: "support-1",
  authorizedTenantRefs: ["tenant-a"],
  attributes: { actorClass: "support", synthetic: true },
});
const supportSubject = createEffectiveSubject({
  subjectType: "tenant_user",
  subjectRef: "tenant-user-1",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  delegatedByPrincipalRef: "support-1",
});

function delegationEvidence(overrides = {}) {
  return createSupportDelegationEvidence({
    delegationRef: "delegation-revalidation-a",
    mode: "support_impersonation",
    actorPrincipalRef: "support-1",
    subjectRef: "tenant-user-1",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    reasonCode: "SUPPORT_CASE_REVALIDATION",
    auditRef: "audit-revalidation-a",
    allowedOperations: ["diagnose_connection"],
    validFrom: "2026-07-29T00:00:00.000Z",
    expiresAt: "2026-07-29T01:00:00.000Z",
    ...overrides,
  });
}

const validDelegation = evaluateSupportDelegation({
  principal: supportPrincipal,
  effectiveSubject: supportSubject,
  evidence: delegationEvidence(),
  operationIntent: "diagnose_connection",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  now: new Date("2026-07-29T00:30:00.000Z"),
});
assert.equal(validDelegation.allowed, true);
assert.deepEqual(validDelegation.reasonCodes, []);

const revokedDelegation = evaluateSupportDelegation({
  principal: supportPrincipal,
  effectiveSubject: supportSubject,
  evidence: delegationEvidence({
    status: "revoked",
    revokedAt: "2026-07-29T00:20:00.000Z",
  }),
  operationIntent: "diagnose_connection",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  now: new Date("2026-07-29T00:30:00.000Z"),
});
assert.equal(revokedDelegation.allowed, false);
assert.ok(revokedDelegation.reasonCodes.includes("SUPPORT_DELEGATION_REVOKED"));

const expiredDelegation = evaluateSupportDelegation({
  principal: supportPrincipal,
  effectiveSubject: supportSubject,
  evidence: delegationEvidence({ expiresAt: "2026-07-29T00:20:00.000Z" }),
  operationIntent: "diagnose_connection",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  now: new Date("2026-07-29T00:30:00.000Z"),
});
assert.equal(expiredDelegation.allowed, false);
assert.ok(expiredDelegation.reasonCodes.includes("SUPPORT_DELEGATION_EXPIRED"));

const withdrawnTenantAuthority = evaluateSupportDelegation({
  principal: createAuthenticatedPrincipal({
    principalType: "service_principal",
    principalRef: "support-1",
    authorizedTenantRefs: [],
    attributes: { actorClass: "support", synthetic: true },
  }),
  effectiveSubject: supportSubject,
  evidence: delegationEvidence(),
  operationIntent: "diagnose_connection",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  now: new Date("2026-07-29T00:30:00.000Z"),
});
assert.equal(withdrawnTenantAuthority.allowed, false);
assert.ok(
  withdrawnTenantAuthority.reasonCodes.includes(
    "SUPPORT_DELEGATION_TENANT_NOT_AUTHORIZED",
  ),
);

for (const decision of [
  staleRevision,
  expiredPlan,
  revokedApproval,
  consumedApproval,
  revokedDelegation,
  expiredDelegation,
  withdrawnTenantAuthority,
]) {
  assert.equal(decision.executionAllowed ?? decision.allowed, false);
  assert.equal(decision.automaticWritePerformed, false);
  assert.equal(decision.secretsIncluded, false);
}

console.log("context kernel stale and revocation revalidation tests passed");
