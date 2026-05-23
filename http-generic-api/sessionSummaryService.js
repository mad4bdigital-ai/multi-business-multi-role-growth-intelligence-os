import { createHash, randomUUID } from "node:crypto";
import { fetchDriveContent } from "./uploadPipeline.js";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const SUMMARY_VERSION = "2026-05-session-summary-v1";
const DEFAULT_MAX_CHARS_PER_CHUNK = 14000;
const DEFAULT_MAX_CHUNKS = 8;
const SECRET_PATTERNS = [
  /BACKEND_API_KEY\s*[:=]\s*[^\s"']+/gi,
  /JWT_SECRET\s*[:=]\s*[^\s"']+/gi,
  /connector_secret\s*[:=]\s*[^\s"']+/gi,
  /cf_token\s*[:=]\s*[^\s"']+/gi,
  /oauth_client_secret\s*[:=]\s*[^\s"']+/gi,
  /api_key_value\s*[:=]\s*[^\s"']+/gi,
  /(?:sk|ghp|ghs|github_pat)_[A-Za-z0-9_\-]{16,}/g,
  /\b[A-Za-z0-9_\-]{32,}\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}\b/g,
];

function normalize(value = "") {
  return String(value ?? "").trim();
}

function safeJson(value) {
  try { return value == null ? null : JSON.stringify(value); } catch { return JSON.stringify({ serialization_error: true }); }
}

function parseMaybeJson(value, fallback = null) {
  try {
    if (value == null || value === "") return fallback;
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

function sha256(value = "") {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function idPart(value = "") {
  return normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 180) || "unknown";
}

function nodeId(type, value) {
  return `${idPart(type)}.${idPart(value)}`.slice(0, 255);
}

function edgeId(source, edgeType, target, pk = "") {
  return `edge.${sha256([source, edgeType, target, pk].join("|")).slice(0, 32)}`;
}

function shortId(prefix, value) {
  return `${prefix}_${sha256(value).slice(0, 40)}`.slice(0, 64);
}

function redactSecrets(text = "") {
  let out = String(text ?? "");
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[REDACTED_SECRET]");
  return out;
}

function compactText(value = "", limit = 1200) {
  const text = redactSecrets(value).replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...[truncated]`;
}

function toArray(value) {
  if (Array.isArray(value)) return value.map((item) => compactText(item, 240)).filter(Boolean).slice(0, 8);
  const parsed = parseMaybeJson(value, null);
  if (Array.isArray(parsed)) return toArray(parsed);
  if (!value) return [];
  return String(value).split(/[;\n]+/).map((item) => compactText(item, 240)).filter(Boolean).slice(0, 8);
}

export function parseJsonlTranscript(raw = "") {
  const turns = [];
  const lines = String(raw || "").split(/\r?\n/).filter((line) => line.trim());
  for (const line of lines) {
    const parsed = parseMaybeJson(line, null);
    if (!parsed || typeof parsed !== "object") continue;
    const role = normalize(parsed.role || parsed.event_type || "unknown").toLowerCase();
    const content = normalize(parsed.content || parsed.text || parsed.message || "");
    if (!content) continue;
    turns.push({
      session_id: parsed.session_id || null,
      turn_id: parsed.turn_id || null,
      turn_index: Number.isFinite(Number(parsed.turn_index)) ? Number(parsed.turn_index) : turns.length,
      role: ["user", "assistant", "tool", "system"].includes(role) ? role : "unknown",
      action_key: parsed.action_key || null,
      content: redactSecrets(content),
      content_sha256: parsed.content_sha256 || sha256(content),
      created_at: parsed.created_at || null,
      source: "drive_jsonl",
    });
  }
  return turns.sort((a, b) => Number(a.turn_index || 0) - Number(b.turn_index || 0));
}

export function buildTranscriptChunks(turns = [], { maxCharsPerChunk = DEFAULT_MAX_CHARS_PER_CHUNK, maxChunks = DEFAULT_MAX_CHUNKS } = {}) {
  const chunks = [];
  let current = "";
  for (const turn of turns) {
    const line = `[${turn.turn_index ?? "?"}] ${String(turn.role || "unknown").toUpperCase()}${turn.action_key ? ` action=${turn.action_key}` : ""}: ${compactText(turn.content, 1800)}\n`;
    if (current && current.length + line.length > maxCharsPerChunk) {
      chunks.push(current.trim());
      current = "";
      if (chunks.length >= maxChunks) break;
    }
    current += line;
  }
  if (current && chunks.length < maxChunks) chunks.push(current.trim());
  return chunks;
}

function extractModelText(response) {
  if (!response) return "";
  if (typeof response === "string") return response;
  if (typeof response.content === "string") return response.content;
  if (Array.isArray(response.content)) {
    return response.content.filter((block) => block?.type === "text" || block?.text).map((block) => block.text || block.content || "").join("\n");
  }
  return String(response.content || response.text || "");
}

function parseInsightJson(text = "") {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  const parsed = parseMaybeJson(match ? match[0] : text, null);
  if (!parsed || typeof parsed !== "object") return null;
  return normalizeInsight(parsed);
}

function normalizeInsight(input = {}) {
  const complexity = ["low", "medium", "high"].includes(String(input.complexity || "").toLowerCase())
    ? String(input.complexity).toLowerCase()
    : "medium";
  const tags = Array.isArray(input.tags)
    ? input.tags.map((tag) => idPart(tag)).filter(Boolean).slice(0, 20)
    : [];
  return {
    summary_text: compactText(input.summary_text || input.summary || "Session summary unavailable.", 1800),
    tasks_completed: toArray(input.tasks_completed),
    blockers: toArray(input.blockers),
    feature_requests: toArray(input.feature_requests),
    integration_needs: toArray(input.integration_needs),
    complexity,
    tags,
  };
}

function deterministicSummary({ session = {}, turns = [], reason = "model_unavailable" } = {}) {
  const actionKeys = [...new Set(turns.map((turn) => normalize(turn.action_key)).filter(Boolean))].slice(0, 12);
  const roles = turns.reduce((acc, turn) => {
    acc[turn.role] = (acc[turn.role] || 0) + 1;
    return acc;
  }, {});
  return normalizeInsight({
    summary_text: `Session ${session.session_id} has ${turns.length || session.turn_count || 0} archived turn(s). Deterministic summary used because ${reason}. ${actionKeys.length ? `Observed action keys: ${actionKeys.join(", ")}.` : "No action-key evidence was available."}`,
    tasks_completed: [],
    blockers: reason === "model_failed" ? ["Model summary failed; summary is deterministic fallback."] : [],
    feature_requests: [],
    integration_needs: [],
    complexity: Number(session.turn_count || turns.length || 0) > 100 ? "high" : "medium",
    tags: ["session_summary", "autosummary", ...actionKeys, ...Object.keys(roles)],
  });
}

const SUMMARY_PROMPT = `You summarize platform GPT sessions for a multi-tenant Growth Intelligence OS.
Return ONLY valid JSON:
{
  "summary_text": "3-6 sentences describing what happened and why it matters",
  "tasks_completed": ["concrete completed work"],
  "blockers": ["current blockers or risks"],
  "feature_requests": ["requested or implied future work"],
  "integration_needs": ["provider/app/data integration needs"],
  "complexity": "low|medium|high",
  "tags": ["short_snake_case_tags"]
}
Rules:
- Do not invent facts.
- Do not include secrets, credentials, tokens, or raw IDs unless they are non-secret public operational IDs.
- Prefer concise operational continuity over narrative detail.
- Mark uncertainty explicitly inside the relevant array item.`;

export async function summarizeTranscriptWithModel({ session = {}, turns = [], callModel, maxChunks = DEFAULT_MAX_CHUNKS } = {}) {
  if (!turns.length) return deterministicSummary({ session, turns, reason: "no_turns" });
  if (!callModel) return deterministicSummary({ session, turns, reason: "model_unavailable" });

  const chunks = buildTranscriptChunks(turns, { maxChunks });
  try {
    const chunkInsights = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const response = await callModel([
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: `Session: ${session.session_id}\nTenant: ${session.tenant_id || PLATFORM_TENANT_ID}\nUser: ${session.user_id || "platform_admin"}\nChunk ${i + 1}/${chunks.length}\n\n${chunks[i]}` },
      ], []);
      const parsed = parseInsightJson(extractModelText(response));
      chunkInsights.push(parsed || deterministicSummary({ session, turns, reason: "chunk_parse_failed" }));
    }

    if (chunkInsights.length === 1) return chunkInsights[0];

    const response = await callModel([
      { role: "system", content: SUMMARY_PROMPT },
      { role: "user", content: `Consolidate these chunk summaries into one final session summary.\n\n${JSON.stringify(chunkInsights, null, 2)}` },
    ], []);
    return parseInsightJson(extractModelText(response)) || deterministicSummary({ session, turns, reason: "final_parse_failed" });
  } catch {
    return deterministicSummary({ session, turns, reason: "model_failed" });
  }
}

export async function ensureSessionSummaryAutosweepSchema(pool) {
  const statements = [
    "ALTER TABLE `session_summaries` ADD COLUMN IF NOT EXISTS `tags_json` JSON NULL AFTER `integration_needs`",
    "ALTER TABLE `session_summaries` ADD COLUMN IF NOT EXISTS `summary_sha256` VARCHAR(64) NULL AFTER `summary_text`",
    "ALTER TABLE `session_summaries` ADD COLUMN IF NOT EXISTS `summary_version` VARCHAR(64) NULL AFTER `session_model`",
    "ALTER TABLE `session_summaries` ADD COLUMN IF NOT EXISTS `summary_status` VARCHAR(64) NOT NULL DEFAULT 'ready' AFTER `summary_version`",
    "ALTER TABLE `session_summaries` ADD COLUMN IF NOT EXISTS `summary_source` VARCHAR(64) NULL AFTER `summary_status`",
    "ALTER TABLE `session_summaries` ADD COLUMN IF NOT EXISTS `source_turn_count` INT NULL AFTER `turn_count`",
    "ALTER TABLE `session_summaries` ADD COLUMN IF NOT EXISTS `source_last_turn_at` DATETIME NULL AFTER `source_turn_count`",
    "ALTER TABLE `session_summaries` ADD COLUMN IF NOT EXISTS `source_drive_jsonl_id` VARCHAR(255) NULL AFTER `source_last_turn_at`",
    "ALTER TABLE `session_summaries` ADD COLUMN IF NOT EXISTS `source_drive_doc_id` VARCHAR(255) NULL AFTER `source_drive_jsonl_id`",
    "ALTER TABLE `session_summaries` ADD INDEX IF NOT EXISTS `idx_session_summaries_source_turns` (`session_id`, `source_turn_count`, `created_at`)",
  ];
  for (const sql of statements) await pool.query(sql).catch(() => {});
}

async function loadSqlTurnPreviews(pool, sessionId, limit = 400) {
  const [rows] = await pool.query(
    `SELECT turn_id, turn_index, role, action_key, content_preview, content_sha256, created_at
       FROM \`gpt_session_turns\`
      WHERE session_id = ?
      ORDER BY turn_index ASC
      LIMIT ?`,
    [sessionId, Math.max(1, Math.min(Number(limit) || 400, 2000))]
  );
  return rows.map((row, idx) => ({
    session_id: sessionId,
    turn_id: row.turn_id,
    turn_index: Number(row.turn_index ?? idx),
    role: row.role || "unknown",
    action_key: row.action_key || null,
    content: row.content_preview || "",
    content_sha256: row.content_sha256 || null,
    created_at: row.created_at || null,
    source: "sql_preview",
  })).filter((turn) => turn.content);
}

export async function loadSessionTranscript({ pool, session = {}, fetchDriveContentFn = fetchDriveContent, sqlPreviewLimit = 400 } = {}) {
  let turns = [];
  let source = "none";
  let drive_error = null;
  if (session.drive_jsonl_id) {
    try {
      const raw = await fetchDriveContentFn(session.drive_jsonl_id);
      turns = parseJsonlTranscript(raw);
      if (turns.length) source = "drive_jsonl";
    } catch (err) {
      drive_error = { code: err.code || "drive_jsonl_read_failed", message: err.message };
    }
  }
  if (!turns.length) {
    turns = await loadSqlTurnPreviews(pool, session.session_id, sqlPreviewLimit);
    if (turns.length) source = "sql_preview";
  }
  const lastTurnAt = turns.map((turn) => turn.created_at).filter(Boolean).sort().at(-1) || null;
  return {
    turns,
    source,
    turn_count: turns.length,
    source_last_turn_at: lastTurnAt,
    drive_error,
    secrets_included: false,
  };
}

async function latestSummaryForSession(pool, sessionId) {
  const [rows] = await pool.query(
    `SELECT summary_id, source_turn_count, summary_sha256, created_at
       FROM \`session_summaries\`
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [sessionId]
  ).catch(() => [[]]);
  return rows[0] || null;
}

export async function findSessionsNeedingSummary(pool, { limit = 20, minTurnCount = 1, activeTurnThreshold = 80, includeActiveLong = false, minNewTurns = 10 } = {}) {
  await ensureSessionSummaryAutosweepSchema(pool);
  const statuses = includeActiveLong ? ["completed", "active"] : ["completed"];
  const [rows] = await pool.query(
    `SELECT cs.session_id, cs.tenant_id, cs.user_id, cs.workspace_key, cs.model_name, cs.git_branch,
            cs.turn_count, cs.session_status, cs.drive_jsonl_id, cs.drive_doc_id, cs.drive_jsonl_url, cs.drive_doc_url,
            cs.archive_status, cs.archive_last_written_at, cs.started_at, cs.ended_at,
            latest.summary_id AS latest_summary_id,
            COALESCE(latest.source_turn_count, 0) AS latest_source_turn_count
       FROM \`customer_sessions\` cs
       LEFT JOIN (
         SELECT ss.session_id, ss.summary_id, ss.source_turn_count, ss.created_at
           FROM \`session_summaries\` ss
           JOIN (
             SELECT session_id, MAX(created_at) AS max_created_at
               FROM \`session_summaries\`
              GROUP BY session_id
           ) mx ON mx.session_id = ss.session_id AND mx.max_created_at = ss.created_at
       ) latest ON latest.session_id = cs.session_id
      WHERE cs.originator = 'gpt_action'
        AND cs.session_status IN (?)
        AND cs.turn_count >= ?
        AND (
          latest.summary_id IS NULL
          OR cs.turn_count >= COALESCE(latest.source_turn_count, 0) + ?
        )
        AND (
          cs.session_status = 'completed'
          OR (cs.session_status = 'active' AND cs.turn_count >= ? AND COALESCE(cs.archive_last_written_at, cs.started_at) < DATE_SUB(NOW(), INTERVAL 10 MINUTE))
        )
      ORDER BY COALESCE(cs.ended_at, cs.archive_last_written_at, cs.started_at, cs.created_at) DESC
      LIMIT ?`,
    [statuses, Math.max(1, Number(minTurnCount) || 1), Math.max(1, Number(minNewTurns) || 10), Math.max(1, Number(activeTurnThreshold) || 80), Math.max(1, Math.min(Number(limit) || 20, 100))]
  );
  return rows;
}

async function upsertSummaryGraph(pool, { session = {}, summaryId, insight = {}, summaryHash, transcriptMeta = {} } = {}) {
  const assetId = `session_summary_${summaryId}`.slice(0, 255);
  const assetKey = `session_summary_${idPart(session.session_id)}`.slice(0, 255);
  const payload = {
    status: "validated",
    type: "session_summary",
    session_id: session.session_id,
    tenant_id: session.tenant_id || PLATFORM_TENANT_ID,
    user_id: session.user_id || null,
    summary_id: summaryId,
    summary_text: insight.summary_text,
    tasks_completed: insight.tasks_completed,
    blockers: insight.blockers,
    feature_requests: insight.feature_requests,
    integration_needs: insight.integration_needs,
    complexity: insight.complexity,
    tags: insight.tags,
    source_turn_count: transcriptMeta.turn_count || session.turn_count || 0,
    source: transcriptMeta.source || "unknown",
    summary_sha256: summaryHash,
    secrets_included: false,
  };

  await pool.query(
    `INSERT INTO \`json_assets\`
       (asset_id, brand_name, asset_key, asset_type, mapping_status, mapping_version,
        storage_format, source_mode, source_asset_ref, json_payload, transport_status,
        validation_status, last_validated_at, notes, active_status)
     VALUES (?, 'platform', ?, 'session_summary', 'mapped', ?, 'json', 'session_summary_autosweep', ?, ?, 'available', 'validated', NOW(), 'Summary-only GPT session memory asset. Full transcript remains in Drive.', 'active')
     ON DUPLICATE KEY UPDATE asset_key=VALUES(asset_key), asset_type=VALUES(asset_type), json_payload=VALUES(json_payload), validation_status='validated', notes=VALUES(notes), active_status='active', updated_at=CURRENT_TIMESTAMP`,
    [assetId, assetKey, SUMMARY_VERSION, session.session_id, safeJson(payload)]
  ).catch(() => {});

  const links = [
    { subject_type: "conversation", subject_ref: `gpt_session:${session.session_id}`, subject_key: `gpt_session.${session.session_id}`, scope_label: "session_summary" },
  ];
  if (session.tenant_id) links.push({ subject_type: "tenant", subject_ref: session.tenant_id, subject_key: `tenant.${session.tenant_id}`, tenant_id: session.tenant_id, scope_label: "session_summary" });
  if (session.user_id) links.push({ subject_type: "user", subject_ref: session.user_id, subject_key: `user.${session.user_id}`, tenant_id: session.tenant_id || null, user_id: session.user_id, scope_label: "session_summary" });

  for (const link of links) {
    await pool.query(
      `INSERT INTO \`json_asset_subject_links\`
         (link_id, asset_id, asset_key, subject_type, subject_ref, tenant_id, user_id, subject_key, linkage_type, scope_label, metadata_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scope_attachment', ?, ?, 'active')
       ON DUPLICATE KEY UPDATE asset_key=VALUES(asset_key), tenant_id=VALUES(tenant_id), user_id=VALUES(user_id), subject_key=VALUES(subject_key), scope_label=VALUES(scope_label), metadata_json=VALUES(metadata_json), status='active', updated_at=CURRENT_TIMESTAMP`,
      [
        shortId("lnk", `${assetId}|${link.subject_type}|${link.subject_ref}`),
        assetId,
        assetKey,
        link.subject_type,
        link.subject_ref,
        link.tenant_id || null,
        link.user_id || null,
        link.subject_key,
        link.scope_label,
        safeJson({ usage: "conversation_memory", summary_id: summaryId, summary_sha256: summaryHash, secrets_included: false }),
      ]
    ).catch(() => {});
  }

  const assetNode = nodeId("json_asset", assetId);
  const convNode = nodeId("conversation", `gpt_session:${session.session_id}`);
  const nodes = [
    { node_id: assetNode, node_type: "json_asset", node_label: assetKey, scope_type: "conversation", subject_ref: assetId, source_table: "json_assets", source_pk: assetId, authority_status: "authoritative", lifecycle_status: "active", visibility_scope: "platform_admin", sensitivity: "tenant_private", evidence_level: "declared", runtime_role: "resolver_input", source_system: "sql", metadata_json: safeJson({ asset_key: assetKey, asset_type: "session_summary", summary_id: summaryId }) },
    { node_id: convNode, node_type: "conversation", node_label: session.session_id, scope_type: "conversation", subject_ref: `gpt_session:${session.session_id}`, source_table: "customer_sessions", source_pk: session.session_id, authority_status: "authoritative", lifecycle_status: "active", visibility_scope: "platform_admin", sensitivity: "tenant_private", evidence_level: "declared", runtime_role: "resolver_input", source_system: "sql", metadata_json: safeJson({ tenant_id: session.tenant_id || null, user_id: session.user_id || null }) },
  ];
  if (session.tenant_id) nodes.push({ node_id: nodeId("tenant", session.tenant_id), node_type: "tenant", node_label: session.tenant_id, scope_type: "tenant", subject_ref: session.tenant_id, source_table: "customer_sessions", source_pk: session.session_id, authority_status: "candidate", lifecycle_status: "active", visibility_scope: "platform_admin", sensitivity: "tenant_private", evidence_level: "declared", runtime_role: "resolver_input", source_system: "sql", metadata_json: safeJson({ via: "session_summary" }) });
  if (session.user_id) nodes.push({ node_id: nodeId("user", session.user_id), node_type: "user", node_label: session.user_id, scope_type: "user", subject_ref: session.user_id, source_table: "customer_sessions", source_pk: session.session_id, authority_status: "candidate", lifecycle_status: "active", visibility_scope: "platform_admin", sensitivity: "user_private", evidence_level: "declared", runtime_role: "resolver_input", source_system: "sql", metadata_json: safeJson({ via: "session_summary" }) });

  for (const n of nodes) {
    await pool.query(
      `INSERT INTO platform_graph_nodes (node_id,node_type,node_label,scope_type,subject_ref,source_table,source_pk,authority_status,lifecycle_status,visibility_scope,sensitivity,evidence_level,runtime_role,source_system,metadata_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE node_label=VALUES(node_label), scope_type=VALUES(scope_type), subject_ref=VALUES(subject_ref), source_table=VALUES(source_table), source_pk=VALUES(source_pk), authority_status=VALUES(authority_status), lifecycle_status=VALUES(lifecycle_status), sensitivity=VALUES(sensitivity), runtime_role=VALUES(runtime_role), metadata_json=VALUES(metadata_json), updated_at=CURRENT_TIMESTAMP`,
      [n.node_id, n.node_type, n.node_label, n.scope_type, n.subject_ref, n.source_table, n.source_pk, n.authority_status, n.lifecycle_status, n.visibility_scope, n.sensitivity, n.evidence_level, n.runtime_role, n.source_system, n.metadata_json]
    ).catch(() => {});
  }

  const targets = [convNode];
  if (session.tenant_id) targets.push(nodeId("tenant", session.tenant_id));
  if (session.user_id) targets.push(nodeId("user", session.user_id));
  for (const target of targets) {
    await pool.query(
      `INSERT INTO platform_graph_edges (edge_id, source_node_id, edge_type, target_node_id, scope_type, authority_status, lifecycle_status, visibility_scope, sensitivity, evidence_level, runtime_role, runtime_enforced, source_table, source_pk, metadata_json)
       VALUES (?, ?, 'attached_to', ?, 'conversation', 'authoritative', 'active', 'platform_admin', 'tenant_private', 'declared', 'resolver_input', 1, 'session_summaries', ?, ?)
       ON DUPLICATE KEY UPDATE lifecycle_status='active', runtime_role='resolver_input', runtime_enforced=1, metadata_json=VALUES(metadata_json), updated_at=CURRENT_TIMESTAMP`,
      [edgeId(assetNode, "attached_to", target, summaryId), assetNode, target, summaryId, safeJson({ summary_id: summaryId, usage: "conversation_memory", secrets_included: false })]
    ).catch(() => {});
  }

  return { asset_id: assetId, asset_key: assetKey, graph_node_id: assetNode };
}

export async function writeSessionSummary({ pool, session = {}, insight = {}, transcriptMeta = {}, runId = null, summarySource = "autosweep", force = false } = {}) {
  await ensureSessionSummaryAutosweepSchema(pool);
  const normalized = normalizeInsight(insight);
  const summaryHash = sha256(JSON.stringify({
    summary_text: normalized.summary_text,
    tasks_completed: normalized.tasks_completed,
    blockers: normalized.blockers,
    feature_requests: normalized.feature_requests,
    integration_needs: normalized.integration_needs,
    tags: normalized.tags,
    source_turn_count: transcriptMeta.turn_count || session.turn_count || 0,
  }));
  const latest = await latestSummaryForSession(pool, session.session_id);
  if (!force && latest?.summary_sha256 === summaryHash) {
    return { ok: true, skipped: true, reason: "summary_hash_unchanged", summary_id: latest.summary_id };
  }

  const summaryId = randomUUID();
  await pool.query(
    `INSERT INTO \`session_summaries\`
       (summary_id, session_id, tenant_id, user_id, workspace_key, summary_text, summary_sha256,
        tasks_completed, blockers, feature_requests, integration_needs, tags_json, complexity,
        session_model, summary_version, summary_status, summary_source, turn_count,
        source_turn_count, source_last_turn_at, source_drive_jsonl_id, source_drive_doc_id,
        analyzed, dev_agent_run_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, 0, ?, NOW())`,
    [
      summaryId,
      session.session_id,
      session.tenant_id || PLATFORM_TENANT_ID,
      session.user_id || null,
      session.workspace_key || null,
      normalized.summary_text,
      summaryHash,
      safeJson(normalized.tasks_completed),
      safeJson(normalized.blockers),
      safeJson(normalized.feature_requests),
      safeJson(normalized.integration_needs),
      safeJson(normalized.tags),
      normalized.complexity,
      session.model_name || null,
      SUMMARY_VERSION,
      summarySource,
      session.turn_count || transcriptMeta.turn_count || 0,
      transcriptMeta.turn_count || session.turn_count || 0,
      transcriptMeta.source_last_turn_at || null,
      session.drive_jsonl_id || null,
      session.drive_doc_id || null,
      runId,
    ]
  );

  const graph = await upsertSummaryGraph(pool, { session, summaryId, insight: normalized, summaryHash, transcriptMeta });
  return { ok: true, skipped: false, summary_id: summaryId, summary_sha256: summaryHash, graph };
}

export async function summarizeSessionIfNeeded({ pool, session = {}, callModel = null, force = false, runId = null, fetchDriveContentFn = fetchDriveContent } = {}) {
  if (!session?.session_id) return { ok: false, skipped: true, reason: "missing_session" };
  await ensureSessionSummaryAutosweepSchema(pool);
  const latest = await latestSummaryForSession(pool, session.session_id);
  if (!force && latest && Number(latest.source_turn_count || 0) >= Number(session.turn_count || 0)) {
    return { ok: true, skipped: true, reason: "summary_current", summary_id: latest.summary_id };
  }
  const transcript = await loadSessionTranscript({ pool, session, fetchDriveContentFn });
  const insight = await summarizeTranscriptWithModel({ session, turns: transcript.turns, callModel });
  const write = await writeSessionSummary({ pool, session, insight, transcriptMeta: transcript, runId, summarySource: callModel ? "autosweep_model" : "autosweep_deterministic", force });
  return { ok: true, session_id: session.session_id, transcript: { source: transcript.source, turn_count: transcript.turn_count, drive_error: transcript.drive_error, secrets_included: false }, ...write };
}

export async function writeProvidedSessionSummary({ pool, session = {}, summaryText = "", runId = null } = {}) {
  const insight = normalizeInsight({
    summary_text: summaryText,
    tasks_completed: [],
    blockers: [],
    feature_requests: [],
    integration_needs: [],
    complexity: "medium",
    tags: ["manual_summary", "session_summary"],
  });
  const transcript = await loadSessionTranscript({ pool, session });
  return writeSessionSummary({ pool, session, insight, transcriptMeta: transcript, runId, summarySource: "manual_end_session", force: true });
}

export async function runSessionSummaryAutosweep({ pool, callModel = null, limit = 20, minTurnCount = 1, includeActiveLong = false, activeTurnThreshold = 80, minNewTurns = 10, fetchDriveContentFn = fetchDriveContent } = {}) {
  const sessions = await findSessionsNeedingSummary(pool, { limit, minTurnCount, includeActiveLong, activeTurnThreshold, minNewTurns });
  const results = [];
  for (const session of sessions) {
    try {
      results.push(await summarizeSessionIfNeeded({ pool, session, callModel, fetchDriveContentFn }));
    } catch (err) {
      results.push({ ok: false, session_id: session.session_id, error: { code: err.code || "summary_failed", message: err.message } });
    }
  }
  const created = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;
  return { ok: failed === 0, scanned_sessions: sessions.length, summaries_created: created, skipped, failed, results };
}
