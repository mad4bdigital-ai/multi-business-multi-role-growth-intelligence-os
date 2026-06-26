import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  createActivationGateway,
  policyHash,
  stableJson,
  verifyDeploymentAttestation,
} from "../edge/activation-gateway/src/gateway.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../edge/activation-gateway/generated/route-policy.json"), "utf8"));

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function signedEnvironment({ expiresAt = "2030-01-01T00:00:00.000Z", deploymentId = "deployment-test-001", sourceCommit = "a".repeat(40), surfaceRegistryVersion = policy.surface_registry_version } = {}) {
  const pair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicJwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  const payload = {
    content_hash_sha256: policy.content_hash_sha256,
    deployment_id: deploymentId,
    expires_at: expiresAt,
    source_commit: sourceCommit,
    surface_registry_version: Number(surfaceRegistryVersion),
  };
  const signature = await webcrypto.subtle.sign(
    { name: "Ed25519" },
    pair.privateKey,
    new TextEncoder().encode(stableJson(payload)),
  );
  return {
    ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON: JSON.stringify({
      ...payload,
      signature_b64url: base64Url(signature),
    }),
    ACTIVATION_GATEWAY_POLICY_PUBLIC_KEY_JWK: JSON.stringify(publicJwk),
    ACTIVATION_GATEWAY_ENFORCE_HOST: "true",
  };
}

const calculatedHash = await policyHash(policy, webcrypto);
assert.equal(calculatedHash, policy.content_hash_sha256, "generated policy content hash must verify");
assert.equal(policy.upstream_origin, "https://auth.mad4b.com");
assert.equal(policy.public_host, "activation.mad4b.com");
assert.equal(policy.routes.some((route) => route.path === "/tenant/activation/session-context"), true);
assert.equal(policy.routes.some((route) => route.path === "/activation/session-context"), true);

const validEnv = await signedEnvironment();
const verification = await verifyDeploymentAttestation(policy, validEnv, {
  cryptoImpl: webcrypto,
  now: () => Date.parse("2029-01-01T00:00:00.000Z"),
});
assert.equal(verification.ok, true);
assert.equal(verification.stale, false);
assert.equal(verification.sourceCommit, "a".repeat(40));
assert.equal(verification.surfaceRegistryVersion, policy.surface_registry_version);

{
  const attestation = JSON.parse(validEnv.ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON);
  const first = attestation.signature_b64url[0];
  attestation.signature_b64url = `${first === "A" ? "B" : "A"}${attestation.signature_b64url.slice(1)}`;
  const invalidSignatureEnv = {
    ...validEnv,
    ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON: JSON.stringify(attestation),
  };
  const result = await verifyDeploymentAttestation(policy, invalidSignatureEnv, {
    cryptoImpl: webcrypto,
    now: () => Date.parse("2029-01-01T00:00:00.000Z"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "GATEWAY_POLICY_SIGNATURE_INVALID");
}

{
  const mismatchEnv = await signedEnvironment({ surfaceRegistryVersion: policy.surface_registry_version + 1 });
  const result = await verifyDeploymentAttestation(policy, mismatchEnv, {
    cryptoImpl: webcrypto,
    now: () => Date.parse("2029-01-01T00:00:00.000Z"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "GATEWAY_POLICY_REGISTRY_VERSION_MISMATCH");
}

{
  const tamperedPolicy = structuredClone(policy);
  tamperedPolicy.routes[0].allowed_query_parameters = ["tampered_field"];
  const response = await createActivationGateway({
    policy: tamperedPolicy,
    cryptoImpl: webcrypto,
    now: () => Date.parse("2029-01-01T00:00:00.000Z"),
    logger: { info() {} },
  })(new Request("https://activation.mad4b.com/health"), validEnv, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "GATEWAY_POLICY_HASH_MISMATCH");
}

{
  const response = await createActivationGateway({
    policy,
    cryptoImpl: webcrypto,
    now: () => Date.parse("2029-01-01T00:00:00.000Z"),
    logger: { info() {} },
  })(new Request("https://activation.mad4b.com/health"), {}, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "GATEWAY_POLICY_ATTESTATION_MISSING");
}

{
  const handler = createActivationGateway({
    policy,
    cryptoImpl: webcrypto,
    now: () => Date.parse("2029-01-01T00:00:00.000Z"),
    logger: { info() {} },
  });
  await handler(new Request("https://activation.mad4b.com/health"), {}, {});
  const second = await handler(new Request("https://activation.mad4b.com/health"), {}, {});
  assert.equal(second.status, 503);
  assert.equal((await second.json()).error.code, "GATEWAY_POLICY_ATTESTATION_MISSING", "repeated invalid attestation must preserve the stable error code");
}

{
  const response = await createActivationGateway({
    policy,
    cryptoImpl: webcrypto,
    now: () => Date.parse("2029-01-01T00:00:00.000Z"),
    logger: { info() {} },
  })(new Request("https://wrong.mad4b.com/health"), validEnv, {});
  assert.equal(response.status, 421);
  assert.equal((await response.json()).error.code, "GATEWAY_HOST_MISMATCH");
}

{
  const response = await createActivationGateway({
    policy,
    cryptoImpl: webcrypto,
    now: () => Date.parse("2029-01-01T00:00:00.000Z"),
    logger: { info() {} },
  })(new Request("https://activation.mad4b.com/tenant/activation/session-context?tenant_id=forbidden"), validEnv, {});
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "GATEWAY_QUERY_PARAMETER_NOT_ALLOWED");
}

{
  const response = await createActivationGateway({
    policy,
    cryptoImpl: webcrypto,
    now: () => Date.parse("2029-01-01T00:00:00.000Z"),
    logger: { info() {} },
  })(new Request("https://activation.mad4b.com/activation%2Fruns"), validEnv, {});
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "GATEWAY_PATH_INVALID");
}

{
  let upstreamRequest = null;
  const fetchImpl = async (input, init = {}) => {
    upstreamRequest = {
      url: String(input),
      headers: new Headers(init.headers || {}),
      method: init.method,
    };
    return new Response(JSON.stringify({ ok: true, secrets_included: false }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": "never-forward=true",
        "x-internal-debug": "hidden",
      },
    });
  };
  const handler = createActivationGateway({
    policy,
    fetchImpl,
    cryptoImpl: webcrypto,
    now: () => Date.parse("2029-01-01T00:00:00.000Z"),
    logger: { info() {} },
  });
  const response = await handler(new Request(
    "https://activation.mad4b.com/tenant/activation/session-context?limit=5&response_profile=summary",
    {
      headers: {
        authorization: "Bearer tenant-token",
        cookie: "session=must-not-forward",
        "x-unapproved": "must-not-forward",
        "x-request-id": "request-test-001",
      },
    },
  ), validEnv, {});
  assert.equal(response.status, 200);
  assert.equal(upstreamRequest.url, "https://auth.mad4b.com/tenant/activation/session-context?limit=5&response_profile=summary");
  assert.equal(upstreamRequest.headers.get("authorization"), "Bearer tenant-token");
  assert.equal(upstreamRequest.headers.get("cookie"), null);
  assert.equal(upstreamRequest.headers.get("x-unapproved"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-internal-debug"), null);
  assert.equal(response.headers.get("x-request-id"), "request-test-001");
}

{
  let forwarded = false;
  const handler = createActivationGateway({
    policy,
    fetchImpl: async (input) => {
      forwarded = true;
      assert.equal(String(input), "https://auth.mad4b.com/activation/runs/run_123/ack");
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    },
    cryptoImpl: webcrypto,
    now: () => Date.parse("2029-01-01T00:00:00.000Z"),
    logger: { info() {} },
  });
  const response = await handler(new Request("https://activation.mad4b.com/activation/runs/run_123/ack", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer admin-token" },
    body: JSON.stringify({ consumer_state: "acknowledged" }),
  }), validEnv, {});
  assert.equal(response.status, 200);
  assert.equal(forwarded, true, "templated path must forward");
}

{
  const handler = createActivationGateway({
    policy,
    fetchImpl: async () => new Response(null, { status: 204 }),
    cryptoImpl: webcrypto,
    now: () => Date.parse("2029-01-01T00:00:00.000Z"),
    logger: { info() {} },
  });
  const response = await handler(new Request("https://activation.mad4b.com/activation/runs/run_123/ack", { method: "GET" }), validEnv, {});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
}

{
  const expiredEnv = await signedEnvironment({ expiresAt: "2028-01-01T00:00:00.000Z" });
  const response = await createActivationGateway({
    policy,
    cryptoImpl: webcrypto,
    now: () => Date.parse("2029-01-01T00:00:00.000Z"),
    logger: { info() {} },
  })(new Request("https://activation.mad4b.com/health"), expiredEnv, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).stale, true);
}

{
  const expiredEnv = await signedEnvironment({ expiresAt: "2028-01-01T00:00:00.000Z" });
  let forwarded = false;
  const response = await createActivationGateway({
    policy,
    fetchImpl: async () => {
      forwarded = true;
      return new Response(null, { status: 204 });
    },
    cryptoImpl: webcrypto,
    now: () => Date.parse("2029-01-01T00:00:00.000Z"),
    logger: { info() {} },
  })(new Request("https://activation.mad4b.com/activation/hard-run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }), expiredEnv, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "GATEWAY_POLICY_STALE");
  assert.equal(forwarded, false, "expired policy must not reach upstream");
}

{
  const handler = createActivationGateway({
    policy,
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://example.com" } }),
    cryptoImpl: webcrypto,
    now: () => Date.parse("2029-01-01T00:00:00.000Z"),
    logger: { info() {} },
  });
  const response = await handler(new Request("https://activation.mad4b.com/activation/hard-run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }), validEnv, {});
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, "GATEWAY_UPSTREAM_REDIRECT_BLOCKED");
}

console.log("Activation Gateway contract and security tests passed.");
