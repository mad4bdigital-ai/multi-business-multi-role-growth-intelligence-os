import {
  getRemoteMcpScopeCatalog,
  REMOTE_MCP_SCOPES,
  resolveRemoteMcpToolScopeBinding,
} from "./remoteMcpScopeCatalog.js";

function normalizeScopes(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/\s+/u);
  return [...new Set(raw.map((scope) => String(scope || "").trim()).filter(Boolean))];
}

export function mergeRemoteMcpScopes(...values) {
  return [...new Set(values.flatMap(normalizeScopes))];
}

export function buildRemoteMcpIncrementalConsentRequest({
  toolKey,
  grantedScopes = [],
  clientAllowedScopes = [],
  clientId = null,
  resource = null,
  authorizationEndpoint = null,
  redirectUris = [],
  state = null,
  codeChallenge = null,
  catalog = getRemoteMcpScopeCatalog(),
} = {}) {
  const binding = resolveRemoteMcpToolScopeBinding(toolKey, catalog);
  if (!binding || binding.status !== "active" || !binding.scope_keys?.length) {
    return {
      required: false,
      ok: false,
      code: "MCP_TOOL_SCOPE_BINDING_MISSING",
      missing_scopes: [],
      secrets_included: false,
    };
  }

  const current = normalizeScopes(grantedScopes);
  if (!Array.isArray(clientAllowedScopes)) {
    return {
      required: false,
      ok: false,
      code: "MCP_INCREMENTAL_CONSENT_UNAVAILABLE",
      tool_key: toolKey,
      missing_scopes: [],
      current_scopes: current,
      secrets_included: false,
    };
  }
  const allowed = new Set(normalizeScopes(clientAllowedScopes));
  const missing = binding.scope_keys.filter((scope) => !current.includes(scope));
  const unavailable = missing.filter((scope) => !allowed.has(scope));
  if (unavailable.length) {
    return {
      required: false,
      ok: false,
      code: "MCP_SCOPE_NOT_ALLOWED_FOR_CLIENT",
      tool_key: toolKey,
      missing_scopes: unavailable,
      current_scopes: current,
      secrets_included: false,
    };
  }
  if (!missing.length) {
    return {
      required: false,
      ok: true,
      tool_key: toolKey,
      current_scopes: current,
      missing_scopes: [],
      secrets_included: false,
    };
  }

  if (!String(state || "").trim() || !String(codeChallenge || "").trim()) {
    return {
      required: true,
      ok: false,
      code: "MCP_INCREMENTAL_CONSENT_CONTEXT_REQUIRED",
      tool_key: toolKey,
      missing_scopes: missing,
      current_scopes: current,
      requested_scopes: mergeRemoteMcpScopes(current, missing),
      required_parameters: ["redirect_uri", "state", "code_challenge", "code_challenge_method"],
      pkce_owner: "client",
      message: "The client must supply a short-lived OAuth state and an S256 code challenge generated from its code verifier.",
      secrets_included: false,
    };
  }

  const query = new URLSearchParams();
  if (clientId) query.set("client_id", String(clientId));
  query.set("response_type", "code");
  query.set("scope", missing.join(" "));
  if (resource) query.set("resource", String(resource));
  const normalizedRedirectUris = normalizeScopes(redirectUris);
  if (normalizedRedirectUris.length === 1) query.set("redirect_uri", normalizedRedirectUris[0]);
  query.set("state", String(state).trim());
  query.set("code_challenge", String(codeChallenge).trim());
  query.set("code_challenge_method", "S256");
  return {
    required: true,
    ok: true,
    mode: "incremental",
    tool_key: toolKey,
    missing_scopes: missing,
    current_scopes: current,
    requested_scopes: mergeRemoteMcpScopes(current, missing),
    default_scopes: [...REMOTE_MCP_SCOPES],
    authorization_endpoint: authorizationEndpoint,
    redirect_uri_options: normalizedRedirectUris,
    authorization_parameters: Object.fromEntries(query.entries()),
    required_parameters: ["redirect_uri", "state", "code_challenge", "code_challenge_method"],
    pkce_owner: "client",
    catalog_revision: catalog.revision || null,
    message: "Additional consent is required for this tool. Re-authorize only the missing scope(s).",
    secrets_included: false,
  };
}
