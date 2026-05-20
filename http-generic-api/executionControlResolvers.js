const WRITE_METHODS = new Set(["POST", "PUT", "PATCH"]);
const DESTRUCTIVE_METHODS = new Set(["DELETE"]);
const INFRA_KEYWORDS = ["cloudflare", "dns", "deploy", "hostinger", "github", "gcloud", "run", "service", "tunnel"];
const CREDENTIAL_KEYWORDS = ["credential", "secret", "token", "oauth", "auth", "connection"];
const BILLING_KEYWORDS = ["billing", "subscription", "plan", "invoice", "quota"];

function normalize(value = "") {
  return String(value ?? "").trim();
}

function lower(value = "") {
  return normalize(value).toLowerCase();
}

function boolOption(value, fallback = false) {
  if (value === true || value === false) return value;
  const normalized = lower(value);
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function containsAny(haystack, needles) {
  const value = lower(haystack);
  return needles.some((needle) => value.includes(needle));
}

export function classifyEndpointRisk({ action = {}, endpoint = {}, method = "", path = "", principal = null } = {}) {
  const httpMethod = normalize(method || endpoint.method).toUpperCase();
  const text = [
    action.action_key,
    action.connector_family,
    action.module_binding,
    endpoint.endpoint_key,
    endpoint.endpoint_role,
    endpoint.execution_mode,
    endpoint.module_binding,
    endpoint.endpoint_path_or_function,
    path,
  ].map(normalize).join(" ");

  let risk_class = "read_only";
  const reasons = [];

  if (DESTRUCTIVE_METHODS.has(httpMethod)) {
    risk_class = "destructive";
    reasons.push("http_delete_method");
  } else if (WRITE_METHODS.has(httpMethod)) {
    risk_class = "state_changing";
    reasons.push("write_method");
  }

  if (containsAny(text, CREDENTIAL_KEYWORDS)) {
    risk_class = risk_class === "read_only" ? "credential_read" : "credential_mutation";
    reasons.push("credential_keyword");
  }

  if (containsAny(text, BILLING_KEYWORDS)) {
    risk_class = risk_class === "read_only" ? "billing_read" : "billing_mutation";
    reasons.push("billing_keyword");
  }

  if (containsAny(text, INFRA_KEYWORDS) && risk_class !== "read_only" && risk_class !== "credential_read" && risk_class !== "billing_read") {
    risk_class = "infrastructure_mutation";
    reasons.push("infrastructure_keyword");
  }

  const actionRisk = lower(action.runtime_capability_class || action.risk_class || "");
  if (actionRisk.includes("admin") || actionRisk.includes("privileged")) {
    risk_class = "admin_privileged";
    reasons.push("action_privileged_class");
  }

  const isAdmin = principal?.is_admin === true || lower(principal?.mode) === "admin" || lower(principal?.mode) === "service";
  const approval_required = !isAdmin && [
    "credential_mutation",
    "billing_mutation",
    "infrastructure_mutation",
    "destructive",
    "admin_privileged",
  ].includes(risk_class);

  return {
    risk_class,
    method: httpMethod,
    approval_required,
    typed_confirmation_required: ["destructive", "infrastructure_mutation", "admin_privileged"].includes(risk_class),
    reasons: [...new Set(reasons)],
  };
}

export function buildCredentialResolutionPreview(authContract = {}, requestPayload = {}) {
  const source = normalize(authContract.credential_resolution_source || "platform_or_action_secret");
  const scope = normalize(authContract.credential_scope || requestPayload.credential_scope || requestPayload.auth_context?.credential_scope || "platform");
  const connectionMatch = source.match(/user_app_connections:([a-f0-9-]+)/i);
  return {
    credential_resolution_status: normalize(authContract.credential_resolution_status || "unknown"),
    auth_mode: normalize(authContract.mode || "none"),
    source: source.startsWith("user_app_connections:") ? "user_app_connections" : source,
    scope,
    connection_id: connectionMatch?.[1] ? `${connectionMatch[1].slice(0, 8)}…` : null,
    fallback_allowed: boolOption(requestPayload.allow_platform_fallback ?? requestPayload.auth_context?.allow_platform_fallback, scope === "platform"),
    secret_exposed: false,
    has_secret: Boolean(authContract.secret),
    has_custom_headers: Boolean(authContract.custom_headers && Object.keys(authContract.custom_headers).length),
  };
}

export function buildSchemaResolutionReport({ schemaContract = {}, schemaSource = "", schemaContractFileId = "", schemaOperationInfo = {}, action = {}, endpoint = {} } = {}) {
  return {
    source: normalize(schemaSource || schemaContract.source || "unknown"),
    schema_name: normalize(schemaContract.name || ""),
    schema_contract_file_id: normalize(schemaContractFileId || schemaContract.fileId || action.openai_schema_file_id || ""),
    action_openai_schema_file_id: normalize(action.openai_schema_file_id || ""),
    layer: normalize(schemaOperationInfo.schema_resolution_layer || (schemaOperationInfo.schema_overlay_applied ? "endpoint_child_schema" : "parent_action_schema")),
    overlay_applied: Boolean(schemaOperationInfo.schema_overlay_applied),
    path_template: normalize(schemaOperationInfo.pathTemplate || schemaOperationInfo.path || endpoint.endpoint_path_or_function || ""),
    operation_id: normalize(schemaOperationInfo.operation?.operationId || endpoint.endpoint_operation || endpoint.endpoint_key || ""),
    operation_found: Boolean(schemaOperationInfo.operation),
  };
}

export function buildRuntimeReadiness({ action = {}, endpoint = {}, authPreview = {}, schemaReport = {}, risk = {} } = {}) {
  const endpointStatus = lower(endpoint.status || "active");
  const readiness = lower(endpoint.execution_readiness || "ready");
  const actionStatus = lower(action.status || "active");
  if (actionStatus && !["active", "ready"].includes(actionStatus)) return { status: "blocked_action_inactive", can_execute: false };
  if (endpointStatus && !["active", "ready"].includes(endpointStatus)) return { status: "blocked_endpoint_inactive", can_execute: false };
  if (readiness && !["ready", "validated", "active"].includes(readiness)) return { status: `degraded_${readiness}`, can_execute: false };
  if (!schemaReport.operation_found) return { status: "blocked_schema_operation_missing", can_execute: false };
  if (authPreview.credential_resolution_status === "empty_secret" && authPreview.auth_mode !== "none") return { status: "blocked_missing_credentials", can_execute: false };
  if (risk.approval_required) return { status: "approval_required", can_execute: false };
  return { status: "ready", can_execute: true };
}

export function buildPassiveExecutionReport({ requestPayload = {}, action = {}, endpoint = {}, brand = null, resolvedMethodPath = {}, resolvedProviderDomain = "", resolvedProviderDomainMode = "", placeholderResolutionSource = "", authContract = {}, schemaContract = {}, schemaSource = "", schemaContractFileId = "", schemaOperationInfo = {}, governedExecutionContext = null, pathResolverLoad = null, finalQuery = {}, baseUrl = "", requestUrl = "", principal = null } = {}) {
  const credential_resolution = buildCredentialResolutionPreview(authContract, requestPayload);
  const schema_resolution = buildSchemaResolutionReport({ schemaContract, schemaSource, schemaContractFileId, schemaOperationInfo, action, endpoint });
  const risk = classifyEndpointRisk({ action, endpoint, method: resolvedMethodPath.method, path: resolvedMethodPath.path, principal });
  const runtime_readiness = buildRuntimeReadiness({ action, endpoint, authPreview: credential_resolution, schemaReport: schema_resolution, risk });
  return {
    ok: true,
    dry_run: true,
    passive_execution: true,
    outbound_request_executed: false,
    parent_action_key: normalize(requestPayload.parent_action_key || action.action_key || ""),
    endpoint_key: normalize(requestPayload.endpoint_key || endpoint.endpoint_key || ""),
    method: normalize(resolvedMethodPath.method || endpoint.method || "").toUpperCase(),
    path: normalize(resolvedMethodPath.path || endpoint.endpoint_path_or_function || ""),
    provider_domain: normalize(resolvedProviderDomain),
    provider_domain_mode: normalize(resolvedProviderDomainMode),
    placeholder_resolution_source: normalize(placeholderResolutionSource),
    request_url_preview: requestUrl,
    base_url_preview: baseUrl,
    final_query_preview: finalQuery,
    action: {
      action_key: normalize(action.action_key || ""),
      runtime_callable: action.runtime_callable,
      primary_executor: normalize(action.primary_executor || ""),
      runtime_capability_class: normalize(action.runtime_capability_class || ""),
    },
    endpoint: {
      endpoint_id: normalize(endpoint.endpoint_id || ""),
      endpoint_key: normalize(endpoint.endpoint_key || ""),
      status: normalize(endpoint.status || ""),
      execution_readiness: normalize(endpoint.execution_readiness || ""),
      execution_mode: normalize(endpoint.execution_mode || ""),
      transport_required: endpoint.transport_required,
      endpoint_role: normalize(endpoint.endpoint_role || ""),
      module_binding: normalize(endpoint.module_binding || ""),
    },
    brand: brand ? {
      brand_name: normalize(brand.brand_name || ""),
      target_key: normalize(brand.target_key || ""),
      base_url: normalize(brand.base_url || ""),
    } : null,
    credential_resolution,
    schema_resolution,
    risk,
    runtime_readiness,
    governed_context_summary: governedExecutionContext ? {
      validation_state: normalize(governedExecutionContext.validation_state || ""),
      path_resolution_status: normalize(governedExecutionContext.path_resolution?.resolution_status || ""),
      blocked_reason: normalize(governedExecutionContext.blocked_reason || ""),
    } : null,
    path_resolver: pathResolverLoad ? {
      requested: Boolean(pathResolverLoad.requested),
      loaded: Boolean(pathResolverLoad.loaded),
      reason: normalize(pathResolverLoad.reason || ""),
    } : null,
  };
}

export function derivePrincipalExecutionContext(payload = {}, auth = null) {
  const next = { ...(payload || {}) };
  const isAdmin = auth?.is_admin === true || lower(auth?.mode) === "admin" || lower(auth?.mode) === "service";
  const principalUserId = normalize(auth?.user_id || "");
  const principalTenantId = normalize(auth?.tenant_id || "");

  if (!auth || isAdmin) {
    return {
      payload: next,
      principal: { is_admin: Boolean(isAdmin), mode: auth?.mode || null, user_id: auth?.user_id || null, tenant_id: auth?.tenant_id || null },
      guard: { applied: Boolean(auth), mode: isAdmin ? "admin_target_allowed" : "no_principal" },
    };
  }

  if (!principalTenantId) {
    const err = new Error("Tenant-scoped endpoint execution requires tenant context.");
    err.status = 403;
    err.code = "tenant_context_required";
    throw err;
  }

  for (const field of ["user_id", "tenant_id"]) {
    const supplied = normalize(next[field] || next.auth_context?.[field] || "");
    const expected = field === "user_id" ? principalUserId : principalTenantId;
    if (supplied && supplied !== expected) {
      const err = new Error(`Tenant-scoped endpoint execution cannot override ${field}.`);
      err.status = 403;
      err.code = "principal_context_spoofing_blocked";
      err.details = { field };
      throw err;
    }
  }

  next.user_id = principalUserId;
  next.tenant_id = principalTenantId;
  next.auth_context = {
    ...(next.auth_context || {}),
    user_id: principalUserId,
    tenant_id: principalTenantId,
    credential_scope: next.credential_scope || next.auth_context?.credential_scope || "tenant",
    allow_platform_fallback: false,
  };
  next.allow_platform_fallback = false;

  return {
    payload: next,
    principal: { is_admin: false, mode: auth?.mode || "tenant", user_id: principalUserId, tenant_id: principalTenantId },
    guard: { applied: true, mode: "tenant_context_derived", platform_fallback_forced: false },
  };
}
