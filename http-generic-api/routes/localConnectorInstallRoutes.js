import { Router } from "express";
import { getPool } from "../db.js";
import { createHash, randomUUID } from "node:crypto";

const CF_API = "https://api.cloudflare.com/client/v4";
const CONNECTOR_PORT = 7070;
const CONNECTOR_SUBDOMAIN_SUFFIX = ".connector.mad4b.com";
const DNS_DOMAIN = "mad4b.com";
const CONNECTOR_DNS_PARENT = "connector";

const DEFAULT_WINDOWS_ALIASES = [
  { alias: "node_ver",       cmd: "node",     args: ["--version"],                              allow_extra_args: false, description: "Node.js version" },
  { alias: "git_status",     cmd: "git",      args: ["status"],                                 allow_extra_args: false, description: "Git status" },
  { alias: "list_processes", cmd: "tasklist", args: ["/FO", "CSV", "/NH"],                      allow_extra_args: false, description: "Running processes (CSV)" },
  { alias: "disk_usage",     cmd: "wmic",     args: ["logicaldisk", "get", "size,freespace,caption"], allow_extra_args: false, description: "Disk usage" },
  { alias: "n8n_health",     cmd: "curl",     args: ["-s", "--max-time", "10", "http://127.0.0.1:5678/"], allow_extra_args: false, description: "n8n health check" },
];

// ── Cloudflare tunnel helpers ──────────────────────────────────────────────────

function cfHeaders() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN not configured.");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function cfRequest(method, path, body) {
  const res = await fetch(`${CF_API}${path}`, {
    method,
    headers: cfHeaders(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.errors?.[0]?.message || "Cloudflare API error");
  return json.result;
}

async function provisionTunnel(accountId, tunnelName) {
  const tunnel = await cfRequest("POST", `/accounts/${accountId}/cfd_tunnel`, {
    name: tunnelName,
    tunnel_secret: Buffer.from(randomUUID().replace(/-/g, ""), "hex").toString("base64"),
    config_src: "cloudflare",
  });
  const tokenResult = await cfRequest("GET", `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/token`);
  return { tunnelId: tunnel.id, tunnelName: tunnel.name, token: tokenResult };
}

async function readTunnelIngress(accountId, tunnelId) {
  try {
    const result = await cfRequest("GET", `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`);
    return Array.isArray(result?.config?.ingress) ? result.config.ingress : [];
  } catch (err) {
    console.warn("[install] Cloudflare ingress read warning:", err.message);
    return [];
  }
}

function upsertIngressEntry(existingIngress, hostname, serviceUrl) {
  const targetHost = String(hostname || "").toLowerCase();
  const existingRoutes = existingIngress
    .filter((entry) => entry && entry.hostname)
    .filter((entry) => String(entry.hostname).toLowerCase() !== targetHost);
  return [
    ...existingRoutes,
    { hostname, service: serviceUrl },
    { service: "http_status:404" },
  ];
}

async function publishTunnelIngress(accountId, tunnelId, hostname, serviceUrl = `http://localhost:${CONNECTOR_PORT}`) {
  const existingIngress = await readTunnelIngress(accountId, tunnelId);
  return cfRequest("PUT", `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, {
    config: {
      ingress: upsertIngressEntry(existingIngress, hostname, serviceUrl),
    },
  });
}

function hostingerApiKey() {
  return (
    process.env.HOSTINGER_CLOUD_PLAN_01_API_KEY ||
    process.env.HOSTINGER_API_TOKEN ||
    process.env.HOSTINGER_SHARED_MANAGER_01_API_KEY ||
    ""
  );
}

async function upsertHostingerCname(recordName, tunnelId) {
  const target = `${tunnelId}.cfargotunnel.com.`;
  const res = await fetch(`https://developers.hostinger.com/api/v1/dns/zone/${encodeURIComponent(DNS_DOMAIN)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${hostingerApiKey()}` },
    body: JSON.stringify({ records: [{ name: recordName, type: "CNAME", ttl: 300, content: target }] }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Hostinger DNS failed (${res.status}): ${txt.slice(0, 120)}`);
  }
  return await res.json();
}

function safeDnsLabel(value, fallback = "device") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return (normalized || fallback).slice(0, 32).replace(/^-+|-+$/g, "") || fallback;
}

function shortHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 10);
}

function buildUserDeviceRoute({ userId, deviceId, requestedHostname }) {
  const requested = String(requestedHostname || "").trim().toLowerCase();
  if (requested) {
    if (!requested.endsWith(CONNECTOR_SUBDOMAIN_SUFFIX)) {
      const err = new Error(`hostname must end with ${CONNECTOR_SUBDOMAIN_SUFFIX}`);
      err.status = 400; err.code = "invalid_hostname"; throw err;
    }
    const recordName = requested.slice(0, -`.${DNS_DOMAIN}`.length);
    return { hostname: requested, recordName };
  }

  const userLabel = safeDnsLabel(userId, "user");
  const deviceLabel = safeDnsLabel(deviceId, "device");
  const label = `${userLabel.slice(0, 18)}-${deviceLabel.slice(0, 24)}-${shortHash(`${userId}:${deviceId}`)}`.slice(0, 63).replace(/-+$/g, "");
  return {
    hostname: `${label}${CONNECTOR_SUBDOMAIN_SUFFIX}`,
    recordName: `${label}.${CONNECTOR_DNS_PARENT}`,
  };
}

// ── Builders ──────────────────────────────────────────────────────────────────

function buildAllowlistEnvValue(aliases) {
  const obj = {};
  for (const a of aliases) {
    obj[a.alias] = { command: a.cmd, args: a.args || [], display_name: a.description || a.alias, allow_extra_args: !!a.allow_extra_args };
  }
  return JSON.stringify(obj);
}

function buildInstallScript({ cfToken, connectorSecret, tunnelUrl, aliases, port }) {
  const allowlistVal = buildAllowlistEnvValue(aliases);
  return [
    "@echo off",
    "REM Mad4B Local Connector — auto-provisioned by platform",
    "REM Run once: this script installs cloudflared and starts your connector.",
    "",
    "REM ── 1. Install cloudflared (skip if already installed) ──",
    "where cloudflared >nul 2>&1 || (winget install Cloudflare.cloudflared -e --silent)",
    "",
    "REM ── 2. Register tunnel with Cloudflare ──",
    `cloudflared service install ${cfToken}`,
    "",
    "REM ── 3. Start local connector agent ──",
    `set BACKEND_API_KEY=${connectorSecret}`,
    `set CONNECTOR_PORT=${port}`,
    "set MAIN_API_URL=https://api.mad4b.com",
    "set CONNECTOR_SHELL_ENABLED=true",
    "set CONNECTOR_FILES_ENABLED=false",
    "set CONNECTOR_FETCH_UPLOAD_ENABLED=true",
    `set CONNECTOR_SHELL_ALLOWLIST=${allowlistVal}`,
    `node "%~dp0server.mjs" >> "%~dp0connector.log" 2>&1`,
  ].join("\r\n");
}

// ── Routes ────────────────────────────────────────────────────────────────────

export function buildLocalConnectorInstallRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── POST /local-connector/install ─────────────────────────────────────────
  // Governs the full install lifecycle for any user/device.
  // Creates a Cloudflare tunnel, adds DNS CNAME, seeds DB config + allowlist,
  // returns a ready-to-run install.bat. Idempotent per user+device.
  router.post("/local-connector/install", requireBackendApiKey, async (req, res) => {
    try {
      const {
        user_id, tenant_id, device_id,
        hostname = null,
        custom_aliases = [],
        reprovision = false,
      } = req.body || {};
      if (!user_id || !tenant_id || !device_id) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "user_id, tenant_id, device_id required." } });
      }

      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
      if (!accountId) return res.status(500).json({ ok: false, error: { code: "missing_config", message: "CLOUDFLARE_ACCOUNT_ID not configured." } });

      const pool = getPool();

      const [[tenant]] = await pool.query("SELECT tenant_id FROM `tenants` WHERE tenant_id = ? LIMIT 1", [tenant_id]);
      if (!tenant) return res.status(404).json({ ok: false, error: { code: "tenant_not_found" } });

      const [[existing]] = await pool.query(
        "SELECT config_id, cf_tunnel_id, cf_token, connector_secret, tunnel_url FROM `local_connector_user_configs` WHERE user_id = ? AND tenant_id = ? AND device_id = ? LIMIT 1",
        [user_id, tenant_id, device_id]
      );

      let configId, tunnelId, tunnelToken, tunnelUrl, connectorSecret, dnsRecordName;

      if (existing && !reprovision) {
        // Return existing install bundle without re-provisioning
        configId = existing.config_id;
        tunnelId = existing.cf_tunnel_id;
        tunnelToken = existing.cf_token;
        tunnelUrl = existing.tunnel_url;
        connectorSecret = existing.connector_secret;
        dnsRecordName = tunnelUrl ? new URL(tunnelUrl).hostname.slice(0, -`.${DNS_DOMAIN}`.length) : null;
        if (tunnelId && tunnelUrl && dnsRecordName) {
          const existingHostname = new URL(tunnelUrl).hostname;
          await publishTunnelIngress(accountId, tunnelId, existingHostname);
          try {
            await upsertHostingerCname(dnsRecordName, tunnelId);
          } catch (dnsErr) {
            console.warn("[install] DNS warning:", dnsErr.message);
          }
        }
      } else {
        // Provision a new Cloudflare tunnel
        const route = buildUserDeviceRoute({ userId: user_id, deviceId: device_id, requestedHostname: hostname });
        const tunnelName = `${safeDnsLabel(user_id, "user")}-${safeDnsLabel(device_id, "device")}-connector`.slice(0, 128);
        const { tunnelId: newTunnelId, token } = await provisionTunnel(accountId, tunnelName);
        await publishTunnelIngress(accountId, newTunnelId, route.hostname);

        // Add CNAME via Hostinger
        try {
          await upsertHostingerCname(route.recordName, newTunnelId);
        } catch (dnsErr) {
          // Non-fatal if CNAME already exists — log and continue
          console.warn("[install] DNS warning:", dnsErr.message);
        }

        tunnelId = newTunnelId;
        tunnelToken = token;
        tunnelUrl = `https://${route.hostname}`;
        dnsRecordName = route.recordName;
        connectorSecret = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
        const newConfigId = existing?.config_id || randomUUID();
        configId = newConfigId;

        await pool.query(
          `INSERT INTO \`local_connector_user_configs\`
             (config_id, user_id, tenant_id, device_id, tunnel_url, connector_secret, cf_tunnel_id, cf_tunnel_name, cf_token, is_enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE
             tunnel_url = VALUES(tunnel_url),
             connector_secret = VALUES(connector_secret),
             cf_tunnel_id = VALUES(cf_tunnel_id),
             cf_tunnel_name = VALUES(cf_tunnel_name),
             cf_token = VALUES(cf_token),
             is_enabled = 1`,
          [configId, user_id, tenant_id, device_id, tunnelUrl, connectorSecret, tunnelId, tunnelName, tunnelToken]
        );
      }

      // Seed allowlist (idempotent)
      const [[cfgRow]] = await pool.query(
        "SELECT config_id FROM `local_connector_user_configs` WHERE user_id = ? AND tenant_id = ? AND device_id = ? LIMIT 1",
        [user_id, tenant_id, device_id]
      );
      const finalConfigId = cfgRow.config_id;

      const allAliases = [...DEFAULT_WINDOWS_ALIASES, ...custom_aliases];
      for (const entry of allAliases) {
        const cmdTemplate = [entry.cmd, ...(entry.args || [])].join(" ");
        await pool.query(
          `INSERT IGNORE INTO \`local_connector_shell_allowlists\`
             (config_id, alias, command_template, allow_extra_args, description)
           VALUES (?, ?, ?, ?, ?)`,
          [finalConfigId, entry.alias, cmdTemplate, entry.allow_extra_args ? 1 : 0, entry.description || null]
        );
      }

      const installScript = buildInstallScript({
        cfToken: tunnelToken,
        connectorSecret,
        tunnelUrl,
        aliases: allAliases,
        port: CONNECTOR_PORT,
      });

      return res.status(200).json({
        ok: true,
        config_id: finalConfigId,
        device_id,
        tunnel_url: tunnelUrl,
        dns_record: {
          domain: DNS_DOMAIN,
          name: dnsRecordName,
          type: "CNAME",
          content: tunnelId ? `${tunnelId}.cfargotunnel.com.` : null,
        },
        connector_secret: connectorSecret,
        cf_tunnel_id: tunnelId,
        cloud_run_env: {
          CONNECTOR_LOCAL_API_KEY: connectorSecret,
          instruction: `gcloud run services update http-generic-api --region=europe-west1 --update-env-vars="CONNECTOR_LOCAL_API_KEY=${connectorSecret}"`,
        },
        installation: {
          aliases: allAliases.map((a) => a.alias),
          install_bat: installScript,
          steps: [
            "1. Save install_bat content as install.bat in your local-connector folder.",
            "2. Run install.bat as Administrator (installs cloudflared service + starts connector).",
            `3. Update Cloud Run: ${`gcloud run services update http-generic-api --region=europe-west1 --update-env-vars="CONNECTOR_LOCAL_API_KEY=${connectorSecret}"`}`,
            `4. Confirm DNS CNAME ${dnsRecordName}.${DNS_DOMAIN} -> ${tunnelId}.cfargotunnel.com.`,
            `5. Test: GET /local-connector/health?user_id=${user_id}&tenant_id=${tenant_id}&device_id=${device_id}`,
          ],
        },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "install_failed", message: err.message } });
    }
  });

  // ── GET /local-connector/install/status ───────────────────────────────────
  router.get("/local-connector/install/status", requireBackendApiKey, async (req, res) => {
    try {
      const { user_id, tenant_id, device_id } = req.query;
      if (!user_id || !tenant_id || !device_id) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "user_id, tenant_id, device_id required." } });
      }
      const [[config]] = await getPool().query(
        "SELECT config_id, tunnel_url, cf_tunnel_id, cf_tunnel_name, is_enabled, created_at, updated_at FROM `local_connector_user_configs` WHERE user_id = ? AND tenant_id = ? AND device_id = ? LIMIT 1",
        [user_id, tenant_id, device_id]
      );
      if (!config) return res.status(200).json({ ok: true, installed: false });

      const [aliases] = await getPool().query(
        "SELECT alias, command_template, allow_extra_args, description FROM `local_connector_shell_allowlists` WHERE config_id = ?",
        [config.config_id]
      );
      return res.status(200).json({ ok: true, installed: true, config, aliases });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "status_failed", message: err.message } });
    }
  });

  // ── DELETE /local-connector/uninstall ─────────────────────────────────────
  router.delete("/local-connector/uninstall", requireBackendApiKey, async (req, res) => {
    try {
      const { user_id, tenant_id, device_id } = req.body || {};
      if (!user_id || !tenant_id || !device_id) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields" } });
      }
      const [result] = await getPool().query(
        "UPDATE `local_connector_user_configs` SET is_enabled = 0 WHERE user_id = ? AND tenant_id = ? AND device_id = ?",
        [user_id, tenant_id, device_id]
      );
      if (result.affectedRows === 0) return res.status(404).json({ ok: false, error: { code: "config_not_found" } });
      return res.status(200).json({ ok: true, message: "Local connector disabled for this device." });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "uninstall_failed", message: err.message } });
    }
  });

  return router;
}
