// frontend-surface-operation: post /v1/google/oauth/session
// frontend-surface-operation: get /v1/google/oauth/callback
// frontend-surface-operation: post /v1/google/oauth/redeem
// frontend-surface-operation: post /v1/google/oauth/refresh

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { buildManagedGoogleOAuthRoutes } from "./routes/managedGoogleOAuthRoutes.js";
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
  parseManagedGoogleSiteBindings,
  sealManagedGoogleEnvelope,
} from "./managedGoogleOAuthBroker.js";
import { GOOGLE_TOKEN_ENDPOINT } from "./managedGoogleOAuthProtocolPolicy.js";
import {
  authenticateManagedGoogleSiteRequest,
  signManagedGoogleSiteRequest,
  managedGoogleRequestBodySha256,
  parseManagedGoogleSiteSecrets,
  MANAGED_GOOGLE_SITE_AUTH_CONTRACT,
} from "./managedGoogleOAuthSiteRequestAuth.js";

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

const CROSS_LANGUAGE_VECTOR = Object.freeze({
  secret: "site-broker-secret-fixture-0123456789abcdef",
  timestamp: "1760000000",
  nonce: "abcdefghijklmnopqrstuvwxYZ012345",
  path: "/v1/google/oauth/session",
  body: Object.freeze({
    requested_scope: "https://www.googleapis.com/auth/drive.readonly",
    origin: "https://staging.egypttourgates.com",
    contract: "mad4b.google-managed-oauth-session.v1",
    site_uuid: "d745d81f-6fc4-5c6a-99dd-d953c92137bf",
    callback_uri: "https://staging.egypttourgates.com/wp-admin/admin-post.php?action=mad4b_context_google_managed_callback",
    verifier_method: "S256",
    access_mode: "read_only",
    state: "state-fixture-abcdefghijklmnopqrstuvwxyz0123456789",
    verifier_challenge: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi_jklmnopqrstu-1234567890",
  }),
  body_sha256: "337c650bf992ce6108a3f8ee69c8ba04bec319f70de266027c4c372b9d6483f1",
  signature: "0cb44b37a06baa3d48050474bee31a1a519eef22651d8be7295c840066966e48",
});

assert.equal(
  managedGoogleRequestBodySha256(CROSS_LANGUAGE_VECTOR.body),
  CROSS_LANGUAGE_VECTOR.body_sha256,
  "Node canonical Managed Google request body hash drifted from the cross-language contract."
);
assert.equal(
  signManagedGoogleSiteRequest({
    secret: CROSS_LANGUAGE_VECTOR.secret,
    method: "POST",
    path: CROSS_LANGUAGE_VECTOR.path,
    timestamp: CROSS_LANGUAGE_VECTOR.timestamp,
    nonce: CROSS_LANGUAGE_VECTOR.nonce,
    body: CROSS_LANGUAGE_VECTOR.body,
  }),
  CROSS_LANGUAGE_VECTOR.signature,
  "Node Managed Google site HMAC drifted from the WordPress cross-language contract."
);

class MemoryStore {
  constructor() {
    this.sessions = new Map();
    this.audit = [];
    this.nonces = new Set();
  }

  async consumeRequestNonce({ key_id, nonce_hash }) {
    const key = `${key_id}:${nonce_hash}`;
    if (this.nonces.has(key)) return false;
    this.nonces.add(key);
    return true;
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
      key_id: "etg-staging-v1",
      environment: "staging",
      status: "active",
    },
  ]),
  MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON: JSON.stringify({
    "etg-staging-v1": "managed-google-site-signing-secret-fixture-0123456789",
  }),
};


assert.throws(
  () => parseManagedGoogleSiteBindings({
    ...env,
    MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON: JSON.stringify([
      JSON.parse(env.MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON)[0],
      {
        site_uuid: "not-a-uuid",
        origin: "https://invalid.example",
        callback_uri: "https://invalid.example/wp-admin/admin-post.php?action=mad4b_context_google_managed_callback",
        key_id: "broken-site-v1",
        status: "active",
      },
    ]),
  }),
  (error) => error?.code === "managed_google_oauth_site_bindings_invalid",
  "A malformed sibling binding must fail the entire managed Google OAuth registry closed."
);

assert.throws(
  () => parseManagedGoogleSiteBindings({
    ...env,
    MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON: JSON.stringify([
      JSON.parse(env.MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON)[0],
      {
        site_uuid: "11111111-1111-4111-8111-111111111111",
        origin: "https://second-site.example",
        callback_uri: "https://second-site.example/wp-admin/admin-post.php?action=mad4b_context_google_managed_callback",
        key_id: "etg-staging-v1",
        environment: "staging",
        status: "active",
      },
    ]),
  }),
  (error) => error?.code === "managed_google_oauth_site_key_id_duplicate",
  "A key_id reused by two active site bindings must fail the runtime registry closed."
);

assert.throws(
  () => parseManagedGoogleSiteSecrets({
    MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON: JSON.stringify({
      "etg-staging-v1": "shared-managed-google-site-secret-0123456789abcdef",
      "second-site-v1": "shared-managed-google-site-secret-0123456789abcdef",
    }),
  }),
  (error) => error?.code === "managed_google_site_auth_secret_reused",
  "A site-HMAC secret reused across key IDs must fail the runtime secret registry closed."
);

const runtimeSiteSecrets = parseManagedGoogleSiteSecrets(env);
assert.equal(runtimeSiteSecrets.size, 1);
assert.equal(runtimeSiteSecrets.get("etg-staging-v1"), "managed-google-site-signing-secret-fixture-0123456789");

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

const signedSiteSecret = "managed-google-site-signing-secret-fixture-0123456789";
const authBody = {
  contract: MANAGED_GOOGLE_SESSION_CONTRACT,
  site_uuid: SITE_UUID,
  origin: ORIGIN,
  callback_uri: CALLBACK,
  access_mode: "read_only",
  requested_scope: GOOGLE_DRIVE_READ_SCOPE,
  state: "site-auth-state-fixture-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  verifier_challenge: sha256Base64url("site-auth-verifier-fixture-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"),
  verifier_method: "S256",
};
const authTimestamp = String(Math.floor(now().getTime() / 1000));
const authNonce = "site-auth-nonce-fixture-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const authSignature = signManagedGoogleSiteRequest({
  secret: signedSiteSecret,
  method: "POST",
  path: "/v1/google/oauth/session",
  timestamp: authTimestamp,
  nonce: authNonce,
  body: authBody,
});
const authResult = await authenticateManagedGoogleSiteRequest({
  env,
  store,
  method: "POST",
  path: "/v1/google/oauth/session",
  headers: {
    "x-mad4b-site-key-id": "etg-staging-v1",
    "x-mad4b-site-timestamp": authTimestamp,
    "x-mad4b-site-nonce": authNonce,
    "x-mad4b-site-signature": authSignature,
  },
  body: authBody,
  now,
});
assert.equal(authResult.contract, MANAGED_GOOGLE_SITE_AUTH_CONTRACT);
assert.equal(authResult.authenticated, true);
assert.equal(authResult.site_uuid, SITE_UUID);
assert.equal(authResult.secrets_included, false);

await assert.rejects(
  () => authenticateManagedGoogleSiteRequest({
    env,
    store,
    method: "POST",
    path: "/v1/google/oauth/session",
    headers: {
      "x-mad4b-site-key-id": "etg-staging-v1",
      "x-mad4b-site-timestamp": authTimestamp,
      "x-mad4b-site-nonce": authNonce,
      "x-mad4b-site-signature": authSignature,
    },
    body: authBody,
    now,
  }),
  (error) => error?.code === "managed_google_site_auth_nonce_replayed"
);

await assert.rejects(
  () => authenticateManagedGoogleSiteRequest({
    env,
    store: new MemoryStore(),
    method: "POST",
    path: "/v1/google/oauth/session",
    headers: {
      "x-mad4b-site-key-id": "etg-staging-v1",
      "x-mad4b-site-timestamp": authTimestamp,
      "x-mad4b-site-nonce": "different-nonce-fixture-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      "x-mad4b-site-signature": "0".repeat(64),
    },
    body: authBody,
    now,
  }),
  (error) => error?.code === "managed_google_site_auth_signature_mismatch"
);

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

let startupPoolResolutionCount = 0;
const startupRouter = buildManagedGoogleOAuthRoutes({
  env: {},
  getPool() {
    startupPoolResolutionCount += 1;
    throw new Error("managed OAuth route construction must not resolve DB pool");
  },
});
assert.ok(startupRouter, "Managed OAuth router must construct without DB/provider configuration.");
assert.equal(startupPoolResolutionCount, 0, "Managed OAuth router construction must remain DB-lazy.");

const routes = readFileSync("./routes/managedGoogleOAuthRoutes.js", "utf8");
const siteAuthSource = readFileSync("./managedGoogleOAuthSiteRequestAuth.js", "utf8");
const protocolPolicy = readFileSync("./managedGoogleOAuthProtocolPolicy.js", "utf8");
const openapi = readFileSync("./openapi.yaml", "utf8");
const openapiDoc = YAML.parse(openapi);
const frontendPolicy = JSON.parse(readFileSync("./frontend-surface-policy.json", "utf8"));
const frontendDispatchSource = readFileSync("./scripts/frontend-surface-dispatch.mjs", "utf8");
const customGptSurfaceRegistry = readFileSync("../canonicals/openapi/custom-gpt-surfaces.yaml", "utf8");
const pathFormatGuard = readFileSync("./scripts/ci-path-format-guard.mjs", "utf8");
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
assert.ok(routes.includes("authenticateManagedGoogleSiteRequest"), "managed OAuth POST routes must authenticate site requests");
assert.ok(migration.includes("managed_google_oauth_sessions"), "migration must create session table");
assert.ok(migration.includes("managed_google_oauth_audit"), "migration must create audit table");
assert.ok(migration.includes("managed_google_oauth_request_nonces"), "migration must create replay-protection nonce table");
assert.ok(migration.includes("token_envelope"), "migration must store only encrypted token envelope");
assert.equal(migration.includes("access_token VARCHAR"), false, "migration must not create plaintext access-token column");
assert.equal(migration.includes("refresh_token VARCHAR"), false, "migration must not create plaintext refresh-token column");

assert.ok(siteAuthSource.includes("mad4b.google-managed-oauth-site-request-auth.v1"), "managed OAuth site request auth contract missing");
assert.ok(siteAuthSource.includes("timingSafeEqual"), "managed OAuth signatures must use constant-time comparison");
assert.ok(siteAuthSource.includes("consumeRequestNonce"), "managed OAuth site request auth must consume one-time nonces");
assert.ok(protocolPolicy.includes("mad4b.provider-protocol-policy-registry.v1"), "Google OAuth protocol invariants must live in the provider protocol policy registry");
assert.ok(protocolPolicy.includes("provider_protocol_policy_registry"), "provider protocol policy registry marker missing");
assert.equal(/\bconst\s+GOOGLE_TOKEN_ENDPOINT\s*=/.test(readFileSync("./managedGoogleOAuthBroker.js", "utf8")), false, "broker core must not own provider protocol endpoint constants");

const managedOperations = new Map();
for (const [pathKey, pathItem] of Object.entries(openapiDoc.paths || {})) {
  for (const [method, operation] of Object.entries(pathItem || {})) {
    if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
    if (operation?.operationId) managedOperations.set(operation.operationId, { pathKey, method, operation });
  }
}

for (const operationId of [
  "createManagedGoogleOAuthSession",
  "completeManagedGoogleOAuthProviderCallback",
  "redeemManagedGoogleOAuthHandoff",
  "refreshManagedGoogleOAuthAccessToken",
]) {
  assert.ok(managedOperations.has(operationId), `canonical OpenAPI missing ${operationId}`);
}

const managedSiteScheme = openapiDoc?.components?.securitySchemes?.managedGoogleSiteHmac;
assert.equal(managedSiteScheme?.type, "apiKey", "managed OAuth site-HMAC scheme must be declared as apiKey");
assert.equal(managedSiteScheme?.in, "header", "managed OAuth site-HMAC scheme must bind a request header");
assert.equal(managedSiteScheme?.name, "X-MAD4B-Site-Signature", "managed OAuth site-HMAC scheme must bind the signature header");

for (const operationId of [
  "createManagedGoogleOAuthSession",
  "redeemManagedGoogleOAuthHandoff",
  "refreshManagedGoogleOAuthAccessToken",
]) {
  const operation = managedOperations.get(operationId)?.operation;
  assert.deepEqual(operation?.security, [{ managedGoogleSiteHmac: [] }], `${operationId} must require managedGoogleSiteHmac`);
  const headerNames = new Set((operation?.parameters || []).filter((entry) => entry?.in === "header").map((entry) => entry.name));
  for (const header of ["X-MAD4B-Site-Key-ID", "X-MAD4B-Site-Timestamp", "X-MAD4B-Site-Nonce", "X-MAD4B-Site-Signature"]) {
    assert.ok(headerNames.has(header), `${operationId} missing required site-auth header: ${header}`);
  }
}

const callbackOperation = managedOperations.get("completeManagedGoogleOAuthProviderCallback")?.operation;
assert.deepEqual(callbackOperation?.security, [], "Google provider callback must remain public/state-bound rather than site-HMAC authenticated");

for (const operationId of ["redeemManagedGoogleOAuthHandoff", "refreshManagedGoogleOAuthAccessToken"]) {
  const responseSchema = managedOperations.get(operationId)?.operation?.responses?.["200"]?.content?.["application/json"]?.schema;
  assert.deepEqual(
    responseSchema?.properties?.credential_material_included,
    { type: "boolean", enum: [true] },
    `${operationId} token-bearing response must declare credential material accurately`,
  );
}

const managedPublicSurfaceRule = frontendPolicy.rules.find((rule) => rule.rule_id === "managed-google-oauth-broker-public-callback-api");
assert.ok(managedPublicSurfaceRule, "managed Google OAuth public callback must have an explicit frontend surface policy decision");
assert.equal(managedPublicSurfaceRule.source_file, "routes/managedGoogleOAuthRoutes.js");
assert.equal(managedPublicSurfaceRule.scope, "public");
assert.equal(managedPublicSurfaceRule.decision, "api_only");
assert.equal(managedPublicSurfaceRule.family_key, "managed-google-oauth.public");

const managedDeveloperSurfaceRule = frontendPolicy.rules.find((rule) => rule.rule_id === "managed-google-oauth-broker-site-hmac-api");
assert.ok(managedDeveloperSurfaceRule, "managed Google OAuth site-HMAC protocol must have an explicit frontend surface policy decision");
assert.equal(managedDeveloperSurfaceRule.source_file, "routes/managedGoogleOAuthRoutes.js");
assert.equal(managedDeveloperSurfaceRule.scope, "developer");
assert.equal(managedDeveloperSurfaceRule.decision, "api_only");
assert.equal(managedDeveloperSurfaceRule.family_key, "managed-google-oauth.developer");
const managedSiteAuthRule = frontendPolicy.auth_rules.find((rule) => rule.rule_id === "managed-google-oauth-site-hmac");
assert.ok(managedSiteAuthRule, "managed Google OAuth POST route family must have explicit site-HMAC auth policy");
assert.equal(managedSiteAuthRule.profile, "managed_google_site_hmac");
assert.equal(managedSiteAuthRule.source_file, "routes/managedGoogleOAuthRoutes.js");
assert.ok(
  frontendDispatchSource.includes('managed_google_site_hmac: { alternatives: [["managedGoogleSiteHmac"]]'),
  "frontend surface auth registry must resolve managed_google_site_hmac to managedGoogleSiteHmac",
);
assert.ok(
  frontendDispatchSource.includes('"MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON", "MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON"'),
  "managed Google site-HMAC auth profile must retain exact server-owned configuration dependencies",
);
assert.deepEqual([...managedSiteAuthRule.operations].sort(), [
  "POST /v1/google/oauth/redeem",
  "POST /v1/google/oauth/refresh",
  "POST /v1/google/oauth/session",
].sort());
const managedCallbackRule = frontendPolicy.auth_rules.find((rule) => rule.rule_id === "managed-google-oauth-provider-callback-public");
assert.ok(managedCallbackRule, "managed Google OAuth provider callback must retain explicit public auth policy");
assert.equal(managedCallbackRule.profile, "public");
assert.deepEqual(managedCallbackRule.operations, ["GET /v1/google/oauth/callback"]);

for (const operationId of [
  "createManagedGoogleOAuthSession",
  "completeManagedGoogleOAuthProviderCallback",
  "redeemManagedGoogleOAuthHandoff",
  "refreshManagedGoogleOAuthAccessToken",
]) {
  const operation = managedOperations.get(operationId)?.operation;
  assert.equal(operation?.["x-custom-gpt-exclude"], true, `managed OAuth operation must be globally excluded from Custom GPT projection: ${operationId}`);
  assert.equal(operation?.["x-gpt-action-exclude"], true, `managed OAuth operation must be globally excluded from GPT Actions: ${operationId}`);
  assert.equal(
    customGptSurfaceRegistry.includes(`operation_id: ${operationId}`),
    false,
    `managed OAuth protocol operation must not masquerade as a per-surface candidate exclusion: ${operationId}`,
  );
}
assert.ok(pathFormatGuard.includes('entry.operation?.["x-custom-gpt-exclude"] === true'), "path guard must honor source-owned Custom GPT exclusions");
assert.ok(pathFormatGuard.includes('entry.operation?.["x-gpt-action-exclude"] === true'), "path guard must honor source-owned GPT Action exclusions");

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

// Managed site-enrollment is part of the canonical broker regression without changing the global test-manifest authority.
await import("./test-managed-google-site-enrollment.mjs");
