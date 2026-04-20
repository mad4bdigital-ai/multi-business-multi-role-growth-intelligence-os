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

export const EXECUTION_LOG_UNIFIED_SPREADSHEET_ID = ACTIVITY_SPREADSHEET_ID;
export const JSON_ASSET_REGISTRY_SPREADSHEET_ID = REGISTRY_SPREADSHEET_ID;
export const OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID =
  String(process.env.OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID || "").trim();

export const RAW_BODY_MAX_BYTES = 250_000;
export const MAX_TIMEOUT_SECONDS = 300;
export const PORT = String(process.env.PORT || 8080);
export const SERVICE_VERSION =
  process.env.SERVICE_VERSION || "2.5.0-wordpress-aware-migration";

export const GITHUB_API_BASE_URL =
  String(process.env.GITHUB_API_BASE_URL || "https://api.github.com").replace(/\/+$/, "");
export const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || "").trim();
export const GITHUB_BLOB_CHUNK_MAX_LENGTH = Math.max(
  1,
  Number(process.env.GITHUB_BLOB_CHUNK_MAX_LENGTH || 100000)
);

export const DEFAULT_JOB_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.JOB_MAX_ATTEMPTS || 3)
);
export const QUEUE_WORKER_ENABLED =
  String(process.env.QUEUE_WORKER_ENABLED || "TRUE").trim().toUpperCase() === "TRUE";
export const JOB_WEBHOOK_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.JOB_WEBHOOK_TIMEOUT_MS || 10000)
);
export const JOB_RETRY_DELAYS_MS = [300_000, 420_000, 600_000];
