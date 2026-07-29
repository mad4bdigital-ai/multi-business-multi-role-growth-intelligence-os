import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import {
  decidePlatformAgentSkillGrantRequest,
  requestAgentSkillGrant,
} from "../agentSkillGrantRequestService.js";

function boundedLimit(value, fallback = 100, max = 500) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function actorFromRequest(req) {
  return {
    user_id: req.auth?.user_id || null,
    actor_id: req.auth?.actor_id || req.auth?.subject_id || null,
    requested_by: req.body?.requested_by || req.body?.granted_by || null,
  };
}

function sendRouteError(res, error) {
  const status = Number(error?.status || 500);
  return res.status(status).json({
    ok: false,
    error: {
      code: error?.code || "AGENT_SKILL_REQUEST_FAILED",
      message: error?.message || "Agent skill request failed.",
      details: error?.details || null,
    },
    secrets_included: false,
  });
}

export function buildAgentSkillRoutes(deps) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  router.use(requireBackendApiKey);

  router.get("/agent-skills", async (req, res) => {
    try {
      const { skill_type, scope, status = "active" } = req.query;
      let sql = "SELECT * FROM `agent_skills` WHERE 1=1";
      const params = [];
      if (skill_type) { sql += " AND skill_type = ?"; params.push(skill_type); }
      if (scope) { sql += " AND scope = ?"; params.push(scope); }
      if (status) { sql += " AND status = ?"; params.push(status); }
      sql += " ORDER BY skill_type, skill_key";
      const [rows] = await getPool().query(sql, params);
      res.json({ skills: rows, total: rows.length, secrets_included: false });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.get("/agent-skills/:id", async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT * FROM `agent_skills` WHERE skill_id = ? OR skill_key = ? LIMIT 1",
        [req.params.id, req.params.id]
      );
      if (!rows[0]) {
        return res.status(404).json({ ok: false, error: { code: "AGENT_SKILL_NOT_FOUND", message: "Agent skill was not found." }, secrets_included: false });
      }
      res.json({ skill: rows[0], secrets_included: false });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.post("/agent-skills", async (req, res) => {
    try {
      const {
        skill_key,
        display_name,
        description,
        skill_type = "tool_use",
        scope = "global",
        capability_json,
        requires_approval = 0,
      } = req.body || {};
      if (!skill_key || !display_name) {
        return res.status(400).json({ ok: false, error: { code: "AGENT_SKILL_FIELDS_REQUIRED", message: "skill_key and display_name are required." }, secrets_included: false });
      }
      const skill_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`agent_skills\`
           (skill_id, skill_key, display_name, description, skill_type, scope,
            capability_json, requires_approval, status)
         VALUES (?,?,?,?,?,?,?,?,'active')`,
        [skill_id, skill_key, display_name, description || null, skill_type, scope,
         capability_json ? JSON.stringify(capability_json) : null, requires_approval ? 1 : 0]
      );
      res.status(201).json({ ok: true, skill_id, skill_key, skill_type, scope, secrets_included: false });
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ ok: false, error: { code: "AGENT_SKILL_KEY_CONFLICT", message: "skill_key already exists." }, secrets_included: false });
      }
      sendRouteError(res, error);
    }
  });

  router.get("/agents/:id/skills", async (req, res) => {
    try {
      const { tenant_id, status = "active" } = req.query;
      const activeOnly = status === "active";
      const grantSource = activeOnly ? "v_effective_agent_skill_grants" : "agent_skill_grants";
      let sql = `
        SELECT sg.grant_id, sg.skill_id, sg.tenant_id, sg.brand_key,
               sg.granted_at, sg.expires_at, sg.status AS grant_status,
               sg.grant_request_id,
               sk.skill_key, sk.display_name, sk.skill_type, sk.scope,
               sk.requires_approval, sk.capability_json
          FROM ${grantSource} sg
          JOIN agent_skills sk ON sk.skill_id = sg.skill_id
         WHERE sg.agent_id = ?`;
      const params = [req.params.id];
      if (!activeOnly) { sql += " AND sg.status = ?"; params.push(status); }
      if (tenant_id) { sql += " AND (sg.tenant_id = ? OR sg.tenant_id IS NULL)"; params.push(tenant_id); }
      sql += " ORDER BY sk.skill_type, sk.skill_key";
      const [rows] = await getPool().query(sql, params);
      res.json({ agent_id: req.params.id, skills: rows, total: rows.length, effective_only: activeOnly, secrets_included: false });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.post("/agents/:id/skills/grant", async (req, res) => {
    try {
      const result = await requestAgentSkillGrant({
        agentId: req.params.id,
        input: req.body || {},
        actor: actorFromRequest(req),
      });
      return res.status(result.http_status).json(result);
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get("/agent-skill-grant-requests", requireAdminPrincipal, async (req, res) => {
    try {
      const { request_status = "pending", tenant_id, agent_id, skill_id, limit = 100 } = req.query;
      let sql = `
        SELECT r.*, s.skill_key, s.display_name AS skill_display_name,
               a.name AS agent_name, a.display_name AS agent_display_name,
               CASE WHEN e.grant_id IS NULL THEN 0 ELSE 1 END AS runtime_effective
          FROM agent_skill_grant_requests r
          JOIN agent_skills s ON s.skill_id = r.skill_id
          LEFT JOIN agents a ON a.agent_id = r.agent_id
          LEFT JOIN agent_skill_grants g ON g.grant_request_id = r.request_id
          LEFT JOIN v_effective_agent_skill_grants e ON e.grant_id = g.grant_id
         WHERE r.request_status = ?`;
      const params = [request_status];
      if (tenant_id) { sql += " AND r.tenant_id = ?"; params.push(tenant_id); }
      if (agent_id) { sql += " AND r.agent_id = ?"; params.push(agent_id); }
      if (skill_id) { sql += " AND r.skill_id = ?"; params.push(skill_id); }
      sql += " ORDER BY r.requested_at DESC LIMIT ?";
      params.push(boundedLimit(limit));
      const [rows] = await getPool().query(sql, params);
      res.json({ ok: true, requests: rows, total: rows.length, secrets_included: false });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.post("/agent-skill-grant-requests/:request_id/decision", requireAdminPrincipal, async (req, res) => {
    try {
      const result = await decidePlatformAgentSkillGrantRequest({
        requestId: req.params.request_id,
        input: req.body || {},
        actor: actorFromRequest(req),
      });
      res.json(result);
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.delete("/agents/:id/skills/:skill_id", async (req, res) => {
    try {
      const { tenant_id, brand_key } = req.query;
      let sql = "UPDATE agent_skill_grants SET status = 'revoked', expires_at = NULL WHERE agent_id = ? AND skill_id = ?";
      const params = [req.params.id, req.params.skill_id];
      if (tenant_id) { sql += " AND tenant_id = ?"; params.push(tenant_id); }
      else { sql += " AND tenant_id IS NULL"; }
      if (brand_key) { sql += " AND brand_key = ?"; params.push(brand_key); }
      const [result] = await getPool().query(sql, params);
      res.json({ ok: true, agent_id: req.params.id, skill_id: req.params.skill_id, status: "revoked", affected_rows: Number(result.affectedRows || 0), secrets_included: false });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.get("/agents/:id/skills/check", async (req, res) => {
    try {
      const { skill_key, tenant_id, brand_key } = req.query;
      if (!skill_key) {
        return res.status(400).json({ ok: false, error: { code: "AGENT_SKILL_KEY_REQUIRED", message: "skill_key is required." }, secrets_included: false });
      }
      const [rows] = await getPool().query(
        `SELECT sg.grant_id, sg.tenant_id, sg.brand_key, sg.expires_at, sg.status,
                sg.grant_request_id, sg.request_status, sg.approval_policy_key,
                sk.skill_key, sk.display_name, sk.skill_type, sk.requires_approval
           FROM v_effective_agent_skill_grants sg
           JOIN agent_skills sk ON sk.skill_id = sg.skill_id
          WHERE sg.agent_id = ?
            AND sk.skill_key = ?
            AND (sg.tenant_id IS NULL OR sg.tenant_id = ?)
            AND (sg.brand_key IS NULL OR sg.brand_key = ?)
          ORDER BY sg.tenant_id DESC, sg.brand_key DESC
          LIMIT 1`,
        [req.params.id, skill_key, tenant_id || null, brand_key || null]
      );
      const grant = rows[0] || null;
      res.json({ agent_id: req.params.id, skill_key, has_skill: Boolean(grant), grant, secrets_included: false });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.get("/skill-grants", async (req, res) => {
    try {
      const { agent_id, tenant_id, skill_type, status = "active", limit = 100 } = req.query;
      const activeOnly = status === "active";
      const grantSource = activeOnly ? "v_effective_agent_skill_grants" : "agent_skill_grants";
      let sql = `
        SELECT sg.*, sk.skill_key, sk.display_name, sk.skill_type
          FROM ${grantSource} sg
          JOIN agent_skills sk ON sk.skill_id = sg.skill_id
         WHERE 1=1`;
      const params = [];
      if (!activeOnly) { sql += " AND sg.status = ?"; params.push(status); }
      if (agent_id) { sql += " AND sg.agent_id = ?"; params.push(agent_id); }
      if (tenant_id) { sql += " AND (sg.tenant_id = ? OR sg.tenant_id IS NULL)"; params.push(tenant_id); }
      if (skill_type) { sql += " AND sk.skill_type = ?"; params.push(skill_type); }
      sql += " ORDER BY sg.granted_at DESC LIMIT ?";
      params.push(boundedLimit(limit));
      const [rows] = await getPool().query(sql, params);
      res.json({ grants: rows, total: rows.length, effective_only: activeOnly, secrets_included: false });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  return router;
}
