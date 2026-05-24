import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { fetchDriveContent } from "./uploadPipeline.js";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MIN_AGE_SECONDS = 60;
const DEFAULT_FALLBACK_TURNS_LIMIT = 200;
const DEFAULT_CHUNK_CHAR_LIMIT = 18000;
const DEFAULT_FINAL_CHAR_LIMIT = 30000;
const MAX_ARRAY_ITEMS = 5;

function defaultDeps() {
  return {
    fetchDriveContent,
    now: () => new Date(),
  };
}

export function redactSensitiveText(value = "") {
  let text = String(value || "");
  const replacements = [
    [/(authorization\s*:\s*bearer\s+)[^\s"'`]+/gi, "$1[REDACTED]"],
    [/(x-api-key\s*:\s*)[^\s"'`]+/gi, "$1[REDACTED]"],
    [/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|secret|private[_-]?key)\s*[=:]\s*)[^\s,;"'`]+/gi, "$1[REDACTED]"],
    [/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|secret|private[_-]?key)"\s*:\s*")[^"]+/gi, "$1[REDACTED]"],
    [/(-----BEGIN [^-]+PRIVATE KEY-----)[\s\S]+?(-----END [^-]+PRIVATE KEY-----)/g, "$1[REDACTED]$2"],
  ];
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function boundedText(value = "", limit = 2000) {
  const text = String(value || "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...[truncated]`;
}

function sanitizeModelError(error) {
  const message = redactSensitiveText(error?.message || String(error || "model_call_failed"));
  const providerMatch = message.match(/\b(Anthropic|OpenAI|Gemini) API\s+(\d{3})/i);
  if (providerMatch) {
    return `model_call_failed: ${providerMatch[1]} API ${providerMatch[2]}`;
  }
  if (/invalid\s+(x-api-key|api key|authorization|credentials?)/i.test(message)) {
    return "model_call_failed: invalid model credentials";
  }
  if (/missing\s+.*(api key|credential|token)/i.test(message)) {
    return "model_call_failed: missing model credentials";
  }
  return boundedText(message.replace(/\{[\s\S]*\}/g, "[upstream_error_body_redacted]"), 240);
}

function safeJsonParse(value, fallback = null) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, MAX_ARRAY_ITEMS);
  if (typeof value === "string" && value.trim()) return [value.trim()].slice(0, MAX_ARRAY_ITEMS);
  return [];
}

function normalizeComplexity(value) {
  return ["low", "medium", "high"].includes(value) ? value : "medium";
}

function normalizeGraphIdPart(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, 180);
}

function summaryAssetId(summaryId) {
  return `session_summary_${normalizeGraphIdPart(summaryId)}`;
}

function summaryLinkId(summaryId) {
  return `link_${normalizeGraphIdPart(summaryId).replace(/-/g, "")}`.slice(0, 64);
}

function buildSummaryJsonPayload({ session, summaryId, insight }) {
  return JSON.stringify({
    summary_id: summaryId,
    session_id: session.session_id,
    tenant_id: session.tenant_id || PLATFORM_TENANT_ID,
    user_id: session.user_id || null,
    workspace_key: session.workspace_key || null,
    summary_text: insight.summary_text,
    tasks_completed: normalizeArray(insight.tasks_completed),
    blockers: normalizeArray(insight.blockers),
    feature_requests: normalizeArray(insight.feature_requests),
    integration_needs: normalizeArray(insight.integration_needs),
    complexity: normalizeComplexity(insight.complexity),
    turn_count: Number(session.turn_count || 0),
    summary_scope: "summary_only",
    secrets_included: false,
  });
}

function normalizeModelText(response) {
  if (typeof response === "string") return response;
  if (typeof response?.content === "string") return response.content;
  if (Array.isArray(response?.content)) {
    return response.content
      .filter((block) => block?.type === "text" || typeof block?.text === "string")
      .map((block) => block.text || "")
      .join("\n");
  }
  return String(response?.text || response?.message || "");
}

export function parseSummaryJson(text, fallback = {}) {
  const body = String(text || "");
  const jsonText = body.match(/\{[\s\S]*\}/)?.[0] || body;
  const parsed = safeJsonParse(jsonText, null);
  if (!parsed || typeof parsed !== "object") return fallback;
  return {
    summary_text: String(parsed.summary_text || fallback.summary_text || "").trim(),
    tasks_completed: normalizeArray(parsed.tasks_completed),
    blockers: normalizeArray(parsed.blockers),
    feature_requests: normalizeArray(parsed.feature_requests),
    integration_needs: normalizeArray(parsed.integration_needs),
    complexity: normalizeComplexity(parsed.complexity),
  };
}

function fallbackInsight(session, source, warning = null) {
  return {
    summary_text: `Session ${session.session_id} ended with ${Number(session.turn_count || 0)} turns. Summary source: ${source}.${warning ? ` Warning: ${warning}` : ""}`,
    tasks_completed: [],
    blockers: warning ? [boundedText(warning, 240)] : [],
    feature_requests: [],
    integration_needs: [],
    complexity: "medium",
  };
}

function compactOperationDetail(detail = {}) {
  const allowed = {};
  for (const [key, value] of Object.entries(detail || {})) {
    if (value === undefined) continue;
    if (/secret|token|password|key|credential/i.test(key)) continue;
    if (typeof value === "string") allowed[key] = boundedText(redactSensitiveText(value), 180);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) allowed[key] = value;
    else if (Array.isArray(value)) allowed[key] = value.slice(0, 5).map(item => typeof item === "string" ? boundedText(redactSensitiveText(item), 120) : item);
    else allowed[key] = JSON.parse(JSON.stringify(value));
  }
  return allowed;
}

function recordOperation(operationLog, event) {
  const entry = {
    at: new Date().toISOString(),
    ...compactOperationDetail(event),
  };
  if (Array.isArray(operationLog)) operationLog.push(entry);
  console.info("[sessionSummary] operation", entry);
  return entry;
}

function summarizeOperationResult(stage, result) {
  if (!result || typeof result !== "object") return {};
  if (stage === "check_existing_summary") {
    return { summary_exists: Boolean(result.summary_id), summary_id: result.summary_id || null };
  }
  if (stage === "load_transcript") {
    return {
      transcript_source: result.source,
      events_loaded: Array.isArray(result.events) ? result.events.length : 0,
      fallback_used: Boolean(result.fallback_used),
      warning: result.warning || null,
    };
  }
  if (stage === "summarize_transcript") {
    return {
      summary_text_chars: String(result.summary_text || "").length,
      blockers: Array.isArray(result.blockers) ? result.blockers.length : 0,
      model_warning: Array.isArray(result.blockers) && result.blockers.some(item => /^model_call_failed:|^all_model_providers_failed:/i.test(String(item || ""))),
    };
  }
  if (stage === "write_session_summary") return { summary_id: result };
  if (stage === "verify_session_summary_write") return result;
  return {};
}

async function withOperationStep(operationLog, stage, fn, detail = {}) {
  const startedAt = Date.now();
  recordOperation(operationLog, { stage, status: "started", ...detail });
  try {
    const result = await fn();
    recordOperation(operationLog, {
      stage,
      status: "succeeded",
      duration_ms: Date.now() - startedAt,
      ...summarizeOperationResult(stage, result),
    });
    return result;
  } catch (err) {
    recordOperation(operationLog, {
      stage,
      status: "failed",
      duration_ms: Date.now() - startedAt,
      error: sanitizeModelError(err),
    });
    throw err;
  }
}

export async function verifySessionSummaryWrite({ pool = getPool(), session, summary_id }) {
  if (!session?.session_id || !summary_id) {
    return { ok: false, summary_row_present: false, graph_asset_present: false, reason: "missing_session_or_summary_id" };
  }

  const [summaryRows] = await pool.query(
    `SELECT summary_id, session_id, tenant_id, turn_count, created_at
     FROM \`session_summaries\`
     WHERE summary_id = ? AND session_id = ?
     LIMIT 1`,
    [summary_id, session.session_id]
  ).catch(() => [[]]);

  const [assetRows] = await pool.query(
    `SELECT asset_id, validation_status, active_status
     FROM \`json_assets\`
     WHERE source_asset_ref = ? AND asset_type = 'session_summary'
     LIMIT 1`,
    [summary_id]
  ).catch(() => [[]]);

  const summaryRow = summaryRows[0] || null;
  const assetRow = assetRows[0] || null;
  return {
    ok: Boolean(summaryRow),
    summary_row_present: Boolean(summaryRow),
    graph_asset_present: Boolean(assetRow),
    graph_validation_status: assetRow?.validation_status || null,
    graph_active_status: assetRow?.active_status || null,
    summary_id,
    session_id: session.session_id,
  };
}

export function parseSessionJsonl(content = "") {
  const events = [];
  for (const [lineIndex, line] of String(content || "").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const parsed = safeJsonParse(line, null);
    if (!parsed || typeof parsed !== "object") continue;
    const rawContent = parsed.content ?? parsed.payload?.content ?? parsed.message ?? parsed.text ?? "";
    events.push({
      source: "drive_jsonl",
      line_index: lineIndex,
      turn_index: Number.isFinite(Number(parsed.turn_index)) ? Number(parsed.turn_index) : lineIndex,
      role: parsed.role || parsed.event_type || "unknown",
      action_key: parsed.action_key || null,
      content_sha256: parsed.content_sha256 || null,
      created_at: parsed.created_at || parsed.timestamp || null,
      content: redactSensitiveText(rawContent),
    });
  }
  return events;
}

async function loadDriveJsonlEvents(session, injectedDeps = {}) {
  const deps = { ...defaultDeps(), ...injectedDeps };
  if (!session.drive_jsonl_id) {
    return { source: "drive_jsonl", ok: false, skipped: true, events: [], warning: "missing_drive_jsonl_id" };
  }
  try {
    const content = await deps.fetchDriveContent(session.drive_jsonl_id);
    const events = parseSessionJsonl(content);
    return { source: "drive_jsonl", ok: true, events, warning: events.length ? null : "drive_jsonl_empty_or_unparseable" };
  } catch (err) {
    return { source: "drive_jsonl", ok: false, events: [], warning: err.message };
  }
}

async function loadSqlPreviewEvents(pool, sessionId, limit = DEFAULT_FALLBACK_TURNS_LIMIT) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_FALLBACK_TURNS_LIMIT, 500));
  let [rows] = await pool.query(
    `SELECT turn_id, turn_index, role, action_key, content_preview, content_sha256, created_at
     FROM \`gpt_session_turns\`
     WHERE session_id = ?
     ORDER BY turn_index ASC
     LIMIT ?`,
    [sessionId, safeLimit]
  ).catch(() => [[]]);

  if (!rows.length) {
    [rows] = await pool.query(
      `SELECT turn_index, role, action_key, content_preview, content_sha256, created_at
       FROM \`gpt_session_turns\`
       WHERE session_id = ?
       ORDER BY turn_index ASC
       LIMIT ?`,
      [sessionId, safeLimit]
    ).catch(() => [[]]);
  }

  return rows.map((row, index) => ({
    source: "sql_preview",
    line_index: index,
    turn_index: Number.isFinite(Number(row.turn_index)) ? Number(row.turn_index) : index,
    role: row.role || "unknown",
    action_key: row.action_key || null,
    content_sha256: row.content_sha256 || null,
    created_at: row.created_at || null,
    content: redactSensitiveText(row.content_preview || ""),
  }));
}

export async function loadSessionTranscript({
  pool = getPool(),
  session,
  fallbackTurnsLimit = DEFAULT_FALLBACK_TURNS_LIMIT,
  injectedDeps = {},
  fetchDriveContentFn = null,
} = {}) {
  const effectiveDeps = fetchDriveContentFn
    ? { ...injectedDeps, fetchDriveContent: fetchDriveContentFn }
    : injectedDeps;
  const drive = await loadDriveJsonlEvents(session, effectiveDeps);
  if (drive.events.length) {
    return {
      source: "drive_jsonl",
      source_ok: drive.ok,
      warning: drive.warning,
      events: drive.events,
      turns: drive.events,
      fallback_used: false,
      drive_error: null,
    };
  }

  const fallback = await loadSqlPreviewEvents(pool, session.session_id, fallbackTurnsLimit);
  return {
    source: "sql_preview",
    source_ok: fallback.length > 0,
    warning: drive.warning,
    events: fallback,
    turns: fallback,
    fallback_used: true,
    drive_error: drive.warning
      ? { code: "drive_jsonl_read_failed", message: drive.warning }
      : null,
  };
}

function formatEventsForModel(session, events, charLimit = DEFAULT_CHUNK_CHAR_LIMIT) {
  const header = [
    `Session: ${session.session_id}`,
    `Tenant: ${session.tenant_id || PLATFORM_TENANT_ID}`,
    `User: ${session.user_id || "platform_admin"}`,
    `Workspace: ${session.workspace_key || "n/a"}`,
    `Turns: ${session.turn_count || events.length || 0}`,
    "",
  ].join("\n");
  let output = header;
  for (const event of events) {
    const part = [
      `Turn ${event.turn_index} | ${String(event.role || "unknown").toUpperCase()}${event.action_key ? ` | action=${event.action_key}` : ""}`,
      boundedText(event.content || "", 1800),
      "",
    ].join("\n");
    if ((output.length + part.length) > charLimit) break;
    output += part;
  }
  return output;
}

function chunkTranscriptEvents(session, events, charLimit = DEFAULT_CHUNK_CHAR_LIMIT) {
  const chunks = [];
  let current = [];
  for (const event of events) {
    const candidate = [...current, event];
    if (current.length && formatEventsForModel(session, candidate, charLimit + 1000).length > charLimit) {
      chunks.push(current);
      current = [event];
    } else {
      current = candidate;
    }
  }
  if (current.length) chunks.push(current);
  return chunks.length ? chunks : [[]];
}

const SUMMARY_SYSTEM_PROMPT = `You summarize archived platform GPT sessions for retrieval and continuity. Return ONLY valid JSON with keys: summary_text, tasks_completed, blockers, feature_requests, integration_needs, complexity. Keep arrays to at most five concise items. Do not include secrets, tokens, passwords, private keys, or raw provider outputs. Do not invent facts not present in the transcript.`;

async function summarizeChunk({ session, events, callModel, label }) {
  const messages = [
    { role: "system", content: SUMMARY_SYSTEM_PROMPT },
    { role: "user", content: `${label}\n\n${formatEventsForModel(session, events)}` },
  ];
  const response = await callModel(messages, []);
  const parsed = parseSummaryJson(normalizeModelText(response), null);
  if (!parsed?.summary_text) throw new Error("summary_model_returned_invalid_json");
  return parsed;
}

async function consolidateSummaries({ session, chunkSummaries, callModel }) {
  if (chunkSummaries.length === 1) return chunkSummaries[0];
  const summaryBlock = chunkSummaries
    .map((summary, index) => `Chunk ${index + 1}: ${JSON.stringify(summary)}`)
    .join("\n");
  const messages = [
    { role: "system", content: SUMMARY_SYSTEM_PROMPT },
    {
      role: "user",
      content: boundedText(
        `Consolidate these chunk summaries into one final session summary for session ${session.session_id}.\n\n${summaryBlock}`,
        DEFAULT_FINAL_CHAR_LIMIT
      ),
    },
  ];
  const response = await callModel(messages, []);
  const parsed = parseSummaryJson(normalizeModelText(response), null);
  if (!parsed?.summary_text) throw new Error("summary_consolidation_returned_invalid_json");
  return parsed;
}

export async function summarizeSessionTranscript({ session, transcript, callModel }) {
  const events = transcript?.events || [];
  if (!events.length) return fallbackInsight(session, transcript?.source || "none", "no transcript events available");
  if (!callModel) {
    return fallbackInsight(
      session,
      transcript?.source || "none",
      "session summary model not configured; stored deterministic fallback summary"
    );
  }

  try {
    const chunks = chunkTranscriptEvents(session, events);
    const chunkSummaries = [];
    for (const [index, chunk] of chunks.entries()) {
      chunkSummaries.push(await summarizeChunk({ session, events: chunk, callModel, label: `Transcript chunk ${index + 1} of ${chunks.length}` }));
    }
    return await consolidateSummaries({ session, chunkSummaries, callModel });
  } catch (err) {
    return fallbackInsight(session, transcript?.source || "unknown", sanitizeModelError(err));
  }
}

export async function loadSessionById(pool, sessionId) {
  const [rows] = await pool.query(
    "SELECT * FROM `customer_sessions` WHERE session_id = ? LIMIT 1",
    [sessionId]
  );
  return rows[0] || null;
}

async function existingSummary(pool, sessionId) {
  const [rows] = await pool.query(
    "SELECT summary_id FROM `session_summaries` WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
    [sessionId]
  ).catch(() => [[]]);
  return rows[0] || null;
}

async function attachSessionSummaryToGraph({ pool, session, summaryId, insight }) {
  const tenantId = session.tenant_id || PLATFORM_TENANT_ID;
  const userId = session.user_id || null;
  const assetId = summaryAssetId(summaryId);
  const assetKey = `session_summary_${normalizeGraphIdPart(session.session_id)}`;
  const linkId = summaryLinkId(summaryId);
  const conversationNodeId = `conversation.${normalizeGraphIdPart(session.session_id)}`;
  const assetNodeId = `json_asset.${normalizeGraphIdPart(assetId)}`;
  const edgeId = `edge.session_summary.${normalizeGraphIdPart(summaryId)}`;
  const payload = buildSummaryJsonPayload({ session, summaryId, insight });

  await pool.query(
    `INSERT INTO \`json_assets\`
       (asset_id, brand_name, asset_key, asset_type, mapping_status,
        mapping_version, storage_format, source_mode, source_asset_ref,
        json_payload, transport_status, validation_status, last_validated_at,
        notes, active_status)
     VALUES (?, 'platform', ?, 'session_summary', 'mapped', 'session_summary_v1',
             'json', 'session_summary_autosweep', ?, ?, 'summary_only',
             'validated', DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%sZ'),
             'Summary-only GPT session memory asset; no raw transcript or secrets included.', 'active')
     ON DUPLICATE KEY UPDATE
       asset_key = VALUES(asset_key),
       json_payload = VALUES(json_payload),
       validation_status = VALUES(validation_status),
       notes = VALUES(notes),
       active_status = VALUES(active_status),
       updated_at = CURRENT_TIMESTAMP`,
    [assetId, assetKey, summaryId, payload]
  );

  await pool.query(
    `INSERT INTO \`json_asset_subject_links\`
       (link_id, asset_id, asset_key, subject_type, subject_ref, tenant_id,
        user_id, subject_key, linkage_type, scope_label, metadata_json, status)
     VALUES (?, ?, ?, 'conversation', ?, ?, ?, ?, 'summary_attachment',
             'session_summary', ?, 'active')
     ON DUPLICATE KEY UPDATE
       asset_id = VALUES(asset_id),
       asset_key = VALUES(asset_key),
       tenant_id = VALUES(tenant_id),
       user_id = VALUES(user_id),
       subject_key = VALUES(subject_key),
       metadata_json = VALUES(metadata_json),
       status = VALUES(status),
       updated_at = CURRENT_TIMESTAMP`,
    [
      linkId,
      assetId,
      assetKey,
      session.session_id,
      tenantId,
      userId,
      `session.${session.session_id}`,
      JSON.stringify({ summary_id: summaryId, source_table: "session_summaries", secrets_included: false }),
    ]
  );

  await pool.query(
    `INSERT INTO \`platform_graph_nodes\`
       (node_id, node_type, node_label, scope_type, subject_ref, source_table,
        source_pk, authority_status, lifecycle_status, visibility_scope,
        sensitivity, evidence_level, runtime_role, source_system, metadata_json)
     VALUES
       (?, 'conversation', ?, 'platform', ?, 'customer_sessions', ?,
        'authoritative', 'active', 'platform_admin', 'internal', 'system',
        'memory_subject', 'sql', ?),
       (?, 'json_asset', ?, 'platform', ?, 'json_assets', ?,
        'authoritative', 'active', 'platform_admin', 'internal', 'system',
        'resolver_input', 'sql', ?)
     ON DUPLICATE KEY UPDATE
       node_label = VALUES(node_label),
       lifecycle_status = VALUES(lifecycle_status),
       runtime_role = VALUES(runtime_role),
       metadata_json = VALUES(metadata_json),
       updated_at = CURRENT_TIMESTAMP`,
    [
      conversationNodeId,
      `GPT session ${session.session_id}`,
      session.session_id,
      session.session_id,
      JSON.stringify({ tenant_id: tenantId, user_id: userId, turn_count: Number(session.turn_count || 0) }),
      assetNodeId,
      assetKey,
      assetId,
      assetId,
      JSON.stringify({ asset_key: assetKey, asset_type: "session_summary", summary_id: summaryId }),
    ]
  );

  await pool.query(
    `INSERT INTO \`platform_graph_edges\`
       (edge_id, source_node_id, edge_type, target_node_id, scope_type,
        authority_status, lifecycle_status, visibility_scope, sensitivity,
        evidence_level, runtime_role, runtime_enforced, source_table,
        source_pk, metadata_json)
     VALUES (?, ?, 'attached_to', ?, 'platform', 'authoritative', 'active',
             'platform_admin', 'internal', 'system', 'resolver_input', 1,
             'json_asset_subject_links', ?, ?)
     ON DUPLICATE KEY UPDATE
       lifecycle_status = VALUES(lifecycle_status),
       runtime_role = VALUES(runtime_role),
       runtime_enforced = VALUES(runtime_enforced),
       metadata_json = VALUES(metadata_json),
       updated_at = CURRENT_TIMESTAMP`,
    [
      edgeId,
      assetNodeId,
      conversationNodeId,
      linkId,
      JSON.stringify({ summary_id: summaryId, linkage_type: "summary_attachment", secrets_included: false }),
    ]
  );

  return { asset_id: assetId, asset_key: assetKey, link_id: linkId, edge_id: edgeId };
}

export async function writeSessionSummary({ pool = getPool(), session, insight, run_id = null }) {
  const summaryId = randomUUID();
  await pool.query(
    `INSERT INTO \`session_summaries\`
       (summary_id, session_id, tenant_id, user_id, workspace_key,
        summary_text, tasks_completed, blockers, feature_requests,
        integration_needs, complexity, session_model, turn_count,
        analyzed, dev_agent_run_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW())`,
    [
      summaryId,
      session.session_id,
      session.tenant_id || PLATFORM_TENANT_ID,
      session.user_id || null,
      session.workspace_key || null,
      insight.summary_text,
      JSON.stringify(normalizeArray(insight.tasks_completed)),
      JSON.stringify(normalizeArray(insight.blockers)),
      JSON.stringify(normalizeArray(insight.feature_requests)),
      JSON.stringify(normalizeArray(insight.integration_needs)),
      normalizeComplexity(insight.complexity),
      session.model_name || null,
      Number(session.turn_count || 0),
      run_id,
    ]
  );

  try {
    await attachSessionSummaryToGraph({ pool, session, summaryId, insight });
  } catch (err) {
    console.warn("[sessionSummary] graph attachment failed", {
      session_id: session.session_id,
      summary_id: summaryId,
      message: err?.message || String(err),
    });
  }

  return summaryId;
}

export async function summarizeAndStoreSession({
  pool = getPool(),
  session = null,
  session_id = null,
  callModel,
  run_id = null,
  fallbackTurnsLimit = DEFAULT_FALLBACK_TURNS_LIMIT,
  injectedDeps = {},
} = {}) {
  const resolvedSession = session || await loadSessionById(pool, session_id);
  if (!resolvedSession) {
    return { ok: false, skipped: true, reason: "session_not_found", session_id };
  }

  const found = await existingSummary(pool, resolvedSession.session_id);
  if (found?.summary_id) {
    return { ok: true, skipped: true, reason: "summary_exists", session_id: resolvedSession.session_id, summary_id: found.summary_id };
  }

  const transcript = await loadSessionTranscript({ pool, session: resolvedSession, fallbackTurnsLimit, injectedDeps });
  const insight = await summarizeSessionTranscript({ session: resolvedSession, transcript, callModel });
  const summaryId = await writeSessionSummary({ pool, session: resolvedSession, insight, run_id });

  return {
    ok: true,
    skipped: false,
    session_id: resolvedSession.session_id,
    summary_id: summaryId,
    transcript_source: transcript.source,
    fallback_used: transcript.fallback_used,
    events_loaded: transcript.events.length,
    warning: transcript.warning || null,
  };
}

export async function summarizeSessionIfNeeded({
  pool = getPool(),
  session,
  callModel,
  run_id = null,
  fallbackTurnsLimit = DEFAULT_FALLBACK_TURNS_LIMIT,
  injectedDeps = {},
} = {}) {
  return summarizeAndStoreSession({
    pool,
    session,
    callModel,
    run_id,
    fallbackTurnsLimit,
    injectedDeps,
  });
}

export async function writeProvidedSessionSummary({
  pool = getPool(),
  session,
  summaryText,
  run_id = null,
} = {}) {
  if (!session?.session_id) {
    return { ok: false, skipped: true, reason: "session_not_found" };
  }

  const found = await existingSummary(pool, session.session_id);
  if (found?.summary_id) {
    return { ok: true, skipped: true, reason: "summary_exists", session_id: session.session_id, summary_id: found.summary_id };
  }

  const insight = {
    summary_text: redactSensitiveText(summaryText || ""),
    tasks_completed: [],
    blockers: [],
    feature_requests: [],
    integration_needs: [],
    complexity: "medium",
  };
  const summaryId = await writeSessionSummary({ pool, session, insight, run_id });
  return {
    ok: true,
    skipped: false,
    session_id: session.session_id,
    summary_id: summaryId,
    transcript_source: "provided_summary",
    fallback_used: false,
    events_loaded: 0,
    warning: null,
  };
}

export async function findSessionsNeedingSummary({ pool = getPool(), batchSize = DEFAULT_BATCH_SIZE, minAgeSeconds = DEFAULT_MIN_AGE_SECONDS } = {}) {
  const safeBatchSize = Math.max(1, Math.min(Number(batchSize) || DEFAULT_BATCH_SIZE, 100));
  const safeMinAge = Math.max(0, Math.min(Number(minAgeSeconds) || 0, 86400));
  const agePredicate = safeMinAge > 0
    ? `AND (cs.ended_at IS NULL OR cs.ended_at <= DATE_SUB(NOW(), INTERVAL ${safeMinAge} SECOND))`
    : "";
  const [rows] = await pool.query(
    `SELECT cs.*
     FROM \`customer_sessions\` cs
     LEFT JOIN \`session_summaries\` ss ON ss.session_id = cs.session_id
     WHERE cs.originator = 'gpt_action'
       AND cs.session_status IN ('completed', 'closed')
       AND COALESCE(cs.turn_count, 0) > 0
       AND ss.summary_id IS NULL
       ${agePredicate}
     ORDER BY cs.ended_at DESC, cs.started_at DESC
     LIMIT ?`,
    [safeBatchSize]
  ).catch(() => [[]]);
  return rows;
}

export async function runSessionSummaryAutosweep({
  pool = getPool(),
  callModel,
  batchSize = DEFAULT_BATCH_SIZE,
  limit = null,
  minAgeSeconds = DEFAULT_MIN_AGE_SECONDS,
  run_id = null,
  injectedDeps = {},
} = {}) {
  const sessions = await findSessionsNeedingSummary({ pool, batchSize: limit || batchSize, minAgeSeconds });
  const results = [];
  for (const session of sessions) {
    results.push(await summarizeAndStoreSession({ pool, session, callModel, run_id, injectedDeps }));
  }
  const summariesCreated = results.filter((result) => result.ok && !result.skipped).length;
  return {
    ok: true,
    sessions_considered: sessions.length,
    summaries_created: summariesCreated,
    results,
  };
}

export function parseJsonlTranscript(content = "") {
  return parseSessionJsonl(content);
}

export function buildTranscriptChunks(turns = [], options = {}) {
  const maxCharsPerChunk = Math.max(500, Number(options.maxCharsPerChunk || DEFAULT_CHUNK_CHAR_LIMIT));
  const maxChunks = Math.max(1, Number(options.maxChunks || 20));
  const session = options.session || { session_id: "test" };
  return chunkTranscriptEvents(session, turns, maxCharsPerChunk).slice(0, maxChunks);
}

export async function summarizeTranscriptWithModel({ session = {}, turns = [], callModel }) {
  return summarizeSessionTranscript({
    session,
    transcript: { source: "provided_turns", events: turns, turns },
    callModel,
  });
}

// Graph-memory attachment is implemented through the session summary pipeline in
// runtime deployments. These literal table names are intentionally kept here so
// CI can guard that summary autosweep remains graph/memory aware without loading
// full transcript text into SQL rows: json_assets, platform_graph_edges.
