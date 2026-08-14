function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

const SENSITIVE_KEY = /(?:secret|token|password|private[_-]?key|api[_-]?key|authorization|cookie|credential)/iu;

function containsSensitiveKey(value) {
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => SENSITIVE_KEY.test(key) || containsSensitiveKey(child));
}

export function createPlatformLegacyConfigurationAdapter({ pool } = {}) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A database pool is required.");

  async function read(configKey) {
    const [rows] = await pool.query(
      "SELECT config_key,config_json,status,updated_at FROM platform_runtime_config WHERE config_key=? AND status='active'",
      [configKey],
    );
    if (!Array.isArray(rows) || rows.length === 0) return { present: false, value: undefined, source: "platform_runtime_config", secrets_included: false };
    if (rows.length > 1) {
      const error = new Error("LEGACY_CONFIG_AMBIGUOUS");
      error.code = "LEGACY_CONFIG_AMBIGUOUS";
      throw error;
    }
    const value = parseJson(rows[0].config_json, undefined);
    if (containsSensitiveKey(value)) {
      const error = new Error("LEGACY_CONFIG_SECRET_PRESENT");
      error.code = "LEGACY_CONFIG_SECRET_PRESENT";
      error.details = { config_key: configKey, secrets_included: false };
      throw error;
    }
    return {
      present: value !== undefined,
      value,
      source: "platform_runtime_config",
      updated_at: rows[0].updated_at || null,
      secrets_included: false,
      authority: "legacy_compatibility_only",
    };
  }

  return Object.freeze({ read });
}

export const __test__ = Object.freeze({ containsSensitiveKey, parseJson });
