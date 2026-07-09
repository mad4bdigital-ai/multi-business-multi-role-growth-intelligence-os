/**
 * test-auth-oauth-routes.mjs
 *
 * Fast validation checks for the GPT Action OAuth bridge.
 *
 * Run: node test-auth-oauth-routes.mjs
 */

process.env.JWT_SECRET = "oauth_route_test_secret";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";

import express from "express";
import jwt from "jsonwebtoken";
import { readFileSync } from "node:fs";

const { buildAuthRoutes } = await import("./routes/authRoutes.js");

const TENANT_SCOPE_LINKS = [
  "https://auth.mad4b.com/scopes/tenant.links",
  "https://auth.mad4b.com/scopes/tenant.status",
  "https://auth.mad4b.com/scopes/tenant.activation",
  "https://auth.mad4b.com/scopes/tenant.install",
  "https://auth.mad4b.com/scopes/tenant.system-tools",
];
const TENANT_SCOPE = TENANT_SCOPE_LINKS.join(" ");

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n== ${name}`);
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { parse_error: true, text };
  }
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await readJson(response) };
}

async function postForm(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  return { status: response.status, body: await readJson(response) };
}

async function getText(baseUrl, path, { headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    cacheControl: response.headers.get("cache-control") || "",
    text: await response.text(),
  };
}

const oauthTokenDiagnostics = [];
const tenantGptActivationContexts = [];

const oauthClientPool = {
  async query(sql, params) {
    if (sql.includes("INSERT INTO `execution_log`")) {
      oauthTokenDiagnostics.push({
        execution_status: params[4],
        failure_reason: params[5],
        output_summary: JSON.parse(params[6]),
        action_key: params[7],
        endpoint_key: params[8],
        parent_action_key: params[9],
        runtime_evidence_json: JSON.parse(params[10]),
      });
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("CREATE TABLE IF NOT EXISTS `tenant_gpt_activation_contexts`")) {
      return [{ affectedRows: 0 }];
    }
    if (sql.includes("INSERT INTO `tenant_gpt_activation_contexts`")) {
      tenantGptActivationContexts.push({
        access_jti: params[0],
        oauth_code_jti: params[1],
        user_id: params[2],
        tenant_id: params[3],
        client_id: params[4],
        activation_context_json: params[5],
        expires_at: params[6],
      });
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM `platform_runtime_config`")) {
      return [[{
        config_json: JSON.stringify({
          client_id: "mad4b-tenant-gpt",
          client_secret: "test-client-secret",
        }),
      }]];
    }
    if (sql.includes("FROM `users`")) {
      const lookup = params[0];
      if (lookup === "user-1" || lookup === "user@example.com") {
        return [[{ user_id: "user-1", email: "user@example.com", display_name: "User One", status: "active" }]];
      }
      return [[]];
    }
    if (sql.includes("FROM `memberships`")) {
      if (params[0] === "user-1") {
        return [[{ tenant_id: "tenant-1", role: "owner", status: "active", tenant_display_name: "Tenant One" }]];
      }
      return [[]];
    }
    throw new Error(`Unexpected OAuth client query: ${sql} ${JSON.stringify(params)}`);
  },
};

const app = express();
app.use(express.json());
app.use("/auth", buildAuthRoutes({ getPool: () => oauthClientPool }));

const { server, baseUrl } = await startServer(app);

try {
  const redirectUri = "https://chat.openai.com/aip/g-d36db295032b9022dd77233041763f513e8ba5fa/oauth/callback";
  const canonicalRedirectUri = "https://chatgpt.com/aip/g-d36db295032b9022dd77233041763f513e8ba5fa/oauth/callback";
  const state = "state-123";
  const encodedRedirect = encodeURIComponent(redirectUri);

  section("authorize popup");

  {
    const result = await getText(baseUrl, `/auth/oauth/authorize?redirect_uri=${encodedRedirect}&state=${state}&scope=${encodeURIComponent(TENANT_SCOPE)}&screen_hint=signup&activation_mode=managed&device_id=my-laptop&workspace_name=Acme%20Growth&sign_in_options=google,email,register`);
    assert("authorize returns html", result.status === 200, `${result.status}`);
    assert("authorize is not cacheable", result.cacheControl.includes("no-store"), result.cacheControl);
    assert("authorize includes app name", result.text.includes("Growth Intelligence Platform"));
    assert("authorize renders Google Sign-In", result.text.includes("accounts.google.com/gsi/client"));
    assert("authorize includes existing-account option", result.text.includes("Existing account"));
    assert("authorize includes new-workspace option", result.text.includes("New workspace"));
    assert("authorize carries activation mode", result.text.includes('"activation_mode":"managed"'));
    assert("authorize carries requested OAuth scope", result.text.includes(TENANT_SCOPE));
    assert("authorize carries device id", result.text.includes('"device_id":"my-laptop"'));
    assert("authorize preselects signup panel", result.text.includes('const INITIAL_PANEL = "register"'));
    assert("authorize includes privacy policy link", result.text.includes('href="/privacy-policy"'));
    assert("authorize includes configured Google client", result.text.includes(process.env.GOOGLE_CLIENT_ID));
    assert("authorize preserves requested ChatGPT callback", result.text.includes(redirectUri));
    assert("authorize does not rewrite callback before ChatGPT state validation", !result.text.includes('const REDIRECT_URI = "https://chatgpt.com'));
    assert("authorize leaves GIS button locale automatic", !/locale\s*:\s*["'][^"']+["']/.test(result.text));
    assert("authorize does not force a GSI hl parameter", !result.text.includes("gsi/client?hl="));
  }

  {
    const result = await getText(
      baseUrl,
      `/auth/oauth/authorize?redirect_uri=${encodedRedirect}&state=${state}&language=ar-EG`,
      { headers: { "accept-language": "ar-EG,ar;q=0.9,en;q=0.8" } }
    );
    assert("Arabic browser language still returns authorize html", result.status === 200, `${result.status}`);
    assert("Arabic browser language is delegated to GIS", !/locale\s*:\s*["'][^"']+["']/.test(result.text));
    assert("Arabic browser language does not inject hl", !result.text.includes("gsi/client?hl="));
  }

  section("Google Identity Services locale policy");
  for (const relativePath of [
    "./routes/authRoutes.js",
    "./routes/localManagerBetaRoutes.js",
    "./public/connect/app.jsx",
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert(`${relativePath} does not hardcode a GIS locale`, !/renderButton[\s\S]{0,300}locale\s*:/.test(source));
    assert(`${relativePath} does not force a GSI hl parameter`, !source.includes("accounts.google.com/gsi/client?hl="));
  }

  {
    const result = await getText(baseUrl, "/auth/oauth/authorize?redirect_uri=file%3A%2F%2Fbad");
    assert("authorize rejects unsafe redirect scheme", result.status === 400, `${result.status}`);
  }

  {
    const result = await getText(baseUrl, "/auth/oauth/authorize?redirect_uri=https%3A%2F%2Fevil.example%2Faip%2Fg-bad%2Foauth%2Fcallback");
    assert("authorize rejects unapproved redirect host", result.status === 400, `${result.status}`);
  }

  section("code issuance and token exchange");

  const userToken = jwt.sign(
    { user_id: "user-1", email: "user@example.com", tenant_id: "tenant-1" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  const activationContext = {
    activation_mode: "dedicated",
    device_id: "tenant-pc",
    workspace_name: "Tenant Workspace",
    screen_hint: "signin",
    sign_in_options: ["email", "register"],
  };
  const codeResult = await postJson(baseUrl, "/auth/oauth/code", { token: userToken, redirect_uri: redirectUri, state, scope: TENANT_SCOPE, activation_context: activationContext });
  assert("code endpoint accepts signed user token", codeResult.status === 200, `${codeResult.status}`);
  assert("code response includes code", typeof codeResult.body.code === "string" && codeResult.body.code.length > 40);
  assert("code response redirects with state", String(codeResult.body.redirect_to || "").includes(`state=${state}`), codeResult.body.redirect_to);
  assert("code response redirects with code", String(codeResult.body.redirect_to || "").includes("code="), codeResult.body.redirect_to);
  assert("code response redirects to requested ChatGPT callback", String(codeResult.body.redirect_to || "").startsWith(redirectUri), codeResult.body.redirect_to);
  assert("code response preserves activation mode", codeResult.body.activation_context?.activation_mode === "dedicated", JSON.stringify(codeResult.body.activation_context));
  assert("code response preserves sign-in options", Array.isArray(codeResult.body.activation_context?.sign_in_options) && codeResult.body.activation_context.sign_in_options.includes("email"), JSON.stringify(codeResult.body.activation_context));

  const invalidClient = await postForm(baseUrl, "/auth/oauth/token", {
    grant_type: "authorization_code",
    code: codeResult.body.code,
    redirect_uri: redirectUri,
    client_id: "mad4b-tenant-gpt",
    client_secret: "wrong-secret",
  });
  assert("token endpoint rejects wrong OAuth client secret", invalidClient.status === 401, `${invalidClient.status}`);
  assert("wrong OAuth client secret reports invalid_client", invalidClient.body.error === "invalid_client", JSON.stringify(invalidClient.body));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const invalidClientDiagnostic = oauthTokenDiagnostics.find((row) => row.failure_reason === "invalid_client");
  assert("invalid client token exchange writes diagnostic", Boolean(invalidClientDiagnostic), JSON.stringify(oauthTokenDiagnostics));
  assert("invalid client diagnostic uses OAuth action key", invalidClientDiagnostic?.action_key === "tenant_gpt_oauth_token_exchange", JSON.stringify(invalidClientDiagnostic));
  assert("invalid client diagnostic marks secret presence only", invalidClientDiagnostic?.runtime_evidence_json?.client?.client_secret_present === true, JSON.stringify(invalidClientDiagnostic));
  assert("invalid client diagnostic captures code timing", invalidClientDiagnostic?.runtime_evidence_json?.code_timing?.ttl_seconds === 300, JSON.stringify(invalidClientDiagnostic));
  assert("invalid client diagnostic captures code age", Number.isFinite(invalidClientDiagnostic?.runtime_evidence_json?.code_timing?.age_seconds), JSON.stringify(invalidClientDiagnostic));
  assert("invalid client diagnostic excludes raw secret", !JSON.stringify(invalidClientDiagnostic || {}).includes("wrong-secret"), JSON.stringify(invalidClientDiagnostic));

  const exchange = await postForm(baseUrl, "/auth/oauth/token", {
    grant_type: "authorization_code",
    code: codeResult.body.code,
    redirect_uri: redirectUri,
    client_id: "mad4b-tenant-gpt",
    client_secret: "test-client-secret",
  });
  assert("token endpoint exchanges authorization code", exchange.status === 200, `${exchange.status}`);
  assert("token endpoint returns bearer token", exchange.body.token_type === "Bearer", JSON.stringify(exchange.body));
  assert("token endpoint mints a fresh access JWT", exchange.body.access_token !== userToken && typeof exchange.body.access_token === "string", JSON.stringify(exchange.body));
  assert("token endpoint returns standard OAuth scope", exchange.body.scope === TENANT_SCOPE, JSON.stringify(exchange.body));
  assert("token endpoint excludes non-standard activation context", !Object.prototype.hasOwnProperty.call(exchange.body, "activation_context"), JSON.stringify(exchange.body));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const successDiagnostic = oauthTokenDiagnostics.find((row) => row.execution_status === "success");
  assert("success token exchange writes diagnostic", Boolean(successDiagnostic), JSON.stringify(oauthTokenDiagnostics));
  assert("success diagnostic captures token type", successDiagnostic?.runtime_evidence_json?.access_token?.token_type === "Bearer", JSON.stringify(successDiagnostic));
  assert("success diagnostic captures token length only", successDiagnostic?.runtime_evidence_json?.access_token?.length === exchange.body.access_token.length, JSON.stringify(successDiagnostic));
  assert("success diagnostic captures activation context storage only", successDiagnostic?.runtime_evidence_json?.activation_context?.stored === true, JSON.stringify(successDiagnostic));
  assert("success diagnostic excludes raw access token", !JSON.stringify(successDiagnostic || {}).includes(exchange.body.access_token), JSON.stringify(successDiagnostic));
  assert("token exchange stores activation context server-side", tenantGptActivationContexts.length === 1, JSON.stringify(tenantGptActivationContexts));
  const storedActivationContext = JSON.parse(tenantGptActivationContexts[0].activation_context_json);
  assert("stored activation context preserves activation mode", storedActivationContext.activation_mode === "dedicated", JSON.stringify(storedActivationContext));
  assert("stored activation context preserves workspace name", storedActivationContext.workspace_name === "Tenant Workspace", JSON.stringify(storedActivationContext));
  assert("stored activation context marks secrets excluded", storedActivationContext.secrets_included === false, JSON.stringify(storedActivationContext));
  const accessPayload = jwt.verify(exchange.body.access_token, process.env.JWT_SECRET);
  assert("access JWT has platform issuer", accessPayload.iss === "https://auth.mad4b.com", JSON.stringify(accessPayload));
  assert("access JWT has tenant GPT audience", accessPayload.aud === "mad4b-tenant-gpt", JSON.stringify(accessPayload));
  assert("access JWT has tenant subject", accessPayload.sub === "tenant:tenant-1:user:user-1", JSON.stringify(accessPayload));
  assert("stored activation context is linked to access JWT jti", tenantGptActivationContexts[0].access_jti === accessPayload.jti, JSON.stringify({ stored: tenantGptActivationContexts[0].access_jti, token: accessPayload.jti }));
  assert("access JWT carries linked tenant scopes", accessPayload.scope === TENANT_SCOPE, JSON.stringify(accessPayload));
  assert("OAuth access JWT omits duplicated scope links", accessPayload.scope_links === undefined, JSON.stringify(accessPayload));
  assert("OAuth access JWT omits duplicated client id", accessPayload.client_id === undefined, JSON.stringify(accessPayload));
  assert("OAuth access JWT stays compact", exchange.body.access_token.length < 1000, String(exchange.body.access_token.length));
  assert("access JWT carries tenant GPT purpose", accessPayload.purpose === "tenant_gpt_access", JSON.stringify(accessPayload));

  const mismatch = await postForm(baseUrl, "/auth/oauth/token", {
    grant_type: "authorization_code",
    code: codeResult.body.code,
    redirect_uri: "https://chatgpt.com/aip/other/oauth/callback",
    client_id: "mad4b-tenant-gpt",
    client_secret: "test-client-secret",
  });
  assert("token endpoint rejects redirect mismatch", mismatch.status === 400, `${mismatch.status}`);
  assert("redirect mismatch reports invalid_grant", mismatch.body.error === "invalid_grant", JSON.stringify(mismatch.body));

  section("platform JWT client");

  const fakePool = {
    async query(sql, params) {
      if (sql.includes("FROM `users`")) {
        const lookup = params[0];
        if (lookup === "user-1" || lookup === "user@example.com") {
          return [[{
            user_id: "user-1",
            email: "user@example.com",
            display_name: "User One",
            status: "active",
          }]];
        }
        return [[]];
      }
      if (sql.includes("FROM `memberships`") && sql.includes("m.tenant_id = ?")) {
        if (params[0] === "user-1" && params[1] === "tenant-1") {
          return [[{
            tenant_id: "tenant-1",
            role: "owner",
            status: "active",
            tenant_display_name: "Tenant One",
          }]];
        }
        return [[]];
      }
      if (sql.includes("FROM `memberships`")) {
        return [[{
          tenant_id: "tenant-1",
          role: "owner",
          status: "active",
          tenant_display_name: "Tenant One",
        }]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  function requireBackendApiKey(req, res, next) {
    const auth = req.headers.authorization || "";
    if (auth === "Bearer admin-secret") {
      req.auth = { mode: "backend_api_key", is_admin: true };
      return next();
    }
    if (auth === "Bearer user-secret") {
      req.auth = { mode: "user_jwt", is_admin: false, user_id: "user-1" };
      return next();
    }
    return res.status(401).json({ ok: false });
  }

  const jwtClientApp = express();
  jwtClientApp.use(express.json());
  jwtClientApp.use("/auth", buildAuthRoutes({ requireBackendApiKey, getPool: () => fakePool }));
  const jwtClientServer = await startServer(jwtClientApp);
  try {
    const unauthorized = await fetch(`${jwtClientServer.baseUrl}/auth/platform-jwt/issue`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer user-secret" },
      body: JSON.stringify({ email: "user@example.com" }),
    });
    const unauthorizedBody = await readJson(unauthorized);
    assert("platform JWT client rejects user principal", unauthorized.status === 403, `${unauthorized.status}`);
    assert("platform JWT client reports admin requirement", unauthorizedBody.error?.code === "admin_principal_required", JSON.stringify(unauthorizedBody));

    const issued = await fetch(`${jwtClientServer.baseUrl}/auth/platform-jwt/issue`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer admin-secret" },
      body: JSON.stringify({ email: "user@example.com", tenant_id: "tenant-1", ttl_seconds: 120, reason: "activation-check" }),
    });
    const issuedBody = await readJson(issued);
    assert("platform JWT client issues token for admin", issued.status === 200, `${issued.status}`);
    assert("platform JWT client returns bearer token", issuedBody.token_type === "Bearer" && typeof issuedBody.access_token === "string", JSON.stringify(issuedBody));
    assert("platform JWT client clamps requested ttl", issuedBody.expires_in === 120, JSON.stringify(issuedBody));
    const issuedPayload = jwt.verify(issuedBody.access_token, process.env.JWT_SECRET);
    assert("platform JWT token has user claim", issuedPayload.user_id === "user-1", JSON.stringify(issuedPayload));
    assert("platform JWT token has tenant claim", issuedPayload.tenant_id === "tenant-1", JSON.stringify(issuedPayload));
    assert("platform JWT token carries tenant GPT purpose", issuedPayload.purpose === "tenant_gpt_access", JSON.stringify(issuedPayload));
assert("platform JWT token carries tenant GPT audience", issuedPayload.aud === "mad4b-tenant-gpt", JSON.stringify(issuedPayload));
assert("platform JWT token carries tenant GPT scope", String(issuedPayload.scope || "").includes("tenant.status"), JSON.stringify(issuedPayload));

    const wrongTenant = await fetch(`${jwtClientServer.baseUrl}/auth/platform-jwt/issue`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer admin-secret" },
      body: JSON.stringify({ email: "user@example.com", tenant_id: "tenant-2" }),
    });
    const wrongTenantBody = await readJson(wrongTenant);
    assert("platform JWT client enforces tenant membership", wrongTenant.status === 403, `${wrongTenant.status}`);
    assert("tenant membership failure is explicit", wrongTenantBody.error?.code === "tenant_membership_required", JSON.stringify(wrongTenantBody));
  } finally {
    await new Promise((resolve) => jwtClientServer.server.close(resolve));
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log(`\nAuth OAuth route tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
