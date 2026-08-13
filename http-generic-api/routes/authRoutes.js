import express, { Router } from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import {
  TENANT_GPT_OAUTH_CLIENT_ID,
  TENANT_GPT_SCOPE,
  TENANT_GPT_SCOPE_LINKS,
} from "../tenantGptOAuthPreset.js";
import {
  TENANT_GPT_CORE_RESOURCE,
  normalizeTenantGptOAuthResource,
  resolveTenantGptOAuthResourceProfile,
  tenantGptRequestHostFromHeaders,
} from "../tenantGptOAuthResourceProfile.js";
import {
  resolveTenantGptOAuthClientConfig,
  validateTenantGptOAuthClientCredentials,
} from "../tenantGptOAuthClientConfig.js";
import { recordTenantGptActivationContext } from "../tenantGptActivationContextStore.js";
import { hasVerifiedGoogleIdentity, normalizeAuthEmail } from "../authIdentityNormalization.js";
import {
  consumeTenantGptOAuthAuthorizationCode,
  persistTenantGptOAuthAuthorizationCode,
} from "../tenantGptOAuthAuthorizationCodeStore.js";
import {
  isDuplicateEntryError,
  recoverGoogleJitIdentityAfterDuplicate,
} from "../tenantGptGoogleJitRecovery.js";
import {
  buildTenantGptSsoCookieHeader,
  issueTenantGptSsoSession,
  parseTenantGptSsoCookie,
  resolveTenantGptSsoSessionTtlSeconds,
  verifyTenantGptSsoSession,
} from "../tenantGptSsoSession.js";

// Default fallback secret for development if missing.
const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";

// The client ID shouldn't strictly be required in development for testing,
// but validation logic will use it if provided.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const OAUTH_CODE_TTL_SECONDS = 5 * 60;
const USER_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const PLATFORM_JWT_CLIENT_DEFAULT_TTL_SECONDS = 15 * 60;
const PLATFORM_JWT_CLIENT_MAX_TTL_SECONDS = 60 * 60;
const VALID_SIGN_IN_OPTIONS = new Set(["google", "email", "register"]);
const PLATFORM_JWT_ISSUER = process.env.PLATFORM_JWT_ISSUER || "https://auth.mad4b.com";
const CHATGPT_CANONICAL_CALLBACK_HOST = "chatgpt.com";
const CHATGPT_LEGACY_CALLBACK_HOST = "chat.openai.com";
const PASSWORD_RESET_TTL_SECONDS = 30 * 60;
const PASSWORD_RESET_BASE_URL = (process.env.PUBLIC_BASE_URL || PLATFORM_JWT_ISSUER || "https://auth.mad4b.com").replace(/\/$/, "");

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function secureToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function emailDeliveryConfigured() {
  return Boolean(process.env.SMTP_URL || process.env.SENDGRID_API_KEY || process.env.RESEND_API_KEY || process.env.MAILGUN_API_KEY);
}

function safeReturnTo(value) {
  const raw = String(value || "").trim();
  if (!raw) return "/connect";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw.slice(0, 512);
  try {
    const url = new URL(raw);
    if (url.origin === PASSWORD_RESET_BASE_URL) return `${url.pathname}${url.search}${url.hash}`.slice(0, 512);
  } catch {}
  return "/connect";
}

async function ensurePasswordResetTables() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`auth_password_reset_tokens\` (
      \`reset_id\` VARCHAR(64) NOT NULL,
      \`user_id\` VARCHAR(64) NOT NULL,
      \`email\` VARCHAR(255) NOT NULL,
      \`token_hash\` VARCHAR(64) NOT NULL,
      \`status\` ENUM('pending','used','expired','revoked') NOT NULL DEFAULT 'pending',
      \`requested_ip\` VARCHAR(64) NULL,
      \`requested_user_agent\` VARCHAR(255) NULL,
      \`expires_at\` DATETIME NOT NULL,
      \`used_at\` DATETIME NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`reset_id\`),
      UNIQUE KEY \`uq_auth_password_reset_token_hash\` (\`token_hash\`),
      KEY \`idx_auth_password_reset_email_status\` (\`email\`, \`status\`, \`expires_at\`),
      KEY \`idx_auth_password_reset_user_status\` (\`user_id\`, \`status\`, \`expires_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`auth_email_outbox\` (
      \`email_id\` VARCHAR(64) NOT NULL,
      \`purpose\` VARCHAR(64) NOT NULL,
      \`recipient_email\` VARCHAR(255) NOT NULL,
      \`subject\` VARCHAR(255) NOT NULL,
      \`body_text\` TEXT NOT NULL,
      \`body_html\` MEDIUMTEXT NULL,
      \`status\` ENUM('queued','sent','failed','skipped') NOT NULL DEFAULT 'queued',
      \`provider\` VARCHAR(64) NULL,
      \`provider_message_id\` VARCHAR(255) NULL,
      \`metadata_json\` JSON NULL,
      \`last_error\` TEXT NULL,
      \`sent_at\` DATETIME NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`email_id\`),
      KEY \`idx_auth_email_outbox_status\` (\`status\`, \`purpose\`, \`created_at\`),
      KEY \`idx_auth_email_outbox_recipient\` (\`recipient_email\`, \`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

function cleanOption(value, allowed, fallback = null) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function cleanText(value, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength);
}

function parseSignInOptions(value) {
  const raw = String(value || "google,email,register")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => VALID_SIGN_IN_OPTIONS.has(item));
  const unique = [...new Set(raw)];
  return unique.length ? unique : ["google", "email", "register"];
}

function cleanTenantGptRequestedScope(value) {
  const requested = String(value || "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  const allowed = new Set(TENANT_GPT_SCOPE_LINKS);
  const granted = [...new Set(requested.filter((scope) => allowed.has(scope)))];
  return granted.length ? granted.join(" ") : "";
}

function safeOAuthScopeEvidence(value) {
  const scopes = String(value || "").split(/\s+/).filter(Boolean);
  return {
    present: scopes.length > 0,
    count: scopes.length,
    sha256_prefix: scopes.length ? sha256(scopes.join(" ")).slice(0, 12) : null,
  };
}

function parseActivationContext(query = {}) {
  const context = {
    purpose: "tenant_activation",
    activation_mode: cleanOption(query.activation_mode || query.mode, new Set(["managed", "dedicated"]), null),
    cloudflare_mode: cleanOption(query.cloudflare_mode, new Set(["managed", "dedicated"]), null),
    google_auth_mode: cleanOption(query.google_auth_mode, new Set(["managed", "dedicated", "user_oauth"]), null),
    n8n_activation_mode: cleanOption(query.n8n_activation_mode, new Set(["managed_main_server", "self_hosted_local"]), null),
    device_id: cleanText(query.device_id, 32),
    workspace_name: cleanText(query.workspace_name || query.tenant_display_name, 120),
    screen_hint: cleanOption(query.screen_hint, new Set(["signin", "signup", "google"]), "google"),
    sign_in_options: parseSignInOptions(query.sign_in_options || query.auth_options),
  };

  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== null && value !== "";
    })
  );
}

function requireAdminPrincipal(req, res, next) {
  if (req.auth?.is_admin === true) return next();
  return res.status(403).json({
    ok: false,
    error: {
      code: "admin_principal_required",
      message: "Platform JWT client endpoints require the admin/service BACKEND_API_KEY.",
    },
  });
}

function cleanTtlSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return PLATFORM_JWT_CLIENT_DEFAULT_TTL_SECONDS;
  return Math.min(Math.max(Math.floor(parsed), 60), PLATFORM_JWT_CLIENT_MAX_TTL_SECONDS);
}

function issueTenantGptAccessToken(payload, {
  clientId = TENANT_GPT_OAUTH_CLIENT_ID,
  jwtid = randomUUID(),
  compact = false,
  resource,
} = {}) {
  const userId = String(payload?.user_id || "").trim();
  if (!userId) {
    const err = new Error("Cannot issue tenant GPT token without user_id.");
    err.code = "missing_user_id";
    throw err;
  }

  const tenantId = payload?.tenant_id ? String(payload.tenant_id).trim() : null;
  const email = payload?.email ? String(payload.email).trim() : null;
  const subject = tenantId ? `tenant:${tenantId}:user:${userId}` : `user:${userId}`;
  const normalizedClientId = String(clientId || TENANT_GPT_OAUTH_CLIENT_ID).trim() || TENANT_GPT_OAUTH_CLIENT_ID;
  const normalizedResource = normalizeTenantGptOAuthResource(resource);
  if (!normalizedResource) {
    const err = new Error("Cannot issue tenant GPT token without a registered protected resource.");
    err.code = "missing_oauth_resource";
    throw err;
  }

  const claims = {
    iss: PLATFORM_JWT_ISSUER,
    aud: normalizedResource,
    azp: normalizedClientId,
    client_id: normalizedClientId,
    resource: normalizedResource,
    sub: subject,
    user_id: userId,
    tenant_id: tenantId,
    scope: TENANT_GPT_SCOPE,
    purpose: "tenant_gpt_access",
  };

  if (!compact) {
    claims.email = email;
    claims.scope_links = TENANT_GPT_SCOPE_LINKS;
  }

  return jwt.sign(claims, JWT_SECRET, { expiresIn: USER_TOKEN_TTL_SECONDS, jwtid });
}

async function fetchActiveUserForJwtClient(pool, { user_id, email }) {
  const hasUserId = typeof user_id === "string" && user_id.trim();
  const normalizedEmail = normalizeAuthEmail(email);
  const hasEmail = Boolean(normalizedEmail);
  if (!hasUserId && !hasEmail) return null;

  const where = hasUserId ? "u.user_id = ?" : "u.email = ?";
  const param = hasUserId ? user_id.trim() : normalizedEmail;
  const [rows] = await pool.query(
    `SELECT u.user_id, u.email, u.display_name, u.status
       FROM \`users\` u
      WHERE ${where}
      LIMIT 1`,
    [param]
  );
  const user = rows[0] || null;
  return user?.status === "active" ? user : null;
}

async function fetchJwtClientMembership(pool, userId, requestedTenantId) {
  if (requestedTenantId) {
    const [rows] = await pool.query(
      `SELECT m.tenant_id, m.role, m.status, t.display_name AS tenant_display_name
         FROM \`memberships\` m
         LEFT JOIN \`tenants\` t ON t.tenant_id = m.tenant_id
        WHERE m.user_id = ? AND m.tenant_id = ? AND m.status = 'active'
        LIMIT 1`,
      [userId, requestedTenantId]
    );
    return rows[0] || null;
  }

  const [rows] = await pool.query(
    `SELECT m.tenant_id, m.role, m.status, t.display_name AS tenant_display_name
       FROM \`memberships\` m
       LEFT JOIN \`tenants\` t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ? AND m.status = 'active'
      ORDER BY m.granted_at ASC
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function ensureDefaultWorkspaceForUser(connection, { userId, email, displayName, source }) {
  const [memberships] = await connection.query(
    `SELECT m.tenant_id,
            m.status AS membership_status,
            t.status AS tenant_status
       FROM \`memberships\` m
       LEFT JOIN \`tenants\` t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ?
      ORDER BY m.granted_at ASC`,
    [userId]
  );

  const activeMembership = memberships.find((row) => row.membership_status === "active" && row.tenant_status === "active");
  if (activeMembership) return { created: false, tenant_id: activeMembership.tenant_id };
  if (memberships.some((row) => row.membership_status !== "active")) {
    throw authRouteFailure(403, "membership_revoked", "The existing workspace membership is not active.");
  }
  if (memberships.some((row) => row.tenant_status !== "active")) {
    throw authRouteFailure(403, "tenant_suspended", "The existing workspace is not active.");
  }

  const tenantId = randomUUID();
  const tenantName = `${displayName || email || "User"}'s workspace`;
  await connection.query(
    `INSERT INTO \`tenants\` (tenant_id, tenant_type, display_name, status, metadata_json)
     VALUES (?, 'managed_client_account', ?, 'active', ?)`,
    [tenantId, tenantName, JSON.stringify({ source, repaired_user_id: userId })]
  );
  await connection.query(
    `INSERT INTO \`memberships\` (user_id, tenant_id, role, status)
     VALUES (?, ?, 'owner', 'active')`,
    [userId, tenantId]
  );
  return { created: true, tenant_id: tenantId };
}

function escapeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseOAuthRedirectUri(redirectUri) {
  try {
    const url = new URL(String(redirectUri || ""));
    if (!["https:", "http:"].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function isChatGptAipOAuthCallback(url) {
  return /^\/aip\/g-[a-z0-9]+\/oauth\/callback$/i.test(url?.pathname || "");
}

function canonicalizeTenantGptRedirectUri(redirectUri) {
  const url = parseOAuthRedirectUri(redirectUri);
  if (!url) return "";
  if (url.protocol === "https:" && url.hostname.toLowerCase() === CHATGPT_LEGACY_CALLBACK_HOST && isChatGptAipOAuthCallback(url)) {
    url.hostname = CHATGPT_CANONICAL_CALLBACK_HOST;
  }
  return url.toString();
}

function equivalentTenantGptRedirectUri(left, right) {
  const canonicalLeft = canonicalizeTenantGptRedirectUri(left);
  const canonicalRight = canonicalizeTenantGptRedirectUri(right);
  return Boolean(canonicalLeft && canonicalRight && canonicalLeft === canonicalRight);
}

function callbackPatternToRegExp(pattern) {
  const escaped = String(pattern || "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace("\\{g-GPT-ID\\}", "g-[a-z0-9]+");
  return new RegExp(`^${escaped}$`, "i");
}

async function resolveTenantGptRedirectUriDecision(redirectUri, queryFn) {
  const url = parseOAuthRedirectUri(redirectUri);
  if (!url) return { allowed: false, configuration_available: true, error_code: null };

  const normalized = url.toString();
  const canonical = canonicalizeTenantGptRedirectUri(normalized);
  const resolved = await resolveTenantGptOAuthClientConfig({ query: queryFn });
  if (!resolved.ok) {
    return {
      allowed: false,
      configuration_available: false,
      error_code: String(resolved.error || "oauth_configuration_unavailable").slice(0, 64),
    };
  }
  const callbacks = Array.isArray(resolved.config?.callback_urls_to_allow)
    ? resolved.config.callback_urls_to_allow
    : [];

  function matches(callback, candidate) {
    if (callback === candidate) return true;
    return callback.includes("{g-GPT-ID}") && callbackPatternToRegExp(callback).test(candidate);
  }

  return {
    allowed: callbacks.some((callback) => matches(callback, normalized) || matches(callback, canonical)),
    configuration_available: true,
    error_code: null,
  };
}

function appendOAuthParams(redirectUri, params) {
  const url = parseOAuthRedirectUri(redirectUri);
  if (!url) throw new Error("Invalid redirect_uri.");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function oauthClientCredentials(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8");
      const splitAt = decoded.indexOf(":");
      if (splitAt >= 0) {
        return {
          client_id: decoded.slice(0, splitAt),
          client_secret: decoded.slice(splitAt + 1),
        };
      }
    } catch {
      // Fall back to POST body credentials below.
    }
  }

  return {
    client_id: req.body?.client_id,
    client_secret: req.body?.client_secret,
  };
}

function safeOAuthRedirectEvidence(redirectUri) {
  const url = parseOAuthRedirectUri(redirectUri);
  if (!url) return { present: Boolean(redirectUri), valid: false };
  const canonical = parseOAuthRedirectUri(canonicalizeTenantGptRedirectUri(url.toString()));
  return {
    present: true,
    valid: true,
    host: url.hostname,
    path: url.pathname,
    canonical_host: canonical?.hostname || null,
    canonical_path: canonical?.pathname || null,
  };
}

function safeOAuthClientEvidence(credentials = {}) {
  const clientId = String(credentials.client_id || "");
  return {
    client_id_present: Boolean(clientId),
    client_id_sha256_prefix: clientId ? sha256(clientId).slice(0, 12) : null,
    client_secret_present: Boolean(String(credentials.client_secret || "")),
  };
}

function safeOAuthCodeTimingEvidence(code, nowMs = Date.now()) {
  const raw = String(code || "");
  if (!raw) return { present: false, decoded: false };
  const decoded = jwt.decode(raw);
  if (!decoded || typeof decoded !== "object") return { present: true, decoded: false };

  const iatSeconds = Number(decoded.iat);
  const expSeconds = Number(decoded.exp);
  const iatMs = Number.isFinite(iatSeconds) ? iatSeconds * 1000 : null;
  const expMs = Number.isFinite(expSeconds) ? expSeconds * 1000 : null;
  const ageSeconds = iatMs === null ? null : Math.round((nowMs - iatMs) / 1000);
  const expiresInSeconds = expMs === null ? null : Math.round((expMs - nowMs) / 1000);

  return {
    present: true,
    decoded: true,
    iat_present: iatMs !== null,
    exp_present: expMs !== null,
    ttl_seconds: iatMs !== null && expMs !== null ? Math.round((expMs - iatMs) / 1000) : null,
    age_seconds: ageSeconds,
    expires_in_seconds: expiresInSeconds,
    expired_by_seconds: expiresInSeconds === null ? null : Math.max(0, -expiresInSeconds),
    jti_present: Boolean(decoded.jti),
    purpose_present: Boolean(decoded.purpose),
    user_id_present: Boolean(decoded.user_id),
    tenant_id_present: Boolean(decoded.tenant_id),
    redirect_uri: safeOAuthRedirectEvidence(decoded.redirect_uri),
  };
}

async function recordOAuthTokenDiagnostic(queryFn, event = {}) {
  try {
    const now = new Date();
    const startedAt = event.started_at_ms ? new Date(event.started_at_ms) : now;
    const durationMs = Number.isFinite(event.duration_ms) ? Math.max(0, Math.round(event.duration_ms)) : null;
    const evidence = {
      event: "tenant_gpt_oauth_token_exchange",
      status: event.status || "unknown",
      failure_reason: event.failure_reason || null,
      http_status: event.http_status || null,
      duration_ms: durationMs,
      grant_type: event.grant_type || null,
      code_present: Boolean(event.code_present),
      code_timing: event.code_timing || null,
      redirect_uri: event.redirect_uri || null,
      code_redirect_uri: event.code_redirect_uri || null,
      client: event.client || null,
      access_token: event.access_token || null,
      activation_context: event.activation_context || null,
      requested_scope: event.requested_scope || null,
      client_validation_source: event.client_validation_source || null,
      code_jti_present: event.code_jti_present === true,
      user_id_present: event.user_id_present === true,
      tenant_id_present: event.tenant_id_present === true,
      request_id: event.request_id || null,
    };
    await queryFn(
      `INSERT INTO \`execution_log\`
        (run_date, start_time, end_time, duration_seconds, entry_type, execution_class, source_layer,
         execution_status, failure_reason, output_summary, action_key, endpoint_key, parent_action_key,
         runtime_evidence_json, created_at)
       VALUES (?, ?, ?, ?, 'diagnostic', 'oauth', 'auth_routes', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        startedAt.toISOString().slice(0, 10),
        startedAt.toISOString(),
        now.toISOString(),
        durationMs === null ? null : String((durationMs / 1000).toFixed(3)),
        event.status || "unknown",
        event.failure_reason || null,
        JSON.stringify({ ok: event.status === "success", failure_reason: event.failure_reason || null, http_status: event.http_status || null, duration_ms: durationMs }),
        "tenant_gpt_oauth_token_exchange",
        "auth_oauth_token",
        "tenant_gpt_oauth",
        JSON.stringify(evidence),
      ]
    );
  } catch (err) {
    console.warn("tenant_gpt_oauth_token_diagnostic_log_failed", { message: err?.message });
  }
}

function buildOAuthAuthorizeHtml({
  clientId,
  redirectUri,
  state,
  activationContext,
  requestedScope = "",
  oauthClientId = TENANT_GPT_OAUTH_CLIENT_ID,
  oauthResource = "",
  ssoAvailable = false,
}) {
  const signInOptions = Array.isArray(activationContext?.sign_in_options)
    ? activationContext.sign_in_options
    : ["google", "email", "register"];
  const showGoogle = signInOptions.includes("google");
  const showEmail = signInOptions.includes("email");
  const showRegister = signInOptions.includes("register");
  const initialPanel = activationContext?.screen_hint === "signup" && showRegister
    ? "register"
    : activationContext?.screen_hint === "signin" && showEmail
      ? "email"
      : showGoogle
        ? "google"
        : showEmail
          ? "email"
          : "register";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Growth Intelligence Platform - Google Sign-In</title>
  <style>
    body{font-family:Arial,sans-serif;margin:0;background:#f5f5f7;color:#1d1d1f;display:grid;min-height:100vh;place-items:center}
    main{width:min(460px,calc(100vw - 32px));background:#fff;border:1px solid #e5e5ea;border-radius:12px;padding:28px;box-shadow:0 18px 60px rgba(0,0,0,.08)}
    h1{font-size:22px;margin:0 0 8px}
    p{font-size:14px;line-height:1.45;color:#3a3a3d}
    nav{display:flex;gap:8px;margin:18px 0;flex-wrap:wrap}
    nav button,.submit{border:1px solid #d2d2d7;background:#fff;border-radius:8px;padding:10px 12px;font-weight:700;cursor:pointer}
    nav button[aria-selected="true"],.submit{background:#1d1d1f;color:#fff;border-color:#1d1d1f}
    form{display:grid;gap:10px;margin-top:12px}
    label{display:grid;gap:5px;font-size:12px;font-weight:700;color:#3a3a3d}
    input{border:1px solid #d2d2d7;border-radius:8px;padding:11px 12px;font-size:14px}
    section[hidden]{display:none}
    .hint{font-size:12px;color:#6e6e73;margin-top:8px}
    .links{font-size:12px;margin-top:18px;color:#86868b}
    .links a{color:#0058b8}
    .error{margin-top:14px;color:#b3261e;font-size:13px;white-space:pre-wrap}
  </style>
</head>
<body>
  <main>
    <h1>Growth Intelligence Platform</h1>
    <p>Sign in or create your workspace to continue securely in ChatGPT.</p>
    ${ssoAvailable ? '<button class="submit" id="continue-session" type="button">Continue with existing session</button><p class="hint">Your active Mad4B session will be reused without asking you to sign in again.</p>' : ''}
    <nav aria-label="Sign-in options">
      ${showGoogle ? '<button type="button" data-panel="google">Google</button>' : ''}
      ${showEmail ? '<button type="button" data-panel="email">Existing account</button>' : ''}
      ${showRegister ? '<button type="button" data-panel="register">New workspace</button>' : ''}
    </nav>
    ${showGoogle ? '<section id="panel-google"><div id="gsi-btn-container"></div><p class="hint">Recommended. Uses Google Sign-In and returns a tenant JWT to ChatGPT.</p></section>' : ''}
    ${showEmail ? `<section id="panel-email" hidden>
      <form id="login-form">
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="submit" type="submit">Sign in</button>
      </form>
    </section>` : ''}
    ${showRegister ? `<section id="panel-register" hidden>
      <form id="register-form">
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password<input name="password" type="password" autocomplete="new-password" required minlength="8"></label>
        <label>Your name<input name="display_name" autocomplete="name" required></label>
        <label>Workspace name<input name="tenant_display_name" value="${escapeHtmlAttribute(activationContext?.workspace_name || "")}" required></label>
        <button class="submit" type="submit">Create workspace</button>
      </form>
    </section>` : ''}
    <div id="error" class="error" role="alert"></div>
    <div class="links">
      <a href="https://auth.mad4b.com/privacy-policy" target="_blank" rel="noopener">Privacy Policy</a>
      <span aria-hidden="true"> | </span>
      <a href="https://auth.mad4b.com/terms-of-use" target="_blank" rel="noopener">Terms of Use</a>
    </div>
  </main>
  <script src="https://accounts.google.com/gsi/client" async defer></script>
  <script>
    const GOOGLE_CLIENT_ID = ${JSON.stringify(String(clientId || ""))};
    const REDIRECT_URI = ${JSON.stringify(String(redirectUri || ""))};
    const STATE = ${JSON.stringify(String(state || ""))};
    const ACTIVATION_CONTEXT = ${JSON.stringify(activationContext || {})};
    const OAUTH_SCOPE = ${JSON.stringify(String(requestedScope || ""))};
    const OAUTH_CLIENT_ID = ${JSON.stringify(String(oauthClientId || TENANT_GPT_OAUTH_CLIENT_ID))};
    const OAUTH_RESOURCE = ${JSON.stringify(String(oauthResource || ""))};
    const SSO_AVAILABLE = ${JSON.stringify(ssoAvailable === true)};
    const INITIAL_PANEL = ${JSON.stringify(initialPanel)};
    const errorBox = document.getElementById("error");
    function showError(message){ errorBox.textContent = message || "Sign-in failed."; }
    function setPanel(panel){
      document.querySelectorAll("nav button").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.panel === panel)));
      document.querySelectorAll("section[id^='panel-']").forEach((section) => { section.hidden = section.id !== "panel-" + panel; });
    }
    document.querySelectorAll("nav button").forEach((button) => button.addEventListener("click", () => setPanel(button.dataset.panel)));
    setPanel(INITIAL_PANEL);
    async function issueOAuthCode(credential){
      const codeRes = await fetch("/auth/oauth/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential, redirect_uri: REDIRECT_URI, state: STATE, scope: OAUTH_SCOPE, oauth_client_id: OAUTH_CLIENT_ID, oauth_resource: OAUTH_RESOURCE, activation_context: ACTIVATION_CONTEXT })
      });
      const codeData = await codeRes.json();
      if (!codeRes.ok || !codeData.redirect_to) {
        const reference = codeData?.error?.request_id ? " Reference: " + codeData.error.request_id : "";
        throw new Error((codeData?.error?.message || "Could not complete OAuth sign-in.") + reference);
      }
      window.location.assign(codeData.redirect_to);
    }
    async function submitCredentials(kind, form){
      const payload = Object.fromEntries(new FormData(form).entries());
      await issueOAuthCode({ kind, ...payload });
    }
    document.getElementById("continue-session")?.addEventListener("click", async () => {
      try { await issueOAuthCode(null); } catch (err) { showError(err.message); }
    });
    document.getElementById("login-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try { await submitCredentials("login", event.currentTarget); } catch (err) { showError(err.message); }
    });
    document.getElementById("register-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try { await submitCredentials("register", event.currentTarget); } catch (err) { showError(err.message); }
    });
    function setup(){
      if (!document.getElementById("gsi-btn-container")) return;
      if (!GOOGLE_CLIENT_ID) return showError("Google client ID is not configured.");
      if (!REDIRECT_URI) return showError("OAuth redirect_uri is required.");
      if (!window.google?.accounts?.id) return setTimeout(setup, 250);
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          try {
            await issueOAuthCode({ kind: "google", id_token: response.credential });
          } catch (err) {
            showError(err.message);
          }
        }
      });
      // Let Google Identity Services select the language from the user's Google Account
      // or browser. Forcing a locale here can conflict with the surrounding OAuth UI.
      window.google.accounts.id.renderButton(document.getElementById("gsi-btn-container"), {
        theme: "outline",
        size: "large",
        width: 320,
        text: "continue_with"
      });
    }
    setup();
  </script>
</body>
</html>`;
}

function authRouteFailure(status, code, message) {
  const error = new Error(message);
  error.auth_status = status;
  error.auth_code = code;
  return error;
}

function sendAuthRouteFailure(res, error, fallbackCode) {
  if (Number.isInteger(error?.auth_status) && error?.auth_code) {
    return res.status(error.auth_status).json({
      ok: false,
      error: { code: error.auth_code, message: error.message },
    });
  }
  return res.status(500).json({
    ok: false,
    error: { code: fallbackCode, message: error?.message || "Authentication failed." },
  });
}

function sendOAuthInfrastructureFailure(res, {
  requestId,
  stage,
  error,
  code,
  message,
}) {
  const diagnosticCode = String(error?.code || "").trim().slice(0, 64) || null;
  const diagnosticSqlState = String(error?.sqlState || "").trim().slice(0, 16) || null;
  const diagnosticErrno = Number.isInteger(Number(error?.errno)) ? Number(error.errno) : null;
  console.error("tenant_gpt_oauth_code_issue_failed", {
    request_id: requestId,
    stage,
    error_code: diagnosticCode,
    error_errno: diagnosticErrno,
    sql_state: diagnosticSqlState,
    secrets_included: false,
  });
  res.setHeader("x-request-id", requestId);
  return res.status(503).json({
    ok: false,
    error: {
      code,
      message,
      request_id: requestId,
    },
  });
}

export function buildAuthRoutes(deps) {
  const router = Router();
  const requireBackendApiKey = deps?.requireBackendApiKey;
  const resolvePool = typeof deps?.getPool === "function" ? deps.getPool : getPool;
  const oauthGoogleClient = deps?.googleClient || googleClient;
  const authEnv = deps?.env || process.env;
  const ssoSessionTtlSeconds = resolveTenantGptSsoSessionTtlSeconds(authEnv);

  async function registerUserCredential(input = {}) {
    const { email: rawEmail, password, display_name, tenant_display_name } = input;
    const email = normalizeAuthEmail(rawEmail);
    if (!email || !password || !display_name) {
      throw authRouteFailure(400, "missing_fields", "email, password, and display_name are required.");
    }

    const user_id = randomUUID();
    const tenant_id = randomUUID();
    const password_hash = await bcrypt.hash(password, 10);
    const tenantName = tenant_display_name || `${display_name}'s workspace`;
    const connection = await resolvePool().getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `INSERT INTO \`users\` (user_id, email, display_name, status) VALUES (?, ?, ?, ?)`,
        [user_id, email, display_name, "active"]
      );
      await connection.query(
        `INSERT INTO \`user_credentials\` (user_id, auth_provider, password_hash) VALUES (?, ?, ?)`,
        [user_id, "platform", password_hash]
      );
      await connection.query(
        `INSERT INTO \`tenants\` (tenant_id, tenant_type, display_name, status, metadata_json)
         VALUES (?, 'managed_client_account', ?, 'active', ?)`,
        [tenant_id, tenantName, JSON.stringify({ source: "self_serve_signup" })]
      );
      await connection.query(
        `INSERT INTO \`memberships\` (user_id, tenant_id, role, status) VALUES (?, ?, 'owner', 'active')`,
        [user_id, tenant_id]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (error?.code === "ER_DUP_ENTRY") {
        throw authRouteFailure(409, "user_already_exists", "A user with this email already exists.");
      }
      throw error;
    } finally {
      connection.release();
    }

    return {
      user_id,
      email,
      display_name,
      tenant_id,
      memberships: [{ tenant_id, role: "owner", status: "active" }],
    };
  }

  async function loginUserCredential(input = {}) {
    const { email: rawEmail, password } = input;
    const email = normalizeAuthEmail(rawEmail);
    if (!email || !password) {
      throw authRouteFailure(400, "missing_fields", "email and password are required.");
    }

    const pool = resolvePool();
    const [rows] = await pool.query(
      `SELECT u.user_id, u.email, u.display_name, u.status, uc.password_hash
       FROM \`users\` u
       JOIN \`user_credentials\` uc ON u.user_id = uc.user_id
       WHERE u.email = ? AND uc.auth_provider = 'platform' LIMIT 1`,
      [email]
    );
    if (!rows.length) {
      throw authRouteFailure(401, "invalid_credentials", "Invalid email or password.");
    }

    const user = rows[0];
    if (user.status !== "active") {
      throw authRouteFailure(403, "account_inactive", "Account is not active.");
    }
    if (!(await bcrypt.compare(password, user.password_hash))) {
      throw authRouteFailure(401, "invalid_credentials", "Invalid email or password.");
    }

    const [memberships] = await pool.query(
      `SELECT m.tenant_id, m.role, m.status, t.display_name AS tenant_display_name
       FROM \`memberships\` m
       LEFT JOIN \`tenants\` t ON t.tenant_id = m.tenant_id
       WHERE m.user_id = ? AND m.status = 'active'
       ORDER BY m.granted_at ASC`,
      [user.user_id]
    );
    return {
      user_id: user.user_id,
      email: user.email,
      display_name: user.display_name,
      tenant_id: memberships[0]?.tenant_id || null,
      memberships,
    };
  }

  async function googleUserCredential(input = {}) {
    const { id_token } = input;
    if (!id_token) throw authRouteFailure(400, "missing_fields", "id_token is required.");

    let payload;
    try {
      const ticket = await oauthGoogleClient.verifyIdToken({
        idToken: id_token,
        audience: GOOGLE_CLIENT_ID || undefined,
      });
      payload = ticket.getPayload();
    } catch {
      throw authRouteFailure(401, "invalid_token", "Invalid Google ID token.");
    }

    if (!hasVerifiedGoogleIdentity(payload)) {
      throw authRouteFailure(401, "google_identity_not_verified", "Google ID token must include a verified email identity.");
    }
    const provider_id = String(payload.sub).trim();
    const email = normalizeAuthEmail(payload.email);
    const display_name = cleanText(payload.name || email, 120);

    const pool = resolvePool();
    const connection = await pool.getConnection();
    let user_id;
    try {
      await connection.beginTransaction();
      const [credRows] = await connection.query(
        `SELECT user_id FROM \`user_credentials\` WHERE auth_provider = 'google' AND provider_id = ? LIMIT 1`,
        [provider_id]
      );
      if (credRows.length) {
        user_id = credRows[0].user_id;
      } else {
        const [userRows] = await connection.query(
          `SELECT user_id FROM \`users\` WHERE email = ? LIMIT 1`,
          [email]
        );
        if (userRows.length) {
          user_id = userRows[0].user_id;
        } else {
          user_id = randomUUID();
          const newTenantId = randomUUID();
          const tenantName = `${display_name || email}'s workspace`;
          await connection.query(
            `INSERT INTO \`users\` (user_id, email, display_name, status) VALUES (?, ?, ?, ?)`,
            [user_id, email, display_name, "active"]
          );
          await connection.query(
            `INSERT INTO \`tenants\` (tenant_id, tenant_type, display_name, status, metadata_json)
             VALUES (?, 'managed_client_account', ?, 'active', ?)`,
            [newTenantId, tenantName, JSON.stringify({ source: "google_signup" })]
          );
          await connection.query(
            `INSERT INTO \`memberships\` (user_id, tenant_id, role, status) VALUES (?, ?, 'owner', 'active')`,
            [user_id, newTenantId]
          );
        }
        await connection.query(
          `INSERT INTO \`user_credentials\` (user_id, auth_provider, provider_id) VALUES (?, ?, ?)`,
          [user_id, "google", provider_id]
        );
      }

      await ensureDefaultWorkspaceForUser(connection, {
        userId: user_id,
        email,
        displayName: display_name,
        source: "google_existing_user_workspace_repair",
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (!isDuplicateEntryError(error)) throw error;

      const recovered = await recoverGoogleJitIdentityAfterDuplicate({
        pool,
        connection,
        provider_id,
        email,
        display_name,
        ensureWorkspace: ensureDefaultWorkspaceForUser,
      });
      if (!recovered?.user_id) throw error;
      user_id = recovered.user_id;
    } finally {
      connection.release();
    }

    const [memberships] = await pool.query(
      `SELECT m.tenant_id, m.role, m.status, t.display_name AS tenant_display_name
       FROM \`memberships\` m
       LEFT JOIN \`tenants\` t ON t.tenant_id = m.tenant_id
       WHERE m.user_id = ? AND m.status = 'active'
       ORDER BY m.granted_at ASC`,
      [user_id]
    );
    return {
      user_id,
      email,
      display_name,
      tenant_id: memberships[0]?.tenant_id || null,
      memberships,
    };
  }

  async function resolveTenantGptOAuthCredential(credential) {
    if (!credential || typeof credential !== "object" || Array.isArray(credential)) {
      throw authRouteFailure(400, "missing_fields", "token or credential is required.");
    }
    if (typeof deps?.resolveTenantGptOAuthCredential === "function") {
      const resolved = await deps.resolveTenantGptOAuthCredential(credential);
      if (!resolved?.user_id) throw authRouteFailure(401, "invalid_credentials", "OAuth identity could not be resolved.");
      return resolved;
    }
    if (credential.kind === "login") return loginUserCredential(credential);
    if (credential.kind === "register") return registerUserCredential(credential);
    if (credential.kind === "google") return googleUserCredential(credential);
    throw authRouteFailure(400, "unsupported_credential", "OAuth credential kind is not supported.");
  }

  function legacyAuthResponse(identity) {
    return {
      ok: true,
      ...identity,
      token: jwt.sign(
        { user_id: identity.user_id, email: identity.email, tenant_id: identity.tenant_id || null },
        JWT_SECRET,
        { expiresIn: "7d" }
      ),
    };
  }

  if (typeof requireBackendApiKey === "function") {
    router.post("/platform-jwt/issue", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
      try {
        const {
          user_id,
          email,
          tenant_id = null,
          ttl_seconds,
          reason = "admin_assistant_jwt_client",
          resource = TENANT_GPT_CORE_RESOURCE,
        } = req.body || {};
        const pool = resolvePool();
        const user = await fetchActiveUserForJwtClient(pool, { user_id, email });
        if (!user) {
          return res.status(404).json({
            ok: false,
            error: {
              code: "user_not_found",
              message: "No active user found for the requested platform JWT client identity.",
            },
          });
        }

        const requestedTenantId = typeof tenant_id === "string" && tenant_id.trim() ? tenant_id.trim() : null;
        const membership = await fetchJwtClientMembership(pool, user.user_id, requestedTenantId);
        if (requestedTenantId && !membership) {
          return res.status(403).json({
            ok: false,
            error: {
              code: "tenant_membership_required",
              message: "The requested user does not have active membership in that tenant.",
            },
          });
        }

        const expiresIn = cleanTtlSeconds(ttl_seconds);
        const resolvedTenantId = requestedTenantId || membership?.tenant_id || null;
        const normalizedResource = normalizeTenantGptOAuthResource(resource);
        if (!normalizedResource) {
          return res.status(400).json({
            ok: false,
            error: {
              code: "invalid_target",
              message: "resource must be a registered Tenant GPT protected resource.",
            },
          });
        }
        const token = jwt.sign(
          {
            iss: PLATFORM_JWT_ISSUER,
            aud: normalizedResource,
            azp: TENANT_GPT_OAUTH_CLIENT_ID,
            client_id: TENANT_GPT_OAUTH_CLIENT_ID,
            resource: normalizedResource,
            sub: resolvedTenantId ? `tenant:${resolvedTenantId}:user:${user.user_id}` : `user:${user.user_id}`,
            user_id: user.user_id,
            email: user.email,
            tenant_id: resolvedTenantId,
            scope: TENANT_GPT_SCOPE,
            scope_links: TENANT_GPT_SCOPE_LINKS,
            purpose: "tenant_gpt_access",
            client: "admin_assistant",
            reason: cleanText(reason, 120) || "admin_assistant_jwt_client",
          },
          JWT_SECRET,
          { expiresIn, jwtid: randomUUID() }
        );

        return res.status(200).json({
          ok: true,
          token_type: "Bearer",
          access_token: token,
          expires_in: expiresIn,
          user: {
            user_id: user.user_id,
            email: user.email,
            display_name: user.display_name,
          },
          tenant: {
            tenant_id: resolvedTenantId,
            role: membership?.role || null,
            display_name: membership?.tenant_display_name || null,
          },
          next_step: "Use this access_token as Authorization: Bearer <USER_JWT> for tenant /connect/* operations.",
        });
      } catch (err) {
        return res.status(500).json({
          ok: false,
          error: {
            code: "platform_jwt_issue_failed",
            message: err.message,
          },
        });
      }
    });
  }

  router.get("/oauth/authorize", async (req, res) => {
    const oauthClientId = String(req.query.client_id || "");
    const responseType = String(req.query.response_type || "");
    const redirectUri = String(req.query.redirect_uri || "");
    const state = String(req.query.state || "");
    const requestedScope = cleanTenantGptRequestedScope(req.query.scope);
    const requestedResource = String(req.query.resource || "").trim();
    const resourceProfile = resolveTenantGptOAuthResourceProfile({
      clientId: oauthClientId,
      requestHost: tenantGptRequestHostFromHeaders(req.headers),
      requestedResource,
    });
    const activationContext = parseActivationContext(req.query);

    if (oauthClientId !== TENANT_GPT_OAUTH_CLIENT_ID) {
      return res.status(400).type("text/plain").send("OAuth client_id is not allowed for the Tenant GPT client.");
    }
    if (responseType !== "code") {
      return res.status(400).type("text/plain").send("OAuth response_type must be code for the Tenant GPT client.");
    }
    if (!state) {
      return res.status(400).type("text/plain").send("OAuth state is required for the Tenant GPT client.");
    }
    if (!resourceProfile.ok) {
      return res.status(400).type("text/plain").send(resourceProfile.message);
    }

    const query = (sql, params) => resolvePool().query(sql, params);
    const redirectDecision = await resolveTenantGptRedirectUriDecision(redirectUri, query);
    if (!redirectDecision.configuration_available) {
      return res.status(503).type("text/plain").send("OAuth configuration is temporarily unavailable. Please retry.");
    }
    if (!redirectDecision.allowed) {
      return res.status(400).type("text/plain").send("OAuth redirect_uri is not allowed for the Tenant GPT client.");
    }

    const authorizeSso = verifyTenantGptSsoSession(parseTenantGptSsoCookie(req.headers?.cookie), {
      jwtSecret: authEnv.JWT_SECRET || JWT_SECRET,
      expectedClientId: resourceProfile.client_id,
    });
    const authorizeRequestedScopes = requestedScope ? requestedScope.split(/\s+/u).filter(Boolean) : [];
    const ssoAvailable = req.query.prompt !== "login"
      && authorizeSso.ok
      && authorizeRequestedScopes.every((scope) => authorizeSso.claims.scopes.includes(scope));

    res.setHeader("cache-control", "no-store");
    return res
      .status(200)
      .type("html")
      .send(buildOAuthAuthorizeHtml({
        clientId: GOOGLE_CLIENT_ID,
        redirectUri,
        state,
        activationContext,
        requestedScope,
        oauthClientId: resourceProfile.client_id,
        oauthResource: resourceProfile.resource,
        ssoAvailable,
      }));
  });

  router.post("/oauth/code", async (req, res) => {
    const requestId = randomUUID();
    let stage = "request_validation";
    try {
      const { token, credential, redirect_uri, state, oauth_client_id, oauth_resource } = req.body || {};
      const requested_scope = cleanTenantGptRequestedScope(req.body?.scope);
      const resourceProfile = resolveTenantGptOAuthResourceProfile({
        clientId: oauth_client_id || TENANT_GPT_OAUTH_CLIENT_ID,
        requestHost: tenantGptRequestHostFromHeaders(req.headers),
        requestedResource: oauth_resource,
      });
      const activation_context = req.body?.activation_context && typeof req.body.activation_context === "object"
        ? parseActivationContext(req.body.activation_context)
        : {};
      const requestedScopes = requested_scope ? requested_scope.split(/\s+/u).filter(Boolean) : [];
      const ssoCookie = parseTenantGptSsoCookie(req.headers?.cookie);
      const ssoSession = (!token && !credential && req.body?.prompt !== "login")
        ? verifyTenantGptSsoSession(ssoCookie, {
          jwtSecret: authEnv.JWT_SECRET || JWT_SECRET,
          expectedClientId: resourceProfile.client_id,
        })
        : { ok: false, code: "session_not_requested" };
      if (!redirect_uri || (!token && !credential && !ssoSession.ok)) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "redirect_uri and either token, credential, or a valid SSO session are required." } });
      }
      if (!state) {
        return res.status(400).json({ ok: false, error: { code: "missing_state", message: "state is required." } });
      }
      if (!resourceProfile.ok) {
        return res.status(400).json({ ok: false, error: { code: resourceProfile.error, message: resourceProfile.message } });
      }
      const query = (sql, params) => resolvePool().query(sql, params);
      stage = "oauth_client_config";
      const redirectDecision = await resolveTenantGptRedirectUriDecision(redirect_uri, query);
      if (!redirectDecision.configuration_available) {
        const error = new Error("OAuth client configuration is unavailable.");
        error.code = redirectDecision.error_code || "oauth_configuration_unavailable";
        throw error;
      }
      if (!redirectDecision.allowed) {
        return res.status(400).json({ ok: false, error: { code: "invalid_redirect_uri", message: "redirect_uri is not allowed for the Tenant GPT client." } });
      }

      stage = "identity_resolution";
      let payload;
      if (ssoSession.ok) {
        if (requestedScopes.some((scope) => !ssoSession.claims.scopes.includes(scope))) {
          return res.status(400).json({ ok: false, error: { code: "incremental_consent_required", message: "The requested scope is not covered by the existing SSO session." } });
        }
        const pool = resolvePool();
        const [userRows] = await pool.query(
          `SELECT user_id, email, display_name, status FROM \`users\` WHERE user_id = ? LIMIT 1`,
          [ssoSession.claims.user_id],
        );
        const activeUser = userRows?.[0];
        if (!activeUser || activeUser.status !== "active") {
          return res.status(401).json({ ok: false, error: { code: "session_subject_inactive", message: "The SSO session subject is no longer active." } });
        }
        const membership = await fetchJwtClientMembership(pool, activeUser.user_id, ssoSession.claims.tenant_id);
        if (!membership || membership.status !== "active") {
          return res.status(403).json({ ok: false, error: { code: "session_membership_inactive", message: "The SSO session workspace membership is no longer active." } });
        }
        payload = {
          user_id: activeUser.user_id,
          email: activeUser.email,
          tenant_id: membership.tenant_id,
        };
      } else {
        payload = token
          ? jwt.verify(token, JWT_SECRET)
          : await resolveTenantGptOAuthCredential(credential);
      }
      if (!payload.user_id) {
        return res.status(400).json({ ok: false, error: { code: "invalid_token", message: "User token is missing user_id." } });
      }
      const codeJti = randomUUID();
      const canonicalRedirectUri = canonicalizeTenantGptRedirectUri(redirect_uri) || redirect_uri;
      const codeExpiresAt = new Date(Date.now() + OAUTH_CODE_TTL_SECONDS * 1000);
      stage = "authorization_code_sign";
      const code = jwt.sign(
        {
          purpose: "custom_gpt_oauth_code",
          user_id: payload.user_id,
          email: payload.email,
          tenant_id: payload.tenant_id || null,
          redirect_uri: canonicalRedirectUri,
          scope: requested_scope || null,
          client_id: resourceProfile.client_id,
          resource: resourceProfile.resource,
          activation_context,
        },
        JWT_SECRET,
        { expiresIn: OAUTH_CODE_TTL_SECONDS, jwtid: codeJti }
      );
      stage = "authorization_code_store";
      await persistTenantGptOAuthAuthorizationCode({
        query,
        jti: codeJti,
        user_id: payload.user_id,
        tenant_id: payload.tenant_id || null,
        client_id: resourceProfile.client_id,
        redirect_uri: canonicalRedirectUri,
        expires_at: codeExpiresAt,
      });

      if (payload.tenant_id) {
        const ssoToken = issueTenantGptSsoSession({
          user_id: payload.user_id,
          tenant_id: payload.tenant_id,
          email: payload.email,
          client_id: resourceProfile.client_id,
          scopes: requestedScopes,
          jwtSecret: authEnv.JWT_SECRET || JWT_SECRET,
          ttlSeconds: ssoSessionTtlSeconds,
        });
        res.setHeader("Set-Cookie", buildTenantGptSsoCookieHeader(ssoToken, { ttlSeconds: ssoSessionTtlSeconds }));
      }

      return res.status(200).json({
        ok: true,
        code,
        expires_in: OAUTH_CODE_TTL_SECONDS,
        resource: resourceProfile.resource,
        activation_context,
        redirect_to: appendOAuthParams(canonicalizeTenantGptRedirectUri(redirect_uri) || redirect_uri, { code, state }),
      });
    } catch (error) {
      if (Number.isInteger(error?.auth_status) && error?.auth_code) {
        return sendAuthRouteFailure(res, error, "oauth_identity_failed");
      }
      if (stage === "oauth_client_config") {
        return sendOAuthInfrastructureFailure(res, {
          requestId,
          stage,
          error,
          code: "oauth_configuration_unavailable",
          message: "OAuth configuration is temporarily unavailable. Please retry.",
        });
      }
      if (stage === "authorization_code_store") {
        return sendOAuthInfrastructureFailure(res, {
          requestId,
          stage,
          error,
          code: "oauth_code_store_unavailable",
          message: "OAuth sign-in is temporarily unavailable. Please retry.",
        });
      }
      if (stage === "identity_resolution" && !req.body?.token) {
        return sendOAuthInfrastructureFailure(res, {
          requestId,
          stage,
          error,
          code: "oauth_identity_unavailable",
          message: "OAuth identity service is temporarily unavailable. Please retry.",
        });
      }
      if (stage === "identity_resolution" && req.body?.token) {
        return res.status(401).json({ ok: false, error: { code: "invalid_token", message: "User token is invalid or expired." } });
      }
      return sendOAuthInfrastructureFailure(res, {
        requestId,
        stage,
        error,
        code: "oauth_code_issue_unavailable",
        message: "OAuth sign-in is temporarily unavailable. Please retry.",
      });
    }
  });

  router.post("/oauth/token", express.urlencoded({ extended: false }), async (req, res) => {
    const startedAtMs = Date.now();
    const requestId = randomUUID();
    const tokenQuery = (sql, params) => resolvePool().query(sql, params);
    let tokenLogContext = {};
    const logTokenExchange = (status, failureReason, httpStatus, extra = {}) => {
      void recordOAuthTokenDiagnostic(tokenQuery, {
        started_at_ms: startedAtMs,
        duration_ms: Date.now() - startedAtMs,
        request_id: requestId,
        status,
        failure_reason: failureReason,
        http_status: httpStatus,
        ...tokenLogContext,
        ...extra,
      });
    };

    try {
      const grantType = req.body?.grant_type;
      const code = req.body?.code;
      const redirectUri = req.body?.redirect_uri;
      const credentials = oauthClientCredentials(req);
      tokenLogContext = {
        grant_type: grantType || null,
        code_present: Boolean(code),
        code_timing: safeOAuthCodeTimingEvidence(code, startedAtMs),
        redirect_uri: safeOAuthRedirectEvidence(redirectUri),
        client: safeOAuthClientEvidence(credentials),
      };

      if (grantType !== "authorization_code") {
        logTokenExchange("failed", "unsupported_grant_type", 400);
        return res.status(400).json({ error: "unsupported_grant_type", error_description: "Only authorization_code is supported." });
      }
      if (!code) {
        logTokenExchange("failed", "missing_code", 400);
        return res.status(400).json({ error: "invalid_request", error_description: "code is required." });
      }

      const clientValidation = await validateTenantGptOAuthClientCredentials(
        credentials,
        { query: tokenQuery }
      );
      if (!clientValidation.ok) {
        logTokenExchange("failed", clientValidation.error || "invalid_client", clientValidation.status || 401, {
          client_validation_source: clientValidation.source || null,
        });
        return res.status(clientValidation.status || 401).json({
          error: clientValidation.error || "invalid_client",
          error_description: clientValidation.message || "Invalid OAuth client credentials.",
        });
      }
      tokenLogContext.client_validation_source = clientValidation.source || null;
      const resourceProfile = resolveTenantGptOAuthResourceProfile({
        clientId: clientValidation.client_id,
        requestHost: tenantGptRequestHostFromHeaders(req.headers),
        requestedResource: req.body?.resource,
      });
      if (!resourceProfile.ok) {
        logTokenExchange("failed", resourceProfile.error, 400);
        return res.status(400).json({
          error: resourceProfile.error,
          error_description: resourceProfile.message,
        });
      }

      const codePayload = jwt.verify(code, JWT_SECRET);
      tokenLogContext.code_redirect_uri = safeOAuthRedirectEvidence(codePayload.redirect_uri);
      tokenLogContext.code_jti_present = Boolean(codePayload.jti);
      tokenLogContext.user_id_present = Boolean(codePayload.user_id);
      tokenLogContext.tenant_id_present = Boolean(codePayload.tenant_id);
      tokenLogContext.requested_scope = safeOAuthScopeEvidence(codePayload.scope);
      const codeClientId = String(codePayload.client_id || "").trim();
      const codeResource = normalizeTenantGptOAuthResource(codePayload.resource);
      if (codeClientId && codeClientId !== clientValidation.client_id) {
        logTokenExchange("failed", "oauth_code_client_mismatch", 400);
        return res.status(400).json({ error: "invalid_grant", error_description: "OAuth code does not match this client." });
      }
      if (codePayload.resource && !codeResource) {
        logTokenExchange("failed", "oauth_code_resource_invalid", 400);
        return res.status(400).json({ error: "invalid_grant", error_description: "OAuth code resource is invalid." });
      }
      if (codeResource && codeResource !== resourceProfile.resource) {
        logTokenExchange("failed", "oauth_code_resource_mismatch", 400);
        return res.status(400).json({ error: "invalid_target", error_description: "OAuth code does not match this protected resource." });
      }
      const effectiveResource = codeResource || resourceProfile.resource;
      if (codePayload.purpose !== "custom_gpt_oauth_code" || !codePayload.user_id) {
        logTokenExchange("failed", "invalid_oauth_code_payload", 400);
        return res.status(400).json({ error: "invalid_grant", error_description: "Invalid OAuth code." });
      }
      if (redirectUri && !equivalentTenantGptRedirectUri(redirectUri, codePayload.redirect_uri)) {
        logTokenExchange("failed", "redirect_uri_mismatch", 400);
        return res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri does not match the issued code." });
      }
      const codeConsumption = await consumeTenantGptOAuthAuthorizationCode({
        query: tokenQuery,
        jti: codePayload.jti,
        client_id: clientValidation.client_id,
        redirect_uri: codePayload.redirect_uri,
      });
      if (!codeConsumption.consumed) {
        logTokenExchange("failed", "oauth_code_reuse_or_binding_mismatch", 400);
        return res.status(400).json({ error: "invalid_grant", error_description: "OAuth code has already been used or does not match this client." });
      }

      const pool = resolvePool();
      const [userRows] = await pool.query(
        `SELECT user_id, email, display_name, status FROM \`users\` WHERE user_id = ? LIMIT 1`,
        [codePayload.user_id]
      );
      const tokenUser = userRows[0];
      if (!tokenUser || tokenUser.status !== "active") {
        logTokenExchange("failed", "user_inactive_or_missing", 400);
        return res.status(400).json({ error: "invalid_grant", error_description: "User account is no longer active." });
      }
      const [memRows] = await pool.query(
        `SELECT m.tenant_id FROM \`memberships\` m WHERE m.user_id = ? AND m.status = 'active' ORDER BY m.granted_at ASC LIMIT 1`,
        [codePayload.user_id]
      );
      const tenantId = codePayload.tenant_id || memRows[0]?.tenant_id || null;
      const accessJti = randomUUID();
      const accessExpiresAt = new Date(Date.now() + USER_TOKEN_TTL_SECONDS * 1000);
      const accessToken = issueTenantGptAccessToken(
        { user_id: tokenUser.user_id, email: tokenUser.email, tenant_id: tenantId },
        { clientId: clientValidation.client_id, jwtid: accessJti, compact: true, resource: effectiveResource }
      );
      const activationContextRecord = await recordTenantGptActivationContext({
        query: tokenQuery,
        access_jti: accessJti,
        oauth_code_jti: codePayload.jti,
        user_id: tokenUser.user_id,
        tenant_id: tenantId,
        client_id: clientValidation.client_id,
        activation_context: codePayload.activation_context,
        expires_at: accessExpiresAt,
      });

      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      logTokenExchange("success", null, 200, {
        access_token: {
          token_type: "bearer",
          length: accessToken.length,
        },
        activation_context: {
          stored: activationContextRecord.stored === true,
          source: activationContextRecord.source || null,
          reason: activationContextRecord.reason || null,
        },
      });
      const tokenResponse = {
        access_token: accessToken,
        token_type: "bearer",
        expires_in: USER_TOKEN_TTL_SECONDS,
      };
      if (codePayload.scope) tokenResponse.scope = codePayload.scope;
      return res.status(200).json(tokenResponse);
    } catch (err) {
      logTokenExchange("failed", err?.name === "TokenExpiredError" ? "oauth_code_expired" : "oauth_code_invalid_or_exception", 400, {
        exception_name: err?.name || null,
      });
      return res.status(400).json({ error: "invalid_grant", error_description: "OAuth code is invalid or expired." });
    }
  });

  // ── POST /auth/register ─────────────────────────────────────────────────────
  router.post("/register", async (req, res) => {
    try {
      return res.status(201).json(legacyAuthResponse(await registerUserCredential(req.body || {})));
    } catch (err) {
      return sendAuthRouteFailure(res, err, "registration_failed");
    }
  });

  // ── POST /auth/login ────────────────────────────────────────────────────────
  router.post("/login", async (req, res) => {
    try {
      return res.status(200).json(legacyAuthResponse(await loginUserCredential(req.body || {})));
    } catch (err) {
      return sendAuthRouteFailure(res, err, "login_failed");
    }
  });

  // ── POST /auth/password/forgot ─────────────────────────────────────────────
  router.post("/password/forgot", async (req, res) => {
    try {
      await ensurePasswordResetTables();
      const email = cleanText(req.body?.email, 255).toLowerCase();
      const returnTo = safeReturnTo(req.body?.return_to || req.body?.returnTo || "/connect");
      if (!email) {
        return res.status(400).json({ ok: false, error: { code: "missing_email", message: "email is required." } });
      }

      const generic = {
        ok: true,
        message: "If an active account exists for that email, password reset instructions have been queued.",
        email_delivery_configured: emailDeliveryConfigured(),
        secrets_included: false,
      };

      const [rows] = await getPool().query(
        `SELECT user_id, email, display_name, status FROM \`users\` WHERE email = ? LIMIT 1`,
        [email]
      );
      const user = rows[0] || null;
      if (!user || user.status !== "active") return res.status(200).json(generic);

      const resetId = randomUUID();
      const rawToken = secureToken(36);
      const tokenHash = sha256(rawToken);
      const resetUrl = `${PASSWORD_RESET_BASE_URL}/auth/password/reset?token=${encodeURIComponent(rawToken)}&return_to=${encodeURIComponent(returnTo)}`;
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000);

      await getPool().query(
        `UPDATE \`auth_password_reset_tokens\`
            SET status = 'revoked'
          WHERE user_id = ? AND status = 'pending' AND expires_at > NOW()`,
        [user.user_id]
      );
      await getPool().query(
        `INSERT INTO \`auth_password_reset_tokens\`
          (reset_id, user_id, email, token_hash, status, requested_ip, requested_user_agent, expires_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
        [resetId, user.user_id, user.email, tokenHash, cleanText(req.ip || req.socket?.remoteAddress || "", 64), cleanText(req.get("user-agent") || "", 255), expiresAt]
      );
      await getPool().query(
        `INSERT INTO \`auth_email_outbox\`
          (email_id, purpose, recipient_email, subject, body_text, body_html, status, metadata_json)
         VALUES (?, 'password_reset', ?, ?, ?, ?, 'queued', ?)`,
        [
          randomUUID(),
          user.email,
          "Reset your Mad4B password",
          `Reset your Mad4B password:\n\n${resetUrl}\n\nThis link expires in 30 minutes. If you did not request it, ignore this message.`,
          `<p>Reset your Mad4B password:</p><p><a href="${escapeHtmlAttribute(resetUrl)}">Reset password</a></p><p>This link expires in 30 minutes. If you did not request it, ignore this message.</p>`,
          JSON.stringify({ reset_id: resetId, return_to: returnTo, delivery_configured: emailDeliveryConfigured() }),
        ]
      );

      return res.status(200).json(generic);
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "password_reset_request_failed", message: err.message }, secrets_included: false });
    }
  });

  // ── GET /auth/password/reset ───────────────────────────────────────────────
  router.get("/password/reset", (req, res) => {
    const token = cleanText(req.query?.token, 512);
    const returnTo = safeReturnTo(req.query?.return_to || "/connect");
    res.setHeader("cache-control", "no-store");
    return res.status(200).type("html").send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Reset password · Mad4B</title>
<style>body{font-family:Arial,sans-serif;margin:0;background:#07111f;color:#f0f5ff;display:grid;min-height:100vh;place-items:center}main{width:min(460px,calc(100vw - 32px));background:#101a30;border:1px solid #2d3f62;border-radius:22px;padding:26px;box-shadow:0 24px 70px rgba(0,0,0,.28)}label{display:block;margin:12px 0 5px;color:#a8b6d8;font-size:13px}input{width:100%;box-sizing:border-box;border-radius:14px;border:1px solid #2d3f62;padding:12px;background:#0b1428;color:#f0f5ff}button,a{display:inline-flex;border-radius:14px;border:1px solid #87a0ff;padding:12px 16px;color:white;background:#6383ff;text-decoration:none;font-weight:800;margin-top:14px}pre{white-space:pre-wrap;background:#0b1428;border:1px solid #2d3f62;border-radius:14px;padding:12px}</style></head>
<body><main><h1>Reset your password</h1><p>Enter a new password for your Mad4B account.</p><label>New password</label><input id="password" type="password" autocomplete="new-password" minlength="8"/><button id="reset">Reset password</button><a href="${escapeHtmlAttribute(returnTo)}">Back</a><pre id="out">Waiting.</pre></main>
<script>const token=${JSON.stringify(token)};const returnTo=${JSON.stringify(returnTo)};const out=document.getElementById('out');document.getElementById('reset').onclick=async()=>{const password=document.getElementById('password').value;const res=await fetch('/auth/password/reset',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,password})});const data=await res.json();out.textContent=JSON.stringify(data,null,2);if(res.ok&&data.ok){setTimeout(()=>location.assign(returnTo),1200);}};</script></body></html>`);
  });

  // ── POST /auth/password/reset ──────────────────────────────────────────────
  router.post("/password/reset", async (req, res) => {
    try {
      await ensurePasswordResetTables();
      const token = cleanText(req.body?.token, 512);
      const password = String(req.body?.password || "");
      if (!token || !password) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "token and password are required." }, secrets_included: false });
      }
      if (password.length < 8) {
        return res.status(400).json({ ok: false, error: { code: "weak_password", message: "Password must be at least 8 characters." }, secrets_included: false });
      }

      const [rows] = await getPool().query(
        `SELECT * FROM \`auth_password_reset_tokens\`
          WHERE token_hash = ? AND status = 'pending'
          LIMIT 1`,
        [sha256(token)]
      );
      const reset = rows[0] || null;
      if (!reset || new Date(reset.expires_at).getTime() <= Date.now()) {
        if (reset) {
          await getPool().query(`UPDATE \`auth_password_reset_tokens\` SET status = 'expired' WHERE reset_id = ?`, [reset.reset_id]);
        }
        return res.status(400).json({ ok: false, error: { code: "invalid_or_expired_token", message: "Password reset link is invalid or expired." }, secrets_included: false });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const connection = await getPool().getConnection();
      try {
        await connection.beginTransaction();
        await connection.query(
          `INSERT INTO \`user_credentials\` (user_id, auth_provider, password_hash)
           VALUES (?, 'platform', ?)
           ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
          [reset.user_id, passwordHash]
        );
        await connection.query(
          `UPDATE \`auth_password_reset_tokens\` SET status = 'used', used_at = NOW() WHERE reset_id = ?`,
          [reset.reset_id]
        );
        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }

      return res.status(200).json({ ok: true, message: "Password has been reset. You can sign in with the new password.", secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "password_reset_failed", message: err.message }, secrets_included: false });
    }
  });

  // ── POST /auth/google ───────────────────────────────────────────────────────
  router.post("/google", async (req, res) => {
    try {
      return res.status(200).json(legacyAuthResponse(await googleUserCredential(req.body || {})));
    } catch (err) {
      return sendAuthRouteFailure(res, err, "google_auth_failed");
    }
  });

  return router;
}
