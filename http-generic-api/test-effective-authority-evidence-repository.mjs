import assert from "node:assert/strict";
import {
  _testingEffectiveAuthorityEvidenceRepository,
  createEffectiveAuthorityEvidenceRepository,
} from "./src/infrastructure/effectiveAuthority/effectiveAuthorityEvidenceRepository.js";

const manifest = {
  decisionId: "decision-1",
  decision: "shadow_ready",
  enforcementMode: "shadow_only",
  authorityGranted: false,
  principal: { principalType: "platform_admin", principalId: "admin-1" },
  subjectScope: {
    scopeId: "scope-platform",
    scopeKey: "platform:root",
    scopeType: "platform",
    tenantId: null,
  },
  capability: { key: "connector.inventory.read" },
  resource: { type: "connector_collection", key: "connectors:platform" },
  readiness: { identity: "ready" },
  projectionEligibility: { connectorInventory: true, execution: false },
  gaps: [],
  versions: { authorityScope: "1" },
  evaluatedAt: "2026-07-21T00:00:00.000Z",
  expiresAt: "2026-07-21T00:05:00.000Z",
  providerCalls: false,
  credentialPayloadReads: false,
  externalWrites: false,
  secretsIncluded: false,
};

const normalized = _testingEffectiveAuthorityEvidenceRepository.normalizeDecisionEvidence({
  manifest,
  persistenceMode: "required",
  evidenceSource: "test",
});
assert.equal(normalized.authorityGranted, 0);
assert.equal(normalized.providerCallMade, 0);
assert.equal(normalized.credentialPayloadRead, 0);
assert.equal(normalized.externalWriteMade, 0);
assert.equal(normalized.secretsIncluded, 0);
assert.equal(normalized.manifestSha256.length, 64);

const executions = [];
const pool = {
  async execute(sql, params) {
    executions.push({ sql, params });
    if (sql.includes("SELECT manifest_sha256")) {
      return [[{ manifest_sha256: normalized.manifestSha256 }]];
    }
    return [{ affectedRows: 1 }];
  },
};
const repository = createEffectiveAuthorityEvidenceRepository({
  resolvePool: async () => pool,
});
const decision = await repository.insertDecision({
  manifest,
  persistenceMode: "required",
  evidenceSource: "test",
});
assert.equal(decision.readbackVerified, true);
assert.equal(executions.length, 2);
assert.match(executions[0].sql, /^INSERT INTO effective_authority_shadow_decisions/);
assert.equal(executions[0].sql.includes("admin-1"), false);
assert.deepEqual(executions[0].params.slice(12, 15), ["shadow_only", 0, normalized.manifestSha256]);
assert.deepEqual(executions[0].params.slice(20, 24), [0, 0, 0, 0]);

const consistency = {
  projectionKey: "connector_inventory",
  status: "mismatch",
  driftDetected: true,
  issueCodes: ["AUTHORITY_AUTHORIZED_NOT_PROJECTED"],
  counts: {
    registeredCount: 10,
    authorizedCount: 2,
    projectedCount: 0,
    executableCandidateCount: 0,
  },
  enforcementMode: "shadow_only",
  authorityGranted: false,
  secretsIncluded: false,
};
const drift = await repository.insertDriftEvent({
  decisionId: manifest.decisionId,
  tenantId: null,
  projectionConsistency: consistency,
  issueCode: consistency.issueCodes[0],
  detectedAt: new Date("2026-07-21T00:00:01.000Z"),
  driftEventId: "drift-1",
});
assert.equal(drift.driftEventId, "drift-1");
assert.match(executions[2].sql, /^INSERT INTO authority_projection_drift_events/);
assert.deepEqual(executions[2].params.slice(11, 17), ["shadow_only", 0, 0, 0, 0, 0]);

assert.throws(
  () =>
    _testingEffectiveAuthorityEvidenceRepository.normalizeDecisionEvidence({
      manifest: { ...manifest, credential_ref: "hidden" },
      persistenceMode: "required",
    }),
  (error) => error.code === "AUTHORITY_SECRET_EVIDENCE_FORBIDDEN"
);

console.log("effective authority evidence repository tests passed");
