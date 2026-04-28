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

  function normalizeSheetRows(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.values)) return value.values;
    if (Array.isArray(value?.data?.values)) return value.data.values;
    return [];
  }

  function buildRowObject(headers = [], values = []) {
    const row = {};
    for (let i = 0; i < headers.length; i += 1) {
      row[headers[i]] = values[i] ?? "";
    }
    return row;
  }

  function rowHasAnyValue(values = []) {
    return Array.isArray(values) && values.some((cell) => String(cell ?? "").trim().length > 0);
  }

  function quoteSheetName(sheetName = "") {
    const normalized = String(sheetName || "").trim();
    const escaped = normalized.replace(/'/g, "''");
    return `'${escaped}'`;
  }

  function buildExecutionLogRangeCandidates(sheetName = "", cells = "A1:AZ1") {
    const normalized = String(sheetName || "").trim();
    const quoted = quoteSheetName(normalized);
    return [
      `${quoted}!${cells}`,
      `${normalized}!${cells}`
    ].filter(Boolean);
  }

  async function getSheetValuesByCandidateRanges(spreadsheetId, candidateRanges = []) {
    let lastError = null;
    for (const range of candidateRanges) {
      try {
        const result = await getSheetValues(spreadsheetId, range);
        return { result, range };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("All candidate ranges failed.");
  }

  function resolveExecutionLogSpreadsheetId(registry = {}) {
    return (
      process.env.EXECUTION_LOG_UNIFIED_SPREADSHEET_ID ||
      registry?.execution_log_unified_spreadsheet_id ||
      registry?.registry_spreadsheet_id ||
      process.env.REGISTRY_SPREADSHEET_ID ||
      requireEnv("REGISTRY_SPREADSHEET_ID")
    );
  }

  function resolveExecutionLogSheetName(registry = {}) {
    return (
      process.env.EXECUTION_LOG_UNIFIED_SHEET_NAME ||
      registry?.execution_log_unified_sheet_name ||
      "Execution Log Unified"
    );
  }

  router.get("/governance/execution-log-latest", requireBackendApiKey, async (_req, res) => {
    try {
      const registry = await getRegistry();
      const spreadsheetId = resolveExecutionLogSpreadsheetId(registry);
      const sheetName = resolveExecutionLogSheetName(registry);

      const gid = "1200939177";
      const headerRangeCandidates = buildExecutionLogRangeCandidates(sheetName, "A1:AZ1");
      const tailRangeCandidates = buildExecutionLogRangeCandidates(sheetName, "A2:AZ200");

      const [headerRead, tailRead] = await Promise.all([
        getSheetValuesByCandidateRanges(spreadsheetId, headerRangeCandidates),
        getSheetValuesByCandidateRanges(spreadsheetId, tailRangeCandidates)
      ]);

      const headerRowsRaw = headerRead.result;
      const tailRowsRaw = tailRead.result;

      const headerRows = normalizeSheetRows(headerRowsRaw);
      const tailRows = normalizeSheetRows(tailRowsRaw);
      const headers = Array.isArray(headerRows?.[0]) ? headerRows[0] : [];

      if (!headers.length) {
        return res.status(404).json({
          ok: false,
          error: {
            code: "execution_log_headers_not_found",
            message: "Execution Log Unified headers are not readable."
          }
        });
      }

      const nonEmptyTailRows = tailRows.filter((values) => rowHasAnyValue(values));
      const latestValues = nonEmptyTailRows.length
        ? nonEmptyTailRows[nonEmptyTailRows.length - 1]
        : null;

      if (!latestValues) {
        return res.status(404).json({
          ok: false,
          error: {
            code: "execution_log_latest_row_not_found",
            message: "Execution Log Unified does not yet contain a readable latest row in the bounded tail window."
          }
        });
      }

      const row = buildRowObject(headers, latestValues);

      return res.status(200).json({
        ok: true,
        surface: "Execution Log Unified",
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        header_range_used: headerRead.range,
        tail_range_used: tailRead.range,
        gid,
        bounded_tail_window: "A2:AZ200",
        row_index_1_based: null,
        row
      });
    } catch (err) {
      return res.status(err?.status || 500).json({
        ok: false,
        error: {
          code: err?.code || "execution_log_latest_read_failed",
          message: err?.message || "Failed to read latest Execution Log Unified row.",
          details: {
            execution_log_unified_spreadsheet_id:
              process.env.EXECUTION_LOG_UNIFIED_SPREADSHEET_ID || null,
            execution_log_unified_sheet_name:
              process.env.EXECUTION_LOG_UNIFIED_SHEET_NAME || null,
            registry_spreadsheet_id:
              process.env.REGISTRY_SPREADSHEET_ID || null
          }
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
