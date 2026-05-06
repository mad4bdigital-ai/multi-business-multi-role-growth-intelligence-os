import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { writeAuditLog } from "../auditLogger.js";

export function buildAgentRegistryRoutes(deps) {
const { requireBackendApiKey } = deps;
const router = Router();
router.use(requireBackendApiKey);

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function findAgent(identifier) {
  const [rows] = await getPool().query(
    "SELECT * FROM `agents` WHERE (`agent_id` = ? OR `name` = ?) AND `status` != 'archived' LIMIT 1",
    [identifier, identifier]
  );
  return rows[0] || null;
}

async function checkEntitlement(tenant_id, agent_name) {
  const key = `agent.${agent_name}`;
  const [rows] = await getPool().query(
    "SELECT 1 FROM `entitlements` WHERE `tenant_id` = ? AND `entitlement_key` = ? AND (`expires_at` IS NULL OR `expires_at` > NOW()) LIMIT 1",
    [tenant_id, key]
  );
  return rows.length > 0;
}

async function resolveAgentForRoute(route_key) {
  const [routes] = await getPool().query(
    "SELECT `execution_layer` FROM `task_routes` WHERE `task_key` = ? LIMIT 1",
    [route_key]
  );
  if (!routes[0]) return null;
  const [agents] = await getPool().query(
    "SELECT * FROM `agents` WHERE `execution_layer` = ? AND `status` = 'active' LIMIT 1",
    [routes[0].execution_layer]
  );
  return agents[0] || null;
}

// ─── GET /agents — list all agents ───────────────────────────────────────────

router.get("/agents", async (req, res) => {
  try {
    const { execution_class, status = "active", execution_layer } = req.query;
    let sql = "SELECT * FROM `agents` WHERE `status` = ?";
    const params = [status];
    if (execution_class) { sql += " AND `execution_class` = ?"; params.push(execution_class); }
    if (execution_layer) { sql += " AND `execution_layer` = ?"; params.push(execution_layer); }
    sql += " ORDER BY `execution_class`, `name`";
    const [rows] = await getPool().query(sql, params);
    res.json({ agents: rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /agents/:id — single agent with bindings ────────────────────────────

router.get("/agents/:id", async (req, res) => {
  try {
    const agent = await findAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: "agent_not_found" });

    const [tools]     = await getPool().query("SELECT * FROM `agent_tool_bindings` WHERE `agent_id` = ?",     [agent.agent_id]);
    const [workflows] = await getPool().query("SELECT * FROM `agent_workflow_bindings` WHERE `agent_id` = ?", [agent.agent_id]);
    const [policy]    = await getPool().query("SELECT * FROM `agent_supervision_policy` WHERE `agent_id` = ? AND `tenant_id` IS NULL LIMIT 1", [agent.agent_id]);

    res.json({ agent, tools, workflows, supervision_policy: policy[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /agents/resolve/:route_key — which agent owns a task route ───────────

router.get("/agents/resolve/:route_key", async (req, res) => {
  try {
    const agent = await resolveAgentForRoute(req.params.route_key);
    if (!agent) return res.status(404).json({ error: "no_agent_for_route", route_key: req.params.route_key });
    res.json({ agent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /agents — create tenant-owned agent ────────────────────────────────

router.post("/agents", async (req, res) => {
  try {
    const { name, display_name, description, execution_class = "standard",
            execution_layer, system_prompt, max_delegation_ttl = 3600,
            min_supervision_role, tenant_id } = req.body;

    if (!name || !display_name) return res.status(400).json({ error: "name and display_name required" });

    const agent_id = `agt-${randomUUID().slice(0, 12)}`;
    await getPool().query(
      `INSERT INTO \`agents\`
         (agent_id, name, display_name, description, execution_class, execution_layer,
          system_prompt, max_delegation_ttl, min_supervision_role, is_system, status)
       VALUES (?,?,?,?,?,?,?,?,?,0,'active')`,
      [agent_id, name, display_name, description || null, execution_class,
       execution_layer || null, system_prompt || null, max_delegation_ttl,
       min_supervision_role || null]
    );

    await writeAuditLog({ actor_id: req.body.user_id || null, tenant_id: tenant_id || null,
      action: "agent.created", resource_type: "agent", resource_id: agent_id, meta: { name } });

    res.status(201).json({ agent_id, name, status: "active" });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "agent_name_exists" });
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /agents/:id/health — update health status ─────────────────────────

router.patch("/agents/:id/health", async (req, res) => {
  try {
    const { health_status } = req.body;
    if (!["active","degraded","offline"].includes(health_status))
      return res.status(400).json({ error: "invalid health_status" });

    const agent = await findAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: "agent_not_found" });
    if (agent.is_system && health_status === "offline")
      return res.status(403).json({ error: "cannot_offline_system_agent" });

    await getPool().query("UPDATE `agents` SET `health_status` = ? WHERE `agent_id` = ?",
      [health_status, agent.agent_id]);

    res.json({ agent_id: agent.agent_id, health_status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /agents/:id/delegate — create delegation contract ──────────────────

router.post("/agents/:id/delegate", async (req, res) => {
  try {
    const { user_id, tenant_id, intent_key, brand_key, plan_id } = req.body;
    if (!user_id || !tenant_id || !intent_key)
      return res.status(400).json({ error: "user_id, tenant_id, intent_key required" });

    const agent = await findAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: "agent_not_found" });
    if (agent.health_status !== "active")
      return res.status(503).json({ error: "agent_unavailable", health_status: agent.health_status });

    // Gate: entitlement check (system agents are always accessible)
    if (!agent.is_system) {
      const entitled = await checkEntitlement(tenant_id, agent.name);
      if (!entitled) return res.status(403).json({ error: "not_entitled", agent: agent.name });
    }

    // Gate: supervision policy check
    const [policy] = await getPool().query(
      "SELECT * FROM `agent_supervision_policy` WHERE `agent_id` = ? AND (`tenant_id` = ? OR `tenant_id` IS NULL) ORDER BY `tenant_id` DESC LIMIT 1",
      [agent.agent_id, tenant_id]
    );
    if (policy[0]?.min_assistance_role) {
      const [roleCheck] = await getPool().query(
        `SELECT 1 FROM \`role_assignments\` ra
           JOIN \`assistance_roles\` ar ON ar.role_key = ra.role
         WHERE ra.user_id = ? AND ra.tenant_id = ? AND ra.status = 'active'
           AND ar.tier_level >= (SELECT tier_level FROM \`assistance_roles\` WHERE role_key = ?)
         LIMIT 1`,
        [user_id, tenant_id, policy[0].min_assistance_role]
      );
      if (!roleCheck.length)
        return res.status(403).json({ error: "insufficient_supervision_role", required: policy[0].min_assistance_role });
    }

    const delegation_id = randomUUID();
    const expires_at = new Date(Date.now() + agent.max_delegation_ttl * 1000);

    await getPool().query(
      `INSERT INTO \`agent_delegations\`
         (delegation_id, user_id, tenant_id, agent_id, intent_key, brand_key, plan_id, status, expires_at)
       VALUES (?,?,?,?,?,?,?,'pending',?)`,
      [delegation_id, user_id, tenant_id, agent.agent_id, intent_key,
       brand_key || null, plan_id || null, expires_at]
    );

    await writeAuditLog({ actor_id: user_id, tenant_id, action: "agent.delegated",
      resource_type: "agent_delegation", resource_id: delegation_id,
      meta: { agent: agent.name, intent_key, execution_class: agent.execution_class } });

    res.status(201).json({
      delegation_id,
      agent_id: agent.agent_id,
      agent_name: agent.name,
      execution_class: agent.execution_class,
      expires_at,
      status: "pending",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /agent-delegations — list delegations for tenant ────────────────────

router.get("/agent-delegations", async (req, res) => {
  try {
    const { tenant_id, user_id, status, agent_id } = req.query;
    if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

    let sql = `SELECT d.*, a.name AS agent_name, a.execution_class
               FROM \`agent_delegations\` d
               JOIN \`agents\` a ON a.agent_id = d.agent_id
               WHERE d.tenant_id = ?`;
    const params = [tenant_id];
    if (user_id)  { sql += " AND d.user_id = ?";  params.push(user_id); }
    if (status)   { sql += " AND d.status = ?";   params.push(status); }
    if (agent_id) { sql += " AND d.agent_id = ?"; params.push(agent_id); }
    sql += " ORDER BY d.created_at DESC LIMIT 100";

    const [rows] = await getPool().query(sql, params);
    res.json({ delegations: rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /agent-delegations/:id — update delegation status ─────────────────

router.patch("/agent-delegations/:id", async (req, res) => {
  try {
    const { status, failure_reason } = req.body;
    const valid = ["pending","executing","completed","failed","expired"];
    if (!valid.includes(status)) return res.status(400).json({ error: "invalid status" });

    const [rows] = await getPool().query(
      "SELECT * FROM `agent_delegations` WHERE `delegation_id` = ? LIMIT 1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "delegation_not_found" });

    const completed_at = ["completed","failed","expired"].includes(status) ? new Date() : null;
    await getPool().query(
      "UPDATE `agent_delegations` SET `status` = ?, `failure_reason` = ?, `completed_at` = ? WHERE `delegation_id` = ?",
      [status, failure_reason || null, completed_at, req.params.id]
    );

    res.json({ delegation_id: req.params.id, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

return router;
}
