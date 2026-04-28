import { Router } from "express";

export function buildGovernanceRoutes(deps) {
  const {
    requireBackendApiKey,
    hostingerSshRuntimeRead,
    buildGovernedAdditionReviewResult,
    ensureSiteMigrationRegistrySurfaces,
    ensureSiteMigrationRouteWorkflowRows,
    requireEnv,
    getRegistry,
    getSheetValues
  } = deps;

  const router = Router();

  router.get("/governance/execution-log-latest", requireBackendApiKey, async (_req, res) => {
    try {
      const registry = await getRegistry();
      const spreadsheetId =
        registry?.registry_spreadsheet_id ||
        process.env.REGISTRY_SPREADSHEET_ID ||
        requireEnv("REGISTRY_SPREADSHEET_ID");

      const gid = "1200939177";
      const headerRange = "'Execution Log Unified'!A1:AZ2";
      const tailRange = "'Execution Log Unified'!A:AZ";

      const [headerRows, allRows] = await Promise.all([
        getSheetValues(spreadsheetId, headerRange),
        getSheetValues(spreadsheetId, tailRange)
      ]);

      const headers = Array.isArray(headerRows?.[0]) ? headerRows[0] : [];
      const rows = Array.isArray(allRows) ? allRows : [];

      if (!headers.length || rows.length < 2) {
        return res.status(404).json({
          ok: false,
          error: {
            code: "execution_log_latest_row_not_found",
            message: "Execution Log Unified does not yet contain a readable latest row."
          }
        });
      }

      const latestValues = rows[rows.length - 1] || [];
      const row = {};
      for (let i = 0; i < headers.length; i++) {
        row[headers[i]] = latestValues[i] ?? "";
      }

      return res.status(200).json({
        ok: true,
        surface: "Execution Log Unified",
        gid,
        row_index_1_based: rows.length,
        row
      });
    } catch (err) {
      return res.status(err?.status || 500).json({
        ok: false,
        error: {
          code: err?.code || "execution_log_latest_read_failed",
          message: err?.message || "Failed to read latest Execution Log Unified row."
        }
      });
    }
  });

  router.post("/hostinger/ssh-runtime-read", requireBackendApiKey, async (req, res) => {
    try {
      const result = await hostingerSshRuntimeRead({
        input: req.body || {}
      });

      return res.status(result.ok ? 200 : 404).json(result);
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: {
          code: err.code || "hostinger_ssh_runtime_read_failed",
          message: err.message || "Hostinger SSH runtime read failed."
        }
      });
    }
  });

  router.post("/governed-addition/review", requireBackendApiKey, async (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const result = buildGovernedAdditionReviewResult({
        outcome: body.outcome || "pending_validation",
        addition_state: body.addition_state || "pending_validation",
        route_overlap_detected: body.route_overlap_detected,
        workflow_overlap_detected: body.workflow_overlap_detected,
        chain_needed: body.chain_needed,
        graph_update_required: body.graph_update_required,
        bindings_update_required: body.bindings_update_required,
        policy_update_required: body.policy_update_required,
        starter_update_required: body.starter_update_required,
        reconciliation_required: body.reconciliation_required
      });

      return res.status(200).json({
        ok: true,
        review: result
      });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: {
          code: err.code || "governed_addition_review_failed",
          message: err.message || "Governed addition review failed."
        }
      });
    }
  });

  router.post("/site-migration/bootstrap-registry", requireBackendApiKey, async (_req, res) => {
    try {
      requireEnv("REGISTRY_SPREADSHEET_ID");

      const surfaces = await ensureSiteMigrationRegistrySurfaces();
      const rowResults = await ensureSiteMigrationRouteWorkflowRows();
      const readiness = {
        ok:
          !!rowResults.task_routes_ready &&
          !!rowResults.workflow_registry_ready &&
          String(rowResults.outcome || "").trim() === "reuse_existing",
        ...rowResults
      };

      if (!readiness.ok) {
        return res.status(409).json({
          ok: false,
          degraded: true,
          message: "Validation-only check complete: registry schemas are metadata-governed, but route/workflow readiness remains pending validation or degraded by dependencies.",
          surfaces,
          row_results: rowResults,
          readiness
        });
      }

      return res.status(200).json({
        ok: true,
        message: "Validation-only check complete: site migration registry surfaces and live route/workflow authority are ready.",
        surfaces,
        row_results: rowResults,
        readiness
      });
    } catch (err) {
      if (String(err?.code || "").trim() === "sheet_schema_mismatch") {
        return res.status(409).json({
          ok: false,
          degraded: true,
          blocked: true,
          message: "Validation-only check failed: metadata-governed surface schema mismatch detected.",
          error: {
            code: err?.code || "sheet_schema_mismatch",
            message: err?.message || "Registry bootstrap surface schema validation failed.",
            details: err?.details || {}
          }
        });
      }
      return res.status(err?.status || 500).json({
        ok: false,
        error: {
          code: err?.code || "registry_bootstrap_failed",
          message: err?.message || "Registry bootstrap failed."
        }
      });
    }
  });

  return router;
}
