import { readTable as sqlReadTable } from "./sqlAdapter.js";

const ENDPOINT_REGISTRY_SQL_TABLE = "API Actions Endpoint Registry";

export function shouldReadEndpointRegistryFromSql(env = process.env) {
  const source = String(env.ENDPOINT_REGISTRY_SOURCE || env.DATA_SOURCE || "sql")
    .trim()
    .toLowerCase();
  const legacySheetsEnabled =
    String(env.LEGACY_SHEET_ENDPOINT_REGISTRY_ENABLED || "false")
      .trim()
      .toLowerCase() === "true";

  // SQL is the default endpoint registry authority.
  // Legacy Sheets reads require both flags so accidental Sheets fallback does not
  // hide new SQL registry rows.
  return source !== "sheets" || !legacySheetsEnabled;
}

function normalizeEndpointRegistryRow(row = {}) {
  return {
    ...row,
    endpoint_id: row.endpoint_id ?? row.endpointId ?? "",
    parent_action_key: row.parent_action_key ?? row.parentActionKey ?? "",
    endpoint_key: row.endpoint_key ?? row.endpointKey ?? "",
    endpoint_operation: row.endpoint_operation ?? row.endpointOperation ?? "",
    provider_domain: row.provider_domain ?? row.providerDomain ?? "",
    method: row.method ?? "",
    endpoint_path_or_function: row.endpoint_path_or_function ?? row.endpointPathOrFunction ?? "",
    route_target: row.route_target ?? row.routeTarget ?? "",
    openai_action_name: row.openai_action_name ?? row.openaiActionName ?? "",
    module_binding: row.module_binding ?? row.moduleBinding ?? "",
    connector_family: row.connector_family ?? row.connectorFamily ?? "",
    status: row.status ?? "",
    spec_validation_status: row.spec_validation_status ?? row.specValidationStatus ?? "",
    auth_validation_status: row.auth_validation_status ?? row.authValidationStatus ?? "",
    privacy_validation_status: row.privacy_validation_status ?? row.privacyValidationStatus ?? "",
    execution_readiness: row.execution_readiness ?? row.executionReadiness ?? "",
    endpoint_role: row.endpoint_role ?? row.endpointRole ?? "",
    execution_mode: row.execution_mode ?? row.executionMode ?? "",
    transport_required: row.transport_required ?? row.transportRequired ?? "",
    fallback_allowed: row.fallback_allowed ?? row.fallbackAllowed ?? "",
    fallback_match_basis: row.fallback_match_basis ?? row.fallbackMatchBasis ?? "",
    fallback_provider_domain: row.fallback_provider_domain ?? row.fallbackProviderDomain ?? "",
    fallback_connector_family: row.fallback_connector_family ?? row.fallbackConnectorFamily ?? "",
    fallback_action_name: row.fallback_action_name ?? row.fallbackActionName ?? "",
    fallback_route_target: row.fallback_route_target ?? row.fallbackRouteTarget ?? "",
    fallback_notes: row.fallback_notes ?? row.fallbackNotes ?? "",
    inventory_role: row.inventory_role ?? row.inventoryRole ?? "",
    inventory_source: row.inventory_source ?? row.inventorySource ?? "",
    notes: row.notes ?? "",
    brand_resolution_source: row.brand_resolution_source ?? row.brandResolutionSource ?? "",
    transport_action_key: row.transport_action_key ?? row.transportActionKey ?? "",
    endpoint_title: row.endpoint_title ?? row.endpointTitle ?? "",
    provider_family: row.provider_family ?? row.providerFamily ?? "",
    execution_layer: row.execution_layer ?? row.executionLayer ?? "",
    dependencies: row.dependencies ?? "",
    logging_target: row.logging_target ?? row.loggingTarget ?? "",
    category_group: row.category_group ?? row.categoryGroup ?? "",
    category_detail: row.category_detail ?? row.categoryDetail ?? "",
    required_variable_contracts: row.required_variable_contracts ?? row.requiredVariableContracts ?? "",
    runtime_binding_profile: row.runtime_binding_profile ?? row.runtimeBindingProfile ?? "",
    schema_json: row.schema_json ?? row.schemaJson ?? "",
    client_interface_agnostic: row.client_interface_agnostic ?? row.clientInterfaceAggnostic ?? "",
    request_envelope_required: row.request_envelope_required ?? row.requestEnvelopeRequired ?? "",
    structured_api_supported: row.structured_api_supported ?? row.structuredApiSupported ?? "",
    conversational_trigger_supported: row.conversational_trigger_supported ?? row.conversationalTriggerSupported ?? "",
    provider_agnostic: row.provider_agnostic ?? row.providerAgnostic ?? "",
    allowed_actor_roles: row.allowed_actor_roles ?? row.allowedActorRoles ?? "",
    allowed_governance_levels: row.allowed_governance_levels ?? row.allowedGovernanceLevels ?? "",
    client_allowed: row.client_allowed ?? row.clientAllowed ?? "",
    team_allowed: row.team_allowed ?? row.teamAllowed ?? "",
    admin_only: row.admin_only ?? row.adminOnly ?? "",
    writeback_scope: row.writeback_scope ?? row.writebackScope ?? ""
  };
}

export async function loadSqlEndpointRegistry({ readTable = sqlReadTable } = {}) {
  const rows = await readTable(ENDPOINT_REGISTRY_SQL_TABLE);
  return rows
    .map(normalizeEndpointRegistryRow)
    .filter(row => String(row.endpoint_key || "").trim());
}
