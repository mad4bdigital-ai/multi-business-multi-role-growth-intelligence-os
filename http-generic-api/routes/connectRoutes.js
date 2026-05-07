import { Router } from "express";
import { getPool } from "../db.js";
import { randomUUID, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CONNECTOR_SUBDOMAIN_SUFFIX = ".connector.mad4b.com";

// ── Auth helpers ──────────────────────────────────────────────────────────────

function verifyUserJwt(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(authHeader.slice(7), JWT_SECRET);
  } catch {
    return null;
  }
}

function requireUserJwt(req, res, next) {
  if (req.auth?.mode === "user_jwt") return next();
  const payload = verifyUserJwt(req.headers.authorization);
  if (!payload || !payload.user_id) {
    return res.status(403).json({ ok: false, error: { code: "user_jwt_required", message: "Sign in required." } });
  }
  req.auth = { mode: "user_jwt", user_id: payload.user_id, tenant_id: payload.tenant_id, is_admin: false };
  return next();
}

// ── DB query helpers ──────────────────────────────────────────────────────────

async function fetchUser(userId) {
  const [rows] = await getPool().query(
    "SELECT user_id, email, display_name FROM `users` WHERE user_id = ? LIMIT 1",
    [userId]
  );
  return rows[0] || null;
}

async function fetchActiveMembership(userId) {
  const [rows] = await getPool().query(
    `SELECT m.tenant_id, m.role, t.display_name AS tenant_display_name
     FROM memberships m
     JOIN tenants t ON t.tenant_id = m.tenant_id
     WHERE m.user_id = ? AND m.status = 'active'
     ORDER BY m.granted_at ASC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function fetchTenantConnection(tenantId) {
  const [rows] = await getPool().query(
    "SELECT * FROM `tenant_backend_connections` WHERE tenant_id = ? LIMIT 1",
    [tenantId]
  );
  return rows[0] || null;
}

async function fetchUserDevices(userId, tenantId) {
  const [rows] = await getPool().query(
    "SELECT device_id, tunnel_url, is_enabled FROM `local_connector_user_configs` WHERE user_id = ? AND tenant_id = ?",
    [userId, tenantId]
  );
  return rows;
}

// ── HTML page ─────────────────────────────────────────────────────────────────

function buildConnectHtml(googleClientId) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mad4B Connect</title>
<script src="https://accounts.google.com/gsi/client" async defer></script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f0f13;
    --surface: #1a1a24;
    --border: #2a2a38;
    --accent: #7c3aed;
    --accent-hover: #6d28d9;
    --text: #e2e2f0;
    --muted: #8888aa;
    --success: #22c55e;
    --warning: #f59e0b;
    --danger: #ef4444;
    --radius: 10px;
  }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; }
  #app { width: 100%; max-width: 640px; }
  .logo { text-align: center; margin-bottom: 32px; }
  .logo h1 { font-size: 1.75rem; font-weight: 700; letter-spacing: -0.02em; }
  .logo h1 span { color: var(--accent); }
  .logo p { color: var(--muted); margin-top: 6px; font-size: 0.9rem; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 28px; margin-bottom: 16px; }
  .card h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 16px; }
  .tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
  .tab { padding: 8px 20px; cursor: pointer; color: var(--muted); border-bottom: 2px solid transparent; transition: all 0.15s; font-size: 0.9rem; }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  label { display: block; font-size: 0.8rem; color: var(--muted); margin-bottom: 5px; margin-top: 12px; }
  input[type=text], input[type=email], input[type=password] { width: 100%; padding: 10px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 7px; color: var(--text); font-size: 0.9rem; outline: none; transition: border-color 0.15s; }
  input:focus { border-color: var(--accent); }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 20px; border-radius: 7px; font-size: 0.9rem; font-weight: 500; cursor: pointer; border: none; transition: background 0.15s, opacity 0.15s; width: 100%; margin-top: 14px; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-secondary { background: var(--border); color: var(--text); }
  .btn-secondary:hover { background: #3a3a52; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .divider { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 0.8rem; margin: 16px 0; }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }
  .msg { padding: 10px 14px; border-radius: 7px; font-size: 0.85rem; margin-top: 12px; }
  .msg-error { background: rgba(239,68,68,0.12); color: #fca5a5; border: 1px solid rgba(239,68,68,0.3); }
  .msg-success { background: rgba(34,197,94,0.12); color: #86efac; border: 1px solid rgba(34,197,94,0.3); }
  .badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 500; }
  .badge-active { background: rgba(34,197,94,0.15); color: var(--success); }
  .badge-pending { background: rgba(245,158,11,0.15); color: var(--warning); }
  .badge-inactive { background: rgba(239,68,68,0.15); color: var(--danger); }
  .badge-none { background: var(--border); color: var(--muted); }
  .welcome-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .welcome-bar h2 { font-size: 1rem; }
  .welcome-bar p { color: var(--muted); font-size: 0.8rem; margin-top: 2px; }
  .conn-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 16px; }
  @media (max-width: 500px) { .conn-cards { grid-template-columns: 1fr; } }
  .conn-card { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px; }
  .conn-card h3 { font-size: 0.95rem; font-weight: 600; margin-bottom: 8px; }
  .conn-card p { font-size: 0.82rem; color: var(--muted); line-height: 1.5; }
  .conn-card .btn { margin-top: 14px; }
  .device-list { margin-top: 14px; }
  .device-item { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 7px; margin-bottom: 6px; font-size: 0.83rem; }
  .device-item .di-id { font-weight: 500; }
  .device-item .di-url { color: var(--muted); font-size: 0.78rem; }
  .steps { margin-top: 14px; }
  .step { padding: 8px 12px; background: var(--bg); border-left: 3px solid var(--accent); border-radius: 0 7px 7px 0; margin-bottom: 6px; font-size: 0.82rem; font-family: 'Courier New', monospace; color: var(--muted); }
  .form-expand { margin-top: 12px; padding: 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 7px; }
  .sign-out-btn { background: none; border: 1px solid var(--border); color: var(--muted); padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 0.78rem; }
  .sign-out-btn:hover { color: var(--text); border-color: var(--muted); }
  .status-row { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .status-row p { color: var(--muted); font-size: 0.83rem; }
  #gsi-btn-container { display: flex; justify-content: center; margin-top: 4px; }
  .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.6s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div id="app">
  <div class="logo">
    <h1>Mad4B <span>Connect</span></h1>
    <p>Unified connection dashboard for your business infrastructure</p>
  </div>

  <!-- Auth Panel -->
  <div id="auth-panel" class="card" style="display:none">
    <div class="tabs">
      <div class="tab active" onclick="switchTab('signin')">Sign In</div>
      <div class="tab" onclick="switchTab('register')">Create Account</div>
    </div>

    <div id="tab-signin" class="tab-panel active">
      <div id="gsi-btn-container"></div>
      <div class="divider">or sign in with email</div>
      <label>Email</label>
      <input type="email" id="signin-email" placeholder="you@example.com" autocomplete="email">
      <label>Password</label>
      <input type="password" id="signin-password" placeholder="••••••••" autocomplete="current-password">
      <button class="btn btn-primary" onclick="doEmailSignIn()">Sign In</button>
      <div id="signin-msg"></div>
    </div>

    <div id="tab-register" class="tab-panel">
      <label>Display Name</label>
      <input type="text" id="reg-name" placeholder="Your name">
      <label>Email</label>
      <input type="email" id="reg-email" placeholder="you@example.com" autocomplete="email">
      <label>Password</label>
      <input type="password" id="reg-password" placeholder="Min 8 characters" autocomplete="new-password">
      <label>Workspace Name (optional)</label>
      <input type="text" id="reg-tenant" placeholder="My Business">
      <button class="btn btn-primary" onclick="doRegister()">Create Account</button>
      <div id="register-msg"></div>
    </div>
  </div>

  <!-- Dashboard Panel -->
  <div id="dashboard-panel" style="display:none">
    <div class="card">
      <div class="welcome-bar">
        <div>
          <h2 id="dash-name">Welcome</h2>
          <p id="dash-tenant"></p>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span id="dash-status-badge" class="badge badge-none">—</span>
          <button class="sign-out-btn" onclick="signOut()">Sign out</button>
        </div>
      </div>

      <div id="dash-msg"></div>

      <div class="conn-cards">
        <!-- Managed Card -->
        <div class="conn-card">
          <h3>Managed Connection</h3>
          <p>Platform handles your Cloudflare tunnel and Google authentication. Zero configuration required.</p>
          <button class="btn btn-primary" id="btn-managed" onclick="activateManaged()">Activate</button>
          <div id="managed-form" class="form-expand" style="display:none">
            <label>Device ID</label>
            <input type="text" id="managed-device-id" placeholder="e.g. mywindowspc">
            <button class="btn btn-secondary" onclick="installDevice()">Install Device</button>
          </div>
          <div id="managed-steps" class="steps" style="display:none"></div>
        </div>

        <!-- Dedicated Card -->
        <div class="conn-card">
          <h3>Dedicated Connection</h3>
          <p>Use your own Cloudflare account and Hostinger DNS credentials. Full control over your infrastructure.</p>
          <button class="btn btn-secondary" id="btn-dedicated" onclick="toggleDedicatedForm()">Configure</button>
          <div id="dedicated-form" class="form-expand" style="display:none">
            <label>Cloudflare API Token</label>
            <input type="text" id="ded-cf-token" placeholder="CF token (not stored in DB)">
            <label>Cloudflare Account ID (optional)</label>
            <input type="text" id="ded-cf-account" placeholder="Account ID">
            <label>Hostinger API Key (optional)</label>
            <input type="text" id="ded-hostinger" placeholder="Hostinger key">
            <button class="btn btn-primary" onclick="activateDedicated()">Save Configuration</button>
          </div>
          <div id="dedicated-msg"></div>
        </div>
      </div>

      <div id="device-section" style="display:none;margin-top:20px">
        <h2 style="font-size:0.95rem;margin-bottom:10px">Connected Devices</h2>
        <div id="device-list" class="device-list"></div>
      </div>
    </div>
  </div>
</div>

<script>
const GOOGLE_CLIENT_ID = ${JSON.stringify(googleClientId)};
const TOKEN_KEY = 'mad4b_connect_token';

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

function showMsg(elId, text, type='error') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.className = 'msg msg-' + type;
  el.textContent = text;
  el.style.display = text ? '' : 'none';
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', (i===0 && tab==='signin')||(i===1 && tab==='register')));
  document.getElementById('tab-signin').classList.toggle('active', tab==='signin');
  document.getElementById('tab-register').classList.toggle('active', tab==='register');
}

async function apiFetch(path, opts={}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers||{}) };
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function loadDashboard() {
  const { ok, data } = await apiFetch('/connect/status');
  if (!ok) { showAuthPanel(); return; }
  showDashboard(data);
}

function showAuthPanel() {
  document.getElementById('auth-panel').style.display = '';
  document.getElementById('dashboard-panel').style.display = 'none';
  initGsi();
}

function initGsi() {
  if (!GOOGLE_CLIENT_ID || !window.google) { setTimeout(initGsi, 300); return; }
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGsiCredential,
  });
  google.accounts.id.renderButton(document.getElementById('gsi-btn-container'), {
    theme: 'filled_black', size: 'large', width: 300, text: 'signin_with'
  });
}

async function handleGsiCredential(response) {
  const { ok, data } = await apiFetch('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ id_token: response.credential })
  });
  if (!ok) { showMsg('signin-msg', data?.error?.message || 'Google sign-in failed'); return; }
  setToken(data.token);
  loadDashboard();
}

async function doEmailSignIn() {
  const email = document.getElementById('signin-email').value.trim();
  const password = document.getElementById('signin-password').value;
  if (!email || !password) { showMsg('signin-msg', 'Email and password required.'); return; }
  const { ok, data } = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!ok) { showMsg('signin-msg', data?.error?.message || 'Sign-in failed.'); return; }
  setToken(data.token);
  loadDashboard();
}

async function doRegister() {
  const display_name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const tenant_display_name = document.getElementById('reg-tenant').value.trim();
  if (!display_name || !email || !password) { showMsg('register-msg', 'Name, email, and password required.'); return; }
  const { ok, data } = await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ display_name, email, password, tenant_display_name }) });
  if (!ok) { showMsg('register-msg', data?.error?.message || 'Registration failed.'); return; }
  setToken(data.token);
  loadDashboard();
}

function signOut() {
  clearToken();
  document.getElementById('dashboard-panel').style.display = 'none';
  document.getElementById('auth-panel').style.display = '';
}

function showDashboard(data) {
  document.getElementById('auth-panel').style.display = 'none';
  document.getElementById('dashboard-panel').style.display = '';
  document.getElementById('dash-name').textContent = 'Welcome, ' + (data.user?.display_name || data.user?.email || 'User');
  document.getElementById('dash-tenant').textContent = data.tenant?.display_name || '';

  const conn = data.connection || {};
  const statusBadge = document.getElementById('dash-status-badge');
  const status = conn.status || null;
  statusBadge.textContent = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Not configured';
  statusBadge.className = 'badge badge-' + (status || 'none');

  renderDevices(data.devices || []);
}

function renderDevices(devices) {
  const section = document.getElementById('device-section');
  const list = document.getElementById('device-list');
  if (!devices.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = devices.map(d => \`
    <div class="device-item">
      <div><div class="di-id">\${d.device_id}</div><div class="di-url">\${d.tunnel_url || ''}</div></div>
      <span class="badge \${d.is_enabled ? 'badge-active' : 'badge-inactive'}">\${d.is_enabled ? 'Enabled' : 'Disabled'}</span>
    </div>
  \`).join('');
}

async function activateManaged() {
  const { ok, data } = await apiFetch('/connect/activate', {
    method: 'POST',
    body: JSON.stringify({ mode: 'managed', cloudflare_mode: 'managed', google_auth_mode: 'managed' })
  });
  if (!ok) { showMsg('dash-msg', data?.error?.message || 'Activation failed.'); return; }
  showMsg('dash-msg', 'Managed connection activated.', 'success');
  document.getElementById('managed-form').style.display = '';
}

async function installDevice() {
  const device_id = document.getElementById('managed-device-id').value.trim();
  if (!device_id) { showMsg('dash-msg', 'Device ID is required.'); return; }
  const { ok, data } = await apiFetch('/connect/device-install', {
    method: 'POST',
    body: JSON.stringify({ device_id })
  });
  if (!ok) { showMsg('dash-msg', data?.error?.message || 'Device install failed.'); return; }
  const stepsEl = document.getElementById('managed-steps');
  stepsEl.style.display = '';
  stepsEl.innerHTML = (data.install_steps || []).map(s => \`<div class="step">\${s}</div>\`).join('');
  document.getElementById('managed-form').style.display = 'none';
  loadDashboard();
}

function toggleDedicatedForm() {
  const form = document.getElementById('dedicated-form');
  form.style.display = form.style.display === 'none' ? '' : 'none';
}

async function activateDedicated() {
  const cf_api_token = document.getElementById('ded-cf-token').value.trim();
  const cf_account_id = document.getElementById('ded-cf-account').value.trim();
  const hostinger_api_key = document.getElementById('ded-hostinger').value.trim();
  const { ok, data } = await apiFetch('/connect/activate', {
    method: 'POST',
    body: JSON.stringify({
      mode: 'dedicated',
      cloudflare_mode: 'dedicated',
      google_auth_mode: 'managed',
      cf_api_token: cf_api_token || undefined,
      cf_account_id: cf_account_id || undefined,
      hostinger_api_key: hostinger_api_key || undefined,
    })
  });
  if (!ok) { showMsg('dedicated-msg', data?.error?.message || 'Configuration failed.'); return; }
  showMsg('dedicated-msg', 'Dedicated connection configured.', 'success');
  document.getElementById('dedicated-form').style.display = 'none';
  loadDashboard();
}

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  const token = getToken();
  if (!token) { showAuthPanel(); return; }
  await loadDashboard();
})();
</script>
</body>
</html>`;
}

// ── Route builder ─────────────────────────────────────────────────────────────

export function buildConnectRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // GET /connect — serve HTML page (no auth required)
  router.get("/connect", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(buildConnectHtml(GOOGLE_CLIENT_ID));
  });

  // GET /connect/status — requires user JWT
  router.get("/connect/status", requireBackendApiKey, requireUserJwt, async (req, res) => {
    try {
      const { user_id, tenant_id } = req.auth;
      const [user, membership] = await Promise.all([
        fetchUser(user_id),
        fetchActiveMembership(user_id),
      ]);
      if (!user) return res.status(404).json({ ok: false, error: { code: "user_not_found", message: "User not found." } });

      const resolvedTenantId = tenant_id || membership?.tenant_id;
      const [connection, devices] = await Promise.all([
        resolvedTenantId ? fetchTenantConnection(resolvedTenantId) : Promise.resolve(null),
        resolvedTenantId ? fetchUserDevices(user_id, resolvedTenantId) : Promise.resolve([]),
      ]);

      return res.json({
        ok: true,
        user: { user_id: user.user_id, email: user.email, display_name: user.display_name },
        tenant: {
          tenant_id: resolvedTenantId || null,
          display_name: membership?.tenant_display_name || null,
          role: membership?.role || null,
        },
        connection: connection ? {
          mode: connection.connection_mode,
          status: connection.status,
          cloudflare_mode: connection.cloudflare_mode,
          google_auth_mode: connection.google_auth_mode,
          device_count: connection.device_count,
          activated_at: connection.activated_at,
        } : { mode: null, status: null, cloudflare_mode: "managed", google_auth_mode: "managed", device_count: 0, activated_at: null },
        devices: devices.map(d => ({ device_id: d.device_id, tunnel_url: d.tunnel_url, is_enabled: Boolean(d.is_enabled) })),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "status_failed", message: err.message } });
    }
  });

  // POST /connect/activate — requires user JWT
  router.post("/connect/activate", requireBackendApiKey, requireUserJwt, async (req, res) => {
    try {
      const { user_id, tenant_id } = req.auth;
      const { mode, cloudflare_mode, google_auth_mode, cf_api_token, cf_account_id, hostinger_api_key } = req.body || {};

      if (!mode || !["managed", "dedicated"].includes(mode)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_mode", message: "mode must be 'managed' or 'dedicated'." } });
      }

      const membership = await fetchActiveMembership(user_id);
      const resolvedTenantId = tenant_id || membership?.tenant_id;
      if (!resolvedTenantId) {
        return res.status(403).json({ ok: false, error: { code: "no_tenant", message: "No active tenant found for this user." } });
      }

      const pool = getPool();

      // If dedicated + CF token provided: register in connected_systems (token not stored)
      if (mode === "dedicated" && cf_api_token) {
        const systemId = randomUUID();
        const configJson = JSON.stringify({ cf_account_id: cf_account_id || null, note: "CF API token must be set as CLOUDFLARE_API_TOKEN env var; not stored here." });
        await pool.query(
          `INSERT INTO \`connected_systems\` (system_id, tenant_id, system_key, display_name, provider_family, auth_type, service_mode, config_json, status)
           VALUES (?, ?, 'cloudflare_connector', 'Cloudflare (Dedicated)', 'cloudflare', 'api_token', 'self_serve', ?, 'active')
           ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), status = 'active', updated_at = NOW()`,
          [systemId, resolvedTenantId, configJson]
        );
      }

      // Upsert tenant_backend_connections
      const connectionId = randomUUID();
      const cfMode = cloudflare_mode || "managed";
      const gaMode = google_auth_mode || "managed";
      await pool.query(
        `INSERT INTO \`tenant_backend_connections\`
           (connection_id, tenant_id, connection_mode, cloudflare_mode, google_auth_mode, status, activated_at)
         VALUES (?, ?, ?, ?, ?, 'active', NOW())
         ON DUPLICATE KEY UPDATE
           connection_mode = VALUES(connection_mode),
           cloudflare_mode = VALUES(cloudflare_mode),
           google_auth_mode = VALUES(google_auth_mode),
           status = 'active',
           activated_at = COALESCE(activated_at, NOW()),
           updated_at = NOW()`,
        [connectionId, resolvedTenantId, mode, cfMode, gaMode]
      );

      const connection = await fetchTenantConnection(resolvedTenantId);
      return res.json({
        ok: true,
        connection: {
          mode: connection.connection_mode,
          status: connection.status,
          cloudflare_mode: connection.cloudflare_mode,
          google_auth_mode: connection.google_auth_mode,
          device_count: connection.device_count,
          activated_at: connection.activated_at,
        },
        ...(mode === "dedicated" && cf_api_token ? { notice: "CF API token received but not stored in DB. Set it as CLOUDFLARE_API_TOKEN env var on your Cloud Run service." } : {}),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "activate_failed", message: err.message } });
    }
  });

  // POST /connect/device-install — requires user JWT
  router.post("/connect/device-install", requireBackendApiKey, requireUserJwt, async (req, res) => {
    try {
      const { user_id, tenant_id } = req.auth;
      const { device_id } = req.body || {};

      if (!device_id || !/^[a-zA-Z0-9_-]{2,64}$/.test(device_id)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_device_id", message: "device_id must be 2-64 alphanumeric/dash/underscore characters." } });
      }

      // Validate tenant membership
      const membership = await fetchActiveMembership(user_id);
      const resolvedTenantId = tenant_id || membership?.tenant_id;
      if (!resolvedTenantId) {
        return res.status(403).json({ ok: false, error: { code: "no_tenant", message: "No active tenant found for this user." } });
      }

      const pool = getPool();

      // Check for existing config
      const [existing] = await pool.query(
        "SELECT config_id, tunnel_url, connector_secret FROM `local_connector_user_configs` WHERE user_id = ? AND tenant_id = ? AND device_id = ? LIMIT 1",
        [user_id, resolvedTenantId, device_id]
      );

      let configId, tunnelUrl, connectorSecret;

      if (existing.length) {
        // Reuse existing
        configId = existing[0].config_id;
        tunnelUrl = existing[0].tunnel_url;
        connectorSecret = existing[0].connector_secret;
        if (!connectorSecret) {
          connectorSecret = randomBytes(32).toString("hex");
          await pool.query(
            "UPDATE `local_connector_user_configs` SET connector_secret = ? WHERE config_id = ?",
            [connectorSecret, configId]
          );
        }
      } else {
        // Create new config with managed platform tunnel (user-scoped subdomain)
        configId = randomUUID();
        tunnelUrl = `https://${device_id}${CONNECTOR_SUBDOMAIN_SUFFIX}`;
        connectorSecret = randomBytes(32).toString("hex");
        await pool.query(
          `INSERT INTO \`local_connector_user_configs\`
             (config_id, user_id, tenant_id, device_id, tunnel_url, connector_secret, is_enabled)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
          [configId, user_id, resolvedTenantId, device_id, tunnelUrl, connectorSecret]
        );

        // Update device count on connection
        await pool.query(
          "UPDATE `tenant_backend_connections` SET device_count = device_count + 1 WHERE tenant_id = ?",
          [resolvedTenantId]
        );
      }

      const installSteps = [
        `1. Download the connector for Windows: https://github.com/cloudflare/cloudflared/releases/latest`,
        `2. Set your connector secret: set CONNECTOR_SECRET=${connectorSecret}`,
        `3. Set the tunnel URL: set TUNNEL_URL=${tunnelUrl}`,
        `4. Run: cloudflared tunnel --url http://localhost:7070`,
        `5. Your device ID is: ${device_id}`,
        `6. Verify connectivity: curl ${tunnelUrl}/health`,
      ];

      return res.json({
        ok: true,
        config_id: configId,
        device_id,
        tunnel_url: tunnelUrl,
        connector_secret: connectorSecret,
        install_steps: installSteps,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "device_install_failed", message: err.message } });
    }
  });

  return router;
}
