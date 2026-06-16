import { google } from "googleapis";
import { policyValue, policyList } from "./registryResolution.js";

const PREMIUM_RETRY_MUTATION_KEYS = new Set(["premium", "ultra_premium"]);

const _debug = (...args) => {
  if (String(process.env.EXECUTION_DEBUG || "").trim().toLowerCase() === "true") {
    console.log(...args);
  }
};

// --- retryMutation private helpers ---

export function retryMutationEnabled(policies = []) {
  return String(
    policyValue(policies, "HTTP Execution Resilience", "Retry Mutation Enabled", "FALSE")
  ).trim().toUpperCase() === "TRUE";
}

function retryMutationAppliesToQuery(policies = []) {
  return String(
    policyValue(policies, "HTTP Execution Resilience", "Retry Mutation Apply To", "")
  ).trim() === "query";
}

function retryMutationSchemaModeAllowlisted(policies = []) {
  return String(
    policyValue(policies, "HTTP Execution Resilience", "Retry Mutation Schema Mode", "")
  ).trim() === "allowlisted";
}

function parseRetryStageValue(stageValue = "") {
  const raw = String(stageValue || "").trim();
  if (!raw || raw === "{}") return {};

  const mutation = {};
  const pairs = raw
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

  for (const pair of pairs) {
    const [rawKey, rawValue] = pair.split("=");
    const key = String(rawKey || "").trim();
    const value = String(rawValue || "").trim().toLowerCase();

    if (!key) continue;
    if (!PREMIUM_RETRY_MUTATION_KEYS.has(key)) continue;

    if (value === "true") mutation[key] = true;
    else if (value === "false") mutation[key] = false;
    else mutation[key] = String(rawValue || "").trim();
  }

  return mutation;
}

// --- Google OAuth scope resolution ---

export function getDefaultGoogleScopes(action = {}, endpoint = {}) {
  const actionKey = String(action.action_key || "").trim();
  const method = String(endpoint.method || "").trim().toUpperCase();
  const readonly = method === "GET";

  switch (actionKey) {
    case "googleads_api":
      return ["https://www.googleapis.com/auth/adwords"];

    case "searchads360_api":
      return ["https://www.googleapis.com/auth/doubleclicksearch"];

    case "searchconsole_api":
      return [
        readonly
          ? "https://www.googleapis.com/auth/webmasters.readonly"
          : "https://www.googleapis.com/auth/webmasters"
      ];

    case "analytics_data_api":
      return ["https://www.googleapis.com/auth/analytics.readonly"];

    case "analytics_admin_api":
      return ["https://www.googleapis.com/auth/analytics.edit"];

    case "tagmanager_api":
      return [
        readonly
          ? "https://www.googleapis.com/auth/tagmanager.readonly"
          : "https://www.googleapis.com/auth/tagmanager.edit.containers"
      ];

    default:
      return ["https://www.googleapis.com/auth/cloud-platform"];
  }
}

export function normalizeGoogleScopeList(scopes = []) {
  return Array.isArray(scopes)
    ? [...new Set(scopes.map(v => String(v || "").trim()).filter(Boolean))]
    : [];
}

function parseRuntimeBindingProfile(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const raw = String(value || "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function getScopesFromRuntimeBindingProfile(record = {}) {
  const profile = parseRuntimeBindingProfile(record.runtime_binding_profile);
  const authStrategy = profile.auth_strategy || profile.authStrategy || {};
  return normalizeGoogleScopeList(
    authStrategy.required_scopes ||
    authStrategy.requiredScopes ||
    profile.required_scopes ||
    profile.requiredScopes ||
    []
  );
}

export async function resolveDelegatedGoogleScopes({ policies, action, endpoint }) {
  const endpointScopedKey = `${action.action_key}|${endpoint.endpoint_key}|scopes`;
  const actionScopedKey = `${action.action_key}|scopes`;

  const endpointContractScopes = getScopesFromRuntimeBindingProfile(endpoint);
  if (endpointContractScopes.length) {
    return {
      explicitScopes: endpointContractScopes,
      scopeSource: `sql:endpoint.runtime_binding_profile:${endpoint.endpoint_key}`
    };
  }

  const actionContractScopes = getScopesFromRuntimeBindingProfile(action);
  if (actionContractScopes.length) {
    return {
      explicitScopes: actionContractScopes,
      scopeSource: `sql:action.runtime_binding_profile:${action.action_key}`
    };
  }

  const endpointPolicyScopes = policyList(policies, "HTTP Google Auth", endpointScopedKey);
  if (endpointPolicyScopes.length) {
    return {
      explicitScopes: endpointPolicyScopes,
      scopeSource: `sql:execution_policy:endpoint:${endpointScopedKey}`
    };
  }

  const actionPolicyScopes = policyList(policies, "HTTP Google Auth", actionScopedKey);
  if (actionPolicyScopes.length) {
    return {
      explicitScopes: actionPolicyScopes,
      scopeSource: `sql:execution_policy:action:${actionScopedKey}`
    };
  }

  const err = new Error("Google OAuth scope contract is missing from the SQL runtime registry.");
  err.code = "auth_scope_contract_missing";
  err.status = 500;
  err.details = {
    action_key: String(action.action_key || "").trim(),
    endpoint_key: String(endpoint.endpoint_key || "").trim(),
    required_surface: "runtime_binding_profile_or_execution_policy"
  };
  throw err;
}

export async function mintGoogleAccessTokenForEndpoint({ policies, action, endpoint }) {
  const { explicitScopes, scopeSource } = await resolveDelegatedGoogleScopes({
    policies,
    action,
    endpoint
  });
  _debug("GOOGLE_SCOPE_SOURCE:", scopeSource);
  _debug("GOOGLE_SCOPES:", JSON.stringify(explicitScopes));

  const auth = new google.auth.GoogleAuth({ scopes: explicitScopes });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
  if (!token) {
    const err = new Error("Unable to mint Google access token for delegated execution.");
    err.code = "auth_resolution_failed";
    err.status = 500;
    throw err;
  }
  return token;
}

// --- Policy enforcement ---

export function requirePolicyTrue(policies, group, key, message) {
  const value = policyValue(policies, group, key, "FALSE");
  if (String(value).trim().toUpperCase() !== "TRUE") {
    const err = new Error(message || `${group} | ${key} policy is not enabled.`);
    err.code = "policy_blocked";
    err.status = 403;
    throw err;
  }
}

export function requirePolicySet(policies, group, keys = []) {
  const missing = (keys || []).filter(key => {
    const value = policyValue(policies, group, key, "FALSE");
    return String(value).trim().toUpperCase() !== "TRUE";
  });

  return {
    ok: missing.length === 0,
    missing
  };
}

export function getRequiredHttpExecutionPolicyKeys(policies = []) {
  const auditEnabled =
    String(
      policyValue(
        policies,
        "HTTP Execution Governance",
        "Required Policy Presence Audit Enabled",
        "FALSE"
      )
    )
      .trim()
      .toUpperCase() === "TRUE";

  const configuredKeys = policyList(
    policies,
    "HTTP Execution Governance",
    "Required Policy Presence Audit Keys"
  );

  const fallbackKeys = [
    "Require Endpoint Active",
    "Require Execution Readiness",
    "Enforce Parent Action Match",
    "Require Relative Path",
    "Require Auth Generation",
    "Server-Side Auth Injection Required",
    "Require Action Schema Resolution",
    "Require Request Schema Alignment"
  ];

  if (auditEnabled && configuredKeys.length) {
    return configuredKeys;
  }

  return fallbackKeys;
}

export function buildMissingRequiredPolicyError(policies = [], missing = []) {
  const handling = String(
    policyValue(
      policies,
      "HTTP Execution Governance",
      "Missing Required Policy Handling",
      "BLOCK"
    )
  ).trim();

  const err = new Error(
    "Required HTTP Execution Governance policies are not fully enabled."
  );
  err.code = "missing_required_http_execution_policy";
  err.status = 403;
  err.details = {
    policy_group: "HTTP Execution Governance",
    missing_keys: missing,
    handling
  };
  return err;
}

// --- Resilience ---

export function resilienceAppliesToParentAction(policies, parentActionKey) {
  const enabled = String(
    policyValue(
      policies,
      "HTTP Execution Resilience",
      "Retry Mutation Enabled",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  if (!enabled) return false;

  const affected = policyList(
    policies,
    "HTTP Execution Resilience",
    "Affected Parent Action Keys"
  );

  return affected.includes(String(parentActionKey || "").trim());
}

export function shouldRetryProviderResponse(policies, upstreamStatus, responseText) {
  const triggers = policyList(
    policies,
    "HTTP Execution Resilience",
    "Provider Retry Trigger"
  );

  const text = String(responseText || "");
  for (const trigger of triggers) {
    if (trigger === "upstream_status>=500" && Number(upstreamStatus) >= 500) {
      return true;
    }
    if (trigger.startsWith("response_contains:")) {
      const needle = trigger.slice("response_contains:".length);
      if (needle && text.includes(needle)) {
        return true;
      }
    }
  }
  return false;
}

export function buildProviderRetryMutations(policies, actionKey = "") {
  if (!retryMutationEnabled(policies)) return [];
  if (!retryMutationAppliesToQuery(policies)) return [];
  if (!retryMutationSchemaModeAllowlisted(policies)) return [];
  if (!resilienceAppliesToParentAction(policies, actionKey)) return [];

  const strategy = String(
    policyValue(policies, "HTTP Execution Resilience", "Retry Strategy", "")
  ).trim();

  if (strategy !== "premium_escalation") return [];

  const stages = [
    String(policyValue(policies, "HTTP Execution Resilience", "Retry Stage 0", "{}")).trim(),
    String(policyValue(policies, "HTTP Execution Resilience", "Retry Stage 1", "")).trim(),
    String(policyValue(policies, "HTTP Execution Resilience", "Retry Stage 2", "")).trim()
  ].filter(Boolean);

  return stages
    .map(parseRetryStageValue)
    .filter((mutation, index) => {
      if (index === 0) return false;
      return Object.keys(mutation || {}).length > 0;
    });
}
