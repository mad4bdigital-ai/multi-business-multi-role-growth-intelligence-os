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
  }

  async findSessionByBrokerStateHash(hash) {
    for (const row of this.sessions.values()) {
      if (row.broker_state_hash === hash) return { ...row };
    }
    return null;
  }

  async markDenied({ session_id, reason, now }) {
    const row = this.sessions.get(session_id);
    if (!row || row.status !== "pending") return false;
    Object.assign(row, { status: "denied", denied_reason: reason, denied_at: now, updated_at: now });
    return true;
  }

  async authorizeSession({ session_id, handoff_hash, token_envelope, token_expires_in, handoff_expires_at, now }) {
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
    return snapshot;
  }
}

const SITE_UUID = "d745d81f-6fc4-5c6a-99dd-d953c92137bf";
const ORIGIN = "https://staging.egypttourgates.com";
const CALLBACK = "https://staging.egypttourgates.com/wp-admin/admin-post.php?action=mad4b_context_google_managed_callback";
const env = {
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
  assert.equal(url, "https://oauth2.googleapis.com/token");
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

console.log("managed Google OAuth broker tests passed");
