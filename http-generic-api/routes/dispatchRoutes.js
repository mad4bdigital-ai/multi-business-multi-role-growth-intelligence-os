import { Router } from "express";
import { getPool } from "../db.js";
import { provisionLocalConnectorInstall } from "./localConnectorInstallRoutes.js";

// ── Module handler registry ───────────────────────────────────────────────────
// Maps target_module (from task_routes) to an executor function.
// Each executor receives (ctx, deps) and returns { ok, ... }.

async function execLocalShell(ctx, deps) {
  const { user_id, tenant_id, device_id, payload } = ctx;
  if (!device_id) return { ok: false, error: { code: "missing_device_id" } };
  return deps.localConnectorOrchestrator.executeGovernedShellCommand({
    userId: user_id, tenantId: tenant_id, deviceId: device_id,
    alias: payload.alias, extraArgs: payload.extra_args || [],
    agentId: ctx.agent_id,
  });
}

async function execLocalFileRead(ctx, deps) {
  const { user_id, tenant_id, device_id, payload } = ctx;
  if (!device_id) return { ok: false, error: { code: "missing_device_id" } };
  return deps.localConnectorOrchestrator.readGovernedLocalFile({
    userId: user_id, tenantId: tenant_id, deviceId: device_id,
    path: payload.path, agentId: ctx.agent_id,
  });
}

async function execLocalFileWrite(ctx, deps) {
  const { user_id, tenant_id, device_id, payload } = ctx;
  if (!device_id) return { ok: false, error: { code: "missing_device_id" } };
  return deps.localConnectorOrchestrator.writeGovernedLocalFile({
    userId: user_id, tenantId: tenant_id, deviceId: device_id,
    path: payload.path, content: payload.content, agentId: ctx.agent_id,
  });
}

async function execLocalHealth(ctx, deps) {
  const { user_id, tenant_id, device_id } = ctx;
  if (!device_id) return { ok: false, error: { code: "missing_device_id" } };
  const userConfig = await deps.localConnectorOrchestrator.resolveUserLocalConfig(user_id, tenant_id, device_id);
  if (!userConfig) return { ok: false, error: { code: "config_not_found" } };
  const token = userConfig.config.connector_secret || process.env.CONNECTOR_LOCAL_API_KEY || '';
  try {
    const res = await fetch(`${userConfig.config.tunnel_url}/health`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    return { ok: true, tunnel_url: userConfig.config.tunnel_url, agent: data };
  } catch (e) {
    return { ok: false, tunnel_url: userConfig.config.tunnel_url, error: { code: "connector_unreachable", message: e.message } };
  }
}

async function execLocalFile(ctx, deps) {
  const action = ctx.payload?.action;
  if (action === "write") return execLocalFileWrite(ctx, deps);
  return execLocalFileRead(ctx, deps);
}

async function execLocalConnectorInstall(ctx, _deps) {
  const { user_id, tenant_id, payload = {} } = ctx;
  const device_id = ctx.device_id || payload.device_id;
  if (!device_id) return { ok: false, error: { code: "missing_device_id", message: "device_id required for connector install." } };

  const fakeReq = {
    auth: { is_admin: true, mode: "backend_api_key" },
    body: { user_id, tenant_id, device_id, ...payload },
  };
  const result = await provisionLocalConnectorInstall(fakeReq, fakeReq.body);
  if (!result.ok) return result;

  return {
    ...result,
    guidance: {
      message: `Local connector provisioned for device '${device_id}'. Share the steps below with the user.`,
      tunnel_url: result.tunnel_url,
      install_command: result.installation?.local_runtime?.tunnel_command,
      steps: result.installation?.steps || [],
    },
  };
}

// Map target_module → executor
const MODULE_EXECUTORS = {
  local_connector_shell:   execLocalShell,
  local_connector_health:  execLocalHealth,
  local_connector_file:    execLocalFile,
  local_connector_install: execLocalConnectorInstall,
};

// ── Skill validation (lightweight) ────────────────────────────────────────────

async function checkAgentSkill(agentId, targetModule) {
  if (!agentId) return true; // no agent context — skip (API key auth already passed)
  const moduleSkillMap = {
    local_connector_shell:   'local.connector.shell_execute',
    local_connector_health:  'local.connector.device_management',
    local_connector_file:    'local.connector.file_access',
    local_connector_install: 'local.connector.device_management',
  };
  const requiredSkillKey = moduleSkillMap[targetModule];
  if (!requiredSkillKey) return true;

  const [rows] = await getPool().query(
    `SELECT asg.grant_id FROM agent_skill_grants asg
     JOIN agent_skills ask ON ask.skill_id = asg.skill_id
     WHERE asg.agent_id = ? AND ask.skill_key = ? AND asg.status = 'active'
     LIMIT 1`,
    [agentId, requiredSkillKey]
  );
  return rows.length > 0;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export function buildDispatchRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── POST /dispatch — universal intent dispatcher ───────────────────────────
  // Routes intent_key → task_route → module executor.
  // For local connector ops: executes and returns result.
  // For unmapped modules: returns route metadata so caller can use specific endpoint.
  router.post("/dispatch", requireBackendApiKey, async (req, res) => {
    try {
      const {
        intent_key, user_id, tenant_id, device_id = null,
        payload = {}, agent_id = null,
      } = req.body || {};

      if (!intent_key || !user_id || !tenant_id) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "intent_key, user_id, tenant_id required." } });
      }

      // Resolve route
      const [[route]] = await getPool().query(
        "SELECT intent_key, workflow_key, target_module, execution_layer, route_mode FROM `task_routes` WHERE intent_key = ? AND active = '1' LIMIT 1",
        [intent_key]
      );
      if (!route) {
        return res.status(404).json({ ok: false, error: { code: "route_not_found", message: `No active route for intent_key '${intent_key}'.` } });
      }

      // Validate agent skill
      const allowed = await checkAgentSkill(agent_id, route.target_module);
      if (!allowed) {
        return res.status(403).json({ ok: false, error: { code: "skill_not_granted", message: `Agent lacks skill for module '${route.target_module}'.` } });
      }

      const ctx = { intent_key, user_id, tenant_id, device_id, payload, agent_id };
      const executor = MODULE_EXECUTORS[route.target_module];

      if (executor) {
        // Direct execution
        const result = await executor(ctx, deps);
        return res.status(result.ok ? 200 : 400).json({
          ...result,
          _meta: { intent_key, workflow_key: route.workflow_key, target_module: route.target_module, routed: true },
        });
      }

      // Module not yet wired in dispatch — return routing advice
      return res.status(200).json({
        ok: true,
        routed: false,
        intent_key,
        workflow_key: route.workflow_key,
        target_module: route.target_module,
        execution_layer: route.execution_layer,
        message: `Route resolved but '${route.target_module}' requires a direct API call. See suggested_endpoint.`,
        suggested_endpoint: buildSuggestedEndpoint(route.target_module, route.workflow_key),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "dispatch_failed", message: err.message } });
    }
  });

  // ── GET /dispatch/routes — list all active routes ─────────────────────────
  router.get("/dispatch/routes", requireBackendApiKey, async (req, res) => {
    try {
      const [routes] = await getPool().query(
        "SELECT intent_key, workflow_key, target_module, execution_layer, route_mode FROM `task_routes` WHERE active = '1' ORDER BY intent_key"
      );
      const executorKeys = Object.keys(MODULE_EXECUTORS);
      return res.status(200).json({
        ok: true,
        count: routes.length,
        routes: routes.map(r => ({
          ...r,
          directly_dispatched: executorKeys.includes(r.target_module),
        })),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "routes_read_failed", message: err.message } });
    }
  });

  return router;
}

function buildSuggestedEndpoint(targetModule, workflowKey) {
  const map = {
    local_connector_install:  "POST /local-connector/install",
    schema_import:            "POST /admin/schema-import/upload",
    agent_health_evaluator:   "GET /agents/{agent_id}",
    governance_audit_evaluator: "GET /admin/release/readiness",
  };
  return map[targetModule] || `workflow_key: ${workflowKey}`;
}
