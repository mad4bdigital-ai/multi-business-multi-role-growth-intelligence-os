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
});
assert.equal(consistent.driftDetected, false);
assert.equal(consistent.status, "match");
assert.deepEqual(consistent.issueCodes, []);
assert.equal(consistent.secretsIncluded, false);

const drift = evaluateConnectorProjectionConsistency({
  scopeType: "platform",
  registeredCount: 10,
  authorizedCount: 0,
  projectedCount: 0,
  executableCandidateCount: 1,
});
assert.equal(drift.driftDetected, true);
assert.ok(drift.issueCodes.includes("AUTHORITY_EXECUTABLE_EXCEEDS_PROJECTED"));
assert.ok(drift.issueCodes.includes("AUTHORITY_PROJECTION_DRIFT_CONNECTED_SYSTEMS"));

const tenantSubset = evaluateConnectorProjectionConsistency({
  scopeType: "tenant",
  registeredCount: 10,
  authorizedCount: 2,
  projectedCount: 2,
  executableCandidateCount: 1,
});
assert.equal(tenantSubset.driftDetected, false);

console.log("effective authority evidence domain tests passed");
