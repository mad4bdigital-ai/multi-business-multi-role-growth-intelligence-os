import { inferAuthMode } from "./authInjection.js";
import { policyValue } from "./registryResolution.js";
import { getGoogleAccessToken } from "./googleAuthTokenResolver.js";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";

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

// ── Public auth contract builder ───────────────────────────────────────────────

async function _buildAuthContract({
  action,
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
