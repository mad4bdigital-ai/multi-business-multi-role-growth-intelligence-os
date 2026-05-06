import { Router } from "express";
import { getPool } from "../db.js";
import { routeOutput } from "../outputSinkRouter.js";
import { dispatchChainEvent, dispatchPendingChainEvents } from "../chainEventDispatcher.js";

export function buildOutputSinkRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();
  router.use(requireBackendApiKey);

  // ── GET /output-artifacts — list artifacts for a tenant ───────────────────
  router.get("/output-artifacts", async (req, res) => {
    try {
      const { tenant_id, agent_id, artifact_type, brand_key, limit = 50 } = req.query;
      if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

      let sql = "SELECT * FROM `output_artifacts` WHERE tenant_id = ?";
      const params = [tenant_id];
      if (agent_id)      { sql += " AND agent_id = ?";      params.push(agent_id); }
      if (artifact_type) { sql += " AND artifact_type = ?"; params.push(artifact_type); }
      if (brand_key)     { sql += " AND brand_key = ?";     params.push(brand_key); }
      sql += " ORDER BY created_at DESC LIMIT ?";
      params.push(Number(limit));

      const [rows] = await getPool().query(sql, params);
      res.json({ artifacts: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /output-artifacts/:id — single artifact ───────────────────────────
  router.get("/output-artifacts/:id", async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT * FROM `output_artifacts` WHERE artifact_id = ? LIMIT 1", [req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: "artifact_not_found" });
      res.json({ artifact: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /agent-chain-events — pending chain events for a tenant ───────────
  router.get("/agent-chain-events", async (req, res) => {
    try {
      const { tenant_id, status = "pending", source_agent_id } = req.query;
      if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

      let sql = `SELECT e.*, a.name AS target_agent_name
                 FROM \`agent_chain_events\` e
                 LEFT JOIN \`agents\` a ON a.agent_id = e.target_agent_id
                 WHERE e.tenant_id = ? AND e.status = ?`;
      const params = [tenant_id, status];
      if (source_agent_id) { sql += " AND e.source_agent_id = ?"; params.push(source_agent_id); }
      sql += " ORDER BY e.created_at DESC LIMIT 100";

      const [rows] = await getPool().query(sql, params);
      res.json({ events: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /agent-chain-events/dispatch-pending — batch sweep ───────────────
  // Must be before /:id/dispatch so Express doesn't match "dispatch-pending" as an :id.
  // Picks up all pending chain events (up to limit) and dispatches them in order.
  // Safe to call from a cron/job runner — each event is atomically claimed before dispatch.
  router.post("/agent-chain-events/dispatch-pending", async (req, res) => {
    try {
      const { tenant_id, limit = 20 } = req.body || {};
      const result = await dispatchPendingChainEvents({ tenant_id, limit });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /agent-chain-events/:id/dispatch — execute a single chain event ──
  // Atomically claims the event, creates a child execution_plan, and dispatches it.
  router.post("/agent-chain-events/:id/dispatch", async (req, res) => {
    try {
      const result = await dispatchChainEvent(req.params.id);
      if (result.error && !result.skipped) {
        return res.status(result.error === "event_not_found" ? 404 : 422).json(result);
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /sink-dispatch-log — router observability for a run ──────────────
  router.get("/sink-dispatch-log", async (req, res) => {
    try {
      const { run_id, tenant_id, status } = req.query;
      if (!run_id && !tenant_id) return res.status(400).json({ error: "run_id or tenant_id required" });

      let sql = "SELECT * FROM `sink_dispatch_log` WHERE 1=1";
      const params = [];
      if (run_id)    { sql += " AND run_id = ?";    params.push(run_id); }
      if (tenant_id) { sql += " AND tenant_id = ?"; params.push(tenant_id); }
      if (status)    { sql += " AND status = ?";    params.push(status); }
      sql += " ORDER BY created_at DESC LIMIT 200";

      const [rows] = await getPool().query(sql, params);
      res.json({ log: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /output-sink/replay — re-route a completed run's output ─────────
  // Useful when a sink failed and needs to be retried without re-running the agent.
  router.post("/output-sink/replay", async (req, res) => {
    try {
      const { run_id } = req.body;
      if (!run_id) return res.status(400).json({ error: "run_id required" });

      const [runs] = await getPool().query(
        `SELECT wr.*, ep.agent_id AS plan_agent_id, ep.brand_key
         FROM \`workflow_runs\` wr
         LEFT JOIN \`execution_plans\` ep ON ep.plan_id = wr.plan_id
         WHERE wr.run_id = ? LIMIT 1`,
        [run_id]
      );
      const run = runs[0];
      if (!run) return res.status(404).json({ error: "run_not_found" });
      if (run.status !== "completed")
        return res.status(409).json({ error: "run_not_completed", status: run.status });

      let output = run.output_json;
      try { output = JSON.parse(output); } catch {}

      const result = await routeOutput({
        run_id,
        agent_id:     run.agent_id || run.plan_agent_id || null,
        tenant_id:    run.tenant_id,
        brand_key:    run.brand_key || null,
        workflow_key: run.workflow_key,
        output,
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
