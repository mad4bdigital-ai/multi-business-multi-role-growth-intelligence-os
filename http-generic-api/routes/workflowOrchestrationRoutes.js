import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { resolveAccess } from "../accessDecisionEngine.js";

export function buildWorkflowOrchestrationRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── POST /workflow-runs ───────────────────────────────────────────────────
  // Start a new workflow run. Access gate runs first.
  router.post("/workflow-runs", requireBackendApiKey, async (req, res) => {
    try {
      const {
        tenant_id, user_id, workflow_key, plan_id,
        workspace_id = null, workspace_key = null,
        brand_id = null, brand_key = null,
        request_id = null, session_id = null, conversation_id = null,
        correlation_id = null,
        service_mode = "self_serve", risk_level = "low", input_json,
      } = req.body || {};

      if (!tenant_id || !workflow_key) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id and workflow_key are required." } });
      }

      const access = await resolveAccess({ tenant_id, user_id, risk_level });
      if (access.decision === "DENY") {
        return res.status(403).json({ ok: false, error: { code: "access_denied", message: `Access denied: ${access.reason}` } });
      }

      // Runs requiring review/approval start in awaiting_approval
      const initialStatus =
        access.decision === "REQUIRE_REVIEW" ? "awaiting_review" :
        access.decision === "REQUIRE_SUPERVISOR_APPROVAL" ? "awaiting_approval" :
        access.decision === "ROUTE_TO_MANAGED_SERVICE" ? "awaiting_approval" :
        "pending";

      const run_id = randomUUID();
      const resolvedCorrelationId = correlation_id || run_id;
      const input = input_json ? JSON.stringify(input_json) : null;
      const executionContextJson = JSON.stringify({
        source: "workflow_orchestration_routes",
        run_id,
        plan_id: plan_id || null,
        request_id: request_id || null,
        secrets_included: false,
      });

      await getPool().query(
        `INSERT INTO \`workflow_runs\`
           (run_id, tenant_id, workspace_id, workspace_key, user_id, actor_id, actor_type,
            brand_id, brand_key, request_id, session_id, conversation_id, correlation_id,
            execution_context_json, workflow_key, plan_id, service_mode, status, input_json, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [run_id, tenant_id, workspace_id, workspace_key, user_id || null, user_id || null,
         user_id ? "user" : "system", brand_id, brand_key, request_id, session_id,
         conversation_id, resolvedCorrelationId, executionContextJson, workflow_key, plan_id || null,
         service_mode, initialStatus, input, initialStatus === "pending" ? new Date() : null]
      );

      // If review/approval needed, auto-create an approval hold
      let hold_id = null;
      if (["awaiting_review", "awaiting_approval"].includes(initialStatus)) {
        hold_id = randomUUID();
        const hold_type = access.decision === "REQUIRE_REVIEW" ? "review" : "supervisor_approval";
        const required_role = hold_type === "review" ? "certified_reviewer" : "supervisor";
        await getPool().query(
          `INSERT INTO \`approval_holds\`
             (hold_id, run_id, tenant_id, workspace_id, workspace_key, user_id,
              actor_id, actor_type, brand_id, brand_key, request_id, session_id,
              conversation_id, correlation_id, execution_context_json,
              hold_type, requested_by, required_role)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [hold_id, run_id, tenant_id, workspace_id, workspace_key, user_id || null,
           user_id || null, user_id ? "user" : "system", brand_id, brand_key,
           request_id, session_id, conversation_id, resolvedCorrelationId,
           JSON.stringify({ source: "workflow_orchestration_routes", run_id, hold_id, secrets_included: false }),
           hold_type, user_id || null, required_role]
        );
      }

      return res.status(201).json({
        ok: true,
        run_id,
        workflow_key,
        status: initialStatus,
        access_decision: access.decision,
        hold_id,
        requires_human: hold_id !== null,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "run_create_failed", message: err.message } });
    }
  });

  // ── GET /workflow-runs/:id ────────────────────────────────────────────────
  router.get("/workflow-runs/:id", requireBackendApiKey, async (req, res) => {
    try {
      const [runs] = await getPool().query("SELECT * FROM `workflow_runs` WHERE run_id = ? LIMIT 1", [req.params.id]);
      if (!runs.length) return res.status(404).json({ ok: false, error: { code: "run_not_found", message: "Workflow run not found." } });
      const [steps] = await getPool().query(
        "SELECT step_run_id, step_key, step_type, status, attempt, started_at, completed_at FROM `step_runs` WHERE run_id = ? ORDER BY id",
        [req.params.id]
      );
      const [holds] = await getPool().query(
        "SELECT hold_id, hold_type, required_role, status, assigned_to, expires_at FROM `approval_holds` WHERE run_id = ? ORDER BY id",
        [req.params.id]
      );
      const run = runs[0];
      if (run.input_json) try { run.input_json = JSON.parse(run.input_json); } catch {}
      if (run.output_json) try { run.output_json = JSON.parse(run.output_json); } catch {}
      return res.status(200).json({ ok: true, run, steps, holds });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "run_read_failed", message: err.message } });
    }
  });

  // ── GET /tenants/:id/workflow-runs ────────────────────────────────────────
  router.get("/tenants/:id/workflow-runs", requireBackendApiKey, async (req, res) => {
    try {
      const { status, workflow_key } = req.query;
      const conditions = ["tenant_id = ?"];
      const params = [req.params.id];
      if (status) { conditions.push("status = ?"); params.push(status); }
      if (workflow_key) { conditions.push("workflow_key = ?"); params.push(workflow_key); }
      const [rows] = await getPool().query(
        `SELECT run_id, workflow_key, status, service_mode, started_at, completed_at, created_at
         FROM \`workflow_runs\` WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT 200`,
        params
      );
      return res.status(200).json({ ok: true, runs: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "runs_list_failed", message: err.message } });
    }
  });

  // ── PATCH /workflow-runs/:id/status ──────────────────────────────────────
  router.patch("/workflow-runs/:id/status", requireBackendApiKey, async (req, res) => {
    try {
      const { status, output_json, error_json } = req.body || {};
      const VALID = ["pending","running","awaiting_approval","awaiting_review","paused","completed","failed","cancelled"];
      if (!VALID.includes(status)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_status", message: `status must be one of: ${VALID.join(", ")}` } });
      }
      const sets = ["status = ?"];
      const vals = [status];
      if (output_json !== undefined) { sets.push("output_json = ?"); vals.push(JSON.stringify(output_json)); }
      if (error_json !== undefined) { sets.push("error_json = ?"); vals.push(JSON.stringify(error_json)); }
      if (status === "running" && !sets.includes("started_at = ?")) { sets.push("started_at = NOW()"); }
      if (["completed","failed","cancelled"].includes(status)) { sets.push("completed_at = NOW()"); }
      vals.push(req.params.id);
      await getPool().query(`UPDATE \`workflow_runs\` SET ${sets.join(", ")} WHERE run_id = ?`, vals);
      return res.status(200).json({ ok: true, run_id: req.params.id, status });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "run_update_failed", message: err.message } });
    }
  });

  // ── POST /workflow-runs/:id/steps ─────────────────────────────────────────
  router.post("/workflow-runs/:id/steps", requireBackendApiKey, async (req, res) => {
    try {
      const { step_key, step_type = "action", assigned_to, input_json } = req.body || {};
      if (!step_key) return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "step_key is required." } });

      const [runRows] = await getPool().query("SELECT tenant_id, workspace_id, workspace_key, user_id, actor_id, actor_type, brand_id, brand_key, request_id, session_id, conversation_id, correlation_id FROM `workflow_runs` WHERE run_id = ? LIMIT 1", [req.params.id]);
      if (!runRows.length) return res.status(404).json({ ok: false, error: { code: "run_not_found", message: "Workflow run not found." } });

      const runContext = runRows[0];
      const step_run_id = randomUUID();
      const input = input_json ? JSON.stringify(input_json) : null;
      await getPool().query(
        `INSERT INTO \`step_runs\`
           (step_run_id, run_id, tenant_id, workspace_id, workspace_key, user_id,
            actor_id, actor_type, brand_id, brand_key, request_id, session_id,
            conversation_id, correlation_id, execution_context_json,
            step_key, step_type, assigned_to, input_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [step_run_id, req.params.id, runContext.tenant_id, runContext.workspace_id || null,
         runContext.workspace_key || null, runContext.user_id || null,
         runContext.actor_id || runContext.user_id || null,
         runContext.actor_type || (runContext.user_id ? "user" : "system"),
         runContext.brand_id || null, runContext.brand_key || null,
         runContext.request_id || null, runContext.session_id || null,
         runContext.conversation_id || null, runContext.correlation_id || req.params.id,
         JSON.stringify({ source: "workflow_orchestration_routes", run_id: req.params.id, step_run_id, secrets_included: false }),
         step_key, step_type, assigned_to || null, input]
      );
      return res.status(201).json({ ok: true, step_run_id, run_id: req.params.id, step_key, step_type, status: "pending" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "step_create_failed", message: err.message } });
    }
  });

  // ── POST /approval-holds/:id/decide ──────────────────────────────────────
  // Approve or reject an approval hold. On approval, resume the parent run.
  router.post("/approval-holds/:id/decide", requireBackendApiKey, async (req, res) => {
    try {
      const { decision, decision_by, decision_note } = req.body || {};
      if (!["approved","rejected","escalated"].includes(decision)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_decision", message: "decision must be 'approved', 'rejected', or 'escalated'." } });
      }

      const [holdRows] = await getPool().query("SELECT * FROM `approval_holds` WHERE hold_id = ? LIMIT 1", [req.params.id]);
      if (!holdRows.length) return res.status(404).json({ ok: false, error: { code: "hold_not_found", message: "Approval hold not found." } });
      if (holdRows[0].status !== "open") {
        return res.status(409).json({ ok: false, error: { code: "hold_already_decided", message: `Hold is already '${holdRows[0].status}'.` } });
      }
      let holdContext = {};
      try { holdContext = JSON.parse(holdRows[0].execution_context_json || "{}"); } catch {}
      if (holdContext.source === "growth_intelligence_registry") {
        return res.status(409).json({
          ok: false,
          error: {
            code: "growth_intelligence_specialized_decision_required",
            message: "Use the Growth Intelligence action decision route so hold, action, report, and workflow state remain synchronized.",
          },
        });
      }
      if (holdContext.source === "sequential_plan_orchestrator") {
        const nextStepStatus = decision === "approved" ? "ready" : decision === "escalated" ? "awaiting_approval" : "failed";
        const nextPlanStatus = decision === "approved" ? "validated" : decision === "escalated" ? "awaiting_approval" : "blocked";
        await getPool().query(
          "UPDATE `approval_holds` SET status = ?, decision_by = ?, decision_note = ?, decided_at = NOW() WHERE hold_id = ?",
          [decision, decision_by || null, decision_note || null, req.params.id]
        );
        await getPool().query(
          `UPDATE execution_plan_steps
              SET status = CASE WHEN ? = 'approved' AND step_type = 'approval' THEN 'completed' ELSE ? END,
                  approval_policy_json = JSON_SET(COALESCE(approval_policy_json, JSON_OBJECT()), '$.approved', ?)
            WHERE plan_step_id = ? AND status = 'awaiting_approval'`,
          [decision, nextStepStatus, decision === "approved", holdContext.plan_step_id]
        );
        await getPool().query("UPDATE execution_plans SET plan_status = ? WHERE plan_id = ?", [nextPlanStatus, holdContext.plan_id]);
        await getPool().query(
          `INSERT INTO execution_plan_events
            (plan_event_id, plan_id, plan_step_id, tenant_id, event_type, from_status, to_status, actor_id, evidence_json)
           VALUES (?, ?, ?, ?, 'approval_decided', 'awaiting_approval', ?, ?, ?)`,
          [
            randomUUID(), holdContext.plan_id, holdContext.plan_step_id, holdRows[0].tenant_id,
            nextStepStatus, decision_by || null,
            JSON.stringify({ hold_id: req.params.id, decision, secrets_included: false }),
          ]
        );
        return res.status(200).json({
          ok: true,
          hold_id: req.params.id,
          decision,
          plan_id: holdContext.plan_id,
          plan_step_id: holdContext.plan_step_id,
          plan_status: nextPlanStatus,
          step_status: decision === "approved" ? "ready_or_completed" : nextStepStatus,
          execution_dispatched: false,
          secrets_included: false,
        });
      }

      await getPool().query(
        "UPDATE `approval_holds` SET status = ?, decision_by = ?, decision_note = ?, decided_at = NOW() WHERE hold_id = ?",
        [decision, decision_by || null, decision_note || null, req.params.id]
      );

      // Resume or fail the parent run
      const run_id = holdRows[0].run_id;
      const new_run_status = decision === "approved" ? "running" :
                             decision === "escalated" ? "awaiting_approval" : "failed";
      const run_sets = ["status = ?"];
      const run_vals = [new_run_status];
      if (new_run_status === "running") { run_sets.push("started_at = COALESCE(started_at, NOW())"); }
      if (new_run_status === "failed") { run_sets.push("completed_at = NOW()"); }
      run_vals.push(run_id);
      await getPool().query(`UPDATE \`workflow_runs\` SET ${run_sets.join(", ")} WHERE run_id = ?`, run_vals);

      return res.status(200).json({ ok: true, hold_id: req.params.id, decision, run_id, run_status: new_run_status });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "hold_decide_failed", message: err.message } });
    }
  });

  // ── GET /approval-holds — open holds queue for reviewers ─────────────────
  router.get("/approval-holds", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, hold_type, required_role, assigned_to } = req.query;
      const conditions = ["status = 'open'"];
      const params = [];
      if (tenant_id) { conditions.push("tenant_id = ?"); params.push(tenant_id); }
      if (hold_type) { conditions.push("hold_type = ?"); params.push(hold_type); }
      if (required_role) { conditions.push("required_role = ?"); params.push(required_role); }
      if (assigned_to) { conditions.push("assigned_to = ?"); params.push(assigned_to); }
      const [rows] = await getPool().query(
        `SELECT hold_id, run_id, tenant_id, hold_type, required_role, requested_by, assigned_to, expires_at, created_at
         FROM \`approval_holds\` WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC LIMIT 200`,
        params
      );
      return res.status(200).json({ ok: true, holds: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "holds_list_failed", message: err.message } });
    }
  });

  return router;
}
