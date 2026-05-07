import { Router } from "express";
import { getPool } from "../db.js";
import { runImport, runRepoImport, runRollback } from "../schemaImportPipeline.js";
import { requireAdminPrincipal } from "./adminCliRoutes.js";

export function buildSchemaImportRoutes(deps) {
  const router = Router();
  const { requireBackendApiKey } = deps;

  // POST /admin/schema-import/upload
  // Body: { schema_yaml: string, action_key?: string, filename?: string }
  router.post("/admin/schema-import/upload", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    const { schema_yaml, schema_json: schemaJsonStr, action_key, filename } = req.body || {};
    const raw = schema_yaml || schemaJsonStr;
    if (!raw || typeof raw !== "string" || !raw.trim()) {
      return res.status(400).json({
        ok: false,
        error: { code: "missing_schema", message: "Provide schema_yaml (or schema_json) as a non-empty string in the request body" },
      });
    }
    try {
      const result = await runImport({
        raw,
        sourceType: "upload",
        sourceFilename: filename || null,
        actionKeyOverride: action_key || null,
        importedBy: req.body.imported_by || null,
      });
      return res.status(200).json(result);
    } catch (err) {
      return res.status(422).json({ ok: false, error: { code: "import_failed", message: err.message } });
    }
  });

  // POST /admin/schema-import/repo
  // Body: { repo_url: string, path_in_repo?: string, ref?: string, action_key?: string }
  router.post("/admin/schema-import/repo", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    const { repo_url, path_in_repo, ref, action_key, imported_by } = req.body || {};
    if (!repo_url || typeof repo_url !== "string") {
      return res.status(400).json({
        ok: false,
        error: { code: "missing_repo_url", message: "repo_url is required — provide a GitHub/GitLab repo URL or a direct raw schema URL" },
      });
    }
    try {
      const result = await runRepoImport({
        repoUrl: repo_url,
        pathInRepo: path_in_repo || null,
        ref: ref || null,
        actionKeyOverride: action_key || null,
        importedBy: imported_by || null,
      });
      return res.status(200).json(result);
    } catch (err) {
      return res.status(422).json({ ok: false, error: { code: "import_failed", message: err.message } });
    }
  });

  // POST /admin/schema-import/rollback
  // Body: { action_key: string, job_id: string }
  router.post("/admin/schema-import/rollback", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    const { action_key, job_id, requested_by } = req.body || {};
    if (!action_key || !job_id) {
      return res.status(400).json({
        ok: false,
        error: { code: "missing_fields", message: "action_key and job_id are required" },
      });
    }
    try {
      const result = await runRollback({ actionKey: action_key, jobId: job_id, requestedBy: requested_by || null });
      return res.status(200).json(result);
    } catch (err) {
      return res.status(422).json({ ok: false, error: { code: "rollback_failed", message: err.message } });
    }
  });

  // GET /admin/schema-import/jobs?action_key=&limit=&offset=
  router.get("/admin/schema-import/jobs", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    const { action_key, limit = "20", offset = "0" } = req.query;
    const pool = getPool();
    try {
      const where = action_key ? "WHERE action_key = ?" : "";
      const params = action_key
        ? [action_key, Number(limit), Number(offset)]
        : [Number(limit), Number(offset)];
      const [rows] = await pool.query(
        `SELECT job_id, action_key, source_type, source_url, source_ref, source_filename,
                endpoints_upserted, endpoints_deprecated, warnings, status, error_message,
                imported_by, imported_at
         FROM \`schema_import_jobs\` ${where}
         ORDER BY imported_at DESC LIMIT ? OFFSET ?`,
        params
      );
      return res.status(200).json({ ok: true, count: rows.length, jobs: rows });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "db_error", message: err.message } });
    }
  });

  // GET /admin/schema-import/jobs/:job_id
  router.get("/admin/schema-import/jobs/:job_id", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    const pool = getPool();
    try {
      const [rows] = await pool.query(
        `SELECT job_id, action_key, source_type, source_url, source_ref, source_filename,
                endpoints_upserted, endpoints_deprecated, warnings, endpoint_snapshots,
                status, error_message, imported_by, imported_at
         FROM \`schema_import_jobs\` WHERE job_id = ? LIMIT 1`,
        [req.params.job_id]
      );
      if (!rows[0]) {
        return res.status(404).json({ ok: false, error: { code: "not_found", message: "Import job not found" } });
      }
      return res.status(200).json({ ok: true, job: rows[0] });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "db_error", message: err.message } });
    }
  });

  return router;
}
