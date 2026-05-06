import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { resolveAccess } from "../accessDecisionEngine.js";
import { dispatchPlan } from "../connectorExecutor.js";

export function buildPlannerRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── POST /planner/resolve-intent ──────────────────────────────────────────
  // Resolves raw user input to an intent key + matched route/workflow.
  router.post("/planner/resolve-intent", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, user_id, raw_input, service_mode = "self_serve" } = req.body || {};
      if (!tenant_id || !raw_input) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id and raw_input are required." } });
      }

      const resolution_id = randomUUID();

      // Match against existing task_routes in the registry
      const input_lower = raw_input.toLowerCase().trim();
      const [routeRows] = await getPool().query(
        `SELECT route_id, intent_key, workflow_key, trigger_terms
         FROM \`task_routes\` WHERE active = 1 OR active = 'true' OR active = '1'
         ORDER BY id LIMIT 500`
      );

      let matched_route_key = null;
      let matched_workflow_key = null;
      let resolved_intent = null;
      let confidence = 0;

      for (const row of routeRows) {
        const terms = String(row.trigger_terms || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
        const intentKey = String(row.intent_key || "").toLowerCase();
        const hits = terms.filter((t) => t && input_lower.includes(t));
        if (hits.length > 0) {
          const score = hits.length / Math.max(terms.length, 1);
          if (score > confidence) {
            confidence = score;
            matched_route_key = row.route_id;
            matched_workflow_key = row.workflow_key || null;
            resolved_intent = row.intent_key || null;
          }
        }
      }

      const resolution_status = confidence > 0 ? "resolved" : "unmatched";

      // Resolve agent_id from task_routes.execution_layer → agents.name
      let resolved_agent_id = null;
      if (matched_route_key) {
        const [routeMeta] = await getPool().query(
          "SELECT execution_layer FROM `task_routes` WHERE route_id = ? OR task_key = ? LIMIT 1",
          [matched_route_key, matched_route_key]
        );
        if (routeMeta[0]?.execution_layer) {
          const [agentRow] = await getPool().query(
            "SELECT agent_id FROM `agents` WHERE execution_layer = ? AND status = 'active' AND health_status = 'active' LIMIT 1",
            [routeMeta[0].execution_layer]
          );
          resolved_agent_id = agentRow[0]?.agent_id || null;
        }
      }

      await getPool().query(
        `INSERT INTO \`intent_resolutions\`
           (resolution_id, tenant_id, user_id, raw_input, resolved_intent, confidence,
            matched_route_key, matched_workflow_key, agent_id, resolution_status, service_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [resolution_id, tenant_id, user_id || null, raw_input, resolved_intent, confidence || null,
         matched_route_key, matched_workflow_key, resolved_agent_id, resolution_status, service_mode]
      );

      return res.status(200).json({
        ok: true,
        resolution_id,
        resolution_status,
        resolved_intent,
        confidence: confidence ? Number(confidence.toFixed(4)) : null,
        matched_route_key,
        matched_workflow_key,
        agent_id: resolved_agent_id,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "intent_resolve_failed", message: err.message } });
    }
  });

  // ── POST /planner/create-plan ─────────────────────────────────────────────
  // Creates an execution plan from a resolved intent, runs access check,
  // and optionally validates it before returning a preview.
  router.post("/planner/create-plan", requireBackendApiKey, async (req, res) => {
    try {
      const {
        tenant_id, user_id, resolution_id,
        intent_key, brand_key, target_key, workflow_key, route_key,
        risk_level = "low",
      } = req.body || {};

      if (!tenant_id) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id is required." } });
      }

      // Access gate
      const access = await resolveAccess({ tenant_id, user_id, risk_level });
      const plan_id = randomUUID();

      // Carry agent_id from resolution if available, or resolve from route_key
      let plan_agent_id = null;
      if (resolution_id) {
        const [resRow] = await getPool().query(
          "SELECT agent_id FROM `intent_resolutions` WHERE resolution_id = ? LIMIT 1",
          [resolution_id]
        );
        plan_agent_id = resRow[0]?.agent_id || null;
      }
      if (!plan_agent_id && route_key) {
        const [routeMeta] = await getPool().query(
          "SELECT execution_layer FROM `task_routes` WHERE route_id = ? OR task_key = ? LIMIT 1",
          [route_key, route_key]
        );
        if (routeMeta[0]?.execution_layer) {
          const [agentRow] = await getPool().query(
            "SELECT agent_id FROM `agents` WHERE execution_layer = ? AND status = 'active' AND health_status = 'active' LIMIT 1",
            [routeMeta[0].execution_layer]
          );
          plan_agent_id = agentRow[0]?.agent_id || null;
        }
      }

      // Build steps preview
      const steps = [];
      if (intent_key) steps.push({ step: 1, type: "intent_resolution", key: intent_key });
      if (workflow_key) steps.push({ step: 2, type: "workflow", key: workflow_key });
      if (brand_key || target_key) steps.push({ step: 3, type: "target_resolution", brand_key: brand_key || null, target_key: target_key || null });
      steps.push({ step: steps.length + 1, type: "execution_dispatch", mode: access.service_mode || "self_serve" });

      const validation_errors = [];
      if (!workflow_key && !intent_key) validation_errors.push("No workflow_key or intent_key specified.");
      if (access.decision === "DENY") validation_errors.push(`Access denied: ${access.reason}`);

      const plan_status = validation_errors.length > 0 ? "draft" : "validated";

      await getPool().query(
        `INSERT INTO \`execution_plans\`
           (plan_id, tenant_id, user_id, resolution_id, intent_key, brand_key, target_key, workflow_key, route_key,
            agent_id, service_mode, access_decision, plan_status, steps_json, validation_errors)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          plan_id, tenant_id, user_id || null, resolution_id || null,
          intent_key || null, brand_key || null, target_key || null, workflow_key || null, route_key || null,
          plan_agent_id,
          access.service_mode || "self_serve", access.decision, plan_status,
          JSON.stringify(steps),
          validation_errors.length ? JSON.stringify(validation_errors) : null,
        ]
      );

      return res.status(201).json({
        ok: true,
        plan_id,
        plan_status,
        access_decision: access.decision,
        allows_execution: access.decision === "ALLOW_SELF_SERVE" || access.decision === "ALLOW_WITH_OPTIONAL_ASSISTANCE",
        service_mode: access.service_mode,
        steps,
        validation_errors: validation_errors.length ? validation_errors : null,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "plan_create_failed", message: err.message } });
    }
  });

  // ── GET /planner/plans/:id ────────────────────────────────────────────────
  router.get("/planner/plans/:id", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT * FROM `execution_plans` WHERE plan_id = ? LIMIT 1", [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: { code: "plan_not_found", message: `Plan ${req.params.id} not found.` } });
      const p = rows[0];
      if (p.steps_json) try { p.steps_json = JSON.parse(p.steps_json); } catch {}
      if (p.validation_errors) try { p.validation_errors = JSON.parse(p.validation_errors); } catch {}
      return res.status(200).json({ ok: true, plan: p });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "plan_read_failed", message: err.message } });
    }
  });

  // ── PATCH /planner/plans/:id/status ──────────────────────────────────────
  router.patch("/planner/plans/:id/status", requireBackendApiKey, async (req, res) => {
    try {
      const { status } = req.body || {};
      const VALID = ["draft", "validated", "approved", "executing", "completed", "failed", "cancelled"];
      if (!VALID.includes(status)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_status", message: `status must be one of: ${VALID.join(", ")}` } });
      }
      await getPool().query("UPDATE `execution_plans` SET plan_status = ? WHERE plan_id = ?", [status, req.params.id]);
      return res.status(200).json({ ok: true, plan_id: req.params.id, plan_status: status });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "plan_update_failed", message: err.message } });
    }
  });

  // ── POST /planner/plans/:id/execute ──────────────────────────────────────
  // Dispatches an approved/validated execution plan to the connector layer.
  // Query param ?apply=true to write changes (default: dry-run).
  // Returns run_id + trace_id for polling via GET /workflow-runs/:run_id.
  router.post("/planner/plans/:id/execute", requireBackendApiKey, async (req, res) => {
    try {
      const plan_id = req.params.id;
      const apply         = req.query.apply === "true" || req.body?.apply === true;
      const post_types    = req.body?.post_types || ["post"];
      const publish_status = req.body?.publish_status || "draft";
      const actor_id      = req.body?.actor_id || null;

      const result = await dispatchPlan(plan_id, { apply, post_types, publish_status, actor_id });
      const httpStatus = result.ok ? 200 : (result.error?.code === "plan_not_found" ? 404 : 400);
      return res.status(httpStatus).json(result);
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "execute_failed", message: err.message } });
    }
  });

  return router;
}
