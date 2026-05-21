import { Router } from "express";
import { getPool } from "../db.js";
import {
  ensurePlatformGraphTables,
  getGraphNeighborhood,
  logGraphQuery,
  projectPlatformKnowledgeGraph,
  resolvePlatformGraphContext,
  validatePlatformKnowledgeGraph,
} from "../services/platformKnowledgeGraphResolver.js";

function bool(value) {
  return value === true || ["true", "1", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function sanitizeInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function buildPlatformGraphRoutes({ requireBackendApiKey, requireAdminPrincipal }) {
  const router = Router();

  const requireAdmin = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.post("/platform/graph/project", ...requireAdmin, async (req, res) => {
    try {
      const result = await projectPlatformKnowledgeGraph({
        projectionKey: req.body?.projection_key || req.body?.projectionKey || "runtime_projection",
        dryRun: bool(req.body?.dry_run || req.body?.dryRun),
      });
      return res.status(200).json({ ...result, secrets_included: false });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "platform_graph_projection_failed", message: err.message }, secrets_included: false });
    }
  });

  router.get("/platform/graph/validate", ...requireAdmin, async (_req, res) => {
    try {
      const result = await validatePlatformKnowledgeGraph();
      return res.status(result.ok ? 200 : 409).json({ ...result, secrets_included: false });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "platform_graph_validation_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/platform/graph/resolve-context", ...requireAdmin, async (req, res) => {
    try {
      await ensurePlatformGraphTables();
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await resolvePlatformGraphContext({
        ...input,
        depth: sanitizeInt(input.depth, 2, 0, 3),
        limit: sanitizeInt(input.limit, 200, 1, 500),
      });
      await logGraphQuery({ queryType: "resolve_context", input, result });
      return res.status(200).json({ ok: true, graph_context: result, secrets_included: false });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "platform_graph_resolve_context_failed", message: err.message }, secrets_included: false });
    }
  });

  router.get("/platform/graph/node/:node_id", ...requireAdmin, async (req, res) => {
    try {
      await ensurePlatformGraphTables();
      const pool = getPool();
      const nodeId = String(req.params.node_id || "").trim();
      const [rows] = await pool.query(`SELECT * FROM platform_graph_nodes WHERE node_id = ? LIMIT 1`, [nodeId]);
      if (!rows.length) return res.status(404).json({ ok: false, error: { code: "graph_node_not_found", message: "Graph node not found." }, secrets_included: false });
      return res.status(200).json({ ok: true, node: rows[0], secrets_included: false });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "platform_graph_node_read_failed", message: err.message }, secrets_included: false });
    }
  });

  router.get("/platform/graph/neighborhood", ...requireAdmin, async (req, res) => {
    try {
      const nodeIds = String(req.query.node_id || req.query.node_ids || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      if (!nodeIds.length) return res.status(400).json({ ok: false, error: { code: "missing_node_id", message: "node_id is required." }, secrets_included: false });
      const result = await getGraphNeighborhood({
        nodeIds,
        depth: sanitizeInt(req.query.depth, 1, 0, 3),
        limit: sanitizeInt(req.query.limit, 200, 1, 500),
      });
      await logGraphQuery({ queryType: "neighborhood", input: { node_ids: nodeIds, depth: req.query.depth, limit: req.query.limit }, result });
      return res.status(200).json({ ok: true, ...result, secrets_included: false });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "platform_graph_neighborhood_failed", message: err.message }, secrets_included: false });
    }
  });

  router.get("/platform/graph/status", ...requireAdmin, async (_req, res) => {
    try {
      await ensurePlatformGraphTables();
      const pool = getPool();
      const [[nodes], [edges], [lastProjection], [lastValidation]] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS total, SUM(lifecycle_status='active') AS active FROM platform_graph_nodes`),
        pool.query(`SELECT COUNT(*) AS total, SUM(lifecycle_status='active') AS active, SUM(runtime_enforced=1) AS runtime_enforced FROM platform_graph_edges`),
        pool.query(`SELECT run_id, projection_key, status, result_counts_json, completed_at FROM platform_graph_projection_runs ORDER BY started_at DESC LIMIT 1`),
        pool.query(`SELECT run_id, validation_key, status, checked_nodes, checked_edges, failure_count, warning_count, completed_at FROM platform_graph_validation_runs ORDER BY started_at DESC LIMIT 1`),
      ]);
      return res.status(200).json({
        ok: true,
        nodes: nodes[0] || { total: 0, active: 0 },
        edges: edges[0] || { total: 0, active: 0, runtime_enforced: 0 },
        last_projection: lastProjection[0] || null,
        last_validation: lastValidation[0] || null,
        secrets_included: false,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "platform_graph_status_failed", message: err.message }, secrets_included: false });
    }
  });

  return router;
}
