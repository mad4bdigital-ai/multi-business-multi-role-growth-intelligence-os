import assert from "node:assert/strict";

import {
  DecisionReason,
  DecisionStatus,
  createAuthenticatedPrincipal,
  createContextCandidate,
  createContextPin,
  createEffectiveSubject,
  enumerateAuthorizedCandidates,
  resolveContextDecision,
} from "./contextKernel/domain/index.js";
import { buildResourceApiShadowEvidence } from "./contextKernel/integration/index.js";

const candidates = [
  createContextCandidate({
    candidateType: "connection",
    stableRef: "tenant-a-workspace-a",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    resourceType: "wordpress_site",
    resourceRef: "site-a",
    connectionRef: "connection-a",
  }),
  createContextCandidate({
    candidateType: "connection",
    stableRef: "tenant-a-workspace-b",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-b",
    resourceType: "wordpress_site",
    resourceRef: "site-b",
    connectionRef: "connection-b",
  }),
  createContextCandidate({
    candidateType: "connection",
    stableRef: "tenant-b-workspace-a",
    tenantRef: "tenant-b",
    workspaceRef: "workspace-a",
    resourceType: "wordpress_site",
    resourceRef: "site-cross-tenant",
    connectionRef: "connection-cross-tenant",
  }),
];

const principalCases = [
  createAuthenticatedPrincipal({
    principalType: "admin",
    principalRef: "platform-admin",
    authorizedTenantRefs: ["*"],
  }),
  createAuthenticatedPrincipal({
    principalType: "delegated_agent",
    principalRef: "delegated-agent",
    authorizedTenantRefs: ["tenant-a", "tenant-b"],
  }),
];

function assertReferenceBlocked(decision) {
  assert.equal(decision.status, DecisionStatus.BLOCKED);
  assert.deepEqual(decision.reasonCodes, [DecisionReason.REFERENCE_NOT_AUTHORIZED]);
  assert.equal(decision.selectedCandidate, null);
  assert.deepEqual(
    decision.candidates.map((candidate) => candidate.stableRef),
    ["tenant-a-workspace-a"],
  );
  assert.ok(decision.candidates.every((candidate) => candidate.tenantRef === "tenant-a"));
  assert.ok(decision.candidates.every((candidate) => candidate.workspaceRef === "workspace-a"));
}

for (const principal of principalCases) {
  const effectiveSubject = createEffectiveSubject({
    subjectType: "tenant_user",
    subjectRef: `subject-for-${principal.principalRef}`,
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    delegatedByPrincipalRef: principal.principalRef,
  });

  const authorized = enumerateAuthorizedCandidates({
    principal,
    effectiveSubject,
    candidates,
  });
  assert.deepEqual(
    authorized.map((candidate) => candidate.stableRef),
    ["tenant-a-workspace-a"],
  );

  assertReferenceBlocked(resolveContextDecision({
    principal,
    effectiveSubject,
    candidates,
    operationIntent: "wordpress_site.update",
    operationKind: "mutation",
    riskClass: "high",
    explicitRef: "tenant-b-workspace-a",
  }));

  assertReferenceBlocked(resolveContextDecision({
    principal,
    effectiveSubject,
    candidates,
    operationIntent: "wordpress_site.read",
    verifiedPin: createContextPin({
      pinRef: "cross-tenant-pin",
      stableRef: "tenant-b-workspace-a",
      contextRevision: "revision-a",
      verified: true,
      expiresAt: "2030-01-01T00:00:00.000Z",
    }),
    currentContextRevision: "revision-a",
    now: new Date("2029-01-01T00:00:00.000Z"),
  }));

  assertReferenceBlocked(resolveContextDecision({
    principal,
    effectiveSubject,
    candidates,
    operationIntent: "wordpress_site.update",
    operationKind: "mutation",
    riskClass: "high",
    exactBindingRef: "tenant-b-workspace-a",
  }));

  assertReferenceBlocked(resolveContextDecision({
    principal,
    effectiveSubject,
    candidates,
    operationIntent: "wordpress_site.preview",
    operationKind: "read",
    riskClass: "read",
    fallbackRef: "tenant-b-workspace-a",
    allowLowRiskFallback: true,
  }));

  const allowed = resolveContextDecision({
    principal,
    effectiveSubject,
    candidates,
    operationIntent: "wordpress_site.read",
    explicitRef: "tenant-a-workspace-a",
  });
  assert.equal(allowed.status, DecisionStatus.RESOLVED);
  assert.equal(allowed.selectedCandidate.stableRef, "tenant-a-workspace-a");
}

const crossTenantRouteEvidence = buildResourceApiShadowEvidence({
  auth: {
    mode: "user_jwt",
    user_id: "user-a",
    tenant_id: "tenant-a",
  },
  params: {
    tenant_id: "tenant-b",
    resourceKey: "wordpress_sites",
    resourceId: "site-cross-tenant",
  },
});
assert.equal(crossTenantRouteEvidence.crossTenantMismatch, true);
assert.equal(crossTenantRouteEvidence.resolutionInput, null);

console.log("context kernel cross-tenant isolation release gate passed");
