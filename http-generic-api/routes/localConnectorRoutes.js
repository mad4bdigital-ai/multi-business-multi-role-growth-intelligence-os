import { Router } from "express";
import { getPool } from "../db.js";

export function buildLocalConnectorRoutes(deps) {
  const { requireBackendApiKey, localConnectorOrchestrator } = deps;
  const router = Router();

  router.post("/local-connector/shell", requireBackendApiKey, async (req, res) => {
    try {
      const { user_id, tenant_id, device_id, alias, extra_args = [], agent_id = null } = req.body || {};
      if (!user_id || !tenant_id || !device_id || !alias) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "user_id, tenant_id, device_id, alias required." } });
      }
      const result = await localConnectorOrchestrator.executeGovernedShellCommand({
        userId: user_id, tenantId: tenant_id, deviceId: device_id, alias, extraArgs: extra_args, agentId: agent_id,
      });
      return res.status(result.ok ? 200 : 400).json(result);
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "shell_failed", message: err.message } });
    }
  });

  router.post("/local-connector/file/read", requireBackendApiKey, async (req, res) => {
    try {
      const { user_id, tenant_id, device_id, path, agent_id = null } = req.body || {};
      if (!user_id || !tenant_id || !device_id || !path) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "user_id, tenant_id, device_id, path required." } });
      }
      const result = await localConnectorOrchestrator.readGovernedLocalFile({
        userId: user_id, tenantId: tenant_id, deviceId: device_id, path, agentId: agent_id,
      });
      return res.status(result.ok ? 200 : 400).json(result);
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "file_read_failed", message: err.message } });
    }
  });

  router.post("/local-connector/file/write", requireBackendApiKey, async (req, res) => {
    try {
      const { user_id, tenant_id, device_id, path, content, agent_id = null } = req.body || {};
      if (!user_id || !tenant_id || !device_id || !path || content === undefined) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "user_id, tenant_id, device_id, path, content required." } });
      }
      const result = await localConnectorOrchestrator.writeGovernedLocalFile({
        userId: user_id, tenantId: tenant_id, deviceId: device_id, path, content, agentId: agent_id,
      });
      return res.status(result.ok ? 200 : 400).json(result);
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "file_write_failed", message: err.message } });
    }
  });

  router.get("/local-connector/devices", requireBackendApiKey, async (req, res) => {
    try {
      const { user_id, tenant_id } = req.query;
      if (!user_id || !tenant_id) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "user_id, tenant_id required." } });
      }
      const [rows] = await getPool().query(
        `SELECT config_id, device_id, tunnel_url, cf_tunnel_id, cf_tunnel_name, is_enabled, created_at, updated_at
         FROM \`local_connector_user_configs\`
         WHERE user_id = ? AND tenant_id = ?
         ORDER BY created_at DESC`,
        [user_id, tenant_id]
      );
      return res.status(200).json({ ok: true, devices: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "devices_read_failed", message: err.message } });
    }
  });

  router.get("/local-connector/health", requireBackendApiKey, async (req, res) => {
    try {
      const isUserAuth = req.auth?.mode === "user_jwt" || req.auth?.mode === "api_credential";
      const resolved_user_id = req.query.user_id || (isUserAuth ? req.auth?.user_id : null);
      const resolved_tenant_id = req.query.tenant_id || (isUserAuth ? req.auth?.tenant_id : null);
      const { device_id } = req.query;
      if (!resolved_user_id || !resolved_tenant_id || !device_id) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "device_id is required." } });
      }
      const userConfig = await localConnectorOrchestrator.resolveUserLocalConfig(resolved_user_id, resolved_tenant_id, device_id);
      if (!userConfig) {
        return res.status(404).json({ ok: false, error: { code: "config_not_found", message: "No local connector config for this user/device." } });
      }
      const token = userConfig.config.connector_secret || process.env.CONNECTOR_LOCAL_API_KEY || '';
      const tunnelUrl = userConfig.config.tunnel_url;
      try {
        const response = await fetch(`${tunnelUrl}/health`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        const data = await response.json();
        return res.status(200).json({ ok: true, tunnel_url: tunnelUrl, agent: data });
      } catch (e) {
        return res.status(200).json({ ok: false, tunnel_url: tunnelUrl, error: { code: "connector_unreachable", message: e.message } });
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "health_check_failed", message: err.message } });
    }
  });

  return router;
}
