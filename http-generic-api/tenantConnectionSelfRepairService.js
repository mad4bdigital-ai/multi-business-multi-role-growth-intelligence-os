const SAFE_POINTER_KEYS = new Set(["credential_ref", "credential_role", "credential_scope", "credential_source", "connection_id", "binding_id", "grant_id", "evidence_ref"]);
const SECRET_BEARING_KEY_PATTERN = /(?:password|secret|token|api[_-]?key|private[_-]?key|ciphertext|credential_value|refresh_token|access_token|authorization)/i;

function compactString(value = "", max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const TENANT_CONNECTION_SELF_REPAIR_ROUTE_CONTRACTS = Object.freeze([
  Object.freeze({ tool_key: "tenant_connection_validate_adapter_smoke", method: "POST", path: "/me/connections/{connection_id}/validate-adapter-smoke", operation_class: "provider_smoke", risk_class: "B", provider_write_allowed: false, requires_adapter_overlay: true, requires_operator_approval: false, requires_readback: true }),
  Object.freeze({ tool_key: "tenant_connection_effective_credential_plan_view", method: "GET", path: "/me/connections/{connection_id}/effective-credential-plan", operation_class: "read", risk_class: "A", provider_write_allowed: false, requires_adapter_overlay: false, requires_operator_approval: false, requires_readback: true }),
  Object.freeze({ tool_key: "tenant_connection_binding_refresh", method: "POST", path: "/me/connections/{connection_id}/credential-binding/refresh", operation_class: "internal_write", risk_class: "D", provider_write_allowed: false, requires_adapter_overlay: false, requires_operator_approval: true, requires_readback: true }),
  Object.freeze({ tool_key: "tenant_connection_provider_grant_refresh", method: "POST", path: "/me/connections/{connection_id}/provider-grants/refresh", operation_class: "internal_write", risk_class: "D", provider_write_allowed: false, requires_adapter_overlay: true, requires_operator_approval: true, requires_readback: true }),
  Object.freeze({ tool_key: "tenant_connection_resolver_refresh", method: "POST", path: "/me/connections/{connection_id}/resolver/refresh", operation_class: "internal_write", risk_class: "C", provider_write_allowed: false, requires_adapter_overlay: false, requires_operator_approval: true, requires_readback: true }),
  Object.freeze({ tool_key: "tenant_connection_bounded_mutation_preflight", method: "POST", path: "/me/connections/{connection_id}/mutations/preflight", operation_class: "provider_preflight", risk_class: "C", provider_write_allowed: false, requires_adapter_overlay: true, requires_operator_approval: true, requires_readback: true }),
  Object.freeze({ tool_key: "tenant_connection_bounded_mutation_execute", method: "POST", path: "/me/connections/{connection_id}/mutations/execute", operation_class: "provider_write", risk_class: "D", provider_write_allowed: true, requires_adapter_overlay: true, requires_operator_approval: true, requires_live_execution_approval: true, requires_preflight_id: true, requires_readback: true, publish_or_destructive_default_blocked: true }),
  Object.freeze({ tool_key: "tenant_connection_readback_certification", method: "POST", path: "/me/connections/{connection_id}/readback-certifications", operation_class: "internal_write", risk_class: "C", provider_write_allowed: false, requires_adapter_overlay: true, requires_operator_approval: true, requires_readback: true }),
  Object.freeze({ tool_key: "tenant_connection_recertification_policy", method: "POST", path: "/me/connections/{connection_id}/recertification-policy", operation_class: "internal_write", risk_class: "C", provider_write_allowed: false, requires_adapter_overlay: true, requires_operator_approval: true, requires_readback: true }),
]);

export function findTenantConnectionSelfRepairRoute(toolKey = "") {
  return TENANT_CONNECTION_SELF_REPAIR_ROUTE_CONTRACTS.find((route) => route.tool_key === toolKey) || null;
}

export function tenantConnectionSelfRepairError(code, message, details = {}, status = 400) {
  return { ok: false, status, error: { code: compactString(code, 128) || "tenant_connection_self_repair_error", message: compactString(message, 1000) || "Tenant connection self-repair request failed.", details: isPlainObject(details) ? details : {} }, secrets_included: false };
}

export function assertNoSecretBearingFields(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretBearingFields(item, `${path}[${index}]`));
    return true;
  }
  if (!isPlainObject(value)) return true;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = String(key || "");
    if (!SAFE_POINTER_KEYS.has(normalizedKey) && SECRET_BEARING_KEY_PATTERN.test(normalizedKey)) {
      const err = new Error(`Secret-bearing field is not allowed in tenant connection self-repair payload: ${path}.${normalizedKey}`);
      err.code = "tenant_connection_self_repair_secret_field_detected";
      err.status = 400;
      err.details = { field_path: `${path}.${normalizedKey}`, secrets_included: false };
      throw err;
    }
    assertNoSecretBearingFields(child, `${path}.${normalizedKey}`);
  }
  return true;
}

export function redactTenantConnection(row = {}) {
  return { connection_id: row.connection_id || null, tenant_id: row.tenant_id || null, user_id: row.user_id || null, app_key: row.app_key || null, auth_type: row.auth_type || null, status: row.status || null, validation_status: row.validation_status || null, is_primary: Boolean(Number(row.is_primary || 0)), last_validated_at: row.last_validated_at || null, last_used_at: row.last_used_at || null, account_label: row.account_label || null, secret_present: row.secret_present === true || Number(row.secret_present || 0) === 1, secrets_included: false };
}

export function buildEffectiveCredentialPlan({ connection = {}, bindings = [], grants = [], blockers = [] } = {}) {
  const redactedBindings = (bindings || []).map((binding) => ({ binding_id: binding.binding_id || null, connection_id: binding.connection_id || null, action_key: binding.action_key || null, target_key: binding.target_key || null, credential_role: binding.credential_role || null, credential_ref: binding.credential_ref || null, resolution_priority: Number(binding.resolution_priority || 0), status: binding.status || null, secret_present: Boolean(binding.credential_ref || binding.secret_present) }));
  const redactedGrants = (grants || []).map((grant) => ({ grant_id: grant.grant_id || null, grant_scope: grant.grant_scope || grant.resource_type || null, resource_ref: grant.resource_ref || grant.connection_id || null, status: grant.status || grant.grant_status || null, expires_at: grant.expires_at || null }));
  const plan = { ok: true, connection: redactTenantConnection(connection), effective_binding: redactedBindings[0] || null, candidate_bindings: redactedBindings, grants: redactedGrants, blockers: Array.isArray(blockers) ? blockers.map((item) => compactString(item, 191)).filter(Boolean) : [], platform_fallback_allowed: false, no_raw_secret_return: true, secrets_included: false };
  assertNoSecretBearingFields(plan);
  return plan;
}

export function validateTenantConnectionSelfRepairRequest(toolKey = "", payload = {}) {
  const route = findTenantConnectionSelfRepairRoute(toolKey);
  if (!route) return tenantConnectionSelfRepairError("tenant_connection_self_repair_route_unknown", "Unknown tenant connection self-repair route.", { tool_key: toolKey }, 404);
  try { assertNoSecretBearingFields(payload); } catch (err) { return tenantConnectionSelfRepairError(err.code, err.message, err.details, err.status || 400); }
  const connectionId = compactString(payload.connection_id || payload.connectionId || "", 191);
  if (!connectionId) return tenantConnectionSelfRepairError("tenant_connection_self_repair_connection_id_required", "connection_id is required.", { tool_key: route.tool_key }, 400);
  if (route.requires_adapter_overlay && !compactString(payload.adapter_key || payload.app_key || "", 128)) return tenantConnectionSelfRepairError("tenant_connection_self_repair_adapter_overlay_required", "An adapter/app overlay key is required for this operation.", { tool_key: route.tool_key }, 400);
  if (route.requires_operator_approval && payload.operator_approved !== true) return tenantConnectionSelfRepairError("tenant_connection_self_repair_operator_approval_required", "Explicit operator approval is required for this operation.", { tool_key: route.tool_key }, 403);
  if (route.tool_key === "tenant_connection_bounded_mutation_preflight" && (payload.dry_run !== true || payload.preflight_only !== true)) return tenantConnectionSelfRepairError("tenant_connection_self_repair_preflight_must_be_dry_run_only", "Bounded mutation preflight must set dry_run=true and preflight_only=true.", { tool_key: route.tool_key }, 400);
  if (route.requires_preflight_id && !compactString(payload.preflight_id || "", 191)) return tenantConnectionSelfRepairError("tenant_connection_self_repair_preflight_id_required", "A matching preflight_id is required before bounded mutation execute.", { tool_key: route.tool_key }, 403);
  if (route.requires_live_execution_approval && payload.live_execution_approved !== true) return tenantConnectionSelfRepairError("tenant_connection_self_repair_live_execution_approval_required", "Bounded mutation execute requires explicit live_execution_approved=true.", { tool_key: route.tool_key }, 403);
  if (route.publish_or_destructive_default_blocked && payload.publish_or_destructive_approved === true) return tenantConnectionSelfRepairError("tenant_connection_self_repair_publish_destructive_requires_adapter_policy", "Publish or destructive execution requires a separate adapter-specific capability envelope and is blocked by this generic contract.", { tool_key: route.tool_key }, 403);
  return { ok: true, status: "tenant_connection_self_repair_request_validated", route, connection_id: connectionId, provider_write_allowed: route.provider_write_allowed === true, readback_required: true, secrets_included: false };
}
