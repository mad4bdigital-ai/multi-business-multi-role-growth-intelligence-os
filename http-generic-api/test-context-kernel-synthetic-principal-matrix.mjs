import assert from "node:assert/strict";

import {
  createAuthenticatedPrincipal,
  createContextCandidate,
  createEffectiveSubject,
} from "./contextKernel/domain/model.js";
import {
  DecisionReason,
  DecisionStatus,
  enumerateAuthorizedCandidates,
  resolveContextDecision,
} from "./contextKernel/domain/decisionPolicy.js";

const tenantA = createContextCandidate({
  candidateType: "workspace",
  stableRef: "workspace:tenant-a:primary",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  displayLabel: "Tenant A Primary",
  authoritySummary: "synthetic principal matrix",
  readinessSummary: "ready",
});
const tenantB = createContextCandidate({
  candidateType: "workspace",
  stableRef: "workspace:tenant-b:primary",
  tenantRef: "tenant-b",
  workspaceRef: "workspace-b",
  displayLabel: "Tenant B Primary",
  authoritySummary: "synthetic principal matrix",
  readinessSummary: "ready",
});
const candidates = Object.freeze([tenantB, tenantA]);

const principals = Object.freeze({
  admin: createAuthenticatedPrincipal({
    principalType: "admin",
    principalRef: "admin-1",
    authorizedTenantRefs: ["*"],
    attributes: { actorClass: "platform_admin", synthetic: true },
  }),
  tenant: createAuthenticatedPrincipal({
    principalType: "tenant_user",
    principalRef: "tenant-user-1",
    authorizedTenantRefs: ["tenant-a"],
    attributes: { actorClass: "tenant", synthetic: true },
  }),
  support: createAuthenticatedPrincipal({
    principalType: "service_principal",
    principalRef: "support-1",
    authorizedTenantRefs: ["tenant-a"],
    attributes: { actorClass: "support", synthetic: true },
  }),
  agent: createAuthenticatedPrincipal({
    principalType: "delegated_agent",
    principalRef: "agent-1",
    authorizedTenantRefs: ["tenant-a"],
    attributes: {
      actorClass: "agent",
      delegationStatus: "active",
      synthetic: true,
    },
  }),
  revoked: createAuthenticatedPrincipal({
    principalType: "tenant_user",
    principalRef: "revoked-user-1",
    authorizedTenantRefs: [],
    attributes: { actorClass: "tenant", lifecycleStatus: "revoked", synthetic: true },
  }),
});

const subjects = Object.freeze({
  tenant: createEffectiveSubject({
    subjectType: "tenant_user",
    subjectRef: "tenant-user-1",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
  }),
  support: createEffectiveSubject({
    subjectType: "support_session",
    subjectRef: "support-session-1",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
  }),
  agent: createEffectiveSubject({
    subjectType: "delegated_agent",
    subjectRef: "agent-subject-1",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    delegatedByPrincipalRef: "support-1",
  }),
});

function resolve({ principal, effectiveSubject = null, explicitRef = null }) {
  return resolveContextDecision({
    principal,
    effectiveSubject,
    candidates,
    operationIntent: "synthetic_principal_matrix_read",
    operationKind: "read",
    riskClass: "read",
    explicitRef,
  });
}

const visibleCounts = Object.freeze({
  admin: enumerateAuthorizedCandidates({
    principal: principals.admin,
    candidates,
  }).length,
  tenant: enumerateAuthorizedCandidates({
    principal: principals.tenant,
    effectiveSubject: subjects.tenant,
    candidates,
  }).length,
  support: enumerateAuthorizedCandidates({
    principal: principals.support,
    effectiveSubject: subjects.support,
    candidates,
  }).length,
  agent: enumerateAuthorizedCandidates({
    principal: principals.agent,
    effectiveSubject: subjects.agent,
    candidates,
  }).length,
  revoked: enumerateAuthorizedCandidates({
    principal: principals.revoked,
    candidates,
  }).length,
});
assert.deepEqual(visibleCounts, {
  admin: 2,
  tenant: 1,
  support: 1,
  agent: 1,
  revoked: 0,
});

const adminAmbiguous = resolve({ principal: principals.admin });
assert.equal(adminAmbiguous.status, DecisionStatus.INTERPRETATION_REQUIRED);
assert.deepEqual(adminAmbiguous.reasonCodes, [
  DecisionReason.MULTIPLE_AUTHORIZED_CANDIDATES,
]);
assert.deepEqual(
  adminAmbiguous.candidates.map((candidate) => candidate.stableRef),
  [tenantA.stableRef, tenantB.stableRef]
);

const adminExplicit = resolve({
  principal: principals.admin,
  explicitRef: tenantB.stableRef,
});
assert.equal(adminExplicit.status, DecisionStatus.RESOLVED);
assert.deepEqual(adminExplicit.reasonCodes, [DecisionReason.EXPLICIT_REFERENCE]);
assert.equal(adminExplicit.selectedCandidate.stableRef, tenantB.stableRef);

const sameTenantCases = [
  ["tenant", principals.tenant, subjects.tenant],
  ["support", principals.support, subjects.support],
  ["agent", principals.agent, subjects.agent],
];
for (const [label, principal, effectiveSubject] of sameTenantCases) {
  const decision = resolve({
    principal,
    effectiveSubject,
    explicitRef: tenantA.stableRef,
  });
  assert.equal(decision.status, DecisionStatus.RESOLVED, `${label} same-tenant status`);
  assert.deepEqual(
    decision.reasonCodes,
    [DecisionReason.EXPLICIT_REFERENCE],
    `${label} same-tenant reason`
  );
  assert.equal(
    decision.selectedCandidate.stableRef,
    tenantA.stableRef,
    `${label} same-tenant selection`
  );
}

for (const [label, principal, effectiveSubject] of sameTenantCases) {
  const decision = resolve({
    principal,
    effectiveSubject,
    explicitRef: tenantB.stableRef,
  });
  assert.equal(decision.status, DecisionStatus.BLOCKED, `${label} cross-tenant status`);
  assert.deepEqual(
    decision.reasonCodes,
    [DecisionReason.REFERENCE_NOT_AUTHORIZED],
    `${label} cross-tenant reason`
  );
  assert.equal(decision.selectedCandidate, null);
  assert.deepEqual(
    decision.candidates.map((candidate) => candidate.stableRef),
    [tenantA.stableRef]
  );
}

const revoked = resolve({ principal: principals.revoked });
assert.equal(revoked.status, DecisionStatus.BLOCKED);
assert.deepEqual(revoked.reasonCodes, [DecisionReason.NO_AUTHORIZED_CANDIDATES]);
assert.equal(revoked.selectedCandidate, null);
assert.deepEqual(revoked.candidates, []);
assert.equal(principals.revoked.attributes.lifecycleStatus, "revoked");
assert.deepEqual(principals.revoked.authorizedTenantRefs, []);

assert.equal(Object.isFrozen(principals), true);
assert.equal(Object.isFrozen(principals.agent), true);
assert.equal(Object.isFrozen(subjects.agent), true);
assert.equal(Object.isFrozen(adminExplicit), true);

console.log("context kernel synthetic principal matrix tests passed");
