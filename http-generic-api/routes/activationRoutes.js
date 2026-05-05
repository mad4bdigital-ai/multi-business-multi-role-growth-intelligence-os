import { Router } from "express";
import { getPool } from "../db.js";

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

export async function buildActivationSessionContext(req) {
  const subject = resolveSessionContextSubject(req);
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

  return {
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
    degraded_surfaces: [
      ["request_envelopes", envelopes],
      ["audit_log", audit],
      ["developer_apps", developerApps],
      ["api_credentials", apiCredentials],
      ["installations", installations],
      ["execution_log", executionTranscript]
    ]
      .filter(([, result]) => !result.ok)
      .map(([surface, result]) => ({ surface, error: result.error }))
  };
}

export function buildActivationRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

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

  return router;
}
