import crypto from "node:crypto";

import { AUTHORITY_EVIDENCE_SOURCE_FAMILIES } from "./authorityEvidenceSourceAdapters.js";

export const AUTHORITY_LIVE_SOURCE_ROW_LIMIT = 8192;

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,190}$/;
const SAFE_ROUTE = /^\/[A-Za-z0-9_./:{}-]{0,510}$/;
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const FAMILY_SET = new Set(AUTHORITY_EVIDENCE_SOURCE_FAMILIES);
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

function token(value, fallback) {
  const raw = String(value ?? fallback ?? "").trim();
  const normalized = raw
    .replace(/[^A-Za-z0-9_.:/-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 190);
  if (!SAFE_TOKEN.test(normalized)) {
    throw new AuthorityLiveSourceCollectorError(
      "authority_live_source_invalid_token",
      "A live source identifier could not be normalized into a bounded token.",
      { value: raw || null },
    );
  }
  return normalized;
}

function routeAndMethod(routeValue, methodValue) {
  const route = String(routeValue ?? "").trim();
  const method = String(methodValue ?? "").trim().toUpperCase();
  if (!route || !method) return { route: null, method: null };
  if (!SAFE_ROUTE.test(route) || !new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).has(method)) {
    return { route: null, method: null };
  }
  return { route, method };
}

function activeStatus(value) {
  if (value === true || Number(value) === 1) return "active";
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["active", "enabled", "ready", "callable"].includes(normalized)) return "active";
  if (["deprecated"].includes(normalized)) return "deprecated";
  if (["blocked", "disabled", "inactive", "0", "false"].includes(normalized)) return "inactive";
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
  const mutating = mode === "mutation" || mode === "plan";
  return {
    approval: mutating && authorityMode === "admin_only",
    typed_confirmation: false,
    capability_envelope: mutating,
    idempotency: mutating,
    readback: mutating,
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
    path_key: token(pathKey),
    canonical_tool_key: canonicalToolKey ? token(canonicalToolKey) : null,
    route,
    method,
    surface_family: token(surfaceFamily),
    source_registry: token(sourceRegistry),
    handler_key: token(handlerKey),
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
    revision_source: token(revisionSource),
    freshness_source: token(freshnessSource),
    revocation_source: token(revocationSource),
    invalidation_source: "authority_invalidation_events",
    atomicity_policy: mode === "read_only" || mode === "internal" ? "read_only_snapshot" : "same_cycle_readback_required",
    replacement_path_key: null,
    aliases: [...new Set(aliases.filter(Boolean).map((item) => token(item)))].sort(),
    requirements: requirements(mode, authorityMode),
    credential_payload_read: false,
    secrets_included: false,
  };
}

function mapToolRow(row, sourceRegistry, deviceOnly = false) {
  const scope = String(row.scope_kind ?? "shared").toLowerCase();
  const authorityMode = scope === "admin" ? "admin_only" : scope === "tenant" ? "tenant_only" : "shared";
  const toolKey = token(row.tool_key, "unknown-tool");
  const registry = scope === "admin" ? "admin_platform_endpoint_tools" : "tenant_platform_endpoint_tools";
  const http = routeAndMethod(row.http_path, row.http_method);
  const tags = String(row.tags ?? "").toLowerCase();
  if (deviceOnly && !tags.split(/[\s,]+/).includes("device")) return null;
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
    aliases: [],
  });
}

function mapEndpointRow(row, sourceRegistry) {
  const endpointKey = token(row.endpoint_key, row.endpoint_id || "unknown-endpoint");
  const http = routeAndMethod(row.endpoint_path_or_function, row.method);
  const authorityMode = http.route?.startsWith("/admin/") ? "admin_only" : "shared";
  const status = activeStatus(row.status);
  return baseRecord({
    pathKey: `endpoint.${endpointKey}`,
    canonicalToolKey: row.openai_action_name || endpointKey,
    ...http,
    surfaceFamily: "endpoint_catalog",
    sourceRegistry,
    handlerKey: row.route_target || row.module_binding || endpointKey,
    authorityMode,
    explicitOperationMode: row.execution_mode,
    status,
    revisionSource: "endpoints.updated_at",
    freshnessSource: "endpoints.updated_at",
    revocationSource: "endpoints.status",
    aliases: [row.openai_action_name, row.parent_action_key].filter(Boolean),
  });
}

function mapActionRow(row) {
  const actionKey = token(row.action_key, "unknown-action");
  return baseRecord({
    pathKey: `action.${actionKey}`,
    canonicalToolKey: actionKey,
    surfaceFamily: "runtime_action",
    sourceRegistry: "runtime_action_registry",
    handlerKey: row.primary_executor || row.module_binding || actionKey,
    authorityMode: "shared",
    explicitOperationMode: "internal",
    status: activeStatus(row.status),
    revisionSource: "actions.updated_at",
    freshnessSource: "actions.updated_at",
    revocationSource: "actions.status",
    aliases: [],
  });
}

function mapDescriptorRow(row) {
  const exportKey = token(row.export_key, row.tool_name || "unknown-descriptor");
  const toolName = token(row.tool_name, exportKey);
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
  const bindingId = token(row.binding_id, `${row.binding_kind || "binding"}.${row.app_key || "unknown"}.${row.action_key || row.tool_key || "unknown"}`);
  return baseRecord({
    pathKey: `provider-binding.${bindingId}`,
    canonicalToolKey: row.action_key || row.tool_key || bindingId,
    surfaceFamily: "provider_binding",
    sourceRegistry: "provider_binding_catalog",
    handlerKey: `${row.binding_kind || "binding"}.${bindingId}`,
    authorityMode: "shared",
    explicitOperationMode: "internal",
    status: activeStatus(row.status),
    revisionSource: `${row.binding_table || "app_integration_bindings"}.updated_at`,
    freshnessSource: `${row.binding_table || "app_integration_bindings"}.updated_at`,
    revocationSource: `${row.binding_table || "app_integration_bindings"}.status`,
    aliases: [row.app_key, row.tool_surface].filter(Boolean),
  });
}

function mapAliasRow(row) {
  const endpointKey = token(row.endpoint_key, row.export_key || "unknown-alias");
  const alias = token(row.alias_key, row.openai_action_name || row.tool_name || endpointKey);
  const http = routeAndMethod(row.endpoint_path_or_function, row.method);
  return baseRecord({
    pathKey: `compatibility-alias.${endpointKey}.${alias}`,
    canonicalToolKey: endpointKey,
    ...http,
    surfaceFamily: "compatibility_alias",
    sourceRegistry: "compatibility_alias_registry",
    handlerKey: row.route_target || `alias.${alias}`,
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
}

export function createAuthorityLiveSourceCollectors({ queryRows, clock = () => new Date() } = {}) {
  if (typeof queryRows !== "function") {
    throw new AuthorityLiveSourceCollectorError(
      "authority_live_source_query_reader_required",
      "queryRows must be a read-only query function.",
    );
  }
  const collectors = {};
  for (const family of AUTHORITY_EVIDENCE_SOURCE_FAMILIES) {
    if (!FAMILY_SET.has(family) || !SOURCE_QUERIES[family]) {
      throw new AuthorityLiveSourceCollectorError(
        "authority_live_source_plan_incomplete",
        "Every registered source family must have one governed query plan.",
        { family },
      );
    }
    collectors[family] = async (context) => {
      validateContext(context, family);
      const plan = SOURCE_QUERIES[family];
      const observedAt = new Date(clock()).toISOString();
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
      return {
        source_family: family,
        source_key: `live.${family}`,
        source_identity: `${token(context.operation_ref)}.${family}.${sha256(records).slice(0, 16)}`,
        observed_at: observedAt,
        pagination: {
          expected_count: records.length,
          observed_count: records.length,
          page_count: 1,
          complete: true,
          next_cursor: null,
        },
        evidence_refs: [
          `operation:${token(context.operation_ref)}`,
          `query:${plan.queryKey}`,
        ],
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
  routeAndMethod,
  mapToolRow,
  mapEndpointRow,
  mapActionRow,
  mapDescriptorRow,
  mapProviderBindingRow,
  mapAliasRow,
  assertNoSensitiveValues,
});
