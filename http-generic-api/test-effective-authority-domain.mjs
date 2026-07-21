import assert from "node:assert/strict";
import {
  EffectiveAuthorityError,
  assertNoSecretEvidence,
  buildConnectorReadinessItem,
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
assert.equal(item.executionReadiness, "blocked");
assert.deepEqual(item.blockedReasonCodes, ["CONNECTION_INSTALLATION_REQUIRED"]);
assert.equal(item.secretsIncluded, false);

assert.doesNotThrow(() => assertNoSecretEvidence({ secretsIncluded: false }));
assert.throws(
  () => assertNoSecretEvidence({ credential_ref: "hidden" }),
  (error) => error instanceof EffectiveAuthorityError && error.code === "AUTHORITY_SECRET_EVIDENCE_FORBIDDEN"
);

console.log("effective authority domain tests passed");
