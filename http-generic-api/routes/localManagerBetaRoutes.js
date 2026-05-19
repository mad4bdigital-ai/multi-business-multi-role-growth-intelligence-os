import { Router } from "express";
import { getPool } from "../db.js";
import {
  approveDeviceLinkSession,
  listLinkedDevices,
  pollDeviceLinkSession,
  startDeviceLinkSession,
} from "../services/localManagerDeviceLinkService.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function bool(value) {
  return Boolean(Number(value || 0));
}

function parseJsonMaybe(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function asIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function redactUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|key|signature|password|auth/i.test(key)) url.searchParams.set(key, "<redacted>");
    }
    return url.toString();
  } catch {
    return String(value).slice(0, 200);
  }
}

function classifyHealth(config) {
  const lastHealth = config?.last_health_at ? new Date(config.last_health_at).getTime() : 0;
  if (!lastHealth) return { status: "unknown", reason: "no heartbeat recorded" };
  const ageMs = Date.now() - lastHealth;
  if (ageMs < 10 * 60 * 1000) return { status: "healthy", reason: "heartbeat within 10 minutes", age_ms: ageMs };
  if (ageMs < 60 * 60 * 1000) return { status: "stale", reason: "heartbeat older than 10 minutes", age_ms: ageMs };
  return { status: "degraded", reason: "heartbeat older than 1 hour", age_ms: ageMs };
}

function sanitizeConfig(row) {
  if (!row) return null;
  return {
    config_id: row.config_id,
    user_id: row.user_id,
    tenant_id: row.tenant_id,
    device_id: row.device_id,
    hostname: row.hostname || null,
    is_enabled: bool(row.is_enabled),
    public_gateway_url: redactUrl(row.public_gateway_url),
    device_runtime_url: redactUrl(row.device_runtime_url || row.tunnel_url),
    admin_recovery_url: redactUrl(row.admin_recovery_url),
    agent_version: row.agent_version || null,
    watchdog_installed: bool(row.watchdog_installed),
    watchdog_version: row.watchdog_version || null,
    active_slot: row.active_slot || null,
    last_health_at: asIso(row.last_health_at),
    last_reconnect_at: asIso(row.last_reconnect_at),
    last_repair_at: asIso(row.last_repair_at),
    last_repair_status: row.last_repair_status || null,
    last_error_code: row.last_error_code || null,
    last_error_message: row.last_error_message || null,
    health: classifyHealth(row),
  };
}

function sanitizeRoute(row) {
  return {
    route_id: row.route_id,
    route_type: row.route_type,
    route_label: row.route_label || null,
    endpoint_url: redactUrl(row.endpoint_url),
    priority: row.priority,
    is_enabled: bool(row.is_enabled),
    is_customer_selectable: bool(row.is_customer_selectable),
    requires_admin_setup: bool(row.requires_admin_setup),
    requires_router_config: bool(row.requires_router_config),
    requires_vpn_agent: bool(row.requires_vpn_agent),
    tls_mode: row.tls_mode,
    auth_mode: row.auth_mode,
    health_status: row.health_status,
    last_health_at: asIso(row.last_health_at),
    last_success_at: asIso(row.last_success_at),
    last_failure_at: asIso(row.last_failure_at),
    last_error_code: row.last_error_code || null,
    last_error_message: row.last_error_message || null,
    route_metadata: parseJsonMaybe(row.route_metadata),
  };
}

function sanitizeEvent(row) {
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    status: row.status,
    source: row.source,
    agent_version: row.agent_version || null,
    active_slot: row.active_slot || null,
    error_code: row.error_code || null,
    error_message: row.error_message || null,
    metadata: parseJsonMaybe(row.metadata_json),
    created_at: asIso(row.created_at),
  };
}

async function listConfigs({ deviceId = null, userId = null, tenantId = null, limit = 20 } = {}) {
  const params = [];
  let sql = `SELECT * FROM \`local_connector_user_configs\` WHERE is_enabled = 1`;
  if (deviceId) { sql += " AND device_id = ?"; params.push(deviceId); }
  if (userId) { sql += " AND user_id = ?"; params.push(userId); }
  if (tenantId) { sql += " AND tenant_id = ?"; params.push(tenantId); }
  sql += " ORDER BY COALESCE(last_health_at, updated_at, created_at) DESC LIMIT ?";
  params.push(Math.max(1, Math.min(Number(limit) || 20, 50)));
  const [rows] = await getPool().query(sql, params);
  return rows;
}

async function loadDeviceDetails(config) {
  const [routes] = await getPool().query(
    `SELECT * FROM \`local_connector_device_routes\`
      WHERE config_id = ?
      ORDER BY is_enabled DESC, priority ASC, route_type ASC`,
    [config.config_id]
  );
  const [events] = await getPool().query(
    `SELECT * FROM \`local_connector_recovery_events\`
      WHERE config_id = ?
      ORDER BY created_at DESC
      LIMIT 20`,
    [config.config_id]
  );
  return {
    config: sanitizeConfig(config),
    routes: routes.map(sanitizeRoute),
    recovery_events: events.map(sanitizeEvent),
    screens: {
      status: {
        title: "Status",
        fields: ["health", "agent_version", "watchdog_installed", "active_slot", "last_health_at", "last_error_code"],
      },
      routes: {
        title: "Routes",
        order: routes.map((route) => ({ route_type: route.route_type, priority: route.priority, health_status: route.health_status })),
      },
      repairs: {
        title: "Repairs",
        mode: "read_only_beta",
        allowed_next_actions: ["restart_connector_service", "restart_cloudflared_service", "reinstall_watchdog", "safe_upgrade", "rollback"],
        note: "Repair execution is not enabled in beta. Actions must route through governed backend tools and consent/entitlement checks.",
      },
      logs: {
        title: "Logs",
        mode: "bounded_redacted_events",
        event_count: events.length,
      },
    },
  };
}

function betaPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mad4B Local Manager Beta</title>
  <style>
    :root { color-scheme: light dark; --bg:#0b1020; --panel:#121a33; --card:#18213d; --fg:#edf2ff; --muted:#9fb0d9; --line:#2e3d66; --ok:#65d6ad; --warn:#ffd166; --bad:#ff7b7b; }
    body { margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; background:linear-gradient(135deg,#08101f,#101936); color:var(--fg); }
    main { max-width:1120px; margin:0 auto; padding:32px 18px 64px; }
    header { display:flex; flex-wrap:wrap; gap:16px; justify-content:space-between; align-items:flex-end; margin-bottom:22px; }
    h1 { font-size:28px; margin:0 0 6px; }
    p { color:var(--muted); line-height:1.5; }
    .panel { background:rgba(18,26,51,.92); border:1px solid var(--line); border-radius:18px; padding:18px; box-shadow:0 18px 60px rgba(0,0,0,.25); }
    .controls { display:grid; grid-template-columns:2fr 1fr 1fr auto; gap:10px; margin-bottom:18px; }
    input, button { border-radius:12px; border:1px solid var(--line); padding:12px 13px; background:#0e162d; color:var(--fg); }
    button { cursor:pointer; font-weight:700; background:#4c6fff; border-color:#6f89ff; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
    .card { background:rgba(24,33,61,.92); border:1px solid var(--line); border-radius:16px; padding:16px; }
    .full { grid-column:1/-1; }
    .pill { display:inline-flex; border:1px solid var(--line); border-radius:999px; padding:4px 9px; color:var(--muted); font-size:12px; margin:2px; }
    .healthy { color:var(--ok); } .stale,.unknown { color:var(--warn); } .degraded,.down { color:var(--bad); }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th, td { text-align:left; border-bottom:1px solid var(--line); padding:8px 6px; vertical-align:top; }
    th { color:var(--muted); }
    pre { white-space:pre-wrap; word-break:break-word; background:#081126; border-radius:12px; padding:12px; color:#c9d6ff; }
    @media (max-width: 780px) { .controls { grid-template-columns:1fr; } .grid { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Mad4B Local Manager Beta</h1>
        <p>Read-only connector status, routes, repairs preview, and redacted recovery events. No secrets are displayed.</p>
      </div>
      <span class="pill">beta · read only</span>
    </header>
    <section class="panel">
      <div class="controls">
        <input id="token" type="password" placeholder="Admin bearer token" autocomplete="off" />
        <input id="device" placeholder="device_id e.g. essam-pc" />
        <input id="user" placeholder="optional user_id" />
        <button id="load">Load</button>
      </div>
      <div id="out"><p>Enter an admin bearer token and device id, then load.</p></div>
    </section>
  </main>
<script>
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
function row(k,v){ return '<tr><th>'+esc(k)+'</th><td>'+esc(v ?? '—')+'</td></tr>'; }
function render(data){
  if (!data.ok) { $('out').innerHTML = '<pre>'+esc(JSON.stringify(data,null,2))+'</pre>'; return; }
  const d = data.device || {};
  const c = d.config || {};
  const health = c.health || {};
  const routes = d.routes || [];
  const events = d.recovery_events || [];
  $('out').innerHTML = '<div class="grid">'
    + '<div class="card"><h2>Status</h2><table>'
    + row('device', c.device_id) + row('health', health.status + ' · ' + (health.reason || '')) + row('agent', c.agent_version)
    + row('watchdog', c.watchdog_installed ? 'installed ' + (c.watchdog_version || '') : 'not installed') + row('active slot', c.active_slot)
    + row('last health', c.last_health_at) + row('last repair', c.last_repair_at) + row('last error', c.last_error_code)
    + '</table></div>'
    + '<div class="card"><h2>Repairs Preview</h2><p>Repair execution is disabled in beta. Actions must go through governed backend checks.</p>'
    + (d.screens?.repairs?.allowed_next_actions || []).map(x=>'<span class="pill">'+esc(x)+'</span>').join('') + '</div>'
    + '<div class="card full"><h2>Routes</h2><table><thead><tr><th>type</th><th>priority</th><th>health</th><th>endpoint</th><th>last error</th></tr></thead><tbody>'
    + routes.map(r=>'<tr><td>'+esc(r.route_type)+'</td><td>'+esc(r.priority)+'</td><td class="'+esc(r.health_status)+'">'+esc(r.health_status)+'</td><td>'+esc(r.endpoint_url)+'</td><td>'+esc(r.last_error_code || '')+'</td></tr>').join('')
    + '</tbody></table></div>'
    + '<div class="card full"><h2>Redacted Recovery Events</h2><table><thead><tr><th>time</th><th>event</th><th>status</th><th>source</th><th>error</th></tr></thead><tbody>'
    + events.map(e=>'<tr><td>'+esc(e.created_at)+'</td><td>'+esc(e.event_type)+'</td><td>'+esc(e.status)+'</td><td>'+esc(e.source)+'</td><td>'+esc(e.error_code || '')+'</td></tr>').join('')
    + '</tbody></table></div></div>';
}
$('load').onclick = async () => {
  sessionStorage.setItem('mlm_token', $('token').value);
  const params = new URLSearchParams();
  if ($('device').value) params.set('device_id', $('device').value);
  if ($('user').value) params.set('user_id', $('user').value);
  $('out').innerHTML = '<p>Loading…</p>';
  try {
    const res = await fetch('/local-manager/beta/status?' + params.toString(), { headers:{ Authorization:'Bearer ' + $('token').value, Accept:'application/json' }});
    render(await res.json());
  } catch (e) { render({ ok:false, error:{ message:e.message }}); }
};
$('token').value = sessionStorage.getItem('mlm_token') || '';
</script>
</body>
</html>`;
}

function localManagerAppPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mad4B Local Manager</title>
  <style>
    :root { color-scheme: light dark; --bg:#07111f; --panel:#101a30; --card:#17243e; --fg:#f0f5ff; --muted:#a8b6d8; --line:#2d3f62; --accent:#6383ff; --ok:#62d6a8; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; background:radial-gradient(circle at top left,#1f3265,#07111f 58%); color:var(--fg); }
    main { max-width:1120px; margin:0 auto; padding:48px 20px 70px; }
    header { display:grid; grid-template-columns:1.2fr .8fr; gap:24px; align-items:center; margin-bottom:28px; }
    h1 { font-size:44px; line-height:1.04; letter-spacing:-.05em; margin:0 0 14px; }
    h2 { margin:0 0 10px; }
    p { color:var(--muted); line-height:1.6; font-size:16px; }
    .hero,.card { background:rgba(16,26,48,.90); border:1px solid var(--line); border-radius:24px; box-shadow:0 24px 70px rgba(0,0,0,.28); }
    .hero { padding:26px; }
    .badge { display:inline-flex; border:1px solid var(--line); border-radius:999px; padding:6px 11px; color:var(--muted); font-size:13px; margin-bottom:16px; }
    .actions { display:flex; flex-wrap:wrap; gap:12px; margin-top:22px; }
    a.button, button { border-radius:14px; border:1px solid #87a0ff; padding:12px 16px; color:white; background:var(--accent); text-decoration:none; font-weight:800; cursor:pointer; }
    a.secondary { background:#14213a; border-color:var(--line); }
    .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin-top:16px; }
    .card { padding:18px; }
    .steps { counter-reset:step; display:grid; gap:10px; margin-top:12px; }
    .step { display:grid; grid-template-columns:38px 1fr; gap:12px; align-items:start; padding:14px; border:1px solid var(--line); border-radius:18px; background:#0d172b; }
    .step:before { counter-increment:step; content:counter(step); width:30px; height:30px; display:grid; place-items:center; border-radius:50%; background:#223968; color:#dbe6ff; font-weight:900; }
    code { background:#0b1428; border:1px solid var(--line); border-radius:8px; padding:2px 6px; color:#dce7ff; }
    .note { border-left:3px solid var(--ok); padding:10px 12px; background:#0c1c2a; border-radius:12px; }
    @media (max-width: 860px) { header,.grid { grid-template-columns:1fr; } h1 { font-size:34px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <section>
        <span class="badge">Public Local Manager</span>
        <h1>Download, sign in, and link this device.</h1>
        <p>Mad4B Local Manager is installed first. Authentication happens inside the installed app when the user signs in and chooses to link the current device.</p>
        <div class="actions">
          <a class="button" href="#download">Download Local Manager</a>
          <a class="button secondary" href="#how-it-works">How linking works</a>
          <a class="button secondary" href="/app/local-manager/admin">Admin installer tools</a>
        </div>
      </section>
      <section class="hero">
        <h2>No token fields here</h2>
        <p>This public page does not ask for a platform token, backend key, user id, tenant id, or device id.</p>
        <p class="note">The installed app will authenticate with Mad4B, then request a scoped device credential from the backend after user consent.</p>
      </section>
    </header>

    <section id="download" class="grid">
      <div class="card"><h2>Windows</h2><p>Download the Local Manager Windows app, then sign in after installation.</p><p><a class="button" href="/app/local-manager/download/windows">Download for Windows (.exe)</a></p><p>This app contains no device credentials and no platform secrets.</p></div>
      <div class="card"><h2>macOS</h2><p>Desktop packaging is planned after the Windows connector flow is completed.</p><p><button disabled>Planned</button></p></div>
      <div class="card"><h2>Linux</h2><p>Agent packaging is planned for server and workstation installs.</p><p><button disabled>Planned</button></p></div>
    </section>

    <section id="how-it-works" class="card" style="margin-top:14px;">
      <h2>Device linking flow</h2>
      <div class="steps">
        <div class="step"><div><strong>Install</strong><p>User downloads and installs Local Manager. No admin token is typed into this web page.</p></div></div>
        <div class="step"><div><strong>Sign in</strong><p>The installed app opens Mad4B login using OAuth, device-code login, or a one-time pairing code.</p></div></div>
        <div class="step"><div><strong>Link device</strong><p>The app asks the user to link the current machine. The backend creates scoped credentials for that device only.</p></div></div>
        <div class="step"><div><strong>Manage</strong><p>The device appears in Local Manager with route health, backup probes, and recovery actions governed by the signed-in user role.</p></div></div>
      </div>
    </section>

    <section class="card" style="margin-top:14px;">
      <h2>Current admin bridge</h2>
      <p>The old token/device installer generator has been moved to <code>/app/local-manager/admin</code>. It is for admin recovery only and is not the public user flow.</p>
    </section>
  </main>
</body>
</html>`;
}

function localManagerAdminPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mad4B Local Manager</title>
  <style>
    :root { color-scheme: light dark; --bg:#08111f; --panel:#111b31; --card:#16233d; --fg:#eff5ff; --muted:#9fb1d1; --line:#2b3d60; --ok:#5fe0ad; --warn:#ffd166; --bad:#ff7b7b; --accent:#6383ff; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; background:radial-gradient(circle at top left,#1c2b58,#08111f 55%); color:var(--fg); }
    main { max-width:1180px; margin:0 auto; padding:28px 18px 60px; }
    header { display:flex; flex-wrap:wrap; justify-content:space-between; gap:18px; align-items:flex-end; margin-bottom:18px; }
    h1 { font-size:30px; margin:0 0 6px; letter-spacing:-.03em; }
    h2 { margin:0 0 10px; font-size:18px; }
    p { color:var(--muted); line-height:1.55; }
    .pill { display:inline-flex; gap:6px; align-items:center; border:1px solid var(--line); color:var(--muted); border-radius:999px; padding:5px 10px; font-size:12px; margin:2px; }
    .panel,.card { background:rgba(17,27,49,.92); border:1px solid var(--line); border-radius:18px; box-shadow:0 18px 60px rgba(0,0,0,.28); }
    .panel { padding:16px; margin-bottom:14px; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
    .card { padding:16px; }
    .full { grid-column:1/-1; }
    .controls { display:grid; grid-template-columns:2fr 1fr 1fr 1fr auto; gap:10px; }
    label { display:block; color:var(--muted); font-size:12px; margin-bottom:5px; }
    input,button { width:100%; border-radius:12px; border:1px solid var(--line); padding:11px 12px; background:#0d172a; color:var(--fg); }
    button { cursor:pointer; background:var(--accent); border-color:#86a0ff; font-weight:800; }
    button.secondary { background:#172642; }
    button.danger { background:#3a1a2a; border-color:#7c3854; }
    .actions { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin-top:10px; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th,td { text-align:left; padding:8px 6px; border-bottom:1px solid var(--line); vertical-align:top; }
    th { color:var(--muted); font-weight:600; }
    pre { white-space:pre-wrap; word-break:break-word; background:#071124; border-radius:14px; padding:12px; max-height:360px; overflow:auto; }
    .ok { color:var(--ok); } .warn,.unknown,.stale { color:var(--warn); } .bad,.degraded,.down { color:var(--bad); }
    @media (max-width:900px){ .controls,.grid,.actions{grid-template-columns:1fr;} }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Mad4B Local Manager</h1>
        <p>Public app shell with platform-auth actions. No platform secrets are sent to the browser.</p>
      </div>
      <span class="pill">public app · auth required for actions</span>
    </header>

    <section class="panel">
      <div class="controls">
        <div><label>Platform auth token</label><input id="token" type="password" placeholder="Bearer token" autocomplete="off" /></div>
        <div><label>Device ID</label><input id="device" value="essam-pc" /></div>
        <div><label>User ID</label><input id="user" placeholder="optional" /></div>
        <div><label>Tenant ID</label><input id="tenant" placeholder="optional" /></div>
        <div><label>&nbsp;</label><button id="load">Load</button></div>
      </div>
      <p>Use your own platform/admin token. The token is stored only in this browser tab/session storage.</p>
    </section>

    <section class="grid">
      <div class="card"><h2>Status</h2><div id="status"><p>Load a device to begin.</p></div></div>
      <div class="card"><h2>Install / Upgrade</h2><div id="install"><p>After loading a device, generate a short-lived installer link.</p></div></div>
      <div class="card full"><h2>Routes</h2><div id="routes"></div></div>
      <div class="card full"><h2>Recovery events</h2><div id="events"></div></div>
      <div class="card full"><h2>Diagnostics</h2><pre id="diag">No diagnostics yet.</pre></div>
    </section>
  </main>
<script>
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const authHeaders = () => ({ Authorization:'Bearer ' + $('token').value, Accept:'application/json' });
function saveInputs(){ ['token','device','user','tenant'].forEach(id => sessionStorage.setItem('mlm_'+id, $(id).value)); }
function loadInputs(){ ['token','device','user','tenant'].forEach(id => { const v=sessionStorage.getItem('mlm_'+id); if(v) $(id).value=v; }); }
function table(rows){ return '<table><tbody>' + rows.map(([k,v]) => '<tr><th>'+esc(k)+'</th><td>'+esc(v ?? '—')+'</td></tr>').join('') + '</tbody></table>'; }
function setDiag(obj){ $('diag').textContent = JSON.stringify(obj, null, 2); }
let loaded = null;
async function loadDevice(){
  saveInputs();
  const p = new URLSearchParams();
  if($('device').value) p.set('device_id',$('device').value);
  if($('user').value) p.set('user_id',$('user').value);
  if($('tenant').value) p.set('tenant_id',$('tenant').value);
  $('status').innerHTML = '<p>Loading…</p>';
  try {
    const res = await fetch('/local-manager/beta/status?' + p.toString(), { headers: authHeaders() });
    const data = await res.json(); loaded = data; setDiag({ status:res.status, ok:data.ok, beta:data.beta, read_only:data.read_only, secrets_included:data.secrets_included });
    if(!data.ok) throw new Error(data.error?.message || 'Status failed');
    const c = data.device?.config || {}; const h = c.health || {};
    $('status').innerHTML = table([
      ['device', c.device_id], ['health', (h.status || 'unknown') + ' · ' + (h.reason || '')], ['agent', c.agent_version], ['watchdog', c.watchdog_installed ? 'installed ' + (c.watchdog_version || '') : 'not installed'], ['last health', c.last_health_at], ['last error', c.last_error_code]
    ]);
    const routes = data.device?.routes || [];
    $('routes').innerHTML = '<table><thead><tr><th>type</th><th>priority</th><th>health</th><th>endpoint</th></tr></thead><tbody>' + routes.map(r => '<tr><td>'+esc(r.route_type)+'</td><td>'+esc(r.priority)+'</td><td class="'+esc(r.health_status)+'">'+esc(r.health_status)+'</td><td>'+esc(r.endpoint_url)+'</td></tr>').join('') + '</tbody></table>';
    const events = data.device?.recovery_events || [];
    $('events').innerHTML = '<table><thead><tr><th>time</th><th>event</th><th>status</th><th>source</th></tr></thead><tbody>' + events.map(e => '<tr><td>'+esc(e.created_at)+'</td><td>'+esc(e.event_type)+'</td><td>'+esc(e.status)+'</td><td>'+esc(e.source)+'</td></tr>').join('') + '</tbody></table>';
    const user = c.user_id || $('user').value; const tenant = c.tenant_id || $('tenant').value;
    $('user').value = user || $('user').value; $('tenant').value = tenant || $('tenant').value; saveInputs();
    $('install').innerHTML = '<p>Generate a 15-minute installer for this device. The URL is shown only in your browser.</p><div class="actions"><button id="genInstaller">Generate installer</button><button class="secondary" id="copyCurl">Copy PowerShell</button><button class="danger" id="clearToken">Clear token</button></div><div id="installerOut"></div>';
    $('genInstaller').onclick = generateInstaller;
    $('copyCurl').onclick = copyPowerShell;
    $('clearToken').onclick = () => { $('token').value=''; sessionStorage.removeItem('mlm_token'); };
  } catch(e) { $('status').innerHTML = '<pre>'+esc(e.message)+'</pre>'; setDiag({ ok:false, error:e.message }); }
}
async function generateInstaller(){
  const body = { user_id:$('user').value, tenant_id:$('tenant').value, device_id:$('device').value, ttl_minutes:15 };
  const res = await fetch('/local-connector/install/download-link', { method:'POST', headers:{...authHeaders(),'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const data = await res.json();
  setDiag({ action:'download-link', status:res.status, ok:data.ok, url_received:Boolean(data.download_url), secrets_included:false });
  if(!data.ok) { $('installerOut').innerHTML = '<pre>'+esc(JSON.stringify(data,null,2))+'</pre>'; return; }
  $('installerOut').innerHTML = '<p><a href="'+esc(data.download_url)+'" download>Download installer</a></p><p class="warn">Run as Administrator on '+esc($('device').value)+'. Do not share this file.</p>';
}
function copyPowerShell(){
  const lines = [
    "$Body = @{ user_id = '"+$('user').value+"'; tenant_id = '"+$('tenant').value+"'; device_id = '"+$('device').value+"'; ttl_minutes = 15 } | ConvertTo-Json",
    "$Headers = @{ Authorization = 'Bearer <YOUR_PLATFORM_TOKEN>'; 'Content-Type' = 'application/json'; Accept = 'application/json' }",
    "$Link = Invoke-RestMethod -Method POST -Uri 'https://auth.mad4b.com/local-connector/install/download-link' -Headers $Headers -Body $Body",
    "$Installer = \"$env:TEMP\\install-connector.bat\"",
    "Invoke-WebRequest -Uri $Link.download_url -OutFile $Installer",
    "Start-Process 'cmd.exe' -Verb RunAs -ArgumentList ('/c \"' + $Installer + '\"')"
  ];
  const script = lines.join('\\n');
  navigator.clipboard?.writeText(script);
  $('installerOut').innerHTML = '<pre>'+esc(script)+'</pre>';
}
$('load').onclick = loadDevice; loadInputs();
</script>
</body>
</html>`;
}

function localManagerShellPage({ title, eyebrow, body, primaryText, primaryHref, secondaryText = "Back to Local Manager", secondaryHref = "/app/local-manager", cards = [] }) {
  const cardHtml = cards.map((card) => `<div class="card"><h2>${escapeHtml(card.title)}</h2><p>${escapeHtml(card.body)}</p>${card.href ? `<p><a class="button secondary" href="${escapeHtml(card.href)}">${escapeHtml(card.cta || "Open")}</a></p>` : ""}</div>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · Mad4B Local Manager</title>
  <style>
    :root { color-scheme: light dark; --bg:#07111f; --card:#14213a; --fg:#f0f5ff; --muted:#a8b6d8; --line:#2d3f62; --accent:#6383ff; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; background:radial-gradient(circle at top left,#1f3265,#07111f 58%); color:var(--fg); }
    main { max-width:980px; margin:0 auto; padding:48px 20px 70px; }
    .badge { display:inline-flex; border:1px solid var(--line); border-radius:999px; padding:6px 11px; color:var(--muted); font-size:13px; margin-bottom:16px; }
    h1 { font-size:42px; line-height:1.05; margin:0 0 14px; letter-spacing:-.04em; }
    p { color:var(--muted); line-height:1.6; font-size:16px; }
    .panel,.card { background:rgba(16,26,48,.92); border:1px solid var(--line); border-radius:24px; box-shadow:0 24px 70px rgba(0,0,0,.28); }
    .panel { padding:26px; margin-bottom:16px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
    .card { padding:18px; }
    .actions { display:flex; flex-wrap:wrap; gap:12px; margin-top:20px; }
    a.button { border-radius:14px; border:1px solid #87a0ff; padding:12px 16px; color:white; background:var(--accent); text-decoration:none; font-weight:800; }
    a.secondary { background:#14213a; border-color:var(--line); }
    code { background:#0b1428; border:1px solid var(--line); border-radius:8px; padding:2px 6px; color:#dce7ff; }
    @media (max-width:760px){ .grid{grid-template-columns:1fr;} h1{font-size:34px;} }
  </style>
</head>
<body><main>
  <section class="panel">
    <span class="badge">${escapeHtml(eyebrow)}</span>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(body)}</p>
    <div class="actions"><a class="button" href="${escapeHtml(primaryHref)}">${escapeHtml(primaryText)}</a><a class="button secondary" href="${escapeHtml(secondaryHref)}">${escapeHtml(secondaryText)}</a></div>
  </section>
  <section class="grid">${cardHtml}</section>
</main></body></html>`;
}

function localManagerWindowsBootstrapScript(req) {
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim() || "https";
  const host = req.get("host") || "auth.mad4b.com";
  const baseUrl = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
  return [
    "# Mad4B Local Manager Windows Bootstrap",
    "# Public bootstrap: no backend key, no platform token, no device credential.",
    "$ErrorActionPreference = \"Stop\"",
    `$BaseUrl = \"${baseUrl.replace(/\"/g, "")}\"`,
    "$InstallRoot = Join-Path $env:LOCALAPPDATA \"Mad4B\\LocalManager\"",
    "$Desktop = [Environment]::GetFolderPath(\"Desktop\")",
    "$Shortcut = Join-Path $Desktop \"Mad4B Local Manager.url\"",
    "$Readme = Join-Path $InstallRoot \"README.txt\"",
    "$LaunchUrl = $BaseUrl + \"/app/local-manager\"",
    "New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null",
    "$ReadmeText = @("
      + "\"Mad4B Local Manager\","
      + "\"\","
      + "\"This public Windows bootstrap does not contain credentials.\","
      + "\"Open the Local Manager URL, sign in, and link this device when device-linking is available.\","
      + "\"\","
      + "\"Local Manager URL: $LaunchUrl\","
      + "\"Installed at: $InstallRoot\""
      + ")",
    "Set-Content -LiteralPath $Readme -Value $ReadmeText -Encoding UTF8",
    "$UrlContent = \"[InternetShortcut]`r`nURL=$LaunchUrl`r`nIconIndex=0`r`n\"",
    "Set-Content -LiteralPath $Shortcut -Value $UrlContent -Encoding ASCII",
    "Write-Host \"Mad4B Local Manager bootstrap installed.\"",
    "Write-Host \"Shortcut: $Shortcut\"",
    "Write-Host \"No secrets were installed by this bootstrap.\"",
    "Start-Process $LaunchUrl",
  ].join("\r\n") + "\r\n";
}

export function buildLocalManagerBetaRoutes(deps) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();

  router.get("/app/local-manager", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(localManagerAppPage());
  });

  router.get("/app/local-manager/download/windows", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(302, "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/releases/download/local-manager-windows-latest/Mad4B-Local-Manager-Setup.exe");
  });

  router.get("/app/local-manager/sign-in", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(localManagerShellPage({
      eyebrow: "Account",
      title: "Sign in to Mad4B",
      body: "Use your Mad4B account before linking a device. The production OAuth/device-code backend is the next integration step; this page is the dedicated sign-in destination for the Windows app and public flow.",
      primaryText: "Continue to device linking",
      primaryHref: "/app/local-manager/link-device",
      cards: [
        { title: "No admin token", body: "The public app never asks for shared backend keys or shared platform secrets." },
        { title: "Role-governed access", body: "After authentication, controls are scoped to the signed-in user, tenant, and device permissions." },
      ],
    }));
  });

  router.get("/app/local-manager/sign-up", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(localManagerShellPage({
      eyebrow: "Account",
      title: "Create your Mad4B account",
      body: "Create an account, then link this device from the installed Local Manager app. Account creation will route through the platform auth provider when OAuth onboarding is enabled.",
      primaryText: "Go to sign in",
      primaryHref: "/app/local-manager/sign-in",
      cards: [
        { title: "Device consent", body: "A device is registered only after the signed-in user approves linking." },
        { title: "Scoped credentials", body: "The backend issues device-scoped credentials only after linking succeeds." },
      ],
    }));
  });

  router.get("/app/local-manager/link-device", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(localManagerShellPage({
      eyebrow: "Device linking",
      title: "Link this Windows device",
      body: "This is the dedicated device-linking page. The installed app should arrive here after sign-in, then the backend will create device-scoped connector credentials for the current machine.",
      primaryText: "Open device dashboard",
      primaryHref: "/app/local-manager/devices",
      cards: [
        { title: "Pairing flow", body: "The next backend step is a short-lived device-code or OAuth return flow." },
        { title: "No shared secrets", body: "The device receives only its own scoped connector credential after consent." },
      ],
    }));
  });

  router.get("/app/local-manager/devices", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(localManagerShellPage({
      eyebrow: "Dashboard",
      title: "My devices",
      body: "After sign-in, this dashboard will list devices, health, routes, backups, DR probes, and update status for the signed-in account.",
      primaryText: "Routes",
      primaryHref: "/app/local-manager/routes",
      cards: [
        { title: "Device health", body: "View active connector status, last heartbeat, agent version, and watchdog status." },
        { title: "Updates", body: "Windows app updates are handled by the installed app's Check / install update control." },
        { title: "Backups and DR", body: "Open backup probes and restore certification actions after account authorization.", href: "/app/local-manager/backups", cta: "Backups / DR" },
        { title: "Settings", body: "Manage account, tenant, notification, and device preferences.", href: "/app/local-manager/settings", cta: "Settings" },
      ],
    }));
  });

  router.get("/app/local-manager/routes", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(localManagerShellPage({
      eyebrow: "Controls",
      title: "Routes",
      body: "View and manage connector route options after sign-in: Cloudflare tunnel, admin recovery, LAN, VPN, direct public IP, and dynamic public IP where provisioned.",
      primaryText: "My devices",
      primaryHref: "/app/local-manager/devices",
      cards: [
        { title: "Current live route", body: "The runtime selector chooses the highest-priority healthy route." },
        { title: "Optional routes", body: "LAN/VPN/direct/dynamic routes are shown as not provisioned until configured." },
      ],
    }));
  });

  router.get("/app/local-manager/backups", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(localManagerShellPage({
      eyebrow: "Controls",
      title: "Backups and DR",
      body: "After sign-in, users can view backup policy status, restore probe readiness, DB restore certification, and n8n restore certification for their authorized devices.",
      primaryText: "My devices",
      primaryHref: "/app/local-manager/devices",
      cards: [
        { title: "DB restore probe", body: "Runs only through the governed device alias after connector upgrade." },
        { title: "n8n restore probe", body: "Runs only through the governed device alias after connector upgrade." },
      ],
    }));
  });

  router.get("/app/local-manager/settings", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(localManagerShellPage({
      eyebrow: "Controls",
      title: "Settings",
      body: "After sign-in, manage profile, tenant, device notifications, update preferences, and permissions for Local Manager.",
      primaryText: "My devices",
      primaryHref: "/app/local-manager/devices",
      cards: [
        { title: "Notifications", body: "Configure backup and route health alerts when notification targets are available." },
        { title: "Security", body: "Review linked devices and revoke device credentials." },
      ],
    }));
  });

  router.get("/app/local-manager/admin", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(localManagerAdminPage());
  });

  router.get("/local-manager/beta", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(betaPage());
  });

  router.get("/local-manager/beta/status", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    try {
      const deviceId = String(req.query.device_id || "").trim() || null;
      const userId = String(req.query.user_id || "").trim() || null;
      const tenantId = String(req.query.tenant_id || "").trim() || null;
      const configs = await listConfigs({ deviceId, userId, tenantId, limit: deviceId ? 1 : 20 });
      const devices = configs.map(sanitizeConfig);
      const device = configs[0] ? await loadDeviceDetails(configs[0]) : null;
      return res.status(200).json({
        ok: true,
        beta: true,
        read_only: true,
        secrets_included: false,
        filters: { device_id: deviceId, user_id: userId, tenant_id: tenantId },
        devices,
        device,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "local_manager_beta_status_failed", message: err.message }, secrets_included: false });
    }
  });

  return router;
}
