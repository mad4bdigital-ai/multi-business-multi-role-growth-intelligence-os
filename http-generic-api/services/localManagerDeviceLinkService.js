import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";
const DEVICE_LINK_TTL_SECONDS = 10 * 60;
const POLL_INTERVAL_SECONDS = 3;
const DEVICE_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

function nowMs() {
  return Date.now();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function randomDisplayCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i += 1) out += alphabet[crypto.randomInt(0, alphabet.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

function cleanId(value, { fallback = "", max = 128 } = {}) {
  const raw = String(value || "").trim().slice(0, max);
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return safe || fallback;
}

function cleanText(value, max = 255) {
  return String(value || "").trim().slice(0, max);
}

function jsonString(value) {
  try {
    return JSON.stringify(value || {});
  } catch {
    return "{}";
  }
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function getBaseUrl(req) {
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim() || "https";
  const host = req.get("host") || "auth.mad4b.com";
  return (process.env.PUBLIC_BASE_URL || `${proto}://${host}`).replace(/\/$/, "");
}

async function ensureDeviceLinkTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS \`local_manager_device_link_sessions\` (
      \`session_id\` VARCHAR(64) NOT NULL,
      \`display_code\` VARCHAR(16) NOT NULL,
      \`display_code_hash\` VARCHAR(64) NOT NULL,
      \`poll_token_hash\` VARCHAR(64) NOT NULL,
      \`status\` VARCHAR(24) NOT NULL DEFAULT 'pending',
      \`device_id\` VARCHAR(128) NOT NULL,
      \`hostname\` VARCHAR(255) NULL,
      \`platform\` VARCHAR(32) NULL,
      \`app_version\` VARCHAR(80) NULL,
      \`user_id\` VARCHAR(64) NULL,
      \`tenant_id\` VARCHAR(64) NULL,
      \`approved_at\` DATETIME NULL,
      \`completed_at\` DATETIME NULL,
      \`expires_at\` DATETIME NOT NULL,
      \`metadata_json\` JSON NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`session_id\`),
      UNIQUE KEY \`uq_local_manager_display_code_hash\` (\`display_code_hash\`),
      KEY \`idx_local_manager_device_link_status\` (\`status\`, \`expires_at\`),
      KEY \`idx_local_manager_device_link_owner\` (\`user_id\`, \`tenant_id\`),
      KEY \`idx_local_manager_device_link_device\` (\`device_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

function sanitizeSession(row) {
  if (!row) return null;
  return {
    session_id: row.session_id,
    status: row.status,
    device_id: row.device_id,
    hostname: row.hostname || null,
    platform: row.platform || null,
    app_version: row.app_version || null,
    user_id: row.user_id || null,
    tenant_id: row.tenant_id || null,
    approved_at: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    metadata: parseJson(row.metadata_json),
  };
}

async function fetchUserMembership({ userId, tenantId = null }) {
  const pool = getPool();
  const [userRows] = await pool.query(
    `SELECT user_id, email, display_name, status FROM \`users\` WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  const user = userRows[0] || null;
  if (!user || user.status !== "active") return null;

  if (tenantId) {
    const [rows] = await pool.query(
      `SELECT m.tenant_id, m.role, m.status, t.display_name AS tenant_display_name
         FROM \`memberships\` m
         LEFT JOIN \`tenants\` t ON t.tenant_id = m.tenant_id
        WHERE m.user_id = ? AND m.tenant_id = ? AND m.status = 'active'
        LIMIT 1`,
      [userId, tenantId]
    );
    return rows[0] ? { user, membership: rows[0] } : null;
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
  return rows[0] ? { user, membership: rows[0] } : { user, membership: { tenant_id: null, role: null, status: null, tenant_display_name: null } };
}

export async function requireLocalManagerUser(req) {
  const auth = String(req.headers.authorization || "");
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    const err = new Error("A signed-in user token is required.");
    err.status = 401;
    err.code = "user_jwt_required";
    throw err;
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    const err = new Error("User token is invalid or expired.");
    err.status = 401;
    err.code = "invalid_user_jwt";
    throw err;
  }

  const userId = cleanText(payload.user_id, 64);
  if (!userId) {
    const err = new Error("User token is missing user_id.");
    err.status = 401;
    err.code = "invalid_user_jwt";
    throw err;
  }
  const tenantId = cleanText(payload.tenant_id, 64) || null;
  const resolved = await fetchUserMembership({ userId, tenantId });
  if (!resolved) {
    const err = new Error("Active user membership was not found.");
    err.status = 403;
    err.code = "tenant_membership_required";
    throw err;
  }

  return {
    user_id: resolved.user.user_id,
    email: resolved.user.email,
    display_name: resolved.user.display_name,
    tenant_id: resolved.membership?.tenant_id || tenantId,
    role: resolved.membership?.role || null,
    tenant_display_name: resolved.membership?.tenant_display_name || null,
  };
}

export async function startDeviceLinkSession(req, res) {
  try {
    await ensureDeviceLinkTable();
    const body = req.body || {};
    const hostname = cleanText(body.hostname || body.device_name || "", 255);
    const deviceId = cleanId(body.device_id, { fallback: cleanId(hostname, { fallback: `device-${crypto.randomUUID().slice(0, 8)}` }), max: 128 });
    const platform = cleanText(body.platform || "windows", 32) || "windows";
    const appVersion = cleanText(body.app_version || "", 80);
    const displayCode = randomDisplayCode();
    const pollToken = randomToken(32);
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(nowMs() + DEVICE_LINK_TTL_SECONDS * 1000);
    const metadata = {
      source: "local_manager_windows_app",
      user_agent: cleanText(req.get("user-agent") || "", 255),
      ip_seen: cleanText(req.ip || req.socket?.remoteAddress || "", 64),
    };

    await getPool().query(
      `INSERT INTO \`local_manager_device_link_sessions\`
        (session_id, display_code, display_code_hash, poll_token_hash, status, device_id, hostname, platform, app_version, expires_at, metadata_json)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      [sessionId, displayCode, sha256(displayCode), sha256(pollToken), deviceId, hostname || null, platform, appVersion || null, expiresAt, jsonString(metadata)]
    );

    const verificationUri = `${getBaseUrl(req)}/app/local-manager/link-device?code=${encodeURIComponent(displayCode)}`;
    return res.status(201).json({
      ok: true,
      session_id: sessionId,
      device_code: displayCode,
      user_code: displayCode,
      verification_uri: verificationUri,
      verification_uri_complete: verificationUri,
      expires_in: DEVICE_LINK_TTL_SECONDS,
      interval: POLL_INTERVAL_SECONDS,
      poll_token: pollToken,
      secrets_included: false,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_link_start_failed", message: err.message }, secrets_included: false });
  }
}

export async function pollDeviceLinkSession(req, res) {
  try {
    await ensureDeviceLinkTable();
    const displayCode = cleanText(req.body?.device_code || req.body?.user_code || req.body?.code, 16).toUpperCase();
    const pollToken = cleanText(req.body?.poll_token, 200);
    if (!displayCode || !pollToken) {
      return res.status(400).json({ ok: false, error: { code: "missing_poll_fields", message: "device_code and poll_token are required." }, secrets_included: false });
    }

    const [rows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\` WHERE display_code_hash = ? LIMIT 1`,
      [sha256(displayCode)]
    );
    const row = rows[0] || null;
    if (!row || row.poll_token_hash !== sha256(pollToken)) {
      return res.status(404).json({ ok: false, error: { code: "device_link_not_found", message: "Pairing session was not found." }, secrets_included: false });
    }
    if (new Date(row.expires_at).getTime() <= nowMs() && row.status === "pending") {
      await getPool().query(`UPDATE \`local_manager_device_link_sessions\` SET status = 'expired' WHERE session_id = ?`, [row.session_id]);
      return res.status(410).json({ ok: false, status: "expired", error: { code: "device_link_expired", message: "Pairing code expired." }, secrets_included: false });
    }
    if (row.status === "pending") {
      return res.status(202).json({ ok: true, status: "pending", interval: POLL_INTERVAL_SECONDS, expires_at: new Date(row.expires_at).toISOString(), secrets_included: false });
    }
    if (row.status !== "approved") {
      return res.status(200).json({ ok: true, status: row.status, device: sanitizeSession(row), secrets_included: false });
    }
    if (row.completed_at) {
      return res.status(200).json({ ok: true, status: "completed", device: sanitizeSession(row), secrets_included: false });
    }

    const deviceAccessToken = jwt.sign(
      {
        purpose: "local_manager_device_access",
        user_id: row.user_id,
        tenant_id: row.tenant_id,
        device_id: row.device_id,
        session_id: row.session_id,
        scope: "local_manager.device",
      },
      JWT_SECRET,
      { expiresIn: DEVICE_TOKEN_TTL_SECONDS, jwtid: crypto.randomUUID() }
    );
    await getPool().query(
      `UPDATE \`local_manager_device_link_sessions\` SET status = 'completed', completed_at = NOW() WHERE session_id = ?`,
      [row.session_id]
    );
    return res.status(200).json({
      ok: true,
      status: "approved",
      device_access_token: deviceAccessToken,
      token_type: "Bearer",
      expires_in: DEVICE_TOKEN_TTL_SECONDS,
      device: sanitizeSession({ ...row, status: "completed", completed_at: new Date() }),
      secrets_included: false,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_link_poll_failed", message: err.message }, secrets_included: false });
  }
}

export async function approveDeviceLinkSession(req, res) {
  try {
    await ensureDeviceLinkTable();
    const principal = await requireLocalManagerUser(req);
    const displayCode = cleanText(req.body?.device_code || req.body?.user_code || req.body?.code, 16).toUpperCase();
    if (!displayCode) {
      return res.status(400).json({ ok: false, error: { code: "missing_device_code", message: "A pairing code is required." }, secrets_included: false });
    }

    const [rows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\` WHERE display_code_hash = ? LIMIT 1`,
      [sha256(displayCode)]
    );
    const row = rows[0] || null;
    if (!row) {
      return res.status(404).json({ ok: false, error: { code: "device_link_not_found", message: "Pairing code was not found." }, secrets_included: false });
    }
    if (new Date(row.expires_at).getTime() <= nowMs()) {
      await getPool().query(`UPDATE \`local_manager_device_link_sessions\` SET status = 'expired' WHERE session_id = ? AND status = 'pending'`, [row.session_id]);
      return res.status(410).json({ ok: false, error: { code: "device_link_expired", message: "Pairing code expired." }, secrets_included: false });
    }
    if (row.status !== "pending") {
      return res.status(409).json({ ok: false, status: row.status, error: { code: "device_link_not_pending", message: "Pairing code is no longer pending." }, secrets_included: false });
    }

    await getPool().query(
      `UPDATE \`local_manager_device_link_sessions\`
          SET status = 'approved', user_id = ?, tenant_id = ?, approved_at = NOW()
        WHERE session_id = ? AND status = 'pending'`,
      [principal.user_id, principal.tenant_id, row.session_id]
    );
    const approved = { ...row, status: "approved", user_id: principal.user_id, tenant_id: principal.tenant_id, approved_at: new Date() };
    return res.status(200).json({ ok: true, status: "approved", user: principal, device: sanitizeSession(approved), secrets_included: false });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_link_approve_failed", message: err.message }, secrets_included: false });
  }
}

export async function listLinkedDevices(req, res) {
  try {
    await ensureDeviceLinkTable();
    const principal = await requireLocalManagerUser(req);
    const [linkRows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\`
        WHERE user_id = ? AND (? IS NULL OR tenant_id = ?)
        ORDER BY COALESCE(completed_at, approved_at, created_at) DESC
        LIMIT 50`,
      [principal.user_id, principal.tenant_id, principal.tenant_id]
    );
    return res.status(200).json({ ok: true, user: principal, devices: linkRows.map(sanitizeSession), secrets_included: false });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_list_failed", message: err.message }, secrets_included: false });
  }
}
