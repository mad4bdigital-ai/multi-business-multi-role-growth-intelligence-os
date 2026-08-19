import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const REMOTE_MCP_ENVIRONMENTS = new Set(["staging", "production"]);

function normalizeRemoteMcpEnvironment(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return REMOTE_MCP_ENVIRONMENTS.has(normalized) ? normalized : "unknown";
}

function normalizeRemoteMcpRedirectUri(value, env = process.env) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2048) return "";
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.hash) return "";
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase());
    const loopbackAllowed = String(env.REMOTE_MCP_OAUTH_ALLOW_LOOPBACK || "").trim().toLowerCase() === "true";
    if (url.protocol !== "https:" && !(loopback && url.protocol === "http:" && loopbackAllowed)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

const REGISTRY_PATH = fileURLToPath(new URL("./config/remote-mcp-client-profile-registry.json", import.meta.url));
const PROFILE_KEY_PATTERN = /^[a-z][a-z0-9_]{2,63}$/u;
const STORAGE_SUFFIX_PATTERN = /^[A-Z][A-Z0-9_]{2,80}$/u;
const RISK_LEVELS = new Set(["low", "medium", "high", "critical"]);
const CALLBACK_MODES = new Set(["fixed", "origin_path_policy", "operator_exact_https"]);
const REQUIRED_READBACK_EVIDENCE = new Set([
  "environment",
  "profile_key",
  "client_id",
  "client_id_prefix",
  "secret_ref",
  "secret_presence",
  "redirect_uri_count",
  "scope_count",
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readRegistryFile() {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  assertRegistry(registry);
  return registry;
}

function assertHttpsUrl(value, field) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error(`Remote MCP profile registry ${field} must be a valid URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(`Remote MCP profile registry ${field} must be HTTPS without credentials or fragments.`);
  }
  return url;
}

function assertRegistry(registry) {
  if (registry?.contract !== "mad4b.remote-mcp-client-profile-registry.v1" || registry?.schema_version !== 1) {
    throw new Error("Remote MCP client profile registry contract is invalid.");
  }
  if (!Array.isArray(registry.profiles) || registry.profiles.length === 0) {
    throw new Error("Remote MCP client profile registry must contain profiles.");
  }
  const keys = new Set();
  const storageSuffixes = new Set();
  for (const profile of registry.profiles) {
    if (!profile || typeof profile !== "object") throw new Error("Remote MCP profile must be an object.");
    if (!PROFILE_KEY_PATTERN.test(String(profile.profile_key || ""))) throw new Error("Remote MCP profile_key is invalid.");
    if (keys.has(profile.profile_key)) throw new Error(`Duplicate Remote MCP profile_key: ${profile.profile_key}`);
    keys.add(profile.profile_key);
    if (profile.client_profile_key !== profile.profile_key) throw new Error(`client_profile_key must equal profile_key for ${profile.profile_key}.`);
    if (!STORAGE_SUFFIX_PATTERN.test(String(profile.storage_suffix || ""))) throw new Error(`Invalid storage_suffix for ${profile.profile_key}.`);
    if (storageSuffixes.has(profile.storage_suffix)) throw new Error(`Duplicate storage_suffix: ${profile.storage_suffix}`);
    storageSuffixes.add(profile.storage_suffix);
    if (!profile.owner || !RISK_LEVELS.has(profile.risk) || !["active", "disabled"].includes(profile.status)) throw new Error(`owner/risk/status metadata is invalid for ${profile.profile_key}.`);
    if (profile.token_endpoint_auth_method !== "client_secret_basic" && profile.token_endpoint_auth_method !== "client_secret_post") {
      throw new Error(`Remote MCP profile ${profile.profile_key} must use a confidential token endpoint auth method.`);
    }
    const callback = profile.callback;
    if (!callback || !CALLBACK_MODES.has(callback.mode)) throw new Error(`Callback policy is invalid for ${profile.profile_key}.`);
    if (callback.mode === "fixed") {
      if (!Array.isArray(callback.uris) || callback.uris.length === 0 || !callback.source_url) throw new Error(`Fixed callback policy is incomplete for ${profile.profile_key}.`);
      callback.uris.forEach((uri) => assertHttpsUrl(uri, `${profile.profile_key}.callback.uris`));
      assertHttpsUrl(callback.source_url, `${profile.profile_key}.callback.source_url`);
    }
    if (callback.mode === "origin_path_policy") {
      if (!Array.isArray(callback.allowed_origins) || callback.allowed_origins.length === 0 || !callback.source_url) throw new Error(`Origin/path callback policy is incomplete for ${profile.profile_key}.`);
      callback.allowed_origins.forEach((origin) => {
        const url = assertHttpsUrl(origin, `${profile.profile_key}.callback.allowed_origins`);
        if (url.pathname !== "/" || url.search) throw new Error(`Callback origin must be an origin only for ${profile.profile_key}.`);
      });
      assertHttpsUrl(callback.source_url, `${profile.profile_key}.callback.source_url`);
    }
    if (callback.mode === "operator_exact_https" && (callback.operator_approval_required !== true || !callback.source_url)) {
      throw new Error(`Operator callback policy must require approval and source evidence for ${profile.profile_key}.`);
    }
    if (callback.mode === "operator_exact_https") {
      assertHttpsUrl(callback.source_url, `${profile.profile_key}.callback.source_url`);
    }
    if (!Array.isArray(profile.readback_evidence) || ![...REQUIRED_READBACK_EVIDENCE].every((key) => profile.readback_evidence.includes(key))) {
      throw new Error(`Readback evidence is incomplete for ${profile.profile_key}.`);
    }
  }
}

export function loadRemoteMcpClientProfileRegistry() {
  return clone(readRegistryFile());
}

export function listRemoteMcpClientProfiles({ includeDisabled = false } = {}) {
  const registry = readRegistryFile();
  return clone(registry.profiles.filter((profile) => includeDisabled || profile.status === "active"));
}

export function getRemoteMcpClientProfile(profileKey = "generic_remote_mcp_client") {
  const normalized = String(profileKey || "generic_remote_mcp_client").trim().toLowerCase();
  const profile = readRegistryFile().profiles.find((candidate) => candidate.profile_key === normalized);
  if (!profile || profile.status !== "active") {
    const error = new Error(`Unknown or disabled Remote MCP client profile: ${normalized}`);
    error.code = "remote_mcp_client_profile_unknown";
    error.status = 400;
    throw error;
  }
  return clone(profile);
}

export function remoteMcpProfileConfigKey(environment, profileKey) {
  const env = normalizeRemoteMcpEnvironment(environment);
  const profile = getRemoteMcpClientProfile(profileKey);
  if (env === "unknown") return "";
  if (profile.profile_key === "generic_remote_mcp_client") return `remote_mcp.oauth.client.${env}`;
  return `remote_mcp.oauth.client.${env}.${profile.storage_suffix.toLowerCase()}`;
}

export function remoteMcpProfileSecretRef(environment, profileKey) {
  const env = normalizeRemoteMcpEnvironment(environment);
  const profile = getRemoteMcpClientProfile(profileKey);
  if (env === "unknown") return "";
  if (profile.profile_key === "generic_remote_mcp_client") return `platform_secret:REMOTE_MCP_${env.toUpperCase()}_OAUTH_CLIENT_SECRET`;
  return `platform_secret:REMOTE_MCP_${env.toUpperCase()}_${profile.storage_suffix}_OAUTH_CLIENT_SECRET`;
}

export function normalizeRemoteMcpProfileRedirectUris(value, profileKey, env = process.env) {
  const profile = getRemoteMcpClientProfile(profileKey);
  const supplied = Array.isArray(value) ? value : [];
  const normalized = [...new Set(supplied.map((uri) => normalizeRemoteMcpRedirectUri(uri, env)).filter(Boolean))];
  if (!normalized.length || normalized.length !== supplied.length) {
    const error = new Error("At least one exact approved HTTPS redirect URI is required for a Remote MCP client profile.");
    error.code = "remote_mcp_client_redirect_uri_invalid";
    error.status = 400;
    throw error;
  }
  const callback = profile.callback;
  for (const uri of normalized) {
    const parsed = new URL(uri);
    if (callback.mode === "fixed" && !callback.uris.includes(uri)) {
      throw new Error(`Redirect URI is not the registered fixed callback for profile ${profile.profile_key}.`);
    }
    if (callback.mode === "origin_path_policy") {
      const originAllowed = callback.allowed_origins.includes(parsed.origin);
      const pathAllowed = callback.allowed_exact_paths?.includes(parsed.pathname)
        || callback.allowed_path_prefixes?.some((prefix) => parsed.pathname.startsWith(prefix));
      if (!originAllowed || !pathAllowed || parsed.search || parsed.hash) {
        throw new Error(`Redirect URI is outside the approved origin/path policy for profile ${profile.profile_key}.`);
      }
    }
  }
  return normalized;
}

export function remoteMcpProfileSummary(profileKey) {
  const profile = getRemoteMcpClientProfile(profileKey);
  return {
    profile_key: profile.profile_key,
    display_name: profile.display_name,
    provider: profile.provider,
    surface: profile.surface,
    owner: profile.owner,
    risk: profile.risk,
    callback_mode: profile.callback.mode,
    token_endpoint_auth_method: profile.token_endpoint_auth_method,
    scope_policy: profile.scope_policy,
    storage_suffix: profile.storage_suffix,
    secrets_included: false,
  };
}

export function remoteMcpProfileRegistryPath() {
  return resolve(REGISTRY_PATH);
}
