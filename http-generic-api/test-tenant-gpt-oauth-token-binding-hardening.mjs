import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { TENANT_GPT_ACCESS_TOKEN_DEFAULT_TTL_SECONDS } from "./tenantGptAccessTokenProfile.js";
import { TENANT_GPT_OAUTH_CLIENT_ID } from "./tenantGptOAuthPreset.js";
import {
  BINDING_LIMITS,
  buildTenantGptOAuthTokenExchangeDeps,
  buildTenantGptOAuthTokenRequestBindingGuard,
  validateTenantGptOAuthAuthorizationCodeBindings,
} from "./tenantGptOAuthTokenExchangeBindingGuard.js";

const JWT_SECRET = "t031-binding-hardening-test-secret";
const RESOURCE = "https://activation.mad4b.com";
const CALLBACK = "https://chatgpt.com/aip/g-binding-hardening/oauth/callback";
const PAYLOAD = Object.freeze({
  purpose: "custom_gpt_oauth_code",
  jti: "code-jti-1",
  user_id: "user-1",
  tenant_id: "tenant-1",
  redirect_uri: CALLBACK,
  client_id: TENANT_GPT_OAUTH_CLIENT_ID,
  resource: RESOURCE,
});

for (const [claim, max] of Object.entries({
  jti: BINDING_LIMITS.jti,
  user_id: BINDING_LIMITS.user_id,
  tenant_id: BINDING_LIMITS.tenant_id,
  redirect_uri: BINDING_LIMITS.redirect_uri,
  client_id: BINDING_LIMITS.client_id,
  resource: BINDING_LIMITS.resource,
})) {
  assert.throws(
    () => validateTenantGptOAuthAuthorizationCodeBindings({
      ...PAYLOAD,
      [claim]: "x".repeat(max + 1),
    }),
    (error) => error?.name === "JsonWebTokenError"
      && error?.code === `oauth_code_${claim}_too_long`,
    `${claim} must be bounded before any diagnostic or store work`,
  );
}

const deps = buildTenantGptOAuthTokenExchangeDeps({}, { JWT_SECRET });
assert.equal(deps.accessTokenTtlSeconds, TENANT_GPT_ACCESS_TOKEN_DEFAULT_TTL_SECONDS);
const issued = deps.issueAccessToken(
  { user_id: PAYLOAD.user_id, tenant_id: PAYLOAD.tenant_id },
  {
    clientId: PAYLOAD.client_id,
    jwtid: "access-jti-1",
    resource: PAYLOAD.resource,
    expiresIn: 7 * 24 * 60 * 60,
  },
);
const verified = jwt.verify(issued, JWT_SECRET);
assert.equal(verified.iss, "https://auth.mad4b.com");
assert.equal(verified.aud, RESOURCE);
assert.equal(verified.azp, TENANT_GPT_OAUTH_CLIENT_ID);
assert.equal(verified.sub, "tenant:tenant-1:user:user-1");
assert.equal(verified.jti, "access-jti-1");
assert.equal(verified.purpose, "tenant_gpt_access");
assert.equal(verified.exp - verified.iat, 3600,
  "caller-provided seven-day TTL must be replaced by the governed one-hour profile");

const boundedDeps = buildTenantGptOAuthTokenExchangeDeps({}, {
  JWT_SECRET,
  TENANT_GPT_ACCESS_TOKEN_TTL_SECONDS: "300",
});
assert.equal(boundedDeps.accessTokenTtlSeconds, 300);
const boundedIssued = boundedDeps.issueAccessToken(
  { user_id: PAYLOAD.user_id, tenant_id: PAYLOAD.tenant_id },
  {
    clientId: PAYLOAD.client_id,
    jwtid: "access-jti-300",
    resource: PAYLOAD.resource,
    expiresIn: 3600,
  },
);
const boundedVerified = jwt.verify(boundedIssued, JWT_SECRET);
assert.equal(boundedVerified.exp - boundedVerified.iat, 300);

assert.throws(
  () => buildTenantGptOAuthTokenExchangeDeps({}, {
    JWT_SECRET,
    TENANT_GPT_ACCESS_TOKEN_TTL_SECONDS: "3601",
  }),
  (error) => error?.code === "tenant_gpt_access_token_ttl_invalid",
  "invalid configured TTL must fail before route construction or token issuance",
);

const unavailable = buildTenantGptOAuthTokenExchangeDeps({}, {});
assert.throws(
  () => unavailable.issueAccessToken(
    { user_id: PAYLOAD.user_id, tenant_id: PAYLOAD.tenant_id },
    {
      clientId: PAYLOAD.client_id,
      jwtid: "access-jti-2",
      resource: PAYLOAD.resource,
      expiresIn: 300,
    },
  ),
  (error) => error?.code === "oauth_jwt_secret_unavailable",
  "access-token signing must not use a fallback secret",
);

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function postForm(baseUrl, body) {
  const response = await fetch(`${baseUrl}/auth/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: "must-be-removed=1",
    },
    body: new URLSearchParams(body).toString(),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
}

let downstreamCalls = 0;
const app = express();
app.use(buildTenantGptOAuthTokenRequestBindingGuard({
  randomUUID: () => "00000000-0000-4000-8000-000000000001",
}));
app.post("/auth/oauth/token", (_req, res) => {
  downstreamCalls += 1;
  return res.status(599).json({ error: "downstream_reached" });
});
const { server, baseUrl } = await startServer(app);
try {
  const invalidRedirect = await postForm(baseUrl, {
    grant_type: "authorization_code",
    code: "bounded-code",
    redirect_uri: "not-a-url",
  });
  assert.equal(invalidRedirect.status, 400);
  assert.equal(invalidRedirect.body.error_code, "oauth_redirect_uri_invalid");
  assert.equal(invalidRedirect.body.retry_same_code, true);
  assert.equal(invalidRedirect.headers.get("cache-control"), "no-store");

  const oversizedCode = await postForm(baseUrl, {
    grant_type: "authorization_code",
    code: "x".repeat(BINDING_LIMITS.code + 1),
    redirect_uri: CALLBACK,
  });
  assert.equal(oversizedCode.status, 400);
  assert.equal(oversizedCode.body.error_code, "oauth_code_too_long");
  assert.equal(oversizedCode.body.retry_same_code, false);
  assert.equal(oversizedCode.body.secrets_included, false);
  assert.equal(downstreamCalls, 0);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log("PASS tenant-gpt-oauth-token-binding-hardening");
