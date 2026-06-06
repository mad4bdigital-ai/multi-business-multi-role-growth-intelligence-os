import { Router } from "express";
import { getPool } from "../db.js";
import { resolveAccess } from "../accessDecisionEngine.js";
import { dispatchPlan } from "../connectorExecutor.js";
import { randomUUID } from "node:crypto";

export function buildConnectorRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── POST /connector/dispatch ──────────────────────────────────────────────
  // Sprint 09: Bridge entry point for connector execution.
  // Accepts a plan_id (existing execution plan) OR creates an ad-hoc plan
  // from brand_key + workflow_key + tenant_id, then dispatches immediately.
  // ?apply=true to execute writes (default: dry-run plan-only).
  router.post("/connector/dispatch", requireBackendApiKey, async (req, res) => {
    try {
      const {
        plan_id,
        tenant_id, user_id, brand_key, target_key, workflow_id, workflow_key, intent_key,
        apply = false,
        post_types = ["post"],
        publish_status = "draft",
      } = req.body || {};

      let resolved_plan_id = plan_id;

      // If no plan_id provided, create an ad-hoc execution plan first
      if (!resolved_plan_id) {
        if (!tenant_id) {
          return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "plan_id or tenant_id is required." } });
        }

        const access = await resolveAccess({ tenant_id, user_id, risk_level: "low" });
        resolved_plan_id = randomUUID();

        const steps = [];
        if (intent_key) steps.push({ step: 1, type: "intent_resolution", key: intent_key });
        if (workflow_id || workflow_key) {
          steps.push({ step: 2, type: "workflow", workflow_id: workflow_id || null, key: workflow_key || null });
        }
        if (brand_key || target_key) steps.push({ step: 3, type: "target_resolution", brand_key: brand_key || null, target_key: target_key || null });
        steps.push({ step: steps.length + 1, type: "connector_dispatch", mode: access.service_mode });

        const plan_status = access.decision === "DENY" ? "draft" : "validated";

        await getPool().query(
          `INSERT INTO \`execution_plans\`
             (plan_id, tenant_id, user_id, intent_key, brand_key, target_key, workflow_key, workflow_id,
              service_mode, access_decision, plan_status, steps_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            resolved_plan_id, tenant_id, user_id || null,
            intent_key || null, brand_key || null, target_key || null, workflow_key || null, workflow_id || null,
            access.service_mode || "self_serve", access.decision, plan_status,
            JSON.stringify(steps),
          ]
        );

        if (access.decision === "DENY") {
          return res.status(403).json({
            ok: false,
            plan_id: resolved_plan_id,
            error: { code: "access_denied", message: `Access denied: ${access.reason}` },
            access_decision: access.decision,
          });
        }
      }

      const result = await dispatchPlan(resolved_plan_id, {
        apply,
        post_types,
        publish_status,
        actor_id: user_id || null,
      });

      const httpStatus = result.ok ? 200 : (result.error?.code === "plan_not_found" ? 404 : 400);
      return res.status(httpStatus).json(result);
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "dispatch_failed", message: err.message } });
    }
  });

  // ── GET /connector/dispatch/status/:run_id ────────────────────────────────
  // Poll the status of a connector dispatch by workflow run ID.
  router.get("/connector/dispatch/status/:run_id", requireBackendApiKey, async (req, res) => {
    try {
      const [runs] = await getPool().query(
        `SELECT run_id, tenant_id, workflow_key, plan_id, service_mode, status,
                output_json, error_json, started_at, completed_at
         FROM \`workflow_runs\` WHERE run_id = ? LIMIT 1`,
        [req.params.run_id]
      );
      if (!runs.length) {
        return res.status(404).json({ ok: false, error: { code: "run_not_found", message: "Workflow run not found." } });
      }
      const run = runs[0];
      for (const f of ["output_json", "error_json"]) {
        if (run[f]) try { run[f] = JSON.parse(run[f]); } catch {}
      }
      const [steps] = await getPool().query(
        "SELECT step_key, status, error_message, started_at, completed_at FROM `step_runs` WHERE run_id = ? ORDER BY id",
        [req.params.run_id]
      );
      return res.status(200).json({ ok: true, run, steps });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "status_read_failed", message: err.message } });
    }
  });

  // ── GET /connector/history ────────────────────────────────────────────────
  // Recent connector dispatches for a tenant (via workflow_runs linked to execution_plans).
  router.get("/connector/history", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, limit: rawLimit = 20 } = req.query;
      const limit = Math.min(Number(rawLimit) || 20, 100);

      const where = tenant_id ? "WHERE wr.tenant_id = ?" : "";
      const params = tenant_id ? [tenant_id, limit] : [limit];

      const [rows] = await getPool().query(
        `SELECT wr.run_id, wr.tenant_id, wr.workflow_key, wr.plan_id, wr.service_mode,
                wr.status, wr.started_at, wr.completed_at,
                ep.brand_key, ep.target_key, ep.intent_key, ep.access_decision
         FROM \`workflow_runs\` wr
         LEFT JOIN \`execution_plans\` ep ON ep.plan_id = wr.plan_id
         ${where}
         ORDER BY wr.created_at DESC LIMIT ?`,
        params
      );
      return res.status(200).json({ ok: true, runs: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "history_read_failed", message: err.message } });
    }
  });

  return router;
}
