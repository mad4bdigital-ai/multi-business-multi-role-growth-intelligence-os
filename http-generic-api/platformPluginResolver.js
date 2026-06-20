import { getPool } from "./db.js";
import { normalizePlatformPlugin } from "./platformPluginCatalog.js";

function compactString(value = "", max = 500) {
  return String(value || "").trim().slice(0, max);
}

function normalize(value = "") {
  return String(value || "").trim().toLowerCase();
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

async function safeQuery(pool, sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows || [];
  } catch (err) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(err?.code)) return [];
    throw err;
  }
}

function parseJsonArray(value, fallback = []) {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function bindingCredentialSource(binding = null) {
  return normalize(binding?.credential_source || "");
}

function credentialScopesForSource(source = "") {
  const normalized = normalize(source);
  if (normalized === "user_connection") return ["user_connection"];
  if (normalized === "tenant_connection") return ["tenant_connection"];
  if (normalized === "platform_managed") return ["platform_managed"];
  if (normalized === "device_connector") return ["device_connector"];
  if (normalized === "none") return ["none"];
  if (normalized === "mixed") return ["user_connection", "tenant_connection", "platform_managed"];
  return [];
}

function defaultScopesForAuthType(authType = "") {
  const normalized = normalize(authType);
  if (normalized === "mcp") return ["user_connection", "tenant_connection", "device_connector"];
  if (normalized === "webhook") return ["tenant_connection", "user_connection"];
  if (normalized === "api_key" || normalized === "bearer_token" || normalized === "basic_auth" || normalized === "custom_headers" || normalized === "client_credentials" || normalized === "oauth2") {
    return ["user_connection", "tenant_connection", "platform_managed"];
  }
  return ["platform_managed"];
}

function deriveCandidateCredentialScopes({ plugin, binding, tenantPolicy }) {
  const fromBinding = credentialScopesForSource(bindingCredentialSource(binding));
  const fallback = defaultScopesForAuthType(plugin?.auth_type);
  let scopes = unique(fromBinding.length ? fromBinding : fallback);

  const sourceMode = normalize(tenantPolicy?.source_mode || "");
  if (sourceMode === "dedicated") {
    scopes = scopes.filter((scope) => scope !== "platform_managed");
    if (!scopes.length) scopes = ["user_connection", "tenant_connection"];
  }
  if (sourceMode === "managed") {
    scopes = unique(["platform_managed", ...scopes]);
  }
  return scopes;
}

function connectionIsUsable(row = {}) {
  const status = normalize(row.status);
  const validationStatus = normalize(row.validation_status);
  return status === "active" && ["validated", "valid", "active", "healthy"].includes(validationStatus);
}

function pickConnectionForScope(scope, connections = []) {
  if (scope === "user_connection") {
    return connections.find((row) => connectionIsUsable(row) && row.user_id) || null;
  }
  if (scope === "tenant_connection") {
    return connections.find((row) => connectionIsUsable(row)) || null;
  }
  return null;
}

function resolveCredentialDecision({ plugin, binding, tenantPolicy, connections = [], requestedScope = null }) {
  const candidateScopes = deriveCandidateCredentialScopes({ plugin, binding, tenantPolicy });
  const sourceMode = normalize(tenantPolicy?.source_mode || "");
  const fallbackAllowed = tenantPolicy ? Boolean(tenantPolicy.fallback_allowed) : true;
  const explicitRequestedScope = normalize(requestedScope || "");
  if (explicitRequestedScope && !candidateScopes.includes(explicitRequestedScope)) {
    return {
      ok: false,
      credential_source: null,
      reason: "credential_scope_not_allowed",
      requested_scope: explicitRequestedScope,
      candidate_scopes: candidateScopes,
    };
  }
  const orderedScopes = explicitRequestedScope ? [explicitRequestedScope] : candidateScopes;
  let unusableConnection = null;

  for (const scope of orderedScopes) {
    if (scope === "none") {
      return { ok: true, credential_source: "none", reason: "no_credentials_required", candidate_scopes: candidateScopes };
    }
    if (scope === "device_connector") {
      return { ok: true, credential_source: "device_connector", reason: "device_connector_required", candidate_scopes: candidateScopes };
    }
    if (scope === "user_connection" || scope === "tenant_connection") {
      const connection = pickConnectionForScope(scope, connections);
      if (connection) {
        return {
          ok: true,
          credential_source: scope,
          connection_id: connection.connection_id,
          connection_status: connection.status,
          validation_status: connection.validation_status || null,
          reason: "connection_available",
          candidate_scopes: candidateScopes,
        };
      }
      unusableConnection = connections.find((row) => {
        if (scope === "user_connection" && !row.user_id) return false;
        return normalize(row.status) === "active";
      }) || unusableConnection;
      continue;
    }
    if (scope === "platform_managed") {
      if (sourceMode === "dedicated" && !fallbackAllowed) {
        continue;
      }
      return {
        ok: true,
        credential_source: "platform_managed",
        reason: tenantPolicy ? "tenant_policy_allows_platform_credentials" : "platform_default",
        candidate_scopes: candidateScopes,
      };
    }
  }

  if (unusableConnection) {
    return {
      ok: false,
      credential_source: null,
      connection_id: unusableConnection.connection_id || null,
      connection_status: unusableConnection.status || null,
      validation_status: unusableConnection.validation_status || null,
      reason: "credential_not_usable",
      candidate_scopes: candidateScopes,
    };
  }

  const dedicatedNoFallback = sourceMode === "dedicated" && !fallbackAllowed;
  return {
    ok: false,
    credential_source: null,
    reason: dedicatedNoFallback ? "dedicated_connection_required" : "credential_required",
    candidate_scopes: candidateScopes,
  };
}

function resolvePrincipalScope({ principalClass = "admin", tenantId = null, userId = null }) {
  const principal = normalize(principalClass) || "admin";
  if (principal === "tenant" && (!tenantId || !userId)) {
    return {
      ok: false,
      reason: "tenant_principal_scope_required",
      principal_class: "tenant",
      tenant_id_present: Boolean(tenantId),
      user_id_present: Boolean(userId),
    };
  }
  return {
    ok: true,
    reason: principal === "tenant" ? "tenant_principal_scope_authorized" : "admin_principal_scope",
    principal_class: principal,
    tenant_id_present: Boolean(tenantId),
    user_id_present: Boolean(userId),
  };
}

function resolveSurfaceExposure({ binding, toolKey, principalClass = "admin" }) {
  if (!toolKey) return { ok: true, reason: "action_surface", principal_class: principalClass };
  const toolSurface = normalize(binding?.tool_surface || "");
  const exposureScope = normalize(binding?.exposure_scope || "");
  const adminOnly = toolSurface.includes("admin") || ["admin", "platform_admin", "platform"].includes(exposureScope);
  if (normalize(principalClass) === "tenant" && adminOnly) {
    return {
      ok: false,
      reason: "admin_tool_forbidden",
      principal_class: "tenant",
      tool_surface: binding?.tool_surface || null,
      exposure_scope: binding?.exposure_scope || null,
    };
  }
  return {
    ok: true,
    reason: adminOnly ? "admin_surface_allowed_for_admin_preview" : "surface_exposed",
    principal_class: normalize(principalClass) || "admin",
    tool_surface: binding?.tool_surface || null,
    exposure_scope: binding?.exposure_scope || null,
  };
}

function selectBinding({ actionBindings = [], toolBindings = [], actionKey = null, toolKey = null }) {
  if (actionKey) {
    return actionBindings.find((row) => String(row.action_key || "") === String(actionKey)) || null;
  }
  if (toolKey) {
    return toolBindings.find((row) => String(row.tool_key || "") === String(toolKey)) || null;
  }
  return actionBindings[0] || toolBindings[0] || null;
}

function resolveBindingState({ binding, actionKey, toolKey }) {
  if ((actionKey || toolKey) && !binding) {
    return {
      ok: false,
      status: "missing_binding",
      reason: actionKey ? "action_binding_not_found" : "tool_binding_not_found",
    };
  }
  if (!binding) {
    return {
      ok: true,
      status: "plugin_definition_only",
      reason: "no_action_or_tool_requested",
    };
  }
  const status = normalize(binding.status);
  const ok = status === "active";
  return {
    ok,
    status: binding.status,
    reason: ok ? "binding_active" : "binding_not_active",
  };
}

function deriveRequiredSkill({ pluginKey, actionKey, toolKey, binding }) {
  const key = String(actionKey || toolKey || pluginKey || "").trim();
  if (!key) return null;
  const role = normalize(binding?.binding_role || "");
  if (role.includes("dns")) return "infrastructure.dns_control";
  if (role.includes("device") || String(toolKey || "").startsWith("connector_")) return "local.connector.device_management";
  if (String(pluginKey || "").includes("github") || String(actionKey || "").includes("github")) return "code.repository_automation";
  if (String(pluginKey || "").includes("browser")) return "browser.web_qa";
  return null;
}

async function checkSkillGrant({ pool, agentId, tenantId, requiredSkillKey }) {
  if (!requiredSkillKey) return { required: false, granted: true, skill_key: null, reason: "no_skill_declared" };
  if (!agentId) return { required: true, granted: false, skill_key: requiredSkillKey, reason: "agent_id_required_for_skill_check" };
  const rows = await safeQuery(
    pool,
    `SELECT asg.grant_id, ask.skill_key
       FROM agent_skill_grants asg
       JOIN agent_skills ask ON ask.skill_id = asg.skill_id
      WHERE asg.agent_id = ?
        AND ask.skill_key = ?
        AND asg.status = 'active'
        AND ask.status = 'active'
        AND (asg.expires_at IS NULL OR asg.expires_at > NOW())
        AND (? IS NULL OR asg.tenant_id IS NULL OR asg.tenant_id = ?)
      LIMIT 1`,
    [agentId, requiredSkillKey, tenantId || null, tenantId || null]
  );
  return {
    required: true,
    granted: rows.length > 0,
    skill_key: requiredSkillKey,
    grant_id: rows[0]?.grant_id || null,
    reason: rows.length > 0 ? "skill_granted" : "skill_not_granted",
  };
}

async function checkSmokeCertification({ pool, pluginKey, actionKey, allowExpiredForRecertification = false }) {
  if (!actionKey) {
    return {
      required: false,
      certified: true,
      reason: "no_action_requested",
      secrets_included: false,
    };
  }
  const rows = await safeQuery(
    pool,
    `SELECT certification_id, mock_provider, mock_resource, expected_origin,
            url_origin, url_path, http_method, last_smoke_status,
            last_response_status, last_response_ok, last_smoke_execution_log_id,
            last_smoke_trace_id, certified_at, certification_expires_at,
            last_recertification_required_at, recertification_reason, certification_status
       FROM platform_plugin_smoke_certifications
      WHERE plugin_key = ?
        AND action_key = ?
        AND certification_status = 'certified'
        AND last_smoke_status = 'success'
        AND last_response_ok = 1
        AND last_response_status = 200
        AND secrets_included = 0
      ORDER BY certified_at DESC
      LIMIT 1`,
    [pluginKey, actionKey]
  );
  const row = rows[0] || null;
  const expired = Boolean(row?.certification_expires_at && new Date(row.certification_expires_at).getTime() <= Date.now());
  const certified = Boolean(row && (!expired || allowExpiredForRecertification));
  return {
    required: true,
    certified,
    reason: row ? (expired ? (allowExpiredForRecertification ? "smoke_certification_expired_recertification_allowed" : "smoke_certification_expired") : "smoke_certification_active") : "smoke_certification_required",
    certification: row ? {
      certification_id: row.certification_id,
      mock_provider: row.mock_provider,
      mock_resource: row.mock_resource,
      expected_origin: row.expected_origin,
      url_origin: row.url_origin,
      url_path: row.url_path,
      http_method: row.http_method,
      last_smoke_status: row.last_smoke_status,
      last_response_status: row.last_response_status,
      last_response_ok: Boolean(row.last_response_ok),
      last_smoke_execution_log_id: row.last_smoke_execution_log_id,
      last_smoke_trace_id: row.last_smoke_trace_id,
      certified_at: row.certified_at,
      certification_expires_at: row.certification_expires_at,
      expired,
      last_recertification_required_at: row.last_recertification_required_at || null,
      recertification_reason: row.recertification_reason || null,
      certification_status: row.certification_status,
      secrets_included: false,
    } : null,
    secrets_included: false,
  };
}

async function checkActionGrant({ pool, pluginKey, actionKey, agentId, credential }) {
  if (!actionKey) return { required: false, granted: true, grant_id: null, reason: "no_action_requested" };
  if (!credential?.connection_id) {
    return {
      required: true,
      granted: false,
      grant_id: null,
      reason: "connection_id_required_for_action_grant",
    };
  }
  const rows = await safeQuery(
    pool,
    `SELECT grant_id, grant_mode, agent_id, expires_at
       FROM app_action_grants
      WHERE connection_id = ?
        AND app_key = ?
        AND action_key = ?
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (? IS NULL OR agent_id IS NULL OR agent_id = ?)
      ORDER BY CASE WHEN agent_id = ? THEN 0 ELSE 1 END, created_at DESC
      LIMIT 1`,
    [credential.connection_id, pluginKey, actionKey, agentId || null, agentId || null, agentId || null]
  );
  const grant = rows[0] || null;
  return {
    required: true,
    granted: Boolean(grant),
    grant_id: grant?.grant_id || null,
    grant_mode: grant?.grant_mode || null,
    agent_id: grant?.agent_id || null,
    expires_at: grant?.expires_at || null,
    reason: grant ? "action_grant_active" : "action_grant_required",
  };
}

async function loadPluginRows({ pool, pluginKey, tenantId, userId }) {
  const pluginRows = await safeQuery(
    pool,
    `SELECT app_key, display_name, description, auth_type, oauth_scopes_default,
            mcp_server_info, docs_url, category, default_action_grants, status, created_at
       FROM app_integrations
      WHERE app_key = ?
      LIMIT 1`,
    [pluginKey]
  );
  const plugin = pluginRows[0] || null;
  if (!plugin) return { plugin: null, actionBindings: [], toolBindings: [], tenantPolicy: null };

  const [actionBindings, toolBindings, tenantPolicies] = await Promise.all([
    safeQuery(
      pool,
      `SELECT binding_id, app_key, action_key, binding_role, credential_source, exposure_default, status, notes
         FROM app_integration_action_bindings
        WHERE app_key = ?
        ORDER BY action_key ASC`,
      [pluginKey]
    ),
    safeQuery(
      pool,
      `SELECT binding_id, app_key, tool_key, tool_surface, binding_role, credential_source, exposure_scope, status, notes
         FROM app_integration_tool_bindings
        WHERE app_key = ?
        ORDER BY tool_key ASC`,
      [pluginKey]
    ),
    tenantId
      ? safeQuery(
          pool,
          `SELECT tenant_id, app_key, source_mode, fallback_allowed, required_for_device_install, status, source, updated_at
             FROM tenant_integration_policies
            WHERE tenant_id = ? AND app_key = ? AND status = 'active'
            ORDER BY updated_at DESC
            LIMIT 1`,
          [tenantId, pluginKey]
        )
      : Promise.resolve([]),
  ]);

  return {
    plugin,
    actionBindings,
    toolBindings,
    tenantPolicy: tenantPolicies[0] || null,
  };
}

async function loadScopedConnections({ pool, pluginKey, tenantId, userId }) {
  if (!tenantId && !userId) return [];
  return safeQuery(
    pool,
    `SELECT connection_id, tenant_id, user_id, app_key, auth_type, status, validation_status,
            last_validated_at, last_used_at, is_primary
       FROM user_app_connections
      WHERE app_key = ?
        ${tenantId ? "AND tenant_id = ?" : ""}
        ${userId ? "AND user_id = ?" : ""}
      ORDER BY is_primary DESC, last_validated_at DESC, connected_at DESC`,
    [pluginKey, ...(tenantId ? [tenantId] : []), ...(userId ? [userId] : [])]
  );
}

export async function resolvePlatformPluginExecution({
  pool = getPool(),
  pluginKey,
  actionKey = null,
  toolKey = null,
  tenantId = null,
  userId = null,
  agentId = null,
  principalClass = "admin",
  requestedCredentialScope = null,
  allowExpiredSmokeCertificationForRecertification = false,
} = {}) {
  const normalizedPluginKey = compactString(pluginKey, 128);
  if (!normalizedPluginKey) {
    const err = new Error("plugin_key is required.");
    err.code = "missing_plugin_key";
    err.status = 400;
    throw err;
  }

  const normalizedActionKey = compactString(actionKey || "", 191) || null;
  const normalizedToolKey = compactString(toolKey || "", 191) || null;
  if (normalizedActionKey && normalizedToolKey) {
    const err = new Error("Exactly one capability selector may be provided.");
    err.code = "ambiguous_capability_selector";
    err.status = 400;
    throw err;
  }

  const rows = await loadPluginRows({ pool, pluginKey: normalizedPluginKey, tenantId, userId });
  if (!rows.plugin) {
    return {
      ok: true,
      allowed: false,
      reason: "plugin_not_found",
      plugin_key: normalizedPluginKey,
      secrets_included: false,
    };
  }

  const platformPlugin = normalizePlatformPlugin(rows.plugin, {
    actionBindings: rows.actionBindings,
    toolBindings: rows.toolBindings,
    tenantPolicies: rows.tenantPolicy ? [rows.tenantPolicy] : [],
    userConnectionSummary: [],
  });
  const binding = selectBinding({
    actionBindings: rows.actionBindings,
    toolBindings: rows.toolBindings,
    actionKey: normalizedActionKey,
    toolKey: normalizedToolKey,
  });
  const bindingState = resolveBindingState({ binding, actionKey: normalizedActionKey, toolKey: normalizedToolKey });
  const principalScope = resolvePrincipalScope({ principalClass, tenantId, userId });
  const surfaceExposure = resolveSurfaceExposure({ binding, toolKey: normalizedToolKey, principalClass });
  const canonicalPolicy = normalizedToolKey
    ? { ready: false, reason: "tool_canonical_policy_mapping_required", canonical_action_key: null }
    : { ready: true, reason: normalizedActionKey ? "action_is_canonical_policy_key" : "no_selector_preview", canonical_action_key: normalizedActionKey };
  const requiredSkillKey = deriveRequiredSkill({
    pluginKey: normalizedPluginKey,
    actionKey: normalizedActionKey,
    toolKey: normalizedToolKey,
    binding,
  });
  const skill = await checkSkillGrant({ pool, agentId, tenantId, requiredSkillKey });
  const pluginStatusActive = ["active", "beta"].includes(normalize(rows.plugin.status));
  const selectorRequested = Boolean(normalizedActionKey || normalizedToolKey);
  const credentialLookupAuthorized = Boolean(
    selectorRequested &&
    pluginStatusActive &&
    principalScope.ok &&
    bindingState.ok &&
    surfaceExposure.ok &&
    canonicalPolicy.ready &&
    skill.granted
  );
  const connections = credentialLookupAuthorized
    ? await loadScopedConnections({
        pool,
        pluginKey: normalizedPluginKey,
        tenantId,
        userId,
      })
    : [];
  const credential = !selectorRequested
    ? {
        ok: true,
        credential_source: null,
        reason: "credential_resolution_not_required_for_preview",
        candidate_scopes: [],
      }
    : credentialLookupAuthorized
      ? resolveCredentialDecision({
          plugin: rows.plugin,
          binding,
          tenantPolicy: rows.tenantPolicy,
          connections,
          requestedScope: requestedCredentialScope,
        })
      : {
          ok: false,
          credential_source: null,
          reason: "credential_resolution_deferred_until_authorized",
          candidate_scopes: [],
        };
  const smokeCertification = await checkSmokeCertification({
    pool,
    pluginKey: normalizedPluginKey,
    actionKey: normalizedActionKey || normalizedToolKey,
    allowExpiredForRecertification: allowExpiredSmokeCertificationForRecertification === true,
  });
  const allowed = Boolean(
    pluginStatusActive &&
    principalScope.ok &&
    bindingState.ok &&
    surfaceExposure.ok &&
    canonicalPolicy.ready &&
    credential.ok &&
    skill.granted &&
    smokeCertification.certified
  );
  const denialReasons = [];
  if (!pluginStatusActive) denialReasons.push("plugin_not_active");
  if (!principalScope.ok) denialReasons.push(principalScope.reason);
  if (!bindingState.ok) denialReasons.push(bindingState.reason);
  if (!surfaceExposure.ok) denialReasons.push(surfaceExposure.reason);
  if (!canonicalPolicy.ready) denialReasons.push(canonicalPolicy.reason);
  if (credentialLookupAuthorized && !credential.ok) denialReasons.push(credential.reason);
  if (!skill.granted) denialReasons.push(skill.reason);
  if (!smokeCertification.certified) denialReasons.push(smokeCertification.reason);

  const defaultGrants = parseJsonArray(rows.plugin.default_action_grants, []);
  const baseApprovalRequired = Boolean(
    normalizedToolKey ||
    defaultGrants.find((grant) => grant?.action_key === normalizedActionKey)?.auto_approve === false ||
    normalize(binding?.exposure_default || "") === "runtime_only" ||
    normalize(binding?.binding_role || "") === "state_changing"
  );
  const actionGrant = baseApprovalRequired && allowed
    ? await checkActionGrant({
        pool,
        pluginKey: normalizedPluginKey,
        actionKey: normalizedActionKey || normalizedToolKey,
        agentId,
        credential,
      })
    : { required: baseApprovalRequired, granted: !baseApprovalRequired, grant_id: null, reason: baseApprovalRequired ? "resolve_denials_before_action_grant" : "no_review_required_by_preview" };
  const approvalRequired = Boolean(baseApprovalRequired && !actionGrant.granted);
  const dispatchReady = Boolean(allowed && !approvalRequired);

  return {
    ok: true,
    allowed,
    reason: allowed ? "resolved" : unique(denialReasons).join("|") || "not_allowed",
    mode: dispatchReady ? "dispatch_ready" : "preview_only",
    plugin_key: normalizedPluginKey,
    requested_action_key: normalizedActionKey,
    requested_tool_key: normalizedToolKey,
    selector: normalizedActionKey
      ? { type: "action_key", value: normalizedActionKey }
      : (normalizedToolKey ? { type: "tool_key", value: normalizedToolKey } : null),
    canonical_policy: canonicalPolicy,
    surface_resolution: surfaceExposure,
    plugin: {
      plugin_key: platformPlugin.plugin_key,
      display_name: platformPlugin.display_name,
      plugin_type: platformPlugin.plugin_type,
      plugin_family: platformPlugin.plugin_family,
      status: platformPlugin.status,
      protocols: platformPlugin.protocols,
      source: platformPlugin.source,
    },
    binding: binding ? {
      binding_id: binding.binding_id,
      action_key: binding.action_key || null,
      tool_key: binding.tool_key || null,
      tool_surface: binding.tool_surface || null,
      exposure_scope: binding.exposure_scope || null,
      binding_role: binding.binding_role,
      credential_source: binding.credential_source,
      status: binding.status,
      state: bindingState,
    } : { state: bindingState },
    tenant_policy: rows.tenantPolicy ? {
      tenant_id: rows.tenantPolicy.tenant_id,
      source_mode: rows.tenantPolicy.source_mode,
      fallback_allowed: Boolean(rows.tenantPolicy.fallback_allowed),
      required_for_device_install: Boolean(rows.tenantPolicy.required_for_device_install),
      status: rows.tenantPolicy.status,
      source: rows.tenantPolicy.source || null,
    } : null,
    credential_resolution: credential,
    skill_resolution: skill,
    smoke_certification: smokeCertification,
    approval: {
      approval_required: approvalRequired,
      base_required: baseApprovalRequired,
      grant: actionGrant,
      reason: approvalRequired ? actionGrant.reason : "action_grant_or_preview_policy_allows_dispatch",
    },
    execution: {
      will_execute: dispatchReady,
      next_step: dispatchReady ? "dispatch_ready" : (allowed ? "action_grant_required_before_dispatch" : "resolve_denials_before_execution"),
    },
    audit: {
      secrets_included: false,
      read_model_tables: [
        "app_integrations",
        "app_integration_action_bindings",
        "app_integration_tool_bindings",
        "tenant_integration_policies",
        "user_app_connections",
        "app_action_grants",
        "agent_skills",
        "agent_skill_grants",
      ],
    },
    secrets_included: false,
  };
}
