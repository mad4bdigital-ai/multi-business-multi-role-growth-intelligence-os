// Auto-extracted from server.js — do not edit manually, use domain logic here.
import { google } from "googleapis";
import {
  REGISTRY_SPREADSHEET_ID, ACTIVITY_SPREADSHEET_ID, BRAND_REGISTRY_SHEET,
  ACTIONS_REGISTRY_SHEET, ENDPOINT_REGISTRY_SHEET, EXECUTION_POLICY_SHEET,
  HOSTING_ACCOUNT_REGISTRY_SHEET, SITE_RUNTIME_INVENTORY_REGISTRY_SHEET,
  SITE_SETTINGS_INVENTORY_REGISTRY_SHEET, PLUGIN_INVENTORY_REGISTRY_SHEET,
  TASK_ROUTES_SHEET, WORKFLOW_REGISTRY_SHEET, REGISTRY_SURFACES_CATALOG_SHEET,
  VALIDATION_REPAIR_REGISTRY_SHEET, EXECUTION_LOG_UNIFIED_SHEET,
  JSON_ASSET_REGISTRY_SHEET, BRAND_CORE_REGISTRY_SHEET,
  EXECUTION_LOG_UNIFIED_SPREADSHEET_ID, JSON_ASSET_REGISTRY_SPREADSHEET_ID,
  OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID, RAW_BODY_MAX_BYTES, MAX_TIMEOUT_SECONDS,
  SERVICE_VERSION, GITHUB_API_BASE_URL, GITHUB_TOKEN, GITHUB_BLOB_CHUNK_MAX_LENGTH,
  DEFAULT_JOB_MAX_ATTEMPTS, JOB_WEBHOOK_TIMEOUT_MS, JOB_RETRY_DELAYS_MS
} from "./config.js";
import { readTableDirect as sqlReadTableDirect } from "./sqlAdapter.js";

const DATA_SOURCE = "sql";

export function toValuesApiRange(sheetName, a1Tail) {
  return `${String(sheetName || "").trim()}!${a1Tail}`;
}

export async function assertGovernedSinkSheetsExist() {
  const executionLogTitles = await assertSheetExistsInSpreadsheet(
    EXECUTION_LOG_UNIFIED_SPREADSHEET_ID,
    EXECUTION_LOG_UNIFIED_SHEET
  );

  const jsonAssetTitles = await assertSheetExistsInSpreadsheet(
    JSON_ASSET_REGISTRY_SPREADSHEET_ID,
    JSON_ASSET_REGISTRY_SHEET
  );

  return {
    executionLogTitles,
    jsonAssetTitles
  };
}

export async function getRegistrySurfaceCatalogRowBySurfaceId(surfaceId = "") {
  const normalizedSurfaceId = String(surfaceId || "").trim();
  if (!normalizedSurfaceId) return null;

  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(REGISTRY_SPREADSHEET_ID || "").trim(),
    range: toValuesApiRange(REGISTRY_SURFACES_CATALOG_SHEET, "A:AG")
  });

  const values = response.data.values || [];
  if (values.length < 2) return null;

  const header = values[0].map(v => String(v || "").trim());
  const map = headerMap(header, REGISTRY_SURFACES_CATALOG_SHEET);

  for (const row of values.slice(1)) {
    const rowSurfaceId = String(getCell(row, map, "surface_id") || "").trim();
    if (rowSurfaceId !== normalizedSurfaceId) continue;

    return {
      surface_id: rowSurfaceId,
      surface_name: String(getCell(row, map, "surface_name") || "").trim(),
      worksheet_name: String(getCell(row, map, "worksheet_name") || "").trim(),
      worksheet_gid: String(getCell(row, map, "worksheet_gid") || "").trim(),
      active_status: String(getCell(row, map, "active_status") || "").trim(),
      authority_status: String(getCell(row, map, "authority_status") || "").trim(),
      required_for_execution: String(getCell(row, map, "required_for_execution") || "").trim(),
      schema_ref: String(getCell(row, map, "schema_ref") || "").trim(),
      schema_version: String(getCell(row, map, "schema_version") || "").trim(),
      header_signature: String(getCell(row, map, "header_signature") || "").trim(),
      expected_column_count: String(getCell(row, map, "expected_column_count") || "").trim(),
      binding_mode: String(getCell(row, map, "binding_mode") || "").trim(),
      sheet_role: String(getCell(row, map, "sheet_role") || "").trim(),
      audit_mode: String(getCell(row, map, "audit_mode") || "").trim(),
      legacy_surface_containment_required: String(
        getCell(row, map, "legacy_surface_containment_required") || ""
      ).trim(),
      repair_candidate_types: String(getCell(row, map, "repair_candidate_types") || "").trim(),
      repair_priority: String(getCell(row, map, "repair_priority") || "").trim()
    };
  }

  return null;
}

export function buildExpectedHeaderSignatureFromCanonical(columns = []) {
  return (columns || []).map(v => String(v || "").trim()).join("|");
}

export function normalizeExpectedColumnCount(value, fallbackColumns = []) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return n;
  return Array.isArray(fallbackColumns) ? fallbackColumns.length : 0;
}

export async function getCanonicalSurfaceMetadata(surfaceId = "", fallback = {}) {
  const row = await getRegistrySurfaceCatalogRowBySurfaceId(surfaceId);

  if (!row) {
    return {
      source: "fallback_constant",
      surface_id: surfaceId,
      schema_ref: fallback.schema_ref || "",
      schema_version: fallback.schema_version || "",
      header_signature: buildExpectedHeaderSignatureFromCanonical(fallback.columns || []),
      expected_column_count: Array.isArray(fallback.columns) ? fallback.columns.length : 0,
      binding_mode: fallback.binding_mode || "constant_fallback",
      sheet_role: fallback.sheet_role || "",
      audit_mode: fallback.audit_mode || ""
    };
  }

  return {
    source: "registry_surface_catalog",
    surface_id: row.surface_id,
    schema_ref: row.schema_ref,
    schema_version: row.schema_version,
    header_signature:
      row.header_signature || buildExpectedHeaderSignatureFromCanonical(fallback.columns || []),
    expected_column_count: normalizeExpectedColumnCount(
      row.expected_column_count,
      fallback.columns || []
    ),
    binding_mode: row.binding_mode || fallback.binding_mode || "",
    sheet_role: row.sheet_role || fallback.sheet_role || "",
    audit_mode: row.audit_mode || fallback.audit_mode || "",
    authority_status: row.authority_status || "",
    active_status: row.active_status || "",
    required_for_execution: row.required_for_execution || "",
    legacy_surface_containment_required: row.legacy_surface_containment_required || ""
  };
}

export async function loadBrandRegistry(sheets) {
  if (DATA_SOURCE !== "sheets") {
    const rows = await sqlReadTableDirect("Brand Registry");
    return rows.map(r => ({
      brand_name: r.brand_name || "",
      normalized_brand_name: r.normalized_brand_name || "",
      brand_domain: r.brand_domain || "",
      target_key: r.target_key || "",
      site_aliases_json: r.site_aliases_json || "",
      base_url: r.base_url || "",
      transport_action_key: r.transport_action_key || "",
      auth_type: r.auth_type || "",
      credential_resolution: r.credential_resolution || "",
      username: r.username || "",
      application_password: r.application_password || "",
      default_headers_json: r.default_headers_json || "",
      write_allowed: r.write_allowed || "",
      destructive_allowed: r.destructive_allowed || "",
      transport_enabled: r.transport_enabled || "",
      target_resolution_mode: r.target_resolution_mode || "",
      hosting_provider: r.hosting_provider || "",
      hosting_account_key: r.hosting_account_key || "",
      hostinger_api_target_key: r.hostinger_api_target_key || "",
      server_environment_label: r.server_environment_label || "",
      server_environment_type: r.server_environment_type || "",
      server_region_or_datacenter: r.server_region_or_datacenter || "",
      server_primary_domain: r.server_primary_domain || "",
      server_panel_reference: r.server_panel_reference || "",
      hosting_account_registry_ref: r.hosting_account_registry_ref || ""
    })).filter(r => r.brand_name || r.target_key || r.base_url);
  }
  const values = await fetchRange(sheets, `'${BRAND_REGISTRY_SHEET}'!A1:CX1000`);
  if (!values.length) throw registryError("Brand Registry");
  const headers = values[0];
  const map = headerMap(headers, BRAND_REGISTRY_SHEET);

  return values
    .slice(1)
    .map(row => ({
      brand_name: getCell(row, map, "Brand Name"),
      normalized_brand_name: getCell(row, map, "Normalized Brand Name"),
      brand_domain: getCell(row, map, "brand_domain"),
      target_key: getCell(row, map, "target_key"),
      site_aliases_json: getCell(row, map, "site_aliases_json"),
      base_url: getCell(row, map, "base_url"),
      transport_action_key: getCell(row, map, "transport_action_key"),
      auth_type: getCell(row, map, "auth_type"),
      credential_resolution: getCell(row, map, "credential_resolution"),
      username: getCell(row, map, "username"),
      application_password: getCell(row, map, "application_password"),
      default_headers_json: getCell(row, map, "default_headers_json"),
      write_allowed: getCell(row, map, "write_allowed"),
      destructive_allowed: getCell(row, map, "destructive_allowed"),
      transport_enabled: getCell(row, map, "transport_enabled"),
      target_resolution_mode: getCell(row, map, "target_resolution_mode"),

      // hosting linkage
      hosting_provider: getCell(row, map, "hosting_provider"),
      hosting_account_key: getCell(row, map, "hosting_account_key"),
      hostinger_api_target_key: getCell(row, map, "hostinger_api_target_key"),
      server_environment_label: getCell(row, map, "server_environment_label"),
      server_environment_type: getCell(row, map, "server_environment_type"),
      server_region_or_datacenter: getCell(row, map, "server_region_or_datacenter"),
      server_primary_domain: getCell(row, map, "server_primary_domain"),
      server_panel_reference: getCell(row, map, "server_panel_reference"),
      hosting_account_registry_ref: getCell(row, map, "hosting_account_registry_ref")
    }))
    .filter(r => r.brand_name || r.target_key || r.base_url);
}

export async function loadHostingAccountRegistry(sheets) {
  if (DATA_SOURCE !== "sheets") {
    const rows = await sqlReadTableDirect("Hosting Account Registry");
    return rows.map(r => ({
      hosting_account_key: r.hosting_account_key || "",
      hosting_provider: r.hosting_provider || "",
      account_identifier: r.account_identifier || "",
      api_auth_mode: r.api_auth_mode || "",
      api_key_reference: r.api_key_reference || "",
      api_key_storage_mode: r.api_key_storage_mode || "",
      plan_label: r.plan_label || "",
      plan_type: r.plan_type || "",
      account_scope_notes: r.account_scope_notes || "",
      status: r.status || "",
      last_reviewed_at: r.last_reviewed_at || "",
      brand_sites_json: r.brand_sites_json || "",
      resolver_target_keys_json: r.resolver_target_keys_json || "",
      auth_validation_status: r.auth_validation_status || "",
      endpoint_binding_status: r.endpoint_binding_status || "",
      resolver_execution_ready: r.resolver_execution_ready || "",
      last_runtime_check_at: r.last_runtime_check_at || "",
      ssh_available: r.ssh_available || "",
      wp_cli_available: r.wp_cli_available || "",
      shared_access_enabled: r.shared_access_enabled || "",
      account_mode: r.account_mode || "",
      ssh_host: r.ssh_host || "",
      ssh_port: r.ssh_port || "",
      ssh_username: r.ssh_username || "",
      ssh_auth_mode: r.ssh_auth_mode || "",
      ssh_credential_reference: r.ssh_credential_reference || "",
      ssh_runtime_notes: r.ssh_runtime_notes || "",
      sftp_available: r.sftp_available || ""
    })).filter(r => r.hosting_account_key);
  }
  const values = await fetchRange(
    sheets,
    `'${HOSTING_ACCOUNT_REGISTRY_SHEET}'!A1:AZ1000`
  );
  if (!values.length) throw registryError("Hosting Account Registry");

  const headers = values[0];
  const map = headerMap(headers, HOSTING_ACCOUNT_REGISTRY_SHEET);
  const requiredHostingColumns = HOSTING_ACCOUNT_REGISTRY_COLUMNS;

  for (const col of requiredHostingColumns) {
    if (!Object.prototype.hasOwnProperty.call(map, col)) {
      const err = new Error(
        `Hosting Account Registry missing required column: ${col}`
      );
      err.code = "registry_schema_mismatch";
      err.status = 500;
      throw err;
    }
  }

  return values
    .slice(1)
    .map(row => ({
      hosting_account_key: getCell(row, map, "hosting_account_key"),
      hosting_provider: getCell(row, map, "hosting_provider"),
      account_identifier: getCell(row, map, "account_identifier"),
      api_auth_mode: getCell(row, map, "api_auth_mode"),
      api_key_reference: getCell(row, map, "api_key_reference"),
      api_key_storage_mode: getCell(row, map, "api_key_storage_mode"),
      plan_label: getCell(row, map, "plan_label"),
      plan_type: getCell(row, map, "plan_type"),
      account_scope_notes: getCell(row, map, "account_scope_notes"),
      status: getCell(row, map, "status"),
      last_reviewed_at: getCell(row, map, "last_reviewed_at"),

      brand_sites_json: getCell(row, map, "brand_sites_json"),
      resolver_target_keys_json: getCell(row, map, "resolver_target_keys_json"),
      auth_validation_status: getCell(row, map, "auth_validation_status"),
      endpoint_binding_status: getCell(row, map, "endpoint_binding_status"),
      resolver_execution_ready: getCell(row, map, "resolver_execution_ready"),
      last_runtime_check_at: getCell(row, map, "last_runtime_check_at"),

      // Hostinger SSH runtime details are governed as columns in Hosting Account Registry.
      server_environment_type: getCell(row, map, "server_environment_type"),
      server_panel_reference: getCell(row, map, "server_panel_reference"),
      ssh_available: getCell(row, map, "ssh_available"),
      ssh_enabled: getCell(row, map, "ssh_enabled"),
      ssh_source: getCell(row, map, "ssh_source"),
      ssh_host: getCell(row, map, "ssh_host"),
      ssh_port: getCell(row, map, "ssh_port"),
      ssh_username: getCell(row, map, "ssh_username"),
      ssh_auth_mode: getCell(row, map, "ssh_auth_mode"),
      ssh_credential_reference: getCell(row, map, "ssh_credential_reference"),
      ssh_runtime_notes: getCell(row, map, "ssh_runtime_notes"),
      account_mode: getCell(row, map, "account_mode"),
      shared_access_enabled: getCell(row, map, "shared_access_enabled"),
      sftp_available: getCell(row, map, "sftp_available"),
      wp_cli_available: getCell(row, map, "wp_cli_available"),
      last_validated_at: getCell(row, map, "last_validated_at")
    }))
    .filter(r => r.hosting_account_key);
}

export async function loadActionsRegistry(sheets) {
  if (DATA_SOURCE !== "sheets") {
    const rows = await sqlReadTableDirect("Actions Registry");
    return rows.map(r => ({
      action_key: r.action_key || "",
      status: r.status || "",
      module_binding: r.module_binding || "",
      connector_family: r.connector_family || "",
      api_key_mode: r.api_key_mode || "",
      api_key_param_name: r.api_key_param_name || "",
      api_key_header_name: r.api_key_header_name || "",
      api_key_value: r.api_key_value || "",
      api_key_storage_mode: r.api_key_storage_mode || "",
      secret_store_ref: r.secret_store_ref || "",
      openai_schema_file_id: r.openai_schema_file_id || "",
      oauth_config_file_id: r.oauth_config_file_id || "",
      oauth_config_file_name: r.oauth_config_file_name || "",
      oauth_config_ref: r.oauth_config_ref || "",
      oauth_client_id_ref: r.oauth_client_id_ref || "",
      oauth_client_secret_ref: r.oauth_client_secret_ref || "",
      oauth_secret_storage_type: r.oauth_secret_storage_type || "",
      oauth_binding_status: r.oauth_binding_status || "",
      runtime_binding_profile: r.runtime_binding_profile || null,
      required_variable_contracts: r.required_variable_contracts || null,
      runtime_capability_class: r.runtime_capability_class || "",
      runtime_callable: r.runtime_callable || "",
      primary_executor: r.primary_executor || "",
      notes: r.notes || ""
    })).filter(r => r.action_key);
  }
  const values = await fetchRange(sheets, `'${ACTIONS_REGISTRY_SHEET}'!A1:AM1000`);
  if (!values.length) throw registryError("Actions Registry");
  const headers = values[0];
  const map = headerMap(headers, ACTIONS_REGISTRY_SHEET);
  return values.slice(1).map(row => ({
    action_key: getCell(row, map, "action_key"),
    status: getCell(row, map, "status"),
    module_binding: getCell(row, map, "module_binding"),
    connector_family: getCell(row, map, "connector_family"),
    api_key_mode: getCell(row, map, "api_key_mode"),
    api_key_param_name: getCell(row, map, "api_key_param_name"),
    api_key_header_name: getCell(row, map, "api_key_header_name"),
    api_key_value: getCell(row, map, "api_key_value"),
    api_key_storage_mode: getCell(row, map, "api_key_storage_mode"),
    secret_store_ref: getCell(row, map, "secret_store_ref"),
    openai_schema_file_id: getCell(row, map, "openai_schema_file_id"),
    oauth_config_file_id: getCell(row, map, "oauth_config_file_id"),
    oauth_config_file_name: getCell(row, map, "oauth_config_file_name"),
    runtime_capability_class: getCell(row, map, "runtime_capability_class"),
    runtime_callable: getCell(row, map, "runtime_callable"),
    primary_executor: getCell(row, map, "primary_executor"),
    notes: getCell(row, map, "notes")
  })).filter(r => r.action_key);
}

export async function loadEndpointRegistry(sheets) {
  if (DATA_SOURCE !== "sheets") {
    const rows = await sqlReadTableDirect("API Actions Endpoint Registry");
    return rows.map(r => ({
      endpoint_id: r.endpoint_id || "",
      parent_action_key: r.parent_action_key || "",
      endpoint_key: r.endpoint_key || "",
      endpoint_operation: r.endpoint_operation || "",
      provider_domain: r.provider_domain || "",
      method: r.method || "",
      endpoint_path_or_function: r.endpoint_path_or_function || "",
      route_target: r.route_target || "",
      openai_action_name: r.openai_action_name || "",
      module_binding: r.module_binding || "",
      connector_family: r.connector_family || "",
      status: r.status || "",
      spec_validation_status: r.spec_validation_status || "",
      auth_validation_status: r.auth_validation_status || "",
      privacy_validation_status: r.privacy_validation_status || "",
      execution_readiness: r.execution_readiness || "",
      endpoint_role: r.endpoint_role || "",
      execution_mode: r.execution_mode || "",
      transport_required: r.transport_required || "",
      fallback_allowed: r.fallback_allowed || "",
      fallback_match_basis: r.fallback_match_basis || "",
      fallback_provider_domain: r.fallback_provider_domain || "",
      fallback_connector_family: r.fallback_connector_family || "",
      fallback_action_name: r.fallback_action_name || "",
      fallback_route_target: r.fallback_route_target || "",
      fallback_notes: r.fallback_notes || "",
      inventory_role: r.inventory_role || "",
      inventory_source: r.inventory_source || "",
      notes: r.notes || "",
      brand_resolution_source: r.brand_resolution_source || "",
      transport_action_key: r.transport_action_key || "",
      child_openai_schema_file_id: r.child_openai_schema_file_id || "",
      schema_json: r.schema_json || null,
      schema_overlay_mode: r.schema_overlay_mode || "",
      schema_overlay_status: r.schema_overlay_status || "",
      schema_overlay_parent_action_key: r.schema_overlay_parent_action_key || "",
      schema_overlay_notes: r.schema_overlay_notes || ""
    })).filter(r => r.endpoint_key);
  }
  const values = await fetchRange(sheets, `'${ENDPOINT_REGISTRY_SHEET}'!A1:BA2000`);
  if (!values.length) throw registryError("API Actions Endpoint Registry");
  const headers = values[0];
  const map = headerMap(headers, ENDPOINT_REGISTRY_SHEET);
  debugLog("ENDPOINT_REGISTRY_HEADERS:", JSON.stringify(headers));
  debugLog("ENDPOINT_REGISTRY_HEADER_MAP_KEYS:", JSON.stringify(Object.keys(map)));
  return values.slice(1).map(row => ({
    endpoint_id: getCell(row, map, "endpoint_id"),
    parent_action_key: getCell(row, map, "parent_action_key"),
    endpoint_key: getCell(row, map, "endpoint_key"),
    endpoint_operation: getCell(row, map, "endpoint_operation"),
    provider_domain: getCell(row, map, "provider_domain"),
    method: getCell(row, map, "method"),
    endpoint_path_or_function: getCell(row, map, "endpoint_path_or_function"),
    route_target: getCell(row, map, "route_target"),
    openai_action_name: getCell(row, map, "openai_action_name"),
    module_binding: getCell(row, map, "module_binding"),
    connector_family: getCell(row, map, "connector_family"),
    status: getCell(row, map, "status"),
    spec_validation_status: getCell(row, map, "spec_validation_status"),
    auth_validation_status: getCell(row, map, "auth_validation_status"),
    privacy_validation_status: getCell(row, map, "privacy_validation_status"),
    execution_readiness: getCell(row, map, "execution_readiness"),
    endpoint_role: getCell(row, map, "endpoint_role"),
    execution_mode: getCell(row, map, "execution_mode"),
    transport_required: getCell(row, map, "transport_required"),
    fallback_allowed: getCell(row, map, "fallback_allowed"),
    fallback_match_basis: getCell(row, map, "fallback_match_basis"),
    fallback_provider_domain: getCell(row, map, "fallback_provider_domain"),
    fallback_connector_family: getCell(row, map, "fallback_connector_family"),
    fallback_action_name: getCell(row, map, "fallback_action_name"),
    fallback_route_target: getCell(row, map, "fallback_route_target"),
    fallback_notes: getCell(row, map, "fallback_notes"),
    inventory_role: getCell(row, map, "inventory_role"),
    inventory_source: getCell(row, map, "inventory_source"),
    notes: getCell(row, map, "notes"),
    brand_resolution_source: getCell(row, map, "brand_resolution_source"),
    transport_action_key: getCell(row, map, "transport_action_key")
  })).filter(r => r.endpoint_key);
}

export async function loadExecutionPolicies(sheets) {
  if (DATA_SOURCE !== "sheets") {
    const rows = await sqlReadTableDirect("Execution Policy Registry");
    return rows.map(r => ({
      policy_group: r.policy_group || "",
      policy_key: r.policy_key || "",
      policy_value: r.policy_value || "",
      active: r.active || "",
      execution_scope: r.execution_scope || "",
      affects_layer: r.affects_layer || "",
      blocking: r.blocking || "",
      notes: r.notes || ""
    })).filter(r => r.policy_key && boolFromSheet(r.active));
  }
  const values = await fetchRange(sheets, `'${EXECUTION_POLICY_SHEET}'!A1:H2000`);
  if (!values.length) throw registryError("Execution Policy Registry");
  const headers = values[0];
  const map = headerMap(headers, EXECUTION_POLICY_SHEET);
  const policies = values.slice(1).map(row => ({
    policy_group: getCell(row, map, "policy_group"),
    policy_key: getCell(row, map, "policy_key"),
    policy_value: getCell(row, map, "policy_value"),
    active: getCell(row, map, "active"),
    execution_scope: getCell(row, map, "execution_scope"),
    affects_layer: getCell(row, map, "affects_layer"),
    blocking: getCell(row, map, "blocking"),
    notes: getCell(row, map, "notes")
  })).filter(r => r.policy_key && boolFromSheet(r.active));
  return policies;
}

export async function readExecutionPolicyRegistryLive() {
  if (DATA_SOURCE !== "sheets") {
    const cols = ["policy_group", "policy_key", "policy_value", "active", "execution_scope", "affects_layer", "blocking", "notes"];
    const sqlRows = await sqlReadTableDirect("Execution Policy Registry");
    const header = cols;
    const rows = sqlRows.map(r => cols.map(c => String(r[c] ?? "")));
    return { header, rows, map: headerMap(header, EXECUTION_POLICY_SHEET) };
  }
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await fetchRange(
    sheets,
    toValuesApiRange(EXECUTION_POLICY_SHEET, "A1:H2000")
  );
  if (!values.length) throw registryError("Execution Policy Registry");

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, EXECUTION_POLICY_SHEET)
  };
}

export function buildExecutionPolicyRow(input = {}) {
  return {
    policy_group: String(input.policy_group || "").trim(),
    policy_key: String(input.policy_key || "").trim(),
    policy_value: String(input.policy_value || "").trim(),
    active:
      input.active === true || String(input.active || "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    execution_scope: String(input.execution_scope || "execution").trim(),
    affects_layer: String(input.affects_layer || "").trim(),
    blocking:
      input.blocking === true || String(input.blocking || "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    notes: String(input.notes || "").trim()
  };
}

export function findExecutionPolicyRowNumber(header = [], rows = [], input = {}) {
  const groupIdx = header.indexOf("policy_group");
  const keyIdx = header.indexOf("policy_key");

  if (groupIdx === -1 || keyIdx === -1) {
    const err = new Error("Execution Policy Registry header missing policy_group or policy_key.");
    err.code = "execution_policy_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedGroup = String(input.policy_group || "").trim();
  const wantedKey = String(input.policy_key || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingGroup = String(row[groupIdx] || "").trim();
    const existingKey = String(row[keyIdx] || "").trim();
    if (existingGroup === wantedGroup && existingKey === wantedKey) {
      return i + 2;
    }
  }

  return null;
}

export async function writeExecutionPolicyRow(input = {}) {
  const live = await readExecutionPolicyRegistryLive();
  const row = buildExecutionPolicyRow(input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: EXECUTION_POLICY_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    scanRangeA1: "A:H"
  });

  return {
    mutationType: "append",
    row,
    preflight: mutationResult.preflight
  };
}

export async function updateExecutionPolicyRow(input = {}) {
  const live = await readExecutionPolicyRegistryLive();
  const row = buildExecutionPolicyRow(input);
  const targetRowNumber = findExecutionPolicyRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: EXECUTION_POLICY_SHEET,
    mutationType: "update",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:H"
  });

  return {
    mutationType: "update",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    row,
    preflight: mutationResult.preflight
  };
}

export async function deleteExecutionPolicyRow(input = {}) {
  const live = await readExecutionPolicyRegistryLive();
  const targetRowNumber = findExecutionPolicyRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: EXECUTION_POLICY_SHEET,
    mutationType: "delete",
    rowObject: buildExecutionPolicyRow(input),
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:H"
  });

  return {
    mutationType: "delete",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    preflight: mutationResult.preflight
  };
}

export async function readTaskRoutesLive() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await fetchRange(
    sheets,
    toValuesApiRange(TASK_ROUTES_SHEET, "A1:AF2000")
  );
  if (!values.length) throw registryError(TASK_ROUTES_SHEET);

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, TASK_ROUTES_SHEET)
  };
}

export function buildTaskRouteRow(input = {}) {
  const row = {};

  for (const col of TASK_ROUTES_CANONICAL_COLUMNS) {
    row[col] = "";
  }

  row["Task Key"] = String(input["Task Key"] ?? input.task_key ?? "").trim();
  row["Trigger Terms"] = String(input["Trigger Terms"] ?? input.trigger_terms ?? "").trim();
  row["Route Modules"] = String(input["Route Modules"] ?? input.route_modules ?? "").trim();
  row["Execution Layer"] = String(input["Execution Layer"] ?? input.execution_layer ?? "").trim();
  row["Priority"] = String(input["Priority"] ?? input.priority_label ?? "").trim();
  row["Enabled"] =
    input["Enabled"] === true || String(input["Enabled"] ?? input.enabled ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["Output Focus"] = String(input["Output Focus"] ?? input.output_focus ?? "").trim();
  row["Notes"] = String(input["Notes"] ?? input.notes ?? "").trim();
  row["Entry Sources"] = String(input["Entry Sources"] ?? input.entry_sources ?? "").trim();
  row["Linked Starter Titles"] = String(input["Linked Starter Titles"] ?? input.linked_starter_titles ?? "").trim();
  row["Active Starter Count"] = String(input["Active Starter Count"] ?? input.active_starter_count ?? "").trim();
  row["Route Key Match Status"] = String(input["Route Key Match Status"] ?? input.route_key_match_status ?? "").trim();

  row["row_id"] = String(input.row_id ?? "").trim();
  row["route_id"] = String(input.route_id ?? "").trim();
  row["active"] =
    input.active === true || String(input.active ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["intent_key"] = String(input.intent_key ?? "").trim();
  row["brand_scope"] = String(input.brand_scope ?? "").trim();
  row["request_type"] = String(input.request_type ?? "").trim();
  row["route_mode"] = String(input.route_mode ?? "").trim();
  row["target_module"] = String(input.target_module ?? "").trim();
  row["workflow_key"] = String(input.workflow_key ?? "").trim();
  row["lifecycle_mode"] = String(input.lifecycle_mode ?? "").trim();
  row["memory_required"] =
    input.memory_required === true || String(input.memory_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["logging_required"] =
    input.logging_required === true || String(input.logging_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["review_required"] =
    input.review_required === true || String(input.review_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["priority"] = String(input.priority ?? "").trim();
  row["allowed_states"] = String(input.allowed_states ?? "").trim();
  row["degraded_action"] = String(input.degraded_action ?? "").trim();
  row["blocked_action"] = String(input.blocked_action ?? "").trim();
  row["match_rule"] = String(input.match_rule ?? "").trim();
  row["route_source"] = String(input.route_source ?? "").trim();
  row["last_validated_at"] = String(input.last_validated_at ?? "").trim();

  return row;
}

export function findTaskRouteRowNumber(header = [], rows = [], input = {}) {
  const routeIdIdx = header.indexOf("route_id");
  const taskKeyIdx = header.indexOf("Task Key");

  if (routeIdIdx === -1 && taskKeyIdx === -1) {
    const err = new Error("Task Routes header missing route_id and Task Key.");
    err.code = "task_routes_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedRouteId = String(input.route_id || "").trim();
  const wantedTaskKey = String(input["Task Key"] ?? input.task_key ?? "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingRouteId = routeIdIdx === -1 ? "" : String(row[routeIdIdx] || "").trim();
    const existingTaskKey = taskKeyIdx === -1 ? "" : String(row[taskKeyIdx] || "").trim();

    if (wantedRouteId && existingRouteId === wantedRouteId) {
      return i + 2;
    }

    if (!wantedRouteId && wantedTaskKey && existingTaskKey === wantedTaskKey) {
      return i + 2;
    }
  }

  return null;
}

export async function writeTaskRouteRow(input = {}) {
  const live = await readTaskRoutesLive();
  const row = buildTaskRouteRow(input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: TASK_ROUTES_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    scanRangeA1: "A:AF"
  });

  return {
    mutationType: "append",
    row,
    preflight: mutationResult.preflight
  };
}

export async function updateTaskRouteRow(input = {}) {
  const live = await readTaskRoutesLive();
  const row = buildTaskRouteRow(input);
  const targetRowNumber = findTaskRouteRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: TASK_ROUTES_SHEET,
    mutationType: "update",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AF"
  });

  return {
    mutationType: "update",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    row,
    preflight: mutationResult.preflight
  };
}

export async function deleteTaskRouteRow(input = {}) {
  const live = await readTaskRoutesLive();
  const targetRowNumber = findTaskRouteRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: TASK_ROUTES_SHEET,
    mutationType: "delete",
    rowObject: buildTaskRouteRow(input),
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AF"
  });

  return {
    mutationType: "delete",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    preflight: mutationResult.preflight
  };
}

export async function readWorkflowRegistryLive() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await fetchRange(
    sheets,
    toValuesApiRange(WORKFLOW_REGISTRY_SHEET, "A1:AL2000")
  );
  if (!values.length) throw registryError(WORKFLOW_REGISTRY_SHEET);

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, WORKFLOW_REGISTRY_SHEET)
  };
}

export function buildWorkflowRegistryRow(input = {}) {
  const row = {};

  for (const col of WORKFLOW_REGISTRY_CANONICAL_COLUMNS) {
    row[col] = "";
  }

  row["Workflow ID"] = String(input["Workflow ID"] ?? input.workflow_id ?? "").trim();
  row["Workflow Name"] = String(input["Workflow Name"] ?? input.workflow_name ?? "").trim();
  row["Module Mode"] = String(input["Module Mode"] ?? input.module_mode ?? "").trim();
  row["Trigger Source"] = String(input["Trigger Source"] ?? input.trigger_source ?? "").trim();
  row["Input Type"] = String(input["Input Type"] ?? input.input_type ?? "").trim();
  row["Primary Objective"] = String(input["Primary Objective"] ?? input.primary_objective ?? "").trim();
  row["Mapped Engine(s)"] = String(input["Mapped Engine(s)"] ?? input.mapped_engines ?? "").trim();
  row["Engine Order"] = String(input["Engine Order"] ?? input.engine_order ?? "").trim();
  row["Workflow Type"] = String(input["Workflow Type"] ?? input.workflow_type ?? "").trim();
  row["Primary Output"] = String(input["Primary Output"] ?? input.primary_output ?? "").trim();
  row["Input Detection Rules"] = String(input["Input Detection Rules"] ?? input.input_detection_rules ?? "").trim();
  row["Output Template"] = String(input["Output Template"] ?? input.output_template ?? "").trim();
  row["Priority"] = String(input["Priority"] ?? input.priority_label ?? "").trim();
  row["Route Key"] = String(input["Route Key"] ?? input.route_key ?? "").trim();
  row["Execution Mode"] = String(input["Execution Mode"] ?? input.execution_mode ?? "").trim();
  row["User Facing"] =
    input["User Facing"] === true || String(input["User Facing"] ?? input.user_facing ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["Parent Layer"] = String(input["Parent Layer"] ?? input.parent_layer ?? "").trim();
  row["Status"] = String(input["Status"] ?? input.status_label ?? "").trim();
  row["Linked Workflows"] = String(input["Linked Workflows"] ?? input.linked_workflows ?? "").trim();
  row["Linked Engines"] = String(input["Linked Engines"] ?? input.linked_engines ?? "").trim();
  row["Notes"] = String(input["Notes"] ?? input.notes ?? "").trim();
  row["Entry Priority Weight"] = String(input["Entry Priority Weight"] ?? input.entry_priority_weight ?? "").trim();
  row["Dependency Type"] = String(input["Dependency Type"] ?? input.dependency_type ?? "").trim();
  row["Output Artifact Type"] = String(input["Output Artifact Type"] ?? input.output_artifact_type ?? "").trim();

  row["workflow_key"] = String(input.workflow_key ?? "").trim();
  row["active"] =
    input.active === true || String(input.active ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["target_module"] = String(input.target_module ?? "").trim();
  row["execution_class"] = String(input.execution_class ?? "").trim();
  row["lifecycle_mode"] = String(input.lifecycle_mode ?? "").trim();
  row["route_compatibility"] = String(input.route_compatibility ?? "").trim();
  row["memory_required"] =
    input.memory_required === true || String(input.memory_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["logging_required"] =
    input.logging_required === true || String(input.logging_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["review_required"] =
    input.review_required === true || String(input.review_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["allowed_states"] = String(input.allowed_states ?? "").trim();
  row["degraded_action"] = String(input.degraded_action ?? "").trim();
  row["blocked_action"] = String(input.blocked_action ?? "").trim();
  row["registry_source"] = String(input.registry_source ?? "").trim();
  row["last_validated_at"] = String(input.last_validated_at ?? "").trim();

  return row;
}

export function findWorkflowRegistryRowNumber(header = [], rows = [], input = {}) {
  const workflowIdIdx = header.indexOf("Workflow ID");
  const workflowKeyIdx = header.indexOf("workflow_key");

  if (workflowIdIdx === -1 && workflowKeyIdx === -1) {
    const err = new Error("Workflow Registry header missing Workflow ID and workflow_key.");
    err.code = "workflow_registry_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedWorkflowId = String(input["Workflow ID"] ?? input.workflow_id ?? "").trim();
  const wantedWorkflowKey = String(input.workflow_key || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingWorkflowId =
      workflowIdIdx === -1 ? "" : String(row[workflowIdIdx] || "").trim();
    const existingWorkflowKey =
      workflowKeyIdx === -1 ? "" : String(row[workflowKeyIdx] || "").trim();

    if (wantedWorkflowId && existingWorkflowId === wantedWorkflowId) {
      return i + 2;
    }

    if (!wantedWorkflowId && wantedWorkflowKey && existingWorkflowKey === wantedWorkflowKey) {
      return i + 2;
    }
  }

  return null;
}

export async function writeWorkflowRegistryRow(input = {}) {
  const live = await readWorkflowRegistryLive();
  const row = buildWorkflowRegistryRow(input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: WORKFLOW_REGISTRY_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    scanRangeA1: "A:AL"
  });

  return {
    mutationType: "append",
    row,
    preflight: mutationResult.preflight
  };
}

export async function updateWorkflowRegistryRow(input = {}) {
  const live = await readWorkflowRegistryLive();
  const row = buildWorkflowRegistryRow(input);
  const targetRowNumber = findWorkflowRegistryRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: WORKFLOW_REGISTRY_SHEET,
    mutationType: "update",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AL"
  });

  return {
    mutationType: "update",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    row,
    preflight: mutationResult.preflight
  };
}

export async function deleteWorkflowRegistryRow(input = {}) {
  const live = await readWorkflowRegistryLive();
  const targetRowNumber = findWorkflowRegistryRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: WORKFLOW_REGISTRY_SHEET,
    mutationType: "delete",
    rowObject: buildWorkflowRegistryRow(input),
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AL"
  });

  return {
    mutationType: "delete",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    preflight: mutationResult.preflight
  };
}

export async function readRegistrySurfacesCatalogLive() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await fetchRange(
    sheets,
    toValuesApiRange(REGISTRY_SURFACES_CATALOG_SHEET, "A1:AG2000")
  );
  if (!values.length) throw registryError(REGISTRY_SURFACES_CATALOG_SHEET);

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, REGISTRY_SURFACES_CATALOG_SHEET)
  };
}

export function buildRegistrySurfaceCatalogRow(input = {}) {
  return {
    surface_id: String(input.surface_id ?? "").trim(),
    surface_name: String(input.surface_name ?? "").trim(),
    worksheet_name: String(input.worksheet_name ?? "").trim(),
    worksheet_gid: String(input.worksheet_gid ?? "").trim(),
    active_status:
      input.active_status === true ||
      String(input.active_status ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    authority_status: String(input.authority_status ?? "").trim(),
    required_for_execution:
      input.required_for_execution === true ||
      String(input.required_for_execution ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    schema_ref: String(input.schema_ref ?? "").trim(),
    schema_version: String(input.schema_version ?? "").trim(),
    header_signature: String(input.header_signature ?? "").trim(),
    expected_column_count: String(input.expected_column_count ?? "").trim(),
    binding_mode: String(input.binding_mode ?? "").trim(),
    sheet_role: String(input.sheet_role ?? "").trim(),
    audit_mode: String(input.audit_mode ?? "").trim(),
    legacy_surface_containment_required:
      input.legacy_surface_containment_required === true ||
      String(input.legacy_surface_containment_required ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    repair_candidate_types: String(input.repair_candidate_types ?? "").trim(),
    repair_priority: String(input.repair_priority ?? "").trim()
  };
}

export function findRegistrySurfaceCatalogRowNumber(header = [], rows = [], input = {}) {
  const surfaceIdIdx = header.indexOf("surface_id");
  const surfaceNameIdx = header.indexOf("surface_name");

  if (surfaceIdIdx === -1 && surfaceNameIdx === -1) {
    const err = new Error(
      "Registry Surfaces Catalog header missing surface_id and surface_name."
    );
    err.code = "registry_surfaces_catalog_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedSurfaceId = String(input.surface_id || "").trim();
  const wantedSurfaceName = String(input.surface_name || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingSurfaceId =
      surfaceIdIdx === -1 ? "" : String(row[surfaceIdIdx] || "").trim();
    const existingSurfaceName =
      surfaceNameIdx === -1 ? "" : String(row[surfaceNameIdx] || "").trim();

    if (wantedSurfaceId && existingSurfaceId === wantedSurfaceId) {
      return i + 2;
    }

    if (!wantedSurfaceId && wantedSurfaceName && existingSurfaceName === wantedSurfaceName) {
      return i + 2;
    }
  }

  return null;
}

export async function writeRegistrySurfaceCatalogRow(input = {}) {
  const live = await readRegistrySurfacesCatalogLive();
  const row = buildRegistrySurfaceCatalogRow(input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: REGISTRY_SURFACES_CATALOG_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    scanRangeA1: "A:AG"
  });

  return {
    mutationType: "append",
    row,
    preflight: mutationResult.preflight
  };
}

export async function updateRegistrySurfaceCatalogRow(input = {}) {
  const live = await readRegistrySurfacesCatalogLive();
  const row = buildRegistrySurfaceCatalogRow(input);
  const targetRowNumber = findRegistrySurfaceCatalogRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: REGISTRY_SURFACES_CATALOG_SHEET,
    mutationType: "update",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AG"
  });

  return {
    mutationType: "update",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    row,
    preflight: mutationResult.preflight
  };
}

export async function deleteRegistrySurfaceCatalogRow(input = {}) {
  const live = await readRegistrySurfacesCatalogLive();
  const targetRowNumber = findRegistrySurfaceCatalogRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: REGISTRY_SURFACES_CATALOG_SHEET,
    mutationType: "delete",
    rowObject: buildRegistrySurfaceCatalogRow(input),
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AG"
  });

  return {
    mutationType: "delete",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    preflight: mutationResult.preflight
  };
}

export async function readValidationRepairRegistryLive() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await fetchRange(
    sheets,
    toValuesApiRange(VALIDATION_REPAIR_REGISTRY_SHEET, "A1:AZ2000")
  );
  if (!values.length) throw registryError(VALIDATION_REPAIR_REGISTRY_SHEET);

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, VALIDATION_REPAIR_REGISTRY_SHEET)
  };
}

export function buildValidationRepairRegistryRow(input = {}) {
  return {
    validation_key: String(input.validation_key ?? "").trim(),
    validation_name: String(input.validation_name ?? "").trim(),
    surface_id: String(input.surface_id ?? "").trim(),
    target_sheet: String(input.target_sheet ?? "").trim(),
    target_range: String(input.target_range ?? "").trim(),
    validation_type: String(input.validation_type ?? "").trim(),
    validation_scope: String(input.validation_scope ?? "").trim(),
    severity: String(input.severity ?? "").trim(),
    blocking:
      input.blocking === true ||
      String(input.blocking ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    active_status:
      input.active_status === true ||
      String(input.active_status ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    repair_strategy: String(input.repair_strategy ?? "").trim(),
    repair_module: String(input.repair_module ?? "").trim(),
    expected_schema_ref: String(input.expected_schema_ref ?? "").trim(),
    expected_schema_version: String(input.expected_schema_version ?? "").trim(),
    expected_header_signature: String(input.expected_header_signature ?? "").trim(),
    drift_detection_mode: String(input.drift_detection_mode ?? "").trim(),
    last_validated_at: String(input.last_validated_at ?? "").trim(),
    notes: String(input.notes ?? "").trim()
  };
}

export function findValidationRepairRegistryRowNumber(header = [], rows = [], input = {}) {
  const validationKeyIdx = header.indexOf("validation_key");
  const validationNameIdx = header.indexOf("validation_name");

  if (validationKeyIdx === -1 && validationNameIdx === -1) {
    const err = new Error(
      "Validation & Repair Registry header missing validation_key and validation_name."
    );
    err.code = "validation_repair_registry_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedValidationKey = String(input.validation_key || "").trim();
  const wantedValidationName = String(input.validation_name || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingValidationKey =
      validationKeyIdx === -1 ? "" : String(row[validationKeyIdx] || "").trim();
    const existingValidationName =
      validationNameIdx === -1 ? "" : String(row[validationNameIdx] || "").trim();

    if (wantedValidationKey && existingValidationKey === wantedValidationKey) {
      return i + 2;
    }

    if (
      !wantedValidationKey &&
      wantedValidationName &&
      existingValidationName === wantedValidationName
    ) {
      return i + 2;
    }
  }

  return null;
}

export async function writeValidationRepairRegistryRow(input = {}) {
  const live = await readValidationRepairRegistryLive();
  const row = buildValidationRepairRegistryRow(input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: VALIDATION_REPAIR_REGISTRY_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    scanRangeA1: "A:AZ"
  });

  return {
    mutationType: "append",
    row,
    preflight: mutationResult.preflight
  };
}

export async function updateValidationRepairRegistryRow(input = {}) {
  const live = await readValidationRepairRegistryLive();
  const row = buildValidationRepairRegistryRow(input);
  const targetRowNumber = findValidationRepairRegistryRowNumber(
    live.header,
    live.rows,
    input
  );

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: VALIDATION_REPAIR_REGISTRY_SHEET,
    mutationType: "update",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AZ"
  });

  return {
    mutationType: "update",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    row,
    preflight: mutationResult.preflight
  };
}

export async function deleteValidationRepairRegistryRow(input = {}) {
  const live = await readValidationRepairRegistryLive();
  const targetRowNumber = findValidationRepairRegistryRowNumber(
    live.header,
    live.rows,
    input
  );

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: VALIDATION_REPAIR_REGISTRY_SHEET,
    mutationType: "delete",
    rowObject: buildValidationRepairRegistryRow(input),
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AZ"
  });

  return {
    mutationType: "delete",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    preflight: mutationResult.preflight
  };
}

export async function readActionsRegistryLive() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await fetchRange(
    sheets,
    toValuesApiRange(ACTIONS_REGISTRY_SHEET, "A1:AZ2000")
  );
  if (!values.length) throw registryError(ACTIONS_REGISTRY_SHEET);

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, ACTIONS_REGISTRY_SHEET)
  };
}

export function buildActionsRegistryRow(input = {}) {
  return {
    action_key: String(input.action_key ?? "").trim(),
    parent_action_key: String(input.parent_action_key ?? "").trim(),
    action_name: String(input.action_name ?? "").trim(),
    action_label: String(input.action_label ?? "").trim(),
    action_type: String(input.action_type ?? "").trim(),
    target_module: String(input.target_module ?? "").trim(),
    workflow_key: String(input.workflow_key ?? "").trim(),
    execution_mode: String(input.execution_mode ?? "").trim(),
    request_method: String(input.request_method ?? "").trim(),
    path_template: String(input.path_template ?? "").trim(),
    provider_domain_mode: String(input.provider_domain_mode ?? "").trim(),
    auth_mode: String(input.auth_mode ?? "").trim(),
    schema_mode: String(input.schema_mode ?? "").trim(),
    request_schema_ref: String(input.request_schema_ref ?? "").trim(),
    response_schema_ref: String(input.response_schema_ref ?? "").trim(),
    route_scope: String(input.route_scope ?? "").trim(),
    retry_profile: String(input.retry_profile ?? "").trim(),
    active_status:
      input.active_status === true ||
      String(input.active_status ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    blocking:
      input.blocking === true ||
      String(input.blocking ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    notes: String(input.notes ?? "").trim(),
    owner_module: String(input.owner_module ?? "").trim(),
    authority_source: String(input.authority_source ?? "").trim(),
    last_validated_at: String(input.last_validated_at ?? "").trim()
  };
}

export function findActionsRegistryRowNumber(header = [], rows = [], input = {}) {
  const actionKeyIdx = header.indexOf("action_key");
  const actionNameIdx = header.indexOf("action_name");

  if (actionKeyIdx === -1 && actionNameIdx === -1) {
    const err = new Error(
      "Actions Registry header missing action_key and action_name."
    );
    err.code = "actions_registry_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedActionKey = String(input.action_key || "").trim();
  const wantedActionName = String(input.action_name || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingActionKey =
      actionKeyIdx === -1 ? "" : String(row[actionKeyIdx] || "").trim();
    const existingActionName =
      actionNameIdx === -1 ? "" : String(row[actionNameIdx] || "").trim();

    if (wantedActionKey && existingActionKey === wantedActionKey) {
      return i + 2;
    }

    if (!wantedActionKey && wantedActionName && existingActionName === wantedActionName) {
      return i + 2;
    }
  }

  return null;
}

export async function writeActionsRegistryRow(input = {}) {
  const live = await readActionsRegistryLive();
  const row = buildActionsRegistryRow(input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: ACTIONS_REGISTRY_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    scanRangeA1: "A:AZ"
  });

  return {
    mutationType: "append",
    row,
    preflight: mutationResult.preflight
  };
}

export async function updateActionsRegistryRow(input = {}) {
  const live = await readActionsRegistryLive();
  const row = buildActionsRegistryRow(input);
  const targetRowNumber = findActionsRegistryRowNumber(
    live.header,
    live.rows,
    input
  );

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: ACTIONS_REGISTRY_SHEET,
    mutationType: "update",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AZ"
  });

  return {
    mutationType: "update",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    row,
    preflight: mutationResult.preflight
  };
}

export async function deleteActionsRegistryRow(input = {}) {
  const live = await readActionsRegistryLive();
  const targetRowNumber = findActionsRegistryRowNumber(
    live.header,
    live.rows,
    input
  );

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: ACTIONS_REGISTRY_SHEET,
    mutationType: "delete",
    rowObject: buildActionsRegistryRow(input),
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AZ"
  });

  return {
    mutationType: "delete",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    preflight: mutationResult.preflight
  };
}

export async function fetchFromGoogleSheets() {
  const { sheets, drive } = await getGoogleClients();
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
    loadBrandRegistry(sheets),
    loadHostingAccountRegistry(sheets),
    loadActionsRegistry(sheets),
    loadEndpointRegistry(sheets),
    loadExecutionPolicies(sheets),
    loadSiteRuntimeInventoryRegistry(sheets).catch(() => []),
    loadSiteSettingsInventoryRegistry(sheets).catch(() => []),
    loadPluginInventoryRegistry(sheets).catch(() => []),
    loadTaskRoutesRegistry(sheets).catch(() => []),
    loadWorkflowRegistry(sheets).catch(() => [])
  ]);

  return {
    drive,
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

export async function getRegistry() {
  return await fetchFromGoogleSheets();
}

export async function reloadRegistry() {
  return await fetchFromGoogleSheets();
}

export function registryError(name) {
  const err = new Error(`${name} sheet is empty or unreadable.`);
  err.code = "registry_unavailable";
  err.status = 500;
  return err;
}

export function policyValue(policies, group, key, fallback = "") {
  const row = policies.find(p => p.policy_group === group && p.policy_key === key && boolFromSheet(p.active));
  return row ? row.policy_value : fallback;
}

export function policyList(policies, group, key) {
  return String(policyValue(policies, group, key, ""))
    .split("|")
    .map(v => v.trim())
    .filter(Boolean);
}

export async function appendRowsIfMissingByKeys(
  sheets,
  spreadsheetId,
  sheetName,
  columns,
  keyColumns,
  rows = []
) {
  blockLegacyRouteWorkflowWrite(sheetName, columns);

  if (!rows.length) return { appended: 0, existing: 0 };

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(sheetName, "A:AZ")
  });

  const values = response.data.values || [];
  const header = (values[0] || []).map(v => String(v || "").trim());
  const existingRows = values.slice(1).map(row => buildRecordFromHeaderAndRow(header, row));

  const seen = new Set(
    existingRows.map(record => keyColumns.map(key => String(record[key] || "").trim()).join("||"))
  );

  const missingRows = rows.filter(row => {
    const key = keyColumns.map(column => String(row[column] || "").trim()).join("||");
    return key && !seen.has(key);
  });

  if (!missingRows.length) {
    return { appended: 0, existing: rows.length };
  }

  for (const row of missingRows) {
    assertNoDirectActivationWithoutGovernedReview(row, sheetName);
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toA1Start(sheetName),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: missingRows.map(row => buildSheetRowFromColumns(columns, row))
    }
  });

  return {
    appended: missingRows.length,
    existing: rows.length - missingRows.length
  };
}
export async function ensureSiteMigrationRegistrySurfaces() {
  assertNoLegacySiteMigrationScaffolding();

  await assertSheetExistsInSpreadsheet(REGISTRY_SPREADSHEET_ID, SITE_RUNTIME_INVENTORY_REGISTRY_SHEET);
  await assertSheetExistsInSpreadsheet(REGISTRY_SPREADSHEET_ID, SITE_SETTINGS_INVENTORY_REGISTRY_SHEET);
  await assertSheetExistsInSpreadsheet(REGISTRY_SPREADSHEET_ID, PLUGIN_INVENTORY_REGISTRY_SHEET);

  const taskShape = await readLiveSheetShape(
    REGISTRY_SPREADSHEET_ID,
    TASK_ROUTES_SHEET,
    toValuesApiRange(TASK_ROUTES_SHEET, "A1:AF2")
  );
  const taskRoutesMetadata = await getCanonicalSurfaceMetadata(
    "surface.task_routes_sheet",
    {
      columns: TASK_ROUTES_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Task Routes",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  assertHeaderMatchesSurfaceMetadata({
    sheetName: TASK_ROUTES_SHEET,
    actualHeader: taskShape.header,
    metadata: taskRoutesMetadata,
    fallbackColumns: TASK_ROUTES_CANONICAL_COLUMNS
  });

  const workflowShape = await readLiveSheetShape(
    REGISTRY_SPREADSHEET_ID,
    WORKFLOW_REGISTRY_SHEET,
    toValuesApiRange(WORKFLOW_REGISTRY_SHEET, "A1:AL2")
  );
  const workflowRegistryMetadata = await getCanonicalSurfaceMetadata(
    "surface.workflow_registry_sheet",
    {
      columns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Workflow Registry",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  assertHeaderMatchesSurfaceMetadata({
    sheetName: WORKFLOW_REGISTRY_SHEET,
    actualHeader: workflowShape.header,
    metadata: workflowRegistryMetadata,
    fallbackColumns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS
  });

  const taskRoutesSchemaLabel =
    [
      String(taskRoutesMetadata.schema_ref || "").trim(),
      String(taskRoutesMetadata.schema_version || "").trim()
    ]
      .filter(Boolean)
      .join("@") || "canonical_32";
  const workflowRegistrySchemaLabel =
    [
      String(workflowRegistryMetadata.schema_ref || "").trim(),
      String(workflowRegistryMetadata.schema_version || "").trim()
    ]
      .filter(Boolean)
      .join("@") || "canonical_38";

  return {
    mode: "validate_only",
    site_runtime_inventory: { exists: true },
    site_settings_inventory: { exists: true },
    plugin_inventory: { exists: true },
    task_routes: {
      exists: true,
      schema: taskRoutesSchemaLabel
    },
    workflow_registry: {
      exists: true,
      schema: workflowRegistrySchemaLabel
    }
  };
}

export async function ensureSiteMigrationRouteWorkflowRows() {
  assertNoLegacySiteMigrationScaffolding();

  const taskShape = await readLiveSheetShape(
    REGISTRY_SPREADSHEET_ID,
    TASK_ROUTES_SHEET,
    toValuesApiRange(TASK_ROUTES_SHEET, "A1:AF2")
  );
  const taskRoutesMetadata = await getCanonicalSurfaceMetadata(
    "surface.task_routes_sheet",
    {
      columns: TASK_ROUTES_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Task Routes",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  assertHeaderMatchesSurfaceMetadata({
    sheetName: TASK_ROUTES_SHEET,
    actualHeader: taskShape.header,
    metadata: taskRoutesMetadata,
    fallbackColumns: TASK_ROUTES_CANONICAL_COLUMNS
  });

  const workflowShape = await readLiveSheetShape(
    REGISTRY_SPREADSHEET_ID,
    WORKFLOW_REGISTRY_SHEET,
    toValuesApiRange(WORKFLOW_REGISTRY_SHEET, "A1:AL2")
  );
  const workflowRegistryMetadata = await getCanonicalSurfaceMetadata(
    "surface.workflow_registry_sheet",
    {
      columns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Workflow Registry",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  assertHeaderMatchesSurfaceMetadata({
    sheetName: WORKFLOW_REGISTRY_SHEET,
    actualHeader: workflowShape.header,
    metadata: workflowRegistryMetadata,
    fallbackColumns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS
  });

  const { sheets } = await getGoogleClients();

  const taskRoutes = await loadTaskRoutesRegistry(sheets, {
    include_candidate_inspection: true
  });
  const workflows = await loadWorkflowRegistry(sheets, {
    include_candidate_inspection: true
  });

  const foundTaskKeys = new Set(
    taskRoutes
      .map(row => String(row.task_key || row.route_key || "").trim())
      .filter(Boolean)
  );
  const foundWorkflowIds = new Set(
    workflows
      .map(row => String(row.workflow_id || "").trim())
      .filter(Boolean)
  );

  const executableTaskKeys = new Set(
    taskRoutes
      .filter(row => row.executable_authority === true)
      .map(row => String(row.task_key || row.route_key || "").trim())
      .filter(Boolean)
  );
  const executableWorkflowIds = new Set(
    workflows
      .filter(row => row.executable_authority === true)
      .map(row => String(row.workflow_id || "").trim())
      .filter(Boolean)
  );

  const missingTaskKeys = REQUIRED_SITE_MIGRATION_TASK_KEYS.filter(v => !foundTaskKeys.has(v));
  const missingWorkflowIds = REQUIRED_SITE_MIGRATION_WORKFLOW_IDS.filter(v => !foundWorkflowIds.has(v));

  const unresolvedTaskAuthority = REQUIRED_SITE_MIGRATION_TASK_KEYS.filter(
    v => foundTaskKeys.has(v) && !executableTaskKeys.has(v)
  );
  const unresolvedWorkflowAuthority = REQUIRED_SITE_MIGRATION_WORKFLOW_IDS.filter(
    v => foundWorkflowIds.has(v) && !executableWorkflowIds.has(v)
  );

  const chainReviewRequired =
    taskRoutes.some(row => boolFromSheet(row.chain_candidate)) ||
    workflows.some(row => boolFromSheet(row.chain_eligible));
  const graphReviewRequired =
    taskRoutes.some(row => boolFromSheet(row.graph_update_required)) ||
    workflows.some(row => boolFromSheet(row.graph_update_required));
  const bindingsReviewRequired =
    taskRoutes.some(row => boolFromSheet(row.bindings_update_required)) ||
    workflows.some(row => boolFromSheet(row.bindings_update_required));
  const reconciliationRequired =
    taskRoutes.some(row => boolFromSheet(row.reconciliation_required)) ||
    workflows.some(row => boolFromSheet(row.reconciliation_required));
  const policyReviewRequired =
    taskRoutes.some(row => boolFromSheet(row.policy_update_required)) ||
    workflows.some(row =>
      boolFromSheet(row.policy_update_required) ||
      boolFromSheet(row.policy_dependency_required)
    );
  const starterReviewRequired =
    taskRoutes.some(row => boolFromSheet(row.starter_update_required)) ||
    workflows.some(row => boolFromSheet(row.starter_update_required));
  const repairMappingRequired =
    workflows.some(row => boolFromSheet(row.repair_mapping_required));

  const hasMissingDependencies = missingTaskKeys.length > 0 || missingWorkflowIds.length > 0;
  const hasDeferredActivation =
    unresolvedTaskAuthority.length > 0 ||
    unresolvedWorkflowAuthority.length > 0 ||
    chainReviewRequired ||
    graphReviewRequired ||
    bindingsReviewRequired ||
    reconciliationRequired ||
    policyReviewRequired ||
    starterReviewRequired ||
    repairMappingRequired;

  const outcome = hasMissingDependencies
    ? "degraded_missing_dependencies"
    : hasDeferredActivation
    ? "pending_validation"
    : "reuse_existing";

  const review = buildGovernedAdditionReviewResult({
    outcome,
    addition_state: outcome === "reuse_existing" ? "active" : "pending_validation",
    route_overlap_detected: false,
    workflow_overlap_detected: false,
    chain_needed: chainReviewRequired,
    graph_update_required: graphReviewRequired,
    bindings_update_required: bindingsReviewRequired,
    policy_update_required: policyReviewRequired,
    starter_update_required: starterReviewRequired,
    reconciliation_required: reconciliationRequired
  });

  const taskRoutesSchemaLabel =
    [
      String(taskRoutesMetadata.schema_ref || "").trim(),
      String(taskRoutesMetadata.schema_version || "").trim()
    ]
      .filter(Boolean)
      .join("@") || "canonical_32";
  const workflowRegistrySchemaLabel =
    [
      String(workflowRegistryMetadata.schema_ref || "").trim(),
      String(workflowRegistryMetadata.schema_version || "").trim()
    ]
      .filter(Boolean)
      .join("@") || "canonical_38";

  return {
    mode: "validate_only",
    outcome,
    review,
    task_routes_schema: taskRoutesSchemaLabel,
    workflow_registry_schema: workflowRegistrySchemaLabel,
    found_task_keys: [...foundTaskKeys],
    found_workflow_ids: [...foundWorkflowIds],
    executable_task_keys: [...executableTaskKeys],
    executable_workflow_ids: [...executableWorkflowIds],
    missing_task_keys: missingTaskKeys,
    missing_workflow_ids: missingWorkflowIds,
    unresolved_task_authority: unresolvedTaskAuthority,
    unresolved_workflow_authority: unresolvedWorkflowAuthority,
    chain_review_required: chainReviewRequired,
    graph_review_required: graphReviewRequired,
    bindings_review_required: bindingsReviewRequired,
    reconciliation_required: reconciliationRequired,
    policy_review_required: policyReviewRequired,
    starter_review_required: starterReviewRequired,
    repair_mapping_required: repairMappingRequired,
    task_routes_ready: REQUIRED_SITE_MIGRATION_TASK_KEYS.every(v => executableTaskKeys.has(v)),
    workflow_registry_ready: REQUIRED_SITE_MIGRATION_WORKFLOW_IDS.every(v => executableWorkflowIds.has(v))
  };
}

export async function loadSiteRuntimeInventoryRegistry(sheets) {
  if (DATA_SOURCE !== "sheets") {
    const rows = await sqlReadTableDirect("Site Runtime Inventory Registry");
    return rows.map(r => ({
      target_key: r.target_key || "",
      brand_name: r.brand_name || "",
      brand_domain: r.brand_domain || "",
      base_url: r.base_url || "",
      site_type: r.site_type || "",
      supported_cpts: r.supported_cpts || "",
      supported_taxonomies: r.supported_taxonomies || "",
      generated_endpoint_support: r.generated_endpoint_support || "",
      runtime_validation_status: r.runtime_validation_status || "",
      last_runtime_validated_at: r.last_runtime_validated_at || "",
      active_status: r.active_status || ""
    })).filter(r => r.target_key || r.brand_domain || r.base_url);
  }
  const values = await fetchRange(
    sheets,
    `'${SITE_RUNTIME_INVENTORY_REGISTRY_SHEET}'!A1:Z2000`
  );
  if (!values.length) throw registryError("Site Runtime Inventory Registry");
  const headers = values[0];
  const map = headerMap(headers, SITE_RUNTIME_INVENTORY_REGISTRY_SHEET);
  for (const col of SITE_RUNTIME_INVENTORY_REGISTRY_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(map, col)) {
      const err = new Error(
        `${SITE_RUNTIME_INVENTORY_REGISTRY_SHEET} missing required column: ${col}`
      );
      err.code = "registry_schema_mismatch";
      err.status = 500;
      throw err;
    }
  }

  return values.slice(1).map(row => ({
    target_key: getCell(row, map, "target_key"),
    brand_name: getCell(row, map, "brand_name"),
    brand_domain: getCell(row, map, "brand_domain"),
    base_url: getCell(row, map, "base_url"),
    site_type: getCell(row, map, "site_type"),
    supported_cpts: getCell(row, map, "supported_cpts"),
    supported_taxonomies: getCell(row, map, "supported_taxonomies"),
    generated_endpoint_support: getCell(row, map, "generated_endpoint_support"),
    runtime_validation_status: getCell(row, map, "runtime_validation_status"),
    last_runtime_validated_at: getCell(row, map, "last_runtime_validated_at"),
    active_status: getCell(row, map, "active_status")
  })).filter(r => r.target_key || r.brand_domain || r.base_url);
}

export async function loadSiteSettingsInventoryRegistry(sheets) {
  if (DATA_SOURCE !== "sheets") {
    const rows = await sqlReadTableDirect("Site Settings Inventory Registry");
    return rows.map(r => ({
      target_key: r.target_key || "",
      brand_name: r.brand_name || "",
      brand_domain: r.brand_domain || "",
      base_url: r.base_url || "",
      site_type: r.site_type || "",
      permalink_structure: r.permalink_structure || "",
      timezone_string: r.timezone_string || "",
      site_language: r.site_language || "",
      active_theme: r.active_theme || "",
      settings_validation_status: r.settings_validation_status || "",
      last_settings_validated_at: r.last_settings_validated_at || "",
      active_status: r.active_status || ""
    })).filter(r => r.target_key || r.brand_domain || r.base_url);
  }
  const values = await fetchRange(
    sheets,
    `'${SITE_SETTINGS_INVENTORY_REGISTRY_SHEET}'!A1:Z2000`
  );
  if (!values.length) throw registryError("Site Settings Inventory Registry");
  const headers = values[0];
  const map = headerMap(headers, SITE_SETTINGS_INVENTORY_REGISTRY_SHEET);
  for (const col of SITE_SETTINGS_INVENTORY_REGISTRY_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(map, col)) {
      const err = new Error(
        `${SITE_SETTINGS_INVENTORY_REGISTRY_SHEET} missing required column: ${col}`
      );
      err.code = "registry_schema_mismatch";
      err.status = 500;
      throw err;
    }
  }

  return values.slice(1).map(row => ({
    target_key: getCell(row, map, "target_key"),
    brand_name: getCell(row, map, "brand_name"),
    brand_domain: getCell(row, map, "brand_domain"),
    base_url: getCell(row, map, "base_url"),
    site_type: getCell(row, map, "site_type"),
    permalink_structure: getCell(row, map, "permalink_structure"),
    timezone_string: getCell(row, map, "timezone_string"),
    site_language: getCell(row, map, "site_language"),
    active_theme: getCell(row, map, "active_theme"),
    settings_validation_status: getCell(row, map, "settings_validation_status"),
    last_settings_validated_at: getCell(row, map, "last_settings_validated_at"),
    active_status: getCell(row, map, "active_status")
  })).filter(r => r.target_key || r.brand_domain || r.base_url);
}

export async function loadPluginInventoryRegistry(sheets) {
  if (DATA_SOURCE !== "sheets") {
    const rows = await sqlReadTableDirect("Plugin Inventory Registry");
    return rows.map(r => ({
      target_key: r.target_key || "",
      brand_name: r.brand_name || "",
      brand_domain: r.brand_domain || "",
      base_url: r.base_url || "",
      site_type: r.site_type || "",
      active_plugins: r.active_plugins || "",
      plugin_versions_json: r.plugin_versions_json || "",
      plugin_owned_tables: r.plugin_owned_tables || "",
      plugin_owned_entities: r.plugin_owned_entities || "",
      plugin_validation_status: r.plugin_validation_status || "",
      last_plugin_validated_at: r.last_plugin_validated_at || "",
      active_status: r.active_status || ""
    })).filter(r => r.target_key || r.brand_domain || r.base_url);
  }
  const values = await fetchRange(
    sheets,
    `'${PLUGIN_INVENTORY_REGISTRY_SHEET}'!A1:Z2000`
  );
  if (!values.length) throw registryError("Plugin Inventory Registry");
  const headers = values[0];
  const map = headerMap(headers, PLUGIN_INVENTORY_REGISTRY_SHEET);
  for (const col of PLUGIN_INVENTORY_REGISTRY_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(map, col)) {
      const err = new Error(
        `${PLUGIN_INVENTORY_REGISTRY_SHEET} missing required column: ${col}`
      );
      err.code = "registry_schema_mismatch";
      err.status = 500;
      throw err;
    }
  }

  return values.slice(1).map(row => ({
    target_key: getCell(row, map, "target_key"),
    brand_name: getCell(row, map, "brand_name"),
    brand_domain: getCell(row, map, "brand_domain"),
    base_url: getCell(row, map, "base_url"),
    site_type: getCell(row, map, "site_type"),
    active_plugins: getCell(row, map, "active_plugins"),
    plugin_versions_json: getCell(row, map, "plugin_versions_json"),
    plugin_owned_tables: getCell(row, map, "plugin_owned_tables"),
    plugin_owned_entities: getCell(row, map, "plugin_owned_entities"),
    plugin_validation_status: getCell(row, map, "plugin_validation_status"),
    last_plugin_validated_at: getCell(row, map, "last_plugin_validated_at"),
    active_status: getCell(row, map, "active_status")
  })).filter(r => r.target_key || r.brand_domain || r.base_url);
}

export async function loadTaskRoutesRegistry(sheets, options = {}) {
  const includeCandidateInspection = options?.include_candidate_inspection === true;

  if (DATA_SOURCE !== "sheets") {
    const dbRows = await sqlReadTableDirect("Task Routes");
    const rows = dbRows.map(r => {
      const taskKey = r.task_key || "";
      const activeRaw = r.active || "";
      const routeActive = String(activeRaw).trim().toUpperCase() === "TRUE";
      const additionStatus = normalizeGovernedAdditionState(
        r.addition_status || r.governance_status || r.validation_status
      );
      const routeRecord = {
        task_key: taskKey,
        route_key: taskKey,
        trigger_terms: r.trigger_terms || "",
        route_modules: r.route_modules || "",
        execution_layer: r.execution_layer || "",
        enabled: r.enabled || "",
        output_focus: r.output_focus || "",
        notes: r.notes || "",
        entry_sources: r.entry_sources || "",
        linked_starter_titles: r.linked_starter_titles || "",
        active_starter_count: r.active_starter_count || "",
        route_key_match_status: r.route_key_match_status || "",
        row_id: r.row_id || "",
        route_id: r.route_id || "",
        active: activeRaw,
        intent_key: r.intent_key || "",
        brand_scope: r.brand_scope || "",
        request_type: r.request_type || "",
        route_mode: r.route_mode || "",
        target_module: r.target_module || "",
        workflow_key: r.workflow_key || "",
        lifecycle_mode: r.lifecycle_mode || "",
        memory_required: r.memory_required || "",
        logging_required: r.logging_required || "",
        review_required: r.review_required || "",
        priority: r.priority || "",
        allowed_states: r.allowed_states || "",
        degraded_action: r.degraded_action || "",
        blocked_action: r.blocked_action || "",
        match_rule: r.match_rule || "",
        route_source: r.route_source || "",
        last_validated_at: r.last_validated_at || "",
        addition_status: additionStatus,
        governance_status: r.governance_status || "",
        validation_status: r.validation_status || "",
        overlap_group: r.overlap_group || "",
        integration_mode: r.integration_mode || "",
        chain_candidate: r.chain_candidate || "",
        graph_update_required: r.graph_update_required || "",
        bindings_update_required: r.bindings_update_required || "",
        policy_update_required: r.policy_update_required || "",
        starter_update_required: r.starter_update_required || "",
        reconciliation_required: r.reconciliation_required || ""
      };
      const deferredActivationRequired = hasDeferredGovernedActivationDependencies(
        routeRecord,
        ["chain_candidate", "graph_update_required", "bindings_update_required",
          "policy_update_required", "starter_update_required", "reconciliation_required"]
      );
      const executableAuthority =
        routeActive &&
        !governedAdditionStateBlocksAuthority(routeRecord.addition_status) &&
        !deferredActivationRequired;
      return { ...routeRecord, executable_authority: executableAuthority };
    }).filter(row =>
      String(row.task_key || "").trim() ||
      String(row.route_id || "").trim() ||
      String(row.workflow_key || "").trim()
    );
    return includeCandidateInspection ? rows : rows.filter(row => row.executable_authority);
  }

  const taskShape = await readLiveSheetShape(
    REGISTRY_SPREADSHEET_ID,
    TASK_ROUTES_SHEET,
    toValuesApiRange(TASK_ROUTES_SHEET, "A1:AF2")
  );
  const taskRoutesMetadata = await getCanonicalSurfaceMetadata(
    "surface.task_routes_sheet",
    {
      columns: TASK_ROUTES_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Task Routes",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  assertHeaderMatchesSurfaceMetadata({
    sheetName: TASK_ROUTES_SHEET,
    actualHeader: taskShape.header,
    metadata: taskRoutesMetadata,
    fallbackColumns: TASK_ROUTES_CANONICAL_COLUMNS
  });

  const values = await fetchRange(
    sheets,
    toValuesApiRange(TASK_ROUTES_SHEET, "A1:AF2000")
  );
  if (!values.length) throw registryError("Task Routes");
  const headers = (values[0] || []).map(v => String(v || "").trim());
  assertHeaderMatchesSurfaceMetadata({
    sheetName: TASK_ROUTES_SHEET,
    actualHeader: headers,
    metadata: taskRoutesMetadata,
    fallbackColumns: TASK_ROUTES_CANONICAL_COLUMNS
  });
  const map = headerMap(headers, TASK_ROUTES_SHEET);

  const rows = values.slice(1).map(row => {
    const taskKey = getCell(row, map, "Task Key");
    const activeRaw = getCell(row, map, "active");
    const routeActive = String(activeRaw || "").trim().toUpperCase() === "TRUE";
    const additionStatus = normalizeGovernedAdditionState(
      getCell(row, map, "addition_status") ||
      getCell(row, map, "governance_status") ||
      getCell(row, map, "validation_status")
    );

    const routeRecord = {
      task_key: taskKey,
      route_key: taskKey,
      trigger_terms: getCell(row, map, "Trigger Terms"),
      route_modules: getCell(row, map, "Route Modules"),
      execution_layer: getCell(row, map, "Execution Layer"),
      enabled: getCell(row, map, "Enabled"),
      output_focus: getCell(row, map, "Output Focus"),
      notes: getCell(row, map, "Notes"),
      entry_sources: getCell(row, map, "Entry Sources"),
      linked_starter_titles: getCell(row, map, "Linked Starter Titles"),
      active_starter_count: getCell(row, map, "Active Starter Count"),
      route_key_match_status: getCell(row, map, "Route Key Match Status"),
      row_id: getCell(row, map, "row_id"),
      route_id: getCell(row, map, "route_id"),
      active: activeRaw,
      intent_key: getCell(row, map, "intent_key"),
      brand_scope: getCell(row, map, "brand_scope"),
      request_type: getCell(row, map, "request_type"),
      route_mode: getCell(row, map, "route_mode"),
      target_module: getCell(row, map, "target_module"),
      workflow_key: getCell(row, map, "workflow_key"),
      lifecycle_mode: getCell(row, map, "lifecycle_mode"),
      memory_required: getCell(row, map, "memory_required"),
      logging_required: getCell(row, map, "logging_required"),
      review_required: getCell(row, map, "review_required"),
      priority: getCell(row, map, "priority"),
      allowed_states: getCell(row, map, "allowed_states"),
      degraded_action: getCell(row, map, "degraded_action"),
      blocked_action: getCell(row, map, "blocked_action"),
      match_rule: getCell(row, map, "match_rule"),
      route_source: getCell(row, map, "route_source"),
      last_validated_at: getCell(row, map, "last_validated_at"),

      addition_status: additionStatus,
      governance_status: getCell(row, map, "governance_status"),
      validation_status: getCell(row, map, "validation_status"),
      overlap_group: getCell(row, map, "overlap_group"),
      integration_mode: getCell(row, map, "integration_mode"),
      chain_candidate: getCell(row, map, "chain_candidate"),
      graph_update_required: getCell(row, map, "graph_update_required"),
      bindings_update_required: getCell(row, map, "bindings_update_required"),
      policy_update_required: getCell(row, map, "policy_update_required"),
      starter_update_required: getCell(row, map, "starter_update_required"),
      reconciliation_required: getCell(row, map, "reconciliation_required")
    };

    const deferredActivationRequired = hasDeferredGovernedActivationDependencies(
      routeRecord,
      [
        "chain_candidate",
        "graph_update_required",
        "bindings_update_required",
        "policy_update_required",
        "starter_update_required",
        "reconciliation_required"
      ]
    );

    const executableAuthority =
      routeActive &&
      !governedAdditionStateBlocksAuthority(routeRecord.addition_status) &&
      !deferredActivationRequired;

    return {
      ...routeRecord,
      executable_authority: executableAuthority
    };
  }).filter(row =>
    String(row.task_key || "").trim() ||
    String(row.route_id || "").trim() ||
    String(row.workflow_key || "").trim()
  );

  assertSingleActiveRowByKey(rows, "route_id", "active", TASK_ROUTES_SHEET);
  assertSingleActiveRowByKey(rows, "task_key", "active", TASK_ROUTES_SHEET);

  // Execution Chains and graph surfaces can inform validation only; they do not promote authority.
  return includeCandidateInspection ? rows : rows.filter(row => row.executable_authority);
}

export async function loadWorkflowRegistry(sheets, options = {}) {
  const includeCandidateInspection = options?.include_candidate_inspection === true;

  if (DATA_SOURCE !== "sheets") {
    const dbRows = await sqlReadTableDirect("Workflow Registry");
    const rows = dbRows.map(r => {
      const activeRaw = r.active || "";
      const workflowActive = String(activeRaw).trim().toUpperCase() === "TRUE";
      const additionStatus = normalizeGovernedAdditionState(
        r.addition_status || r.governance_status || r.validation_status
      );
      const workflowRecord = {
        workflow_id: r.workflow_id || "",
        workflow_name: r.workflow_name || "",
        module_mode: r.module_mode || "",
        trigger_source: r.trigger_source || "",
        input_type: r.input_type || "",
        primary_objective: r.primary_objective || "",
        mapped_engines: r.mapped_engines || "",
        engine_order: r.engine_order || "",
        workflow_type: r.workflow_type || "",
        primary_output: r.primary_output || "",
        input_detection_rules: r.input_detection_rules || "",
        output_template: r.output_template || "",
        priority: r.priority || "",
        route_key: r.route_key || "",
        execution_mode: r.execution_mode || "",
        user_facing: r.user_facing || "",
        parent_layer: r.parent_layer || "",
        status: r.status || "",
        linked_workflows: r.linked_workflows || "",
        linked_engines: r.linked_engines || "",
        notes: r.notes || "",
        entry_priority_weight: r.entry_priority_weight || "",
        dependency_type: r.dependency_type || "",
        output_artifact_type: r.output_artifact_type || "",
        workflow_key: r.workflow_key || "",
        active: activeRaw,
        target_module: r.target_module || "",
        execution_class: r.execution_class || "",
        lifecycle_mode: r.lifecycle_mode || "",
        route_compatibility: r.route_compatibility || "",
        memory_required: r.memory_required || "",
        logging_required: r.logging_required || "",
        review_required: r.review_required || "",
        allowed_states: r.allowed_states || "",
        degraded_action: r.degraded_action || "",
        blocked_action: r.blocked_action || "",
        registry_source: r.registry_source || "",
        last_validated_at: r.last_validated_at || "",
        addition_status: additionStatus,
        governance_status: r.governance_status || "",
        validation_status: r.validation_status || "",
        workflow_family: r.workflow_family || "",
        overlap_group: r.overlap_group || "",
        execution_path_role: r.execution_path_role || "",
        chain_eligible: r.chain_eligible || "",
        graph_update_required: r.graph_update_required || "",
        bindings_update_required: r.bindings_update_required || "",
        repair_mapping_required: r.repair_mapping_required || "",
        policy_dependency_required: r.policy_dependency_required || "",
        policy_update_required: r.policy_update_required || "",
        starter_update_required: r.starter_update_required || "",
        reconciliation_required: r.reconciliation_required || ""
      };
      const deferredActivationRequired = hasDeferredGovernedActivationDependencies(
        workflowRecord,
        ["chain_eligible", "graph_update_required", "bindings_update_required",
          "repair_mapping_required", "policy_dependency_required", "policy_update_required",
          "starter_update_required", "reconciliation_required"]
      );
      const executableAuthority =
        workflowActive &&
        !governedAdditionStateBlocksAuthority(workflowRecord.addition_status) &&
        !deferredActivationRequired;
      return { ...workflowRecord, executable_authority: executableAuthority };
    }).filter(row =>
      String(row.workflow_id || "").trim() ||
      String(row.workflow_key || "").trim()
    );
    return includeCandidateInspection ? rows : rows.filter(row => row.executable_authority);
  }

  const workflowShape = await readLiveSheetShape(
    REGISTRY_SPREADSHEET_ID,
    WORKFLOW_REGISTRY_SHEET,
    toValuesApiRange(WORKFLOW_REGISTRY_SHEET, "A1:AL2")
  );
  const workflowRegistryMetadata = await getCanonicalSurfaceMetadata(
    "surface.workflow_registry_sheet",
    {
      columns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Workflow Registry",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  assertHeaderMatchesSurfaceMetadata({
    sheetName: WORKFLOW_REGISTRY_SHEET,
    actualHeader: workflowShape.header,
    metadata: workflowRegistryMetadata,
    fallbackColumns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS
  });

  const values = await fetchRange(
    sheets,
    toValuesApiRange(WORKFLOW_REGISTRY_SHEET, "A1:AL2000")
  );
  if (!values.length) throw registryError("Workflow Registry");
  const headers = (values[0] || []).map(v => String(v || "").trim());
  assertHeaderMatchesSurfaceMetadata({
    sheetName: WORKFLOW_REGISTRY_SHEET,
    actualHeader: headers,
    metadata: workflowRegistryMetadata,
    fallbackColumns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS
  });
  const map = headerMap(headers, WORKFLOW_REGISTRY_SHEET);

  const rows = values.slice(1).map(row => {
    const activeRaw = getCell(row, map, "active");
    const workflowActive = String(activeRaw || "").trim().toUpperCase() === "TRUE";
    const additionStatus = normalizeGovernedAdditionState(
      getCell(row, map, "addition_status") ||
      getCell(row, map, "governance_status") ||
      getCell(row, map, "validation_status")
    );

    const workflowRecord = {
      workflow_id: getCell(row, map, "Workflow ID"),
      workflow_name: getCell(row, map, "Workflow Name"),
      module_mode: getCell(row, map, "Module Mode"),
      trigger_source: getCell(row, map, "Trigger Source"),
      input_type: getCell(row, map, "Input Type"),
      primary_objective: getCell(row, map, "Primary Objective"),
      mapped_engines: getCell(row, map, "Mapped Engine(s)"),
      engine_order: getCell(row, map, "Engine Order"),
      workflow_type: getCell(row, map, "Workflow Type"),
      primary_output: getCell(row, map, "Primary Output"),
      input_detection_rules: getCell(row, map, "Input Detection Rules"),
      output_template: getCell(row, map, "Output Template"),
      priority: getCell(row, map, "Priority"),
      route_key: getCell(row, map, "Route Key"),
      execution_mode: getCell(row, map, "Execution Mode"),
      user_facing: getCell(row, map, "User Facing"),
      parent_layer: getCell(row, map, "Parent Layer"),
      status: getCell(row, map, "Status"),
      linked_workflows: getCell(row, map, "Linked Workflows"),
      linked_engines: getCell(row, map, "Linked Engines"),
      notes: getCell(row, map, "Notes"),
      entry_priority_weight: getCell(row, map, "Entry Priority Weight"),
      dependency_type: getCell(row, map, "Dependency Type"),
      output_artifact_type: getCell(row, map, "Output Artifact Type"),
      workflow_key: getCell(row, map, "workflow_key"),
      active: activeRaw,
      target_module: getCell(row, map, "target_module"),
      execution_class: getCell(row, map, "execution_class"),
      lifecycle_mode: getCell(row, map, "lifecycle_mode"),
      route_compatibility: getCell(row, map, "route_compatibility"),
      memory_required: getCell(row, map, "memory_required"),
      logging_required: getCell(row, map, "logging_required"),
      review_required: getCell(row, map, "review_required"),
      allowed_states: getCell(row, map, "allowed_states"),
      degraded_action: getCell(row, map, "degraded_action"),
      blocked_action: getCell(row, map, "blocked_action"),
      registry_source: getCell(row, map, "registry_source"),
      last_validated_at: getCell(row, map, "last_validated_at"),

      addition_status: additionStatus,
      governance_status: getCell(row, map, "governance_status"),
      validation_status: getCell(row, map, "validation_status"),
      workflow_family: getCell(row, map, "workflow_family"),
      overlap_group: getCell(row, map, "overlap_group"),
      execution_path_role: getCell(row, map, "execution_path_role"),
      chain_eligible: getCell(row, map, "chain_eligible"),
      graph_update_required: getCell(row, map, "graph_update_required"),
      bindings_update_required: getCell(row, map, "bindings_update_required"),
      repair_mapping_required: getCell(row, map, "repair_mapping_required"),
      policy_dependency_required: getCell(row, map, "policy_dependency_required"),
      policy_update_required: getCell(row, map, "policy_update_required"),
      starter_update_required: getCell(row, map, "starter_update_required"),
      reconciliation_required: getCell(row, map, "reconciliation_required")
    };

    const deferredActivationRequired = hasDeferredGovernedActivationDependencies(
      workflowRecord,
      [
        "chain_eligible",
        "graph_update_required",
        "bindings_update_required",
        "repair_mapping_required",
        "policy_dependency_required",
        "policy_update_required",
        "starter_update_required",
        "reconciliation_required"
      ]
    );

    const executableAuthority =
      workflowActive &&
      !governedAdditionStateBlocksAuthority(workflowRecord.addition_status) &&
      !deferredActivationRequired;

    return {
      ...workflowRecord,
      executable_authority: executableAuthority
    };
  }).filter(row =>
    String(row.workflow_id || "").trim() ||
    String(row.workflow_key || "").trim()
  );

  assertSingleActiveRowByKey(rows, "workflow_id", "active", WORKFLOW_REGISTRY_SHEET);
  assertSingleActiveRowByKey(rows, "workflow_key", "active", WORKFLOW_REGISTRY_SHEET);

  // Execution chains/graphs are support signals; they do not activate workflow authority.
  return includeCandidateInspection ? rows : rows.filter(row => row.executable_authority);
}

export function findRegistryRecordByIdentity(rows = [], identity = {}) {
  const targetKey = String(identity.target_key || "").trim().toLowerCase();
  const domain = normalizeLooseHostname(identity.domain || identity.brand_domain || "");
  const brand = String(identity.brand || identity.target_key || "").trim().toLowerCase();

  const targetCandidates = [
    "target_key",
    "brand_key",
    "site_key",
    "website_key",
    "brand_name",
    "company_name"
  ];
  const domainCandidates = [
    "brand_domain",
    "domain",
    "site_domain",
    "base_url",
    "brand.base_url",
    "website_url"
  ];

  const exactTarget = rows.find(row =>
    targetCandidates.some(key => String(row?.[key] || "").trim().toLowerCase() === targetKey) ||
    targetCandidates.some(key => String(row?.[key] || "").trim().toLowerCase() === brand)
  );
  if (exactTarget) return exactTarget;

  if (domain) {
    const exactDomain = rows.find(row =>
      domainCandidates.some(key =>
        normalizeLooseHostname(row?.[key] || "") === domain
      )
    );
    if (exactDomain) return exactDomain;
  }

  return null;
}
