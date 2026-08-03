import crypto from "node:crypto";

import { AUTHORITY_EVIDENCE_SOURCE_FAMILIES } from "./authorityEvidenceSourceAdapters.js";

export const AUTHORITY_LIVE_SOURCE_ROW_LIMIT = 8192;

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,190}$/;
const SAFE_ROUTE = /^\/[A-Za-z0-9_./:{}-]{0,510}$/;
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SOURCE_FAMILIES = new Set(AUTHORITY_EVIDENCE_SOURCE_FAMILIES);
const SENSITIVE_KEY_PATTERN = /(secret|password|private[_-]?key|access[_-]?token|refresh[_-]?token|credential[_-]?payload|authorization[_-]?header)/i;

export class AuthorityLiveSourceCollectorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AuthorityLiveSourceCollectorError";
    this.code = code;
    this.details = details;
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function assertNoSensitiveValues(value, path = "root", seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key) && nested !== false && nested !== null && nested !== undefined) {
      throw new AuthorityLiveSourceCollectorError(
        "authority_live_source_sensitive_value_forbidden",
        "Live source evidence must not contain secret-bearing values.",
        { path: `${path}.${key}` },
      );
    }
    assertNoSensitiveValues(nested, `${path}.${key}`, seen);
  }
}

function token(value, field = "identifier") {
  const normalized = String(value ?? "").trim();
  if (!SAFE_TOKEN.test(normalized)) {
    throw new AuthorityLiveSourceCollectorError(
      "authority_live_source_invalid_token",
      `${field} must be a non-empty bounded canonical token.`,
      { field, value: normalized || null },
    );
  }
  return normalized;
}

function optionalToken(value, field) {
  return value === null || value === undefined || String(value).trim() === ""
    ? null
    : token(value, field);
}

function strictHttpIdentity(routeValue, methodValue, field) {
  const route = String(routeValue ?? "").trim();
  const method = String(methodValue ?? "").trim().toUpperCase();
  if (!route || !method) {
    throw new AuthorityLiveSourceCollectorError(
      "authority_live_source_incomplete_http_identity",
      `${field} must include both route and method.`,
      { field, route: route || null, method: method || null },
    );
  }
  if (!SAFE_ROUTE.test(route) || !HTTP_METHODS.has(method)) {
    throw new AuthorityLiveSourceCollectorError(
      "authority_live_source_invalid_http_identity",
      `${field} contains an invalid route or method.`,
      { field, route, method },
    );
  }
  return { route, method };
}

function endpointHttpIdentity(routeValue, methodValue, field) {
  const route = String(routeValue ?? "").trim();
  const method = String(methodValue ?? "").trim().toUpperCase();
  if (!route && !method) return { route: null, method: null };
  if (route.startsWith("/")) return strictHttpIdentity(route, method, field);
  if (!route || !method) {
    throw new AuthorityLiveSourceCollectorError(
      "authority_live_source_incomplete_endpoint_identity",
      `${field} must preserve a complete route/method pair or a complete non-route endpoint identity.`,
      { field, route: route || null, method: method || null },
    );
  }
  return { route: null, method: null };
}

function activeStatus(value) {
  if (value === true || Number(value) === 1) return "active";
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["active", "enabled", "ready", "callable"].includes(normalized)) return "active";
  if (normalized === "deprecated") return "deprecated";
  if (["blocked", "disabled", "inactive", "archived", "0", "false"].includes(normalized)) return "inactive";
  return "unknown";
}

function operationMode(method, explicitMode) {
  const normalized = String(explicitMode ?? "").trim().toLowerCase();
  if (["read_only", "preview", "shadow", "plan", "mutation", "internal"].includes(normalized)) return normalized;
  if (method && READ_METHODS.has(method)) return "read_only";
  if (method) return "mutation";
  return "internal";
}

function requirements(mode, authorityMode) {
  const consequential = mode === "mutation" || mode === "plan";
  return {
    approval: consequential && authorityMode === "admin_only",
    typed_confirmation: false,
    capability_envelope: consequential,
    idempotency: consequential,
    readback: consequential,
    rollback: mode === "mutation",
  };
}

function baseRecord({
  pathKey,
  canonicalToolKey = null,
  route = null,
  method = null,
  surfaceFamily,
  sourceRegistry,
  handlerKey,
  authorityMode,
  explicitOperationMode,
  status,
  riskClass,
  revisionSource,
  freshnessSource,
  revocationSource,
  aliases = [],
}) {
  const mode = operationMode(method, explicitOperationMode);
  return {
    path_key: token(pathKey, "path_key"),
    canonical_tool_key: optionalToken(canonicalToolKey, "canonical_tool_key"),
    route,
    method,
    surface_family: token(surfaceFamily, "surface_family"),
    source_registry: token(sourceRegistry, "source_registry"),
    handler_key: token(handlerKey, "handler_key"),
    authority_mode: authorityMode,
    operation_mode: mode,
    callability: status === "active" ? "authorization_gated" : status === "deprecated" ? "deprecated" : "blocked",
    status,
    actor_source: authorityMode === "admin_only" ? "platform_admin_identity" : "authenticated_principal",
    subject_source: "effective_subject_scope",
    tenant_scope_source: authorityMode === "admin_only" ? "platform_admin_tenant_scope" : "principal_tenant_scope",
    workspace_scope_source: "principal_workspace_scope",
    resource_authority_source: "resource_authority_bindings",
    capability_authority_source: "platform_semantic_capabilities",
    provider_scope_source: "provider_connection_bindings",
    credential_scope_source: "credential_reference_metadata",
    risk_class: riskClass || (mode === "read_only" ? "low" : authorityMode === "admin_only" ? "high" : "medium"),
    revision_source: token(revisionSource, "revision_source"),
    freshness_source: token(freshnessSource, "freshness_source"),
    revocation_source: token(revocationSource, "revocation_source"),
    invalidation_source: "authority_invalidation_events",
    atomicity_policy: mode === "read_only" || mode === "internal" ? "read_only_snapshot" : "same_cycle_readback_required",
    replacement_path_key: null,
    aliases: [...new Set(aliases.filter(Boolean).map((item) => token(item, "alias")))].sort(),
    requirements: requirements(mode, authorityMode),
    credential_payload_read: false,
    secrets_included: false,
  };
}

function mapToolRow(row, sourceRegistry, deviceOnly = false) {
  const scope = token(row.scope_kind, "scope_kind").toLowerCase();
  if (!new Set(["admin", "tenant"]).has(scope)) {
    throw new AuthorityLiveSourceCollectorError(
      "authority_live_source_invalid_scope",
      "Platform endpoint tool rows must declare admin or tenant scope.",
      { scope },
    );
  }
  const authorityMode = scope === "admin" ? "admin_only" : "tenant_only";
  const toolKey = token(row.tool_key, "tool_key");
  const registry = scope === "admin" ? "admin_platform_endpoint_tools" : "tenant_platform_endpoint_tools";
  const tags = String(row.tags ?? "").toLowerCase();
  if (deviceOnly && !tags.split(/[\s,]+/).includes("device")) return null;
  const http = strictHttpIdentity(row.http_path, row.http_method, `${registry}.${toolKey}`);
  return baseRecord({
    pathKey: deviceOnly ? `device-tool.${scope}.${toolKey}` : `system-tool.${scope}.${toolKey}`,
    canonicalToolKey: toolKey,
    ...http,
    surfaceFamily: deviceOnly ? "local_device" : "system_tool",
    sourceRegistry,
    handlerKey: `tool.${toolKey}`,
    authorityMode,
    status: activeStatus(row.is_enabled),
    revisionSource: `${registry}.updated_at`,
    freshnessSource: `${registry}.updated_at`,
    revocationSource: `${registry}.is_enabled`,
  });
}

function mapEndpointRow(row, sourceRegistry) {
  const endpointKey = token(row.endpoint_key, "endpoint_key");
  const http = sourceRegistry === "direct_http_routes"
    ? strictHttpIdentity(row.endpoint_path_or_function, row.method, `endpoints.${endpointKey}`)
    : endpointHttpIdentity(row.endpoint_path_or_function, row.method, `endpoints.${endpointKey}`);
  const authorityMode = http.route?.startsWith("/admin/") ? "admin_only" : "shared";
  return baseRecord({
    pathKey: `endpoint.${endpointKey}`,
    canonicalToolKey: optionalToken(row.openai_action_name, "openai_action_name") || endpointKey,
    ...http,
    surfaceFamily: "endpoint_catalog",
    sourceRegistry,
    handlerKey: optionalToken(row.route_target, "route_target")
      || optionalToken(row.module_binding, "module_binding")
      || endpointKey,
    authorityMode,
    explicitOperationMode: row.execution_mode,
    status: activeStatus(row.status),
    revisionSource: "endpoints.updated_at",
    freshnessSource: "endpoints.updated_at",
    revocationSource: "endpoints.status",
    aliases: [row.openai_action_name, row.parent_action_key].filter(Boolean),
  });
}

function mapActionRow(row) {
  const actionKey = token(row.action_key, "action_key");
  return baseRecord({
    pathKey: `action.${actionKey}`,
    canonicalToolKey: actionKey,
    surfaceFamily: "runtime_action",
    sourceRegistry: "runtime_action_registry",
    handlerKey: optionalToken(row.primary_executor, "primary_executor")
      || optionalToken(row.module_binding, "module_binding")
      || actionKey,
    authorityMode: "shared",
    explicitOperationMode: "internal",
    status: activeStatus(row.status),
    revisionSource: "actions.updated_at",
    freshnessSource: "actions.updated_at",
    revocationSource: "actions.status",
  });
}

function mapDescriptorRow(row) {
  const exportKey = token(row.export_key, "export_key");
  const toolName = token(row.tool_name, "tool_name");
  return baseRecord({
    pathKey: `descriptor.${exportKey}`,
    canonicalToolKey: toolName,
    surfaceFamily: "descriptor_catalog",
    sourceRegistry: "descriptor_catalog",
    handlerKey: `descriptor.${exportKey}`,
    authorityMode: "shared",
    explicitOperationMode: "internal",
    status: activeStatus(row.status),
    revisionSource: "platform_endpoint_tool_exports.updated_at",
    freshnessSource: "platform_endpoint_tool_exports.updated_at",
    revocationSource: "platform_endpoint_tool_exports.status",
    aliases: [row.endpoint_key, row.parent_action_key].filter(Boolean),
  });
}

function mapProviderBindingRow(row) {
  const bindingId = token(row.binding_id, "binding_id");
  const bindingKind = token(row.binding_kind, "binding_kind");
  const bindingTable = token(row.binding_table, "binding_table");
  const canonicalToolKey = optionalToken(row.action_key, "action_key")
    || optionalToken(row.tool_key, "tool_key");
  if (!canonicalToolKey) {
    throw new AuthorityLiveSourceCollectorError(
      "authority_live_source_binding_target_missing",
      "Provider bindings must identify exactly one action or tool target.",
      { binding_id: bindingId },
    );
  }
  return baseRecord({
    pathKey: `provider-binding.${bindingId}`,
    canonicalToolKey,
    surfaceFamily: "provider_binding",
    sourceRegistry: "provider_binding_catalog",
    handlerKey: `${bindingKind}.${bindingId}`,
    authorityMode: "shared",
    explicitOperationMode: "internal",
    status: activeStatus(row.status),
    revisionSource: `${bindingTable}.updated_at`,
    freshnessSource: `${bindingTable}.updated_at`,
    revocationSource: `${bindingTable}.status`,
    aliases: [row.app_key, row.tool_surface].filter(Boolean),
  });
}

function mapAliasRow(row) {
  const endpointKey = token(row.endpoint_key, "endpoint_key");
  const alias = token(row.alias_key, "alias_key");
  const http = endpointHttpIdentity(row.endpoint_path_or_function, row.method, `alias.${endpointKey}.${alias}`);
  return baseRecord({
    pathKey: `compatibility-alias.${endpointKey}.${alias}`,
    canonicalToolKey: endpointKey,
    ...http,
    surfaceFamily: "compatibility_alias",
    sourceRegistry: "compatibility_alias_registry",
    handlerKey: optionalToken(row.route_target, "route_target") || `alias.${alias}`,
    authorityMode: http.route?.startsWith("/admin/") ? "admin_only" : "shared",
    status: activeStatus(row.status),
    revisionSource: "endpoints.updated_at",
    freshnessSource: "endpoints.updated_at",
    revocationSource: "endpoints.status",
    aliases: [alias],
  });
}

const SOURCE_QUERIES = Object.freeze({
  system_tool_registry: {
    queryKey: "system_tool_registry",
    sql: "SELECT 'admin' AS scope_kind, tool_key, http_method, http_path, tags, is_enabled FROM admin_platform_endpoint_tools UNION ALL SELECT 'tenant' AS scope_kind, tool_key, http_method, http_path, tags, is_enabled FROM tenant_platform_endpoint_tools ORDER BY scope_kind, tool_key LIMIT 8193",
    mapper: (row) => mapToolRow(row, "system_tool_registry", false),
  },
  admin_endpoint_catalog: {
    queryKey: "admin_endpoint_catalog",
    sql: "SELECT endpoint_id, endpoint_key, parent_action_key, method, endpoint_path_or_function, route_target, openai_action_name, module_binding, status, execution_mode FROM endpoints ORDER BY endpoint_key LIMIT 8193",
    mapper: (row) => mapEndpointRow(row, "admin_endpoint_catalog"),
  },
  direct_http_routes: {
    queryKey: "direct_http_routes",
    sql: "SELECT endpoint_id, endpoint_key, parent_action_key, method, endpoint_path_or_function, route_target, openai_action_name, module_binding, status, execution_mode FROM endpoints WHERE endpoint_path_or_function LIKE '/%' ORDER BY method, endpoint_path_or_function, endpoint_key LIMIT 8193",
    mapper: (row) => mapEndpointRow(row, "direct_http_routes"),
  },
  runtime_action_registry: {
    queryKey: "runtime_action_registry",
    sql: "SELECT action_key, status, module_binding, connector_family, runtime_callable, primary_executor FROM actions ORDER BY action_key LIMIT 8193",
    mapper: mapActionRow,
  },
  descriptor_catalog: {
    queryKey: "descriptor_catalog",
    sql: "SELECT export_key, parent_action_key, endpoint_key, tool_name, status FROM platform_endpoint_tool_exports ORDER BY export_key LIMIT 8193",
    mapper: mapDescriptorRow,
  },
  provider_binding_catalog: {
    queryKey: "provider_binding_catalog",
    sql: "SELECT 'action' AS binding_kind, 'app_integration_action_bindings' AS binding_table, binding_id, app_key, action_key, NULL AS tool_key, NULL AS tool_surface, status FROM app_integration_action_bindings UNION ALL SELECT 'tool' AS binding_kind, 'app_integration_tool_bindings' AS binding_table, binding_id, app_key, NULL AS action_key, tool_key, tool_surface, status FROM app_integration_tool_bindings ORDER BY binding_kind, binding_id LIMIT 8193",
    mapper: mapProviderBindingRow,
  },
  local_device_catalog: {
    queryKey: "local_device_catalog",
    sql: "SELECT 'admin' AS scope_kind, tool_key, http_method, http_path, tags, is_enabled FROM admin_platform_endpoint_tools WHERE tags LIKE '%device%' UNION ALL SELECT 'tenant' AS scope_kind, tool_key, http_method, http_path, tags, is_enabled FROM tenant_platform_endpoint_tools WHERE tags LIKE '%device%' ORDER BY scope_kind, tool_key LIMIT 8193",
    mapper: (row) => mapToolRow(row, "local_device_catalog", true),
  },
  compatibility_alias_registry: {
    queryKey: "compatibility_alias_registry",
    sql: "SELECT endpoint_key, method, endpoint_path_or_function, route_target, openai_action_name AS alias_key, openai_action_name, NULL AS tool_name, status FROM endpoints WHERE COALESCE(openai_action_name, '') <> '' AND openai_action_name <> endpoint_key UNION ALL SELECT endpoint_key, NULL AS method, NULL AS endpoint_path_or_function, NULL AS route_target, tool_name AS alias_key, NULL AS openai_action_name, tool_name, status FROM platform_endpoint_tool_exports WHERE COALESCE(tool_name, '') <> '' AND tool_name <> endpoint_key ORDER BY endpoint_key, alias_key LIMIT 8193",
    mapper: mapAliasRow,
  },
});

function validateContext(context, family) {
  if (!context || typeof context !== "object" || context.source_family !== family) {
    throw new AuthorityLiveSourceCollectorError(
      "authority_live_source_context_mismatch",
      "Collector context must be bound to the assigned source family.",
      { family },
    );
  }
  if (
    context.read_only !== true
    || context.applies_sql !== false
    || context.provider_calls !== false
    || context.credential_payload_read !== false
    || context.external_writes !== false
    || context.secrets_included !== false
  ) {
    throw new AuthorityLiveSourceCollectorError(
      "authority_live_source_unsafe_context",
      "Collector context must preserve read-only and no-effect markers.",
      { family },
    );
  }
  token(context.operation_ref, "operation_ref");
}

export function createAuthorityLiveSourceCollectors({ queryRows, clock = () => new Date() } = {}) {
  if (typeof queryRows !== "function") {
    throw new AuthorityLiveSourceCollectorError(
      "authority_live_source_query_reader_required",
      "queryRows must be a read-only query function.",
    );
  }
  if (typeof clock !== "function") {
    throw new AuthorityLiveSourceCollectorError(
      "authority_live_source_clock_invalid",
      "clock must be a function.",
    );
  }

  const collectors = {};
  for (const family of AUTHORITY_EVIDENCE_SOURCE_FAMILIES) {
    if (!SOURCE_FAMILIES.has(family) || !SOURCE_QUERIES[family]) {
      throw new AuthorityLiveSourceCollectorError(
        "authority_live_source_plan_incomplete",
        "Every registered source family must have one governed query plan.",
        { family },
      );
    }
    collectors[family] = async (context) => {
      validateContext(context, family);
      const plan = SOURCE_QUERIES[family];
      const observedDate = new Date(clock());
      if (Number.isNaN(observedDate.getTime())) {
        throw new AuthorityLiveSourceCollectorError(
          "authority_live_source_clock_invalid",
          "clock must return a valid timestamp.",
          { family },
        );
      }
      const rows = await queryRows({ queryKey: plan.queryKey, sql: plan.sql, params: [] });
      if (!Array.isArray(rows)) {
        throw new AuthorityLiveSourceCollectorError(
          "authority_live_source_rows_invalid",
          "A governed source query must return a rows array.",
          { family },
        );
      }
      if (rows.length > AUTHORITY_LIVE_SOURCE_ROW_LIMIT) {
        throw new AuthorityLiveSourceCollectorError(
          "authority_live_source_row_limit_exceeded",
          "A governed source query exceeded the fixed row bound.",
          { family, maximum: AUTHORITY_LIVE_SOURCE_ROW_LIMIT, observed: rows.length },
        );
      }
      assertNoSensitiveValues(rows, `rows:${family}`);
      const records = rows.map(plan.mapper).filter(Boolean);
      assertNoSensitiveValues(records, `records:${family}`);
      const operationRef = token(context.operation_ref, "operation_ref");
      return {
        source_family: family,
        source_key: `live.${family}`,
        source_identity: `${operationRef}.${family}.${sha256(records).slice(0, 16)}`,
        observed_at: observedDate.toISOString(),
        pagination: {
          expected_count: records.length,
          observed_count: records.length,
          page_count: 1,
          complete: true,
          next_cursor: null,
        },
        evidence_refs: [`operation:${operationRef}`, `query:${plan.queryKey}`],
        records,
        safety: {
          read_only: true,
          provider_calls: false,
          credential_payload_read: false,
          external_writes: false,
          secrets_included: false,
        },
      };
    };
  }
  return Object.freeze(collectors);
}

export const AUTHORITY_LIVE_SOURCE_QUERY_KEYS = Object.freeze(
  Object.fromEntries(Object.entries(SOURCE_QUERIES).map(([family, plan]) => [family, plan.queryKey])),
);

export const _testingAuthorityLiveSourceCollectors = Object.freeze({
  sha256,
  token,
  strictHttpIdentity,
  endpointHttpIdentity,
  mapToolRow,
  mapEndpointRow,
  mapActionRow,
  mapDescriptorRow,
  mapProviderBindingRow,
  mapAliasRow,
  assertNoSensitiveValues,
});
