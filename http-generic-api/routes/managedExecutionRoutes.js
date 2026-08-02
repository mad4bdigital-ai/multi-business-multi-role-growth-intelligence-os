import { Router } from "express";
import { getPool } from "../db.js";
import {
  cancelManagedExecutionRun,
  createManagedExecutionRun,
  createManagedExecutionStep,
  decideManagedExecutionApproval,
  escalateManagedExecutionRun,
  finalizeManagedExecutionRollback,
  readManagedExecutionProjection,
  reassignManagedExecutionStep,
  reconcileManagedExecutionState,
  requestManagedExecutionRollback,
  retryManagedExecutionStep,
  syncManagedExecutionRunStatus,
  syncManagedExecutionStepStatus,
} from "../managedExecutionLifecycleService.js";

function principalActor(req) {
  return String(
    req.auth?.user_id || req.auth?.admin_id || req.auth?.email ||
    req.auth?.sub || req.auth?.mode || "backend_api_key"
  ).trim();
}

function principalIsAdmin(req) {
  return req.auth?.is_admin === true;
}

function routeError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function routeFailure(res, error, fallbackCode) {
  return res.status(error.status || 500).json({
    ok: false,
    error: {
      code: error.code || fallbackCode,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
    secrets_included: false,
  });
}

async function readRunContract(pool, runId) {
  const [rows] = await pool.query(
    "SELECT run_id, execution_context_json FROM workflow_runs WHERE run_id = ? LIMIT 2",
    [runId],
  );
  if (rows.length !== 1) return { found: false, managed: false, context: {} };
  let context = {};
  try { context = JSON.parse(rows[0].execution_context_json || "{}"); } catch {}
  return { found: true, managed: context.contract === "tenant-managed-execution-v1", context };
}

async function readHoldContract(pool, holdId) {
  const [rows] = await pool.query(
    "SELECT hold_id, execution_context_json FROM approval_holds WHERE hold_id = ? LIMIT 2",
    [holdId],
  );
  if (rows.length !== 1) return { found: false, managed: false, context: {} };
  let context = {};
  try { context = JSON.parse(rows[0].execution_context_json || "{}"); } catch {}
  return { found: true, managed: context.source === "managed_execution_lifecycle", context };
}

export function buildManagedExecutionRoutes(deps) {
  const router = Router();
  const { requireBackendApiKey } = deps;

  router.post("/managed-execution-runs", requireBackendApiKey, async (req, res) => {
    try {
      const result = await createManagedExecutionRun({ pool: getPool(), input: req.body || {} });
      return res.status(result.reused ? 200 : 201).json(result);
    } catch (error) {
      return routeFailure(res, error, "managed_execution_create_failed");
    }
  });

  router.get("/managed-execution-runs/:id", requireBackendApiKey, async (req, res) => {
    try {
      const projection = await readManagedExecutionProjection({
        pool: getPool(),
        runId: req.params.id,
        view: principalIsAdmin(req) ? "admin" : "tenant",
      });
      return res.status(200).json({ ok: true, projection, secrets_included: false });
    } catch (error) {
      return routeFailure(res, error, "managed_execution_read_failed");
    }
  });

  router.post("/managed-execution-runs/:id/reconcile", requireBackendApiKey, async (req, res) => {
    try {
      const { mode = "dry_run", confirmation = null } = req.body || {};
      const result = await reconcileManagedExecutionState({
        pool: getPool(),
        runId: req.params.id,
        mode,
        confirmation,
        actorId: principalActor(req),
        isAdmin: principalIsAdmin(req),
      });
      return res.status(200).json(result);
    } catch (error) {
      return routeFailure(res, error, "managed_execution_reconciliation_failed");
    }
  });

  const createStep = async (req, res) => {
    try {
      const result = await createManagedExecutionStep({
        pool: getPool(),
        runId: req.params.id,
        input: req.body || {},
        actorId: principalActor(req),
      });
      return res.status(result.reused ? 200 : 201).json(result);
    } catch (error) {
      return routeFailure(res, error, "managed_execution_step_create_failed");
    }
  };

  router.post("/managed-execution-runs/:id/steps", requireBackendApiKey, createStep);

  router.patch("/managed-execution-runs/:id/steps/:stepId/status", requireBackendApiKey, async (req, res) => {
    try {
      const { status, output_json = null, error_message = null } = req.body || {};
      if (!status) throw routeError(400, "managed_execution_step_status_required", "status is required.");
      const result = await syncManagedExecutionStepStatus({
        pool: getPool(),
        runId: req.params.id,
        stepRunId: req.params.stepId,
        nextStatus: status,
        actorId: principalActor(req),
        output: output_json,
        errorMessage: error_message,
      });
      return res.status(200).json(result);
    } catch (error) {
      return routeFailure(res, error, "managed_execution_step_status_update_failed");
    }
  });

  router.post("/managed-execution-runs/:id/steps/:stepId/retry", requireBackendApiKey, async (req, res) => {
    try {
      const { idempotency_key, reason = null, max_attempts = undefined } = req.body || {};
      const result = await retryManagedExecutionStep({
        pool: getPool(),
        runId: req.params.id,
        stepRunId: req.params.stepId,
        idempotencyKey: idempotency_key,
        actorId: principalActor(req),
        reason,
        maxAttempts: max_attempts,
      });
      return res.status(result.reused ? 200 : 201).json(result);
    } catch (error) {
      return routeFailure(res, error, "managed_execution_step_retry_failed");
    }
  });

  router.patch("/managed-execution-runs/:id/steps/:stepId/assignment", requireBackendApiKey, async (req, res) => {
    try {
      const { assigned_to, reason = null } = req.body || {};
      const result = await reassignManagedExecutionStep({
        pool: getPool(),
        runId: req.params.id,
        stepRunId: req.params.stepId,
        assignedTo: assigned_to,
        actorId: principalActor(req),
        reason,
      });
      return res.status(200).json(result);
    } catch (error) {
      return routeFailure(res, error, "managed_execution_step_reassignment_failed");
    }
  });

  router.post("/managed-execution-runs/:id/escalate", requireBackendApiKey, async (req, res) => {
    try {
      const { reason = null, assigned_to = null } = req.body || {};
      const result = await escalateManagedExecutionRun({
        pool: getPool(),
        runId: req.params.id,
        actorId: principalActor(req),
        reason,
        assignedTo: assigned_to,
      });
      return res.status(result.reused ? 200 : 201).json(result);
    } catch (error) {
      return routeFailure(res, error, "managed_execution_escalation_failed");
    }
  });

  router.post("/managed-execution-runs/:id/cancel", requireBackendApiKey, async (req, res) => {
    try {
      const { reason = null } = req.body || {};
      const result = await cancelManagedExecutionRun({
        pool: getPool(),
        runId: req.params.id,
        actorId: principalActor(req),
        reason,
      });
      return res.status(200).json(result);
    } catch (error) {
      return routeFailure(res, error, "managed_execution_cancellation_failed");
    }
  });

  router.post("/managed-execution-runs/:id/rollback", requireBackendApiKey, async (req, res) => {
    try {
      const { idempotency_key, assigned_to = null, reason = null } = req.body || {};
      const result = await requestManagedExecutionRollback({
        pool: getPool(),
        runId: req.params.id,
        idempotencyKey: idempotency_key,
        actorId: principalActor(req),
        assignedTo: assigned_to,
        reason,
      });
      return res.status(result.reused ? 200 : 201).json(result);
    } catch (error) {
      return routeFailure(res, error, "managed_execution_rollback_request_failed");
    }
  });

  router.post("/managed-execution-runs/:id/rollback/finalize", requireBackendApiKey, async (req, res) => {
    try {
      const { step_run_id, evidence = null } = req.body || {};
      if (!step_run_id) throw routeError(400, "managed_execution_rollback_step_required", "step_run_id is required.");
      const result = await finalizeManagedExecutionRollback({
        pool: getPool(),
        runId: req.params.id,
        stepRunId: step_run_id,
        actorId: principalActor(req),
        evidence,
      });
      return res.status(200).json(result);
    } catch (error) {
      return routeFailure(res, error, "managed_execution_rollback_finalize_failed");
    }
  });

  const updateStatus = async (req, res) => {
    try {
      const { status, output_json = null, error_json = null } = req.body || {};
      if (!status) throw routeError(400, "managed_execution_status_required", "status is required.");
      const result = await syncManagedExecutionRunStatus({
        pool: getPool(),
        runId: req.params.id,
        nextStatus: status,
        actorId: principalActor(req),
        output: output_json,
        error: error_json,
      });
      return res.status(200).json(result);
    } catch (error) {
      return routeFailure(res, error, "managed_execution_status_update_failed");
    }
  };

  router.patch("/managed-execution-runs/:id/status", requireBackendApiKey, updateStatus);

  router.post("/workflow-runs", requireBackendApiKey, (req, res, next) => {
    const body = req.body || {};
    const managedFields = ["parent_ticket_id", "capability_key", "resource_type", "resource_ref", "effect_class", "idempotency_key"];
    if (!managedFields.some((field) => Boolean(body[field]))) return next();
    return res.status(409).json({
      ok: false,
      error: {
        code: "managed_execution_route_required",
        message: "Managed task execution must use /managed-execution-runs so capability, resource grant, approval, and ticket linkage remain atomic.",
      },
      secrets_included: false,
    });
  });

  router.post("/workflow-runs/:id/steps", requireBackendApiKey, async (req, res, next) => {
    try {
      const contract = await readRunContract(getPool(), req.params.id);
      if (!contract.found || !contract.managed) return next();
      return createStep(req, res);
    } catch (error) {
      return routeFailure(res, error, "managed_execution_step_route_failed");
    }
  });

  router.patch("/workflow-runs/:id/status", requireBackendApiKey, async (req, res, next) => {
    try {
      const contract = await readRunContract(getPool(), req.params.id);
      if (!contract.found || !contract.managed) return next();
      return updateStatus(req, res);
    } catch (error) {
      return routeFailure(res, error, "managed_execution_status_route_failed");
    }
  });

  router.post("/approval-holds/:id/decide", requireBackendApiKey, async (req, res, next) => {
    try {
      const contract = await readHoldContract(getPool(), req.params.id);
      if (!contract.found || !contract.managed) return next();
      const { decision, decision_note = null } = req.body || {};
      const result = await decideManagedExecutionApproval({
        pool: getPool(),
        holdId: req.params.id,
        decision,
        decisionBy: principalActor(req),
        decisionNote: decision_note,
      });
      return res.status(result.status_code || 200).json(result);
    } catch (error) {
      return routeFailure(res, error, "managed_execution_approval_decision_failed");
    }
  });

  return router;
}
