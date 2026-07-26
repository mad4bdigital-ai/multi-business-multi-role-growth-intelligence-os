import { resolveActionEndpointToolManifest } from "./actionEndpointToolManifestResolver.js";
import { resolveExecutionAuthorityManifestContext } from "./executionAuthorityManifestContext.js";
import { enforceExecutionAuthorityManifestGuard } from "./executionAuthorityManifestGuard.js";

function bool(value) {
  if (value === true || value === false) return value;
  return ["true", "1", "yes", "y", "enabled", "active", "enforce", "preview"].includes(String(value || "").trim().toLowerCase());
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function sanitizePolicies(value) {
  return Array.isArray(value) ? value : [];
}

function guardBlockedPreview(err = {}) {
  return {
    enforced: true,
    guard_status: "blocked",
    would_dispatch: false,
    error: {
      code: err.code || "execution_authority_manifest_guard_blocked",
      message: err.message || "Execution authority manifest guard blocked dispatch.",
      details: err.details || null,
    },
    secrets_included: false,
  };
}

function guardPassedPreview(result = {}) {
  return {
    ...result,
    would_dispatch: result.enforced === true ? result.guard_status === "passed" : null,
    secrets_included: false,
  };
}

export async function resolveActionManifestDiagnostic(input = {}, deps = {}) {
  const actionKey = firstNonEmpty(input.action_key, input.actionKey, input.parent_action_key, input.parentActionKey);
  const endpointKey = firstNonEmpty(input.endpoint_key, input.endpointKey);
  const pluginKey = firstNonEmpty(input.plugin_key, input.pluginKey, input.app_key, input.appKey);
  const toolKey = firstNonEmpty(input.tool_key, input.toolKey);
  const previewEnforce = bool(input.preview_enforce ?? input.previewEnforce ?? input.enforce ?? false);
  const requirePluginConnection = bool(
    input.require_plugin_connection ?? input.requirePluginConnection ?? false
  );

  const requestPayload = {
    ...input,
    action_key: actionKey || undefined,
    parent_action_key: actionKey || undefined,
    endpoint_key: endpointKey || undefined,
    plugin_key: pluginKey || undefined,
    tool_key: toolKey || undefined,
    tenant_id: firstNonEmpty(input.tenant_id, input.tenantId) || undefined,
    user_id: firstNonEmpty(input.user_id, input.userId) || undefined,
    actor_role: firstNonEmpty(input.actor_role, input.actorRole) || undefined,
    governance_level: firstNonEmpty(input.governance_level, input.governanceLevel) || undefined,
    client_key: firstNonEmpty(input.client_key, input.clientKey, input.tenant_id, input.tenantId) || undefined,
    team_key: firstNonEmpty(input.team_key, input.teamKey) || undefined,
    is_admin: input.is_admin ?? input.isAdmin ?? true,
    execution_authority_manifest_enabled: true,
    execution_authority_manifest_enforce: previewEnforce,
    execution_authority_require_plugin_connection: requirePluginConnection,
  };

  const manifest = await resolveExecutionAuthorityManifestContext(
    {
      requestPayload,
      action: { action_key: actionKey || null, plugin_key: pluginKey || null },
      endpoint: {
        endpoint_key: endpointKey || null,
        parent_action_key: actionKey || null,
        plugin_key: pluginKey || null,
        tool_key: toolKey || null,
      },
      parent_action_key: actionKey || "",
      endpoint_key: endpointKey || "",
    },
    {
      ...deps,
      resolveActionEndpointToolManifest:
        deps.resolveActionEndpointToolManifest || ((args) => resolveActionEndpointToolManifest(args)),
    }
  );

  let guardPreview;
  try {
    guardPreview = guardPassedPreview(enforceExecutionAuthorityManifestGuard(
      {
        requestPayload,
        policies: sanitizePolicies(input.policies),
        manifest,
      },
      deps
    ));
  } catch (err) {
    guardPreview = guardBlockedPreview(err);
  }

  return {
    ok: true,
    diagnostic: "action_endpoint_tool_manifest",
    mode: "dry_run_readiness_only",
    will_execute: false,
    requested: {
      action_key: actionKey || null,
      endpoint_key: endpointKey || null,
      plugin_key: pluginKey || null,
      tool_key: toolKey || null,
      tenant_id: requestPayload.tenant_id || null,
      user_id: requestPayload.user_id || null,
      actor_role: requestPayload.actor_role || null,
      governance_level: requestPayload.governance_level || null,
      preview_enforce: previewEnforce,
      require_plugin_connection: requirePluginConnection,
    },
    execution_authority_manifest: manifest,
    execution_authority_guard_preview: guardPreview,
    next_step: previewEnforce
      ? (guardPreview.guard_status === "passed" ? "dispatch_would_be_allowed_by_manifest_guard" : "dispatch_would_be_blocked_by_manifest_guard")
      : "enable_preview_enforce_to_simulate_dispatch_guard",
    secrets_included: false,
  };
}
