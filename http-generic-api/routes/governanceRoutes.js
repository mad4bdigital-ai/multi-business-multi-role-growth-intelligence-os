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
    assertSheetExistsInSpreadsheet,
    readLiveSheetShape,
    fetchChunkedTable,
    getGoogleClientsForSpreadsheet
  } = deps;

  const router = Router();
  const EXECUTION_LOG_TAIL_WINDOW_ROWS = 200;

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

  async function getSheetRowCount(sheets, spreadsheetId, sheetName) {
    const response = await sheets.spreadsheets.get({
      spreadsheetId: String(spreadsheetId || "").trim(),
      fields: "sheets.properties(title,gridProperties.rowCount)"
    });

    const allSheets = Array.isArray(response?.data?.sheets) ? response.data.sheets : [];
    const target = allSheets.find(
      (sheet) => String(sheet?.properties?.title || "").trim() === String(sheetName || "").trim()
    );

    if (!target) {
      const err = new Error(`Execution Log sheet not found while resolving row count: ${sheetName}`);
      err.code = "sheet_not_found";
      err.status = 500;
      err.available_sheets = allSheets
        .map((sheet) => String(sheet?.properties?.title || "").trim())
        .filter(Boolean);
      throw err;
    }

    const rowCount = Number(target?.properties?.gridProperties?.rowCount || 0);
    return Number.isFinite(rowCount) && rowCount > 0 ? rowCount : 0;
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
      const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);

      const gid = "1200939177";
      await assertSheetExistsInSpreadsheet(spreadsheetId, sheetName);

      const rowCount = await getSheetRowCount(sheets, spreadsheetId, sheetName);

      const shape = await readLiveSheetShape(
        spreadsheetId,
        sheetName,
        `'${sheetName.replace(/'/g, "''")}'!A1:AZ2`
      );

      const headers = Array.isArray(shape?.header) ? shape.header : [];

      if (!headers.length) {
        return res.status(404).json({
          ok: false,
          error: {
            code: "execution_log_headers_not_found",
            message: "Execution Log Unified headers are not readable."
          }
        });
      }

      const dataStartRow = Math.max(2, rowCount - EXECUTION_LOG_TAIL_WINDOW_ROWS + 1);
      const dataEndRow = Math.max(2, rowCount);

      const tableRows = await fetchChunkedTable(
        sheets,
        {
          spreadsheetId,
          sheetName,
          columnStart: "A",
          columnEnd: "AZ",
          headerRow: 1,
          dataStartRow,
          dataEndRow,
          chunkRowCount: 50,
          maxChunkReads: 4,
          maxChunkReadsPerCycle: 4,
          stopAfterEmptyChunk: false
        }
      );

      const dataRows = Array.isArray(tableRows) ? tableRows.slice(1) : [];
      const nonEmptyTailRows = dataRows.filter((values) => rowHasAnyValue(values));
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
        gid,
        bounded_tail_window: `${dataStartRow}:AZ${dataEndRow} via fetchChunkedTable`,
        resolved_sheet_row_count: rowCount,
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

  router.get("/governance/execution-log-latest-inspect", requireBackendApiKey, async (_req, res) => {
    try {
      const registry = await getRegistry();
      const spreadsheetId = resolveExecutionLogSpreadsheetId(registry);
      const sheetName = resolveExecutionLogSheetName(registry);
      const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);

      let availableSheets = [];
      let sheetExists = false;
      let shape = null;
      let sampleRows = [];
      let resolvedSheetRowCount = 0;
      let tailWindow = null;
      let error = null;

      try {
        availableSheets = await assertSheetExistsInSpreadsheet(spreadsheetId, sheetName);
        sheetExists = true;
        resolvedSheetRowCount = await getSheetRowCount(sheets, spreadsheetId, sheetName);
        shape = await readLiveSheetShape(
          spreadsheetId,
          sheetName,
          `'${sheetName.replace(/'/g, "''")}'!A1:AZ2`
        );

        const dataStartRow = Math.max(2, resolvedSheetRowCount - EXECUTION_LOG_TAIL_WINDOW_ROWS + 1);
        const dataEndRow = Math.max(2, resolvedSheetRowCount);
        tailWindow = {
          data_start_row: dataStartRow,
          data_end_row: dataEndRow,
          max_rows: EXECUTION_LOG_TAIL_WINDOW_ROWS
        };

        sampleRows = await fetchChunkedTable(
          sheets,
          {
            spreadsheetId,
            sheetName,
            columnStart: "A",
            columnEnd: "AZ",
            headerRow: 1,
            dataStartRow,
            dataEndRow,
            chunkRowCount: 50,
            maxChunkReads: 1,
            maxChunkReadsPerCycle: 1,
            stopAfterEmptyChunk: false
          }
        );
      } catch (err) {
        error = {
          code: err?.code || null,
          status: err?.status || null,
          message: err?.message || String(err),
          available_sheets: err?.available_sheets || availableSheets
        };
      }

      return res.status(200).json({
        ok: true,
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        sheet_exists: sheetExists,
        available_sheets: availableSheets,
        resolved_sheet_row_count: resolvedSheetRowCount,
        tail_window: tailWindow,
        shape,
        sample_row_count: Array.isArray(sampleRows) ? sampleRows.length : 0,
        first_two_rows: Array.isArray(sampleRows) ? sampleRows.slice(0, 2) : [],
        last_two_rows: Array.isArray(sampleRows) ? sampleRows.slice(-2) : [],
        error
      });
    } catch (err) {
      return res.status(err?.status || 500).json({
        ok: false,
        error: {
          code: err?.code || "execution_log_latest_inspect_failed",
          message: err?.message || "Failed to inspect execution-log sheet reads."
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
