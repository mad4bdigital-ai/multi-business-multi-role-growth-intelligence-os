import { Router } from "express";
import { getPool } from "../db.js";
import { runReleaseReadiness } from "../releaseReadiness.js";

export function buildReleaseRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  async function handleReadiness(req, res) {
    try {
      const persist  = req.query.persist === "true" || req.query.persist === "1";
      const summary  = req.query.summary === "true" || req.query.summary === "1";

      const report = await runReleaseReadiness({ persist });
      const httpStatus = 200;

      if (summary) {
        return res.status(httpStatus).json({
          ok: report.overall !== "fail",
          overall: report.overall,
          run_id: report.run_id,
          checked_at: report.checked_at,
          summary: report.summary,
        });
      }

      return res.status(httpStatus).json({ ok: report.overall !== "fail", ...report });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: { code: "release_readiness_failed", message: err.message }
      });
    }
  }

  // ── GET /release/readiness ────────────────────────────────────────────────
  // Full platform health check: all tables, seed data, legacy connectivity.
  // ?persist=true writes results to release_readiness_log.
  // ?summary=true returns only the summary (faster for uptime probes).
  router.get("/release/readiness", requireBackendApiKey, handleReadiness);
  router.get("/admin/release/readiness", requireBackendApiKey, handleReadiness);

  // ── GET /release/readiness-history ────────────────────────────────────────
  // Returns the last N readiness runs from release_readiness_log.
  router.get("/release/readiness-history", requireBackendApiKey, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 10, 50);
      const [runs] = await getPool().query(
        `SELECT run_id, MIN(checked_at) AS checked_at,
                SUM(status = 'pass') AS pass_count,
                SUM(status = 'fail') AS fail_count,
                SUM(status = 'warn') AS warn_count
         FROM \`release_readiness_log\`
         GROUP BY run_id
         ORDER BY checked_at DESC
         LIMIT ${limit}`
      );
      return res.status(200).json({ ok: true, runs, count: runs.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "history_read_failed", message: err.message } });
    }
  });

  // ── GET /release/readiness-history/:run_id ────────────────────────────────
  router.get("/release/readiness-history/:run_id", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT check_key, status, detail, checked_at FROM `release_readiness_log` WHERE run_id = ? ORDER BY id",
        [req.params.run_id]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: { code: "run_not_found", message: "Run not found." } });
      const fail_count = rows.filter((r) => r.status === "fail").length;
      const warn_count = rows.filter((r) => r.status === "warn").length;
      return res.status(200).json({
        ok: true,
        run_id: req.params.run_id,
        overall: fail_count > 0 ? "fail" : warn_count > 0 ? "warn" : "pass",
        checks: rows,
        summary: { total: rows.length, pass: rows.length - fail_count - warn_count, warn: warn_count, fail: fail_count },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "run_read_failed", message: err.message } });
    }
  });

  // ── POST /release/entity-classification ──────────────────────────────────
  // Upserts entity classification entries (source of truth mapping per table).
  router.post("/release/entity-classification", requireBackendApiKey, async (req, res) => {
    try {
      const entries = Array.isArray(req.body) ? req.body : [req.body];
      if (!entries.length) return res.status(400).json({ ok: false, error: { code: "empty_body", message: "Provide an array of classification entries." } });

      let written = 0;
      for (const e of entries) {
        const { entity_class, table_name, authority_model = "canonical", read_priority = 1, write_strategy = "platform_primary", migration_status = "not_started", notes } = e;
        if (!entity_class || !table_name) continue;
        await getPool().query(
          `INSERT INTO \`data_migration_inventory\`
             (entity_class, table_name, authority_model, read_priority, write_strategy, migration_status, notes, last_checked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             authority_model = VALUES(authority_model), read_priority = VALUES(read_priority),
             write_strategy = VALUES(write_strategy), migration_status = VALUES(migration_status),
             notes = VALUES(notes), last_checked_at = NOW()`,
          [entity_class, table_name, authority_model, read_priority, write_strategy, migration_status, notes || null]
        );
        written++;
      }

      return res.status(200).json({ ok: true, written, total: entries.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "classification_write_failed", message: err.message } });
    }
  });

  // ── GET /release/entity-classification ───────────────────────────────────
  router.get("/release/entity-classification", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT entity_class, table_name, authority_model, read_priority, write_strategy, migration_status, row_count, notes, last_checked_at FROM `data_migration_inventory` ORDER BY read_priority, entity_class"
      );
      return res.status(200).json({ ok: true, classifications: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "classification_read_failed", message: err.message } });
    }
  });

  return router;
}
