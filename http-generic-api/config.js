// All environment-driven configuration. Import this everywhere instead of
// reading process.env directly in business logic.

export const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "20mb";

export const REGISTRY_SPREADSHEET_ID = process.env.REGISTRY_SPREADSHEET_ID || "";
export const ACTIVITY_SPREADSHEET_ID =
  process.env.ACTIVITY_SPREADSHEET_ID || REGISTRY_SPREADSHEET_ID;

export const BRAND_REGISTRY_SHEET = process.env.BRAND_REGISTRY_SHEET || "Brand Registry";
export const ACTIONS_REGISTRY_SHEET = process.env.ACTIONS_REGISTRY_SHEET || "Actions Registry";
export const ENDPOINT_REGISTRY_SHEET = process.env.ENDPOINT_REGISTRY_SHEET || "API Actions Endpoint Registry";
export const EXECUTION_POLICY_SHEET = process.env.EXECUTION_POLICY_SHEET || "Execution Policy Registry";
export const HOSTING_ACCOUNT_REGISTRY_SHEET =
  process.env.HOSTING_ACCOUNT_REGISTRY_SHEET || "Hosting Account Registry";
export const SITE_RUNTIME_INVENTORY_REGISTRY_SHEET =
  process.env.SITE_RUNTIME_INVENTORY_REGISTRY_SHEET || "Site Runtime Inventory Registry";
export const SITE_SETTINGS_INVENTORY_REGISTRY_SHEET =
  process.env.SITE_SETTINGS_INVENTORY_REGISTRY_SHEET || "Site Settings Inventory Registry";
export const PLUGIN_INVENTORY_REGISTRY_SHEET =
  process.env.PLUGIN_INVENTORY_REGISTRY_SHEET || "Plugin Inventory Registry";
export const TASK_ROUTES_SHEET =
  process.env.TASK_ROUTES_SHEET || "Task Routes";
export const WORKFLOW_REGISTRY_SHEET =
  process.env.WORKFLOW_REGISTRY_SHEET || "Workflow Registry";
export const REGISTRY_SURFACES_CATALOG_SHEET =
  process.env.REGISTRY_SURFACES_CATALOG_SHEET || "Registry Surfaces Catalog";
export const VALIDATION_REPAIR_REGISTRY_SHEET =
  process.env.VALIDATION_REPAIR_REGISTRY_SHEET || "Validation & Repair Registry";
export const EXECUTION_LOG_UNIFIED_SHEET =
  process.env.EXECUTION_LOG_UNIFIED_SHEET || "Execution Log Unified";
export const JSON_ASSET_REGISTRY_SHEET =
  process.env.JSON_ASSET_REGISTRY_SHEET || "JSON Asset Registry";
export const BRAND_CORE_REGISTRY_SHEET =
  process.env.BRAND_CORE_REGISTRY_SHEET || "Brand Core Registry";

export function positiveNumberEnv(name, fallback, { min = 1, max = Infinity } = {}) {
  const parsed = Number(process.env[name]);
  const fallbackNumber = Number(fallback);
  const safeFallback =
    Number.isFinite(fallbackNumber) && fallbackNumber >= min ? fallbackNumber : min;
  const value = Number.isFinite(parsed) && parsed >= min ? parsed : safeFallback;
  return Math.min(max, Math.max(min, value));
}

export const ACTIVATION_BOOTSTRAP_CONFIG_SHEET =
  process.env.ACTIVATION_BOOTSTRAP_CONFIG_SHEET || "Activation Bootstrap Config";
export const ACTIVATION_BOOTSTRAP_CONFIG_RANGE =
  process.env.ACTIVATION_BOOTSTRAP_CONFIG_RANGE || "Activation Bootstrap Config!A2:J2";
export const ACTIVATION_BOOTSTRAP_SPREADSHEET_ID =
  process.env.ACTIVATION_BOOTSTRAP_SPREADSHEET_ID ||
  "1RV185rQo58pGppg27r81eD9hPE8pXPyBY1pfHANip4o";
export const ALLOW_ACTIVATION_BOOTSTRAP_DISCOVERY_FALLBACK =
  String(process.env.ALLOW_ACTIVATION_BOOTSTRAP_DISCOVERY_FALLBACK || "false")
    .trim()
    .toLowerCase() === "true";
export const ACTIVATION_WORKBOOK_CACHE_TTL_SECONDS =
  positiveNumberEnv("ACTIVATION_WORKBOOK_CACHE_TTL_SECONDS", 900);
export const ACTIVATION_BOOTSTRAP_ROW_CACHE_TTL_SECONDS =
  positiveNumberEnv("ACTIVATION_BOOTSTRAP_ROW_CACHE_TTL_SECONDS", 900);
export const ACTIVATION_SHEETS_429_BACKOFF_SECONDS =
  positiveNumberEnv("ACTIVATION_SHEETS_429_BACKOFF_SECONDS", 90);
export const REGISTRY_CACHE_TTL_SECONDS =
  positiveNumberEnv("REGISTRY_CACHE_TTL_SECONDS", 600, { min: 0 });

export const EXECUTION_LOG_UNIFIED_SPREADSHEET_ID = ACTIVITY_SPREADSHEET_ID;
export const JSON_ASSET_REGISTRY_SPREADSHEET_ID = REGISTRY_SPREADSHEET_ID;
export const OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID =
  String(process.env.OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID || "").trim();

export const RAW_BODY_MAX_BYTES = 250_000;
export const MAX_TIMEOUT_SECONDS =
  positiveNumberEnv("MAX_TIMEOUT_SECONDS", 300, { max: 3600 });
export const PORT = String(process.env.PORT || 8080);
export const SERVICE_VERSION =
  process.env.SERVICE_VERSION || "2.6.0-governed-context-resolution";

export const GITHUB_API_BASE_URL =
  String(process.env.GITHUB_API_BASE_URL || "https://api.github.com").replace(/\/+$/, "");
export const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || "").trim();
export const ACTIVATION_GITHUB_PARENT_ACTION_KEY = String(process.env.ACTIVATION_GITHUB_PARENT_ACTION_KEY || "").trim();
export const ACTIVATION_GITHUB_ENDPOINT_KEY = String(process.env.ACTIVATION_GITHUB_ENDPOINT_KEY || "").trim();
export const ACTIVATION_GITHUB_REPOSITORY = String(process.env.ACTIVATION_GITHUB_REPOSITORY || "").trim();
export const ACTIVATION_GITHUB_OWNER = String(process.env.ACTIVATION_GITHUB_OWNER || "").trim();
export const ACTIVATION_GITHUB_REPO = String(process.env.ACTIVATION_GITHUB_REPO || "").trim();
export const ACTIVATION_GITHUB_BRANCH = String(process.env.ACTIVATION_GITHUB_BRANCH || "main").trim();
export const GITHUB_BLOB_CHUNK_MAX_LENGTH =
  positiveNumberEnv("GITHUB_BLOB_CHUNK_MAX_LENGTH", 100000);

export const DEFAULT_JOB_MAX_ATTEMPTS =
  positiveNumberEnv("JOB_MAX_ATTEMPTS", 3);
export const QUEUE_WORKER_ENABLED =
  String(process.env.QUEUE_WORKER_ENABLED || "FALSE").trim().toUpperCase() === "TRUE";
export const JOB_WEBHOOK_TIMEOUT_MS =
  positiveNumberEnv("JOB_WEBHOOK_TIMEOUT_MS", 10000, { min: 1000 });
export const JOB_RETRY_DELAYS_MS = [300_000, 420_000, 600_000];
