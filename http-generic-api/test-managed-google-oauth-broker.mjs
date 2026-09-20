import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  GOOGLE_DRIVE_READ_SCOPE,
  GOOGLE_DRIVE_WRITE_SCOPE,
  MANAGED_GOOGLE_REDEMPTION_CONTRACT,
  MANAGED_GOOGLE_REFRESH_CONTRACT,
  MANAGED_GOOGLE_REFRESH_REQUEST_CONTRACT,
  MANAGED_GOOGLE_REDEEM_REQUEST_CONTRACT,
  MANAGED_GOOGLE_SESSION_CONTRACT,
  createManagedGoogleOAuthBroker,
  openManagedGoogleEnvelope,
  sealManagedGoogleEnvelope,
} from "./managedGoogleOAuthBroker.js";
import { GOOGLE_TOKEN_ENDPOINT } from "./managedGoogleOAuthProtocolPolicy.js";

function testError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function sha256Hex(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function sha256Base64url(value) {
  return createHash("sha256").update(String(value), "utf8").digest("base64url");
}

class MemoryStore {
  constructor() {
    this.sessions = new Map();
    this.audit = [];
  }

  async countRecentEvents(siteUuid, event, windowSeconds, nowDate) {
    const threshold = nowDate.getTime() - windowSeconds * 1000;
    return this.audit.filter((row) =>
      row.site_uuid === siteUuid &&
      row.event === event &&
      new Date(row.now).getTime() >= threshold
    ).length;
  }

  async appendAudit(row) {
    this.audit.push({ ...row });
  }

  async createSession(record) {
    this.sessions.set(record.session_id, { ...record, status: "pending" });
    this.audit.push({
      event: "session_create",
      site_uuid: record.site_uuid,
      session_id: record.session_id,
      outcome: "success",
      origin: record.origin,
      metadata: record.audit_metadata || null,
      now: record.created_at,
    });
  }

  async findSessionByBrokerStateHash(hash) {
    for (const row of this.sessions.values()) {
      if (row.broker_state_hash === hash) return { ...row };
    }
    return null;
  }

  async markDenied({ session_id, site_uuid, origin, reason, now }) {
    const row = this.sessions.get(session_id);
    if (!row || row.status !== "pending") return false;
    Object.assign(row, { status: "denied", denied_reason: reason, denied_at: now, updated_at: now });
    this.audit.push({ event: "google_callback", site_uuid, session_id, outcome: "denied", reason, origin, now });
    return true;
  }

  async authorizeSession({ session_id, site_uuid, origin, handoff_hash, token_envelope, token_expires_in, handoff_expires_at, scope_sha256_prefix, now }) {
    const row = this.sessions.get(session_id);
    if (!row || row.status !== "pending" || new Date(row.expires_at).getTime() <= now.getTime()) return false;
    Object.assign(row, {
      status: "authorized",
      handoff_hash,
      token_envelope,
      token_expires_in,
      handoff_expires_at,
      authorized_at: now,
      updated_at: now,
    });
    this.audit.push({
      event: "google_callback",
      site_uuid,
      session_id,
      outcome: "authorized",
      origin,
      metadata: { scope_sha256_prefix },
      now,
    });
    return true;
  }

  async consumeAuthorizedSession({
    session_id,
    handoff_hash,
    site_uuid,
    origin,
    callback_uri,
    verifier_challenge,
    now,
  }) {
    const row = this.sessions.get(session_id);
    if (!row) throw testError(404, "managed_google_oauth_session_not_found", "not found");
    if (row.status !== "authorized") {
      throw testError(409, row.status === "redeemed" ? "managed_google_oauth_handoff_replayed" : "managed_google_oauth_session_not_redeemable", "not redeemable");
    }
    if (new Date(row.handoff_expires_at).getTime() <= now.getTime()) {
      throw testError(410, "managed_google_oauth_handoff_expired", "expired");
    }
    if (row.handoff_hash !== handoff_hash) throw testError(403, "managed_google_oauth_handoff_invalid", "bad handoff");
    if (row.site_uuid !== site_uuid || row.origin !== origin || row.callback_uri !== callback_uri) {
      throw testError(403, "managed_google_oauth_binding_mismatch", "binding mismatch");
    }
    if (row.verifier_challenge !== verifier_challenge) throw testError(403, "managed_google_oauth_verifier_mismatch", "verifier mismatch");
    const snapshot = { ...row };
    Object.assign(row, { status: "redeemed", token_envelope: null, redeemed_at: now, updated_at: now });
    this.audit.push({ event: "redeem", site_uuid: row.site_uuid, session_id, outcome: "success", origin: row.origin, now });
    return snapshot;
  }
}

const SITE_UUID = "d745d81f-6fc4-5c6a-99dd-d953c92137bf";
const ORIGIN = "https://staging.egypttourgates.com";
const CALLBACK = "https://staging.egypttourgates.com/wp-admin/admin-post.php?action=mad4b_context_google_managed_callback";
const env = {
  MANAGED_GOOGLE_OAUTH_ENABLED: "true",
  MANAGED_GOOGLE_OAUTH_CLIENT_ID: "broker-google-client.apps.googleusercontent.com",
  MANAGED_GOOGLE_OAUTH_CLIENT_SECRET: "broker-google-client-secret-fixture",
  MANAGED_GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY: "managed-google-oauth-envelope-key-fixture-0123456789abcdef",
  MANAGED_GOOGLE_OAUTH_REDIRECT_URI: "https://auth.mad4b.com/v1/google/oauth/callback",
  MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON: JSON.stringify([
    {
      site_uuid: SITE_UUID,
      origin: ORIGIN,
      callback_uri: CALLBACK,
      environment: "staging",
      status: "active",
    },
  ]),
};

let nowValue = new Date("2026-09-20T12:00:00.000Z");
const now = () => new Date(nowValue);
const store = new MemoryStore();
const googleRequests = [];
const fetchImpl = async (url, options = {}) => {
  assert.equal(url, GOOGLE_TOKEN_ENDPOINT);
  const body = new URLSearchParams(String(options.body || ""));
  googleRequests.push(Object.fromEntries(body.entries()));
  if (body.get("grant_type") === "authorization_code") {
    assert.equal(body.get("client_id"), env.MANAGED_GOOGLE_OAUTH_CLIENT_ID);
    assert.equal(body.get("client_secret"), env.MANAGED_GOOGLE_OAUTH_CLIENT_SECRET);
    assert.equal(body.get("redirect_uri"), env.MANAGED_GOOGLE_OAUTH_REDIRECT_URI);
    assert.equal(body.get("code"), "google-auth-code-fixture");
    return new Response(JSON.stringify({
      access_token: "google-access-token-fixture",
      refresh_token: "google-refresh-token-fixture",
      expires_in: 3600,
      scope: GOOGLE_DRIVE_READ_SCOPE,
      token_type: "Bearer",
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (body.get("grant_type") === "refresh_token") {
    assert.equal(body.get("client_secret"), env.MANAGED_GOOGLE_OAUTH_CLIENT_SECRET);
    assert.equal(body.get("refresh_token"), "google-refresh-token-fixture");
    return new Response(JSON.stringify({
      access_token: "google-access-token-refreshed",
      expires_in: 3600,
      scope: GOOGLE_DRIVE_READ_SCOPE,
      token_type: "Bearer",
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ error: "unsupported_grant_type" }), { status: 400 });
};

const broker = createManagedGoogleOAuthBroker({ env, store, fetchImpl, now });
const verifier = "managed-google-site-verifier-fixture-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const challenge = sha256Base64url(verifier);
const clientState = "wordpress-state-fixture-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const session = await broker.createSession({
  contract: MANAGED_GOOGLE_SESSION_CONTRACT,
  site_uuid: SITE_UUID,
  origin: ORIGIN,
  callback_uri: CALLBACK,
  access_mode: "read_only",
  requested_scope: GOOGLE_DRIVE_READ_SCOPE,
  state: clientState,
  verifier_challenge: challenge,
  verifier_method: "S256",
});
assert.equal(session.contract, MANAGED_GOOGLE_SESSION_CONTRACT);
assert.ok(session.session_id);
const authUrl = new URL(session.authorization_url);
assert.equal(authUrl.origin, "https://accounts.google.com");
assert.equal(authUrl.pathname, "/o/oauth2/v2/auth");
assert.equal(authUrl.searchParams.get("client_id"), env.MANAGED_GOOGLE_OAUTH_CLIENT_ID);
assert.equal(authUrl.searchParams.get("redirect_uri"), env.MANAGED_GOOGLE_OAUTH_REDIRECT_URI);
assert.equal(authUrl.searchParams.get("scope"), GOOGLE_DRIVE_READ_SCOPE);
assert.equal(authUrl.searchParams.get("access_type"), "offline");
assert.equal(authUrl.searchParams.get("prompt"), "consent");
const brokerState = authUrl.searchParams.get("state");
assert.ok(brokerState && brokerState !== clientState);

const storedSession = store.sessions.get(session.session_id);
assert.equal(storedSession.site_uuid, SITE_UUID);
assert.equal(storedSession.origin, ORIGIN);
assert.equal(storedSession.callback_uri, CALLBACK);
assert.equal(storedSession.verifier_challenge, challenge);
assert.equal(storedSession.broker_state_hash, sha256Hex(brokerState));
assert.equal(storedSession.client_state_envelope.includes(clientState), false);
assert.equal(openManagedGoogleEnvelope(storedSession.client_state_envelope, env.MANAGED_GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY).state, clientState);

const callback = await broker.handleGoogleCallback({
  code: "google-auth-code-fixture",
  state: brokerState,
});
const wordpressRedirect = new URL(callback.redirect_url);
assert.equal(`${wordpressRedirect.origin}${wordpressRedirect.pathname}`, "https://staging.egypttourgates.com/wp-admin/admin-post.php");
assert.equal(wordpressRedirect.searchParams.get("action"), "mad4b_context_google_managed_callback");
assert.equal(wordpressRedirect.searchParams.get("state"), clientState);
const handoffCode = wordpressRedirect.searchParams.get("handoff_code");
assert.ok(handoffCode);
assert.equal(callback.redirect_url.includes("google-access-token-fixture"), false);
assert.equal(callback.redirect_url.includes("google-refresh-token-fixture"), false);
assert.equal(callback.redirect_url.includes(env.MANAGED_GOOGLE_OAUTH_CLIENT_SECRET), false);

const authorizedSession = store.sessions.get(session.session_id);
assert.equal(authorizedSession.status, "authorized");
assert.ok(authorizedSession.token_envelope);
assert.equal(authorizedSession.token_envelope.includes("google-access-token-fixture"), false);
assert.equal(authorizedSession.token_envelope.includes("google-refresh-token-fixture"), false);

await assert.rejects(
  () => broker.redeem({
    contract: MANAGED_GOOGLE_REDEEM_REQUEST_CONTRACT,
    handoff_code: handoffCode,
    session_id: session.session_id,
    verifier: `${verifier}-wrong`,
    site_uuid: SITE_UUID,
    origin: ORIGIN,
    callback_uri: CALLBACK,
  }),
  (error) => error?.code === "managed_google_oauth_verifier_mismatch"
);
assert.equal(store.sessions.get(session.session_id).status, "authorized", "Verifier mismatch must not consume the handoff.");

const redemption = await broker.redeem({
  contract: MANAGED_GOOGLE_REDEEM_REQUEST_CONTRACT,
  handoff_code: handoffCode,
  session_id: session.session_id,
  verifier,
  site_uuid: SITE_UUID,
  origin: ORIGIN,
  callback_uri: CALLBACK,
});
assert.equal(redemption.contract, MANAGED_GOOGLE_REDEMPTION_CONTRACT);
assert.equal(redemption.access_token, "google-access-token-fixture");
assert.equal(redemption.refresh_token, "google-refresh-token-fixture");
assert.equal(redemption.scope, GOOGLE_DRIVE_READ_SCOPE);
assert.equal(store.sessions.get(session.session_id).status, "redeemed");
assert.equal(store.sessions.get(session.session_id).token_envelope, null, "Token envelope must be erased on successful handoff consumption.");
assert.ok(store.audit.some((row) => row.event === "session_create" && row.session_id === session.session_id && row.outcome === "success"));
assert.ok(store.audit.some((row) => row.event === "google_callback" && row.session_id === session.session_id && row.outcome === "authorized"));
assert.ok(store.audit.some((row) => row.event === "redeem" && row.session_id === session.session_id && row.outcome === "success"));

await assert.rejects(
  () => broker.redeem({
    contract: MANAGED_GOOGLE_REDEEM_REQUEST_CONTRACT,
    handoff_code: handoffCode,
    session_id: session.session_id,
    verifier,
    site_uuid: SITE_UUID,
    origin: ORIGIN,
    callback_uri: CALLBACK,
  }),
  (error) => error?.code === "managed_google_oauth_handoff_replayed"
);

const refreshed = await broker.refresh({
  contract: MANAGED_GOOGLE_REFRESH_REQUEST_CONTRACT,
  site_uuid: SITE_UUID,
  origin: ORIGIN,
  refresh_token: "google-refresh-token-fixture",
  requested_scope: GOOGLE_DRIVE_READ_SCOPE,
  access_mode: "read_only",
});
assert.equal(refreshed.contract, MANAGED_GOOGLE_REFRESH_CONTRACT);
assert.equal(refreshed.access_token, "google-access-token-refreshed");
assert.equal(refreshed.scope, GOOGLE_DRIVE_READ_SCOPE);
assert.equal(googleRequests.length, 2);

await assert.rejects(
  () => broker.refresh({
    contract: MANAGED_GOOGLE_REFRESH_REQUEST_CONTRACT,
    site_uuid: SITE_UUID,
    origin: ORIGIN,
    refresh_token: "google-refresh-token-fixture",
    requested_scope: GOOGLE_DRIVE_WRITE_SCOPE,
    access_mode: "read_only",
  }),
  (error) => error?.code === "managed_google_oauth_scope_contract_invalid"
);

await assert.rejects(
  () => broker.createSession({
    contract: MANAGED_GOOGLE_SESSION_CONTRACT,
    site_uuid: SITE_UUID,
    origin: "https://attacker.example",
    callback_uri: "https://attacker.example/wp-admin/admin-post.php?action=mad4b_context_google_managed_callback",
    access_mode: "read_only",
    requested_scope: GOOGLE_DRIVE_READ_SCOPE,
    state: clientState,
    verifier_challenge: challenge,
    verifier_method: "S256",
  }),
  (error) => error?.code === "managed_google_oauth_site_binding_not_allowed"
);

const deniedSession = await broker.createSession({
  contract: MANAGED_GOOGLE_SESSION_CONTRACT,
  site_uuid: SITE_UUID,
  origin: ORIGIN,
  callback_uri: CALLBACK,
  access_mode: "read_only",
  requested_scope: GOOGLE_DRIVE_READ_SCOPE,
  state: `${clientState}-denied`,
  verifier_challenge: challenge,
  verifier_method: "S256",
});
const deniedAuth = new URL(deniedSession.authorization_url);
const deniedCallback = await broker.handleGoogleCallback({
  error: "access_denied",
  state: deniedAuth.searchParams.get("state"),
});
const deniedRedirect = new URL(deniedCallback.redirect_url);
assert.equal(deniedRedirect.searchParams.get("error"), "access_denied");
assert.equal(deniedRedirect.searchParams.get("state"), `${clientState}-denied`);
assert.equal(store.sessions.get(deniedSession.session_id).status, "denied");

const sealed = sealManagedGoogleEnvelope({ access_token: "secret-token" }, env.MANAGED_GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY);
assert.equal(sealed.includes("secret-token"), false);
assert.equal(openManagedGoogleEnvelope(sealed, env.MANAGED_GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY).access_token, "secret-token");

const routes = readFileSync("./routes/managedGoogleOAuthRoutes.js", "utf8");
const protocolPolicy = readFileSync("./managedGoogleOAuthProtocolPolicy.js", "utf8");
const openapi = readFileSync("./openapi.yaml", "utf8");
const frontendPolicy = JSON.parse(readFileSync("./frontend-surface-policy.json", "utf8"));
const customGptSurfaceRegistry = readFileSync("../canonicals/openapi/custom-gpt-surfaces.yaml", "utf8");
const configRegistry = JSON.parse(readFileSync("../docs/governance/platform-configuration-entry-registry.json", "utf8"));
const driftPolicy = JSON.parse(readFileSync("../docs/governance/configuration-drift-policy.json", "utf8"));
const routeIndex = readFileSync("./routes/index.js", "utf8");
const migration = readFileSync("./migrations/20260920_managed_google_oauth_broker_v1.sql", "utf8");
for (const path of [
  "/v1/google/oauth/session",
  "/v1/google/oauth/callback",
  "/v1/google/oauth/redeem",
  "/v1/google/oauth/refresh",
]) {
  assert.ok(routes.includes(path), `broker route missing: ${path}`);
}
assert.ok(routeIndex.includes('buildManagedGoogleOAuthRoutes'), "route index must mount managed Google OAuth broker");
assert.ok(migration.includes("managed_google_oauth_sessions"), "migration must create session table");
assert.ok(migration.includes("managed_google_oauth_audit"), "migration must create audit table");
assert.ok(migration.includes("token_envelope"), "migration must store only encrypted token envelope");
assert.equal(migration.includes("access_token VARCHAR"), false, "migration must not create plaintext access-token column");
assert.equal(migration.includes("refresh_token VARCHAR"), false, "migration must not create plaintext refresh-token column");

assert.ok(protocolPolicy.includes("mad4b.provider-protocol-policy-registry.v1"), "Google OAuth protocol invariants must live in the provider protocol policy registry");
assert.ok(protocolPolicy.includes("provider_protocol_policy_registry"), "provider protocol policy registry marker missing");
assert.equal(/\bconst\s+GOOGLE_TOKEN_ENDPOINT\s*=/.test(readFileSync("./managedGoogleOAuthBroker.js", "utf8")), false, "broker core must not own provider protocol endpoint constants");

for (const operationId of [
  "createManagedGoogleOAuthSession",
  "completeManagedGoogleOAuthProviderCallback",
  "redeemManagedGoogleOAuthHandoff",
  "refreshManagedGoogleOAuthAccessToken",
]) {
  assert.ok(openapi.includes(`operationId: ${operationId}`), `canonical OpenAPI missing ${operationId}`);
}
assert.ok(openapi.includes("credential_material_included: { type: boolean, enum: [true] }"), "token-bearing OpenAPI responses must declare credential material accurately");
assert.equal(openapi.includes("pattern: '^[A-Za-z0-9_-]{43}    get:"), false, "managed OAuth OpenAPI verifier pattern must not be truncated");

const managedSurfaceRule = frontendPolicy.rules.find((rule) => rule.source_file === "routes/managedGoogleOAuthRoutes.js");
assert.ok(managedSurfaceRule, "managed Google OAuth route family must have a frontend surface policy decision");
assert.equal(managedSurfaceRule.scope, "public");
assert.equal(managedSurfaceRule.decision, "api_only");
assert.equal(managedSurfaceRule.family_key, "managed-google-oauth");
const managedAuthRule = frontendPolicy.auth_rules.find((rule) => rule.rule_id === "managed-google-oauth-public-auth");
assert.ok(managedAuthRule, "managed Google OAuth route family must have an explicit public auth policy");
assert.equal(managedAuthRule.profile, "public");
assert.equal(managedAuthRule.source_file, "routes/managedGoogleOAuthRoutes.js");
assert.deepEqual([...managedAuthRule.operations].sort(), [
  "GET /v1/google/oauth/callback",
  "POST /v1/google/oauth/redeem",
  "POST /v1/google/oauth/refresh",
  "POST /v1/google/oauth/session",
]);

for (const operationId of [
  "createManagedGoogleOAuthSession",
  "completeManagedGoogleOAuthProviderCallback",
  "redeemManagedGoogleOAuthHandoff",
  "refreshManagedGoogleOAuthAccessToken",
]) {
  assert.ok(
    customGptSurfaceRegistry.includes(`operation_id: ${operationId}`),
    `managed OAuth protocol operation must have an explicit Custom GPT/Remote MCP exclusion: ${operationId}`,
  );
}

const registeredKeys = new Set(configRegistry.entries.map((entry) => entry.config_key));
for (const key of [
  "session.ttl.seconds",
  "handoff.ttl.seconds",
  "max.session.ttl.seconds",
  "session.rate.limit.per.minute",
  "redeem.rate.limit.per.minute",
  "refresh.rate.limit.per.minute",
]) {
  assert.ok(registeredKeys.has(key), `managed Google OAuth runtime setting missing Config Catalog registration: ${key}`);
}
for (const fingerprint of [
  "http-generic-api/managedGoogleOAuthBroker.js|DEFAULT_SESSION_TTL_SECONDS|literal_declaration|session.ttl.seconds",
  "http-generic-api/managedGoogleOAuthBroker.js|DEFAULT_HANDOFF_TTL_SECONDS|literal_declaration|handoff.ttl.seconds",
  "http-generic-api/managedGoogleOAuthBroker.js|MAX_SESSION_TTL_SECONDS|literal_declaration|max.session.ttl.seconds",
  "http-generic-api/managedGoogleOAuthBroker.js|SESSION_RATE_LIMIT_PER_MINUTE|literal_declaration|session.rate.limit.per.minute",
  "http-generic-api/managedGoogleOAuthBroker.js|REDEEM_RATE_LIMIT_PER_MINUTE|literal_declaration|redeem.rate.limit.per.minute",
  "http-generic-api/managedGoogleOAuthBroker.js|REFRESH_RATE_LIMIT_PER_MINUTE|literal_declaration|refresh.rate.limit.per.minute",
]) {
  assert.ok(driftPolicy.baseline_fingerprints.includes(fingerprint), `managed Google OAuth canonical configuration baseline missing: ${fingerprint}`);
}

assert.ok(routes.includes("credential_material_included: true"), "redeem/refresh routes must identify token-bearing success responses");
assert.equal(routes.includes("access_token, secrets_included: false"), false, "token-bearing success response cannot claim secrets_included=false");

console.log("managed Google OAuth broker tests passed");
