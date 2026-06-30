import { writeAuditLogAsync } from "./auditLogger.js";

export const PlatformPluginSecurityAlertCode = Object.freeze({
  TENANT_TO_ADMIN_CAPABILITY_REQUEST: "TENANT_TO_ADMIN_CAPABILITY_REQUEST",
  SELECTOR_PARITY_MISMATCH: "SELECTOR_PARITY_MISMATCH",
});

function compact(value = "", max = 191) {
  return String(value || "").trim().slice(0, max);
}

function normalize(value = "") {
  return compact(value).toLowerCase();
}

function activeActionMatchesTool(actionBindings = [], toolKey = "") {
  const normalizedToolKey = normalize(toolKey);
  if (!normalizedToolKey) return false;
  return actionBindings.some((binding) => (
    normalize(binding?.action_key) === normalizedToolKey
    && normalize(binding?.status || "active") === "active"
  ));
}

export function classifyPlatformPluginSecurityAlerts({
  principalClass = "admin",
  toolKey = null,
  surfaceExposure = null,
  canonicalPolicy = null,
  actionBindings = [],
} = {}) {
  const alerts = [];
  const principal = normalize(principalClass) || "admin";
  if (principal === "tenant" && surfaceExposure?.reason === "admin_tool_forbidden") {
    alerts.push({
      code: PlatformPluginSecurityAlertCode.TENANT_TO_ADMIN_CAPABILITY_REQUEST,
      alert_type: "tenant_to_admin_capability_request",
      action: "security_alert.platform_plugin.tenant_to_admin",
      severity: "high",
    });
  }
  if (
    toolKey
    && canonicalPolicy?.reason === "tool_canonical_policy_mapping_required"
    && activeActionMatchesTool(actionBindings, toolKey)
  ) {
    alerts.push({
      code: PlatformPluginSecurityAlertCode.SELECTOR_PARITY_MISMATCH,
      alert_type: "selector_parity_mismatch",
      action: "security_alert.platform_plugin.selector_parity_mismatch",
      severity: "high",
    });
  }
  return alerts;
}

function safeSchedule(writer, event) {
  try {
    const pending = writer(event);
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  } catch {
    // Containment decisions must not depend on telemetry availability.
  }
}

export function schedulePlatformPluginSecurityAlerts({
  writer = writeAuditLogAsync,
  principalClass = "admin",
  tenantId = null,
  workspaceId = null,
  userId = null,
  requestId = null,
  correlationId = null,
  pluginKey = null,
  actionKey = null,
  toolKey = null,
  surfaceExposure = null,
  canonicalPolicy = null,
  actionBindings = [],
} = {}) {
  const alerts = classifyPlatformPluginSecurityAlerts({
    principalClass,
    toolKey,
    surfaceExposure,
    canonicalPolicy,
    actionBindings,
  });
  const selectorType = actionKey ? "action_key" : (toolKey ? "tool_key" : null);
  const selectorValue = compact(actionKey || toolKey || "", 191) || null;
  const plugin = compact(pluginKey, 128) || null;
  const resourceId = compact([plugin, selectorValue].filter(Boolean).join(":"), 191) || plugin;
  const request = compact(requestId, 128) || null;
  const correlation = compact(correlationId || request, 128) || request;

  for (const alert of alerts) {
    safeSchedule(writer, {
      tenant_id: tenantId || null,
      workspace_id: workspaceId || null,
      actor_id: userId || null,
      actor_type: normalize(principalClass) === "tenant" ? "user" : "service",
      user_id: userId || null,
      request_id: request,
      correlation_id: correlation,
      action: alert.action,
      resource_type: "platform_plugin_capability",
      resource_id: resourceId,
      service_mode: "security_containment",
      outcome: "blocked",
      metadata: {
        severity: alert.severity,
        alert_code: alert.code,
        alert_type: alert.alert_type,
        temporary_control: true,
        containment_task: "T008",
        principal_class: normalize(principalClass) || "admin",
        plugin_key: plugin,
        selector_type: selectorType,
        selector_value: selectorValue,
        surface_reason: compact(surfaceExposure?.reason, 128) || null,
        tool_surface: compact(surfaceExposure?.tool_surface, 128) || null,
        exposure_scope: compact(surfaceExposure?.exposure_scope, 128) || null,
        canonical_policy_reason: compact(canonicalPolicy?.reason, 128) || null,
        dispatch_blocked: true,
        secrets_included: false,
      },
    });
  }

  return {
    scheduled_count: alerts.length,
    severity: alerts.length ? "high" : null,
    reason_codes: alerts.map((alert) => alert.code),
    temporary_control: true,
    secrets_included: false,
  };
}