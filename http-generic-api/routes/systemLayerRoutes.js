import { Router } from "express";
import {
  ACTIVATION_BOOTSTRAP_CONFIG_RANGE,
  ACTIVATION_BOOTSTRAP_CONFIG_SHEET,
  ACTIVATION_BOOTSTRAP_SPREADSHEET_ID,
} from "../config.js";
import { getPool } from "../db.js";
import { getGoogleClientsForSpreadsheet } from "../googleSheets.js";
import { runGovernedActivation } from "../governedActivationRunner.js";
import { resolveActivationBootstrapConfig } from "../activationBootstrapConfig.js";
import { requireAdminPrincipal } from "./adminCliRoutes.js";

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
    description: "Admin-only Google Drive bootstrap transport probe for hard activation evidence.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "activation_sheets_bootstrap_read",
    description: "Admin-only Sheets bootstrap workbook and Activation Bootstrap Config row read.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "activation_github_validate",
    description: "Admin-only GitHub validation using bootstrap-resolved repository binding.",
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
    description: "Admin-only same-cycle Drive, Sheets bootstrap, and GitHub activation validation chain.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

const VALID_STATUSES = new Set(["active", "pending", "error", "archived"]);
const ADMIN_ONLY_SYSTEM_TOOLS = new Set(
  SYSTEM_LAYER_TOOLS.filter((tool) => tool.requires_admin === true).map((tool) => tool.name)
);

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
  return {
    ok: false,
    status: status || undefined,
    code,
    message,
    auth_failed: status === 401 || status === 403 || code === "missing_github_token" || code === "provider_auth_failed",
    rate_limited: status === 429,
  };
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
    github_repo: row[5] || process.env.GITHUB_REPO || "",
    cloudflare_zone: row[6] || "",
    connector_url: row[7] || "",
    bootstrap_version: row[8] || "",
    activated_at: row[9] || "",
  };
  const repo = parseGithubRepo(mapped.github_repo || process.env.GITHUB_REPO);
  return {
    ...mapped,
    diagnostic_only: true,
    github_parent_action_key: "github_api_mcp",
    github_endpoint_key: "getRepositoryContent",
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

async function activationDriveProbe() {
  try {
    const { drive } = await getGoogleClientsForSpreadsheet(ACTIVATION_BOOTSTRAP_SPREADSHEET_ID);
    const response = await drive.files.list({
      pageSize: 1,
      fields: "files(id,name,mimeType),nextPageToken",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return {
      ok: true,
      provider: "google_drive",
      attempted_binding: { parent_action_key: "google_drive_api", endpoint_key: "listDriveFiles" },
      sample_count: Array.isArray(response.data?.files) ? response.data.files.length : 0,
    };
  } catch (err) {
    return { provider: "google_drive", ...providerProbeError(err) };
  }
}

async function activationSheetsBootstrapRead() {
  try {
    const { sheets, spreadsheetId } = await getGoogleClientsForSpreadsheet(ACTIVATION_BOOTSTRAP_SPREADSHEET_ID);
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "spreadsheetId,properties.title,sheets.properties.title",
    });
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

    const values = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: ACTIVATION_BOOTSTRAP_CONFIG_RANGE,
    });
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
  const fromEnv = parseGithubRepo(process.env.GITHUB_REPO);
  const target = explicit || fromBootstrap || fromEnv;
  return target ? { ...target, branch: args.github_branch || bootstrapRow.github_branch || process.env.GITHUB_BRANCH || "main" } : null;
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
        code: "missing_github_validation_target",
        message: "GitHub validation requires github_owner/github_repo or a bootstrap/env repository binding.",
      };
    }

    const parentActionKey = String(
      bootstrapRow.github_parent_action_key || "github_api_mcp"
    ).trim();
    const endpointKey = String(
      bootstrapRow.github_endpoint_key || "github_get_repository"
    ).trim();

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
      throw err;
    }

    return {
      ok: true,
      provider: "github",
      attempted_binding: {
        parent_action_key: parentActionKey,
        endpoint_key: endpointKey,
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
  const runtimeBootstrap = await resolveActivationBootstrapConfig();

  const result = await runGovernedActivation({
    attemptDrive: async () => {
      const probe = await activationDriveProbe();
      return { ok: probe.ok, auth_failed: probe.auth_failed };
    },
    attemptSheets: async () => {
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
    case "activation_provider_bootstrap_validate":
      return await activationProviderBootstrapValidate(args, deps);
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
      tools: toolsForPrincipal(req.auth),
    });
  });

  router.post("/system/tools/call", ...authenticated, async (req, res) => {
    try {
      const { name, arguments: args = {} } = req.body || {};
      if (!name) {
        return res.status(400).json({ ok: false, error: { code: "missing_tool_name", message: "name is required." } });
      }
      const result = await callSystemLayerTool(name, args, req.auth, { executionFacade });
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
      tools: toolsForPrincipal(req.auth),
    });
  });

  router.post("/admin/system/tools/call", ...adminOnly, async (req, res) => {
    try {
      const { name, arguments: args = {} } = req.body || {};
      if (!name) {
        return res.status(400).json({ ok: false, error: { code: "missing_tool_name", message: "name is required." } });
      }
      const result = await callSystemLayerTool(name, args, req.auth, { executionFacade });
      return res.status(200).json({ ok: true, name, result });
    } catch (err) {
      return sendError(res, err, "system_tool_call_failed");
    }
  });

  return router;
}

export {
  SYSTEM_LAYER_TOOLS,
  callSystemLayerTool,
  getConnectorRegistrySystem,
  listConnectorRegistry,
};
