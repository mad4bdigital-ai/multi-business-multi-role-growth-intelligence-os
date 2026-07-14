import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { LIVE_SMOKE_CONFIRMATION, runTenantGptOAuthLiveSmoke } from "./scripts/tenant-gpt-oauth-live-smoke.mjs";

const userId = "f242960c-2857-4b4d-a504-ee50f8a278b4";
const tenantId = "4bc39fca-270e-4daa-b373-db75e1f36ccd";
const callbackUrl = "https://chatgpt.com/aip/g-65442952db39d61b19ccc4826d57e363de1b4455/oauth/callback";
const jwtSecret = "live-smoke-test-secret";
const clientSecret = "live-smoke-client-secret";
const userToken = "live-smoke-user-token";
const code = jwt.sign({ user_id: userId, tenant_id: tenantId, purpose: "custom_gpt_oauth_code" }, jwtSecret, { expiresIn: 300, jwtid: "code-jti" });
const accessToken = jwt.sign({ iss: "https://auth.mad4b.com", aud: "mad4b-tenant-gpt", user_id: userId, tenant_id: tenantId }, jwtSecret, { expiresIn: 600, jwtid: "access-jti" });

function response(status, payload, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
    json: async () => payload,
    text: async () => typeof payload === "string" ? payload : JSON.stringify(payload),
  };
}

let tokenCalls = 0;
const fetchImpl = async (url, options = {}) => {
  const path = new URL(String(url)).pathname;
  if (path === "/auth/oauth/authorize") {
    return response(200, '<a href="https://auth.mad4b.com/connect"></a><a href="https://auth.mad4b.com/privacy-policy"></a><a href="https://auth.mad4b.com/terms-of-use"></a>');
  }
  if (path === "/auth/platform-jwt/issue") return response(200, { access_token: userToken });
  if (path === "/auth/oauth/code") {
    const body = JSON.parse(String(options.body || "{}"));
    return response(200, { code, redirect_to: `${callbackUrl}?code=x&state=${encodeURIComponent(body.state)}` });
  }
  if (path === "/auth/oauth/token") {
    const form = new URLSearchParams(String(options.body || ""));
    assert.equal(form.get("client_secret"), clientSecret);
    tokenCalls += 1;
    return tokenCalls === 1
      ? response(200, { access_token: accessToken, token_type: "bearer" }, { "cache-control": "no-store" })
      : response(400, { error: "invalid_grant" });
  }
  throw new Error(`Unexpected path ${path}`);
};

let cleanupParams = null;
const result = await runTenantGptOAuthLiveSmoke({
  user_id: userId,
  tenant_id: tenantId,
  callback_url: callbackUrl,
  confirm: LIVE_SMOKE_CONFIRMATION,
}, {
  fetchImpl,
  jwtSecret,
  env: { BACKEND_API_KEY: "backend-key", JWT_SECRET: jwtSecret },
  resolveClientConfig: async () => ({ ok: true, config: { client_id: "mad4b-tenant-gpt", client_secret: clientSecret } }),
  getPoolImpl: () => ({ query: async (_sql, params) => { cleanupParams = params; return [{ affectedRows: 1 }]; } }),
});

assert.equal(result.ok, true);
assert.equal(result.authorize.absolute_links_present, true);
assert.equal(result.token_exchange.token_type, "bearer");
assert.equal(result.token_exchange.user_id_matches, true);
assert.equal(result.token_exchange.tenant_id_matches, true);
assert.equal(result.replay_protection.error, "invalid_grant");
assert.equal(result.cleanup.passed, true);
assert.deepEqual(cleanupParams, ["access-jti", "code-jti"]);
const serialized = JSON.stringify(result);
for (const secret of [clientSecret, userToken, code, accessToken, "backend-key"]) assert.equal(serialized.includes(secret), false);
await assert.rejects(() => runTenantGptOAuthLiveSmoke({ user_id: userId, tenant_id: tenantId, confirm: "NO" }), (error) => error?.code === "live_smoke_confirmation_required");
console.log("PASS tenant-gpt-oauth-live-smoke");
