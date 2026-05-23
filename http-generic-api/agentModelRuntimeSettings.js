import { getPool } from "./db.js";

export const MODEL_RUNTIME_CONFIG_KEY = "agent_model_runtime";

export const SUPPORTED_MODEL_PROVIDERS = Object.freeze([
  "openrouter",
  "openai",
  "anthropic",
  "gemini",
]);

export const DEFAULT_AGENT_MODEL_RUNTIME_CONFIG = Object.freeze({
  version: 1,
  free_first: true,
  provider_order: ["gemini", "openrouter", "openai", "anthropic"],
  providers: {
    openrouter: {
      enabled: true,
      credential_env_var: "OPENROUTER_API_KEY",
      default_model: "openrouter/free",
      models: {
        standard: "openrouter/free",
        complex: "openrouter/free",
        authority: "openrouter/free",
      },
      optional_headers: {
        site_url_env_var: "OPENROUTER_SITE_URL",
        app_name_env_var: "OPENROUTER_APP_NAME",
      },
    },
    openai: {
      enabled: true,
      credential_env_var: "OPENAI_API_KEY",
      default_model: "gpt-4o-mini",
      models: {
        standard: "gpt-4o-mini",
        complex: "gpt-4o",
        authority: "gpt-4o",
      },
    },
    anthropic: {
      enabled: true,
      credential_env_var: "ANTHROPIC_API_KEY",
      default_model: "claude-haiku-4-5-20251001",
      models: {
        standard: "claude-haiku-4-5-20251001",
        complex: "claude-sonnet-4-6",
        authority: "claude-opus-4-7",
      },
    },
    gemini: {
      enabled: true,
      credential_env_var: "GEMINI_API_KEY",
      fallback_credential_env_vars: ["GOOGLE_AI_API_KEY"],
      default_model: "gemini-3.5-flash",
      models: {
        standard: "gemini-3.5-flash",
        complex: "gemini-3.5-flash",
        authority: "gemini-3.5-flash",
      },
    },
  },
});

const CACHE_TTL_MS = 30_000;
let cachedSettings = null;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeProviderKey(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeModelMap(value = {}, fallback = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    standard: String(source.standard || fallback.standard || "").trim(),
    complex: String(source.complex || fallback.complex || source.standard || fallback.standard || "").trim(),
    authority: String(source.authority || fallback.authority || source.complex || fallback.complex || source.standard || fallback.standard || "").trim(),
  };
}

function assertNoSecretFields(value, path = "settings") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = String(key || "").toLowerCase();
    if (/(api[_-]?key|secret|token|password|credential_value|private_key)/i.test(normalized)) {
      const err = new Error(`Model runtime settings must not contain secret field ${path}.${key}`);
      err.code = "model_runtime_settings_secret_field";
      err.status = 400;
      throw err;
    }
    if (nested && typeof nested === "object") assertNoSecretFields(nested, `${path}.${key}`);
  }
}

export function normalizeAgentModelRuntimeConfig(input = {}) {
  assertNoSecretFields(input);
  const defaults = cloneJson(DEFAULT_AGENT_MODEL_RUNTIME_CONFIG);
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const providers = {};

  for (const provider of SUPPORTED_MODEL_PROVIDERS) {
    const fallback = defaults.providers[provider] || {};
    const candidate = source.providers?.[provider] || {};
    providers[provider] = {
      ...fallback,
      ...candidate,
      enabled: candidate.enabled === undefined ? fallback.enabled !== false : candidate.enabled === true,
      credential_env_var: String(candidate.credential_env_var || fallback.credential_env_var || "").trim(),
      fallback_credential_env_vars: Array.isArray(candidate.fallback_credential_env_vars)
        ? candidate.fallback_credential_env_vars.map(v => String(v || "").trim()).filter(Boolean)
        : Array.isArray(fallback.fallback_credential_env_vars)
          ? fallback.fallback_credential_env_vars.map(v => String(v || "").trim()).filter(Boolean)
          : [],
      default_model: String(candidate.default_model || fallback.default_model || "").trim(),
      models: normalizeModelMap(candidate.models, fallback.models),
    };
    if (fallback.optional_headers || candidate.optional_headers) {
      providers[provider].optional_headers = {
        ...(fallback.optional_headers || {}),
        ...(candidate.optional_headers || {}),
      };
    }
  }

  const providerOrder = Array.isArray(source.provider_order)
    ? source.provider_order.map(normalizeProviderKey).filter(p => SUPPORTED_MODEL_PROVIDERS.includes(p))
    : defaults.provider_order;

  return {
    version: Number(source.version || defaults.version || 1),
    free_first: source.free_first === undefined ? defaults.free_first === true : source.free_first === true,
    provider_order: providerOrder.length ? [...new Set(providerOrder)] : defaults.provider_order,
    providers,
  };
}

export function summarizeModelRuntimeSettings(config = DEFAULT_AGENT_MODEL_RUNTIME_CONFIG, env = process.env) {
  const normalized = normalizeAgentModelRuntimeConfig(config);
  const providers = {};
  for (const provider of SUPPORTED_MODEL_PROVIDERS) {
    const item = normalized.providers[provider];
    const credentialEnvVars = [item.credential_env_var, ...(item.fallback_credential_env_vars || [])].filter(Boolean);
    providers[provider] = {
      enabled: item.enabled === true,
      credential_env_var: item.credential_env_var,
      fallback_credential_env_vars: item.fallback_credential_env_vars || [],
      credential_configured: credentialEnvVars.some(name => Boolean(env[name])),
      configured_credential_env_var: credentialEnvVars.find(name => Boolean(env[name])) || null,
      default_model: item.default_model,
      models: item.models,
    };
  }
  return {
    version: normalized.version,
    free_first: normalized.free_first,
    provider_order: normalized.provider_order,
    providers,
  };
}

export function resolveAgentModelCandidateChain({ execution_class = "standard", env = process.env, config = DEFAULT_AGENT_MODEL_RUNTIME_CONFIG } = {}) {
  const cls = String(execution_class || "standard").trim() || "standard";
  const normalized = normalizeAgentModelRuntimeConfig(config);
  const explicitProvider = normalizeProviderKey(env.AGENT_MODEL_PROVIDER || "");
  const order = explicitProvider && SUPPORTED_MODEL_PROVIDERS.includes(explicitProvider)
    ? [explicitProvider]
    : normalized.provider_order;
  const candidates = [];

  for (const provider of order) {
    const providerConfig = normalized.providers[provider];
    if (!providerConfig || providerConfig.enabled !== true) continue;
    const credentialEnvVars = [providerConfig.credential_env_var, ...(providerConfig.fallback_credential_env_vars || [])]
      .map(v => String(v || "").trim())
      .filter(Boolean);
    const credentialEnvVar = credentialEnvVars.find(name => Boolean(env[name])) || credentialEnvVars[0] || "";
    const credentialConfigured = Boolean(credentialEnvVar && env[credentialEnvVar]);
    if (!credentialConfigured) continue;
    const model = String(env.AGENT_MODEL || providerConfig.models?.[cls] || providerConfig.default_model || "").trim();
    if (!model) continue;
    candidates.push({
      provider,
      model,
      execution_class: cls,
      credential_env_var: credentialEnvVar,
      credential_configured: true,
      source: explicitProvider ? "env_provider" : "platform_runtime_config",
      explicit_provider: explicitProvider || null,
      free_first: normalized.free_first,
    });
  }

  return candidates;
}

export function resolveAgentModelSelection({ execution_class = "standard", env = process.env, config = DEFAULT_AGENT_MODEL_RUNTIME_CONFIG } = {}) {
  const cls = String(execution_class || "standard").trim() || "standard";
  const normalized = normalizeAgentModelRuntimeConfig(config);
  const explicitProvider = normalizeProviderKey(env.AGENT_MODEL_PROVIDER || "");
  const order = explicitProvider && SUPPORTED_MODEL_PROVIDERS.includes(explicitProvider)
    ? [explicitProvider]
    : normalized.provider_order;

  for (const provider of order) {
    const providerConfig = normalized.providers[provider];
    if (!providerConfig || providerConfig.enabled !== true) continue;
    const credentialEnvVars = [providerConfig.credential_env_var, ...(providerConfig.fallback_credential_env_vars || [])]
      .map(v => String(v || "").trim())
      .filter(Boolean);
    const credentialEnvVar = credentialEnvVars.find(name => Boolean(env[name])) || credentialEnvVars[0] || "";
    const credentialConfigured = Boolean(credentialEnvVar && env[credentialEnvVar]);
    if (!credentialConfigured) continue;
    const model = String(env.AGENT_MODEL || providerConfig.models?.[cls] || providerConfig.default_model || "").trim();
    if (!model) continue;
    return {
      provider,
      model,
      execution_class: cls,
      credential_env_var: credentialEnvVar,
      credential_configured: true,
      source: explicitProvider ? "env_provider" : "platform_runtime_config",
      explicit_provider: explicitProvider || null,
      free_first: normalized.free_first,
    };
  }

  const fallbackProvider = explicitProvider && SUPPORTED_MODEL_PROVIDERS.includes(explicitProvider)
    ? explicitProvider
    : (normalized.provider_order[0] || "anthropic");
  const fallbackConfig = normalized.providers[fallbackProvider] || normalized.providers.anthropic;
  return {
    provider: fallbackProvider,
    model: String(env.AGENT_MODEL || fallbackConfig?.models?.[cls] || fallbackConfig?.default_model || "").trim(),
    execution_class: cls,
    credential_env_var: String(fallbackConfig?.credential_env_var || "").trim(),
    credential_configured: false,
    source: explicitProvider ? "env_provider_missing_credentials" : "platform_runtime_config_missing_credentials",
    explicit_provider: explicitProvider || null,
    free_first: normalized.free_first,
  };
}

export async function loadAgentModelRuntimeSettings({ pool = getPool(), force = false } = {}) {
  const now = Date.now();
  if (!force && cachedSettings && now - cachedSettings.loaded_at_ms < CACHE_TTL_MS) return cachedSettings;

  try {
    const [rows] = await pool.query(
      "SELECT config_json, status, updated_at FROM `platform_runtime_config` WHERE config_key = ? LIMIT 1",
      [MODEL_RUNTIME_CONFIG_KEY]
    );
    const row = rows?.[0];
    const config = row?.status === "active"
      ? normalizeAgentModelRuntimeConfig(typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json)
      : normalizeAgentModelRuntimeConfig(DEFAULT_AGENT_MODEL_RUNTIME_CONFIG);
    cachedSettings = {
      ok: true,
      source: row?.status === "active" ? "platform_runtime_config" : "default",
      config,
      updated_at: row?.updated_at || null,
      loaded_at_ms: now,
    };
  } catch (err) {
    cachedSettings = {
      ok: false,
      source: "default",
      config: normalizeAgentModelRuntimeConfig(DEFAULT_AGENT_MODEL_RUNTIME_CONFIG),
      error: { code: "model_runtime_config_load_failed", message: err?.message || String(err) },
      loaded_at_ms: now,
    };
  }
  return cachedSettings;
}

export async function saveAgentModelRuntimeSettings({ pool = getPool(), config, note = "Updated through governed model runtime settings route" } = {}) {
  const normalized = normalizeAgentModelRuntimeConfig(config);
  await pool.query(
    `INSERT INTO \`platform_runtime_config\` (config_key, config_json, status, note)
     VALUES (?, ?, 'active', ?)
     ON DUPLICATE KEY UPDATE
       config_json = VALUES(config_json),
       status = VALUES(status),
       note = VALUES(note),
       updated_at = CURRENT_TIMESTAMP`,
    [MODEL_RUNTIME_CONFIG_KEY, JSON.stringify(normalized), note]
  );
  cachedSettings = null;
  return { ok: true, config: normalized };
}
