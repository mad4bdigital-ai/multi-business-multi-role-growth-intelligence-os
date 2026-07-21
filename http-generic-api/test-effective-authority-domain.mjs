import assert from "node:assert/strict";
import {
  EffectiveAuthorityError,
  assertNoSecretEvidence,
  buildConnectorReadinessItem,
  buildEffectiveAuthorityManifest,
  decodeAuthorityCursor,
  encodeAuthorityCursor,
  normalizeAuthorityLimit,
} from "./src/domain/effectiveAuthority/effectiveAuthority.js";

assert.equal(normalizeAuthorityLimit(undefined), 25);
assert.equal(normalizeAuthorityLimit("100"), 100);
assert.throws(() => normalizeAuthorityLimit("0"), (error) => error.code === "AUTHORITY_LIMIT_OUT_OF_RANGE");
assert.throws(() => normalizeAuthorityLimit("abc"), (error) => error.code === "AUTHORITY_LIMIT_INVALID");

const cursor = encodeAuthorityCursor("system-123");
assert.equal(decodeAuthorityCursor(cursor), "system-123");
assert.throws(() => decodeAuthorityCursor("%%%"), (error) => error.code === "AUTHORITY_CURSOR_INVALID");

const item = buildConnectorReadinessItem({
  system_id: "system-1",
  tenant_id: "tenant-1",
  system_key: "wordpress",
  status: "active",
  active_installation_count: 0,
});
assert.equal(item.installationStatus, "not_installed");
assert.equal(item.credentialStatus, "not_evaluated");
assert.equal(item.executionReadiness, "blocked");
assert.deepEqual(item.blockedReasonCodes, ["CONNECTION_INSTALLATION_REQUIRED"]);
assert.equal(item.secretsIncluded, false);

assert.doesNotThrow(() => assertNoSecretEvidence({ secretsIncluded: false }));
assert.doesNotThrow(() => assertNoSecretEvidence({ credentialStatus: "not_evaluated" }));
assert.doesNotThrow(() => assertNoSecretEvidence({ credentialPayloadReads: false }));
assert.throws(
  () => assertNoSecretEvidence({ credentialPayloadReads: true }),
  (error) => error.code === "AUTHORITY_SECRET_EVIDENCE_FORBIDDEN"
);
assert.throws(
  () => assertNoSecretEvidence({ credential_ref: "hidden" }),
  (error) => error instanceof EffectiveAuthorityError && error.code === "AUTHORITY_SECRET_EVIDENCE_FORBIDDEN"
);

const manifest = buildEffectiveAuthorityManifest({
  decisionId: "decision-1",
  resolution: {
    selectionMode: "platform_default",
    principal: { principalType: "platform_admin", principalId: "admin-1" },
    scope: {
      scopeId: "scope-platform",
      scopeKey: "platform:root",
      scopeType: "platform",
      tenantId: null,
      version: 1,
    },
  },
  capability: {
    key: "connector.inventory.read",
    schemaVersion: 1,
  },
  resourceKey: "connectors:platform",
  evaluatedAt: new Date("2026-07-21T00:00:00.000Z"),
});
assert.equal(manifest.credentialPayloadReads, false);
assert.equal(manifest.secretsIncluded, false);
assert.equal(manifest.projectionEligibility.execution, false);

console.log("effective authority domain tests passed");
