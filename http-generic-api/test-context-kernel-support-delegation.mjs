import assert from "node:assert/strict";

import {
  createAuthenticatedPrincipal,
  createEffectiveSubject,
} from "./contextKernel/domain/model.js";
import {
  createSupportDelegationEvidence,
  evaluateSupportDelegation,
} from "./contextKernel/domain/supportDelegationPolicy.js";

const evaluatedAt = new Date("2026-07-28T00:30:00.000Z");
const supportPrincipal = createAuthenticatedPrincipal({
  principalType: "service_principal",
  principalRef: "support-1",
  authorizedTenantRefs: ["tenant-a"],
  attributes: { actorClass: "support", synthetic: true },
});
const impersonatedSubject = createEffectiveSubject({
  subjectType: "tenant_user",
  subjectRef: "tenant-user-1",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  delegatedByPrincipalRef: "support-1",
});

function impersonationEvidence(overrides = {}) {
  return createSupportDelegationEvidence({
    delegationRef: "support-delegation-1",
    mode: "support_impersonation",
    actorPrincipalRef: "support-1",
    subjectRef: "tenant-user-1",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    reasonCode: "SUPPORT_CASE_DIAGNOSIS",
    auditRef: "audit-support-1",
    allowedOperations: ["diagnose_connection", "read_customer_context"],
    validFrom: "2026-07-28T00:00:00.000Z",
    expiresAt: "2026-07-28T01:00:00.000Z",
    ...overrides,
  });
}

const impersonation = evaluateSupportDelegation({
  principal: supportPrincipal,
  effectiveSubject: impersonatedSubject,
  evidence: impersonationEvidence(),
  operationIntent: "diagnose_connection",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  now: evaluatedAt,
});
assert.equal(impersonation.allowed, true);
assert.equal(impersonation.status, "allowed");
assert.deepEqual(impersonation.reasonCodes, []);
assert.deepEqual(impersonation.actor, {
  principalType: "service_principal",
  principalRef: "support-1",
});
assert.deepEqual(impersonation.effectiveSubject, {
  subjectType: "tenant_user",
  subjectRef: "tenant-user-1",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  delegatedByPrincipalRef: "support-1",
});
assert.equal(impersonation.auditRequired, true);
assert.equal(impersonation.runtimeAuthorityChanged, false);
assert.equal(impersonation.automaticWritePerformed, false);
assert.equal(impersonation.secretsIncluded, false);

const delegatedAgent = createAuthenticatedPrincipal({
  principalType: "delegated_agent",
  principalRef: "agent-1",
  authorizedTenantRefs: ["tenant-a"],
  attributes: {
    actorClass: "agent",
    delegatedByPrincipalRef: "support-1",
    synthetic: true,
  },
});
const delegatedAgentSubject = createEffectiveSubject({
  subjectType: "delegated_agent",
  subjectRef: "agent-subject-1",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  delegatedByPrincipalRef: "support-1",
});
const delegatedAgentEvidence = createSupportDelegationEvidence({
  delegationRef: "support-agent-delegation-1",
  mode: "support_delegated_agent",
  actorPrincipalRef: "agent-1",
  subjectRef: "agent-subject-1",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  delegatedByPrincipalRef: "support-1",
  reasonCode: "SUPPORT_AGENT_DIAGNOSIS",
  auditRef: "audit-support-agent-1",
  allowedOperations: ["diagnose_connection"],
  validFrom: "2026-07-28T00:00:00.000Z",
  expiresAt: "2026-07-28T01:00:00.000Z",
});
const delegatedAgentDecision = evaluateSupportDelegation({
  principal: delegatedAgent,
  effectiveSubject: delegatedAgentSubject,
  evidence: delegatedAgentEvidence,
  operationIntent: "diagnose_connection",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  now: evaluatedAt,
});
assert.equal(delegatedAgentDecision.allowed, true);
assert.equal(delegatedAgentDecision.mode, "support_delegated_agent");
assert.equal(delegatedAgentDecision.actor.principalRef, "agent-1");
assert.equal(
  delegatedAgentDecision.effectiveSubject.delegatedByPrincipalRef,
  "support-1",
);

function expectBlocked(input, reasonCode) {
  const decision = evaluateSupportDelegation(input);
  assert.equal(decision.allowed, false, reasonCode);
  assert.equal(decision.status, "blocked", reasonCode);
  assert.ok(decision.reasonCodes.includes(reasonCode), reasonCode);
  assert.equal(decision.runtimeAuthorityChanged, false);
}

expectBlocked(
  {
    principal: supportPrincipal,
    effectiveSubject: impersonatedSubject,
    evidence: impersonationEvidence(),
    operationIntent: "diagnose_connection",
    tenantRef: "tenant-b",
    workspaceRef: "workspace-a",
    now: evaluatedAt,
  },
  "SUPPORT_DELEGATION_TENANT_MISMATCH",
);
expectBlocked(
  {
    principal: supportPrincipal,
    effectiveSubject: impersonatedSubject,
    evidence: impersonationEvidence({
      status: "revoked",
      revokedAt: "2026-07-28T00:20:00.000Z",
    }),
    operationIntent: "diagnose_connection",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    now: evaluatedAt,
  },
  "SUPPORT_DELEGATION_REVOKED",
);
expectBlocked(
  {
    principal: supportPrincipal,
    effectiveSubject: impersonatedSubject,
    evidence: impersonationEvidence({ expiresAt: "2026-07-28T00:20:00.000Z" }),
    operationIntent: "diagnose_connection",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    now: evaluatedAt,
  },
  "SUPPORT_DELEGATION_EXPIRED",
);
expectBlocked(
  {
    principal: supportPrincipal,
    effectiveSubject: impersonatedSubject,
    evidence: impersonationEvidence({
      validFrom: "2026-07-28T00:40:00.000Z",
      expiresAt: "2026-07-28T01:40:00.000Z",
    }),
    operationIntent: "diagnose_connection",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    now: evaluatedAt,
  },
  "SUPPORT_DELEGATION_NOT_YET_ACTIVE",
);
expectBlocked(
  {
    principal: supportPrincipal,
    effectiveSubject: impersonatedSubject,
    evidence: impersonationEvidence(),
    operationIntent: "delete_customer_data",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    now: evaluatedAt,
  },
  "SUPPORT_DELEGATION_OPERATION_NOT_ALLOWED",
);
expectBlocked(
  {
    principal: createAuthenticatedPrincipal({
      principalType: "service_principal",
      principalRef: "support-2",
      authorizedTenantRefs: ["tenant-a"],
      attributes: { actorClass: "support" },
    }),
    effectiveSubject: impersonatedSubject,
    evidence: impersonationEvidence(),
    operationIntent: "diagnose_connection",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    now: evaluatedAt,
  },
  "SUPPORT_DELEGATION_ACTOR_MISMATCH",
);
expectBlocked(
  {
    principal: supportPrincipal,
    effectiveSubject: createEffectiveSubject({
      subjectType: "tenant_user",
      subjectRef: "tenant-user-2",
      tenantRef: "tenant-a",
      workspaceRef: "workspace-a",
      delegatedByPrincipalRef: "support-1",
    }),
    evidence: impersonationEvidence(),
    operationIntent: "diagnose_connection",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    now: evaluatedAt,
  },
  "SUPPORT_DELEGATION_SUBJECT_MISMATCH",
);
expectBlocked(
  {
    principal: supportPrincipal,
    effectiveSubject: impersonatedSubject,
    evidence: impersonationEvidence(),
    operationIntent: "diagnose_connection",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-b",
    now: evaluatedAt,
  },
  "SUPPORT_DELEGATION_WORKSPACE_MISMATCH",
);
expectBlocked(
  {
    principal: createAuthenticatedPrincipal({
      principalType: "service_principal",
      principalRef: "support-1",
      authorizedTenantRefs: [],
      attributes: { actorClass: "support" },
    }),
    effectiveSubject: impersonatedSubject,
    evidence: impersonationEvidence(),
    operationIntent: "diagnose_connection",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    now: evaluatedAt,
  },
  "SUPPORT_DELEGATION_TENANT_NOT_AUTHORIZED",
);
expectBlocked(
  {
    principal: createAuthenticatedPrincipal({
      principalType: "delegated_agent",
      principalRef: "agent-1",
      authorizedTenantRefs: ["tenant-a"],
      attributes: {
        actorClass: "agent",
        delegatedByPrincipalRef: "support-2",
      },
    }),
    effectiveSubject: delegatedAgentSubject,
    evidence: delegatedAgentEvidence,
    operationIntent: "diagnose_connection",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    now: evaluatedAt,
  },
  "SUPPORT_DELEGATED_AGENT_CHAIN_MISMATCH",
);

assert.throws(
  () => impersonationEvidence({ reasonCode: "" }),
  /reasonCode must be a non-empty string/,
);
assert.throws(
  () => impersonationEvidence({ auditRef: "" }),
  /auditRef must be a non-empty string/,
);
assert.throws(
  () => impersonationEvidence({ allowedOperations: [] }),
  /allowedOperations must contain at least one operation/,
);
assert.throws(
  () =>
    impersonationEvidence({
      validFrom: "2026-07-28T01:00:00.000Z",
      expiresAt: "2026-07-28T00:00:00.000Z",
    }),
  /expiresAt must be later than validFrom/,
);
assert.throws(
  () => impersonationEvidence({ revokedAt: "2026-07-28T00:20:00.000Z" }),
  /Active delegation evidence cannot include revokedAt/,
);

assert.equal(Object.isFrozen(impersonation), true);
assert.equal(Object.isFrozen(impersonation.actor), true);
assert.equal(Object.isFrozen(impersonation.effectiveSubject), true);
assert.equal(Object.isFrozen(delegatedAgentEvidence), true);

console.log("context kernel support delegation tests passed");
