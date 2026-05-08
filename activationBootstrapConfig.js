import { getPool } from "./db.js";
import {
  ACTIVATION_GITHUB_BRANCH,
  ACTIVATION_GITHUB_ENDPOINT_KEY,
  ACTIVATION_GITHUB_OWNER,
  ACTIVATION_GITHUB_PARENT_ACTION_KEY,
  ACTIVATION_GITHUB_REPO,
} from "./config.js";

export const ACTIVATION_GITHUB_BOOTSTRAP_CONFIG_KEY = "activation.bootstrap.github";

const REQUIRED_GITHUB_BOOTSTRAP_FIELDS = Object.freeze([
  "github_parent_action_key",
  "github_endpoint_key",
  "github_owner",
  "github_repo",
  "github_branch",
]);

function parseJsonConfig(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function validateActivationBootstrapConfig(config = {}, source = "unknown") {
  const normalized = {
    source,
    sheets_required: false,
    github_parent_action_key: String(config.github_parent_action_key || "").trim(),
    github_endpoint_key: String(config.github_endpoint_key || "").trim(),
    github_owner: String(config.github_owner || "").trim(),
    github_repo: String(config.github_repo || "").trim(),
    github_branch: String(config.github_branch || "main").trim(),
  };

  const missing = REQUIRED_GITHUB_BOOTSTRAP_FIELDS.filter((field) => !normalized[field]);

  if (missing.length) {
    return {
      ok: false,
      source,
      error: "missing_required_activation_bootstrap_fields",
      missing,
    };
  }

  return {
    ok: true,
    source,
    config: normalized,
  };
}

export async function readActivationBootstrapFromDb(queryFn = null) {
  try {
    const execute = queryFn || ((sql, params) => getPool().query(sql, params));
    const [rows] = await execute(
      `
      SELECT config_json
      FROM platform_runtime_config
      WHERE config_key = ?
        AND status = 'active'
      LIMIT 1
      `,
      [ACTIVATION_GITHUB_BOOTSTRAP_CONFIG_KEY]
    );

    const row = Array.isArray(rows) ? rows[0] : null;
    const config = parseJsonConfig(row?.config_json);

    if (!config) {
      return {
        ok: false,
        source: "db_runtime",
        error: "activation_bootstrap_db_config_not_found",
      };
    }

    return validateActivationBootstrapConfig(config, "db_runtime");
  } catch (err) {
    return {
      ok: false,
      source: "db_runtime",
      error: err.code || "activation_bootstrap_db_read_failed",
      message: err.message,
    };
  }
}

export function readActivationBootstrapFromEnv() {
  return validateActivationBootstrapConfig(
    {
      github_parent_action_key: ACTIVATION_GITHUB_PARENT_ACTION_KEY,
      github_endpoint_key: ACTIVATION_GITHUB_ENDPOINT_KEY,
      github_owner: ACTIVATION_GITHUB_OWNER,
      github_repo: ACTIVATION_GITHUB_REPO,
      github_branch: ACTIVATION_GITHUB_BRANCH,
    },
    "server_env"
  );
}

export async function resolveActivationBootstrapConfig(options = {}) {
  const dbConfig = await readActivationBootstrapFromDb(options.query);

  if (dbConfig.ok) {
    return dbConfig;
  }

  const envConfig = readActivationBootstrapFromEnv();

  if (envConfig.ok) {
    return envConfig;
  }

  return {
    ok: false,
    source: "none",
    error: "activation_bootstrap_config_unresolved",
    db_error: dbConfig,
    env_error: envConfig,
  };
}