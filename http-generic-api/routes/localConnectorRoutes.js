import { Router } from "express";
import { getPool } from "../db.js";

function suppliedIdentity(req = {}) {
  return {
    user_id: req.query?.user_id || req.body?.user_id || null,
    tenant_id: req.query?.tenant_id || req.body?.tenant_id || null,
  };
}

function resolveLocalConnectorIdentity(req = {}) {
  const isTenantScoped = req.auth?.mode === "user_jwt" || req.auth?.mode === "api_credential";
  if (isTenantScoped) {
    const supplied = suppliedIdentity(req);
    const authenticatedIdentity = {
      user_id: req.auth?.user_id || null,
      tenant_id: req.auth?.tenant_id || null,
    };
    const identityConflict = Boolean(
      (supplied.user_id && String(supplied.user_id) !== String(authenticatedIdentity.user_id || "")) ||
      (supplied.tenant_id && String(supplied.tenant_id) !== String(authenticatedIdentity.tenant_id || ""))
    );
    return {
      ...authenticatedIdentity,
      auth_derived: true,
      identity_conflict: identityConflict,
    };
  }
  const supplied = suppliedIdentity(req);
  return {
    user_id: supplied.user_id,
    tenant_id: supplied.tenant_id,
    auth_derived: false,
    identity_conflict: false,
  };
}

function rejectIdentityConflict(res, identity) {
  if (!identity?.identity_conflict) return false;
  res.status(403).json({
    ok: false,
    error: {
      code: "auth_identity_mismatch",
      message: "Tenant-scoped Local Connector identity must match the authenticated principal.",
    },
    secrets_included: false,
  });
  return true;
}

export function buildLocalConnectorRoutes(deps) {
  const { requireBackendApiKey, localConnectorOrchestrator } = deps;
  const router = Router();

  router.post("/local-connector/shell", requireBackendApiKey, async (req, res) => {
    try {
      const identity = resolveLocalConnectorIdentity(req);
      if (rejectIdentityConflict(res, identity)) return;
      const { user_id, tenant_id } = identity;
      const { device_id, alias, extra_args = [], agent_id = null } = req.body || {};
      if (!user_id || !tenant_id || !device_id || !alias) {
        return res.status(400).json({
          ok: false,
          error: {
            code: "missing_fields",
            message: identity.auth_derived
              ? "device_id and alias are required and the authenticated principal must include tenant context."
              : "user_id, tenant_id, device_id, and alias are required for admin/service calls.",
          },
        });
      }
      const result = await localConnectorOrchestrator.executeGovernedShellCommand({
        userId: user_id,
        tenantId: tenant_id,
        deviceId: device_id,
        alias,
        extraArgs: extra_args,
        agentId: agent_id,
      });
      return res.status(result.ok ? 200 : 400).json({ ...result, auth_derived: identity.auth_derived });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "shell_failed", message: err.message } });
    }
  });

  router.post("/local-connector/file/read", requireBackendApiKey, async (req, res) => {
    try {
      const identity = resolveLocalConnectorIdentity(req);
      if (rejectIdentityConflict(res, identity)) return;
      const { user_id, tenant_id } = identity;
      const { device_id, path, agent_id = null } = req.body || {};
      if (!user_id || !tenant_id || !device_id || !path) {
        return res.status(400).json({
          ok: false,
          error: {
            code: "missing_fields",
            message: identity.auth_derived
              ? "device_id and path are required and the authenticated principal must include tenant context."
              : "user_id, tenant_id, device_id, and path are required for admin/service calls.",
          },
        });
      }
      const result = await localConnectorOrchestrator.readGovernedLocalFile({
        userId: user_id,
        tenantId: tenant_id,
        deviceId: device_id,
        path,
        agentId: agent_id,
      });
      return res.status(result.ok ? 200 : 400).json({ ...result, auth_derived: identity.auth_derived });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "file_read_failed", message: err.message } });
    }
  });

  router.post("/local-connector/file/write", requireBackendApiKey, async (req, res) => {
    try {
      const identity = resolveLocalConnectorIdentity(req);
      if (rejectIdentityConflict(res, identity)) return;
      const { user_id, tenant_id } = identity;
      const { device_id, path, content, agent_id = null } = req.body || {};
      if (!user_id || !tenant_id || !device_id || !path || content === undefined) {
        return res.status(400).json({
          ok: false,
          error: {
            code: "missing_fields",
            message: identity.auth_derived
              ? "device_id, path, and content are required and the authenticated principal must include tenant context."
              : "user_id, tenant_id, device_id, path, and content are required for admin/service calls.",
          },
        });
      }
      const result = await localConnectorOrchestrator.writeGovernedLocalFile({
        userId: user_id,
        tenantId: tenant_id,
        deviceId: device_id,
        path,
        content,
        agentId: agent_id,
      });
      return res.status(result.ok ? 200 : 400).json({ ...result, auth_derived: identity.auth_derived });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "file_write_failed", message: err.message } });
    }
  });

  router.get("/local-connector/devices", requireBackendApiKey, async (req, res) => {
    try {
      const identity = resolveLocalConnectorIdentity(req);
      if (rejectIdentityConflict(res, identity)) return;
      const { user_id, tenant_id, auth_derived } = identity;
      if (!user_id || !tenant_id) {
        return res.status(400).json({
          ok: false,
          error: {
            code: "missing_fields",
            message: auth_derived
              ? "Signed-in user is missing tenant context."
              : "user_id and tenant_id are required for admin/service calls.",
          },
        });
      }
      const [rows] = await getPool().query(
        `SELECT config_id, device_id, tunnel_url, cf_tunnel_id, cf_tunnel_name, is_enabled, created_at, updated_at
         FROM \`local_connector_user_configs\`
         WHERE user_id = ? AND tenant_id = ?
         ORDER BY created_at DESC`,
        [user_id, tenant_id]
      );
      return res.status(200).json({ ok: true, devices: rows, count: rows.length, auth_derived });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "devices_read_failed", message: err.message } });
    }
  });

  router.get("/local-connector/health", requireBackendApiKey, async (req, res) => {
    try {
      const identity = resolveLocalConnectorIdentity(req);
      if (rejectIdentityConflict(res, identity)) return;
      const { user_id, tenant_id, auth_derived } = identity;
      const { device_id } = req.query;
      if (!user_id || !tenant_id || !device_id) {
        return res.status(400).json({
          ok: false,
          error: {
            code: "missing_fields",
            message: auth_derived
              ? "device_id is required and the signed-in user must have tenant context."
              : "user_id, tenant_id, and device_id are required for admin/service calls.",
          },
        });
      }
      const userConfig = await localConnectorOrchestrator.resolveUserLocalConfig(user_id, tenant_id, device_id);
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
        return res.status(200).json({ ok: true, tunnel_url: tunnelUrl, agent: data, auth_derived });
      } catch (e) {
        return res.status(200).json({ ok: false, tunnel_url: tunnelUrl, error: { code: "connector_unreachable", message: e.message } });
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "health_check_failed", message: err.message } });
    }
  });

  return router;
}

export const _testingLocalConnectorRoutes = Object.freeze({
  suppliedIdentity,
  resolveLocalConnectorIdentity,
});
