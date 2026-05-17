import { Router } from "express";
import {
  ACTIVATION_BOOTSTRAP_CONFIG_RANGE,
  ACTIVATION_BOOTSTRAP_CONFIG_SHEET,
  ACTIVATION_BOOTSTRAP_SPREADSHEET_ID,
  OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID,
} from "../config.js";
import { getPool } from "../db.js";
import { getGoogleClientsForSpreadsheet } from "../googleSheets.js";
import { runGovernedActivation } from "../governedActivationRunner.js";
import {
  ACTIVATION_GITHUB_BOOTSTRAP_CONFIG_KEY,
  resolveActivationBootstrapConfig,
  validateActivationBootstrapConfig,
} from "../activationBootstrapConfig.js";
import { upsertTenantGptOAuthClientConfig } from "../tenantGptOAuthClientConfig.js";
import {
  listPlatformCredentialClientConfigs,
  PLATFORM_CREDENTIAL_CLIENT_TYPES,
  upsertPlatformCredentialClientConfig,
} from "../platformCredentialClientsConfig.js";
import {
  getGoogleAuthPlatformConfig,
  GOOGLE_AUTH_PLATFORM_TABS,
  upsertGoogleAuthPlatformConfig,
} from "../googleAuthPlatformConfig.js";
import { requireAdminPrincipal } from "./adminCliRoutes.js";
import { decodeGitHubAppPrivateKey, resolveGitHubAppConfig } from "../githubAppAuth.js";
import { DATA_SOURCE_MODE } from "../dataSource.js";

const SYSTEM_LAYER_TOOLS = [
  {
    name: "connector_registry_list",
    description: "List connector systems from the connected_systems registry.",
    inputSchema: {
      type: "object",
      properties: {
        tenant_id: { type: "string" },
        status: { type: "string", enum: ["active", "pending", "error", "archived"] },
        connector_family: { type: "string" },
        provider_family: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      required: [],
    },
  },
  {
    name: "connector_registry_get",
    description: "Read one connector system, including its installation and grant summary.",
    inputSchema: {
      type: "object",
      properties: {
        system_id: { type: "string" },
      },
      required: ["system_id"],
    },
  },
  {
    name: "activation_drive_probe",
    description: "Admin-only Drive provider-connectivity diagnostic. Proves Google auth and Drive API are reachable; does NOT load registry data — SQL is the runtime authority. Use for same-cycle activation evidence or break-glass recovery.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "activation_sheets_bootstrap_read",
    description: "Admin-only Sheets-mirror parity check that reads the Activation Bootstrap Config row from the legacy workbook. Use to compare against /activation/bootstrap-config (the SQL authority) during recovery or migration verification. Sheets is an async mirror, not the runtime registry.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "activation_github_validate",
    description: "Admin-only GitHub validation using bootstrap-resolved repository binding (read from SQL via /activation/bootstrap-config).",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        github_owner: { type: "string" },
        github_repo: { type: "string" },
        github_branch: { type: "string", default: "main" },
      },
      required: [],
    },
  },
  {
    name: "activation_provider_bootstrap_validate",
    description: "Admin-only same-cycle Drive, Sheets mirror, and GitHub provider-connectivity validation chain. Proves all three providers are reachable; does NOT replace /activation/bootstrap-config (SQL runtime authority). Use for hard activation evidence.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "github_app_key_diagnostics",
    description: "Admin-only: returns the key-shape diagnostic of GITHUB_APP_PRIVATE_KEY without signing. Safe to call when activation_github_validate fails with invalid_private_key.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "activation_bootstrap_config_upsert",
    description: "Admin-only DB runtime bootstrap upsert for GitHub activation binding; avoids Cloud Run env mutation.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        github_parent_action_key: { type: "string", default: "github_api_mcp" },
        github_endpoint_key: { type: "string", default: "github_get_repository" },
        github_owner: { type: "string" },
        github_repo: { type: "string" },
        github_branch: { type: "string", default: "main" },
        note: { type: "string" },
      },
      required: ["github_parent_action_key", "github_endpoint_key", "github_owner", "github_repo"],
    },
  },
  {
    name: "tenant_gpt_oauth_client_upsert",
    description: "Admin-only DB runtime upsert for the default Custom GPT Tenant OAuth client secret.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        client_id: { type: "string", default: "mad4b-tenant-gpt" },
        client_secret: { type: "string", description: "Optional explicit secret. If omitted, one is generated or the current one is retained." },
        callback_urls_to_allow: { type: "array", items: { type: "string" } },
        rotate: { type: "boolean", default: false },
        note: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "credential_client_config_upsert",
    description: "Admin-only DB source-of-truth upsert for platform-controlled credential clients: API key, OAuth client, or service account.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        owner_type: { type: "string", enum: ["platform", "tenant"], default: "platform" },
        tenant_id: { type: "string" },
        channel_key: { type: "string", default: "custom_gpt" },
        credential_type: { type: "string", enum: PLATFORM_CREDENTIAL_CLIENT_TYPES },
        client_key: { type: "string" },
        display_name: { type: "string" },
        provider: { type: "string", default: "google" },
        project_id: { type: "string" },
        client_type: { type: "string", enum: ["web", "desktop", "android", "ios", "chrome_app", "tv_limited_input"] },
        client_id: { type: "string" },
        client_secret_ref: { type: "string" },
        client_secret_hint: { type: "string" },
        client_secret_status: { type: "string", default: "enabled" },
        authorized_javascript_origins: { type: "array", items: { type: "string" } },
        redirect_uris: { type: "array", items: { type: "string" } },
        scopes: { type: "array", items: { type: "string" } },
        key_secret_ref: { type: "string" },
        key_hint: { type: "string" },
        allowed_apis: { type: "array", items: { type: "string" } },
        api_restrictions: { type: "array", items: { type: "string" } },
        application_restrictions: { type: "object" },
        restrictions: { type: "object" },
        bound_service_account_ref: { type: "string" },
        service_account_email: { type: "string" },
        service_account_unique_id: { type: "string" },
        roles: { type: "array", items: { type: "string" } },
        note: { type: "string" },
      },
      required: ["credential_type"],
    },
  },
  {
    name: "credential_client_config_list",
    description: "Admin-only list of platform-controlled credential client configs stored in DB.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        owner_type: { type: "string", enum: ["platform", "tenant"] },
        tenant_id: { type: "string" },
        channel_key: { type: "string" },
        credential_type: { type: "string", enum: PLATFORM_CREDENTIAL_CLIENT_TYPES },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      required: [],
    },
  },
  {
    name: "google_auth_platform_config_upsert",
    description: "Admin-only DB source-of-truth upsert for simulated Google Auth Platform and APIs & Services tab state.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        owner_type: { type: "string", enum: ["platform", "tenant"], default: "platform" },
        tenant_id: { type: "string" },
        project_key: { type: "string", default: "growth-intelligence-os" },
        project_id: { type: "string" },
        project_display_name: { type: "string" },
        tab: { type: "string", enum: GOOGLE_AUTH_PLATFORM_TABS },
        path: { type: "string" },
        state: { type: "object" },
        note: { type: "string" },
      },
      required: ["tab"],
    },
  },
  {
    name: "google_auth_platform_config_get",
    description: "Admin-only read of simulated Google Auth Platform and APIs & Services tab state.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        owner_type: { type: "string", enum: ["platform", "tenant"], default: "platform" },
        tenant_id: { type: "string" },
        project_key: { type: "string", default: "growth-intelligence-os" },
        project_id: { type: "string" },
        tab: { type: "string", enum: GOOGLE_AUTH_PLATFORM_TABS },
      },
      required: [],
    },
  },
];

const VALID_STATUSES = new Set(["active", "pending", "error", "archived"]);
const ADMIN_ONLY_SYSTEM_TOOLS = new Set(
  SYSTEM_LAYER_TOOLS.filter((tool) => tool.requires_admin === true).map((tool) => tool.name)
);
const LOCAL_SYSTEM_TOOL_NAMES = new Set(SYSTEM_LAYER_TOOLS.map((tool) => tool.name));


function safeParseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function platformEndpointToolScopeClassesForPrincipal(auth) {
  return isAdminPrincipal(auth) ? ["admin", "both"] : ["tenant", "both"];
}

function platformEndpointToolTenantClauseForPrincipal(auth, tableAlias = "x") {
  if (isAdminPrincipal(auth)) return { sql: "", params: [] };

  const tenantId = principalTenantId(auth);
  if (!tenantId) return { sql: `AND ${tableAlias}.tenant_id IS NULL`, params: [] };

  return { sql: `AND (${tableAlias}.tenant_id IS NULL OR ${tableAlias}.tenant_id = ?)`, params: [tenantId] };
}

function normalizePlatformEndpointInputSchema(schemaJson) {
  const schema = safeParseJsonObject(schemaJson, { type: "object", properties: {}, required: [] });

  if (schema?.requestBody?.type) {
    return {
      type: "object",
      properties: {
        path_params: { type: "object", additionalProperties: true },
        query: { type: "object", additionalProperties: true },
        body: schema.requestBody,
        headers: { type: "object", additionalProperties: true },
        timeout_seconds: { type: "integer", minimum: 1, maximum: 120 },
        readback: { type: "object", additionalProperties: true },
      },
      required: [],
    };
  }

  if (schema?.parameters) {
    return {
      type: "object",
      properties: {
        path_params: {
          type: "object",
          properties: schema.parameters.path || {},
          additionalProperties: true,
        },
        query: {
          type: "object",
          properties: schema.parameters.query || {},
          additionalProperties: true,
        },
        body: schema.requestBody || { type: "object", additionalProperties: true },
        headers: { type: "object", additionalProperties: true },
        timeout_seconds: { type: "integer", minimum: 1, maximum: 120 },
        readback: { type: "object", additionalProperties: true },
      },
      required: [],
    };
  }

  return schema;
}

async function listPlatformEndpointToolsForPrincipal(auth, existingNames = new Set()) {
  try {
    const scopeClasses = platformEndpointToolScopeClassesForPrincipal(auth);
    const tenantClause = platformEndpointToolTenantClauseForPrincipal(auth, "x");
    const [rows] = await getPool().query(
      `SELECT x.tool_name,
              x.parent_action_key,
              x.endpoint_key,
              x.scope_class,
              x.input_schema_json,
              e.method
         FROM platform_endpoint_tool_exports x
         LEFT JOIN endpoints e
           ON e.parent_action_key = x.parent_action_key
          AND e.endpoint_key = x.endpoint_key
          AND e.status = 'active'
        WHERE x.status = 'active'
          AND x.scope_class IN (?, ?)
          ${tenantClause.sql}
        ORDER BY x.tool_name`,
      [...scopeClasses, ...tenantClause.params]
    );

    return rows
      .filter((row) => row?.tool_name && !existingNames.has(row.tool_name))
      .map((row) => ({
        name: row.tool_name,
        description: `Registry endpoint tool ${row.parent_action_key}/${row.endpoint_key}.`,
        requires_admin: row.scope_class === "admin",
        inputSchema: normalizePlatformEndpointInputSchema(row.input_schema_json),
        x_platform_endpoint: {
          parent_action_key: row.parent_action_key,
          endpoint_key: row.endpoint_key,
          source: "platform_endpoint_tool_exports",
        },
      }));
  } catch (err) {
    console.error("[systemLayerTools] Failed to list platform endpoint exports:", err?.message || err);
    return [];
  }
}

async function toolsForPrincipalWithPlatformEndpoints(auth) {
  const baseTools = toolsForPrincipal(auth);
  const existingNames = new Set(baseTools.map((tool) => tool.name));
  const platformTools = await listPlatformEndpointToolsForPrincipal(auth, existingNames);
  return [...baseTools, ...platformTools];
}

async function callRuntimeEndpointViaFacade(payload, deps = {}) {
  const facade = deps.executionFacade;
  if (!facade) {
    const err = new Error("No executionFacade is available for platform endpoint dispatch.");
    err.status = 503;
    err.code = "runtime_endpoint_executor_missing";
    throw err;
  }

  if (typeof facade === "function") {
    return await facade(payload);
  }

  const methodNames = [
    "executeHttpRequest",
    "executeHttpRequestAction",
    "execute",
    "dispatch",
    "run",
    "callEndpoint",
  ];

  for (const methodName of methodNames) {
    if (typeof facade[methodName] === "function") {
      return await facade[methodName](payload);
    }
  }

  const err = new Error("executionFacade does not expose a supported endpoint dispatch method.");
  err.status = 503;
  err.code = "runtime_endpoint_executor_method_missing";
  throw err;
}

// Hostinger shared hosting proxy drops idle TCP connections at ~30s.
// Cap all platform endpoint tool calls to 25s so we always respond before that.
const PLATFORM_TOOL_MAX_TIMEOUT_SECONDS = 25;

function normalizePlatformEndpointCallArgs(row, args = {}) {
  if (row.tool_name === "runtime_endpoint_call") {
    return args;
  }

  const payload = {
    parent_action_key: row.parent_action_key,
    endpoint_key: row.endpoint_key,
    path_params: args.path_params || args.path || {},
    query: args.query || {},
    headers: args.headers || {},
    timeout_seconds: Math.min(
      Number(args.timeout_seconds) || PLATFORM_TOOL_MAX_TIMEOUT_SECONDS,
      PLATFORM_TOOL_MAX_TIMEOUT_SECONDS
    ),
    readback: args.readback || { required: false, mode: "none" },
  };

  for (const optionalAuthField of ["user_id", "tenant_id", "credential_scope", "allow_platform_fallback", "auth_context"]) {
    if (Object.prototype.hasOwnProperty.call(args, optionalAuthField)) {
      payload[optionalAuthField] = args[optionalAuthField];
    }
  }

  const method = String(row.method || "").toUpperCase();
  const hasBody = args.body && Object.keys(args.body).length > 0;

  if (!["GET", "HEAD"].includes(method) && hasBody) {
    payload.body = args.body;
  }

  return payload;
}

async function callPlatformEndpointToolIfAvailable(name, args = {}, auth = null, deps = {}) {
  const scopeClasses = platformEndpointToolScopeClassesForPrincipal(auth);
  const tenantClause = platformEndpointToolTenantClauseForPrincipal(auth, "x");
  const [rows] = await getPool().query(
    `SELECT x.tool_name,
            x.parent_action_key,
            x.endpoint_key,
            x.scope_class,
            e.method
       FROM platform_endpoint_tool_exports x
       LEFT JOIN endpoints e
         ON e.parent_action_key = x.parent_action_key
        AND e.endpoint_key = x.endpoint_key
        AND e.status = 'active'
      WHERE x.tool_name = ?
        AND x.status = 'active'
        AND x.scope_class IN (?, ?)
        ${tenantClause.sql}
      LIMIT 1`,
    [name, ...scopeClasses, ...tenantClause.params]
  );

  if (!rows.length) {
    return { handled: false };
  }

  const row = rows[0];

  if (row.scope_class === "admin" && !isAdminPrincipal(auth)) {
    const err = new Error("This platform endpoint tool requires admin access.");
    err.status = 403;
    err.code = "platform_endpoint_tool_admin_required";
    throw err;
  }

  const payload = normalizePlatformEndpointCallArgs(row, args);
  const result = await callRuntimeEndpointViaFacade(payload, deps);
  return { handled: true, result };
}

function isAdminPrincipal(auth) {
  return auth?.is_admin === true;
}

function principalTenantId(auth) {
  return auth?.tenant_id || null;
}

function toolsForPrincipal(auth) {
  if (isAdminPrincipal(auth)) return SYSTEM_LAYER_TOOLS;
  return SYSTEM_LAYER_TOOLS.filter((tool) => tool.requires_admin !== true);
}

function assertAdminToolAccess(name, auth) {
  if (!ADMIN_ONLY_SYSTEM_TOOLS.has(name) || isAdminPrincipal(auth)) return;
  const err = new Error("This system-layer tool requires an admin/service principal.");
  err.status = 403;
  err.code = "admin_system_tool_required";
  throw err;
}

function scopeFiltersToPrincipal(filters = {}, auth = {}) {
  if (isAdminPrincipal(auth)) return { ...filters };

  const tenantId = principalTenantId(auth);
  if (!tenantId) {
    const err = new Error("Tenant-scoped system tools require a tenant context.");
    err.status = 403;
    err.code = "tenant_context_required";
    throw err;
  }

  if (filters.tenant_id && filters.tenant_id !== tenantId) {
    const err = new Error("Tenant-scoped system tools cannot access another tenant.");
    err.status = 403;
    err.code = "tenant_scope_violation";
    throw err;
  }

  return { ...filters, tenant_id: tenantId };
}

function clampLimit(value, fallback = 50) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 200);
}

function parseConfigJson(value) {
  if (!value || typeof value !== "string") return value || null;
  try {
    return JSON.parse(value);
  } catch {
    return { parse_error: true };
  }
}

function providerProbeError(err) {
  const status = Number(err?.status || err?.code || err?.response?.status || 0);
  const message = err?.response?.data?.error?.message || err?.message || "Provider probe failed.";
  const code = err?.code || (status === 401 || status === 403 ? "provider_auth_failed" : "provider_probe_failed");
  const result = {
    ok: false,
    status: status || undefined,
    code,
    message,
    auth_failed: status === 401 || status === 403 || code === "missing_github_token" || code === "provider_auth_failed",
    rate_limited: status === 429,
  };
  if (code === "github_app_auth_invalid_private_key" && err?.details?.key_shape) {
    result.details = {
      cause_code: err.details.cause_code || "",
      expected_prefixes: err.details.expected_prefixes || [],
      key_shape: err.details.key_shape,
    };
  }
  return result;
}

function parseGithubRepo(value) {
  const normalized = String(value || "").trim().replace(/^https:\/\/github\.com\//i, "");
  const [owner, repo] = normalized.split("/").map((part) => part.trim()).filter(Boolean);
  if (!owner || !repo) return null;
  return { owner, repo: repo.replace(/\.git$/i, "") };
}

function bootstrapRowObject(values = []) {
  const row = Array.isArray(values?.[0]) ? values[0] : Array.isArray(values) ? values : [];
  const mapped = {
    system_name: row[0] || "",
    api_base_url: row[1] || "",
    environment: row[2] || "",
    registry_sheet_id: row[3] || "",
    activity_sheet_id: row[4] || "",
    github_repo: row[5] || "",
    cloudflare_zone: row[6] || "",
    connector_url: row[7] || "",
    bootstrap_version: row[8] || "",
    activated_at: row[9] || "",
  };
  const repo = parseGithubRepo(mapped.github_repo);
  return {
    ...mapped,
    diagnostic_only: true,
    github_parent_action_key: "github_api_mcp",
    github_endpoint_key: "github_get_repository",
    github_owner: repo?.owner || "",
    github_repo: repo?.repo || mapped.github_repo,
    github_branch: process.env.GITHUB_BRANCH || "main",
    raw_values: row,
  };
}

function bootstrapConfigToRunnerRow(bootstrapConfig) {
  return {
    github_parent_action_key: bootstrapConfig.github_parent_action_key,
    github_endpoint_key: bootstrapConfig.github_endpoint_key,
    github_owner: bootstrapConfig.github_owner,
    github_repo: bootstrapConfig.github_repo,
    github_branch: bootstrapConfig.github_branch || "main",
    source: bootstrapConfig.source,
    sheets_required: false,
  };
}

async function ensurePlatformRuntimeConfigTable(pool = getPool()) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`platform_runtime_config\` (
      \`config_key\`  VARCHAR(128) NOT NULL,
      \`config_json\` JSON         NOT NULL,
      \`status\`      ENUM('active','disabled') NOT NULL DEFAULT 'active',
      \`note\`        VARCHAR(255) NULL,
      \`created_at\`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`config_key\`),
      KEY \`idx_prc_status\` (\`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function activationBootstrapConfigUpsert(args = {}) {
  const validated = validateActivationBootstrapConfig(args, "db_runtime");
  if (!validated.ok) {
    const err = new Error(`Missing required activation bootstrap fields: ${validated.missing.join(", ")}.`);
    err.status = 400;
    err.code = validated.error;
    throw err;
  }

  const config = {
    github_parent_action_key: validated.config.github_parent_action_key,
    github_endpoint_key: validated.config.github_endpoint_key,
    github_owner: validated.config.github_owner,
    github_repo: validated.config.github_repo,
    github_branch: validated.config.github_branch || "main",
  };
  const note = String(args.note || "admin_system_tool").trim().slice(0, 255);
  const pool = getPool();

  await ensurePlatformRuntimeConfigTable(pool);
  await pool.query(
    `INSERT INTO \`platform_runtime_config\`
       (config_key, config_json, status, note)
     VALUES (?, ?, 'active', ?)
     ON DUPLICATE KEY UPDATE
       config_json = VALUES(config_json),
       status = 'active',
       note = VALUES(note),
       updated_at = CURRENT_TIMESTAMP`,
    [ACTIVATION_GITHUB_BOOTSTRAP_CONFIG_KEY, JSON.stringify(config), note]
  );

  const readback = await resolveActivationBootstrapConfig();
  return {
    ok: readback.ok,
    config_key: ACTIVATION_GITHUB_BOOTSTRAP_CONFIG_KEY,
    source: readback.source,
    config: readback.ok ? readback.config : config,
    next_step: "Call activation_provider_bootstrap_validate from /system/tools/call or /admin/system/tools/call.",
    ...(readback.ok ? {} : { error: readback.error, db_error: readback.db_error, env_error: readback.env_error }),
  };
}

const PROBE_TIMEOUT_MS = 15000;

function withProbeTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(`${label} probe timed out after ${PROBE_TIMEOUT_MS}ms`), { code: "probe_timeout" })), PROBE_TIMEOUT_MS))
  ]);
}

async function activationDriveProbe() {
  try {
    const { drive } = await getGoogleClientsForSpreadsheet(ACTIVATION_BOOTSTRAP_SPREADSHEET_ID);
    const response = await withProbeTimeout(
      drive.files.list({
        pageSize: 1,
        fields: "files(id,name,mimeType),nextPageToken",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      }),
      "Drive"
    );
    return {
      ok: true,
      provider: "google_drive",
      attempted_binding: { parent_action_key: "google_drive_api", endpoint_key: "listDriveFiles" },
      sample_count: Array.isArray(response.data?.files) ? response.data.files.length : 0,
    };
  } catch (err) {
    const httpStatus = err?.code || err?.status || err?.response?.status;
    const apiMsg = err?.response?.data?.error?.message || err?.response?.data?.error_description || "";
    console.error(`[driveProbe] FAILED — status=${httpStatus} code=${err?.code} msg="${err?.message}"${apiMsg ? ` api="${apiMsg}"` : ""}`);
    return { provider: "google_drive", ...providerProbeError(err) };
  }
}

async function activationSheetsBootstrapRead() {
  try {
    const { sheets, spreadsheetId } = await getGoogleClientsForSpreadsheet(ACTIVATION_BOOTSTRAP_SPREADSHEET_ID);
    const metadata = await withProbeTimeout(
      sheets.spreadsheets.get({
        spreadsheetId,
        fields: "spreadsheetId,properties.title,sheets.properties.title",
      }),
      "Sheets metadata"
    );
    const sheetExists = (metadata.data?.sheets || []).some(
      (sheet) => String(sheet?.properties?.title || "").trim() === ACTIVATION_BOOTSTRAP_CONFIG_SHEET
    );
    if (!sheetExists) {
      return {
        ok: false,
        provider: "google_sheets",
        code: "activation_bootstrap_sheet_missing",
        message: `Missing sheet ${ACTIVATION_BOOTSTRAP_CONFIG_SHEET}.`,
        spreadsheet_id: spreadsheetId,
      };
    }

    const values = await withProbeTimeout(
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: ACTIVATION_BOOTSTRAP_CONFIG_RANGE,
      }),
      "Sheets values"
    );
    const row = bootstrapRowObject(values.data?.values || []);
    return {
      ok: true,
      provider: "google_sheets",
      attempted_binding: { parent_action_key: "google_sheets_api", endpoint_key: "getSheetValues" },
      spreadsheet_id: spreadsheetId,
      range: ACTIVATION_BOOTSTRAP_CONFIG_RANGE,
      workbook_title: metadata.data?.properties?.title || null,
      bootstrap_row_read: Array.isArray(values.data?.values?.[0]),
      bootstrap_row: row,
    };
  } catch (err) {
    return { provider: "google_sheets", ...providerProbeError(err) };
  }
}

function resolveGithubValidationTarget(args = {}, bootstrapRow = {}) {
  const explicit = args.github_owner && args.github_repo ? { owner: args.github_owner, repo: args.github_repo } : null;
  const fromBootstrap = bootstrapRow.github_owner && bootstrapRow.github_repo
    ? { owner: bootstrapRow.github_owner, repo: bootstrapRow.github_repo }
    : parseGithubRepo(bootstrapRow.github_repo);
  const target = explicit || fromBootstrap;
  return target ? { ...target, branch: args.github_branch || bootstrapRow.github_branch || process.env.GITHUB_BRANCH || "main" } : null;
}

const GITHUB_REPOSITORY_ENDPOINT_KEY = "github_get_repository";
const ARTIFACT_ENV_BINDINGS = [
  ["OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID", OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID],
  ["BACKEND_ARTIFACTS", process.env.BACKEND_ARTIFACTS],
  ["BACKEND_ARTIFACTS_DRIVE_FOLDER_ID", process.env.BACKEND_ARTIFACTS_DRIVE_FOLDER_ID],
  ["ARTIFACTS_DRIVE_FOLDER_ID", process.env.ARTIFACTS_DRIVE_FOLDER_ID],
].map(([name, value]) => [name, String(value || "").trim()]).filter(([, value]) => value);

function findArtifactBindingInGithubTarget(target) {
  if (!target) return null;
  const fields = {
    github_owner: String(target.owner || "").trim(),
    github_repo: String(target.repo || "").trim(),
  };
  for (const [field, value] of Object.entries(fields)) {
    const match = ARTIFACT_ENV_BINDINGS.find(([, envValue]) => envValue && value === envValue);
    if (match) return { field, env_key: match[0] };
  }
  return null;
}

function resolveGithubRepositoryEndpointKey(endpointKey) {
  const normalized = String(endpointKey || "").trim();
  return normalized === GITHUB_REPOSITORY_ENDPOINT_KEY
    ? normalized
    : GITHUB_REPOSITORY_ENDPOINT_KEY;
}

function normalizeExecutionBody(executionResult = {}) {
  const body = executionResult?.body || executionResult?.data || executionResult || {};
  return body?.data && typeof body.data === "object" ? body.data : body;
}

async function activationGithubValidate(args = {}, bootstrapRow = {}, deps = {}) {
  try {
    const executeGovernedHttp = deps.executionFacade?.execute || deps.executeGovernedHttp;

    if (typeof executeGovernedHttp !== "function") {
      const err = new Error("Governed HTTP execution facade is unavailable for GitHub validation.");
      err.code = "governed_http_execution_unavailable";
      err.status = 500;
      throw err;
    }

    const target = resolveGithubValidationTarget(args, bootstrapRow);

    if (!target) {
      return {
        ok: false,
        provider: "github",
        code: "activation_github_binding_missing",
        message: "GitHub validation requires github_owner/github_repo from explicit arguments or the bootstrap repository binding.",
        details: {
          explicit_owner_present: Boolean(args.github_owner),
          explicit_repo_present: Boolean(args.github_repo),
          bootstrap_owner_present: Boolean(bootstrapRow.github_owner),
          bootstrap_repo_present: Boolean(bootstrapRow.github_repo),
        },
      };
    }

    const artifactBinding = findArtifactBindingInGithubTarget(target);
    if (artifactBinding) {
      return {
        ok: false,
        provider: "github",
        code: "activation_github_artifact_binding_rejected",
        message: "GitHub validation received an artifact storage identifier instead of a repository binding.",
        details: artifactBinding,
      };
    }

    const parentActionKey = String(
      bootstrapRow.github_parent_action_key || "github_api_mcp"
    ).trim();
    const configuredEndpointKey = String(
      bootstrapRow.github_endpoint_key || GITHUB_REPOSITORY_ENDPOINT_KEY
    ).trim();
    const endpointKey = resolveGithubRepositoryEndpointKey(configuredEndpointKey);

    const executionResult = await executeGovernedHttp({
      parent_action_key: parentActionKey,
      endpoint_key: endpointKey,
      path_params: {
        owner: target.owner,
        repo: target.repo,
      },
      query: {},
      timeout_seconds: Number(args.timeout_seconds || 15),
      expect_json: true,
      execution_trace_id: args.execution_trace_id,
      source_layer: "system_layer_activation",
      readback: {
        required: false,
        mode: "none",
      },
    });

    const status = Number(executionResult?.status || executionResult?.statusCode || 0);
    const payload = normalizeExecutionBody(executionResult);

    if (status < 200 || status >= 300 || payload?.ok === false) {
      const err = new Error(
        payload?.error?.message ||
        payload?.message ||
        `Governed GitHub validation failed with status ${status || "unknown"}.`
      );
      err.code =
        payload?.error?.code ||
        (status === 401 || status === 403
          ? "provider_auth_failed"
          : "github_governed_validation_failed");
      err.status = status || payload?.error?.status || 500;
      if (payload?.error?.details) {
        err.details = payload.error.details;
      }
      throw err;
    }

    return {
      ok: true,
      provider: "github",
      attempted_binding: {
        parent_action_key: parentActionKey,
        endpoint_key: endpointKey,
        ...(endpointKey !== configuredEndpointKey ? { configured_endpoint_key: configuredEndpointKey } : {}),
      },
      repository: payload.full_name || `${target.owner}/${target.repo}`,
      default_branch: payload.default_branch || null,
      requested_branch: target.branch,
      private: Boolean(payload.private),
      governed_execution: true,
      http_status: status,
    };
  } catch (err) {
    return { provider: "github", ...providerProbeError(err) };
  }
}

async function activationProviderBootstrapValidate(args = {}, deps = {}) {
  let bootstrapRow = null;
  let sheetsDiagnostic = null;
  let driveDiagnostic = null;
  const runtimeBootstrap = await resolveActivationBootstrapConfig();

  const result = await runGovernedActivation({
    attemptDrive: async () => {
      const probe = await activationDriveProbe();
      driveDiagnostic = { ok: probe.ok, code: probe.code || null, message: probe.message || null, status: probe.status || null, auth_failed: probe.auth_failed || false };
      return { ok: probe.ok, auth_failed: probe.auth_failed };
    },
    attemptSheets: async () => {
      if (DATA_SOURCE_MODE === "sql") {
        sheetsDiagnostic = { skipped: true, diagnostic_only: true, reason: "sql_mode" };
        return { ok: true };
      }
      const probe = await activationSheetsBootstrapRead();
      sheetsDiagnostic = probe;
      return { ok: probe.ok, auth_failed: probe.auth_failed, rate_limited: probe.rate_limited };
    },
    getSpreadsheet: async () => {
      if (runtimeBootstrap.ok) {
        return { ok: true, data: { sheets: [{ properties: { title: ACTIVATION_BOOTSTRAP_CONFIG_SHEET } }] } };
      }
      const probe = await activationSheetsBootstrapRead();
      sheetsDiagnostic = probe;
      return probe.ok
        ? { ok: true, data: { sheets: [{ properties: { title: ACTIVATION_BOOTSTRAP_CONFIG_SHEET } }] } }
        : { ok: false, reason: probe.code || "activation_bootstrap_workbook_unreadable" };
    },
    readBootstrapRow: async () => {
      if (!runtimeBootstrap.ok) {
        return {
          ok: false,
          source: "db_runtime_or_server_env",
          error: runtimeBootstrap.error,
          db_error: runtimeBootstrap.db_error,
          env_error: runtimeBootstrap.env_error,
        };
      }
      bootstrapRow = bootstrapConfigToRunnerRow(runtimeBootstrap.config);
      return { ok: true, row: bootstrapRow };
    },
    attemptGitHub: async (bindings) => {
      const probe = await activationGithubValidate(args, { ...bootstrapRow, ...bindings }, deps);
      return { ok: probe.ok, auth_failed: probe.auth_failed };
    },
  });

  return {
    ok: result.runtime_classification?.activation_status === "active",
    activation_layer: "provider_bootstrap_system_tool",
    bootstrap_source: runtimeBootstrap.ok ? runtimeBootstrap.source : "unresolved",
    sheets_required: false,
    drive_diagnostic: driveDiagnostic || { attempted: false },
    sheets_diagnostic: sheetsDiagnostic
      ? {
          attempted: true,
          ok: sheetsDiagnostic.ok === true,
          diagnostic_only: true,
          spreadsheet_id: sheetsDiagnostic.spreadsheet_id || null,
          range: sheetsDiagnostic.range || null,
        }
      : { attempted: false, diagnostic_only: true },
    ...result,
  };
}

function systemRow(row) {
  return {
    system_id: row.system_id,
    tenant_id: row.tenant_id,
    system_key: row.system_key,
    display_name: row.display_name,
    provider_family: row.provider_family,
    provider_domain: row.provider_domain,
    connector_family: row.connector_family,
    auth_type: row.auth_type,
    service_mode: row.service_mode,
    self_serve_capable: Boolean(row.self_serve_capable),
    assisted_capable: Boolean(row.assisted_capable),
    managed_capable: Boolean(row.managed_capable),
    status: row.status,
    config: parseConfigJson(row.config_json),
    active_installations: Number(row.active_installations || 0),
    total_installations: Number(row.total_installations || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listConnectorRegistry(filters = {}, auth = null) {
  const scopedFilters = auth ? scopeFiltersToPrincipal(filters, auth) : filters;
  const conditions = ["1=1"];
  const params = [];

  if (scopedFilters.tenant_id) {
    conditions.push("cs.tenant_id = ?");
    params.push(scopedFilters.tenant_id);
  }
  if (scopedFilters.status) {
    if (!VALID_STATUSES.has(scopedFilters.status)) {
      const err = new Error("status must be one of: active, pending, error, archived.");
      err.status = 400;
      err.code = "invalid_status";
      throw err;
    }
    conditions.push("cs.status = ?");
    params.push(scopedFilters.status);
  }
  if (scopedFilters.connector_family) {
    conditions.push("cs.connector_family = ?");
    params.push(scopedFilters.connector_family);
  }
  if (scopedFilters.provider_family) {
    conditions.push("cs.provider_family = ?");
    params.push(scopedFilters.provider_family);
  }

  const limit = clampLimit(scopedFilters.limit);
  params.push(limit);

  const [rows] = await getPool().query(
    `SELECT cs.system_id, cs.tenant_id, cs.system_key, cs.display_name, cs.provider_family,
            cs.provider_domain, cs.connector_family, cs.auth_type, cs.service_mode,
            cs.self_serve_capable, cs.assisted_capable, cs.managed_capable, cs.status,
            cs.config_json, cs.created_at, cs.updated_at,
            SUM(CASE WHEN i.status = 'active' THEN 1 ELSE 0 END) AS active_installations,
            COUNT(i.installation_id) AS total_installations
       FROM \`connected_systems\` cs
       LEFT JOIN \`installations\` i ON i.system_id = cs.system_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY cs.id
      ORDER BY cs.updated_at DESC, cs.created_at DESC
      LIMIT ?`,
    params
  );

  return rows.map(systemRow);
}

async function getConnectorRegistrySystem(systemId, auth = null) {
  if (!systemId) {
    const err = new Error("system_id is required.");
    err.status = 400;
    err.code = "missing_system_id";
    throw err;
  }

  const [rows] = await getPool().query(
    `SELECT cs.system_id, cs.tenant_id, cs.system_key, cs.display_name, cs.provider_family,
            cs.provider_domain, cs.connector_family, cs.auth_type, cs.service_mode,
            cs.self_serve_capable, cs.assisted_capable, cs.managed_capable, cs.status,
            cs.config_json, cs.created_at, cs.updated_at,
            SUM(CASE WHEN i.status = 'active' THEN 1 ELSE 0 END) AS active_installations,
            COUNT(i.installation_id) AS total_installations
       FROM \`connected_systems\` cs
       LEFT JOIN \`installations\` i ON i.system_id = cs.system_id
      WHERE cs.system_id = ?
      GROUP BY cs.id
      LIMIT 1`,
    [systemId]
  );

  if (!rows.length) {
    const err = new Error(`Connector system ${systemId} not found.`);
    err.status = 404;
    err.code = "connector_system_not_found";
    throw err;
  }

  const row = rows[0];
  if (auth && !isAdminPrincipal(auth) && row.tenant_id !== principalTenantId(auth)) {
    const err = new Error("Tenant-scoped system tools cannot access another tenant.");
    err.status = 403;
    err.code = "tenant_scope_violation";
    throw err;
  }

  const [installations] = await getPool().query(
    `SELECT installation_id, tenant_id, scope, credential_ref, status, installed_at, expires_at, meta_json
       FROM \`installations\`
      WHERE system_id = ?
      ORDER BY installed_at DESC
      LIMIT 100`,
    [systemId]
  );

  return {
    ...systemRow(row),
    installations: installations.map((installation) => ({
      ...installation,
      meta_json: parseConfigJson(installation.meta_json),
    })),
  };
}

async function callSystemLayerTool(name, args = {}, auth = null, deps = {}) {
  if (!LOCAL_SYSTEM_TOOL_NAMES.has(name)) {
    let platformEndpointTool;
    try {
      platformEndpointTool = await callPlatformEndpointToolIfAvailable(name, args, auth, deps);
    } catch (err) {
      if (err.code !== "DB_CONFIG_MISSING") throw err;
      platformEndpointTool = { handled: false };
    }
    if (platformEndpointTool.handled) return platformEndpointTool.result;
  }

  assertAdminToolAccess(name, auth);
  switch (name) {
    case "connector_registry_list":
      return { connectors: await listConnectorRegistry(args, auth) };
    case "connector_registry_get":
      return { connector: await getConnectorRegistrySystem(args.system_id, auth) };
    case "activation_drive_probe":
      return await activationDriveProbe(args);
    case "activation_sheets_bootstrap_read":
      return await activationSheetsBootstrapRead(args);
    case "activation_github_validate": {
      const runtimeBootstrap = await resolveActivationBootstrapConfig();
      return await activationGithubValidate(
        args,
        runtimeBootstrap.ok ? bootstrapConfigToRunnerRow(runtimeBootstrap.config) : {},
        deps
      );
    }
    case "github_app_key_diagnostics": {
      const { privateKey } = resolveGitHubAppConfig({});
      const decoded = decodeGitHubAppPrivateKey(privateKey);
      const firstLine = decoded.split("\n")[0] || "";
      return {
        ok: true,
        configured: Boolean(privateKey),
        raw_length: privateKey.length,
        decoded_length: decoded.length,
        decoded_first_line: firstLine.slice(0, 40) || "(empty)",
        starts_with_pem_header: decoded.startsWith("-----BEGIN"),
        has_private_key_header: decoded.includes("PRIVATE KEY-----"),
        looks_like_pem: decoded.startsWith("-----BEGIN") && decoded.includes("PRIVATE KEY-----"),
        has_actual_newlines: privateKey.includes("\n") || privateKey.includes("\r"),
        has_escaped_newlines: privateKey.includes("\\n") || privateKey.includes("\\r\\n"),
        recommended_fix: decoded.startsWith("-----BEGIN") && decoded.includes("PRIVATE KEY-----")
          ? "PEM structure detected — if signing still fails, try re-setting GITHUB_APP_PRIVATE_KEY as the base64 of the PEM file."
          : "PEM header not found after decoding. Re-set GITHUB_APP_PRIVATE_KEY as the base64 of the raw PEM file (cat key.pem | base64 -w0).",
      };
    }
    case "activation_provider_bootstrap_validate":
      return await activationProviderBootstrapValidate(args, deps);
    case "activation_bootstrap_config_upsert":
      return await activationBootstrapConfigUpsert(args);
    case "tenant_gpt_oauth_client_upsert":
      return await upsertTenantGptOAuthClientConfig(args);
    case "credential_client_config_upsert":
      return await upsertPlatformCredentialClientConfig(args);
    case "credential_client_config_list":
      return await listPlatformCredentialClientConfigs(args);
    case "google_auth_platform_config_upsert":
      return await upsertGoogleAuthPlatformConfig(args);
    case "google_auth_platform_config_get":
      return await getGoogleAuthPlatformConfig(args);
    default: {
      const err = new Error(`Unknown system layer tool: ${name}`);
      err.status = 400;
      err.code = "unknown_tool";
      throw err;
    }
  }
}

function sendError(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: err.message,
    },
  });
}

export function buildSystemLayerRoutes(deps) {
  const { requireBackendApiKey, executionFacade } = deps;
  const router = Router();
  const adminOnly = [requireBackendApiKey, requireAdminPrincipal];
  const authenticated = [requireBackendApiKey];

  router.get("/system/tools", ...authenticated, async (req, res) => {
    return res.status(200).json({
      ok: true,
      protocol: "openapi-mcp-facade",
      principal: {
        mode: req.auth?.mode || null,
        is_admin: isAdminPrincipal(req.auth),
        tenant_id: principalTenantId(req.auth),
      },
      tools: await toolsForPrincipalWithPlatformEndpoints(req.auth),
    });
  });

  router.post("/system/tools/call", ...authenticated, async (req, res) => {
    try {
      const { name, arguments: args = {} } = req.body || {};
      if (!name) {
        return res.status(400).json({ ok: false, error: { code: "missing_tool_name", message: "name is required." } });
      }
      const timeoutMs = (PLATFORM_TOOL_MAX_TIMEOUT_SECONDS + 2) * 1000;
      const deadline = new Promise((_, reject) =>
        setTimeout(() => {
          const e = new Error(`System tool call timed out after ${PLATFORM_TOOL_MAX_TIMEOUT_SECONDS + 2}s`);
          e.status = 504;
          e.code = "system_tool_timeout";
          reject(e);
        }, timeoutMs)
      );
      const result = await Promise.race([
        callSystemLayerTool(name, args, req.auth, { executionFacade }),
        deadline
      ]);
      return res.status(200).json({ ok: true, name, result });
    } catch (err) {
      return sendError(res, err, "system_tool_call_failed");
    }
  });

  router.get("/system/connectors", ...authenticated, async (req, res) => {
    try {
      const connectors = await listConnectorRegistry(req.query || {}, req.auth);
      return res.status(200).json({ ok: true, connectors, count: connectors.length });
    } catch (err) {
      return sendError(res, err, "connector_registry_list_failed");
    }
  });

  router.get("/system/connectors/:system_id", ...authenticated, async (req, res) => {
    try {
      const connector = await getConnectorRegistrySystem(req.params.system_id, req.auth);
      return res.status(200).json({ ok: true, connector });
    } catch (err) {
      return sendError(res, err, "connector_registry_get_failed");
    }
  });

  router.get("/admin/system/connectors", ...adminOnly, async (req, res) => {
    try {
      const connectors = await listConnectorRegistry(req.query || {}, req.auth);
      return res.status(200).json({ ok: true, connectors, count: connectors.length });
    } catch (err) {
      return sendError(res, err, "connector_registry_list_failed");
    }
  });

  router.get("/admin/system/connectors/:system_id", ...adminOnly, async (req, res) => {
    try {
      const connector = await getConnectorRegistrySystem(req.params.system_id, req.auth);
      return res.status(200).json({ ok: true, connector });
    } catch (err) {
      return sendError(res, err, "connector_registry_get_failed");
    }
  });

  router.get("/admin/system/tools", ...adminOnly, async (req, res) => {
    return res.status(200).json({
      ok: true,
      protocol: "openapi-mcp-facade",
      tools: await toolsForPrincipalWithPlatformEndpoints(req.auth),
    });
  });

  router.post("/admin/system/tools/call", ...adminOnly, async (req, res) => {
    try {
      const { name, arguments: args = {} } = req.body || {};
      if (!name) {
        return res.status(400).json({ ok: false, error: { code: "missing_tool_name", message: "name is required." } });
      }
      const timeoutMs = (PLATFORM_TOOL_MAX_TIMEOUT_SECONDS + 2) * 1000;
      const deadline = new Promise((_, reject) =>
        setTimeout(() => {
          const e = new Error(`System tool call timed out after ${PLATFORM_TOOL_MAX_TIMEOUT_SECONDS + 2}s`);
          e.status = 504;
          e.code = "system_tool_timeout";
          reject(e);
        }, timeoutMs)
      );
      const result = await Promise.race([
        callSystemLayerTool(name, args, req.auth, { executionFacade }),
        deadline
      ]);
      return res.status(200).json({ ok: true, name, result });
    } catch (err) {
      return sendError(res, err, "system_tool_call_failed");
    }
  });

  router.get("/admin/apis-services/google-auth-platform", ...adminOnly, async (req, res) => {
    try {
      const result = await getGoogleAuthPlatformConfig(req.query || {});
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "google_auth_platform_config_get_failed");
    }
  });

  router.get("/admin/apis-services/google-auth-platform/:tab", ...adminOnly, async (req, res) => {
    try {
      const result = await getGoogleAuthPlatformConfig({ ...(req.query || {}), tab: req.params.tab });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "google_auth_platform_config_get_failed");
    }
  });

  router.post("/admin/apis-services/google-auth-platform/:tab", ...adminOnly, async (req, res) => {
    try {
      const result = await upsertGoogleAuthPlatformConfig({ ...(req.body || {}), tab: req.params.tab });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "google_auth_platform_config_upsert_failed");
    }
  });

  router.get("/admin/apis-services/credentials", ...adminOnly, async (req, res) => {
    try {
      const result = await getGoogleAuthPlatformConfig({ ...(req.query || {}), tab: "api_credentials" });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "google_api_credentials_get_failed");
    }
  });

  router.post("/admin/apis-services/credentials", ...adminOnly, async (req, res) => {
    try {
      const result = await upsertGoogleAuthPlatformConfig({ ...(req.body || {}), tab: "api_credentials" });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "google_api_credentials_upsert_failed");
    }
  });

  return router;
}

export {
  SYSTEM_LAYER_TOOLS,
  activationBootstrapConfigUpsert,
  activationGithubValidate,
  callSystemLayerTool,
  ensurePlatformRuntimeConfigTable,
  getConnectorRegistrySystem,
  listConnectorRegistry,
  resolveGithubValidationTarget,
};
