import { randomUUID } from "crypto";
import { Router } from "express";
import { getPool } from "../db.js";
import { resolveActivationBootstrapConfig } from "../activationBootstrapConfig.js";
import { ensureSessionArchive } from "../sessionArchiveService.js";
import { resolvePlatformGraphMemory } from "../services/platformGraphMemoryResolver.js";
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

export const SESSION_CONTEXT_DEFAULT_LIMIT = 10;
export const SESSION_CONTEXT_MAX_LIMIT = 50;

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

async function loadActivationPendingTasks(subject = {}, maxLimit = 20) {
  const limit = Math.min(Math.max(Number(maxLimit) || 20, 1), 50);
  const params = [];
  let scopeWhere = "";

  if (!subject.is_admin) {
    // Platform-scoped pending tasks are admin-only. Tenant/user/device callers
    // may only see tasks explicitly assigned to their tenant/user/device scope.
    const scopeParts = [];
    if (subject.tenant_id) {
      scopeParts.push("(owner_scope = 'tenant' AND tenant_id = ?)");
      params.push(subject.tenant_id);
    }
    if (subject.user_id) {
      scopeParts.push("(owner_scope = 'user' AND user_id = ?)");
      params.push(subject.user_id);
    }
    if (!scopeParts.length) {
      scopeParts.push("1 = 0");
    }
    scopeWhere = `AND (${scopeParts.join(" OR ")})`;
  }

  const result = await safeQuery(
    `SELECT task_id, task_key, title, description, brief, activation_prompt,
            task_type, priority, status, blocker_level, owner_scope,
            tenant_id, user_id, device_id, source_surface, source_ref,
            conversation_context_ref, activation_visibility, context_json,
            due_at, completed_at, created_at, updated_at
       FROM \`platform_pending_tasks\`
      WHERE activation_visibility = 1
        AND status IN ('pending','in_progress','blocked','deferred')
        ${scopeWhere}
      ORDER BY FIELD(priority, 'critical', 'high', 'medium', 'low'),
               FIELD(status, 'blocked', 'in_progress', 'pending', 'deferred'),
               updated_at DESC
      LIMIT ${limit}`,
    params
  );

  return {
    ...result,
    rows: result.rows.map((row) => ({
      ...row,
      context_json: parseJsonSafe(row.context_json) || row.context_json || null,
      non_blocking: row.blocker_level === "none" && row.task_type !== "blocker"
    }))
  };
}

function parseConversationContextRefs(value = "") {
  const refs = [];
  const text = String(value || "");
  for (const part of text.split(/[;,\n]/)) {
    const trimmed = part.trim();
    const match = trimmed.match(/^(?:(?<label>[a-z0-9_-]+):)?gpt_session_turns:(?<sessionId>[a-f0-9-]{36})$/i);
    if (match?.groups?.sessionId) {
      refs.push({
        label: match.groups.label || "session",
        source: "gpt_session_turns",
        session_id: match.groups.sessionId,
      });
    }
  }
  return refs;
}

function compactSummary(row = {}) {
  return {
    summary_id: row.summary_id,
    session_id: row.session_id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    workspace_key: row.workspace_key,
    summary_preview: truncateText(row.summary_text, 1200),
    tags: {
      tasks_completed: truncateText(row.tasks_completed, 500),
      blockers: truncateText(row.blockers, 500),
      feature_requests: truncateText(row.feature_requests, 500),
      integration_needs: truncateText(row.integration_needs, 500),
      complexity: row.complexity || null,
    },
    turn_count: asCount(row.turn_count),
    created_at: row.created_at,
  };
}

function compactTurn(row = {}, rawMaxChars = 1200) {
  return {
    session_id: row.session_id,
    turn_id: row.turn_id,
    turn_index: asCount(row.turn_index),
    role: row.role,
    action_key: row.action_key,
    content_preview: truncateText(row.content_preview || row.content, rawMaxChars),
    content_sha256: row.content_sha256 || null,
    storage_mode: row.storage_mode || null,
    drive_doc_id: row.drive_doc_id || null,
    drive_anchor: row.drive_anchor || null,
    created_at: row.created_at,
  };
}

async function loadConversationMemoryContext(pool, subject = {}, options = {}) {
  const tenantId = subject.tenant_id || PLATFORM_TENANT_ID;
  const userId = subject.user_id || null;
  const limit = capLimit(options.limit, 10, 25);
  const includeTurns = options.include_turns === true;
  const turnsLimit = capLimit(options.turns_limit, includeTurns ? 20 : 0, 100);
  const rawMaxChars = capLimit(options.raw_max_chars, 1200, 6000);
  const pendingTasks = Array.isArray(options.pending_tasks) ? options.pending_tasks : [];
  const gptSessions = Array.isArray(options.gpt_sessions) ? options.gpt_sessions : [];
  const gptSessionIds = gptSessions.map((row) => row.session_id).filter(Boolean);

  const summaries = await safeQuery(
    `SELECT summary_id, session_id, tenant_id, user_id, workspace_key, summary_text,
            tasks_completed, blockers, feature_requests, integration_needs,
            complexity, turn_count, created_at
       FROM \`session_summaries\`
      WHERE tenant_id = ?
        AND (? IS NULL OR user_id = ?)
      ORDER BY created_at DESC
      LIMIT ${limit}`,
    [tenantId, userId, userId]
  );

  const referencedRefs = [];
  for (const task of pendingTasks) {
    const refs = parseConversationContextRefs(task.conversation_context_ref || task.context_json?.conversation_context_ref || "");
    for (const ref of refs) {
      referencedRefs.push({
        ...ref,
        task_key: task.task_key,
        task_title: task.title,
      });
    }
  }
  const referencedSessionIds = [...new Set(referencedRefs.map((ref) => ref.session_id))];
  const allRelevantSessionIds = [...new Set([...gptSessionIds, ...referencedSessionIds])].slice(0, 50);

  const turnStats = allRelevantSessionIds.length
    ? await safeQuery(
        `SELECT COUNT(*) AS turn_count,
                COUNT(DISTINCT session_id) AS session_count,
                MAX(created_at) AS last_turn_at
           FROM \`gpt_session_turns\`
          WHERE session_id IN (?)`,
        [allRelevantSessionIds]
      )
    : { ok: true, rows: [{ turn_count: 0, session_count: 0, last_turn_at: null }] };

  const storedTurnPreviews = includeTurns && allRelevantSessionIds.length
    ? await safeQuery(
        `SELECT session_id, turn_id, turn_index, role, content, content_preview,
                content_sha256, storage_mode, action_key, drive_doc_id, drive_anchor, created_at
           FROM \`gpt_session_turns\`
          WHERE session_id IN (?)
          ORDER BY created_at DESC, turn_index DESC
          LIMIT ${turnsLimit}`,
        [allRelevantSessionIds]
      )
    : { ok: true, rows: [], skipped: true, reason: "include_turns=false" };

  let graphMemory = {
    requested: false,
    resolved: false,
    asset_count: 0,
    assets: [],
    selection_policy: {},
    reason: "not_requested",
    secrets_included: false,
  };
  try {
    graphMemory = await resolvePlatformGraphMemory({
      input: {
        request_type: "activation_session_context",
        diagnostic_surface: "conversation_memory_context",
        node_id: "platform.global",
        tenant_id: tenantId,
        user_id: userId,
        depth: 1,
        memory_limit: 5,
      },
      limit: 5,
    });
  } catch (err) {
    graphMemory = {
      requested: true,
      resolved: false,
      asset_count: 0,
      assets: [],
      error: { code: err.code || "session_context_graph_memory_failed", message: err.message },
      selection_policy: {},
      secrets_included: false,
    };
  }

  const statsRow = turnStats.rows[0] || {};
  return {
    status: {
      session_context_reachable: true,
      new_session_opened: true,
      parallel_sessions_allowed: true,
      native_chatgpt_history_available: false,
      platform_stored_sessions_available: gptSessions.length > 0,
      stored_turns_available: asCount(statsRow.turn_count) > 0,
      turn_content_loaded: includeTurns,
      summary_strategy: "prefer_session_summaries_and_tags_then_load_turn_previews_on_demand",
      graph_assisted_lookup: Boolean(graphMemory.requested),
      sources_checked: [
        "customer_sessions",
        "gpt_session_turns",
        "session_summaries",
        "platform_pending_tasks.conversation_context_ref",
        "platform_graph_memory",
      ],
    },
    turn_availability: {
      stored_turn_count: asCount(statsRow.turn_count),
      stored_session_count: asCount(statsRow.session_count),
      last_turn_at: statsRow.last_turn_at || null,
      include_turns,
      turns_limit: includeTurns ? turnsLimit : 0,
    },
    recent_session_summaries: summaries.rows.map(compactSummary),
    referenced_contexts: referencedRefs.slice(0, 50),
    stored_turn_previews: storedTurnPreviews.rows.map((row) => compactTurn(row, rawMaxChars)),
    graph_memory: {
      requested: Boolean(graphMemory.requested),
      resolved: Boolean(graphMemory.resolved),
      asset_count: Number(graphMemory.asset_count || 0),
      asset_keys: Array.isArray(graphMemory.assets) ? graphMemory.assets.map((asset) => asset.asset_key).filter(Boolean) : [],
      selection_policy: graphMemory.selection_policy || {},
      error: graphMemory.error || null,
      secrets_included: false,
    },
    degraded_surfaces: [
      ["session_summaries", summaries],
      ["gpt_session_turns", turnStats],
      ["gpt_session_turn_previews", storedTurnPreviews],
    ]
      .filter(([, result]) => !result.ok)
      .map(([surface, result]) => ({ surface, error: result.error })),
  };
}

async function autoOpenGptSession(pool, subject, options = {}) {
  const userId = subject.user_id || null;
  const tenantId = subject.tenant_id || PLATFORM_TENANT_ID;
  const closePreviousSessions = options.close_previous_sessions === true;

  const [[activeBeforeRow]] = await pool.query(
    `SELECT COUNT(*) AS active_count
       FROM \`customer_sessions\`
      WHERE originator = 'gpt_action'
        AND tenant_id = ?
        AND (? IS NULL OR user_id = ?)
        AND session_status IN ('pending', 'active')`,
    [tenantId, userId, userId]
  );

  let closeResult = { affectedRows: 0 };
  if (closePreviousSessions) {
    [closeResult] = await pool.query(
      `UPDATE \`customer_sessions\`
       SET session_status = 'completed', ended_at = COALESCE(ended_at, NOW())
       WHERE originator = 'gpt_action'
         AND tenant_id = ?
         AND (? IS NULL OR user_id = ?)
         AND session_status IN ('pending', 'active')`,
      [tenantId, userId, userId]
    );
  }

  const sessionId = randomUUID();
  const startedAt = new Date();
  await pool.query(
    `INSERT INTO \`customer_sessions\`
       (session_id, tenant_id, user_id, originator, session_status, started_at)
     VALUES (?, ?, ?, 'gpt_action', 'active', ?)`,
    [sessionId, tenantId, userId, startedAt]
  );

  // Best-effort: allocate the Drive archive structure now so future turn writes
  // (manual writeSessionTurn or auto-recorded tool dispatches) flow into a
  // ready folder without lazy-allocating on first turn. Fail-open: activation
  // must still succeed if Drive auth is unavailable.
  let archiveStatus = "not_attempted";
  try {
    const archiveResult = await ensureSessionArchive(pool, {
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      started_at: startedAt,
    });
    archiveStatus = archiveResult?.configured ? "ready" : "not_configured";
  } catch (err) {
    archiveStatus = "deferred";
    console.warn(`[activation] ensureSessionArchive failed for ${sessionId}, will lazy-allocate on first turn: ${err.message}`);
  }

  const activeBefore = asCount(activeBeforeRow?.active_count);
  return {
    session_id: sessionId,
    closed_sessions: closeResult.affectedRows || 0,
    archive_status: archiveStatus,
    session_management: {
      parallel_sessions_allowed: true,
      close_previous_sessions_requested: closePreviousSessions,
      active_sessions_before_open: activeBefore,
      active_sessions_after_open: closePreviousSessions ? 1 : activeBefore + 1,
      status_written: "active",
    },
  };
}

export async function buildActivationSessionContext(req) {
  const pool = getPool();
  const subject = resolveSessionContextSubject(req);

  const sessionOpen = await autoOpenGptSession(pool, subject, {
    close_previous_sessions: asBoolean(req.query.close_previous_sessions) || asBoolean(req.query.close_previous),
  });
  const { session_id: newSessionId, closed_sessions } = sessionOpen;

  const limit = capLimit(req.query.limit, SESSION_CONTEXT_DEFAULT_LIMIT, SESSION_CONTEXT_MAX_LIMIT);
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
  const pendingTasks = await loadActivationPendingTasks(subject, 25);
  const pendingTaskRows = pendingTasks.rows || [];
  const pendingTaskSummary = {
    total_visible: pendingTaskRows.length,
    blockers: pendingTaskRows.filter((task) => task.blocker_level !== "none" || task.task_type === "blocker").length,
    non_blocking: pendingTaskRows.filter((task) => task.blocker_level === "none" && task.task_type !== "blocker").length,
    by_status: pendingTaskRows.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {}),
    by_type: pendingTaskRows.reduce((acc, task) => {
      acc[task.task_type] = (acc[task.task_type] || 0) + 1;
      return acc;
    }, {})
  };

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
      session_envelopes_count: sessionHistory.length,
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
    pending_tasks: {
      summary: pendingTaskSummary,
      items: pendingTaskRows
    },
    degraded_surfaces: [
      ["request_envelopes", envelopes],
      ["audit_log", audit],
      ["developer_apps", developerApps],
      ["api_credentials", apiCredentials],
      ["installations", installations],
      ["execution_log", executionTranscript],
      ["gpt_sessions", gptSessions],
      ["pending_tasks", pendingTasks],
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
    const githubAppPrivateKeyConfigured = Boolean(process.env.GITHUB_APP_PRIVATE_KEY);
    const githubAppConfigured = Boolean(
      process.env.GITHUB_APP_INSTALLATION_ID &&
      process.env.GITHUB_APP_ID &&
      githubAppPrivateKeyConfigured
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
        github_app_private_key_configured: Boolean(process.env.GITHUB_APP_PRIVATE_KEY),
        github_token_configured: githubPatConfigured,
        activation_github_repository_configured: Boolean(process.env.ACTIVATION_GITHUB_REPOSITORY),
        activation_github_owner_configured: Boolean(process.env.ACTIVATION_GITHUB_OWNER),
        activation_github_repo_configured: Boolean(process.env.ACTIVATION_GITHUB_REPO),
        activation_github_branch_configured: Boolean(process.env.ACTIVATION_GITHUB_BRANCH),
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
        github_repo:        activationBootstrap.ok
          ? `${activationBootstrap.config.github_owner}/${activationBootstrap.config.github_repo}`
          : (process.env.ACTIVATION_GITHUB_REPOSITORY || process.env.ACTIVATION_GITHUB_REPO || null),
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
