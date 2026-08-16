import assert from "node:assert/strict";
import { assertTrustedIngressReadyForProduction, buildTrustedIngressReadiness } from "./trustedIngressContract.js";

const pending = buildTrustedIngressReadiness({ NODE_ENV: "staging", REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true" });
assert.equal(pending.ready, false);
assert.equal(pending.failure_mode, "staging_attestation_pending");
assert.doesNotThrow(() => assertTrustedIngressReadyForProduction({ NODE_ENV: "staging" }));

const productionBlocked = buildTrustedIngressReadiness({ NODE_ENV: "production", REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true", REMOTE_MCP_TRUSTED_INGRESS_ATTESTED: "true" });
assert.equal(productionBlocked.ready, false);
assert.throws(() => assertTrustedIngressReadyForProduction({ NODE_ENV: "production", REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true", REMOTE_MCP_TRUSTED_INGRESS_ATTESTED: "true" }), /TRUSTED_INGRESS_ATTESTATION_REQUIRED|Trusted ingress attestation/iu);

const productionReadyEnv = {
  NODE_ENV: "production",
  REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true",
  REMOTE_MCP_TRUSTED_INGRESS_ATTESTED: "true",
  REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS: "true",
};
const productionReady = assertTrustedIngressReadyForProduction(productionReadyEnv);
assert.equal(productionReady.ready, true);
assert.equal(productionReady.failure_mode, "accepted");
console.log("Trusted ingress contract tests passed.");
