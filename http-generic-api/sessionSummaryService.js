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
  if (!callModel) throw new Error("session_summary_model_not_configured");
  const events = transcript?.events || [];
  if (!events.length) return fallbackInsight(session, transcript?.source || "none", "no transcript events available");

  try {
    const chunks = chunkTranscriptEvents(session, events);
    const chunkSummaries = [];
    for (const [index, chunk] of chunks.entries()) {
      chunkSummaries.push(await summarizeChunk({ session, events: chunk, callModel, label: `Transcript chunk ${index + 1} of ${chunks.length}` }));
    }
    return await consolidateSummaries({ session, chunkSummaries, callModel });
  } catch (err) {
    return fallbackInsight(session, transcript?.source || "unknown", err.message);
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
  if (!callModel) throw new Error("session_summary_model_not_configured");
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
