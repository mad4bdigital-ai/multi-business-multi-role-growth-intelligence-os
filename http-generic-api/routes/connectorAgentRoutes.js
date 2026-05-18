import { Router } from "express";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getPool } from "../db.js";
import {
  verifyInstallerDownloadToken,
  buildInstallPowerShell,
  DEFAULT_WINDOWS_ALIASES,
  CONNECTOR_PORT,
} from "./localConnectorInstallRoutes.js";
import { getPool } from "../db.js";
import {
  verifyInstallerDownloadToken,
  buildInstallPowerShell,
  DEFAULT_WINDOWS_ALIASES,
  CONNECTOR_PORT,
} from "./localConnectorInstallRoutes.js";

const AGENT_VERSION = "2026.05.18.1";
const ROOT = process.cwd();

const FILES = {
  "server.mjs": {
    relativePath: "local-connector/server.mjs",
    contentType: "text/javascript; charset=utf-8",
    executable: false,
  },
  "connector-watchdog.ps1": {
    relativePath: "local-connector/connector-watchdog.ps1",
    contentType: "text/plain; charset=utf-8",
    executable: false,
  },
  "connector-safe-upgrade.ps1": {
    relativePath: "local-connector/connector-safe-upgrade.ps1",
    contentType: "text/plain; charset=utf-8",
    executable: false,
  },
};

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function publicBaseUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "auth.mad4b.com").split(",")[0].trim();
  return `${proto}://${host}`;
}

async function loadAgentFile(fileName) {
  const meta = FILES[fileName];
  if (!meta) return null;
  const fullPath = path.resolve(ROOT, meta.relativePath);
  const buffer = await readFile(fullPath);
  return { ...meta, fileName, fullPath, buffer, size: buffer.length, sha256: sha256(buffer) };
}

export function buildConnectorAgentRoutes() {
  const router = Router();

  router.get("/connector-agent/manifest.json", async (req, res) => {
    try {
      const base = publicBaseUrl(req);
      const files = {};
      for (const fileName of Object.keys(FILES)) {
        const loaded = await loadAgentFile(fileName);
        files[fileName] = {
          url: `${base}/connector-agent/files/${encodeURIComponent(fileName)}`,
          sha256: loaded.sha256,
          size: loaded.size,
          content_type: loaded.contentType,
          executable: loaded.executable,
        };
      }

      return res.status(200).json({
        ok: true,
        agent: "mad4b-local-connector",
        version: AGENT_VERSION,
        release_channel: "stable",
        minimum_watchdog_version: "2026.05.18.1",
        generated_at: new Date().toISOString(),
        files,
        upgrade_policy: {
          verify_sha256: true,
          node_check_required: true,
          backup_before_replace: true,
          health_check_required: true,
          rollback_on_failed_health: true,
        },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "connector_agent_manifest_failed", message: err.message } });
    }
  });

  router.get("/connector-agent/files/:fileName", async (req, res) => {
    try {
      const requested = String(req.params.fileName || "").trim();
      if (!FILES[requested]) {
        return res.status(404).json({ ok: false, error: { code: "connector_agent_file_not_found", message: "Unknown connector agent file." } });
      }
      const loaded = await loadAgentFile(requested);
      res.setHeader("Content-Type", loaded.contentType);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Mad4B-Agent-Version", AGENT_VERSION);
      res.setHeader("X-Mad4B-SHA256", loaded.sha256);
      return res.status(200).send(loaded.buffer);
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "connector_agent_file_failed", message: err.message } });
    }
  });

  return router;
}
