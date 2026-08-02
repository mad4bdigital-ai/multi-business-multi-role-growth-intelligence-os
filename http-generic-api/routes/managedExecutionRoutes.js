import { Router } from "express";
import { getPool } from "../db.js";
import {
  createManagedExecutionRun,
  createManagedExecutionStep,
  decideManagedExecutionApproval,
  projectManagedExecutionState,
  syncManagedExecutionRunStatus,
} from "../managedExecutionLifecycleService.js";

function principalActor(req) {
  return String(
    req.auth?.user_id || req.auth?.admin_id || req.auth?.email ||
    req.auth?.sub || req.auth?.mode || "backend_api_key"
  ).trim();
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

async function readManagedExecution(pool, runId) {
  const [runRows] = await pool.query("SELECT * FROM workflow_runs WHERE run_id = ? LIMIT 2", [runId]);
  if (runRows.length !== 1) throw routeError(404, "managed_execution_run_not_found", "Managed execution run not found.");
  const [bindingRows] = await pool.query("SELECT * FROM managed_execution_bindings WHERE run_id = ? LIMIT 2", [runId]);
  if (bindingRows.length !== 1) throw routeError(409, "managed_execution_binding_missing", "Managed execution binding is missing or ambiguous.");
  const [steps] = await pool.query(
    "SELECT step_run_id, step_key, step_type, status, attempt, started_at, completed_at FROM step_runs WHERE run_id = ? ORDER BY id",
    [runId],
  );
  const [holds] = await pool.query(
    "SELECT hold_id, hold_type, required_role, status, assigned_to, expires_at, decided_at FROM approval_holds WHERE run_id = ? ORDER BY id",
    [runId],
  );
  const run = runRows[0];
  const binding = bindingRows[0];
  for (const field of ["input_json", "output_json", "error_json", "execution_context_json"]) {
    if (run[field]) try { run[field] = JSON.parse(run[field]); } catch {}
  }
  if (binding.authority_snapshot_json) try { binding.authority_snapshot_json = JSON.parse(binding.authority_snapshot_json); } catch {}
  return {
    run,
    binding,
    steps,
    holds,
    projection: projectManagedExecutionState({ run, binding, steps, holds }),
  };
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
      const result = await readManagedExecution(getPool(), req.params.id);
      return res.status(200).json({ ok: true, ...result, secrets_included: false });
    } catch (error) {
      return routeFailure(res, error, "managed_execution_read_failed");
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
