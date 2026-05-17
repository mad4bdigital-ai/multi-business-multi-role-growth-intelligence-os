import { inferAuthMode } from "./authInjection.js";
import { policyValue } from "./registryResolution.js";
import { getGoogleAccessToken } from "./googleAuthTokenResolver.js";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import { findUserAppConnection, extractCredentialValue, extractCredentialHeaders } from "./userAppConnectionCredentials.js";

// ── Storage-mode-aware secret resolvers ───────────────────────────────────────

function resolveActionSecret(action) {
  const storageMode = String(action.api_key_storage_mode || "").trim().toLowerCase();

  if (storageMode === "secret_reference" || storageMode === "env_var") {
    return resolveSecretFromReference(action.secret_store_ref);
  }

  if (storageMode === "embedded_sheet") {
    console.warn(
      `[authCredential] SECURITY: action "${action.action_key}" has api_key_storage_mode=embedded_sheet. ` +
      `Set api_key_storage_mode=secret_reference and add the rotated key to .env as ref:secret:<ENV_VAR>. ` +
      `Returning empty secret.`
    );
    return "";
  }

  if (action.api_key_value) {
    console.warn(
      `[authCredential] action "${action.action_key}" uses unrecognised storage mode "${storageMode}". ` +
      `Using api_key_value as fallback. Move to secret_reference.`
    );
  }
  return action.api_key_value || "";
}

export function resolveWpAppPassword(brand = {}) {
  const targetKey = String(brand?.target_key || "").trim();
  if (targetKey) {
    const envKey = targetKey
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "_")
      .replace(/_+/g, "_") + "_APP_PASSWORD";
    const fromEnv = String(process.env[envKey] || "").trim();
    if (fromEnv) return fromEnv;
  }

  const embedded = String(brand?.application_password || "").trim();
  if (embedded) {
    console.warn(
      `[authCredential] SECURITY: brand "${brand?.brand_name}" has embedded application_password in registry. ` +
      `Run sanitize-credentials.mjs --apply and set ${targetKey.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_APP_PASSWORD in .env.`
    );
  }
  return embedded;
}

// ── Parent-action auth strategy helpers ────────────────────────────────────────

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function boolOption(value, fallback = false) {
  if (value === true || value === false) return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

function asList(value) {
  if (Array.isArray(value)) return value.map(v => String(v || "").trim()).filter(Boolean);
  return String(value || "").split(/[,|\s]+/).map(v => v.trim()).filter(Boolean);
}

function defaultAppKeyForAction(action = {}) {
  return String(action.action_key || action.module_binding || action.connector_family || "").trim();
}

function getParentAuthStrategy(action = {}, endpoint = {}) {
  const actionProfile = parseJsonObject(action.runtime_binding_profile);
  const endpointProfile = parseJsonObject(endpoint.runtime_binding_profile);
  const base = actionProfile.auth_strategy && typeof actionProfile.auth_strategy === "object" ? actionProfile.auth_strategy : {};
  const override = endpointProfile.auth_strategy_override && typeof endpointProfile.auth_strategy_override === "object" ? endpointProfile.auth_strategy_override : {};
  return {
    auth_strategy_version: 1,
    default_scope: "platform",
    supported_scopes: ["platform", "tenant", "user", "connection"],
    credential_resolution_order: ["request_connection", "user_primary_connection", "tenant_primary_connection", "platform_secret"],
    allow_platform_fallback_default: true,
    allowed_auth_types: ["oauth2", "api_key", "bearer_token", "basic_auth", "custom_headers", "client_credentials"],
    app_key: defaultAppKeyForAction(action),
    required_scopes: [],
    ...base,
    ...override
  };
}

function resolveRequestedCredentialScope({ strategy, auth_context, credential_scope }) {
  const requested = String(auth_context?.credential_scope || credential_scope || "").trim().toLowerCase();
  const defaultScope = String(strategy.default_scope || "platform").trim().toLowerCase() || "platform";
  const scope = requested || defaultScope;
  if (scope === "auto") return "auto";
  const supported = asList(strategy.supported_scopes).map(v => v.toLowerCase());
  return supported.includes(scope) ? scope : defaultScope;
}

function allowFallbackForScope({ strategy, auth_context, allow_platform_fallback, scope }) {
  if (allow_platform_fallback !== undefined) return boolOption(allow_platform_fallback, false);
  if (auth_context && Object.prototype.hasOwnProperty.call(auth_context, "allow_platform_fallback")) return boolOption(auth_context.allow_platform_fallback, false);
  if (["user", "tenant", "connection"].includes(scope)) return boolOption(strategy.allow_platform_fallback_default, false);
  return true;
}

function authTypesForMode(mode, strategy = {}) {
  const allowed = asList(strategy.allowed_auth_types);
  if (mode === "bearer_token" || mode === "github_app") return allowed.length ? allowed : ["bearer_token", "api_key", "oauth2"];
  if (mode === "api_key_header" || mode === "api_key_query") return allowed.length ? allowed : ["api_key", "bearer_token"];
  if (mode === "basic_auth") return ["basic_auth"];
  if (mode === "custom_headers") return ["custom_headers"];
  if (mode === "google_oauth2" || mode === "google_ads_oauth2" || mode === "oauth_gpt_action") return ["oauth2"];
  return allowed;
}

function credentialScopeCandidates(scope, auth_context = {}) {
  if (scope === "auto") {
    const candidates = [];
    if (auth_context?.connection_id) candidates.push("connection");
    if (auth_context?.user_id) candidates.push("user");
    if (auth_context?.tenant_id) candidates.push("tenant");
    return candidates;
  }
  return [scope].filter(v => ["user", "tenant", "connection"].includes(v));
}

async function resolveScopedConnection({ action, endpoint, mode, user_id, tenant_id, auth_context, credential_scope, allow_platform_fallback }) {
  const strategy = getParentAuthStrategy(action, endpoint);
  const scope = resolveRequestedCredentialScope({ strategy, auth_context, credential_scope });
  const fallbackAllowed = allowFallbackForScope({ strategy, auth_context, allow_platform_fallback, scope });
  if (scope === "platform") return { connection: null, strategy, scope, fallbackAllowed };

  const appKey = String(auth_context?.app_key || strategy.app_key || defaultAppKeyForAction(action)).trim();
  const requiredScopes = Array.isArray(strategy.required_scopes) ? strategy.required_scopes.join(" ") : String(strategy.required_scopes || "").trim();
  const authTypes = authTypesForMode(mode, strategy);

  for (const candidateScope of credentialScopeCandidates(scope, { ...auth_context, user_id, tenant_id })) {
    const connection = await findUserAppConnection({
      action,
      authContext: { ...(auth_context || {}), user_id, tenant_id, credential_scope: candidateScope },
      credentialScope: candidateScope,
      userId: user_id,
      tenantId: tenant_id,
      appKey,
      authType: authTypes,
      connectionId: auth_context?.connection_id || "",
      requiredScopes
    });
    if (connection) return { connection, strategy, scope: candidateScope, fallbackAllowed };
  }

  if (!fallbackAllowed) {
    const err = new Error(`No active ${scope} credential connection found for action ${action?.action_key || "unknown"}; platform fallback is disabled.`);
    err.code = "external_credential_connection_not_found";
    err.status = 403;
    err.details = { action_key: action?.action_key || "", requested_scope: scope, app_key: appKey };
    throw err;
  }
  return { connection: null, strategy, scope, fallbackAllowed };
}

function applyConnectionToContract(contract, connectionResult, mode) {
  const connection = connectionResult?.connection;
  if (!connection) return false;
  const credentials = connection.credentials || {};
  contract.credential_resolution_source = `user_app_connections:${connection.row?.connection_id || ""}`;
  contract.credential_scope = connectionResult.scope || "";

  if (mode === "basic_auth") {
    contract.username = extractCredentialValue(credentials, "username", "user", "email");
    contract.secret = extractCredentialValue(credentials, "password", "app_password", "secret", "token");
    contract.header_name = "Authorization";
    return true;
  }
  if (mode === "api_key_query") {
    contract.param_name = contract.param_name || "api_key";
    contract.secret = extractCredentialValue(credentials, "api_key", "apikey", "key", "token", "secret");
    return true;
  }
  if (mode === "api_key_header") {
    contract.header_name = contract.header_name || "x-api-key";
    contract.secret = extractCredentialValue(credentials, "api_key", "apikey", "key", "token", "secret");
    return true;
  }
  if (mode === "custom_headers") {
    contract.custom_headers = extractCredentialHeaders(credentials);
    return true;
  }
  if (["bearer_token", "github_app", "oauth_gpt_action"].includes(mode)) {
    contract.header_name = "Authorization";
    contract.mode = "bearer_token";
    contract.secret = extractCredentialValue(credentials, "access_token", "bearer_token", "token", "api_key", "secret");
    return true;
  }
  return false;
}

// ── Public auth contract builder ───────────────────────────────────────────────

async function _buildAuthContract({
  action,
  endpoint = {},
  brand,
  hostingAccounts = [],
  targetKey = "",
  user_id = "",
  tenant_id = "",
  auth_context = null,
  credential_scope = "",
  allow_platform_fallback = undefined
}) {
  const mode = inferAuthMode({ action, brand });
  const contract = {
    mode,
    inject: true,
    username: "",
    secret: "",
    param_name: "",
    header_name: "",
    custom_headers: {}
  };

  if (mode === "basic_auth") {
    contract.username = brand?.username || "";
    contract.secret = resolveWpAppPassword(brand);
    contract.header_name = "Authorization";
    return contract;
  }

  if (mode === "api_key_query") {
    contract.param_name = action.api_key_param_name || "api_key";
    contract.secret = resolveActionSecret(action);
    return contract;
  }

  if (mode === "api_key_header") {
    contract.header_name = action.api_key_header_name || "x-api-key";
    contract.secret = resolveActionSecret(action);
    return contract;
  }

  if (mode === "google_oauth2") {
    contract.header_name = "Authorization";
    contract.secret = await getGoogleAccessToken({ action, brand, targetKey, user_id, tenant_id, auth_context, credential_scope, allow_platform_fallback });
    return contract;
  }

  if (mode === "google_ads_oauth2") {
    contract.header_name = "Authorization";
    contract.secret = await getGoogleAccessToken({ action, brand, targetKey, user_id, tenant_id, auth_context, credential_scope, allow_platform_fallback });

    const devToken = String(process.env.GOOGLEADS_DEVELOPER_TOKEN || "").trim();
    const customerId = String(process.env.GOOGLEADS_LOGIN_CUSTOMER_ID || "").trim();
    contract.custom_headers = {};
    if (devToken) contract.custom_headers["developer-token"] = devToken;
    if (customerId) contract.custom_headers["login-customer-id"] = customerId;
    return contract;
  }

  if (mode === "github_app") {
    contract.header_name = "Authorization";
    contract.secret = await getGitHubAppInstallationToken({ action });
    return contract;
  }

  if (mode === "bearer_token") {
    contract.header_name = "Authorization";

    const storageMode = String(action.api_key_storage_mode || "").trim().toLowerCase();

    if (storageMode === "per_target_credentials") {
      const accountKey = resolveAccountKey({ brand, targetKey, hostingAccounts });
      const hostingAccount = findHostingAccountByKey(hostingAccounts, accountKey);

      if (!hostingAccount) {
        const err = new Error(
          `[authCredential] No hosting account found for per_target_credentials resolution. ` +
          `action="${action.action_key}" accountKey="${accountKey || "(unresolved)"}"`
        );
        err.code = "auth_resolution_failed";
        err.status = 500;
        throw err;
      }

      const accountStorageMode = String(
        hostingAccount.api_key_storage_mode || ""
      ).trim().toLowerCase();

      if (accountStorageMode === "secret_reference") {
        contract.secret = resolveSecretFromReference(hostingAccount.api_key_reference);
      } else {
        console.warn(
          `[authCredential] hosting account "${hostingAccount.hosting_account_key}" has ` +
          `api_key_storage_mode="${accountStorageMode}" — move to secret_reference.`
        );
        contract.secret = String(hostingAccount.api_key_reference || "").trim();
      }

      if (!contract.secret) {
        const err = new Error(
          `[authCredential] Empty secret after per_target_credentials resolution for ` +
          `hosting account "${hostingAccount.hosting_account_key}".`
        );
        err.code = "auth_resolution_failed";
        err.status = 500;
        throw err;
      }
      return contract;
    }

    contract.secret = resolveActionSecret(action);
    return contract;
  }

  return contract;
}

// Async public entry point — adds credential_resolution_status to every contract.
export async function normalizeAuthContract(args) {
  const contract = await _buildAuthContract(args);
  contract.credential_resolution_status = contract.secret ? "resolved" : "empty_secret";
  return contract;
}

export function findHostingAccountByKey(hostingAccounts = [], key = "") {
  const wanted = String(key || "").trim();
  if (!wanted) return null;
  return (
    hostingAccounts.find(
      row => String(row.hosting_account_key || "").trim() === wanted
    ) || null
  );
}

export function resolveAccountKeyFromBrand(brand = {}) {
  return (
    String(brand?.hosting_account_key || "").trim() ||
    String(brand?.hostinger_api_target_key || "").trim() ||
    String(brand?.hosting_account_registry_ref || "").trim()
  );
}

export function resolveAccountKey({
  brand = null,
  targetKey = "",
  hostingAccounts = []
}) {
  const fromBrand = resolveAccountKeyFromBrand(brand);
  if (fromBrand) return fromBrand;

  const directTargetKey = String(targetKey || "").trim();
  if (!directTargetKey) return "";

  const directHostingAccount = findHostingAccountByKey(hostingAccounts, directTargetKey);
  if (directHostingAccount) {
    return String(directHostingAccount.hosting_account_key || "").trim();
  }

  return "";
}

export function resolveSecretFromReference(reference = "") {
  const ref = String(reference || "").trim();
  if (!ref) return "";

  const prefix = "ref:secret:";
  if (!ref.startsWith(prefix)) return "";

  const secretKey = ref.slice(prefix.length).trim();
  if (!secretKey) return "";

  return String(process.env[secretKey] || "").trim();
}

export function isGoogleApiHost(providerDomain = "") {
  try {
    return new URL(providerDomain).hostname.endsWith("googleapis.com");
  } catch {
    return false;
  }
}

export function getAdditionalStaticAuthHeaders(action = {}, authContract = {}) {
  const headerName = String(action.api_key_header_name || "").trim();
  if (!headerName || headerName.toLowerCase() === "authorization") return {};

  const headerValue = resolveActionSecret(action);
  if (!headerValue) return {};

  return { [headerName]: headerValue };
}

export function enforceSupportedAuthMode(policies, mode) {
  const supported = String(policyValue(policies, "HTTP Execution Governance", "Supported Auth Modes", ""))
    .split("|")
    .map(v => v.trim())
    .filter(Boolean);

  if (!supported.includes(mode)) {
    const err = new Error(`Resolved auth mode is unsupported by policy: ${mode}`);
    err.code = "unsupported_auth_mode";
    err.status = 403;
    throw err;
  }
}
