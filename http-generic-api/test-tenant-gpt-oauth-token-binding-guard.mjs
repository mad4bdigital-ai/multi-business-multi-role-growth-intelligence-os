import assert from "node:assert/strict";
import express from "express";
import { TENANT_GPT_OAUTH_CLIENT_ID } from "./tenantGptOAuthPreset.js";
import {
  REQUIRED_CODE_BINDING_CLAIMS,
  buildTenantGptOAuthTokenExchangeDeps,
  validateTenantGptOAuthAuthorizationCodeBindings,
} from "./tenantGptOAuthTokenExchangeBindingGuard.js";
import { buildTenantGptOAuthMetadataRoutes } from "./routes/tenantGptOAuthMetadataRoutes.js";

const RESOURCE = "https://activation.mad4b.com";
const CALLBACK = "https://chatgpt.com/aip/g-binding-test/oauth/callback";
const CLIENT_SECRET = "binding-test-client-secret";
const CODE_PAYLOAD = Object.freeze({
  purpose: "custom_gpt_oauth_code",
  jti: "binding-test-code-jti",
  user_id: "binding-user-1",
  tenant_id: "binding-tenant-1",
  redirect_uri: CALLBACK,
  client_id: TENANT_GPT_OAUTH_CLIENT_ID,
  resource: RESOURCE,
  scope: "https://auth.mad4b.com/scopes/tenant.activation",
});
const BASE_BODY = Object.freeze({
  grant_type: "authorization_code",
  code: "binding-test-raw-code",
  redirect_uri: CALLBACK,
  client_id: TENANT_GPT_OAUTH_CLIENT_ID,
  client_secret: CLIENT_SECRET,
  resource: RESOURCE,
});

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
      "x-forwarded-host": "activation.mad4b.com",
      cookie: "binding-cookie-must-not-cross=1",
    },
    body: new URLSearchParams(body).toString(),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
}

function deterministicIds() {
  let count = 0;
  return () => `00000000-0000-4000-8000-${String(++count).padStart(12, "0")}`;
}

function createHarness(codePayload = CODE_PAYLOAD) {
  let verifyCalls = 0;
  let subjectCalls = 0;
  let consumeCalls = 0;
  const diagnostics = [];
  const pool = {
    async query(sql, params = []) {
      if (String(sql).includes("INSERT INTO `execution_log`")) {
        diagnostics.push({ sql, params });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected binding-guard query: ${sql}`);
    },
  };
  const deps = {
    env: {},
    getPool: () => pool,
    randomUUID: deterministicIds(),
    now: () => Date.parse("2026-08-04T01:00:00.000Z"),
    validateClientCredentials: async (credentials) => {
      assert.equal(credentials.client_id, TENANT_GPT_OAUTH_CLIENT_ID);
      assert.equal(credentials.client_secret, CLIENT_SECRET);
      return {
        ok: true,
        source: "binding-test",
        client_id: TENANT_GPT_OAUTH_CLIENT_ID,
        client_secret_required: true,
      };
    },
    verifyCode: () => {
      verifyCalls += 1;
      return { ...codePayload };
    },
    resolveActiveSubject: async () => {
      subjectCalls += 1;
      return {
        ok: true,
        user: { user_id: "binding-user-1", email: "binding@example.com", status: "active" },
        tenant_id: "binding-tenant-1",
        secrets_included: false,
      };
    },
    issueAccessToken: () => "binding-test-access-token",
    consumeCode: async () => {
      consumeCalls += 1;
      return {
        consumed: true,
        outcome: "consumed",
        replay_allowed: false,
        table_recovered: false,
        secrets_included: false,
      };
    },
    recordActivationContext: async () => ({
      ok: true,
      stored: true,
      source: "binding-test",
      secrets_included: false,
    }),
  };

  const app = express();
  app.use(buildTenantGptOAuthMetadataRoutes(deps));
  app.post("/auth/oauth/token", (_req, res) => res.status(599).json({ error: "legacy_route_reached" }));
  return {
    app,
    diagnostics,
    verifyCalls: () => verifyCalls,
    subjectCalls: () => subjectCalls,
    consumeCalls: () => consumeCalls,
  };
}

async function runScenario(harness, body) {
  const { server, baseUrl } = await startServer(harness.app);
  try {
    const result = await postForm(baseUrl, body);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return result;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

assert.deepEqual(
  validateTenantGptOAuthAuthorizationCodeBindings({ ...CODE_PAYLOAD }),
  { ...CODE_PAYLOAD },
);
for (const claim of REQUIRED_CODE_BINDING_CLAIMS) {
  const payload = { ...CODE_PAYLOAD, [claim]: "" };
  assert.throws(
    () => validateTenantGptOAuthAuthorizationCodeBindings(payload),
    (error) => error?.name === "JsonWebTokenError"
      && error?.code === `oauth_code_${claim}_required`,
    `${claim} must be a mandatory signed binding claim`,
  );
}
assert.throws(
  () => validateTenantGptOAuthAuthorizationCodeBindings({ ...CODE_PAYLOAD, redirect_uri: "not-a-url" }),
  (error) => error?.code === "oauth_code_redirect_uri_invalid",
);
assert.throws(
  () => validateTenantGptOAuthAuthorizationCodeBindings({ ...CODE_PAYLOAD, resource: "https://unregistered.example.com" }),
  (error) => error?.code === "oauth_code_resource_invalid",
);

const unavailableSecretDeps = buildTenantGptOAuthTokenExchangeDeps({}, {});
assert.throws(
  () => unavailableSecretDeps.verifyCode("opaque-code"),
  (error) => error?.code === "oauth_jwt_secret_unavailable"
    && error?.name !== "JsonWebTokenError",
  "missing JWT_SECRET must fail as a pre-consumption dependency, not invalid_grant",
);

const missingRedirectHarness = createHarness();
const { redirect_uri: _redirectUri, ...bodyWithoutRedirect } = BASE_BODY;
const missingRedirect = await runScenario(missingRedirectHarness, bodyWithoutRedirect);
assert.equal(missingRedirect.status, 400);
assert.equal(missingRedirect.body.error, "invalid_request");
assert.equal(missingRedirect.body.error_code, "oauth_redirect_uri_required");
assert.equal(missingRedirect.body.retry_same_code, true);
assert.equal(missingRedirect.body.restart_authorization, false);
assert.equal(missingRedirect.body.secrets_included, false);
assert.equal(missingRedirect.headers.get("cache-control"), "no-store");
assert.equal(missingRedirect.headers.get("pragma"), "no-cache");
assert.match(missingRedirect.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/i);
assert.equal(missingRedirectHarness.verifyCalls(), 0);
assert.equal(missingRedirectHarness.subjectCalls(), 0);
assert.equal(missingRedirectHarness.consumeCalls(), 0);

for (const claim of REQUIRED_CODE_BINDING_CLAIMS) {
  const harness = createHarness({ ...CODE_PAYLOAD, [claim]: "" });
  const response = await runScenario(harness, BASE_BODY);
  assert.equal(response.status, 400, `${claim} omission must be rejected`);
  assert.equal(response.body.error, "invalid_grant");
  assert.equal(response.body.error_code, "oauth_code_invalid");
  assert.equal(response.body.retry_same_code, false);
  assert.equal(response.body.restart_authorization, true);
  assert.equal(response.body.secrets_included, false);
  assert.equal(harness.verifyCalls(), 1);
  assert.equal(harness.subjectCalls(), 0);
  assert.equal(harness.consumeCalls(), 0, `${claim} omission must never consume the code`);
  const serializedDiagnostics = JSON.stringify(harness.diagnostics);
  assert.equal(serializedDiagnostics.includes(BASE_BODY.code), false);
  assert.equal(serializedDiagnostics.includes(CLIENT_SECRET), false);
}

console.log("PASS tenant-gpt-oauth-token-binding-guard");
