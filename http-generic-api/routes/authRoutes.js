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
  resolveTenantGptOAuthClientConfig,
  validateTenantGptOAuthClientCredentials,
} from "../tenantGptOAuthClientConfig.js";

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
const TENANT_GPT_JWT_AUDIENCE = process.env.TENANT_GPT_JWT_AUDIENCE || "mad4b-tenant-gpt";

// Single-use OAuth code tracking: jti → expiry ms. Lazily cleaned.
const _usedOAuthCodeJtis = new Map();
function _markOAuthCodeUsed(jti, expSecs) {
  _usedOAuthCodeJtis.set(jti, expSecs * 1000);
  if (_usedOAuthCodeJtis.size > 1000) {
    const now = Date.now();
    for (const [k, e] of _usedOAuthCodeJtis) {
      if (e <= now) _usedOAuthCodeJtis.delete(k);
    }
  }
}
function _isOAuthCodeUsed(jti) {
  const exp = _usedOAuthCodeJtis.get(jti);
  return exp !== undefined && exp > Date.now();
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

function issueTenantGptAccessToken(payload, { clientId = TENANT_GPT_OAUTH_CLIENT_ID } = {}) {
  const userId = String(payload?.user_id || "").trim();
  if (!userId) {
    const err = new Error("Cannot issue tenant GPT token without user_id.");
    err.code = "missing_user_id";
    throw err;
  }

  const tenantId = payload?.tenant_id ? String(payload.tenant_id).trim() : null;
  const email = payload?.email ? String(payload.email).trim() : null;
  const subject = tenantId ? `tenant:${tenantId}:user:${userId}` : `user:${userId}`;

  return jwt.sign(
    {
      iss: PLATFORM_JWT_ISSUER,
      aud: TENANT_GPT_JWT_AUDIENCE,
      sub: subject,
      user_id: userId,
      email,
      tenant_id: tenantId,
      scope: TENANT_GPT_SCOPE,
      scope_links: TENANT_GPT_SCOPE_LINKS,
      purpose: "tenant_gpt_access",
      client_id: String(clientId || TENANT_GPT_OAUTH_CLIENT_ID).trim() || TENANT_GPT_OAUTH_CLIENT_ID,
    },
    JWT_SECRET,
    { expiresIn: USER_TOKEN_TTL_SECONDS, jwtid: randomUUID() }
  );
}

async function fetchActiveUserForJwtClient(pool, { user_id, email }) {
  const hasUserId = typeof user_id === "string" && user_id.trim();
  const hasEmail = typeof email === "string" && email.trim();
  if (!hasUserId && !hasEmail) return null;

  const where = hasUserId ? "u.user_id = ?" : "u.email = ?";
  const param = hasUserId ? user_id.trim() : email.trim();
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
    `SELECT m.tenant_id
       FROM \`memberships\` m
      WHERE m.user_id = ? AND m.status = 'active'
      ORDER BY m.granted_at ASC
      LIMIT 1`,
    [userId]
  );
  if (memberships.length) return { created: false, tenant_id: memberships[0].tenant_id };

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

function callbackPatternToRegExp(pattern) {
  const escaped = String(pattern || "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace("\\{g-GPT-ID\\}", "g-[a-z0-9]+");
  return new RegExp(`^${escaped}$`, "i");
}

async function isAllowedTenantGptRedirectUri(redirectUri, queryFn) {
  const url = parseOAuthRedirectUri(redirectUri);
  if (!url) return false;

  const normalized = url.toString();
  const resolved = await resolveTenantGptOAuthClientConfig({ query: queryFn });
  const callbacks = Array.isArray(resolved.config?.callback_urls_to_allow)
    ? resolved.config.callback_urls_to_allow
    : [];

  return callbacks.some((callback) => {
    if (callback === normalized) return true;
    return callback.includes("{g-GPT-ID}") && callbackPatternToRegExp(callback).test(normalized);
  });
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

function buildOAuthAuthorizeHtml({ clientId, redirectUri, state, activationContext }) {
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
    <p>Sign in to connect this GPT to your tenant workspace and continue activation.</p>
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
      <a href="/connect" target="_blank" rel="noopener">Open setup page</a>
      <span aria-hidden="true"> | </span>
      <a href="/privacy-policy" target="_blank" rel="noopener">Privacy Policy</a>
      <span aria-hidden="true"> | </span>
      <a href="/terms-of-use" target="_blank" rel="noopener">Terms of Use</a>
    </div>
  </main>
  <script src="https://accounts.google.com/gsi/client" async defer></script>
  <script>
    const GOOGLE_CLIENT_ID = ${JSON.stringify(String(clientId || ""))};
    const REDIRECT_URI = ${JSON.stringify(String(redirectUri || ""))};
    const STATE = ${JSON.stringify(String(state || ""))};
    const ACTIVATION_CONTEXT = ${JSON.stringify(activationContext || {})};
    const INITIAL_PANEL = ${JSON.stringify(initialPanel)};
    const errorBox = document.getElementById("error");
    function showError(message){ errorBox.textContent = message || "Sign-in failed."; }
    function setPanel(panel){
      document.querySelectorAll("nav button").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.panel === panel)));
      document.querySelectorAll("section[id^='panel-']").forEach((section) => { section.hidden = section.id !== "panel-" + panel; });
    }
    document.querySelectorAll("nav button").forEach((button) => button.addEventListener("click", () => setPanel(button.dataset.panel)));
    setPanel(INITIAL_PANEL);
    async function issueOAuthCode(token){
      const codeRes = await fetch("/auth/oauth/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, redirect_uri: REDIRECT_URI, state: STATE, activation_context: ACTIVATION_CONTEXT })
      });
      const codeData = await codeRes.json();
      if (!codeRes.ok || !codeData.redirect_to) throw new Error(codeData?.error?.message || "Could not complete OAuth sign-in.");
      window.location.assign(codeData.redirect_to);
    }
    async function submitCredentials(path, form){
      const payload = Object.fromEntries(new FormData(form).entries());
      const authRes = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const authData = await authRes.json();
      if (!authRes.ok || !authData.token) throw new Error(authData?.error?.message || "Sign-in failed.");
      await issueOAuthCode(authData.token);
    }
    document.getElementById("login-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try { await submitCredentials("/auth/login", event.currentTarget); } catch (err) { showError(err.message); }
    });
    document.getElementById("register-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try { await submitCredentials("/auth/register", event.currentTarget); } catch (err) { showError(err.message); }
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
            const authRes = await fetch("/auth/google", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ id_token: response.credential })
            });
            const authData = await authRes.json();
            if (!authRes.ok || !authData.token) throw new Error(authData?.error?.message || "Google sign-in failed.");
            await issueOAuthCode(authData.token);
          } catch (err) {
            showError(err.message);
          }
        }
      });
      window.google.accounts.id.renderButton(document.getElementById("gsi-btn-container"), {
        theme: "outline",
        size: "large",
        width: 320,
        text: "continue_with",
        locale: "en"
      });
    }
    setup();
  </script>
</body>
</html>`;
}

export function buildAuthRoutes(deps) {
  const router = Router();
  const requireBackendApiKey = deps?.requireBackendApiKey;
  const resolvePool = typeof deps?.getPool === "function" ? deps.getPool : getPool;

  if (typeof requireBackendApiKey === "function") {
    router.post("/platform-jwt/issue", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
      try {
        const { user_id, email, tenant_id = null, ttl_seconds, reason = "admin_assistant_jwt_client" } = req.body || {};
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
        const token = jwt.sign(
          {
            user_id: user.user_id,
            email: user.email,
            tenant_id: resolvedTenantId,
            purpose: "platform_jwt_client",
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
    const redirectUri = String(req.query.redirect_uri || "");
    const state = String(req.query.state || "");
    const activationContext = parseActivationContext(req.query);

    const query = (sql, params) => resolvePool().query(sql, params);
    if (!(await isAllowedTenantGptRedirectUri(redirectUri, query))) {
      return res.status(400).type("text/plain").send("OAuth redirect_uri is not allowed for the Tenant GPT client.");
    }

    res.setHeader("cache-control", "no-store");
    return res
      .status(200)
      .type("html")
      .send(buildOAuthAuthorizeHtml({ clientId: GOOGLE_CLIENT_ID, redirectUri, state, activationContext }));
  });

  router.post("/oauth/code", async (req, res) => {
    try {
      const { token, redirect_uri, state } = req.body || {};
      const activation_context = req.body?.activation_context && typeof req.body.activation_context === "object"
        ? parseActivationContext(req.body.activation_context)
        : {};
      if (!token || !redirect_uri) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "token and redirect_uri are required." } });
      }
      const query = (sql, params) => resolvePool().query(sql, params);
      if (!(await isAllowedTenantGptRedirectUri(redirect_uri, query))) {
        return res.status(400).json({ ok: false, error: { code: "invalid_redirect_uri", message: "redirect_uri is not allowed for the Tenant GPT client." } });
      }

      const payload = jwt.verify(token, JWT_SECRET);
      if (!payload.user_id) {
        return res.status(400).json({ ok: false, error: { code: "invalid_token", message: "User token is missing user_id." } });
      }
      const code = jwt.sign(
        {
          purpose: "custom_gpt_oauth_code",
          user_id: payload.user_id,
          email: payload.email,
          tenant_id: payload.tenant_id || null,
          redirect_uri,
          activation_context,
        },
        JWT_SECRET,
        { expiresIn: OAUTH_CODE_TTL_SECONDS, jwtid: randomUUID() }
      );

      return res.status(200).json({
        ok: true,
        code,
        expires_in: OAUTH_CODE_TTL_SECONDS,
        activation_context,
        redirect_to: appendOAuthParams(redirect_uri, { code, state }),
      });
    } catch {
      return res.status(401).json({ ok: false, error: { code: "invalid_token", message: "User token is invalid or expired." } });
    }
  });

  router.post("/oauth/token", express.urlencoded({ extended: false }), async (req, res) => {
    try {
      const grantType = req.body?.grant_type;
      const code = req.body?.code;
      const redirectUri = req.body?.redirect_uri;

      if (grantType !== "authorization_code") {
        return res.status(400).json({ error: "unsupported_grant_type", error_description: "Only authorization_code is supported." });
      }
      if (!code) {
        return res.status(400).json({ error: "invalid_request", error_description: "code is required." });
      }

      const clientValidation = await validateTenantGptOAuthClientCredentials(
        oauthClientCredentials(req),
        { query: (sql, params) => resolvePool().query(sql, params) }
      );
      if (!clientValidation.ok) {
        return res.status(clientValidation.status || 401).json({
          error: clientValidation.error || "invalid_client",
          error_description: clientValidation.message || "Invalid OAuth client credentials.",
        });
      }

      const codePayload = jwt.verify(code, JWT_SECRET);
      if (codePayload.purpose !== "custom_gpt_oauth_code" || !codePayload.user_id) {
        return res.status(400).json({ error: "invalid_grant", error_description: "Invalid OAuth code." });
      }
      if (redirectUri && redirectUri !== codePayload.redirect_uri) {
        return res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri does not match the issued code." });
      }
      if (_isOAuthCodeUsed(codePayload.jti)) {
        return res.status(400).json({ error: "invalid_grant", error_description: "OAuth code has already been used." });
      }
      _markOAuthCodeUsed(codePayload.jti, codePayload.exp);

      const pool = resolvePool();
      const [userRows] = await pool.query(
        `SELECT user_id, email, display_name, status FROM \`users\` WHERE user_id = ? LIMIT 1`,
        [codePayload.user_id]
      );
      const tokenUser = userRows[0];
      if (!tokenUser || tokenUser.status !== "active") {
        return res.status(400).json({ error: "invalid_grant", error_description: "User account is no longer active." });
      }
      const [memRows] = await pool.query(
        `SELECT m.tenant_id FROM \`memberships\` m WHERE m.user_id = ? AND m.status = 'active' ORDER BY m.granted_at ASC LIMIT 1`,
        [codePayload.user_id]
      );
      const tenantId = codePayload.tenant_id || memRows[0]?.tenant_id || null;
      const accessToken = issueTenantGptAccessToken(
        { user_id: tokenUser.user_id, email: tokenUser.email, tenant_id: tenantId },
        { clientId: clientValidation.client_id }
      );

      return res.status(200).json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: USER_TOKEN_TTL_SECONDS,
        scope: TENANT_GPT_SCOPE,
        activation_context: codePayload.activation_context || {},
      });
    } catch {
      return res.status(400).json({ error: "invalid_grant", error_description: "OAuth code is invalid or expired." });
    }
  });

  // ── POST /auth/register ─────────────────────────────────────────────────────
  router.post("/register", async (req, res) => {
    try {
      const { email, password, display_name, tenant_display_name } = req.body || {};
      if (!email || !password || !display_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "email, password, and display_name are required." } });
      }

      const user_id = randomUUID();
      const tenant_id = randomUUID();
      const password_hash = await bcrypt.hash(password, 10);
      const tenantName = tenant_display_name || `${display_name}'s workspace`;

      // Attempt to create user
      const connection = await getPool().getConnection();
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
      } catch (err) {
        await connection.rollback();
        if (err.code === "ER_DUP_ENTRY") {
          return res.status(409).json({ ok: false, error: { code: "user_already_exists", message: "A user with this email already exists." } });
        }
        throw err;
      } finally {
        connection.release();
      }

      // Generate token
      const token = jwt.sign({ user_id, email, tenant_id }, JWT_SECRET, { expiresIn: "7d" });

      return res.status(201).json({
        ok: true,
        user_id,
        email,
        display_name,
        tenant_id,
        memberships: [{ tenant_id, role: "owner", status: "active" }],
        token
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "registration_failed", message: err.message } });
    }
  });

  // ── POST /auth/login ────────────────────────────────────────────────────────
  router.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "email and password are required." } });
      }

      const [rows] = await getPool().query(
        `SELECT u.user_id, u.email, u.display_name, u.status, uc.password_hash
         FROM \`users\` u
         JOIN \`user_credentials\` uc ON u.user_id = uc.user_id
         WHERE u.email = ? AND uc.auth_provider = 'platform' LIMIT 1`,
        [email]
      );

      if (!rows.length) {
        return res.status(401).json({ ok: false, error: { code: "invalid_credentials", message: "Invalid email or password." } });
      }

      const user = rows[0];
      if (user.status !== "active") {
        return res.status(403).json({ ok: false, error: { code: "account_inactive", message: "Account is not active." } });
      }

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(401).json({ ok: false, error: { code: "invalid_credentials", message: "Invalid email or password." } });
      }

      const [memberships] = await getPool().query(
        `SELECT m.tenant_id, m.role, m.status, t.display_name AS tenant_display_name
           FROM \`memberships\` m
           LEFT JOIN \`tenants\` t ON t.tenant_id = m.tenant_id
          WHERE m.user_id = ? AND m.status = 'active'
          ORDER BY m.granted_at ASC`,
        [user.user_id]
      );
      const tenant_id = memberships[0]?.tenant_id || null;

      // Generate token
      const token = jwt.sign({ user_id: user.user_id, email: user.email, tenant_id }, JWT_SECRET, { expiresIn: "7d" });

      return res.status(200).json({
        ok: true,
        user_id: user.user_id,
        email: user.email,
        display_name: user.display_name,
        tenant_id,
        memberships,
        token
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "login_failed", message: err.message } });
    }
  });

  // ── POST /auth/google ───────────────────────────────────────────────────────
  router.post("/google", async (req, res) => {
    try {
      const { id_token } = req.body || {};
      if (!id_token) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "id_token is required." } });
      }

      // Verify Google token
      let payload;
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: id_token,
          audience: GOOGLE_CLIENT_ID ? GOOGLE_CLIENT_ID : undefined,
        });
        payload = ticket.getPayload();
      } catch (verifyErr) {
        return res.status(401).json({ ok: false, error: { code: "invalid_token", message: "Invalid Google ID token." } });
      }

      const { sub: provider_id, email, name: display_name } = payload;

      const connection = await getPool().getConnection();
      let user_id;

      try {
        await connection.beginTransaction();

        // Check if user credentials already exist for this Google ID
        const [credRows] = await connection.query(
          `SELECT user_id FROM \`user_credentials\` WHERE auth_provider = 'google' AND provider_id = ? LIMIT 1`,
          [provider_id]
        );

        if (credRows.length) {
          user_id = credRows[0].user_id;
        } else {
          // Check if a user with this email already exists
          const [userRows] = await connection.query(
            `SELECT user_id FROM \`users\` WHERE email = ? LIMIT 1`,
            [email]
          );

          if (userRows.length) {
            user_id = userRows[0].user_id;
          } else {
            // Brand new user — create user, tenant, and owner membership in one transaction.
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

          // Link Google credential
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
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }

      const [memberships] = await getPool().query(
        `SELECT m.tenant_id, m.role, m.status, t.display_name AS tenant_display_name
           FROM \`memberships\` m
           LEFT JOIN \`tenants\` t ON t.tenant_id = m.tenant_id
          WHERE m.user_id = ? AND m.status = 'active'
          ORDER BY m.granted_at ASC`,
        [user_id]
      );
      const tenant_id = memberships[0]?.tenant_id || null;

      // Generate JWT
      const token = jwt.sign({ user_id, email, tenant_id }, JWT_SECRET, { expiresIn: "7d" });

      return res.status(200).json({ ok: true, user_id, email, display_name, tenant_id, memberships, token });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "google_auth_failed", message: err.message } });
    }
  });

  return router;
}
