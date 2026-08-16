import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createActivationGateway, stableJson } from "../edge/activation-gateway/src/gateway.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../edge/activation-gateway/generated/route-policy.json"), "utf8"));
const cookie = "mad4b_tenant_gpt_sso=approved-token";
let jar = "";
const observed = [];

async function signedEnv() {
  const pair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicJwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  const attestation = {
    content_hash_sha256: policy.content_hash_sha256,
    deployment_id: "browser-canary-read-only",
    expires_at: "2030-01-01T00:00:00.000Z",
    source_commit: "a".repeat(40),
    surface_registry_version: Number(policy.surface_registry_version),
  };
  const signature = await webcrypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(stableJson(attestation)));
  return {
    ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON: JSON.stringify({ ...attestation, signature_b64url: Buffer.from(signature).toString("base64url") }),
    ACTIVATION_GATEWAY_POLICY_PUBLIC_KEY_JWK: JSON.stringify(publicJwk),
  };
}

const env = await signedEnv();
const handler = createActivationGateway({
  policy,
  cryptoImpl: webcrypto,
  now: () => Date.parse("2029-01-01T00:00:00.000Z"),
  logger: { info() {} },
  fetchImpl: async (input, init = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers || {});
    observed.push({ path: url.pathname, cookie: headers.get("cookie") });
    if (url.pathname === "/auth/oauth/authorize") {
      return new Response(JSON.stringify({ ok: true, step: "authorize" }), {
        status: 200,
        headers: { "content-type": "application/json", "set-cookie": `${cookie}; Domain=.mad4b.com; Path=/; HttpOnly; Secure; SameSite=Lax` },
      });
    }
    if (url.pathname === "/auth/oauth/code") {
      return new Response(JSON.stringify({ ok: true, step: "code" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ access_token: "read-only-canary-token" }), { status: 200, headers: { "content-type": "application/json" } });
  },
});

const authorize = await handler(new Request("https://activation.mad4b.com/auth/oauth/authorize?client_id=mad4b-tenant-gpt&response_type=code&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fcallback&state=canary"), env, {});
assert.equal(authorize.status, 200);
const setCookie = authorize.headers.get("set-cookie");
assert.match(setCookie || "", /^mad4b_tenant_gpt_sso=/u);
jar = setCookie.split(";")[0];

const code = await handler(new Request("https://activation.mad4b.com/auth/oauth/code", { method: "POST", headers: { cookie: jar, "content-type": "application/x-www-form-urlencoded" }, body: "state=canary" }), env, {});
assert.equal(code.status, 200);
assert.equal(observed[1].cookie, cookie);

const token = await handler(new Request("https://activation.mad4b.com/auth/oauth/token", { method: "POST", headers: { cookie: jar, "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=authorization_code" }), env, {});
assert.equal(token.status, 200);
assert.equal(observed[2].cookie, null);
console.log("Tenant GPT OAuth browser-like cross-host canary passed.");
