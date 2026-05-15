import { randomUUID } from "crypto";
import { Router } from "express";
import { getPool } from "../db.js";
import { resolveActivationBootstrapConfig } from "../activationBootstrapConfig.js";
import {
  REGISTRY_SPREADSHEET_ID,
  ACTIVITY_SPREADSHEET_ID,
  ACTIVATION_BOOTSTRAP_SPREADSHEET_ID,
  ACTIVATION_BOOTSTRAP_CONFIG_SHEET,
  ACTIVATION_BOOTSTRAP_CONFIG_RANGE,
  REGISTRY_CACHE_TTL_SECONDS,
  ACTIVATION_WORKBOOK_CACHE_TTL_SECONDS,
  ACTIVATION_BOOTSTRAP_ROW_CACHE_TTL_SECONDS,
} from "../config.js";

export function capLimit(value, fallback = 50, max = 200) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export function normalizeOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function parseScopes(value) {
  return String(value || "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function truncateText(value, maxLength = 2000) {
  if (value === undefined || value === null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 15)}...[truncated]`;
}

function asBoolean(value) {
  if (value === true) return true;
  return String(value || "").trim().toLowerCase() === "true";
}

function asCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readinessFromResult(result, active = true) {
  if (!result?.ok) return "degraded";
  return active ? "active" : "empty";
}

function splitRegistryList(value) {
  return String(value || "")
    .split(/[|,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonSafe(value) {
  if (!value || typeof value !== "string") return value && typeof value === "object" ? value : null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function pickFirstString(source, keys) {
  if (!source || typeof source !== "object") return null;

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }

  return null;
}

export function buildEnvelopeTranscript(row = {}) {
  const request = parseJsonSafe(row.request_json);
  const userRequest = pickFirstString(request, [
    "raw_input",
    "user_input",
    "prompt",
    "message",
    "question",
    "request",
    "input"
  ]);
  const aiResponse = pickFirstString(request, [
    "ai_response",
    "assistant_response",
    "response",
    "output",
    "answer"
  ]);

  return {
    user_request: truncateText(userRequest),
    ai_response: truncateText(aiResponse),
    request_fields_available: request ? Object.keys(request).sort() : []
  };
}

function attachEnvelopeTranscript(row, options = {}) {
  const { request_json: _requestJson, ...safeRow } = row;
  const rawRequest = options.include_raw === true ? truncateText(row.request_json, options.raw_max_chars) : undefined;
  return {
    ...safeRow,
    transcript: buildEnvelopeTranscript(row),
    ...(rawRequest !== undefined ? { raw_dump: { request_json: rawRequest } } : {})
  };
}

async function safeQuery(sql, params) {
  try {
    const [rows] = await getPool().query(sql, params);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (err) {
    return {
      ok: false,
      rows: [],
      error: {
        code: err.code || "query_failed",
        message: err.message
      }
    };
  }
}

async function countQuery(surface, sql, params = [], queryFn = safeQuery) {
  const result = await queryFn(sql, params);
  const row = result.rows[0] || {};
  return {
    surface,
    result,
    count: asCount(row.count)
  };
}

export async function buildActivationPlatformAccess(req, deps = {}) {
  const queryFn = deps.query || safeQuery;
  const isAdmin = req.auth?.is_admin === true;
  const principalType = req.auth?.mode || (isAdmin ? "backend_api_key" : "unknown");

  const [
    brands,
    brandTargets,
    actions,
    runtimeActions,
    plugins,
    activePluginInventories,
    logics,
    activeLogics,
    workflowEngines,
    executionEngines
  ] = await Promise.all([
    countQuery("brands", "SELECT COUNT(*) AS count FROM `brands`", [], queryFn),
    countQuery("brand_targets", "SELECT COUNT(DISTINCT target_key) AS count FROM `brands` WHERE target_key IS NOT NULL AND TRIM(target_key) <> ''", [], queryFn),
    countQuery("actions", "SELECT COUNT(*) AS count FROM `actions`", [], queryFn),
    countQuery(
      "runtime_callable_actions",
      `SELECT COUNT(*) AS count FROM \`actions\`
       WHERE LOWER(TRIM(COALESCE(runtime_callable, ''))) IN ('1','true','yes','y','active','enabled','callable')`,
      [],
      queryFn
    ),
    countQuery("plugin_inventories", "SELECT COUNT(*) AS count FROM `plugins`", [], queryFn),
    countQuery(
      "active_plugin_inventories",
      `SELECT COUNT(*) AS count FROM \`plugins\`
       WHERE TRIM(COALESCE(active_plugins, '')) <> ''
          OR LOWER(TRIM(COALESCE(active_status, ''))) IN ('1','true','yes','y','active','enabled')`,
      [],
      queryFn
    ),
    countQuery("logic_definitions", "SELECT COUNT(*) AS count FROM `logic_definitions`", [], queryFn),
    countQuery(
      "active_logic_definitions",
      "SELECT COUNT(*) AS count FROM `logic_definitions` WHERE LOWER(TRIM(COALESCE(status, ''))) = 'active'",
      [],
      queryFn
    ),
    queryFn(
      `SELECT mapped_engines, linked_engines, engine_order
       FROM \`workflows\`
       WHERE mapped_engines IS NOT NULL OR linked_engines IS NOT NULL OR engine_order IS NOT NULL`,
      []
    ),
    queryFn(
      `SELECT used_engine_names, used_engine_registry_refs
       FROM \`execution_log\`
       WHERE used_engine_names IS NOT NULL OR used_engine_registry_refs IS NOT NULL
       ORDER BY created_at DESC LIMIT 500`,
      []
    )
  ]);

  const engineSet = new Set();
  if (workflowEngines.ok) {
    for (const row of workflowEngines.rows) {
      for (const value of [row.mapped_engines, row.linked_engines, row.engine_order]) {
        for (const engine of splitRegistryList(value)) engineSet.add(engine);
      }
    }
  }
  if (executionEngines.ok) {
    for (const row of executionEngines.rows) {
      for (const value of [row.used_engine_names, row.used_engine_registry_refs]) {
        for (const engine of splitRegistryList(value)) engineSet.add(engine);
      }
    }
  }

  const surfaces = [
    brands,
    brandTargets,
    actions,
    runtimeActions,
    plugins,
    activePluginInventories,
    logics,
    activeLogics,
    { surface: "workflow_engine_references", result: workflowEngines },
    { surface: "execution_engine_references", result: executionEngines }
  ];

  const counts = {
    brands: {
      total: brands.count,
      distinct_targets: brandTargets.count
    },
    actions: {
      total: actions.count,
      runtime_callable: runtimeActions.count
    },
    plugins: {
      inventory_rows: plugins.count,
      active_inventory_rows: activePluginInventories.count
    },
    logics: {
      total: logics.count,
      active: activeLogics.count
    },
    engines: {
      distinct_references: engineSet.size,
      sample: [...engineSet].sort().slice(0, 25)
    }
  };

  return {
    principal: {
      type: principalType,
      is_admin: isAdmin,
      user_id: req.auth?.user_id || null,
      tenant_id: req.auth?.tenant_id || null
    },
    access_scope: isAdmin ? "platform_admin_all" : "user_scoped",
    access: {
      brands: isAdmin ? "all_brands" : "tenant_or_user_scoped",
      plugins: isAdmin ? "all_plugin_inventory" : "tenant_or_user_scoped",
      logics: isAdmin ? "all_logic_definitions" : "tenant_or_user_scoped",
      engines: isAdmin ? "all_engine_references" : "tenant_or_user_scoped",
      actions: isAdmin ? "all_runtime_actions" : "tenant_or_user_scoped"
    },
    counts,
    readiness: {
      brands: readinessFromResult(brands.result, counts.brands.total > 0),
      plugins: readinessFromResult(plugins.result, counts.plugins.inventory_rows > 0),
      logics: readinessFromResult(logics.result, counts.logics.active > 0),
      engines: readinessFromResult(workflowEngines, counts.engines.distinct_references > 0),
      actions: readinessFromResult(actions.result, counts.actions.runtime_callable > 0)
    },
    degraded_surfaces: surfaces
      .filter(({ result }) => !result.ok)
      .map(({ surface, result }) => ({ surface, error: result.error }))
  };
}

export function resolveSessionContextSubject(req) {
  const requestedUserId = String(req.query.user_id || "").trim();
  const authUserId = String(req.auth?.user_id || "").trim();
  const isAdmin = req.auth?.is_admin === true;
  const userId = requestedUserId || authUserId;

  if (!isAdmin && requestedUserId && requestedUserId !== authUserId) {
    const err = new Error("User JWT cannot inspect another user's activation session context.");
    err.status = 403;
    err.code = "session_context_user_scope_forbidden";
    throw err;
  }

  return {
    user_id: userId || null,
    tenant_id: String(req.query.tenant_id || "").trim() || null,
    is_admin: isAdmin
  };
}

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";

async function autoOpenGptSession(pool, subject) {
  const userId = subject.user_id || null;
  const tenantId = subject.tenant_id || PLATFORM_TENANT_ID;

  const [closeResult] = await pool.query(
    `UPDATE \`customer_sessions\`
     SET session_status = 'closed', ended_at = NOW()
     WHERE originator = 'gpt_action'
       AND tenant_id = ?
       AND (? IS NULL OR user_id = ?)
       AND session_status NOT IN ('completed', 'closed')`,
    [tenantId, userId, userId]
  );

  const sessionId = randomUUID();
  await pool.query(
    `INSERT INTO \`customer_sessions\`
       (session_id, tenant_id, user_id, originator, session_status, started_at)
     VALUES (?, ?, ?, 'gpt_action', 'open', NOW())`,
    [sessionId, tenantId, userId]
  );

  return { session_id: sessionId, closed_sessions: closeResult.affectedRows || 0 };
}

export async function buildActivationSessionContext(req) {
  const pool = getPool();
  const subject = resolveSessionContextSubject(req);

  const { session_id: newSessionId, closed_sessions } = await autoOpenGptSession(pool, subject);

  const limit = capLimit(req.query.limit);
  const offset = normalizeOffset(req.query.offset);
  const includeRaw = asBoolean(req.query.include_raw);
  const rawMaxChars = capLimit(req.query.raw_max_chars, 4000, 20000);
  const conditions = [];
  const params = [];

  if (subject.user_id) {
    conditions.push("user_id = ?");
    params.push(subject.user_id);
  }
  if (subject.tenant_id) {
    conditions.push("tenant_id = ?");
    params.push(subject.tenant_id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const envelopes = await safeQuery(
    `SELECT envelope_id, tenant_id, user_id, actor_type, intent_key, brand_key, target_key,
            service_mode, access_decision, decision_reason, risk_level, request_json, resolved_at, created_at
     FROM \`request_envelopes\` ${where}
     ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  const auditConditions = [];
  const auditParams = [];
  if (subject.user_id) {
    auditConditions.push("actor_id = ?");
    auditParams.push(subject.user_id);
  }
  if (subject.tenant_id) {
    auditConditions.push("tenant_id = ?");
    auditParams.push(subject.tenant_id);
  }
  const auditWhere = auditConditions.length ? `WHERE ${auditConditions.join(" AND ")}` : "";
  const audit = await safeQuery(
    `SELECT audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id,
            service_mode, occurred_at
     FROM \`audit_log\` ${auditWhere}
     ORDER BY occurred_at DESC LIMIT ${limit} OFFSET ${offset}`,
    auditParams
  );

  const developerApps = await safeQuery(
    `SELECT app_id, tenant_id, app_name, app_type, scopes, status, created_by, created_at
     FROM \`developer_apps\`
     WHERE (? IS NULL OR tenant_id = ?) AND (? IS NULL OR created_by = ?)
     ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [subject.tenant_id, subject.tenant_id, subject.user_id, subject.user_id]
  );

  const apiCredentials = await safeQuery(
    `SELECT credential_id, app_id, tenant_id, key_prefix, label, scopes, status, expires_at, created_at
     FROM \`api_credentials\`
     WHERE (? IS NULL OR tenant_id = ?)
     ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [subject.tenant_id, subject.tenant_id]
  );

  const installations = await safeQuery(
    `SELECT installation_id, system_id, tenant_id, scope, status, installed_at, expires_at
     FROM \`installations\`
     WHERE (? IS NULL OR tenant_id = ?)
     ORDER BY installed_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [subject.tenant_id, subject.tenant_id]
  );

  const executionTranscript = subject.is_admin
    ? await safeQuery(
        `SELECT id, run_date, start_time, end_time, entry_type, execution_class,
                source_layer, user_input, route_keys, selected_workflows,
                execution_status, output_summary, failure_reason, created_at
         FROM \`execution_log\`
         WHERE user_input IS NOT NULL OR output_summary IS NOT NULL
         ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        []
      )
    : {
        ok: true,
        rows: [],
        skipped: true,
        reason: "execution_log transcript is not user-scoped; user JWT callers receive request_envelope transcripts only."
      };

  const scopeSet = new Set();
  for (const row of [...developerApps.rows, ...apiCredentials.rows]) {
    for (const scope of parseScopes(row.scopes)) scopeSet.add(scope);
  }
  for (const row of installations.rows) {
    for (const scope of parseScopes(row.scope)) scopeSet.add(scope);
  }
  const sessionHistory = envelopes.rows.map((row) => attachEnvelopeTranscript(row, {
    include_raw: includeRaw,
    raw_max_chars: rawMaxChars
  }));

  for (const row of sessionHistory) {
    for (const key of [row.intent_key, row.brand_key, row.target_key, row.service_mode, row.risk_level]) {
      if (key) scopeSet.add(String(key));
    }
  }
  const gptSessionsTenantId = subject.tenant_id || PLATFORM_TENANT_ID;
  const gptSessions = await safeQuery(
    `SELECT session_id, tenant_id, user_id, session_status, turn_count,
            started_at, ended_at, drive_export_url
     FROM \`customer_sessions\`
     WHERE originator = 'gpt_action'
       AND tenant_id = ?
       AND (? IS NULL OR user_id = ?)
     ORDER BY started_at DESC
     LIMIT 10`,
    [gptSessionsTenantId, subject.user_id, subject.user_id]
  );

  const platformAccess = await buildActivationPlatformAccess(req);

  return {
    session_id: newSessionId,
    closed_sessions,
    subject,
    pagination: {
      limit,
      offset,
      include_raw: includeRaw,
      raw_max_chars: includeRaw ? rawMaxChars : undefined,
      has_more_session_history: sessionHistory.length === limit
    },
    last_session: sessionHistory[0] || null,
    session_history: sessionHistory,
    related_scopes: [...scopeSet].sort(),
    history: {
      session_envelopes: sessionHistory,
      audit_events: audit.rows,
      transcript_events: executionTranscript.rows.map((row) => ({
        id: row.id,
        run_date: row.run_date,
        start_time: row.start_time,
        end_time: row.end_time,
        entry_type: row.entry_type,
        execution_class: row.execution_class,
        source_layer: row.source_layer,
        route_keys: row.route_keys,
        selected_workflows: row.selected_workflows,
        execution_status: row.execution_status,
        failure_reason: truncateText(row.failure_reason),
        created_at: row.created_at,
        transcript: {
          user_request: truncateText(row.user_input),
          ai_response: truncateText(row.output_summary)
        },
        ...(includeRaw && subject.is_admin ? {
          raw_dump: {
            user_input: truncateText(row.user_input, rawMaxChars),
            output_summary: truncateText(row.output_summary, rawMaxChars)
          }
        } : {})
      })),
      transcript_events_note: executionTranscript.skipped ? executionTranscript.reason : undefined,
      developer_apps: developerApps.rows.map((row) => ({ ...row, scopes: parseScopes(row.scopes) })),
      api_credentials: apiCredentials.rows.map((row) => ({ ...row, scopes: parseScopes(row.scopes) })),
      installations: installations.rows.map((row) => ({ ...row, scope: parseScopes(row.scope) }))
    },
    gpt_sessions: gptSessions.rows,
    platform_access: platformAccess,
    degraded_surfaces: [
      ["request_envelopes", envelopes],
      ["audit_log", audit],
      ["developer_apps", developerApps],
      ["api_credentials", apiCredentials],
      ["installations", installations],
      ["execution_log", executionTranscript],
      ["gpt_sessions", gptSessions],
      ["platform_access", { ok: platformAccess.degraded_surfaces.length === 0, error: { code: "platform_access_degraded", details: platformAccess.degraded_surfaces } }]
    ]
      .filter(([, result]) => !result.ok)
      .map(([surface, result]) => ({ surface, error: result.error }))
  };
}

export function buildActivationRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  router.get("/activation/env-bootstrap", requireBackendApiKey, async (_req, res) => {
    const githubAppConfigured = Boolean(
      process.env.GITHUB_APP_INSTALLATION_ID &&
      process.env.GITHUB_APP_ID &&
      process.env.GITHUB_APP_PRIVATE_KEY_B64
    );
    const githubPatConfigured = Boolean(process.env.GITHUB_TOKEN);

    return res.status(200).json({
      ok: true,
      activation_layer: "env_bootstrap",
      source: "cloud_run_env",
      sheets_required: false,
      bootstrap_authority: "backend_runtime",
      bootstrap: {
        registry_spreadsheet_id: REGISTRY_SPREADSHEET_ID,
        activity_spreadsheet_id: ACTIVITY_SPREADSHEET_ID,
        activation_bootstrap_spreadsheet_id: ACTIVATION_BOOTSTRAP_SPREADSHEET_ID,
        activation_bootstrap_config_sheet: ACTIVATION_BOOTSTRAP_CONFIG_SHEET,
        activation_bootstrap_config_range: ACTIVATION_BOOTSTRAP_CONFIG_RANGE,
      },
      cache_policy: {
        registry_cache_ttl_seconds: REGISTRY_CACHE_TTL_SECONDS,
        activation_workbook_cache_ttl_seconds: ACTIVATION_WORKBOOK_CACHE_TTL_SECONDS,
        activation_bootstrap_row_cache_ttl_seconds: ACTIVATION_BOOTSTRAP_ROW_CACHE_TTL_SECONDS,
      },
      env_presence: {
        google_auth_mode: process.env.GOOGLE_AUTH_MODE || "default",
        google_application_credentials_configured: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
        google_sa_json_configured: Boolean(process.env.GOOGLE_SA_JSON),
        google_refresh_token_configured: Boolean(process.env.GOOGLE_REFRESH_TOKEN),
        github_auth_configured: githubAppConfigured || githubPatConfigured,
        github_auth_mode: githubAppConfigured ? "github_app" : (githubPatConfigured ? "pat" : "unconfigured"),
        github_app_configured: githubAppConfigured,
        github_app_installation_id_configured: Boolean(process.env.GITHUB_APP_INSTALLATION_ID),
        github_app_id_configured: Boolean(process.env.GITHUB_APP_ID),
        github_app_private_key_b64_configured: Boolean(process.env.GITHUB_APP_PRIVATE_KEY_B64),
        github_token_configured: githubPatConfigured,
        cloudflare_account_id_configured: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID),
        cloudflare_api_token_configured: Boolean(process.env.CLOUDFLARE_API_TOKEN),
        hostinger_cloud_plan_key_configured: Boolean(process.env.HOSTINGER_CLOUD_PLAN_01_API_KEY),
        connector_local_api_key_configured: Boolean(process.env.CONNECTOR_LOCAL_API_KEY),
      },
      note: "Sheets readback is no longer required. Use GET /activation/bootstrap-config for the authoritative runtime bootstrap row.",
    });
  });

  router.get("/activation/bootstrap-config", requireBackendApiKey, async (req, res) => {
    try {
      const pool = getPool();
      const activationBootstrap = await resolveActivationBootstrapConfig();

      // Pull live platform state from DB
      const [[platform]] = await pool.query(
        `SELECT
           COUNT(DISTINCT t.tenant_id)                           AS tenant_count,
           COUNT(DISTINCT m.id)                                  AS membership_count,
           COUNT(DISTINCT tbc.connection_id)                     AS connection_count,
           SUM(CASE WHEN tbc.status = 'active' THEN 1 ELSE 0 END) AS active_connections,
           MAX(tbc.activated_at)                                 AS last_activation_at
         FROM tenants t
         LEFT JOIN memberships m ON CAST(m.tenant_id AS CHAR) COLLATE utf8mb4_unicode_ci = CAST(t.tenant_id AS CHAR) COLLATE utf8mb4_unicode_ci
         LEFT JOIN tenant_backend_connections tbc ON CAST(tbc.tenant_id AS CHAR) COLLATE utf8mb4_unicode_ci = CAST(t.tenant_id AS CHAR) COLLATE utf8mb4_unicode_ci`
      );

      const [[deviceRow]] = await pool.query(
        `SELECT COUNT(*) AS device_count,
                SUM(CASE WHEN is_enabled = 1 THEN 1 ELSE 0 END) AS enabled_devices
         FROM local_connector_user_configs`
      );

      const bootstrapRow = {
        system_name:        "MAD4B Growth Intelligence Platform",
        api_base_url:       process.env.API_BASE_URL || "https://auth.mad4b.com",
        environment:        process.env.NODE_ENV || "production",
        registry_sheet_id:  REGISTRY_SPREADSHEET_ID || null,
        activity_sheet_id:  ACTIVITY_SPREADSHEET_ID || null,
        github_repo:        process.env.GITHUB_REPO || null,
        cloudflare_zone:    process.env.CLOUDFLARE_ZONE_ID || null,
        connector_url:      process.env.CONNECTOR_URL || "https://connector.mad4b.com",
        bootstrap_version:  process.env.SERVICE_VERSION || "backend_runtime",
        activated_at:       platform?.last_activation_at || null,
      };

      return res.status(200).json({
        ok: true,
        activation_layer: "bootstrap_config",
        source: "backend_runtime",
        sheets_required: false,
        bootstrap_row: bootstrapRow,
        activation_bootstrap: activationBootstrap.ok
          ? {
              ok: true,
              source: activationBootstrap.source,
              sheets_required: false,
              github_parent_action_key: activationBootstrap.config.github_parent_action_key,
              github_endpoint_key: activationBootstrap.config.github_endpoint_key,
              github_owner: activationBootstrap.config.github_owner,
              github_repo: activationBootstrap.config.github_repo,
              github_branch: activationBootstrap.config.github_branch,
            }
          : {
              ok: false,
              source: "unresolved",
              error: activationBootstrap.error,
              db_error: activationBootstrap.db_error,
              env_error: activationBootstrap.env_error,
            },
        platform_state: {
          tenant_count:       Number(platform?.tenant_count || 0),
          membership_count:   Number(platform?.membership_count || 0),
          connection_count:   Number(platform?.connection_count || 0),
          active_connections: Number(platform?.active_connections || 0),
          device_count:       Number(deviceRow?.device_count || 0),
          enabled_devices:    Number(deviceRow?.enabled_devices || 0),
          last_activation_at: platform?.last_activation_at || null,
        },
        note: "Authoritative backend runtime bootstrap. GitHub activation binding resolves from DB runtime config first, then server env fallback. Sheets readback is diagnostic only.",
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: { code: "bootstrap_config_failed", message: err.message },
      });
    }
  });

  router.get("/activation/session-context", requireBackendApiKey, async (req, res) => {
    try {
      const context = await buildActivationSessionContext(req);
      return res.status(200).json({
        ok: true,
        activation_layer: "session_context",
        ...context
      });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: {
          code: err.code || "activation_session_context_failed",
          message: err.message
        }
      });
    }
  });

  router.get("/activation/platform-access", requireBackendApiKey, async (req, res) => {
    try {
      const access = await buildActivationPlatformAccess(req);
      return res.status(200).json({
        ok: true,
        activation_layer: "platform_access",
        ...access
      });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: {
          code: err.code || "activation_platform_access_failed",
          message: err.message
        }
      });
    }
  });

  return router;
}
