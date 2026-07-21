import assert from "node:assert/strict";
import { createEffectiveAuthorityEvidenceService } from "./src/application/effectiveAuthority/effectiveAuthorityEvidenceService.js";

const manifest = {
  decisionId: "decision-1",
  subjectScope: { tenantId: null },
};
const consistency = {
  projectionKey: "connector_inventory",
  driftDetected: true,
  issueCodes: ["AUTHORITY_AUTHORIZED_NOT_PROJECTED"],
};

const disabled = createEffectiveAuthorityEvidenceService();
assert.equal(disabled.enabled, false);
assert.deepEqual(await disabled.record({ manifest, projectionConsistency: consistency }), {
  status: "disabled",
  mode: "disabled",
  driftEventCount: 0,
});

const calls = [];
const repository = {
  async insertDecision(input) {
    calls.push({ method: "decision", input });
    return {
      decisionId: input.manifest.decisionId,
      manifestSha256: "a".repeat(64),
      readbackVerified: true,
    };
  },
  async insertDriftEvent(input) {
    calls.push({ method: "drift", input });
    return { driftEventId: `drift-${calls.length}`, issueCode: input.issueCode };
  },
};
const required = createEffectiveAuthorityEvidenceService({
  repository,
  mode: "required",
  now: () => new Date("2026-07-21T00:00:01.000Z"),
});
const persisted = await required.record({
  manifest,
  projectionConsistency: consistency,
  source: "test",
});
assert.equal(persisted.status, "persisted");
assert.equal(persisted.driftEventCount, 1);
assert.equal(calls.length, 2);
assert.equal(calls[1].input.issueCode, "AUTHORITY_AUTHORIZED_NOT_PROJECTED");

const degradedLogs = [];
const bestEffort = createEffectiveAuthorityEvidenceService({
  repository: {
    async insertDecision() {
      const error = new Error("table unavailable");
      error.code = "ER_NO_SUCH_TABLE";
      throw error;
    },
    async insertDriftEvent() {},
  },
  mode: "best_effort",
  logger: { warn: (entry) => degradedLogs.push(entry) },
});
const degraded = await bestEffort.record({ manifest });
assert.equal(degraded.status, "degraded");
assert.equal(degraded.code, "ER_NO_SUCH_TABLE");
assert.equal(degradedLogs[0].secretsIncluded, false);

const requiredFailure = createEffectiveAuthorityEvidenceService({
  repository: {
    async insertDecision() {
      throw new Error("db unavailable");
    },
    async insertDriftEvent() {},
  },
  mode: "required",
});
await assert.rejects(
  () => requiredFailure.record({ manifest }),
  (error) => error.code === "AUTHORITY_EVIDENCE_PERSISTENCE_REQUIRED" && error.status === 503
);

console.log("effective authority evidence service tests passed");
