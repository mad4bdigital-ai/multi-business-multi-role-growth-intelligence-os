import { getPool } from "./db.js";
import { cachedSqlTableRead, invalidateSqlTableCache } from "./sqlCache.js";

// ── Sheet name → SQL table name ────────────────────────────────────────────────
const TABLE_MAP = {
  "Brand Registry":                     "brands",
  "Brand Core Registry":                "brand_core",
  "Actions Registry":                   "actions",
  "API Actions Endpoint Registry":      "endpoints",
  "Execution Policy Registry":          "execution_policies",
  "Hosting Account Registry":           "hosting_accounts",
  "Site Runtime Inventory Registry":    "site_runtime_inventory",
  "Site Settings Inventory Registry":   "site_settings_inventory",
  "Plugin Inventory Registry":          "plugins",
  "Business Activity Type Registry":     "business_activity_types",
  "Business Type Knowledge Profiles":   "business_type_profiles",
  "Brand Path Resolver":                "brand_paths",
  "Task Routes":                        "task_routes",
  "Workflow Registry":                  "workflows",
  "Registry Surfaces Catalog":          "registry_surfaces_catalog",
  "Validation & Repair Registry":       "validation_repair",
  "JSON Asset Registry":                "json_assets",
  "Execution Log Unified":              "execution_log",
};

// ── Canonical sheet column names per table ─────────────────────────────────────
// Defines both the write order and the reverse-mapping key for reads.
// Columns already in snake_case map 1:1; spaced/special names are normalised.
const SHEET_COLUMNS = {
  // ── Live header: 122 cols (Brand Registry) ────────────────────────────────
  brands: [
    "Brand Name", "Normalized Brand Name", "Brand Folder ID", "Brand Folder Link",
    "Root Folder ID", "Status", "Last Updated", "Brand Core Ready", "Notes",
    "Maturity", "Auto-Context Status", "Resolution Mode", "Default Execution Mode",
    "Maturity-Aware Behavior", "Previous Maturity", "Last Maturity Review",
    "Evolution Status", "Score Trend", "Strategy Impact", "Growth Velocity",
    "Auto-Decision Trigger", "Scoreboard Read Rule", "Maturity Update Logic",
    "Decision Trigger Logic", "Auto-Update Status", "Next Auto-Action",
    "Duplicate Validation Rule", "Lifecycle Automation Status", "Subfolder Template",
    "ga_property_id", "gtm_container_id", "gsc_property",
    "brand_domain", "target_key", "site_aliases_json", "base_url",
    "transport_action_key", "auth_type", "credential_resolution", "username",
    "application_password", "default_headers_json", "write_allowed",
    "destructive_allowed", "transport_enabled", "target_resolution_mode",
    "site_framework", "site_framework_family", "site_framework_variant",
    "site_builder_stack", "site_config_stack", "site_multilingual_stack",
    "site_theme_stack", "site_extensions_stack", "site_snapshot_asset_link",
    "site_notes_asset_link", "site_governance_model", "content_operations_governor",
    "taxonomy_structure_governor", "commercial_inventory_governor",
    "technical_configuration_governor", "safe_execution_governor",
    "content_operations_scope", "taxonomy_structure_scope",
    "commercial_inventory_scope", "technical_configuration_scope",
    "safe_execution_policy", "default_change_mode", "destructive_change_policy",
    "site_stack_schema_version", "governance_schema_version", "starter_pack_profile",
    "site_stack_validation_status", "governance_readiness_status",
    "site_framework_profile", "site_management_profile", "starter_pack_selection_mode",
    "hosting_provider", "hosting_account_key", "hostinger_api_target_key",
    "server_environment_label", "server_environment_type",
    "server_region_or_datacenter", "server_primary_domain", "server_panel_reference",
    "hosting_account_registry_ref", "primary_site_key", "site_count",
    "site_resolution_rule", "default_wp_api_base", "default_post_type_slug",
    "default_language", "active_languages", "translation_plugin", "translation_mode",
    "site_specific_cpt_baseline_ref", "site_specific_payload_template_ref",
    "draft_failure_policy", "publish_failure_policy", "batch_create_allowed",
    "batch_update_allowed", "batch_delete_allowed", "batch_max_size",
    "resolver_source", "resolver_status", "resolver_last_checked_at",
    "resolver_writeback_status", "resolver_contract_ref", "resolver_provider_target_key",
    "runtime_scope_class", "language_scope_class", "site_settings_scope_class",
    "plugin_inventory_scope_class", "plugin_state_scope_class",
    "brand_onboarding_scope_status", "site_runtime_inventory_ref",
    "language_coverage_ref", "site_settings_inventory_ref", "plugin_inventory_ref",
    "plugin_state_ref", "control_state_derivation_mode", "control_state_last_validated_at",
  ],
  // ── Live header: 20 cols (Brand Core Registry) ────────────────────────────
  brand_core: [
    "Brand Name", "Asset Type", "Document Name", "Google Drive Link",
    "Core Function", "Used By Systems", "Priority", "Notes",
    "brand_key", "asset_key", "asset_class", "authoritative_home",
    "read_priority", "mirror_policy", "linked_json_mirror_refs",
    "validation_status", "active_status", "registry_role", "doc_id", "status",
  ],
  // ── Live header: 47 cols (Actions Registry) ───────────────────────────────
  actions: [
    "action_id", "action_key", "action_title", "action_class", "action_scope",
    "trigger_phrase", "route_target", "module_binding", "connector_family",
    "execution_layer", "dependencies", "logging_target", "status",
    "inventory_role", "openai_action_binding", "endpoint_group", "review_required",
    "notes", "openai_schema_ref", "openai_schema_file_id", "api_key_mode",
    "api_key_param_name", "api_key_header_name", "oauth_config_ref",
    "oauth_config_file_id", "oauth_config_file_name", "secret_store_ref",
    "api_key_value", "api_key_storage_mode", "openai_schema_file_name",
    "openai_schema_storage_surface", "runtime_capability_class", "runtime_callable",
    "primary_executor", "required_variable_contracts", "runtime_binding_profile",
    "client_interface_agnostic", "request_envelope_required",
    "structured_api_supported", "conversational_trigger_supported",
    "provider_agnostic", "allowed_actor_roles", "allowed_governance_levels",
    "client_allowed", "team_allowed", "admin_only", "writeback_scope",
  ],
  // ── Live header: 58 cols (API Actions Endpoint Registry) ─────────────────
  endpoints: [
    "endpoint_id", "parent_action_key", "endpoint_key", "endpoint_title",
    "provider_domain", "provider_family", "method", "endpoint_operation",
    "endpoint_path_or_function", "route_target", "module_binding",
    "connector_family", "execution_layer", "dependencies", "logging_target",
    "status", "category_group", "category_detail", "inventory_role",
    "inventory_source", "openai_action_name", "spec_validation_status",
    "auth_validation_status", "privacy_validation_status", "execution_readiness",
    "last_reviewed_at", "legacy_status", "fallback_allowed", "fallback_match_basis",
    "fallback_provider_domain", "fallback_connector_family", "fallback_action_name",
    "fallback_route_target", "fallback_notes", "notes", "brand_resolution_source",
    "transport_action_key", "endpoint_role", "execution_mode", "transport_required",
    "required_variable_contracts", "runtime_binding_profile",
    "child_openai_schema_file_id", "schema_overlay_mode", "schema_overlay_status",
    "schema_overlay_parent_action_key", "schema_overlay_notes",
    "client_interface_agnostic", "request_envelope_required",
    "structured_api_supported", "conversational_trigger_supported",
    "provider_agnostic", "allowed_actor_roles", "allowed_governance_levels",
    "client_allowed", "team_allowed", "admin_only", "writeback_scope",
  ],
  // ── Live header: 8 cols — unchanged ──────────────────────────────────────
  execution_policies: [
    "policy_group", "policy_key", "policy_value", "active",
    "execution_scope", "affects_layer", "blocking", "notes",
  ],
  // ── Live header: 27 cols — unchanged ─────────────────────────────────────
  hosting_accounts: [
    "hosting_account_key", "hosting_provider", "account_identifier",
    "api_auth_mode", "api_key_reference", "api_key_storage_mode",
    "plan_label", "plan_type", "account_scope_notes", "status",
    "last_reviewed_at", "brand_sites_json", "resolver_target_keys_json",
    "auth_validation_status", "endpoint_binding_status",
    "resolver_execution_ready", "last_runtime_check_at", "ssh_available",
    "wp_cli_available", "shared_access_enabled", "account_mode",
    "ssh_host", "ssh_port", "ssh_username", "ssh_auth_mode",
    "ssh_credential_reference", "ssh_runtime_notes",
  ],
  // ── Live header: 11 cols — unchanged ─────────────────────────────────────
  site_runtime_inventory: [
    "target_key", "brand_name", "brand_domain", "base_url", "site_type",
    "supported_cpts", "supported_taxonomies", "generated_endpoint_support",
    "runtime_validation_status", "last_runtime_validated_at", "active_status",
  ],
  // ── Live header: 12 cols — unchanged ─────────────────────────────────────
  site_settings_inventory: [
    "target_key", "brand_name", "brand_domain", "base_url", "site_type",
    "permalink_structure", "timezone_string", "site_language", "active_theme",
    "settings_validation_status", "last_settings_validated_at", "active_status",
  ],
  // ── Live header: 12 cols — unchanged ─────────────────────────────────────
  plugins: [
    "target_key", "brand_name", "brand_domain", "base_url", "site_type",
    "active_plugins", "plugin_versions_json", "plugin_owned_tables",
    "plugin_owned_entities", "plugin_validation_status",
    "last_plugin_validated_at", "active_status",
  ],
  // ── Business Activity Type Registry ──────────────────────────────────────
  business_activity_types: [
    "business_activity_type_key", "activity_key", "business_type_key",
    "label", "parent_activity_type", "default_knowledge_profile_key",
    "supported_engine_categories", "supported_route_keys", "supported_workflows",
    "brand_core_required", "status", "notes", "active",
  ],
  // ── Business Type Knowledge Profiles ─────────────────────────────────────
  business_type_profiles: [
    "business_type_key", "knowledge_profile_key", "supported_engine_categories",
    "authoritative_read_home", "business_type_specific_read_home",
    "shared_knowledge_read_home", "compatible_route_keys", "compatible_workflows",
    "profile_status", "notes", "active",
  ],
  // ── Brand Path Resolver ───────────────────────────────────────────────────
  brand_paths: [
    "brand_key", "normalized_brand_name", "business_type_key",
    "knowledge_profile_key", "brand_folder_id", "brand_folder_path",
    "brand_core_docs_json", "target_key", "base_url", "status", "active",
  ],
  // ── Live header: 47 cols (Task Routes) ───────────────────────────────────
  task_routes: [
    "Task Key", "Trigger Terms", "Route Modules", "Execution Layer",
    "Priority", "Enabled", "Output Focus", "Notes", "Entry Sources",
    "Linked Starter Titles", "Active Starter Count", "Route Key Match Status",
    "row_id", "route_id", "active", "intent_key", "brand_scope",
    "request_type", "route_mode", "target_module", "workflow_key",
    "lifecycle_mode", "memory_required", "logging_required", "review_required",
    "allowed_states", "degraded_action", "blocked_action",
    "match_rule", "route_source", "last_validated_at",
    "required_variable_profile", "variable_contract_group",
    "supported_ingress_channels", "requires_conversational_inference",
    "supports_structured_api_calls", "supported_model_providers",
    "allowed_actor_roles", "allowed_governance_levels",
    "client_allowed", "team_allowed", "admin_only", "brand_scope_enforced",
    "supported_languages", "translation_step_required", "locale_sensitive",
  ],
  // ── Live header: 53 cols (Workflow Registry) ─────────────────────────────
  workflows: [
    "Workflow ID", "Workflow Name", "Module Mode", "Trigger Source",
    "Input Type", "Primary Objective", "Mapped Engine(s)", "Engine Order",
    "Workflow Type", "Primary Output", "Input Detection Rules",
    "Output Template", "Priority", "Route Key", "Execution Mode",
    "User Facing", "Parent Layer", "Status", "Linked Workflows",
    "Linked Engines", "Notes", "Entry Priority Weight", "Dependency Type",
    "Output Artifact Type", "workflow_key", "active", "target_module",
    "execution_class", "lifecycle_mode", "route_compatibility",
    "memory_required", "logging_required", "review_required", "allowed_states",
    "degraded_action", "blocked_action", "registry_source", "last_validated_at",
    "required_variable_profile", "input_contract_profile",
    "supported_ingress_channels", "supports_structured_api_calls",
    "supported_model_providers", "model_adapter_required",
    "allowed_actor_roles", "allowed_governance_levels",
    "client_allowed", "team_allowed", "admin_only", "brand_scope_enforced",
    "supported_languages", "translation_step_required", "locale_sensitive",
  ],
  // ── Live header: 38 cols (Registry Surfaces Catalog) ─────────────────────
  registry_surfaces_catalog: [
    "surface_id", "surface_name", "surface_type", "surface_scope",
    "storage_type", "file_id", "worksheet_name", "worksheet_gid",
    "folder_id", "parent_surface_id", "active_status", "authority_status",
    "required_for_execution", "resolution_rule", "owner_layer", "notes",
    "schema_ref", "schema_version", "header_signature", "expected_column_count",
    "binding_mode", "sheet_role", "audit_mode", "formula_audit_required",
    "projection_audit_required", "control_metric_audit_required",
    "write_target_audit_required", "legacy_surface_containment_required",
    "source_surface_id", "source_surface_role", "repair_candidate_types",
    "repair_priority", "retired_replacement_surface_id", "logical_surface_key",
    "backend_type", "backend_adapter", "authority_model", "portability_class",
  ],
  // ── Live header: 66 cols (Validation & Repair Registry) ──────────────────
  validation_repair: [
    "validation_id", "surface_id", "surface_name", "rule_id",
    "validation_type", "validation_method", "validation_status",
    "required_for_execution", "result_state", "repair_required",
    "repair_handler", "repair_stage", "owner_layer", "last_validated_at",
    "summary", "schema_validation_status", "header_match_status",
    "binding_repair_required", "binding_last_checked_at", "readback_status",
    "source_surface", "governance_profile", "presence_status",
    "header_contract_status", "row_logic_status", "cross_surface_status",
    "coverage_status", "pipeline_validation_status", "binding_resolution_status",
    "schema_resolution_status", "header_resolution_status",
    "row_logic_resolution_status", "execution_readiness_status",
    "writeback_coverage_status", "pipeline_drift_detected",
    "last_pipeline_validated_at", "repair_recommended", "repair_owner",
    "notes", "severity", "stability_band", "review_window", "blocking_reason",
    "confidence_score", "predicted_drift_checked_at", "predicted_drift_detected",
    "drift_prediction_notes", "sheet_role", "audit_mode",
    "formula_integrity_status", "projection_integrity_status",
    "control_metric_status", "write_target_integrity_status",
    "legacy_containment_status", "broken_reference_detected",
    "deprecated_column_dependency_detected", "source_surface_validation_status",
    "repair_type", "repair_handler_ext", "readback_required",
    "repair_scope_notes", "interface_coupling_status", "model_coupling_status",
    "storage_coupling_status", "backend_adapter_alignment_status",
    "logical_surface_portability_status",
  ],
  // ── Live header: 17 cols — unchanged ─────────────────────────────────────
  json_assets: [
    "asset_id", "brand_name", "asset_key", "asset_type", "cpt_slug",
    "mapping_status", "mapping_version", "storage_format", "google_drive_link",
    "source_mode", "source_asset_ref", "json_payload", "transport_status",
    "validation_status", "last_validated_at", "notes", "active_status",
  ],
  // ── Activity Log Workbook (ACTIVITY_LOG_SPREADSHEET_ID) ───────────────────
  execution_log: [
    "Run Date", "Start Time", "End Time", "Duration Seconds", "Entry Type",
    "Execution Class", "Source Layer", "User Input", "Matched Aliases",
    "Route Key(s)", "Selected Workflows", "Engine Chain", "Execution Mode",
    "Decision Trigger", "Score Before", "Score After", "Performance Delta",
    "Execution Status", "Output Summary", "Recovery Status", "Recovery Score",
    "Recovery Notes", "route_id", "route_status", "route_source",
    "matched_row_id", "intake_validation_status", "execution_ready_status",
    "failure_reason", "recovery_action", "artifact_json_asset_id",
    "target_module_writeback", "target_workflow_writeback",
    "execution_trace_id_writeback", "log_source_writeback",
    "monitored_row_writeback", "performance_impact_row_writeback",
    "used_logic_id", "used_logic_name", "resolved_logic_doc_id",
    "resolved_logic_mode", "logic_pointer_resolution_status",
    "logic_knowledge_status", "logic_rollback_status",
    "logic_association_status", "used_engine_names",
    "used_engine_registry_refs", "used_engine_file_ids",
    "engine_resolution_status", "engine_association_status",
    "retired_shadow_target_module", "retired_shadow_target_workflow",
    "retired_shadow_execution_trace_id", "retired_shadow_log_source",
    "retired_shadow_monitored_row", "retired_shadow_performance_impact_row",
  ],
};

// ── Column name normalisation ──────────────────────────────────────────────────
// "Route Key(s)" → "route_keys"  |  "Brand Name" → "brand_name"
function toSqlCol(name) {
  return name
    .toLowerCase()
    .replace(/\(s\)/g, "s")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

// ── Reverse maps: sql_col → original sheet col name, built once at load ────────
const REVERSE_MAP = {};
for (const [table, cols] of Object.entries(SHEET_COLUMNS)) {
  REVERSE_MAP[table] = {};
  for (const col of cols) {
    REVERSE_MAP[table][toSqlCol(col)] = col;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function resolveTable(sheetName) {
  const table = TABLE_MAP[sheetName];
  if (!table) throw new Error(`sqlAdapter: unknown sheet "${sheetName}"`);
  return table;
}

function sqlRowToSheetRow(table, sqlRow) {
  const map = REVERSE_MAP[table] || {};
  const result = {};
  for (const [col, val] of Object.entries(sqlRow)) {
    const sheetCol = map[col] || col;
    result[sheetCol] = val == null ? "" : String(val);
  }
  return result;
}

function sheetRowToSqlPairs(table, rowObject) {
  const cols = SHEET_COLUMNS[table] || [];
  const sqlCols = [];
  const vals = [];
  for (const col of cols) {
    const sqlCol = toSqlCol(col);
    // Accept the value keyed by either the sheet name or the sql name
    const val = col in rowObject ? rowObject[col]
              : sqlCol in rowObject ? rowObject[sqlCol]
              : undefined;
    if (val !== undefined) {
      sqlCols.push(sqlCol);
      vals.push(val === "" ? null : val);
    }
  }
  return { sqlCols, vals };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function readTable(sheetName) {
  const table = resolveTable(sheetName);
  return cachedSqlTableRead(table, "sheet_rows", async () => {
    const [rows] = await getPool().query(
      `SELECT * FROM \`${table}\` ORDER BY id`
    );
    return rows.map(({ id, created_at, updated_at, ...rest }) =>
      sqlRowToSheetRow(table, rest)
    );
  });
}

// Returns rows with raw snake_case SQL column names — no sheet-name reverse-mapping.
export async function readTableDirect(sheetName) {
  const table = resolveTable(sheetName);
  return cachedSqlTableRead(table, "direct_rows", async () => {
    const [rows] = await getPool().query(
      `SELECT * FROM \`${table}\` ORDER BY id`
    );
    return rows.map(({ id, created_at, updated_at, ...rest }) => rest);
  });
}

export async function appendRow(sheetName, rowObject) {
  const table = resolveTable(sheetName);
  const { sqlCols, vals } = sheetRowToSqlPairs(table, rowObject);
  if (!sqlCols.length) return null;
  const placeholders = sqlCols.map(() => "?").join(", ");
  const colList = sqlCols.map((c) => `\`${c}\``).join(", ");
  const [result] = await getPool().query(
    `INSERT INTO \`${table}\` (${colList}) VALUES (${placeholders})`,
    vals
  );
  await invalidateSqlTableCache(table);
  return result.insertId;
}

export async function updateRow(sheetName, rowObject, id) {
  const table = resolveTable(sheetName);
  const { sqlCols, vals } = sheetRowToSqlPairs(table, rowObject);
  if (!sqlCols.length) return;
  const setClause = sqlCols.map((c) => `\`${c}\` = ?`).join(", ");
  await getPool().query(
    `UPDATE \`${table}\` SET ${setClause} WHERE id = ?`,
    [...vals, id]
  );
}

export async function deleteRow(sheetName, id) {
  const table = resolveTable(sheetName);
  await getPool().query(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);
}

export async function findRows(sheetName, whereColSheet, value) {
  const table = resolveTable(sheetName);
  const col = toSqlCol(whereColSheet);
  const [rows] = await getPool().query(
    `SELECT * FROM \`${table}\` WHERE \`${col}\` = ? ORDER BY id`,
    [value]
  );
  return rows.map(({ id, created_at, updated_at, ...rest }) =>
    sqlRowToSheetRow(table, rest)
  );
}

// Bulk insert — used by the migrator script. Processes in chunks of 100 rows.
export async function bulkInsertRows(sheetName, rows, { ignore = false } = {}) {
  if (!rows.length) return 0;
  const table = resolveTable(sheetName);
  const sheetCols = SHEET_COLUMNS[table] || [];
  if (!sheetCols.length) return 0;

  const sqlCols = sheetCols.map(toSqlCol);
  const colList = sqlCols.map((c) => `\`${c}\``).join(", ");
  const rowPlaceholder = `(${sqlCols.map(() => "?").join(", ")})`;
  const keyword = ignore ? "INSERT IGNORE INTO" : "INSERT INTO";
  const CHUNK = 100;
  let total = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => rowPlaceholder).join(", ");
    const vals = chunk.flatMap((row) =>
      sheetCols.map((col) => {
        const v = col in row ? row[col] : (toSqlCol(col) in row ? row[toSqlCol(col)] : null);
        return v === "" ? null : (v ?? null);
      })
    );
    const [result] = await getPool().query(
      `${keyword} \`${table}\` (${colList}) VALUES ${placeholders}`,
      vals
    );
    total += result.affectedRows;
  }
  return total;
}

export async function clearTable(sheetName) {
  const table = resolveTable(sheetName);
  await getPool().query(`TRUNCATE TABLE \`${table}\``);
}

// Like readTable but keeps the auto-increment `id` so callers can UPDATE by it.
export async function readTableRaw(sheetName) {
  const table = resolveTable(sheetName);
  const [rows] = await getPool().query(
    `SELECT * FROM \`${table}\` ORDER BY id`
  );
  return rows.map(({ id, created_at, updated_at, ...rest }) => ({
    id,
    ...sqlRowToSheetRow(table, rest)
  }));
}

// Update a row by its auto-increment id using sheet-style column names.
export async function updateRowById(sheetName, rowObject, id) {
  const table = resolveTable(sheetName);
  const { sqlCols, vals } = sheetRowToSqlPairs(table, rowObject);
  if (!sqlCols.length) return;
  const setClause = sqlCols.map((c) => `\`${c}\` = ?`).join(", ");
  await getPool().query(
    `UPDATE \`${table}\` SET ${setClause} WHERE id = ?`,
    [...vals, id]
  );
}

export { TABLE_MAP, SHEET_COLUMNS };
