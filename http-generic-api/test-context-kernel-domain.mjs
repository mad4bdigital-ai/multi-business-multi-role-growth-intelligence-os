import assert from "node:assert/strict";

import {
  DecisionReason,
  DecisionStatus,
  computeInvalidatedDimensions,
  createAuthenticatedPrincipal,
  createContextCandidate,
  createContextHash,
  createContextPin,
  createContextRevision,
  createEffectiveSubject,
  resolveContextDecision,
  validateContextRevision,
} from "./contextKernel/domain/index.js";

function permutations(values) {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidateIndex) => candidateIndex !== index)).map((tail) => [value, ...tail]),
  );
}

const principal = createAuthenticatedPrincipal({
  principalType: "admin",
  principalRef: "principal-admin",
  authorizedTenantRefs: ["tenant-b", "tenant-a"],
});

const subject = createEffectiveSubject({
  subjectRef: "subject-a",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  delegatedByPrincipalRef: principal.principalRef,
});

const candidates = [
  createContextCandidate({
    candidateType: "connection",
    stableRef: "connection-z",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    resourceType: "wordpress_site",
    resourceRef: "site-b",
    connectionRef: "connection-z",
  }),
  createContextCandidate({
    candidateType: "connection",
    stableRef: "connection-a",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    resourceType: "wordpress_site",
    resourceRef: "site-a",
    connectionRef: "connection-a",
  }),
  createContextCandidate({
    candidateType: "connection",
    stableRef: "connection-cross-tenant",
    tenantRef: "tenant-b",
    workspaceRef: "workspace-b",
    resourceType: "wordpress_site",
    resourceRef: "site-c",
    connectionRef: "connection-cross-tenant",
  }),
];

const expectedOrder = ["connection-a", "connection-z"];
for (const permutation of permutations(candidates)) {
  const decision = resolveContextDecision({
    principal,
    effectiveSubject: subject,
    candidates: permutation,
    operationIntent: "wordpress_site.read",
  });
  assert.equal(decision.status, DecisionStatus.INTERPRETATION_REQUIRED);
  assert.deepEqual(decision.candidates.map((candidate) => candidate.stableRef), expectedOrder);
  assert.deepEqual(decision.reasonCodes, [DecisionReason.MULTIPLE_AUTHORIZED_CANDIDATES]);
}

const explicit = resolveContextDecision({
  principal,
  effectiveSubject: subject,
  candidates,
  operationIntent: "wordpress_site.update",
  operationKind: "mutation",
  riskClass: "high",
  explicitRef: "connection-z",
});
assert.equal(explicit.status, DecisionStatus.RESOLVED);
assert.equal(explicit.selectedCandidate.stableRef, "connection-z");
assert.equal(explicit.reasonCodes[0], DecisionReason.EXPLICIT_REFERENCE);

const exactBinding = resolveContextDecision({
  principal,
  effectiveSubject: subject,
  candidates,
  operationIntent: "wordpress_site.update",
  operationKind: "mutation",
  exactBindingRef: "connection-a",
});
assert.equal(exactBinding.status, DecisionStatus.RESOLVED);
assert.equal(exactBinding.reasonCodes[0], DecisionReason.EXACT_BINDING);

const verifiedPin = createContextPin({
  pinRef: "pin-a",
  stableRef: "connection-a",
  contextRevision: "revision-a",
  verified: true,
  expiresAt: "2030-01-01T00:00:00.000Z",
});
const pinned = resolveContextDecision({
  principal,
  effectiveSubject: subject,
  candidates,
  operationIntent: "wordpress_site.read",
  verifiedPin,
  currentContextRevision: "revision-a",
  now: new Date("2029-01-01T00:00:00.000Z"),
});
assert.equal(pinned.status, DecisionStatus.RESOLVED);
assert.equal(pinned.reasonCodes[0], DecisionReason.VERIFIED_PIN);

const stalePin = resolveContextDecision({
  principal,
  effectiveSubject: subject,
  candidates,
  operationIntent: "wordpress_site.read",
  verifiedPin,
  currentContextRevision: "revision-b",
  now: new Date("2029-01-01T00:00:00.000Z"),
});
assert.equal(stalePin.status, DecisionStatus.BLOCKED);
assert.equal(stalePin.reasonCodes[0], DecisionReason.PIN_REVISION_CONFLICT);

const expiredPin = resolveContextDecision({
  principal,
  effectiveSubject: subject,
  candidates,
  operationIntent: "wordpress_site.read",
  verifiedPin,
  currentContextRevision: "revision-a",
  now: new Date("2031-01-01T00:00:00.000Z"),
});
assert.equal(expiredPin.status, DecisionStatus.BLOCKED);
assert.equal(expiredPin.reasonCodes[0], DecisionReason.PIN_EXPIRED);

const highRiskFallback = resolveContextDecision({
  principal,
  effectiveSubject: subject,
  candidates,
  operationIntent: "wordpress_site.publish",
  operationKind: "mutation",
  riskClass: "critical",
  fallbackRef: "connection-a",
  allowLowRiskFallback: true,
});
assert.equal(highRiskFallback.status, DecisionStatus.BLOCKED);
assert.equal(highRiskFallback.reasonCodes[0], DecisionReason.FALLBACK_SELECTION_FORBIDDEN);

const mediumRiskFallback = resolveContextDecision({
  principal,
  effectiveSubject: subject,
  candidates,
  operationIntent: "wordpress_site.update",
  operationKind: "mutation",
  riskClass: "medium",
  fallbackRef: "connection-a",
  allowLowRiskFallback: true,
});
assert.equal(mediumRiskFallback.status, DecisionStatus.BLOCKED);
assert.equal(mediumRiskFallback.reasonCodes[0], DecisionReason.FALLBACK_SELECTION_FORBIDDEN);

const lowRiskFallback = resolveContextDecision({
  principal,
  effectiveSubject: subject,
  candidates,
  operationIntent: "wordpress_site.preview",
  operationKind: "read",
  riskClass: "low",
  fallbackRef: "connection-a",
  allowLowRiskFallback: true,
});
assert.equal(lowRiskFallback.status, DecisionStatus.RESOLVED);
assert.equal(lowRiskFallback.reasonCodes[0], DecisionReason.LOW_RISK_FALLBACK);

const missingEffectiveSubject = resolveContextDecision({
  principal,
  candidates,
  operationIntent: "wordpress_site.update",
  operationKind: "mutation",
  riskClass: "high",
  explicitRef: "connection-a",
});
assert.equal(missingEffectiveSubject.status, DecisionStatus.BLOCKED);
assert.equal(missingEffectiveSubject.reasonCodes[0], DecisionReason.EFFECTIVE_SUBJECT_REQUIRED);

const tenantOnlyPrincipal = createAuthenticatedPrincipal({
  principalType: "tenant_user",
  principalRef: "principal-tenant-a",
  authorizedTenantRefs: ["tenant-a"],
});
const singleCandidate = resolveContextDecision({
  principal: tenantOnlyPrincipal,
  effectiveSubject: subject,
  candidates: [candidates[0], candidates[2]],
  operationIntent: "wordpress_site.read",
});
assert.equal(singleCandidate.status, DecisionStatus.RESOLVED);
assert.equal(singleCandidate.reasonCodes[0], DecisionReason.SINGLE_AUTHORIZED_CANDIDATE);
assert.equal(singleCandidate.selectedCandidate.stableRef, "connection-z");

const contextA = {
  principalRef: "principal-admin",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  connectionRef: "connection-a",
  authorizationRef: "authority-a",
  credentials: { accessToken: "not-part-of-the-hash" },
  authorization: "Bearer token-a",
};
const contextB = {
  connectionRef: "connection-a",
  workspaceRef: "workspace-a",
  tenantRef: "tenant-a",
  principalRef: "principal-admin",
  authorizationRef: "authority-a",
  credentials: { accessToken: "different-secret" },
  authorization: "Bearer token-b",
};
assert.equal(createContextHash(contextA), createContextHash(contextB));
assert.match(createContextHash(contextA), /^[0-9a-f]{64}$/);
assert.equal(createContextRevision(contextA, "previous"), createContextRevision(contextB, "previous"));

const contextWithDifferentAuthority = {
  ...contextB,
  authorizationRef: "authority-b",
};
assert.notEqual(createContextHash(contextA), createContextHash(contextWithDifferentAuthority));

const revision = createContextRevision(contextA);
assert.deepEqual(
  validateContextRevision({
    expectedRevision: revision,
    actualRevision: revision,
    expiresAt: "2030-01-01T00:00:00.000Z",
    now: new Date("2029-01-01T00:00:00.000Z"),
  }),
  { valid: true, reasonCodes: [], actualRevision: revision },
);
assert.deepEqual(
  validateContextRevision({
    expectedRevision: "stale",
    actualRevision: revision,
    expiresAt: "2028-01-01T00:00:00.000Z",
    now: new Date("2029-01-01T00:00:00.000Z"),
  }).reasonCodes,
  ["context_revision_mismatch", "context_expired"],
);

assert.deepEqual(computeInvalidatedDimensions(["tenant"]), [
  "tenant",
  "workspace",
  "brand",
  "resource",
  "connection",
  "authority",
  "capability",
  "plan",
  "approval",
  "execution",
]);
assert.deepEqual(computeInvalidatedDimensions(["plan"]), ["plan", "approval", "execution"]);

assert.throws(() => {
  principal.authorizedTenantRefs.push("tenant-c");
}, TypeError);

console.log("context kernel domain tests passed");
