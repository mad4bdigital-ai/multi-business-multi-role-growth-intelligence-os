import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
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

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
const deploymentSha = "a".repeat(40);
const signedEnv = {
  NODE_ENV: "production",
  REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true",
  REMOTE_MCP_TRUSTED_INGRESS_MODE: "signature",
  REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS: "true",
  REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY: publicKeyPem,
  REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST: "mcp.example.test",
  REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE: "mad4b-production-origin",
  REMOTE_MCP_TRUSTED_INGRESS_ISSUER: "mad4b-edge",
  REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA: deploymentSha,
};
function signedRequest(overrides = {}, headerOverrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: "mad4b-edge",
    aud: "mad4b-production-origin",
    iat: now - 2,
    exp: now + 30,
    host: "mcp.example.test",
    deployment_sha: deploymentSha,
    request_id: "request-1",
    jti: "jti-1",
    key_id: "edge-key-1",
    ...overrides,
  };
  const payloadBytes = Buffer.from(JSON.stringify(claims), "utf8");
  const encodedClaims = payloadBytes.toString("base64url");
  const signature = sign(null, payloadBytes, privateKey).toString("base64url");
  return {
    headers: {
      "x-forwarded-host": "mcp.example.test",
      "x-mad4b-ingress-attestation": `${encodedClaims}.${signature}`,
      ...headerOverrides,
    },
  };
}
const signedReady = assertTrustedIngressReadyForProduction(signedEnv, signedRequest());
assert.equal(signedReady.ready, true);
assert.equal(signedReady.attestation_mode, "signature");
assert.equal(signedReady.signed_attestation.verified, true);
assert.equal(signedReady.signed_attestation.key_id, "edge-key-1");

const ingressDenied = (error) => error?.code === "TRUSTED_INGRESS_ATTESTATION_REQUIRED";
const forged = signedRequest({}, { "x-mad4b-ingress-attestation": `${Buffer.from("{}", "utf8").toString("base64url")}.forged` });
assert.throws(() => assertTrustedIngressReadyForProduction(signedEnv, forged), ingressDenied);
const wrongHost = signedRequest({ host: "other.example.test" });
assert.throws(() => assertTrustedIngressReadyForProduction(signedEnv, wrongHost), ingressDenied);
const expired = signedRequest({ iat: Math.floor(Date.now() / 1000) - 200, exp: Math.floor(Date.now() / 1000) - 100 });
assert.throws(() => assertTrustedIngressReadyForProduction(signedEnv, expired), ingressDenied);
console.log("Trusted ingress contract tests passed.");
