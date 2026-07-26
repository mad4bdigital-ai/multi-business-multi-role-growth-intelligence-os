import { Router } from "express";
import { getPool } from "../db.js";
import {
  redactWorkflowRuntimeBinding,
  runN8nWorkflowRuntime,
  upsertWorkflowRuntimeBinding,
} from "../n8nWorkflowRuntime.js";

function intLimit(value, fallback = 50, max = 200) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

export function buildN8nWorkflowRuntimeRoutes({ requireBackendApiKey, requireAdminPrincipal }) {
  const router = Router();
  const requireAdmin = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.get("/workflow-runtime/bindings", ...requireAdmin, async (req, res) => {
    try {
      const params = [];
      const where = ["1=1"];
      if (req.query.status) { where.push("status = ?"); params.push(String(req.query.status)); }
      if (req.query.workflow_key) { where.push("workflow_key = ?"); params.push(String(req.query.workflow_key)); }
      if (req.query.task_class) { where.push("task_class = ?"); params.push(String(req.query.task_class)); }
      if (req.query.runtime_type) { where.push("runtime_type = ?"); params.push(String(req.query.runtime_type)); }
      params.push(intLimit(req.query.limit));
      const [rows] = await getPool().query(
        `SELECT * FROM \`workflow_runtime_bindings\`
         WHERE ${where.join(" AND ")}
         ORDER BY updated_at DESC
         LIMIT ?`,
        params
      );
      return res.json({ ok: true, bindings: rows.map(redactWorkflowRuntimeBinding), count: rows.length, secrets_included: false });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workflow_runtime_bindings_list_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/workflow-runtime/bindings", ...requireAdmin, async (req, res) => {
    try {
      const result = await upsertWorkflowRuntimeBinding({ binding: req.body || {} });
      return res.status(200).json({ ...result, secrets_included: false });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workflow_runtime_binding_upsert_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/workflow-runtime/run", ...requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const result = await runN8nWorkflowRuntime({
        binding_key: body.binding_key || null,
        workflow_key: body.workflow_key || null,
        tenant_id: body.tenant_id || null,
        user_id: body.user_id || null,
        input: body.input || body.input_json || {},
      });
      const status = result.ok ? 200 : (result.error?.code === "n8n_workflow_runtime_failed" ? 502 : 500);
      return res.status(status).json(result);
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workflow_runtime_run_failed", message: err.message }, secrets_included: false });
    }
  });

  return router;
}
