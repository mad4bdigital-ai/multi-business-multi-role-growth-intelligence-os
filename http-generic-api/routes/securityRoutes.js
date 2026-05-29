import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { writeAuditLog, writeAuditLogAsync } from "../auditLogger.js";
import { writeAuditPayloadEvidence } from "../auditPayloadEvidence.js";

export function buildSecurityRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── GET /audit-log ────────────────────────────────────────────────────────
  router.get("/audit-log", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, actor_id, action, from, to, limit = 100 } = req.query;
      const conditions = [];
      const params = [];
      if (tenant_id) { conditions.push("tenant_id = ?"); params.push(tenant_id); }
      if (actor_id)  { conditions.push("actor_id = ?"); params.push(actor_id); }
      if (action)    { conditions.push("action LIKE ?"); params.push(`%${action}%`); }
      if (from)      { conditions.push("occurred_at >= ?"); params.push(from); }
      if (to)        { conditions.push("occurred_at <= ?"); params.push(to); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const cap = Math.min(Number(limit) || 100, 500);
      const [rows] = await getPool().query(
        `SELECT audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id,
                service_mode, ip_address, occurred_at
         FROM \`audit_log\` ${where} ORDER BY occurred_at DESC LIMIT ${cap}`,
        params
      );
      return res.status(200).json({ ok: true, entries: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "audit_read_failed", message: err.message } });
    }
  });

  // ── POST /secret-references ───────────────────────────────────────────────
  router.post("/secret-references", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, secret_key, store_type = "env", env_var_name, vault_path, description, expires_at } = req.body || {};
      if (!tenant_id || !secret_key) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id and secret_key are required." } });
      }
      const ref_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`secret_references\` (ref_id, tenant_id, secret_key, store_type, env_var_name, vault_path, description, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE store_type = VALUES(store_type), env_var_name = VALUES(env_var_name),
           vault_path = VALUES(vault_path), description = VALUES(description), expires_at = VALUES(expires_at)`,
        [ref_id, tenant_id, secret_key, store_type, env_var_name || null, vault_path || null, description || null, expires_at || null]
      );
      writeAuditLogAsync({ tenant_id, action: "secret_reference.upsert", resource_type: "secret_reference", resource_id: secret_key });
      return res.status(201).json({ ok: true, ref_id, tenant_id, secret_key, store_type });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "secret_ref_create_failed", message: err.message } });
    }
  });

  // ── GET /tenants/:id/secret-references ────────────────────────────────────
  router.get("/tenants/:id/secret-references", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        `SELECT ref_id, secret_key, store_type, env_var_name, description, rotated_at, expires_at, created_at
         FROM \`secret_references\` WHERE tenant_id = ? ORDER BY secret_key`,
        [req.params.id]
      );
      return res.status(200).json({ ok: true, secrets: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "secrets_list_failed", message: err.message } });
    }
  });

  // ── POST /incidents ───────────────────────────────────────────────────────
  router.post("/incidents", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, title, severity = "medium", category = "other", description, assigned_to } = req.body || {};
      if (!title) return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "title is required." } });
      const incident_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`incidents\` (incident_id, tenant_id, title, severity, category, description, assigned_to)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [incident_id, tenant_id || null, title, severity, category, description || null, assigned_to || null]
      );
      writeAuditLogAsync({ tenant_id, action: "incident.created", resource_type: "incident", resource_id: incident_id,
        after_json: { title, severity, category } });
      return res.status(201).json({ ok: true, incident_id, severity, category, status: "open" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "incident_create_failed", message: err.message } });
    }
  });

  // ── PUT /incidents/:id ────────────────────────────────────────────────────
  router.put("/incidents/:id", requireBackendApiKey, async (req, res) => {
    try {
      const { title, severity, category, description, assigned_to, status } = req.body || {};
      if (!title) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "title is required." } });
      }
      await getPool().query(
        `UPDATE \`incidents\`
         SET title=?, severity=COALESCE(?,severity), category=COALESCE(?,category),
             description=COALESCE(?,description), assigned_to=COALESCE(?,assigned_to), status=COALESCE(?,status)
         WHERE incident_id=?`,
        [title, severity || null, category || null, description || null, assigned_to || null, status || null, req.params.id]
      );
      writeAuditLogAsync({ action: "incident.updated", resource_type: "incident", resource_id: req.params.id,
        after_json: { title, severity, category, status } });
      return res.status(200).json({ ok: true, incident_id: req.params.id, title });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "incident_update_failed", message: err.message } });
    }
  });

  // ── PATCH /incidents/:id/status ───────────────────────────────────────────
  router.patch("/incidents/:id/status", requireBackendApiKey, async (req, res) => {
    try {
      const { status, assigned_to } = req.body || {};
      const VALID = ["open","investigating","contained","resolved","closed"];
      if (!VALID.includes(status)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_status", message: `status must be one of: ${VALID.join(", ")}` } });
      }
      const sets = ["status = ?"];
      const vals = [status];
      if (assigned_to !== undefined) { sets.push("assigned_to = ?"); vals.push(assigned_to || null); }
      if (["resolved","closed"].includes(status)) { sets.push("resolved_at = NOW()"); }
      vals.push(req.params.id);
      await getPool().query(`UPDATE \`incidents\` SET ${sets.join(", ")} WHERE incident_id = ?`, vals);
      writeAuditLogAsync({ action: "incident.status_updated", resource_type: "incident", resource_id: req.params.id, after_json: { status } });
      return res.status(200).json({ ok: true, incident_id: req.params.id, status });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "incident_update_failed", message: err.message } });
    }
  });

  // ── DELETE /incidents/:id ─────────────────────────────────────────────────
  router.delete("/incidents/:id", requireBackendApiKey, async (req, res) => {
    try {
      await getPool().query(
        "UPDATE `incidents` SET status = 'closed', resolved_at = NOW() WHERE incident_id = ?",
        [req.params.id]
      );
      writeAuditLogAsync({ action: "incident.closed", resource_type: "incident", resource_id: req.params.id, after_json: { status: "closed" } });
      return res.status(200).json({ ok: true, incident_id: req.params.id, status: "closed" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "incident_delete_failed", message: err.message } });
    }
  });

  // ── GET /incidents ────────────────────────────────────────────────────────
  router.get("/incidents", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, severity, status, category } = req.query;
      const conditions = [];
      const params = [];
      if (tenant_id) { conditions.push("tenant_id = ?"); params.push(tenant_id); }
      if (severity)  { conditions.push("severity = ?"); params.push(severity); }
      if (status)    { conditions.push("status = ?"); params.push(status); }
      if (category)  { conditions.push("category = ?"); params.push(category); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const [rows] = await getPool().query(
        `SELECT incident_id, tenant_id, title, severity, category, status, assigned_to, created_at, resolved_at
         FROM \`incidents\` ${where} ORDER BY created_at DESC LIMIT 200`,
        params
      );
      return res.status(200).json({ ok: true, incidents: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "incidents_list_failed", message: err.message } });
    }
  });

  return router;
}
