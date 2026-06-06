import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

export function buildObservabilityRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── POST /telemetry/spans ─────────────────────────────────────────────────
  router.post("/telemetry/spans", requireBackendApiKey, async (req, res) => {
    try {
      const {
        trace_id, tenant_id, workspace_id, workspace_key, run_id,
        user_id, actor_id, actor_type, brand_id, brand_key,
        request_id, session_id, conversation_id, correlation_id,
        span_name, span_type = "internal",
        service_mode = "self_serve", status = "ok", duration_ms, attributes_json, error_message,
      } = req.body || {};
      if (!trace_id || !span_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "trace_id and span_name are required." } });
      }
      const span_id = randomUUID();
      const attrs = attributes_json ? JSON.stringify(attributes_json) : null;
      await getPool().query(
        `INSERT INTO \`telemetry_spans\`
           (span_id, trace_id, tenant_id, run_id, span_name, span_type, service_mode, status, duration_ms, attributes_json, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [span_id, trace_id, tenant_id || null, run_id || null, span_name, span_type,
         service_mode, status, duration_ms || null, attrs, error_message || null]
      );
      return res.status(201).json({ ok: true, span_id, trace_id });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "span_create_failed", message: err.message } });
    }
  });

  // ── GET /telemetry/traces/:trace_id ───────────────────────────────────────
  router.get("/telemetry/traces/:trace_id", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        `SELECT span_id, span_name, span_type, service_mode, status, duration_ms, error_message, started_at
         FROM \`telemetry_spans\` WHERE trace_id = ? ORDER BY started_at ASC`,
        [req.params.trace_id]
      );
      const total_ms = rows.reduce((sum, r) => sum + (r.duration_ms || 0), 0);
      return res.status(200).json({ ok: true, trace_id: req.params.trace_id, spans: rows, span_count: rows.length, total_ms });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "trace_read_failed", message: err.message } });
    }
  });

  // ── POST /usage/record ────────────────────────────────────────────────────
  // Increment a usage meter for a tenant (upserts daily bucket by default).
  router.post("/usage/record", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, meter_key, quantity = 1, service_mode = "self_serve", cost_usd, period_start, period_end } = req.body || {};
      if (!tenant_id || !meter_key) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id and meter_key are required." } });
      }

      const today = (period_start || new Date().toISOString().slice(0, 10));
      const end   = (period_end   || today);

      // Upsert: increment quantity for existing period bucket
      const [existing] = await getPool().query(
        "SELECT meter_id FROM `usage_meters` WHERE tenant_id = ? AND meter_key = ? AND period_start = ? LIMIT 1",
        [tenant_id, meter_key, today]
      );

      if (existing.length) {
        await getPool().query(
          "UPDATE `usage_meters` SET quantity = quantity + ?, cost_usd = COALESCE(cost_usd, 0) + ? WHERE meter_id = ?",
          [quantity, cost_usd || 0, existing[0].meter_id]
        );
        return res.status(200).json({ ok: true, meter_id: existing[0].meter_id, incremented: quantity });
      }

      const meter_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`usage_meters\` (meter_id, tenant_id, meter_key, period_start, period_end, quantity, service_mode, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [meter_id, tenant_id, meter_key, today, end, quantity, service_mode, cost_usd || null]
      );
      return res.status(201).json({ ok: true, meter_id, tenant_id, meter_key, quantity });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "usage_record_failed", message: err.message } });
    }
  });

  // ── GET /usage/:tenant_id ─────────────────────────────────────────────────
  router.get("/usage/:tenant_id", requireBackendApiKey, async (req, res) => {
    try {
      const { meter_key, from, to } = req.query;
      const conditions = ["tenant_id = ?"];
      const params = [req.params.tenant_id];
      if (meter_key) { conditions.push("meter_key = ?"); params.push(meter_key); }
      if (from) { conditions.push("period_start >= ?"); params.push(from); }
      if (to)   { conditions.push("period_end <= ?"); params.push(to); }
      const [rows] = await getPool().query(
        `SELECT meter_key, period_start, period_end, quantity, unit, service_mode, cost_usd
         FROM \`usage_meters\` WHERE ${conditions.join(" AND ")} ORDER BY period_start DESC LIMIT 500`,
        params
      );
      const totals = {};
      for (const r of rows) {
        totals[r.meter_key] = (totals[r.meter_key] || 0) + Number(r.quantity);
      }
      return res.status(200).json({ ok: true, tenant_id: req.params.tenant_id, meters: rows, totals, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "usage_read_failed", message: err.message } });
    }
  });

  // ── POST /quota-rules ─────────────────────────────────────────────────────
  router.post("/quota-rules", requireBackendApiKey, async (req, res) => {
    try {
      const { plan_key, tenant_id, meter_key, limit_value, period = "monthly", action = "warn" } = req.body || {};
      if (!meter_key) return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "meter_key is required." } });
      const rule_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`quota_rules\` (rule_id, plan_key, tenant_id, meter_key, limit_value, period, action)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [rule_id, plan_key || null, tenant_id || null, meter_key, limit_value || null, period, action]
      );
      return res.status(201).json({ ok: true, rule_id, meter_key, limit_value, period, action });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "quota_create_failed", message: err.message } });
    }
  });

  // ── POST /tracking/workspaces ─────────────────────────────────────────────
  router.post("/tracking/workspaces", requireBackendApiKey, async (req, res) => {
    try {
      const {
        tenant_id, workspace_key, display_name,
        ga_property_id, gtm_container_id, gsc_property,
        tracking_status = "active", service_mode = "self_serve",
      } = req.body || {};
      if (!tenant_id || !workspace_key || !display_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id, workspace_key, and display_name are required." } });
      }
      const workspace_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`tracking_workspaces\`
           (workspace_id, tenant_id, workspace_key, display_name, ga_property_id, gtm_container_id, gsc_property, tracking_status, service_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [workspace_id, tenant_id, workspace_key, display_name, ga_property_id || null,
         gtm_container_id || null, gsc_property || null, tracking_status, service_mode]
      );
      return res.status(201).json({ ok: true, workspace_id, tenant_id, workspace_key, display_name, tracking_status });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ ok: false, error: { code: "workspace_exists", message: "Tracking workspace key already exists for this tenant." } });
      return res.status(500).json({ ok: false, error: { code: "tracking_workspace_create_failed", message: err.message } });
    }
  });

  // ── GET /tenants/:id/tracking/workspaces ──────────────────────────────────
  router.get("/tenants/:id/tracking/workspaces", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        `SELECT workspace_id, workspace_key, display_name, ga_property_id, gtm_container_id,
                gsc_property, tracking_status, service_mode, created_at
         FROM \`tracking_workspaces\` WHERE tenant_id = ? ORDER BY created_at DESC`,
        [req.params.id]
      );
      return res.status(200).json({ ok: true, workspaces: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "tracking_workspaces_list_failed", message: err.message } });
    }
  });

  // ── PUT /tracking/workspaces/:id ─────────────────────────────────────────
  router.put("/tracking/workspaces/:id", requireBackendApiKey, async (req, res) => {
    try {
      const { display_name, ga_property_id, gtm_container_id, gsc_property, tracking_status, service_mode } = req.body || {};
      if (!display_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "display_name is required." } });
      }
      await getPool().query(
        `UPDATE \`tracking_workspaces\`
         SET display_name=?, ga_property_id=COALESCE(?,ga_property_id),
             gtm_container_id=COALESCE(?,gtm_container_id), gsc_property=COALESCE(?,gsc_property),
             tracking_status=COALESCE(?,tracking_status), service_mode=COALESCE(?,service_mode)
         WHERE workspace_id=?`,
        [display_name, ga_property_id || null, gtm_container_id || null, gsc_property || null,
         tracking_status || null, service_mode || null, req.params.id]
      );
      return res.status(200).json({ ok: true, workspace_id: req.params.id, display_name });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "tracking_workspace_update_failed", message: err.message } });
    }
  });

  // ── GET /tracking/workspaces/:id ──────────────────────────────────────────
  router.get("/tracking/workspaces/:id", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT * FROM `tracking_workspaces` WHERE workspace_id = ? LIMIT 1", [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: { code: "workspace_not_found", message: `Tracking workspace ${req.params.id} not found.` } });
      return res.status(200).json({ ok: true, workspace: rows[0] });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "tracking_workspace_read_failed", message: err.message } });
    }
  });

  // ── POST /tracking/events ─────────────────────────────────────────────────
  router.post("/tracking/events", requireBackendApiKey, async (req, res) => {
    try {
      const {
        tenant_id, workspace_id, event_category, event_type,
        actor_id, actor_type, subject_id, subject_type,
        service_mode = "self_serve", dimensions_json, metrics_json, occurred_at,
      } = req.body || {};
      if (!tenant_id || !event_type) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id and event_type are required." } });
      }
      const event_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`tracked_events\`
           (event_id, tenant_id, workspace_id, event_category, event_type, actor_id, actor_type,
            subject_id, subject_type, service_mode, dimensions_json, metrics_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [event_id, tenant_id, workspace_id || null, event_category || null, event_type,
         actor_id || null, actor_type || null, subject_id || null, subject_type || null,
         service_mode,
         dimensions_json ? JSON.stringify(dimensions_json) : null,
         metrics_json    ? JSON.stringify(metrics_json)    : null,
         occurred_at || new Date().toISOString().slice(0, 19).replace("T", " ")]
      );
      return res.status(201).json({ ok: true, event_id, tenant_id, event_type });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "tracked_event_create_failed", message: err.message } });
    }
  });

  // ── GET /tracking/workspaces/:id/events ───────────────────────────────────
  router.get("/tracking/workspaces/:id/events", requireBackendApiKey, async (req, res) => {
    try {
      const { event_type, from, to, limit: rawLimit = 200 } = req.query;
      const limit = Math.min(Number(rawLimit) || 200, 1000);
      const conditions = ["workspace_id = ?"];
      const params = [req.params.id];
      if (event_type) { conditions.push("event_type = ?"); params.push(event_type); }
      if (from) { conditions.push("occurred_at >= ?"); params.push(from); }
      if (to)   { conditions.push("occurred_at <= ?"); params.push(to); }
      params.push(limit);
      const [rows] = await getPool().query(
        `SELECT event_id, event_category, event_type, actor_id, actor_type,
                subject_id, subject_type, service_mode, occurred_at
         FROM \`tracked_events\` WHERE ${conditions.join(" AND ")} ORDER BY occurred_at DESC LIMIT ?`,
        params
      );
      return res.status(200).json({ ok: true, workspace_id: req.params.id, events: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "tracked_events_list_failed", message: err.message } });
    }
  });

  // ── POST /reporting/views ─────────────────────────────────────────────────
  router.post("/reporting/views", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, view_key, display_name, view_type = "table", filters_json, columns_json } = req.body || {};
      if (!tenant_id || !view_key || !display_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id, view_key, and display_name are required." } });
      }
      const view_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`reporting_views\` (view_id, tenant_id, view_key, display_name, view_type, filters_json, columns_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [view_id, tenant_id, view_key, display_name, view_type,
         filters_json ? JSON.stringify(filters_json) : null,
         columns_json ? JSON.stringify(columns_json) : null]
      );
      return res.status(201).json({ ok: true, view_id, tenant_id, view_key, display_name, view_type });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ ok: false, error: { code: "view_exists", message: "Reporting view key already exists for this tenant." } });
      return res.status(500).json({ ok: false, error: { code: "reporting_view_create_failed", message: err.message } });
    }
  });

  // ── GET /tenants/:id/reporting/views ──────────────────────────────────────
  router.get("/tenants/:id/reporting/views", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        `SELECT view_id, view_key, display_name, view_type, created_at
         FROM \`reporting_views\` WHERE tenant_id = ? ORDER BY created_at DESC`,
        [req.params.id]
      );
      return res.status(200).json({ ok: true, views: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "reporting_views_list_failed", message: err.message } });
    }
  });

  // ── PUT /reporting/views/:id ─────────────────────────────────────────────
  router.put("/reporting/views/:id", requireBackendApiKey, async (req, res) => {
    try {
      const { view_key, display_name, view_type, filters_json, columns_json } = req.body || {};
      if (!view_key || !display_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "view_key and display_name are required." } });
      }
      await getPool().query(
        `UPDATE \`reporting_views\`
         SET view_key=?, display_name=?, view_type=COALESCE(?,view_type),
             filters_json=COALESCE(?,filters_json), columns_json=COALESCE(?,columns_json)
         WHERE view_id=?`,
        [view_key, display_name, view_type || null,
         filters_json != null ? JSON.stringify(filters_json) : null,
         columns_json != null ? JSON.stringify(columns_json) : null,
         req.params.id]
      );
      return res.status(200).json({ ok: true, view_id: req.params.id, view_key, display_name });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "reporting_view_update_failed", message: err.message } });
    }
  });

  // ── GET /reporting/views/:id ──────────────────────────────────────────────
  router.get("/reporting/views/:id", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT * FROM `reporting_views` WHERE view_id = ? LIMIT 1", [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: { code: "view_not_found", message: `Reporting view ${req.params.id} not found.` } });
      const v = rows[0];
      for (const f of ["filters_json", "columns_json"]) {
        if (v[f]) try { v[f] = JSON.parse(v[f]); } catch {}
      }
      return res.status(200).json({ ok: true, view: v });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "reporting_view_read_failed", message: err.message } });
    }
  });

  // ── GET /quota-check/:tenant_id/:meter_key ────────────────────────────────
  // Returns whether the tenant is within quota for the given meter.
  router.get("/quota-check/:tenant_id/:meter_key", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, meter_key } = req.params;

      // Get tenant's plan
      const [[subRow]] = await getPool().query(
        `SELECT p.plan_key FROM \`subscriptions\` s JOIN \`plans\` p ON p.plan_id = s.plan_id
         WHERE s.tenant_id = ? AND s.status = 'active' LIMIT 1`,
        [tenant_id]
      );
      const plan_key = subRow?.plan_key || null;

      // Find applicable rule (tenant-specific overrides plan-level)
      const [rules] = await getPool().query(
        `SELECT limit_value, period, action FROM \`quota_rules\`
         WHERE meter_key = ? AND active = 1
           AND (tenant_id = ? OR (tenant_id IS NULL AND plan_key = ?) OR (tenant_id IS NULL AND plan_key IS NULL))
         ORDER BY tenant_id IS NOT NULL DESC, plan_key IS NOT NULL DESC LIMIT 1`,
        [meter_key, tenant_id, plan_key]
      );
      if (!rules.length) {
        return res.status(200).json({ ok: true, within_quota: true, reason: "no_rule_defined" });
      }

      const rule = rules[0];
      const today = new Date().toISOString().slice(0, 10);
      const period_start = rule.period === "daily" ? today :
                           rule.period === "monthly" ? today.slice(0, 7) + "-01" :
                           today.slice(0, 4) + "-01-01";

      const [[usage]] = await getPool().query(
        "SELECT COALESCE(SUM(quantity),0) AS total FROM `usage_meters` WHERE tenant_id = ? AND meter_key = ? AND period_start >= ?",
        [tenant_id, meter_key, period_start]
      );
      const used = Number(usage.total);
      const limit = rule.limit_value !== null ? Number(rule.limit_value) : null;
      const within_quota = limit === null || used < limit;

      return res.status(200).json({
        ok: true, within_quota, used, limit, period: rule.period, action: rule.action,
        tenant_id, meter_key, plan_key,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "quota_check_failed", message: err.message } });
    }
  });

  return router;
}
