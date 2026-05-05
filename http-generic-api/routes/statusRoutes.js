import { Router } from "express";
import { getPool } from "../db.js";

// Components and the DB table each one proves healthy by querying
const COMPONENTS = [
  { id: "api",                 label: "API Gateway",          table: null },
  { id: "database",            label: "Database",             table: null },
  { id: "tenant_management",   label: "Tenant Management",    table: "tenants" },
  { id: "identity",            label: "Identity & Access",    table: "users" },
  { id: "connector_execution", label: "Connector Execution",  table: "workflow_runs" },
  { id: "intent_resolution",   label: "Intent Resolution",    table: "intent_resolutions" },
  { id: "observability",       label: "Observability",        table: "telemetry_spans" },
  { id: "release_readiness",   label: "Release Readiness",    table: "release_readiness_log" },
];

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

function overallStatus(componentStatuses, openIncidents) {
  const hasDown = componentStatuses.some(c => c.status === "major_outage");
  if (hasDown) return "major_outage";

  const maxSeverity = openIncidents.reduce((max, inc) => {
    return Math.max(max, SEVERITY_RANK[inc.severity] || 0);
  }, 0);

  if (maxSeverity >= 4) return "major_outage";
  if (maxSeverity >= 3) return "partial_outage";
  if (maxSeverity >= 2 || componentStatuses.some(c => c.status === "degraded")) return "degraded";
  if (maxSeverity >= 1) return "degraded";
  return "operational";
}

function statusLabel(s) {
  return { operational: "Operational", degraded: "Degraded Performance",
           partial_outage: "Partial Outage", major_outage: "Major Outage" }[s] ?? s;
}

async function gatherStatus() {
  const now = new Date().toISOString();

  // 1. DB ping
  let dbOk = false;
  let pool = null;
  try {
    pool = getPool();
    await pool.query("SELECT 1");
    dbOk = true;
  } catch {
    // Keep the public status surface available even when DB config/connectivity is broken.
  }

  // 2. Component checks
  const componentStatuses = await Promise.all(COMPONENTS.map(async (c) => {
    if (c.id === "api") return { ...c, status: "operational", latency_ms: null };
    if (c.id === "database") return { ...c, status: dbOk ? "operational" : "major_outage", latency_ms: null };
    if (!dbOk) return { ...c, status: "major_outage", latency_ms: null };

    const t0 = Date.now();
    try {
      await pool.query(`SELECT 1 FROM \`${c.table}\` LIMIT 1`);
      return { ...c, status: "operational", latency_ms: Date.now() - t0 };
    } catch {
      return { ...c, status: "degraded", latency_ms: null };
    }
  }));

  // 3. Open incidents
  const [openIncidents] = dbOk && pool
    ? await pool.query(
        `SELECT incident_id, title, severity, category, status, description, created_at, updated_at
         FROM \`incidents\`
         WHERE status NOT IN ('resolved','closed')
         ORDER BY FIELD(severity,'critical','high','medium','low'), created_at DESC
         LIMIT 20`)
    : [[]];

  // 4. Past incidents (last 30 days, resolved/closed)
  const [pastIncidents] = dbOk && pool
    ? await pool.query(
        `SELECT incident_id, title, severity, category, status, created_at, resolved_at
         FROM \`incidents\`
         WHERE status IN ('resolved','closed')
           AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         ORDER BY created_at DESC
         LIMIT 50`)
    : [[]];

  const status = overallStatus(componentStatuses, openIncidents);

  return {
    status,
    status_label: statusLabel(status),
    components: componentStatuses.map(({ id, label, status, latency_ms }) => ({ id, label, status, status_label: statusLabel(status), latency_ms })),
    active_incidents: openIncidents,
    past_incidents: pastIncidents,
    updated_at: now,
  };
}

// ── HTML template ─────────────────────────────────────────────────────────────

function statusColor(s) {
  return { operational: "#2da44e", degraded: "#bf8700", partial_outage: "#e36209", major_outage: "#cf222e" }[s] ?? "#6e7681";
}
function statusBg(s) {
  return { operational: "#dafbe1", degraded: "#fff8c5", partial_outage: "#ffd8b5", major_outage: "#ffebe9" }[s] ?? "#f6f8fa";
}
function statusDot(s) {
  const color = statusColor(s);
  return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:8px;flex-shrink:0"></span>`;
}
function severityBadge(sev) {
  const colors = { critical: "#cf222e", high: "#e36209", medium: "#bf8700", low: "#6e7681" };
  const c = colors[sev] || "#6e7681";
  return `<span style="font-size:11px;font-weight:600;color:${c};text-transform:uppercase;letter-spacing:.05em">${sev}</span>`;
}
function relTime(iso) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  const diffMs = now - d;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

function buildHtml(data) {
  const headerBg  = statusBg(data.status);
  const headerCol = statusColor(data.status);

  const componentsHtml = data.components.map(c => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #e1e4e8">
      <span style="font-size:14px;color:#24292f">${c.label}</span>
      <span style="display:flex;align-items:center;font-size:13px;color:${statusColor(c.status)}">
        ${statusDot(c.status)}${c.status_label}
        ${c.latency_ms != null ? `<span style="margin-left:8px;color:#6e7681;font-size:12px">${c.latency_ms}ms</span>` : ""}
      </span>
    </div>`).join("");

  const activeHtml = data.active_incidents.length === 0
    ? `<p style="color:#6e7681;font-size:14px;margin:0">No active incidents.</p>`
    : data.active_incidents.map(inc => `
      <div style="border:1px solid #e1e4e8;border-left:4px solid ${statusColor("partial_outage")};border-radius:6px;padding:16px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          ${severityBadge(inc.severity)}
          <span style="font-size:15px;font-weight:600;color:#24292f">${inc.title}</span>
        </div>
        ${inc.description ? `<p style="font-size:13px;color:#57606a;margin:6px 0 0">${inc.description}</p>` : ""}
        <p style="font-size:12px;color:#6e7681;margin:8px 0 0">Started ${relTime(inc.created_at)} · ${inc.status.replace(/_/g," ")}</p>
      </div>`).join("");

  const pastHtml = data.past_incidents.length === 0
    ? `<p style="color:#6e7681;font-size:14px;margin:0">No incidents in the last 30 days.</p>`
    : data.past_incidents.map(inc => `
      <div style="padding:10px 0;border-bottom:1px solid #e1e4e8">
        <div style="display:flex;align-items:center;gap:8px">
          ${severityBadge(inc.severity)}
          <span style="font-size:14px;color:#24292f">${inc.title}</span>
        </div>
        <p style="font-size:12px;color:#6e7681;margin:4px 0 0">
          ${relTime(inc.created_at)}${inc.resolved_at ? ` · resolved ${relTime(inc.resolved_at)}` : ""}
        </p>
      </div>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>System Status</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;background:#f6f8fa;color:#24292f;min-height:100vh}
    a{color:inherit;text-decoration:none}
    .hero{background:${headerBg};border-bottom:1px solid rgba(0,0,0,.08);padding:48px 24px 36px;text-align:center}
    .hero h1{font-size:28px;font-weight:700;color:#24292f;margin-bottom:12px}
    .status-badge{display:inline-flex;align-items:center;background:white;border:1px solid rgba(0,0,0,.12);border-radius:24px;padding:8px 20px;font-size:16px;font-weight:600;color:${headerCol};box-shadow:0 1px 3px rgba(0,0,0,.08)}
    .container{max-width:720px;margin:0 auto;padding:32px 24px}
    .card{background:white;border:1px solid #e1e4e8;border-radius:8px;padding:24px;margin-bottom:24px}
    .card h2{font-size:16px;font-weight:600;color:#24292f;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #e1e4e8}
    .footer{text-align:center;color:#6e7681;font-size:12px;padding:24px;margin-top:8px}
    .refresh-note{font-size:12px;color:#6e7681;text-align:center;margin-bottom:8px}
  </style>
</head>
<body>
  <div class="hero">
    <h1>System Status</h1>
    <div class="status-badge">${statusDot(data.status)}${data.status_label}</div>
  </div>

  <div class="container">
    <p class="refresh-note">Last updated <span id="updated">${new Date(data.updated_at).toLocaleTimeString()}</span> · auto-refreshes every 30s</p>

    <div class="card">
      <h2>Components</h2>
      ${componentsHtml}
    </div>

    <div class="card">
      <h2>Active Incidents</h2>
      ${activeHtml}
    </div>

    <div class="card">
      <h2>Past Incidents — Last 30 Days</h2>
      ${pastHtml}
    </div>
  </div>

  <div class="footer">
    <a href="/status">JSON API</a> &nbsp;·&nbsp;
    <span>Status data refreshed automatically</span>
  </div>

  <script>
    (function() {
      let countdown = 30;
      const note = document.querySelector('.refresh-note');
      setInterval(function() {
        countdown--;
        if (countdown <= 0) {
          window.location.reload();
        }
      }, 1000);

      // Fetch JSON and patch page without full reload (future enhancement hook)
    })();
  </script>
</body>
</html>`;
}

// ── Routes ────────────────────────────────────────────────────────────────────

function isStatusHost(req) {
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();
  return host === "status.mad4b.com";
}

export function buildStatusRoutes(_deps) {
  const router = Router();

  router.get("/", async (req, res, next) => {
    if (!isStatusHost(req)) return next();

    try {
      const data = await gatherStatus();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      return res.status(200).send(buildHtml(data));
    } catch (err) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(503).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px">
        <h1 style="color:#cf222e">Status Unavailable</h1>
        <p>Could not retrieve system status: ${err.message}</p>
      </body></html>`);
    }
  });

  // ── GET /status — public JSON ─────────────────────────────────────────────
  router.get("/status", async (_req, res) => {
    try {
      const data = await gatherStatus();
      return res.status(200).json({ ok: data.status !== "major_outage", ...data });
    } catch (err) {
      return res.status(200).json({
        ok: false,
        status: "major_outage",
        status_label: "Major Outage",
        error: err.message,
        updated_at: new Date().toISOString(),
      });
    }
  });

  // ── GET /status.html — public HTML page ──────────────────────────────────
  router.get("/status.html", async (_req, res) => {
    try {
      const data = await gatherStatus();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      return res.status(200).send(buildHtml(data));
    } catch (err) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(503).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px">
        <h1 style="color:#cf222e">Status Unavailable</h1>
        <p>Could not retrieve system status: ${err.message}</p>
      </body></html>`);
    }
  });

  // ── GET /status/incidents — public JSON incident history ──────────────────
  router.get("/status/incidents", async (req, res) => {
    try {
      const { days = 30, severity, status } = req.query;
      const cap = Math.min(Number(days) || 30, 90);
      const conditions = [`created_at >= DATE_SUB(NOW(), INTERVAL ${cap} DAY)`];
      const params = [];
      if (severity) { conditions.push("severity = ?"); params.push(severity); }
      if (status)   { conditions.push("status = ?");   params.push(status); }

      const [incidents] = await getPool().query(
        `SELECT incident_id, title, severity, category, status, description, created_at, resolved_at, updated_at
         FROM \`incidents\`
         WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC LIMIT 100`,
        params
      );
      return res.status(200).json({ ok: true, incidents, count: incidents.length, window_days: cap });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "status_incidents_failed", message: err.message } });
    }
  });

  return router;
}
