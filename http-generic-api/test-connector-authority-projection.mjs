import assert from "node:assert/strict";
import {
  buildConnectorAuthorityProjection,
  evaluateConnectedSystemProjectionDrift,
} from "./connectorAuthorityProjection.js";

const projection = buildConnectorAuthorityProjection({
  systems: [
    { system_id: "system-a", tenant_id: "tenant-a", system_key: "wp", provider_family: "wordpress", status: "active" },
    { system_id: "system-b", tenant_id: "tenant-b", system_key: "ads", provider_family: "google_ads", status: "pending" },
  ],
  installations: [{ installation_id: "install-a", system_id: "system-a", status: "active" }],
});

assert.equal(projection[0].installation_status, "installed");
assert.equal(projection[0].execution_readiness, "candidate");
assert.equal(projection[1].installation_status, "not_installed");
assert.equal(projection[1].execution_readiness, "blocked");
assert.deepEqual(projection[1].blocked_reason_codes, [
  "CONNECTOR_REGISTRY_NOT_ACTIVE",
  "CONNECTION_INSTALLATION_REQUIRED",
]);

assert.equal(
  evaluateConnectedSystemProjectionDrift({
    isAdmin: true,
    scopeMode: "platform_global",
    registeredCount: 27,
    visibleCount: 0,
  }).issue_code,
  "AUTHORITY_PROJECTION_DRIFT_CONNECTED_SYSTEMS",
);
assert.equal(
  evaluateConnectedSystemProjectionDrift({
    isAdmin: false,
    scopeMode: "signed_membership",
    registeredCount: 27,
    visibleCount: 0,
  }).drift_detected,
  false,
);

console.log("connector authority projection tests passed");
