import assert from "node:assert/strict";
import { createActivationEffectiveAuthorityProjectionService } from "./src/application/effectiveAuthority/activationEffectiveAuthorityProjectionService.js";

const platformService = createActivationEffectiveAuthorityProjectionService({
  repository: {
    async summarizeConnectorProjectionStages({ scope }) {
      assert.equal(scope.scopeType, "platform");
      assert.equal(scope.tenantId, null);
      return {
        registeredCount: 8,
        authorizedCount: 8,
        projectedCount: 8,
        executableCandidateCount: 3,
      };
    },
  },
  now: () => new Date("2026-07-24T00:00:00.000Z"),
});

const platformProjection = await platformService.project({
  scope: {
    scopeId: "scope-platform",
    scopeKey: "platform:root",
    scopeType: "platform",
    tenantId: null,
    version: 7,
  },
});
assert.equal(platformProjection.status, "active");
assert.equal(platformProjection.decision, "shadow_ready");
assert.equal(platformProjection.authority_granted, false);
assert.equal(platformProjection.enforcement_mode, "shadow_only");
assert.equal(platformProjection.legacy_runtime_authoritative, true);
assert.equal(platformProjection.execution_authority_changed, false);
assert.equal(platformProjection.registered_count, 8);
assert.equal(platformProjection.executable_candidate_count, 3);
assert.equal(platformProjection.drift_detected, false);
assert.deepEqual(platformProjection.drift_issue_codes, []);
assert.equal(platformProjection.projection_eligibility.execution, false);
assert.equal(platformProjection.provider_calls, false);
assert.equal(platformProjection.credential_payload_reads, false);
assert.equal(platformProjection.external_writes, false);
assert.equal(platformProjection.secrets_included, false);

const tenantProjection = await createActivationEffectiveAuthorityProjectionService({
  repository: {
    async summarizeConnectorProjectionStages({ scope }) {
      assert.equal(scope.tenantId, "tenant-1");
      return {
        registeredCount: 8,
        authorizedCount: 2,
        projectedCount: 0,
        executableCandidateCount: 0,
      };
    },
  },
  now: () => "2026-07-24T00:01:00.000Z",
}).project({
  scope: {
    scopeId: "scope-tenant-1",
    scopeType: "tenant",
    tenantId: "tenant-1",
    version: 2,
  },
});
assert.equal(tenantProjection.status, "degraded");
assert.equal(tenantProjection.drift_detected, true);
assert.ok(
  tenantProjection.drift_issue_codes.includes("AUTHORITY_AUTHORIZED_NOT_PROJECTED")
);
assert.equal(tenantProjection.authority_granted, false);

const logs = [];
const unavailableProjection = await createActivationEffectiveAuthorityProjectionService({
  repository: {
    async summarizeConnectorProjectionStages() {
      const error = new Error("table unavailable");
      error.code = "ER_NO_SUCH_TABLE";
      throw error;
    },
  },
  logger: { warn: (entry) => logs.push(entry) },
  now: () => new Date("2026-07-24T00:02:00.000Z"),
}).project({
  scope: { scopeType: "platform" },
});
assert.equal(unavailableProjection.status, "degraded");
assert.equal(unavailableProjection.availability, "unavailable");
assert.equal(unavailableProjection.error_code, "ER_NO_SUCH_TABLE");
assert.equal(unavailableProjection.authority_granted, false);
assert.equal(unavailableProjection.registered_count, null);
assert.equal(unavailableProjection.projection_eligibility.execution, false);
assert.equal(logs[0].secretsIncluded, false);

assert.throws(
  () => createActivationEffectiveAuthorityProjectionService(),
  /summarizeConnectorProjectionStages/
);
await assert.rejects(
  () =>
    platformService.project({
      scope: { scopeType: "tenant", tenantId: null },
    }),
  /scope\.tenantId/
);

console.log("Activation effective-authority projection tests passed");
