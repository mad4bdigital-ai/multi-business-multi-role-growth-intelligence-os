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
const { buildActivationHostGatewayRoutes } = await import("./routes/activationHostGatewayRoutes.js");
const { buildTenantGptOAuthMetadataRoutes } = await import("./routes/tenantGptOAuthMetadataRoutes.js");
const { hasVerifiedGoogleIdentity, normalizeAuthEmail } = await import("./authIdentityNormalization.js");
await import("./test-tenant-gpt-access-token-verifier.mjs");
await import("./test-tenant-gpt-oauth-authorization-code-store.mjs");
await import("./test-tenant-gpt-google-jit-recovery.mjs");

const TENANT_SCOPE_LINKS = [
  "https://auth.mad4b.com/scopes/tenant.links",
  "https://auth.mad4b.com/scopes/tenant.status",
  "https://auth.mad4b.com/scopes/tenant.activation",
  "https://auth.mad4b.com/scopes/tenant.install",
  "https://auth.mad4b.com/scopes/tenant.system-tools",
];
const TENANT_SCOPE = TENANT_SCOPE_LINKS.join(" ");
const AUTH_RESOURCE = "https://auth.mad4b.com";
const ACTIVATION_RESOURCE = "https://activation.mad4b.com";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    const message = `${label}${detail ? ` - ${detail}` : ""}`;
    console.error(`  [FAIL] ${message}`);
    if (process.env.GITHUB_ACTIONS === "true") {
      const annotation = message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
      console.error(`::error title=OAuth route test failure::${annotation}`);
    }
    failed++;
  }
}

function section(name) {
  console.log(`\n== ${name}`);
}

section("identity normalization");
assert("email normalization trims and lowercases", normalizeAuthEmail("  User@Example.COM  ") === "user@example.com");
assert("verified Google identity is accepted", hasVerifiedGoogleIdentity({ sub: "google-sub", email: "User@Example.COM", email_verified: true }));
assert("unverified Google identity is rejected", !hasVerifiedGoogleIdentity({ sub: "google-sub", email: "user@example.com", email_verified: false }));
assert("missing Google verification claim is rejected", !hasVerifiedGoogleIdentity({ sub: "google-sub", email: "user@example.com" }));
assert("missing Google subject is rejected", !hasVerifiedGoogleIdentity({ email: "user@example.com", email_verified: true }));

const identityHardeningMigration = readFileSync(new URL("./migrations/20260717_tenant_gpt_jit_identity_hardening.sql", import.meta.url), "utf8");
assert("identity migration fails closed on duplicate subjects", identityHardeningMigration.includes("SIGNAL SQLSTATE ''45000''"));
assert("identity migration ignores empty provider subjects", identityHardeningMigration.includes("TRIM(provider_id) <> ''"));
assert("identity migration adds provider subject uniqueness", identityHardeningMigration.includes("UNIQUE KEY uq_user_credentials_provider_subject (auth_provider, provider_id)"));
assert("identity migration is idempotent", identityHardeningMigration.includes("information_schema.statistics"));

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

async function postJson(baseUrl, path, body, { headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-host": "activation.mad4b.com", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, body: await readJson(response) };
}

async function postForm(baseUrl, path, body, { headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-host": "activation.mad4b.com", ...headers },
    body: new URLSearchParams(body).toString(),
  });
  return { status: response.status, body: await readJson(response) };
}

async function getText(baseUrl, path, { headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { "x-forwarded-host": "activation.mad4b.com", ...headers } });
  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    cacheControl: response.headers.get("cache-control") || "",
    text: await response.text(),
  };
}

const oauthTokenDiagnostics = [];
const tenantGptActivationContexts = [];
const oauthCredentialRequests = [];
const durableOAuthCodes = new Map();

const oauthClientPool = {
  async query(sql, params) {
    if (sql.includes("INSERT INTO `tenant_gpt_oauth_authorization_codes`")) {
      durableOAuthCodes.set(params[0], {
        client_id: params[3],
        redirect_uri_hash: params[4],
        status: "issued",
      });
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("UPDATE `tenant_gpt_oauth_authorization_codes`")) {
      const record = durableOAuthCodes.get(params[0]);
      const canConsume = record
        && record.client_id === params[1]
        && record.redirect_uri_hash === params[2]
        && record.status === "issued";
      if (canConsume) record.status = "consumed";
      return [{ affectedRows: canConsume ? 1 : 0 }];
    }
    if (sql.includes("SELECT status, expires_at, consumed_at")
        && sql.includes("FROM `tenant_gpt_oauth_authorization_codes`")) {
      const record = durableOAuthCodes.get(params[2]);
      if (!record) return [[]];
      return [[{
        status: record.status,
        expires_at: "2099-01-01 00:00:00",
        consumed_at: record.status === "consumed" ? "2026-08-04 00:00:00" : null,
        client_matches: record.client_id === params[0] ? 1 : 0,
        redirect_matches: record.redirect_uri_hash === params[1] ? 1 : 0,
        expired_by_store: 0,
      }]];
    }
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
app.use(buildTenantGptOAuthMetadataRoutes({ getPool: () => oauthClientPool }));
app.use(buildActivationHostGatewayRoutes());
app.get("/tenant/activation/probe", (req, res) => res.status(200).json({ ok: true, auth: req.auth || null }));
app.use("/auth", buildAuthRoutes({
  getPool: () => oauthClientPool,
  async resolveTenantGptOAuthCredential(credential) {
    oauthCredentialRequests.push({
      kind: credential?.kind || null,
      email: credential?.email || null,
      password_present: Boolean(credential?.password),
    });
    if (credential?.kind !== "login" || credential?.email !== "user@example.com") return null;
    return {
      user_id: "user-1",
      email: "user@example.com",
      display_name: "User One",
      tenant_id: "tenant-1",
      memberships: [{ tenant_id: "tenant-1", role: "owner", status: "active" }],
    };
  },
}));

const { server, baseUrl } = await startServer(app);

try {
  const redirectUri = "https://chat.openai.com/aip/g-d36db295032b9022dd77233041763f513e8ba5fa/oauth/callback";
  const canonicalRedirectUri = "https://chatgpt.com/aip/g-d36db295032b9022dd77233041763f513e8ba5fa/oauth/callback";
  const state = "state-123";
  const encodedRedirect = encodeURIComponent(redirectUri);

  section("authorize popup");

  {
    const result = await getText(
      baseUrl,
      `/auth/oauth/authorize?client_id=mad4b-tenant-gpt&response_type=code&redirect_uri=${encodedRedirect}&state=${state}&scope=${encodeURIComponent(TENANT_SCOPE)}&screen_hint=signup&activation_mode=managed&device_id=my-laptop&workspace_name=Acme%20Growth&sign_in_options=google,email,register`,
      { headers: { "x-forwarded-host": "activation.mad4b.com" } },
    );
    assert("activation host authorize reaches shared auth route", result.status === 200, `${result.status}`);
    assert("authorize is not cacheable", result.cacheControl.includes("no-store"), result.cacheControl);
    assert("authorize includes app name", result.text.includes("Growth Intelligence Platform"));
    assert("authorize renders Google Sign-In", result.text.includes("accounts.google.com/gsi/client"));
    assert("authorize includes existing-account option", result.text.includes("Existing account"));
    assert("authorize includes new-workspace option", result.text.includes("New workspace"));
    assert("authorize carries activation mode", result.text.includes('"activation_mode":"managed"'));
    assert("authorize carries requested OAuth scope", result.text.includes(TENANT_SCOPE));
    assert("authorize carries the registered OAuth client", result.text.includes('const OAUTH_CLIENT_ID = "mad4b-tenant-gpt"'));
    assert("authorize carries the derived Activation resource", result.text.includes(`const OAUTH_RESOURCE = ${JSON.stringify(ACTIVATION_RESOURCE)}`));
    assert("authorize carries device id", result.text.includes('"device_id":"my-laptop"'));
    assert("authorize preselects signup panel", result.text.includes('const INITIAL_PANEL = "register"'));
    assert("authorize does not emit application onboarding link", !result.text.includes('href="https://auth.mad4b.com/connect"'));
    assert("authorize privacy link always targets auth host", result.text.includes('href="https://auth.mad4b.com/privacy-policy"'));
    assert("authorize terms link always targets auth host", result.text.includes('href="https://auth.mad4b.com/terms-of-use"'));
    assert("authorize does not emit relative setup link", !result.text.includes('href="/connect"'));
    assert("authorize includes configured Google client", result.text.includes(process.env.GOOGLE_CLIENT_ID));
    assert("authorize preserves requested ChatGPT callback", result.text.includes(redirectUri));
    assert("authorize does not rewrite callback before ChatGPT state validation", !result.text.includes('const REDIRECT_URI = "https://chatgpt.com'));
    assert("authorize popup submits every identity mode through OAuth code endpoint", result.text.includes('fetch("/auth/oauth/code"'));
    assert("authorize popup does not call broad login route", !result.text.includes('fetch("/auth/login"'));
    assert("authorize popup does not call broad registration route", !result.text.includes('fetch("/auth/register"'));
    assert("authorize popup does not call broad Google auth route", !result.text.includes('fetch("/auth/google"'));
    assert("authorize leaves GIS button locale automatic", !/locale\s*:\s*["'][^"']+["']/.test(result.text));
    assert("authorize does not force a GSI hl parameter", !result.text.includes("gsi/client?hl="));
  }

  {
    const result = await getText(
      baseUrl,
      `/auth/oauth/authorize?client_id=mad4b-tenant-gpt&response_type=code&redirect_uri=${encodedRedirect}&state=${state}&language=ar-EG`,
      { headers: { "accept-language": "ar-EG,ar;q=0.9,en;q=0.8" } }
    );
    assert("Arabic browser language still returns authorize html", result.status === 200, `${result.status}`);
    assert("Arabic browser language is delegated to GIS", !/locale\s*:\s*["'][^"']+["']/.test(result.text));
    assert("Arabic browser language does not inject hl", !result.text.includes("gsi/client?hl="));
  }

  section("OAuth metadata");

  {
    const authorizationMetadataResult = await getText(baseUrl, "/.well-known/oauth-authorization-server");
    const authorizationMetadata = JSON.parse(authorizationMetadataResult.text);
    assert("authorization metadata is public", authorizationMetadataResult.status === 200, `${authorizationMetadataResult.status}`);
    assert("authorization metadata publishes the platform issuer", authorizationMetadata.issuer === AUTH_RESOURCE, JSON.stringify(authorizationMetadata));
    assert("authorization metadata publishes the authorization endpoint", authorizationMetadata.authorization_endpoint === "https://auth.mad4b.com/auth/oauth/authorize", JSON.stringify(authorizationMetadata));
    assert("authorization metadata publishes the token endpoint", authorizationMetadata.token_endpoint === "https://auth.mad4b.com/auth/oauth/token", JSON.stringify(authorizationMetadata));
    assert("authorization metadata declares resource support", authorizationMetadata.resource_parameter_supported === true, JSON.stringify(authorizationMetadata));

    const protectedResourceResult = await getText(baseUrl, "/.well-known/oauth-protected-resource");
    const protectedResource = JSON.parse(protectedResourceResult.text);
    assert("protected resource metadata is public", protectedResourceResult.status === 200, `${protectedResourceResult.status}`);
    assert("protected resource metadata identifies Activation", protectedResource.resource === ACTIVATION_RESOURCE, JSON.stringify(protectedResource));
    assert("protected resource metadata links the authorization server", protectedResource.authorization_servers?.includes(AUTH_RESOURCE), JSON.stringify(protectedResource));
    assert("protected resource metadata requires bearer header usage", protectedResource.bearer_methods_supported?.includes("header"), JSON.stringify(protectedResource));
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
    const result = await getText(baseUrl, `/auth/oauth/authorize?client_id=mad4b-tenant-gpt&response_type=code&state=${state}&redirect_uri=file%3A%2F%2Fbad`);
    assert("authorize rejects unsafe redirect scheme", result.status === 400, `${result.status}`);
  }

  {
    const result = await getText(baseUrl, `/auth/oauth/authorize?client_id=mad4b-tenant-gpt&response_type=code&state=${state}&redirect_uri=https%3A%2F%2Fevil.example%2Faip%2Fg-bad%2Foauth%2Fcallback`);
    assert("authorize rejects unapproved redirect host", result.status === 400, `${result.status}`);
  }

  {
    const result = await getText(baseUrl, `/auth/oauth/authorize?client_id=other-client&response_type=code&state=${state}&redirect_uri=${encodedRedirect}`);
    assert("authorize rejects non-Tenant-GPT client", result.status === 400, `${result.status}`);
  }

  {
    const result = await getText(
      baseUrl,
      `/auth/oauth/authorize?client_id=mad4b-tenant-gpt&response_type=code&state=${state}&redirect_uri=${encodedRedirect}&resource=${encodeURIComponent(AUTH_RESOURCE)}`,
    );
    assert("authorize rejects a resource that does not match the Activation host", result.status === 400, `${result.status}`);
  }

  {
    const result = await getText(
      baseUrl,
      `/auth/oauth/authorize?client_id=mad4b-tenant-gpt&response_type=code&state=${state}&redirect_uri=${encodedRedirect}`,
      { headers: { "x-forwarded-host": "unregistered.example" } },
    );
    assert("authorize rejects an unregistered request host", result.status === 400, `${result.status}`);
  }

  {
    const result = await getText(baseUrl, `/auth/oauth/authorize?client_id=mad4b-tenant-gpt&response_type=code&redirect_uri=${encodedRedirect}`);
    assert("authorize requires state before rendering popup", result.status === 400, `${result.status}`);
  }

  section("code issuance and token exchange");

  const googleFlowCalls = [];
  let googleCodeStoreInsertAttempts = 0;
  const googleConnection = {
    async beginTransaction() { googleFlowCalls.push("begin"); },
    async query(sql, params) {
      googleFlowCalls.push({ target: "connection", sql, params });
      if (sql.includes("FROM `user_credentials`")) return [[{ user_id: "google-user-1" }]];
      if (sql.includes("FROM `memberships`")) {
        return [[{ tenant_id: "google-tenant-1", membership_status: "active", tenant_status: "active" }]];
      }
      throw new Error(`Unexpected Google connection query: ${sql}`);
    },
    async commit() { googleFlowCalls.push("commit"); },
    async rollback() { googleFlowCalls.push("rollback"); },
    release() { googleFlowCalls.push("release"); },
  };
  const googleFlowPool = {
    async getConnection() { return googleConnection; },
    async query(sql, params) {
      googleFlowCalls.push({ target: "pool", sql, params });
      if (sql.includes("FROM `platform_runtime_config`")) {
        return [[{
          config_json: JSON.stringify({
            client_id: "mad4b-tenant-gpt",
            client_secret: "test-client-secret",
            callback_urls_to_allow: [canonicalRedirectUri],
          }),
        }]];
      }
      if (sql.includes("FROM `memberships`")) {
        return [[{ tenant_id: "google-tenant-1", role: "owner", status: "active", tenant_display_name: "Google Tenant" }]];
      }
      if (sql.includes("INSERT INTO `tenant_gpt_oauth_authorization_codes`")) {
        googleCodeStoreInsertAttempts += 1;
        if (googleCodeStoreInsertAttempts === 1) {
          const error = new Error("Table 'platform.tenant_gpt_oauth_authorization_codes' doesn't exist");
          error.code = "ER_NO_SUCH_TABLE";
          error.errno = 1146;
          throw error;
        }
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("CREATE TABLE IF NOT EXISTS `tenant_gpt_oauth_authorization_codes`")) {
        return [{ affectedRows: 0 }];
      }
      throw new Error(`Unexpected Google pool query: ${sql}`);
    },
  };
  const verifiedGoogleTokens = [];
  const googleFlowApp = express();
  googleFlowApp.use(express.json());
  googleFlowApp.use("/auth", buildAuthRoutes({
    getPool: () => googleFlowPool,
    googleClient: {
      async verifyIdToken(input) {
        verifiedGoogleTokens.push(input);
        return {
          getPayload() {
            return {
              sub: "google-subject-1",
              email: "Google.User@Example.COM",
              email_verified: true,
              name: "Google User",
            };
          },
        };
      },
    },
  }));
  const googleFlowServer = await startServer(googleFlowApp);
  try {
    const googleCodeResult = await postJson(googleFlowServer.baseUrl, "/auth/oauth/code", {
      credential: { kind: "google", id_token: "verified-google-id-token" },
      redirect_uri: redirectUri,
      state: "google-state",
      scope: TENANT_SCOPE,
    });
    assert("Google popup issues an authorization code through the default identity resolver", googleCodeResult.status === 200, JSON.stringify(googleCodeResult.body));
    assert("Google ID token is verified for the configured audience", verifiedGoogleTokens[0]?.audience === process.env.GOOGLE_CLIENT_ID, JSON.stringify(verifiedGoogleTokens));
    assert("Google identity reuses the bound platform user", jwt.decode(googleCodeResult.body.code)?.user_id === "google-user-1", JSON.stringify(googleCodeResult.body));
    assert("Google identity normalizes email before code issuance", jwt.decode(googleCodeResult.body.code)?.email === "google.user@example.com", JSON.stringify(googleCodeResult.body));
    assert("missing durable code table is created once", googleFlowCalls.filter((call) => typeof call === "object" && call.sql.includes("CREATE TABLE IF NOT EXISTS `tenant_gpt_oauth_authorization_codes`")).length === 1, JSON.stringify(googleFlowCalls));
    assert("authorization-code insert is retried after table recovery", googleCodeStoreInsertAttempts === 2, String(googleCodeStoreInsertAttempts));
    assert("Google identity transaction commits", googleFlowCalls.includes("commit"), JSON.stringify(googleFlowCalls));
    assert("Google OAuth state survives the recovered code flow", String(googleCodeResult.body.redirect_to || "").includes("state=google-state"), googleCodeResult.body.redirect_to);
  } finally {
    await new Promise((resolve) => googleFlowServer.server.close(resolve));
  }

  const unavailableStorePool = {
    async query(sql) {
      if (sql.includes("FROM `platform_runtime_config`")) {
        return [[{
          config_json: JSON.stringify({
            client_id: "mad4b-tenant-gpt",
            client_secret: "test-client-secret",
            callback_urls_to_allow: [canonicalRedirectUri],
          }),
        }]];
      }
      if (sql.includes("INSERT INTO `tenant_gpt_oauth_authorization_codes`")) {
        const error = new Error("sensitive database connection detail");
        error.code = "ECONNREFUSED";
        error.errno = 111;
        throw error;
      }
      throw new Error(`Unexpected unavailable-store query: ${sql}`);
    },
  };
  const unavailableStoreApp = express();
  unavailableStoreApp.use(express.json());
  unavailableStoreApp.use("/auth", buildAuthRoutes({
    getPool: () => unavailableStorePool,
    async resolveTenantGptOAuthCredential(credential) {
      if (credential?.id_token === "identity-outage") {
        const error = new Error("sensitive identity database detail");
        error.code = "ER_BAD_FIELD_ERROR";
        error.errno = 1054;
        throw error;
      }
      return {
        user_id: "user-1",
        email: "user@example.com",
        tenant_id: "tenant-1",
        memberships: [{ tenant_id: "tenant-1", role: "owner", status: "active" }],
      };
    },
  }));
  const unavailableStoreServer = await startServer(unavailableStoreApp);
  const infrastructureLogs = [];
  const originalConsoleError = console.error;
  console.error = (...args) => infrastructureLogs.push(args);
  try {
    const unavailableCodeResult = await postJson(unavailableStoreServer.baseUrl, "/auth/oauth/code", {
      credential: { kind: "google", id_token: "verified-google-id-token" },
      redirect_uri: redirectUri,
      state: "unavailable-store-state",
      scope: TENANT_SCOPE,
    });
    assert("code-store outages return a retryable service response", unavailableCodeResult.status === 503, JSON.stringify(unavailableCodeResult.body));
    assert("code-store outages are not mislabeled as identity failures", unavailableCodeResult.body.error?.code === "oauth_code_store_unavailable", JSON.stringify(unavailableCodeResult.body));
    assert("code-store outage response includes a correlation reference", unavailableCodeResult.headers.get("x-request-id") === unavailableCodeResult.body.error?.request_id, JSON.stringify(unavailableCodeResult.body));
    assert("code-store diagnostics identify the failed stage", infrastructureLogs[0]?.[1]?.stage === "authorization_code_store", JSON.stringify(infrastructureLogs));
    assert("code-store diagnostics exclude raw database messages", !JSON.stringify(infrastructureLogs).includes("sensitive database connection detail"), JSON.stringify(infrastructureLogs));
    assert("code-store diagnostics mark secrets excluded", infrastructureLogs[0]?.[1]?.secrets_included === false, JSON.stringify(infrastructureLogs));

    const unavailableIdentityResult = await postJson(unavailableStoreServer.baseUrl, "/auth/oauth/code", {
      credential: { kind: "google", id_token: "identity-outage" },
      redirect_uri: redirectUri,
      state: "unavailable-identity-state",
      scope: TENANT_SCOPE,
    });
    const identityDiagnostic = infrastructureLogs.find((entry) => entry?.[1]?.stage === "identity_resolution");
    assert("identity infrastructure outages return a retryable service response", unavailableIdentityResult.status === 503, JSON.stringify(unavailableIdentityResult.body));
    assert("identity infrastructure outages are classified separately", unavailableIdentityResult.body.error?.code === "oauth_identity_unavailable", JSON.stringify(unavailableIdentityResult.body));
    assert("identity outage response includes a correlation reference", unavailableIdentityResult.headers.get("x-request-id") === unavailableIdentityResult.body.error?.request_id, JSON.stringify(unavailableIdentityResult.body));
    assert("identity diagnostics identify the failed stage", identityDiagnostic?.[1]?.error_code === "ER_BAD_FIELD_ERROR", JSON.stringify(infrastructureLogs));
    assert("identity diagnostics exclude raw database messages", !JSON.stringify(infrastructureLogs).includes("sensitive identity database detail"), JSON.stringify(infrastructureLogs));
  } finally {
    console.error = originalConsoleError;
    await new Promise((resolve) => unavailableStoreServer.server.close(resolve));
  }

  let unavailableConfigResolverCalled = false;
  const unavailableConfigPool = {
    async query(sql) {
      if (sql.includes("FROM `platform_runtime_config`")) {
        const error = new Error("sensitive OAuth configuration database detail");
        error.code = "ECONNREFUSED";
        error.errno = 111;
        throw error;
      }
      throw new Error(`Unexpected unavailable-config query: ${sql}`);
    },
  };
  const unavailableConfigApp = express();
  unavailableConfigApp.use(express.json());
  unavailableConfigApp.use("/auth", buildAuthRoutes({
    getPool: () => unavailableConfigPool,
    async resolveTenantGptOAuthCredential() {
      unavailableConfigResolverCalled = true;
      return { user_id: "must-not-resolve" };
    },
  }));
  const unavailableConfigServer = await startServer(unavailableConfigApp);
  const configurationLogs = [];
  const originalConfigurationConsoleError = console.error;
  console.error = (...args) => configurationLogs.push(args);
  try {
    const unavailableConfigResult = await postJson(unavailableConfigServer.baseUrl, "/auth/oauth/code", {
      credential: { kind: "google", id_token: "verified-google-id-token" },
      redirect_uri: redirectUri,
      state: "unavailable-config-state",
      scope: TENANT_SCOPE,
    });
    assert("OAuth configuration outages return a retryable service response", unavailableConfigResult.status === 503, JSON.stringify(unavailableConfigResult.body));
    assert("OAuth configuration outages are not mislabeled as redirect mismatches", unavailableConfigResult.body.error?.code === "oauth_configuration_unavailable", JSON.stringify(unavailableConfigResult.body));
    assert("OAuth configuration outage response includes a correlation reference", unavailableConfigResult.headers.get("x-request-id") === unavailableConfigResult.body.error?.request_id, JSON.stringify(unavailableConfigResult.body));
    assert("OAuth configuration failure stops before identity resolution", unavailableConfigResolverCalled === false, String(unavailableConfigResolverCalled));
    const configurationDiagnostic = configurationLogs.find((entry) => entry?.[1]?.stage === "oauth_client_config");
    assert("OAuth configuration diagnostics identify the failed stage", Boolean(configurationDiagnostic), JSON.stringify(configurationLogs));
    assert("OAuth configuration diagnostics exclude raw database messages", !JSON.stringify(configurationLogs).includes("sensitive OAuth configuration database detail"), JSON.stringify(configurationLogs));

    const unavailableAuthorizeResult = await getText(
      unavailableConfigServer.baseUrl,
      `/auth/oauth/authorize?client_id=mad4b-tenant-gpt&response_type=code&redirect_uri=${encodedRedirect}&state=unavailable-config-authorize-state`,
    );
    assert("authorize returns 503 when OAuth configuration is unavailable", unavailableAuthorizeResult.status === 503, `${unavailableAuthorizeResult.status}`);
    assert("authorize reports a retryable configuration outage", unavailableAuthorizeResult.text.includes("temporarily unavailable"), unavailableAuthorizeResult.text);
  } finally {
    console.error = originalConfigurationConsoleError;
    await new Promise((resolve) => unavailableConfigServer.server.close(resolve));
  }

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
  const decodedAuthorizationCode = jwt.decode(codeResult.body.code);
  assert("authorization code stores canonical ChatGPT callback", decodedAuthorizationCode?.redirect_uri === canonicalRedirectUri, JSON.stringify(decodedAuthorizationCode));
  assert("authorization code binds the registered OAuth client", decodedAuthorizationCode?.client_id === "mad4b-tenant-gpt", JSON.stringify(decodedAuthorizationCode));
  assert("authorization code binds the Activation protected resource", decodedAuthorizationCode?.resource === ACTIVATION_RESOURCE, JSON.stringify(decodedAuthorizationCode));
  assert("code response reports the Activation protected resource", codeResult.body.resource === ACTIVATION_RESOURCE, JSON.stringify(codeResult.body));
  assert("code response redirects legacy callback directly to canonical ChatGPT host", String(codeResult.body.redirect_to || "").startsWith(canonicalRedirectUri), codeResult.body.redirect_to);
  assert("code response does not redirect through legacy ChatGPT host", !String(codeResult.body.redirect_to || "").startsWith(redirectUri), codeResult.body.redirect_to);
  assert("code response preserves activation mode", codeResult.body.activation_context?.activation_mode === "dedicated", JSON.stringify(codeResult.body.activation_context));
  assert("code response preserves sign-in options", Array.isArray(codeResult.body.activation_context?.sign_in_options) && codeResult.body.activation_context.sign_in_options.includes("email"), JSON.stringify(codeResult.body.activation_context));

  const credentialCodeResult = await postJson(baseUrl, "/auth/oauth/code", {
    credential: { kind: "login", email: "user@example.com", password: "not-logged" },
    redirect_uri: redirectUri,
    state: "credential-state",
    scope: TENANT_SCOPE,
    activation_context: activationContext,
  }, { headers: { "x-forwarded-host": "activation.mad4b.com" } });
  assert("activation host routes popup credentials into shared OAuth code logic", credentialCodeResult.status === 200, `${credentialCodeResult.status}`);
  assert("credential code preserves OAuth state", String(credentialCodeResult.body.redirect_to || "").includes("state=credential-state"), credentialCodeResult.body.redirect_to);
  assert("credential resolver receives the selected popup mode", oauthCredentialRequests[0]?.kind === "login", JSON.stringify(oauthCredentialRequests));

  const invalidClient = await postForm(baseUrl, "/auth/oauth/token", {
    grant_type: "authorization_code",
    code: codeResult.body.code,
    redirect_uri: redirectUri,
    client_id: "mad4b-tenant-gpt",
    client_secret: "wrong-secret",
  }, { headers: { "x-forwarded-host": "activation.mad4b.com" } });
  assert("token endpoint rejects wrong OAuth client secret", invalidClient.status === 401, `${invalidClient.status}`);
  assert("wrong OAuth client secret reports invalid_client", invalidClient.body.error === "invalid_client", JSON.stringify(invalidClient.body));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const invalidClientDiagnostic = oauthTokenDiagnostics.find((row) => row.failure_reason === "invalid_client");
  assert("invalid client token exchange writes diagnostic", Boolean(invalidClientDiagnostic), JSON.stringify(oauthTokenDiagnostics));
  assert("invalid client diagnostic uses OAuth v2 action key", invalidClientDiagnostic?.action_key === "tenant_gpt_oauth_token_exchange_v2", JSON.stringify(invalidClientDiagnostic));
  assert("invalid client diagnostic marks secret presence only", invalidClientDiagnostic?.runtime_evidence_json?.client?.client_secret_present === true, JSON.stringify(invalidClientDiagnostic));
  assert("invalid client diagnostic captures bounded code expiry", Number.isFinite(invalidClientDiagnostic?.runtime_evidence_json?.code?.expires_in_seconds) && invalidClientDiagnostic.runtime_evidence_json.code.expires_in_seconds > 0 && invalidClientDiagnostic.runtime_evidence_json.code.expires_in_seconds <= 300, JSON.stringify(invalidClientDiagnostic));
  assert("invalid client diagnostic captures code age", Number.isFinite(invalidClientDiagnostic?.runtime_evidence_json?.code?.age_seconds), JSON.stringify(invalidClientDiagnostic));
  assert("invalid client diagnostic excludes raw secret", !JSON.stringify(invalidClientDiagnostic || {}).includes("wrong-secret"), JSON.stringify(invalidClientDiagnostic));

  const wrongTarget = await postForm(baseUrl, "/auth/oauth/token", {
    grant_type: "authorization_code",
    code: codeResult.body.code,
    redirect_uri: redirectUri,
    client_id: "mad4b-tenant-gpt",
    client_secret: "test-client-secret",
    resource: AUTH_RESOURCE,
  }, { headers: { "x-forwarded-host": "activation.mad4b.com" } });
  assert("token endpoint rejects a resource that does not match the Activation host", wrongTarget.status === 400, `${wrongTarget.status}`);
  assert("resource mismatch reports invalid_target", wrongTarget.body.error === "invalid_target", JSON.stringify(wrongTarget.body));

  const exchange = await postForm(baseUrl, "/auth/oauth/token", {
    grant_type: "authorization_code",
    code: codeResult.body.code,
    redirect_uri: redirectUri,
    client_id: "mad4b-tenant-gpt",
    client_secret: "test-client-secret",
  }, { headers: { "x-forwarded-host": "activation.mad4b.com" } });
  assert("token endpoint exchanges authorization code", exchange.status === 200, `${exchange.status}`);
  assert("token endpoint accepts legacy callback as equivalent to canonical code callback", exchange.status === 200, JSON.stringify(exchange.body));
  assert("token endpoint returns lowercase bearer token type", exchange.body.token_type === "bearer", JSON.stringify(exchange.body));
  assert("token endpoint mints a fresh access JWT", exchange.body.access_token !== userToken && typeof exchange.body.access_token === "string", JSON.stringify(exchange.body));
  assert("token endpoint returns standard OAuth scope", exchange.body.scope === TENANT_SCOPE, JSON.stringify(exchange.body));
  assert("token endpoint excludes non-standard activation context", !Object.prototype.hasOwnProperty.call(exchange.body, "activation_context"), JSON.stringify(exchange.body));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const successDiagnostic = oauthTokenDiagnostics.find((row) => row.execution_status === "success");
  assert("success token exchange writes diagnostic", Boolean(successDiagnostic), JSON.stringify(oauthTokenDiagnostics));
  assert("success diagnostic records committed response phase", successDiagnostic?.runtime_evidence_json?.classification === "token_response_committed" && successDiagnostic?.runtime_evidence_json?.phase === "response_committed", JSON.stringify(successDiagnostic));
  assert("success diagnostic records token preparation without token material", successDiagnostic?.runtime_evidence_json?.access_token_prepared === true && !Object.prototype.hasOwnProperty.call(successDiagnostic?.runtime_evidence_json || {}, "access_token"), JSON.stringify(successDiagnostic));
  assert("success diagnostic captures activation context storage only", successDiagnostic?.runtime_evidence_json?.activation_context?.stored === true, JSON.stringify(successDiagnostic));
  assert("success diagnostic records consumed authorization code", successDiagnostic?.runtime_evidence_json?.code_consumption?.consumed === true, JSON.stringify(successDiagnostic));
  assert("success diagnostic excludes raw access token", !JSON.stringify(successDiagnostic || {}).includes(exchange.body.access_token), JSON.stringify(successDiagnostic));
  assert("token exchange stores activation context server-side", tenantGptActivationContexts.length === 1, JSON.stringify(tenantGptActivationContexts));
  const storedActivationContext = JSON.parse(tenantGptActivationContexts[0].activation_context_json);
  assert("stored activation context preserves activation mode", storedActivationContext.activation_mode === "dedicated", JSON.stringify(storedActivationContext));
  assert("stored activation context preserves workspace name", storedActivationContext.workspace_name === "Tenant Workspace", JSON.stringify(storedActivationContext));
  assert("stored activation context marks secrets excluded", storedActivationContext.secrets_included === false, JSON.stringify(storedActivationContext));
  const accessPayload = jwt.verify(exchange.body.access_token, process.env.JWT_SECRET);
  assert("access JWT has platform issuer", accessPayload.iss === "https://auth.mad4b.com", JSON.stringify(accessPayload));
  assert("access JWT has the Activation audience", accessPayload.aud === ACTIVATION_RESOURCE, JSON.stringify(accessPayload));
  assert("access JWT carries the Activation resource claim", accessPayload.resource === ACTIVATION_RESOURCE, JSON.stringify(accessPayload));
  assert("access JWT carries the authorized OAuth client", accessPayload.azp === "mad4b-tenant-gpt", JSON.stringify(accessPayload));

  const missingBearerProbe = await getText(baseUrl, "/tenant/activation/probe");
  assert("Activation gateway rejects a missing bearer token", missingBearerProbe.status === 401, `${missingBearerProbe.status}`);

  const wrongAudienceToken = jwt.sign({
    iss: "https://auth.mad4b.com",
    aud: AUTH_RESOURCE,
    resource: AUTH_RESOURCE,
    purpose: "tenant_gpt_access",
    user_id: "user-1",
    tenant_id: "tenant-1",
  }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const wrongAudienceProbe = await getText(baseUrl, "/tenant/activation/probe", {
    headers: { authorization: `Bearer ${wrongAudienceToken}` },
  });
  assert("Activation gateway rejects a token for the Auth resource", wrongAudienceProbe.status === 401, `${wrongAudienceProbe.status}`);

  const validProbe = await getText(baseUrl, "/tenant/activation/probe", {
    headers: { authorization: `Bearer ${exchange.body.access_token}` },
  });
  const validProbeBody = JSON.parse(validProbe.text);
  assert("Activation gateway accepts the Activation-bound token", validProbe.status === 200, `${validProbe.status}`);
  assert("Activation gateway exposes the verified token resource", validProbeBody.auth?.token_resource === ACTIVATION_RESOURCE, JSON.stringify(validProbeBody));
  assert("access JWT has tenant subject", accessPayload.sub === "tenant:tenant-1:user:user-1", JSON.stringify(accessPayload));
  assert("stored activation context is linked to access JWT jti", tenantGptActivationContexts[0].access_jti === accessPayload.jti, JSON.stringify({ stored: tenantGptActivationContexts[0].access_jti, token: accessPayload.jti }));
  assert("access JWT carries linked tenant scopes", accessPayload.scope === TENANT_SCOPE, JSON.stringify(accessPayload));
  assert("OAuth access JWT omits duplicated scope links", accessPayload.scope_links === undefined, JSON.stringify(accessPayload));
  assert("OAuth access JWT identifies the authorized client", accessPayload.client_id === "mad4b-tenant-gpt", JSON.stringify(accessPayload));
  assert("OAuth access JWT stays compact", exchange.body.access_token.length < 1000, String(exchange.body.access_token.length));
  assert("access JWT carries tenant GPT purpose", accessPayload.purpose === "tenant_gpt_access", JSON.stringify(accessPayload));

  const replay = await postForm(baseUrl, "/auth/oauth/token", {
    grant_type: "authorization_code",
    code: codeResult.body.code,
    redirect_uri: redirectUri,
    client_id: "mad4b-tenant-gpt",
    client_secret: "test-client-secret",
  }, { headers: { "x-forwarded-host": "activation.mad4b.com" } });
  assert("token endpoint rejects authorization code replay", replay.status === 400, `${replay.status}`);
  assert("authorization code replay reports invalid_grant", replay.body.error === "invalid_grant", JSON.stringify(replay.body));

  const mismatch = await postForm(baseUrl, "/auth/oauth/token", {
    grant_type: "authorization_code",
    code: codeResult.body.code,
    redirect_uri: "https://chatgpt.com/aip/other/oauth/callback",
    client_id: "mad4b-tenant-gpt",
    client_secret: "test-client-secret",
  });
  assert("token endpoint rejects redirect mismatch", mismatch.status === 400, `${mismatch.status}`);
  assert("redirect mismatch reports invalid_grant", mismatch.body.error === "invalid_grant", JSON.stringify(mismatch.body));

  for (const path of ["/auth/login", "/auth/register", "/auth/google", "/auth/platform-jwt/issue", "/auth/oauth/revoke"]) {
    const blocked = await postJson(baseUrl, path, {}, { headers: { "x-forwarded-host": "activation.mad4b.com" } });
    assert(`activation host blocks unrelated auth route ${path}`, blocked.status === 404, `${blocked.status}`);
    assert(`activation host returns explicit boundary error for ${path}`, blocked.body.error?.code === "ACTIVATION_HOST_ROUTE_NOT_ALLOWED", JSON.stringify(blocked.body));
  }

  {
    const blocked = await postJson(baseUrl, "/auth/login", {}, {
      headers: { "x-original-host": "activation.mad4b.com", "x-forwarded-host": "auth.mad4b.com" },
    });
    assert("activation host evidence cannot be bypassed by spoofing auth forwarded host", blocked.status === 404, `${blocked.status}`);
    assert("spoofed forwarded host still returns the activation boundary error", blocked.body.error?.code === "ACTIVATION_HOST_ROUTE_NOT_ALLOWED", JSON.stringify(blocked.body));
  }

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
    assert("platform JWT token carries the Core protected-resource audience", issuedPayload.aud === AUTH_RESOURCE, JSON.stringify(issuedPayload));
    assert("platform JWT token carries the Core resource claim", issuedPayload.resource === AUTH_RESOURCE, JSON.stringify(issuedPayload));
    assert("platform JWT token carries the authorized OAuth client", issuedPayload.azp === "mad4b-tenant-gpt", JSON.stringify(issuedPayload));
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
