import * as sqlAdapter from "./sqlAdapter.js";
import {
  ACTIONS_REGISTRY_SHEET,
  BRAND_REGISTRY_SHEET,
  ENDPOINT_REGISTRY_SHEET,
  EXECUTION_POLICY_SHEET,
  HOSTING_ACCOUNT_REGISTRY_SHEET,
  PLUGIN_INVENTORY_REGISTRY_SHEET,
  SITE_RUNTIME_INVENTORY_REGISTRY_SHEET,
  SITE_SETTINGS_INVENTORY_REGISTRY_SHEET,
  TASK_ROUTES_SHEET,
  WORKFLOW_REGISTRY_SHEET
} from "./config.js";

const VALID_AUTHORITIES = new Set(["sql", "dual", "sheets"]);

function normalizeAuthority(value = "sql") {
  return String(value || "sql").trim().toLowerCase();
}

function failure(status, code, message, details = {}) {
  return {
    ok: false,
    response: {
      status,
      body: {
        ok: false,
        error: { code, message, details }
      }
    }
  };
}

async function optionalRead(readTable, sheetName) {
  try {
    return await readTable(sheetName);
  } catch {
    return [];
  }
}

export async function loadSqlRuntimeRegistry({
  readTable = sqlAdapter.readTable
} = {}) {
  const [
    brandRows,
    hostingAccounts,
    actionRows,
    endpointRows,
    policies,
    siteRuntimeInventoryRows,
    siteSettingsInventoryRows,
    pluginInventoryRows,
    taskRouteRows,
    workflowRows
  ] = await Promise.all([
    readTable(BRAND_REGISTRY_SHEET),
    readTable(HOSTING_ACCOUNT_REGISTRY_SHEET),
    readTable(ACTIONS_REGISTRY_SHEET),
    readTable(ENDPOINT_REGISTRY_SHEET),
    readTable(EXECUTION_POLICY_SHEET),
    optionalRead(readTable, SITE_RUNTIME_INVENTORY_REGISTRY_SHEET),
    optionalRead(readTable, SITE_SETTINGS_INVENTORY_REGISTRY_SHEET),
    optionalRead(readTable, PLUGIN_INVENTORY_REGISTRY_SHEET),
    optionalRead(readTable, TASK_ROUTES_SHEET),
    optionalRead(readTable, WORKFLOW_REGISTRY_SHEET)
  ]);

  return {
    drive: null,
    brandRows,
    hostingAccounts,
    actionRows,
    endpointRows,
    policies,
    siteRuntimeInventoryRows,
    siteSettingsInventoryRows,
    pluginInventoryRows,
    taskRouteRows,
    workflowRows
  };
}

export async function resolveRuntimeRegistry({
  authority = process.env.DATA_SOURCE || "sql",
  forceRefresh = false,
  registrySpreadsheetId = process.env.REGISTRY_SPREADSHEET_ID || "",
  loadSqlRegistry = loadSqlRuntimeRegistry,
  getSheetsRegistry,
  reloadSheetsRegistry
} = {}) {
  const mode = normalizeAuthority(authority);
  const spreadsheetId = String(registrySpreadsheetId || "").trim();

  if (!VALID_AUTHORITIES.has(mode)) {
    return failure(
      503,
      "invalid_registry_data_source",
      "DATA_SOURCE must be one of: sql, dual, sheets.",
      { data_source: mode || null, allowed_values: [...VALID_AUTHORITIES] }
    );
  }

  if (mode === "sheets") {
    if (!spreadsheetId) {
      return failure(
        503,
        "registry_spreadsheet_id_required",
        "REGISTRY_SPREADSHEET_ID is required for this Sheets-backed registry operation.",
        {
          data_source: "sheets",
          operation_class: "registry_sheet_read"
        }
      );
    }

    const loader = forceRefresh ? reloadSheetsRegistry : getSheetsRegistry;
    if (typeof loader !== "function") {
      return failure(
        503,
        "registry_sheets_loader_unavailable",
        "The Sheets registry loader is unavailable.",
        { data_source: "sheets", force_refresh: forceRefresh }
      );
    }

    try {
      return {
        ok: true,
        registry: await loader(),
        metadata: {
          configured_mode: "sheets",
          runtime_authority: "sheets",
          force_refresh: forceRefresh,
          degraded_dependencies: []
        }
      };
    } catch (error) {
      return failure(
        Number(error?.status) || 503,
        error?.code || "registry_sheets_unavailable",
        error?.message || "Sheets registry loading failed.",
        {
          data_source: "sheets",
          force_refresh: forceRefresh
        }
      );
    }
  }

  try {
    const registry = await loadSqlRegistry({ forceRefresh });
    const degradedDependencies = [];
    if (mode === "dual" && !spreadsheetId) {
      degradedDependencies.push({
        dependency: "registry_spreadsheet",
        role: "mirror_and_governed_recovery",
        code: "registry_spreadsheet_id_not_configured"
      });
    }

    return {
      ok: true,
      registry,
      metadata: {
        configured_mode: mode,
        runtime_authority: "sql",
        sheets_fallback_attempted: false,
        force_refresh: forceRefresh,
        degraded_dependencies: degradedDependencies
      }
    };
  } catch (error) {
    return failure(
      503,
      "registry_sql_unavailable",
      "SQL registry authority is unavailable.",
      {
        data_source: mode,
        runtime_authority: "sql",
        sheets_fallback_attempted: false,
        recovery_requires_explicit_policy: true,
        cause_code: error?.code || null
      }
    );
  }
}
