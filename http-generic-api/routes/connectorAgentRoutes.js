import { Router } from "express";
import { readFileSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import { createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_PATH = resolve(__dirname, "../../local-connector/server.mjs");

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

  router.get("/connector-agent/version", (_req, res) => {
    try {
      return res.status(200).json({ ok: true, agent: getAgentMeta() });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "agent_not_found", message: err.message } });
    }
  });

  return router;
}
