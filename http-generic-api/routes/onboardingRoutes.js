import { Router } from "express";

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildOnboardingRoutes() {
  const router = Router();

  router.get("/connect", (_req, res) => {
    const customGptUrl = process.env.TENANT_GPT_URL || process.env.CUSTOM_GPT_URL || "https://chatgpt.com/gpts";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=120");
    res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mad4B Connector Setup</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #18212f;
      --muted: #5f6c7b;
      --line: #d8dee8;
      --fill: #f7f9fc;
      --panel: #ffffff;
      --blue: #155eef;
      --green: #0b7a5a;
      --red: #b42318;
      --gold: #8a5a00;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: #eef2f7;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 28px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0; }
    main { max-width: 1180px; margin: 0 auto; padding: 24px; }
    .grid { display: grid; grid-template-columns: 360px 1fr; gap: 20px; align-items: start; }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
    }
    h2 { margin: 0 0 14px; font-size: 16px; letter-spacing: 0; }
    label { display: block; margin: 12px 0 6px; color: var(--muted); font-size: 13px; }
    input, textarea {
      width: 100%;
      min-height: 40px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 9px 10px;
      color: var(--ink);
      background: #fff;
      font: inherit;
    }
    textarea { min-height: 92px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
    button, .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 38px;
      border: 1px solid var(--blue);
      border-radius: 6px;
      padding: 8px 12px;
      background: var(--blue);
      color: #fff;
      text-decoration: none;
      font-weight: 650;
      cursor: pointer;
    }
    button.secondary, .button.secondary { background: #fff; color: var(--blue); }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .tabs { display: flex; gap: 8px; margin-bottom: 14px; }
    .tabs button { flex: 1; background: #fff; color: var(--blue); }
    .tabs button.active { background: var(--blue); color: #fff; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
    .status {
      min-height: 40px;
      margin-top: 14px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      background: var(--fill);
      color: var(--muted);
      font-size: 13px;
      white-space: pre-wrap;
    }
    .status.ok { border-color: #a6d8c4; color: var(--green); background: #f0fbf6; }
    .status.err { border-color: #f3b8b4; color: var(--red); background: #fff4f3; }
    .steps { display: grid; gap: 12px; }
    .step { border-left: 3px solid var(--line); padding-left: 12px; }
    .step.done { border-left-color: var(--green); }
    .step.warn { border-left-color: var(--gold); }
    .mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 860px) {
      header { align-items: flex-start; flex-direction: column; padding: 16px; }
      main { padding: 16px; }
      .grid, .split { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Mad4B Connector Setup</h1>
    <a class="button secondary" id="gptLink" href="${htmlEscape(customGptUrl)}" target="_blank" rel="noreferrer">Open Custom GPT</a>
  </header>
  <main class="grid">
    <section>
      <div class="tabs">
        <button id="loginTab" class="active" type="button">Sign in</button>
        <button id="signupTab" type="button">Sign up</button>
      </div>
      <form id="authForm">
        <label>Email</label>
        <input id="email" type="email" autocomplete="email" required />
        <label>Password</label>
        <input id="password" type="password" autocomplete="current-password" required />
        <div id="signupFields" hidden>
          <label>Name</label>
          <input id="displayName" autocomplete="name" />
          <label>Workspace</label>
          <input id="tenantName" />
        </div>
        <div class="actions">
          <button id="authButton" type="submit">Sign in</button>
          <button id="resetButton" class="secondary" type="button">Reset</button>
        </div>
      </form>
      <div id="authStatus" class="status">No active session.</div>
    </section>
    <section>
      <h2>Backend Connection Activation</h2>
      <div class="steps">
        <div class="step" id="stepAuth"><strong>Session</strong><div id="sessionText" class="mono">Not signed in</div></div>
        <div class="step" id="stepCreds"><strong>Cloudflare and Hostinger</strong><div class="split">
          <div>
            <label>Cloudflare API token</label>
            <input id="cfToken" type="password" autocomplete="off" />
            <label>Cloudflare account ID</label>
            <input id="cfAccount" autocomplete="off" />
          </div>
          <div>
            <label>Hostinger API token</label>
            <input id="hostingerToken" type="password" autocomplete="off" />
            <label>Device ID</label>
            <input id="deviceId" autocomplete="off" />
          </div>
        </div></div>
        <div class="step" id="stepInstall"><strong>Local runtime</strong><div id="installText" class="mono">Waiting for credentials</div></div>
      </div>
      <div class="actions">
        <button id="saveCreds" type="button">Save Credentials</button>
        <button id="installDevice" type="button">Create Install Bundle</button>
        <button id="downloadPs1" class="secondary" type="button" disabled>Download PowerShell</button>
        <button id="downloadEnv" class="secondary" type="button" disabled>Download .env</button>
      </div>
      <div id="setupStatus" class="status">Ready.</div>
    </section>
  </main>
  <footer style="text-align:center;padding:20px 28px;font-size:12px;color:#8a9ab0;border-top:1px solid #d8dee8;margin-top:12px;">
    A multi-tenant, Human-Managed, governed-registry-driven execution system &mdash; Growth AI Intelligence-Human Managed Platform &nbsp;&bull;&nbsp;
    Created by <a href="https://nagy.essam.website" target="_blank" rel="noreferrer" style="color:#155eef;text-decoration:none;">Essam Nagy</a>
  </footer>
  <script>
    const state = JSON.parse(localStorage.getItem("mad4b_connect_state") || "{}");
    let mode = "login";
    let installBundle = null;
    const $ = (id) => document.getElementById(id);
    const api = async (path, options = {}) => {
      const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
      if (state.token) headers.Authorization = "Bearer " + state.token;
      const res = await fetch(path, { ...options, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error?.message || data.error || res.statusText);
      return data;
    };
    function saveState() { localStorage.setItem("mad4b_connect_state", JSON.stringify(state)); render(); }
    function status(id, text, kind = "") { const el = $(id); el.textContent = text; el.className = "status " + kind; }
    function render() {
      $("signupFields").hidden = mode !== "signup";
      $("loginTab").classList.toggle("active", mode === "login");
      $("signupTab").classList.toggle("active", mode === "signup");
      $("authButton").textContent = mode === "login" ? "Sign in" : "Create account";
      const session = state.user_id ? state.email + "\\nuser_id=" + state.user_id + "\\ntenant_id=" + (state.tenant_id || "") : "Not signed in";
      $("sessionText").textContent = session;
      $("stepAuth").classList.toggle("done", !!state.token);
      $("stepCreds").classList.toggle("done", !!(state.cloudflare_connection_id && state.hostinger_connection_id));
      $("stepInstall").classList.toggle("done", !!installBundle);
      if (!state.device_id) $("deviceId").value = localStorage.getItem("mad4b_device_id") || (navigator.platform || "device").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 32);
    }
    $("loginTab").onclick = () => { mode = "login"; render(); };
    $("signupTab").onclick = () => { mode = "signup"; render(); };
    $("resetButton").onclick = () => { localStorage.removeItem("mad4b_connect_state"); location.reload(); };
    $("authForm").onsubmit = async (event) => {
      event.preventDefault();
      try {
        const body = { email: $("email").value, password: $("password").value };
        if (mode === "signup") {
          body.display_name = $("displayName").value;
          body.tenant_display_name = $("tenantName").value;
        }
        const data = await api(mode === "signup" ? "/auth/register" : "/auth/login", { method: "POST", body: JSON.stringify(body) });
        Object.assign(state, data);
        status("authStatus", "Signed in.", "ok");
        saveState();
      } catch (err) { status("authStatus", err.message, "err"); }
    };
    async function connectApp(appKey, credentials, displayLabel) {
      const data = await api("/app-connections", {
        method: "POST",
        body: JSON.stringify({
          user_id: state.user_id,
          tenant_id: state.tenant_id,
          app_key: appKey,
          auth_type: "api_key",
          display_label: displayLabel,
          credentials
        })
      });
      return data.connection_id;
    }
    $("saveCreds").onclick = async () => {
      try {
        if (!state.token || !state.user_id || !state.tenant_id) throw new Error("Sign in first.");
        state.cloudflare_connection_id = await connectApp("cloudflare", {
          cloudflare_api_token: $("cfToken").value,
          cloudflare_account_id: $("cfAccount").value
        }, "Cloudflare local routing");
        state.hostinger_connection_id = await connectApp("hostinger", {
          hostinger_api_token: $("hostingerToken").value
        }, "Hostinger DNS routing");
        status("setupStatus", "Credentials stored in encrypted DB connections.", "ok");
        saveState();
      } catch (err) { status("setupStatus", err.message, "err"); }
    };
    $("installDevice").onclick = async () => {
      try {
        if (!state.cloudflare_connection_id || !state.hostinger_connection_id) throw new Error("Save credentials first.");
        const device_id = $("deviceId").value.trim();
        if (!device_id) throw new Error("Device ID required.");
        localStorage.setItem("mad4b_device_id", device_id);
        const data = await api("/local-connector/install", {
          method: "POST",
          body: JSON.stringify({
            user_id: state.user_id,
            tenant_id: state.tenant_id,
            device_id,
            cloudflare_connection_id: state.cloudflare_connection_id,
            hostinger_connection_id: state.hostinger_connection_id
          })
        });
        installBundle = data;
        $("installText").textContent = data.tunnel_url + "\\n" + (data.installation?.local_runtime?.start_command || "start-connector.bat");
        $("downloadPs1").disabled = false;
        $("downloadEnv").disabled = false;
        status("setupStatus", "Install bundle created for " + data.tunnel_url, "ok");
        render();
      } catch (err) { status("setupStatus", err.message, "err"); }
    };
    function download(name, content) {
      const blob = new Blob([content || ""], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    }
    $("downloadPs1").onclick = () => download("install-local-connector.ps1", installBundle?.installation?.install_ps1 || "");
    $("downloadEnv").onclick = () => download(".env", installBundle?.installation?.files?.[".env"] || "");
    render();
  </script>
</body>
</html>`);
  });

  return router;
}
