import assert from "node:assert/strict";

import {
  createShadowAuthorityParityService,
} from "./contextKernel/application/shadowAuthorityParityService.js";

const NOW = new Date("2030-01-01T00:10:00.000Z");

function snapshot(source, overrides = {}) {
  return {
    source,
    resolverKey: source === "legacy" ? "legacy_authority_v1" : "ueacp_authority_v1",
    evaluatedAt: "2030-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T01:00:00.000Z",
    authorityAllowed: true,
    executionEligible: false,
    identitySets: {
      resourceRefs: ["repository-a", "repository-b"],
      capabilityKeys: ["repository.read"],
      connectionRefs: ["connection-a"],
      actionKeys: ["repository.read"],
    },
    reasonCodes: ["AUTHORITY_READY"],
    readinessDimensions: {
      capability: "ready",
      certification: "ready",
      connection: "ready",
      resource: "ready",
    },
    dataQualityIssues: [],
    unsupportedSemantics: [],
    manifestRef: `${source}-manifest-a`,
    revisionRef: `${source}-revision-a`,
    ...overrides,
  };
}

const service = createShadowAuthorityParityService();
const matched = service.compare({
  legacySnapshot: snapshot("legacy", {
    secret: "must-not-leak",
    identitySets: {
      resourceRefs: ["repository-b", "repository-a"],
      capabilityKeys: ["repository.read"],
      connectionRefs: ["connection-a"],
      actionKeys: ["repository.read"],
    },
  }),
  effectiveSnapshot: snapshot("effective", {
    credentialPayload: { password: "must-not-leak" },
  }),
  correlationRef: "comparison-a",
  now: NOW,
});

assert.equal(matched.status, "matched");
assert.equal(matched.parityStatus, "pass");
assert.equal(matched.matched, true);
assert.deepEqual(matched.mismatchClasses, []);
assert.deepEqual(matched.reasonCodes, ["SHADOW_PARITY_MATCHED"]);
assert.equal(matched.securityRelevant, false);
assert.equal(matched.rolloutBlocked, false);
assert.equal(matched.comparisonRef, "comparison-a");
assert.equal(matched.comparator, "ueacp_shadow_authority_parity_v1");
assert.equal(matched.persistenceRequested, false);
assert.equal(matched.evidencePersisted, false);
assert.equal(matched.rolloutApproved, false);
assert.equal(matched.authorityGranted, false);
assert.equal(matched.executionAuthorized, false);
assert.equal(matched.executionPerformed, false);
assert.equal(matched.runtimeAuthorityChanged, false);
assert.equal(matched.automaticWritePerformed, false);
assert.equal(matched.providerCallMade, false);
assert.equal(matched.credentialPayloadRead, false);
assert.equal(matched.secretsIncluded, false);
assert.deepEqual(matched.identityDifferences.resourceRefs, {
  legacyOnly: [],
  effectiveOnly: [],
  shared: ["repository-a", "repository-b"],
});
assert.deepEqual(matched.decisionDifferences.reasonCodes, {
  legacyOnly: [],
  effectiveOnly: [],
  shared: ["AUTHORITY_READY"],
});
assert.deepEqual(matched.decisionDifferences.readinessDimensions, []);
assert.equal(JSON.stringify(matched).includes("must-not-leak"), false);
assert.equal(Object.isFrozen(matched), true);
assert.equal(Object.isFrozen(matched.identityDifferences.resourceRefs), true);
assert.throws(() => {
  matched.identityDifferences.resourceRefs.shared.push("repository-c");
}, TypeError);

const legacyOverGrant = service.compare({
  legacySnapshot: snapshot("legacy", {
    identitySets: {
      resourceRefs: ["repository-a", "repository-b"],
      capabilityKeys: ["repository.read"],
      connectionRefs: ["connection-a"],
      actionKeys: ["repository.read"],
    },
  }),
  effectiveSnapshot: snapshot("effective", {
    authorityAllowed: false,
    identitySets: {
      resourceRefs: ["repository-a"],
      capabilityKeys: ["repository.read"],
      connectionRefs: ["connection-a"],
      actionKeys: ["repository.read"],
    },
    reasonCodes: ["RESOURCE_RESTRICTED"],
    readinessDimensions: {
      capability: "ready",
      certification: "ready",
      connection: "ready",
      resource: "blocked",
    },
  }),
  now: NOW,
});
assert.equal(legacyOverGrant.status, "mismatched");
assert.equal(legacyOverGrant.parityStatus, "blocked");
assert.equal(legacyOverGrant.securityRelevant, true);
assert.equal(legacyOverGrant.rolloutBlocked, true);
assert.ok(legacyOverGrant.mismatchClasses.includes("legacy_over_grant"));
assert.ok(legacyOverGrant.mismatchClasses.includes("new_resolver_under_grant"));
assert.ok(legacyOverGrant.mismatchClasses.includes("data_quality_mismatch"));
assert.deepEqual(legacyOverGrant.identityDifferences.resourceRefs.legacyOnly, ["repository-b"]);
assert.equal(legacyOverGrant.executionAuthorized, false);
assert.equal(legacyOverGrant.executionPerformed, false);

const newResolverOverGrant = service.compare({
  legacySnapshot: snapshot("legacy", {
    authorityAllowed: false,
    identitySets: {
      resourceRefs: ["repository-a"],
      capabilityKeys: ["repository.read"],
      connectionRefs: [],
      actionKeys: ["repository.read"],
    },
    reasonCodes: ["CONNECTION_REQUIRED"],
    readinessDimensions: {
      capability: "ready",
      certification: "ready",
      connection: "blocked",
      resource: "ready",
    },
  }),
  effectiveSnapshot: snapshot("effective"),
  now: NOW,
});
assert.equal(newResolverOverGrant.securityRelevant, true);
assert.ok(newResolverOverGrant.mismatchClasses.includes("legacy_under_grant"));
assert.ok(newResolverOverGrant.mismatchClasses.includes("new_resolver_over_grant"));
assert.deepEqual(newResolverOverGrant.identityDifferences.resourceRefs.effectiveOnly, ["repository-b"]);
assert.deepEqual(newResolverOverGrant.identityDifferences.connectionRefs.effectiveOnly, ["connection-a"]);
assert.equal(newResolverOverGrant.rolloutApproved, false);
assert.equal(newResolverOverGrant.providerCallMade, false);

console.log("context kernel shadow authority parity tests passed");
