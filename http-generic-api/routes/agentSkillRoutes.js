import { Router }     from "express";
import { randomUUID } from "node:crypto";
import { getPool }    from "../db.js";

export function buildAgentSkillRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();
  router.use(requireBackendApiKey);

  // ── GET /agent-skills — list all skills ───────────────────────────────────
  router.get("/agent-skills", async (req, res) => {
    try {
      const { skill_type, scope, status = "active" } = req.query;
      let sql = "SELECT * FROM `agent_skills` WHERE 1=1";
      const params = [];
      if (skill_type) { sql += " AND skill_type = ?"; params.push(skill_type); }
      if (scope)      { sql += " AND scope = ?";      params.push(scope); }
      if (status)     { sql += " AND status = ?";     params.push(status); }
      sql += " ORDER BY skill_type, skill_key";
      const [rows] = await getPool().query(sql, params);
      res.json({ skills: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /agent-skills/:id — single skill ──────────────────────────────────
  router.get("/agent-skills/:id", async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT * FROM `agent_skills` WHERE skill_id = ? OR skill_key = ? LIMIT 1",
        [req.params.id, req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: "skill_not_found" });
      res.json({ skill: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /agent-skills — create a skill ───────────────────────────────────
  router.post("/agent-skills", async (req, res) => {
    try {
      const { skill_key, display_name, description, skill_type = "tool_use",
              scope = "global", capability_json, requires_approval = 0 } = req.body;
      if (!skill_key || !display_name)
        return res.status(400).json({ error: "skill_key and display_name required" });

      const skill_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`agent_skills\`
           (skill_id, skill_key, display_name, description, skill_type, scope,
            capability_json, requires_approval, status)
         VALUES (?,?,?,?,?,?,?,?,'active')`,
        [skill_id, skill_key, display_name, description || null, skill_type, scope,
         capability_json ? JSON.stringify(capability_json) : null, requires_approval ? 1 : 0]
      );
      res.status(201).json({ ok: true, skill_id, skill_key, skill_type, scope });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY")
        return res.status(409).json({ error: "skill_key already exists" });
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /agents/:id/skills — all skills granted to an agent ──────────────
  router.get("/agents/:id/skills", async (req, res) => {
    try {
      const { tenant_id, status = "active" } = req.query;
      let sql = `
        SELECT sg.grant_id, sg.skill_id, sg.tenant_id, sg.brand_key,
               sg.granted_at, sg.expires_at, sg.status AS grant_status,
               sk.skill_key, sk.display_name, sk.skill_type, sk.scope,
               sk.requires_approval, sk.capability_json
        FROM \`agent_skill_grants\` sg
        JOIN \`agent_skills\` sk ON sk.skill_id = sg.skill_id
        WHERE sg.agent_id = ? AND sg.status = ? AND sk.status = 'active'`;
      const params = [req.params.id, status];
      if (tenant_id) { sql += " AND (sg.tenant_id = ? OR sg.tenant_id IS NULL)"; params.push(tenant_id); }
      sql += " ORDER BY sk.skill_type, sk.skill_key";
      const [rows] = await getPool().query(sql, params);
      res.json({ agent_id: req.params.id, skills: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /agents/:id/skills/grant — grant a skill to an agent ────────────
  router.post("/agents/:id/skills/grant", async (req, res) => {
    try {
      const { skill_id, skill_key, tenant_id, brand_key, granted_by, expires_at } = req.body;
      if (!skill_id && !skill_key)
        return res.status(400).json({ error: "skill_id or skill_key required" });

      // Resolve skill_id from skill_key if needed
      let resolvedSkillId = skill_id;
      if (!resolvedSkillId && skill_key) {
        const [rows] = await getPool().query(
          "SELECT skill_id FROM `agent_skills` WHERE skill_key = ? LIMIT 1", [skill_key]
        );
        if (!rows[0]) return res.status(404).json({ error: "skill_not_found" });
        resolvedSkillId = rows[0].skill_id;
      }

      const grant_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`agent_skill_grants\`
           (grant_id, agent_id, skill_id, tenant_id, brand_key, granted_by, expires_at, status)
         VALUES (?,?,?,?,?,?,?,'active')
         ON DUPLICATE KEY UPDATE status = 'active', granted_at = NOW(), expires_at = VALUES(expires_at)`,
        [grant_id, req.params.id, resolvedSkillId,
         tenant_id || null, brand_key || null, granted_by || null,
         expires_at || null]
      );
      res.status(201).json({ ok: true, grant_id, agent_id: req.params.id, skill_id: resolvedSkillId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /agents/:id/skills/:skill_id — revoke a skill grant ───────────
  router.delete("/agents/:id/skills/:skill_id", async (req, res) => {
    try {
      const { tenant_id } = req.query;
      let sql = "UPDATE `agent_skill_grants` SET status = 'revoked' WHERE agent_id = ? AND skill_id = ?";
      const params = [req.params.id, req.params.skill_id];
      if (tenant_id) { sql += " AND tenant_id = ?"; params.push(tenant_id); }
      else           { sql += " AND tenant_id IS NULL"; }
      await getPool().query(sql, params);
      res.json({ ok: true, agent_id: req.params.id, skill_id: req.params.skill_id, status: "revoked" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /agents/:id/skills/check — check if agent has a specific skill ───
  // Quick gate check: { has_skill: true/false, grant: {...} | null }
  router.get("/agents/:id/skills/check", async (req, res) => {
    try {
      const { skill_key, tenant_id } = req.query;
      if (!skill_key) return res.status(400).json({ error: "skill_key required" });

      const [rows] = await getPool().query(
        `SELECT sg.grant_id, sg.tenant_id, sg.brand_key, sg.expires_at, sg.status,
                sk.skill_key, sk.display_name, sk.skill_type, sk.requires_approval
         FROM \`agent_skill_grants\` sg
         JOIN \`agent_skills\` sk ON sk.skill_id = sg.skill_id
         WHERE sg.agent_id = ?
           AND sk.skill_key = ?
           AND sg.status = 'active'
           AND sk.status = 'active'
           AND (sg.tenant_id IS NULL OR sg.tenant_id = ?)
           AND (sg.expires_at IS NULL OR sg.expires_at > NOW())
         ORDER BY sg.tenant_id DESC
         LIMIT 1`,
        [req.params.id, skill_key, tenant_id || null]
      );

      const grant = rows[0] || null;
      res.json({ agent_id: req.params.id, skill_key, has_skill: !!grant, grant });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /skill-grants — list grants (filterable) ──────────────────────────
  router.get("/skill-grants", async (req, res) => {
    try {
      const { agent_id, tenant_id, skill_type, status = "active", limit = 100 } = req.query;
      let sql = `
        SELECT sg.*, sk.skill_key, sk.display_name, sk.skill_type
        FROM \`agent_skill_grants\` sg
        JOIN \`agent_skills\` sk ON sk.skill_id = sg.skill_id
        WHERE sg.status = ?`;
      const params = [status];
      if (agent_id)   { sql += " AND sg.agent_id = ?";     params.push(agent_id); }
      if (tenant_id)  { sql += " AND (sg.tenant_id = ? OR sg.tenant_id IS NULL)"; params.push(tenant_id); }
      if (skill_type) { sql += " AND sk.skill_type = ?";   params.push(skill_type); }
      sql += " ORDER BY sg.granted_at DESC LIMIT ?";
      params.push(Number(limit));
      const [rows] = await getPool().query(sql, params);
      res.json({ grants: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
