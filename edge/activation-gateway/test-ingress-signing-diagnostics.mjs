import assert from "node:assert/strict";
import { randomUUID, webcrypto } from "node:crypto";

import {
  createActivationGateway,
  signedRecoveryIngressHeaders,
} from "./src/gateway.mjs";

const SOURCE_SHA = "a".repeat(40);
const BUNDLE_SHA = "b".repeat(64);
const cryptoImpl = { subtle: webcrypto.subtle, randomUUID };
const policy = {
  policy_key: "activation_gateway_staging",
  public_host: "activation-dev.mad4b.com",
  upstream_origin: "https://origin.example.test",
  content_hash_sha256: "c".repeat(64),
  oauth_handoff_routes: [],
  routes: [{
    method: "POST",
    path: "/admin/recovery/staging/test",
    operation_ids: ["stagingRecoveryTest"],
    allowed_query_parameters: [],
    request_body_limit_bytes: 4096,
    response_body_limit_bytes: 4096,
    timeout_ms: 1000,
    mutation: true,
  }],
};
const verification = {
  ok: true,
  stale: false,
  sourceCommit: SOURCE_SHA,
  expiresAtMs: Date.now() + 60_000,
};
const workerBuildIdentity = {
  source_sha: SOURCE_SHA,
  bundle_sha256: BUNDLE_SHA,
};
const request = new Request(
  "https://activation-dev.mad4b.com/admin/recovery/staging/test",
  { method: "POST", headers: { "x-request-id": "gateway-test-request" } },
);

await assert.rejects(
  () => signedRecoveryIngressHeaders(
    request,
    policy,
    "gateway-test-request",
    verification,
    {},
    workerBuildIdentity,
    cryptoImpl,
  ),
  (error) => error?.code === "GATEWAY_INGRESS_AUTHORITY_MISSING",
);

await assert.rejects(
  () => signedRecoveryIngressHeaders(
    request,
    policy,
    "gateway-test-request",
    verification,
    {
      ACTIVATION_GATEWAY_INGRESS_PRIVATE_KEY_JWK: "not-json",
      ACTIVATION_GATEWAY_INGRESS_KEY_ID: "staging-key",
    },
    workerBuildIdentity,
    cryptoImpl,
  ),
  (error) => error?.code === "GATEWAY_INGRESS_KEY_INVALID",
);

const missingAuthorityGateway = createActivationGateway({
  policy,
  verifyAttestation: async () => verification,
  fetchImpl: async () => { throw new Error("upstream must not be called"); },
  cryptoImpl,
  workerBuildIdentity,
  logger: { info() {} },
});
const missingAuthorityResponse = await missingAuthorityGateway(request, {});
assert.equal(missingAuthorityResponse.status, 503);
assert.equal((await missingAuthorityResponse.json()).error.code, "GATEWAY_INGRESS_AUTHORITY_MISSING");

const invalidKeyGateway = createActivationGateway({
  policy,
  verifyAttestation: async () => verification,
  fetchImpl: async () => { throw new Error("upstream must not be called"); },
  cryptoImpl,
  workerBuildIdentity,
  logger: { info() {} },
});
const invalidKeyResponse = await invalidKeyGateway(request, {
  ACTIVATION_GATEWAY_INGRESS_PRIVATE_KEY_JWK: "not-json",
  ACTIVATION_GATEWAY_INGRESS_KEY_ID: "staging-key",
});
assert.equal(invalidKeyResponse.status, 503);
assert.equal((await invalidKeyResponse.json()).error.code, "GATEWAY_INGRESS_KEY_INVALID");

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging.gateway-ingress-signing-diagnostics.v1",
  authority_missing_status: 503,
  invalid_key_status: 503,
  secrets_included: false,
}));
