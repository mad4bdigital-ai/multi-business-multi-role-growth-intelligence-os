import assert from "node:assert/strict";
import {
  evaluateConnectorProjectionConsistency,
  normalizeEffectiveAuthorityEvidenceMode,
} from "./src/domain/effectiveAuthority/effectiveAuthorityEvidence.js";

assert.equal(normalizeEffectiveAuthorityEvidenceMode(undefined), "disabled");
assert.equal(normalizeEffectiveAuthorityEvidenceMode("BEST_EFFORT"), "best_effort");
assert.throws(() => normalizeEffectiveAuthorityEvidenceMode("live"), /must be one of/);

const consistent = evaluateConnectorProjectionConsistency({
  scopeType: "platform",
  registeredCount: 10,
  authorizedCount: 10,
  projectedCount: 10,
  executableCandidateCount: 4,
  observedCount: 10,
});
assert.equal(consistent.driftDetected, false);
assert.equal(consistent.status, "match");
assert.equal(consistent.observationStatus, "observed");
assert.equal(consistent.counts.observedCount, 10);
assert.deepEqual(consistent.issueCodes, []);
assert.equal(consistent.secretsIncluded, false);

const drift = evaluateConnectorProjectionConsistency({
  scopeType: "platform",
  registeredCount: 10,
  authorizedCount: 0,
  projectedCount: 0,
  executableCandidateCount: 1,
  observedCount: 0,
});
assert.equal(drift.driftDetected, true);
assert.ok(drift.issueCodes.includes("AUTHORITY_EXECUTABLE_EXCEEDS_PROJECTED"));
assert.ok(drift.issueCodes.includes("AUTHORITY_PROJECTION_DRIFT_CONNECTED_SYSTEMS"));

const observedMismatch = evaluateConnectorProjectionConsistency({
  scopeType: "tenant",
  registeredCount: 5,
  authorizedCount: 3,
  projectedCount: 2,
  executableCandidateCount: 1,
  observedCount: 1,
});
assert.deepEqual(observedMismatch.issueCodes, ["AUTHORITY_OBSERVED_PROJECTION_MISMATCH"]);

const projectedNotObserved = evaluateConnectorProjectionConsistency({
  scopeType: "tenant",
  registeredCount: 5,
  authorizedCount: 3,
  projectedCount: 2,
  executableCandidateCount: 1,
  observedCount: 0,
});
assert.ok(
  projectedNotObserved.issueCodes.includes("AUTHORITY_OBSERVED_PROJECTION_MISMATCH")
);
assert.ok(projectedNotObserved.issueCodes.includes("AUTHORITY_PROJECTED_NOT_OBSERVED"));

const observedExceedsProjected = evaluateConnectorProjectionConsistency({
  scopeType: "tenant",
  registeredCount: 5,
  authorizedCount: 3,
  projectedCount: 2,
  executableCandidateCount: 1,
  observedCount: 3,
});
assert.ok(
  observedExceedsProjected.issueCodes.includes("AUTHORITY_OBSERVED_EXCEEDS_PROJECTED")
);

const tenantSubset = evaluateConnectorProjectionConsistency({
  scopeType: "tenant",
  registeredCount: 10,
  authorizedCount: 2,
  projectedCount: 2,
  executableCandidateCount: 1,
});
assert.equal(tenantSubset.driftDetected, false);
assert.equal(tenantSubset.observationStatus, undefined);
assert.equal("observedCount" in tenantSubset.counts, false);

console.log("effective authority evidence domain tests passed");
