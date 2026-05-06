import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

export function buildIdentityRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── POST /users ────────────────────────────────────────────────────────────
  router.post("/users", requireBackendApiKey, async (req, res) => {
    try {
      const { email, display_name, status = "active" } = req.body || {};
      if (!email || !display_name) {
        return res.status(400).json({
          ok: false,
          error: { code: "missing_fields", message: "email and display_name are required." }
        });
      }

      const user_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`users\` (user_id, email, display_name, status) VALUES (?, ?, ?, ?)`,
        [user_id, email, display_name, status]
      );

      return res.status(201).json({ ok: true, user_id, email, display_name, status });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          ok: false,
          error: { code: "user_already_exists", message: "A user with this email already exists." }
        });
      }
      return res.status(500).json({
        ok: false,
        error: { code: "user_create_failed", message: err.message || "Failed to create user." }
      });
    }
  });
  // ── GET /users ─────────────────────────────────────────────────────────────
  router.get("/users", requireBackendApiKey, async (req, res) => {
    try {
      const { status, email, limit = 100 } = req.query;
      const conditions = [];
      const params = [];
      if (status) { conditions.push("status = ?"); params.push(status); }
      if (email) { conditions.push("email = ?"); params.push(email); }
      
      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const [rows] = await getPool().query(
        `SELECT user_id, email, display_name, status, created_at, updated_at
         FROM \`users\` ${whereClause} ORDER BY created_at DESC LIMIT ?`,
        [...params, parseInt(limit, 10) || 100]
      );
      return res.status(200).json({ ok: true, items: rows, users: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: { code: "users_list_failed", message: err.message || "Failed to list users." }
      });
    }
  });


  // ── GET /users/:id ─────────────────────────────────────────────────────────
  router.get("/users/:id", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        `SELECT user_id, email, display_name, status, created_at, updated_at
         FROM \`users\` WHERE user_id = ? LIMIT 1`,
        [req.params.id]
      );
      if (!rows.length) {
        return res.status(404).json({
          ok: false,
          error: { code: "user_not_found", message: `User ${req.params.id} not found.` }
        });
      }
      return res.status(200).json({ ok: true, user: rows[0] });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: { code: "user_read_failed", message: err.message || "Failed to read user." }
      });
    }
  });

  // ── POST /users/:id/role-assignments ───────────────────────────────────────
  router.post("/users/:id/role-assignments", requireBackendApiKey, async (req, res) => {
    try {
      const user_id = req.params.id;
      const { tenant_id, role, granted_by, expires_at } = req.body || {};

      if (!tenant_id || !role) {
        return res.status(400).json({
          ok: false,
          error: { code: "missing_fields", message: "tenant_id and role are required." }
        });
      }

      const assignment_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`role_assignments\` (assignment_id, user_id, tenant_id, role, granted_by, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [assignment_id, user_id, tenant_id, role, granted_by || null, expires_at || null]
      );

      return res.status(201).json({ ok: true, assignment_id, user_id, tenant_id, role });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: { code: "role_assignment_failed", message: err.message || "Failed to assign role." }
      });
    }
  });

  // ── PUT /users/:id ────────────────────────────────────────────────────────
  router.put("/users/:id", requireBackendApiKey, async (req, res) => {
    try {
      const { email, display_name, status } = req.body || {};
      if (!email || !display_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "email and display_name are required." } });
      }
      await getPool().query(
        `UPDATE \`users\` SET email=?, display_name=?, status=COALESCE(?,status) WHERE user_id=?`,
        [email, display_name, status || null, req.params.id]
      );
      return res.status(200).json({ ok: true, user_id: req.params.id, email, display_name });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ ok: false, error: { code: "email_conflict", message: "Email already in use." } });
      return res.status(500).json({ ok: false, error: { code: "user_update_failed", message: err.message } });
    }
  });

  // ── DELETE /users/:id ─────────────────────────────────────────────────────
  router.delete("/users/:id", requireBackendApiKey, async (req, res) => {
    try {
      await getPool().query("UPDATE `users` SET status = 'archived' WHERE user_id = ?", [req.params.id]);
      return res.status(200).json({ ok: true, user_id: req.params.id, status: "archived" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "user_delete_failed", message: err.message } });
    }
  });

  // ── DELETE /entitlements/:id ──────────────────────────────────────────────
  router.delete("/entitlements/:id", requireBackendApiKey, async (req, res) => {
    try {
      await getPool().query("DELETE FROM `entitlements` WHERE entitlement_id = ?", [req.params.id]);
      return res.status(200).json({ ok: true, entitlement_id: req.params.id, deleted: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "entitlement_delete_failed", message: err.message } });
    }
  });

  // ── GET /plans ─────────────────────────────────────────────────────────────
  router.get("/plans", requireBackendApiKey, async (_req, res) => {
    try {
      const [rows] = await getPool().query(
        `SELECT plan_id, plan_key, display_name, service_mode, price_monthly_usd, features_json, limits_json, active
         FROM \`plans\` WHERE active = 1 ORDER BY price_monthly_usd ASC`
      );

      const plans = rows.map((p) => ({
        ...p,
        features_json: safeParseJson(p.features_json),
        limits_json: safeParseJson(p.limits_json),
      }));

      return res.status(200).json({ ok: true, plans, count: plans.length });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: { code: "plans_read_failed", message: err.message || "Failed to read plans." }
      });
    }
  });

  // ── POST /subscriptions ────────────────────────────────────────────────────
  router.post("/subscriptions", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, plan_key, expires_at } = req.body || {};
      if (!tenant_id || !plan_key) {
        return res.status(400).json({
          ok: false,
          error: { code: "missing_fields", message: "tenant_id and plan_key are required." }
        });
      }

      const [planRows] = await getPool().query(
        "SELECT plan_id FROM `plans` WHERE plan_key = ? AND active = 1 LIMIT 1",
        [plan_key]
      );
      if (!planRows.length) {
        return res.status(404).json({
          ok: false,
          error: { code: "plan_not_found", message: `Plan '${plan_key}' not found or inactive.` }
        });
      }

      const subscription_id = randomUUID();
      const plan_id = planRows[0].plan_id;

      await getPool().query(
        `INSERT INTO \`subscriptions\` (subscription_id, tenant_id, plan_id, expires_at)
         VALUES (?, ?, ?, ?)`,
        [subscription_id, tenant_id, plan_id, expires_at || null]
      );

      return res.status(201).json({ ok: true, subscription_id, tenant_id, plan_id, plan_key });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: { code: "subscription_create_failed", message: err.message || "Failed to create subscription." }
      });
    }
  });

  // ── GET /tenants/:id/subscriptions ────────────────────────────────────────
  router.get("/tenants/:id/subscriptions", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        `SELECT s.subscription_id, s.status, s.started_at, s.expires_at,
                p.plan_key, p.display_name, p.service_mode, p.price_monthly_usd
         FROM \`subscriptions\` s
         JOIN \`plans\` p ON p.plan_id = s.plan_id
         WHERE s.tenant_id = ?
         ORDER BY s.started_at DESC`,
        [req.params.id]
      );
      return res.status(200).json({ ok: true, tenant_id: req.params.id, subscriptions: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: { code: "subscriptions_read_failed", message: err.message || "Failed to read subscriptions." }
      });
    }
  });

  // ── GET /assistance-roles ─────────────────────────────────────────────────
  router.get("/assistance-roles", requireBackendApiKey, async (_req, res) => {
    try {
      const [rows] = await getPool().query(
        `SELECT role_id, role_key, display_name, level, capabilities_json
         FROM \`assistance_roles\` WHERE active = 1 ORDER BY level ASC`
      );
      const roles = rows.map((r) => ({ ...r, capabilities_json: safeParseJson(r.capabilities_json) }));
      return res.status(200).json({ ok: true, roles, count: roles.length });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: { code: "assistance_roles_read_failed", message: err.message || "Failed to read assistance roles." }
      });
    }
  });

  // ── POST /entitlements ────────────────────────────────────────────────────
  router.post("/entitlements", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, entitlement_key, entitlement_value, source = "manual", granted_at, expires_at } = req.body || {};
      if (!tenant_id || !entitlement_key) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id and entitlement_key are required." } });
      }
      const entitlement_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`entitlements\` (entitlement_id, tenant_id, entitlement_key, entitlement_value, source, granted_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [entitlement_id, tenant_id, entitlement_key, entitlement_value || null, source,
         granted_at || new Date().toISOString().slice(0, 19).replace("T", " "), expires_at || null]
      );
      return res.status(201).json({ ok: true, entitlement_id, tenant_id, entitlement_key });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "entitlement_create_failed", message: err.message } });
    }
  });

  // ── GET /entitlements/:id ─────────────────────────────────────────────────
  router.get("/entitlements/:id", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT * FROM `entitlements` WHERE entitlement_id = ? LIMIT 1", [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: { code: "entitlement_not_found", message: `Entitlement ${req.params.id} not found.` } });
      return res.status(200).json({ ok: true, entitlement: rows[0] });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "entitlement_read_failed", message: err.message } });
    }
  });

  // ── PUT /entitlements/:id ─────────────────────────────────────────────────
  router.put("/entitlements/:id", requireBackendApiKey, async (req, res) => {
    try {
      const { entitlement_key, entitlement_value, source, expires_at } = req.body || {};
      if (!entitlement_key) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "entitlement_key is required." } });
      }
      await getPool().query(
        `UPDATE \`entitlements\` SET entitlement_key=?, entitlement_value=?, source=COALESCE(?,source), expires_at=? WHERE entitlement_id=?`,
        [entitlement_key, entitlement_value || null, source || null, expires_at || null, req.params.id]
      );
      return res.status(200).json({ ok: true, entitlement_id: req.params.id, entitlement_key });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "entitlement_update_failed", message: err.message } });
    }
  });

  // ── GET /tenants/:id/entitlements ─────────────────────────────────────────
  router.get("/tenants/:id/entitlements", requireBackendApiKey, async (req, res) => {
    try {
      const { key } = req.query;
      const conditions = ["tenant_id = ?"];
      const params = [req.params.id];
      if (key) { conditions.push("entitlement_key = ?"); params.push(key); }
      const [rows] = await getPool().query(
        `SELECT entitlement_id, entitlement_key, entitlement_value, source, granted_at, expires_at
         FROM \`entitlements\` WHERE ${conditions.join(" AND ")} ORDER BY granted_at DESC`,
        params
      );
      return res.status(200).json({ ok: true, tenant_id: req.params.id, entitlements: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "entitlements_list_failed", message: err.message } });
    }
  });

  return router;
}

function safeParseJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return value; }
}
