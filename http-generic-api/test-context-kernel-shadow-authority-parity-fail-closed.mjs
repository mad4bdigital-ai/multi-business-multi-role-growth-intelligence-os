import assert from "node:assert/strict";

import {
  evaluateShadowAuthorityParity,
  SHADOW_PARITY_LIMITS,
} from "./contextKernel/domain/shadowAuthorityParityDecision.js";
import {
  createShadowAuthorityParityService,
  _testingShadowAuthorityParityService,
} from "./contextKernel/application/shadowAuthorityParityService.js";

const NOW = new Date("2030-01-01T00:10:00.000Z");

function snapshot(source, overrides = {}) {
  return {
    source,
    resolverKey: `${source}_authority_v1`,
    evaluatedAt: "2030-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T01:00:00.000Z",
    authorityAllowed: false,
    executionEligible: false,
    identitySets: {
      resourceRefs: ["repository-a"],
      capabilityKeys: ["repository.read"],
      connectionRefs: [],
      actionKeys: ["repository.read"],
    },
    reasonCodes: ["AUTHORITY_BLOCKED"],
    readinessDimensions: {
      capability: "ready",
      resource: "blocked",
    },
    dataQualityIssues: [],
    unsupportedSemantics: [],
    ...overrides,
  };
}

function assertSafe(result) {
  assert.equal(result.rolloutApproved, false);
  assert.equal(result.authorityGranted, false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.executionPerformed, false);
  assert.equal(result.runtimeAuthorityChanged, false);
  assert.equal(result.automaticWritePerformed, false);
  assert.equal(result.providerCallMade, false);
  assert.equal(result.credentialPayloadRead, false);
  assert.equal(result.secretsIncluded, false);
}

const stale = evaluateShadowAuthorityParity({
  legacySnapshot: snapshot("legacy", { expiresAt: "2030-01-01T00:05:00.000Z" }),
  effectiveSnapshot: snapshot("effective"),
  now: NOW,
});
assert.equal(stale.status, "mismatched");
assert.ok(stale.mismatchClasses.includes("stale_projection"));
assert.ok(stale.reasonCodes.includes("SHADOW_PARITY_STALE_PROJECTION"));
assert.equal(stale.rolloutBlocked, true);
assertSafe(stale);

const future = evaluateShadowAuthorityParity({
  legacySnapshot: snapshot("legacy", { evaluatedAt: "2030-01-01T00:20:00.000Z" }),
  effectiveSnapshot: snapshot("effective"),
  now: NOW,
});
assert.ok(future.mismatchClasses.includes("stale_projection"));
assertSafe(future);

const unsupported = evaluateShadowAuthorityParity({
  legacySnapshot: snapshot("legacy", {
    unsupportedSemantics: ["implicit_owner_inheritance"],
  }),
  effectiveSnapshot: snapshot("effective"),
  now: NOW,
});
assert.ok(unsupported.mismatchClasses.includes("unsupported_legacy_semantics"));
assert.ok(unsupported.reasonCodes.includes("SHADOW_PARITY_UNSUPPORTED_LEGACY_SEMANTICS"));
assertSafe(unsupported);

const dataQuality = evaluateShadowAuthorityParity({
  legacySnapshot: snapshot("legacy", {
    dataQualityIssues: ["missing_revision"],
    identitySets: {
      resourceRefs: ["repository-a", "repository-a"],
      capabilityKeys: ["repository.read"],
      connectionRefs: [],
      actionKeys: ["repository.read"],
    },
  }),
  effectiveSnapshot: snapshot("effective"),
  now: NOW,
});
assert.ok(dataQuality.mismatchClasses.includes("data_quality_mismatch"));
assert.ok(dataQuality.legacyIssues.includes("legacy_resourceRefs_duplicate_ref"));
assertSafe(dataQuality);

const sideEffect = evaluateShadowAuthorityParity({
  legacySnapshot: snapshot("legacy", { providerCallMade: true }),
  effectiveSnapshot: snapshot("effective"),
  now: NOW,
});
assert.equal(sideEffect.securityRelevant, true);
assert.ok(sideEffect.reasonCodes.includes("SHADOW_SIDE_EFFECT_INVARIANT_VIOLATED"));
assert.ok(sideEffect.mismatchClasses.includes("data_quality_mismatch"));
assertSafe(sideEffect);

const malformed = evaluateShadowAuthorityParity({
  legacySnapshot: null,
  effectiveSnapshot: snapshot("effective"),
  now: NOW,
});
assert.equal(malformed.status, "blocked");
assert.equal(malformed.parityStatus, "blocked");
assert.equal(malformed.securityRelevant, true);
assert.ok(malformed.mismatchClasses.includes("data_quality_mismatch"));
assertSafe(malformed);

const wrongSource = evaluateShadowAuthorityParity({
  legacySnapshot: snapshot("effective"),
  effectiveSnapshot: snapshot("effective"),
  now: NOW,
});
assert.ok(wrongSource.mismatchClasses.includes("data_quality_mismatch"));
assert.ok(wrongSource.legacyIssues.includes("legacy_source_mismatch"));
assertSafe(wrongSource);

const tooManyResources = Array.from(
  { length: SHADOW_PARITY_LIMITS.maxIdentityRefsPerDimension + 1 },
  (_, index) => `repository-${index}`,
);
const bounded = evaluateShadowAuthorityParity({
  legacySnapshot: snapshot("legacy", {
    identitySets: {
      resourceRefs: tooManyResources,
      capabilityKeys: ["repository.read"],
      connectionRefs: [],
      actionKeys: ["repository.read"],
    },
  }),
  effectiveSnapshot: snapshot("effective"),
  now: NOW,
});
assert.ok(bounded.legacyIssues.includes("legacy_resourceRefs_limit_exceeded"));
assert.ok(bounded.mismatchClasses.includes("data_quality_mismatch"));
assertSafe(bounded);

const readinessMismatch = evaluateShadowAuthorityParity({
  legacySnapshot: snapshot("legacy", {
    readinessDimensions: { capability: "ready", resource: "blocked" },
  }),
  effectiveSnapshot: snapshot("effective", {
    readinessDimensions: { capability: "ready", resource: "ready" },
  }),
  now: NOW,
});
assert.ok(readinessMismatch.mismatchClasses.includes("data_quality_mismatch"));
assert.deepEqual(readinessMismatch.decisionDifferences.readinessDimensions, [
  { dimension: "resource", legacyState: "blocked", effectiveState: "ready" },
]);
assertSafe(readinessMismatch);

const service = createShadowAuthorityParityService();
assert.throws(
  () => service.compare({ legacySnapshot: null, effectiveSnapshot: snapshot("effective") }),
  /legacySnapshot must be an object/,
);
assert.throws(
  () => service.compare({ legacySnapshot: snapshot("legacy"), effectiveSnapshot: null }),
  /effectiveSnapshot must be an object/,
);
assert.throws(
  () => _testingShadowAuthorityParityService.assertShadowOnlyResult({
    shadowMode: true,
    parityOnly: true,
    rolloutApproved: false,
    authorityGranted: false,
    executionAuthorized: false,
    executionPerformed: true,
    runtimeAuthorityChanged: false,
    automaticWritePerformed: false,
    providerCallMade: false,
    credentialPayloadRead: false,
    secretsIncluded: false,
  }),
  (error) => error?.code === "shadow_authority_parity_security_invariant_failed",
);

console.log("context kernel shadow authority parity fail-closed tests passed");
