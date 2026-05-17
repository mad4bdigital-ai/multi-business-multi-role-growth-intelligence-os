import { Router, raw } from "express";
import { readFileSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import { createHash } from "crypto";
import { Readable } from "stream";
import { getPool } from "../db.js";
import { getGoogleClientsForSpreadsheet } from "../googleSheets.js";
import { ACTIVATION_BOOTSTRAP_SPREADSHEET_ID } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_PATH = resolve(__dirname, "../../local-connector/server.mjs");
const EXPORT_ROOT = process.env.DB_BACKUP_EXPORT_ROOT || "/tmp/growth-os-db-backups";
const UPLOAD_SUBFOLDERS = new Set(["artifacts", "manifests", "keys", "restore-tests"]);

function safeName(value = "") {
  const name = String(value || "");
  return /^[A-Za-z0-9._ -]+$/.test(name) ? name.trim() : "";
}
function safeTokenName(value = "") {
  const name = String(value || "");
  return /^[A-Za-z0-9._-]+$/.test(name) ? name : "";
}
function tokenHash(token = "") {
  return createHash("sha256").update(String(token || "")).digest("hex");
}
function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function getAgentSource() {
  return readFileSync(AGENT_PATH, "utf8");
}

function getAgentMeta() {
  const src = getAgentSource();
  const stat = statSync(AGENT_PATH);
  return {
    path: AGENT_PATH,
    bytes: Buffer.byteLength(src, "utf8"),
    sha256: createHash("sha256").update(src).digest("hex"),
    modified_at: stat.mtime.toISOString(),
    has_n8n_lifecycle: src.includes("handleN8nV2") && src.includes("N8N_COMMAND"),
  };
}

async function getOrCreateDriveFolder(drive, parentId, name) {
  const escaped = name.replace(/'/g, "\\'");
  const q = [
    `name='${escaped}'`,
    "mimeType='application/vnd.google-apps.folder'",
    `'${parentId}' in parents`,
    "trashed=false",
  ].join(" and ");
  const list = await drive.files.list({
    q,
    fields: "files(id,name)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (list.data?.files?.[0]?.id) return list.data.files[0].id;
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id,name",
    supportsAllDrives: true,
  });
  return created.data.id;
}

async function validateOffsiteSession(sessionId, token) {
  const [rows] = await getPool().query(
    `SELECT session_id, token_sha256, parent_folder_id, status, expires_at
       FROM offsite_drive_upload_sessions
      WHERE session_id=?
      LIMIT 1`,
    [sessionId]
  );
  const row = rows?.[0];
  if (!row) {
    const err = new Error("Upload session not found.");
    err.status = 404;
    err.code = "offsite_upload_session_not_found";
    throw err;
  }
  if (row.status !== "active") {
    const err = new Error("Upload session is not active.");
    err.status = 410;
    err.code = "offsite_upload_session_inactive";
    throw err;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    const err = new Error("Upload session expired.");
    err.status = 410;
    err.code = "offsite_upload_session_expired";
    throw err;
  }
  if (tokenHash(token) !== row.token_sha256) {
    const err = new Error("Invalid upload token.");
    err.status = 401;
    err.code = "invalid_offsite_upload_token";
    throw err;
  }
  return row;
}

export function buildConnectorAgentRoutes() {
  const router = Router();

  // Public — no auth. Returns current connector agent script for self-install.
  router.get("/connector-agent/server.mjs", (_req, res) => {
    try {
      const src = getAgentSource();
      const meta = getAgentMeta();
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="server.mjs"');
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("ETag", `"${meta.sha256}"`);
      res.setHeader("X-Connector-Agent-Sha256", meta.sha256);
      res.setHeader("X-Connector-Agent-Has-N8n-Lifecycle", String(meta.has_n8n_lifecycle));
      return res.status(200).send(src);
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "agent_not_found", message: err.message } });
    }
  });

  router.get("/connector-agent/backup-artifacts/export/:exportId/:fileName", (req, res) => {
    try {
      const exportId = safeTokenName(req.params.exportId);
      const fileName = safeTokenName(req.params.fileName);
      const token = String(req.query.token || "");
      if (!exportId || !fileName || !token) {
        return res.status(400).json({ ok: false, error: { code: "bad_request", message: "exportId, fileName, and token are required." } });
      }
      const dir = resolve(EXPORT_ROOT, exportId);
      if (!dir.startsWith(resolve(EXPORT_ROOT))) {
        return res.status(403).json({ ok: false, error: { code: "path_not_allowed", message: "Export path is not allowed." } });
      }
      const meta = JSON.parse(readFileSync(resolve(dir, "download.json"), "utf8"));
      if (new Date(meta.expires_at).getTime() < Date.now()) {
        return res.status(410).json({ ok: false, error: { code: "download_expired", message: "Temporary backup artifact download expired." } });
      }
      if (tokenHash(token) !== meta.token_sha256) {
        return res.status(401).json({ ok: false, error: { code: "invalid_token", message: "Invalid temporary download token." } });
      }
      if (!Array.isArray(meta.files) || !meta.files.includes(fileName)) {
        return res.status(403).json({ ok: false, error: { code: "file_not_allowed", message: "File is not part of this export." } });
      }
      const filePath = resolve(dir, fileName);
      const stat = statSync(filePath);
      if (!stat.isFile()) {
        return res.status(404).json({ ok: false, error: { code: "not_found", message: "Export file not found." } });
      }
      res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      return res.sendFile(filePath);
    } catch (err) {
      const status = err?.code === "ENOENT" ? 404 : 500;
      return res.status(status).json({ ok: false, error: { code: err?.code || "backup_artifact_download_failed", message: err.message } });
    }
  });

  router.post(
    "/connector-agent/offsite-drive-upload/:sessionId/:fileName",
    raw({ type: "application/octet-stream", limit: "250mb" }),
    async (req, res) => {
      try {
        const sessionId = safeTokenName(req.params.sessionId);
        const fileName = safeName(req.params.fileName);
        const token = String(req.query.token || "");
        const subfolder = String(req.query.subfolder || "").trim();
        if (!sessionId || !fileName || !token || !UPLOAD_SUBFOLDERS.has(subfolder)) {
          return res.status(400).json({ ok: false, error: { code: "bad_request", message: "sessionId, fileName, token, and valid subfolder are required." } });
        }
        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (!body.length) {
          return res.status(400).json({ ok: false, error: { code: "empty_upload", message: "Upload body is empty." } });
        }
        const session = await validateOffsiteSession(sessionId, token);
        const { drive } = await getGoogleClientsForSpreadsheet(ACTIVATION_BOOTSTRAP_SPREADSHEET_ID);
        const rootFolderId = await getOrCreateDriveFolder(drive, session.parent_folder_id, "Growth-OS-Backups-Offsite");
        const subfolderId = await getOrCreateDriveFolder(drive, rootFolderId, subfolder);
        const digest = sha256Buffer(body);
        const upload = await drive.files.create({
          requestBody: { name: fileName, parents: [subfolderId] },
          media: { mimeType: "application/octet-stream", body: Readable.from(body) },
          fields: "id,name,size,md5Checksum,webViewLink,parents",
          supportsAllDrives: true,
        });
        await getPool().query(
          `INSERT INTO offsite_drive_upload_records
             (record_id, session_id, subfolder, file_name, drive_file_id, drive_parent_id, sha256, size_bytes, status, created_at)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, 'uploaded', NOW())`,
          [sessionId, subfolder, fileName, upload.data.id, subfolderId, digest, body.length]
        );
        await getPool().query(
          `UPDATE offsite_drive_upload_sessions SET upload_count=upload_count+1, updated_at=NOW() WHERE session_id=?`,
          [sessionId]
        );
        return res.status(200).json({
          ok: true,
          session_id: sessionId,
          subfolder,
          file_name: fileName,
          size_bytes: body.length,
          sha256: digest,
          drive_file: upload.data,
        });
      } catch (err) {
        return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "offsite_drive_upload_failed", message: err.message } });
      }
    }
  );

  router.get("/connector-agent/version", (_req, res) => {
    try {
      return res.status(200).json({ ok: true, agent: getAgentMeta() });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "agent_not_found", message: err.message } });
    }
  });

  return router;
}
