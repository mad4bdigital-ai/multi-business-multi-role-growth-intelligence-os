import { createHash, randomUUID } from "node:crypto";
import {
  appendTextToGoogleDoc,
  createGoogleDocFromTextInDrive,
  createGoogleDocInDrive,
  fetchDriveContent,
  getOrCreateDriveFolder,
  updateDriveFileContent,
  uploadContentToDrive,
} from "./uploadPipeline.js";

const PREVIEW_CHARS = 512;
const TOOL_DOC_SECTION_PREVIEW_CHARS = 900;
const DEFAULT_DOC_ROLLOVER_CHARS = 450000;
const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_SESSIONS_DRIVE_FOLDER_ID = "1TIxUmnh0RrLCfXYfkjf96EwGc8OYnEw1";

function positiveInt(value, fallback = 1) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function defaultDeps() {
  return {
    getOrCreateDriveFolder,
    createGoogleDocFromTextInDrive,
    createGoogleDocInDrive,
    appendTextToGoogleDoc,
    uploadContentToDrive,
    fetchDriveContent,
    updateDriveFileContent,
    sessionsDriveFolderId:
      process.env.SESSIONS_DRIVE_FOLDER_ID ||
      DEFAULT_SESSIONS_DRIVE_FOLDER_ID ||
      process.env.UPLOADS_DRIVE_FOLDER_ID ||
      process.env.OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID ||
      "",
    subfolderHint: "",
    docRolloverChars: positiveInt(process.env.SESSION_ARCHIVE_DOC_ROLLOVER_CHARS, DEFAULT_DOC_ROLLOVER_CHARS),
    now: () => new Date(),
  };
}

export function sha256(value = "") {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function previewText(value = "", limit = PREVIEW_CHARS) {
  const text = String(value || "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...[truncated]`;
}

function contextKey(value) {
  const text = String(value || "").trim();
  return text || null;
}

async function resolveInheritedBusinessContext({
  pool,
  brand_key = null,
  business_type_key = null,
  business_activity_type_key = null,
  activity_key = null,
  knowledge_profile_key = null,
} = {}) {
  const explicitBusinessTypeKey = contextKey(business_type_key);
  const explicitBusinessActivityTypeKey = contextKey(business_activity_type_key);
  const explicitActivityKey = contextKey(activity_key);
  const explicitKnowledgeProfileKey = contextKey(knowledge_profile_key);
  const brandKey = contextKey(brand_key);
  let brandPath = null;
  let activity = null;
  let businessTypeProfile = null;

  if (brandKey) {
    const [rows] = await pool.query(
      `SELECT brand_key, business_type_key, knowledge_profile_key
         FROM \`brand_paths\`
        WHERE brand_key = ?
          AND (active IS NULL OR active IN ('1', 'true', 'yes', 'active'))
        ORDER BY updated_at DESC, id DESC
        LIMIT 1`,
      [brandKey]
    ).catch(() => [[]]);
    brandPath = rows?.[0] || null;
  }

  if (explicitBusinessActivityTypeKey || explicitActivityKey) {
    const clauses = [];
    const params = [];
    if (explicitBusinessActivityTypeKey) { clauses.push("business_activity_type_key = ?"); params.push(explicitBusinessActivityTypeKey); }
    if (explicitActivityKey) { clauses.push("activity_key = ?"); params.push(explicitActivityKey); }
    const [rows] = await pool.query(
      `SELECT business_activity_type_key, activity_key, business_type_key, default_knowledge_profile_key, brand_core_required
         FROM \`business_activity_types\`
        WHERE (${clauses.join(" OR ")})
          AND (active IS NULL OR active IN ('1', 'true', 'yes', 'active'))
        ORDER BY updated_at DESC, id DESC
        LIMIT 1`,
      params
    ).catch(() => [[]]);
    activity = rows?.[0] || null;
  }

  const resolvedBusinessTypeKey = explicitBusinessTypeKey
    || contextKey(activity?.business_type_key)
    || contextKey(brandPath?.business_type_key);
  const resolvedKnowledgeProfileKey = explicitKnowledgeProfileKey
    || contextKey(activity?.default_knowledge_profile_key)
    || contextKey(brandPath?.knowledge_profile_key);

  if (resolvedBusinessTypeKey) {
    const [rows] = await pool.query(
      `SELECT business_type_key, knowledge_profile_key, authoritative_read_home,
              business_type_specific_read_home, shared_knowledge_read_home
         FROM \`business_type_profiles\`
        WHERE business_type_key = ?
          AND (active IS NULL OR active IN ('1', 'true', 'yes', 'active'))
        ORDER BY updated_at DESC, id DESC
        LIMIT 1`,
      [resolvedBusinessTypeKey]
    ).catch(() => [[]]);
    businessTypeProfile = rows?.[0] || null;
  }

  const finalKnowledgeProfileKey = resolvedKnowledgeProfileKey
    || contextKey(businessTypeProfile?.knowledge_profile_key);
  return {
    business_type_key: resolvedBusinessTypeKey || null,
    business_activity_type_key: explicitBusinessActivityTypeKey || contextKey(activity?.business_activity_type_key),
    activity_key: explicitActivityKey || contextKey(activity?.activity_key),
    knowledge_profile_key: finalKnowledgeProfileKey || null,
    inherited_from_brand: Boolean(brandPath?.business_type_key || brandPath?.knowledge_profile_key),
    brand_core_required: contextKey(activity?.brand_core_required) || null,
    knowledge_architecture: {
      authoritative_read_home: contextKey(businessTypeProfile?.authoritative_read_home),
      business_type_specific_read_home: contextKey(businessTypeProfile?.business_type_specific_read_home),
      shared_knowledge_read_home: contextKey(businessTypeProfile?.shared_knowledge_read_home),
      source_tables: ["brand_paths", "business_activity_types", "business_type_profiles"],
      secrets_included: false,
    },
    lifecycle_contract: "brand_business_context_is_required_for_operation_resolution_like_brand_core",
    secrets_included: false,
  };
}

function slug(value, fallback) {
  return String(value || fallback)
    .trim()
    .replace(/[^a-z0-9_.-]/gi, "_")
    .slice(0, 160);
}

export function buildSessionArchivePath(session = {}, now = new Date()) {
  const startedAt = session.started_at ? new Date(session.started_at) : now;
  const validDate = Number.isNaN(startedAt.getTime()) ? now : startedAt;
  const iso = validDate.toISOString();
  const tenant = slug(session.tenant_id || PLATFORM_TENANT_ID, PLATFORM_TENANT_ID);
  const userOrMember = session.member_id
    ? `member_${slug(session.member_id, "unknown")}`
    : `user_${slug(session.user_id || "platform_admin", "platform_admin")}`;
  return [
    iso.slice(0, 4),
    iso.slice(5, 7),
    iso.slice(8, 10),
    `tenant_${tenant}`,
    userOrMember,
    `session_${slug(session.session_id, "unknown")}`,
  ];
}

function buildTranscriptHeading(session = {}, now = new Date(), partIndex = 1, extraLines = []) {
  const startedAt = session.started_at ? new Date(session.started_at) : now;
  const validStartedAt = Number.isNaN(startedAt.getTime()) ? now : startedAt;
  return [
    `Session ${session.session_id}`,
    `Transcript Part: ${positiveInt(partIndex, 1)}`,
    `Tenant: ${session.tenant_id || PLATFORM_TENANT_ID}`,
    `User: ${session.user_id || "platform_admin"}`,
    `Started: ${validStartedAt.toISOString()}`,
    ...extraLines.filter(Boolean),
    "",
  ].join("\n");
}

async function updateArchiveStatus(pool, sessionId, status, error = null) {
  await pool.query(
    `UPDATE \`customer_sessions\`
     SET archive_status = ?, archive_last_error = ?, archive_last_written_at = NOW()
     WHERE session_id = ?`,
    [status, error ? String(error).slice(0, 2000) : null, sessionId]
  ).catch(() => {});
}

async function createArchiveFiles(session, deps) {
  let parentId = deps.sessionsDriveFolderId;
  if (!parentId) return null;

  if (deps.subfolderHint) {
    parentId = await deps.getOrCreateDriveFolder(String(deps.subfolderHint), parentId);
  }

  for (const part of buildSessionArchivePath(session, deps.now())) {
    parentId = await deps.getOrCreateDriveFolder(part, parentId);
  }

  const exportsFolderId = await deps.getOrCreateDriveFolder("Exports", parentId);
  await deps.getOrCreateDriveFolder("Artifacts", parentId);

  const initialPart = 1;
  const heading = buildTranscriptHeading(session, deps.now(), initialPart);

  const transcript = await deps.createGoogleDocInDrive("Session Transcript Part 1", parentId, heading);
  const jsonl = await deps.uploadContentToDrive("", "Tool_Calls.jsonl", "application/x-ndjson", null, parentId);

  return {
    drive_folder_id: parentId,
    drive_exports_folder_id: exportsFolderId,
    drive_doc_id: transcript.drive_file_id,
    drive_doc_url: transcript.drive_web_url || null,
    drive_doc_part_index: initialPart,
    drive_doc_part_count: initialPart,
    drive_jsonl_id: jsonl.drive_file_id,
    drive_jsonl_url: jsonl.drive_web_url || null,
  };
}

export async function ensureSessionArchive(pool, session, injectedDeps = {}) {
  const deps = { ...defaultDeps(), ...injectedDeps };
  if (session.drive_folder_id && session.drive_doc_id && session.drive_jsonl_id) {
    return {
      configured: true,
      archive: {
        drive_folder_id: session.drive_folder_id,
        drive_exports_folder_id: session.drive_exports_folder_id || null,
        drive_doc_id: session.drive_doc_id,
        drive_doc_url: session.drive_doc_url || null,
        drive_doc_part_index: positiveInt(session.drive_doc_part_index, 1),
        drive_doc_part_count: positiveInt(session.drive_doc_part_count || session.drive_doc_part_index, 1),
        drive_jsonl_id: session.drive_jsonl_id,
        drive_jsonl_url: session.drive_jsonl_url || null,
      },
    };
  }

  const archive = await createArchiveFiles(session, deps);
  if (!archive) {
    await updateArchiveStatus(pool, session.session_id, "not_configured");
    return { configured: false, archive: null };
  }

  await pool.query(
    `UPDATE \`customer_sessions\`
     SET drive_folder_id = ?, drive_doc_id = ?, drive_doc_url = ?,
         drive_doc_part_index = ?, drive_doc_part_count = ?,
         drive_jsonl_id = ?, drive_jsonl_url = ?, drive_exports_folder_id = ?,
         archive_status = 'ready', archive_last_error = NULL, archive_last_written_at = NOW()
     WHERE session_id = ?`,
    [
      archive.drive_folder_id,
      archive.drive_doc_id,
      archive.drive_doc_url,
      archive.drive_doc_part_index,
      archive.drive_doc_part_count,
      archive.drive_jsonl_id,
      archive.drive_jsonl_url,
      archive.drive_exports_folder_id,
      session.session_id,
    ]
  );

  return { configured: true, archive };
}

async function updateCurrentTranscriptDocPointer(pool, sessionId, archive) {
  await pool.query(
    `UPDATE \`customer_sessions\`
     SET drive_doc_id = ?, drive_doc_url = ?, drive_doc_part_index = ?,
         drive_doc_part_count = ?, archive_last_written_at = NOW()
     WHERE session_id = ?`,
    [
      archive.drive_doc_id,
      archive.drive_doc_url || null,
      archive.drive_doc_part_index,
      archive.drive_doc_part_count,
      sessionId,
    ]
  );
}

async function maybeRolloverTranscriptDoc({ pool, session, archive, deps, sectionText, timestamp }) {
  if (!archive?.drive_doc_id || !archive?.drive_folder_id) return archive;
  const threshold = positiveInt(session.drive_doc_rollover_threshold_chars || deps.docRolloverChars, DEFAULT_DOC_ROLLOVER_CHARS);
  if (!threshold) return archive;

  let currentDocText = "";
  try {
    currentDocText = await deps.fetchDriveContent(archive.drive_doc_id);
  } catch {
    return archive;
  }
  if (String(currentDocText || "").length + String(sectionText || "").length <= threshold) {
    return archive;
  }

  const currentPart = positiveInt(archive.drive_doc_part_index || session.drive_doc_part_index, 1);
  const nextPart = currentPart + 1;
  const partCount = Math.max(positiveInt(archive.drive_doc_part_count || session.drive_doc_part_count, currentPart), nextPart);
  const heading = buildTranscriptHeading(session, deps.now(), nextPart, [
    `Continuation: true`,
    `Previous Google Doc ID: ${archive.drive_doc_id}`,
    `Rollover at: ${timestamp || deps.now().toISOString()}`,
  ]);
  const nextDoc = await deps.createGoogleDocInDrive(`Session Transcript Part ${nextPart}`, archive.drive_folder_id, heading);
  const nextArchive = {
    ...archive,
    drive_doc_id: nextDoc.drive_file_id,
    drive_doc_url: nextDoc.drive_web_url || null,
    drive_doc_part_index: nextPart,
    drive_doc_part_count: partCount,
  };
  await updateCurrentTranscriptDocPointer(pool, session.session_id, nextArchive);
  return nextArchive;
}

async function appendJsonlLine(archive, line, deps) {
  if (!archive?.drive_jsonl_id) return;
  const current = await deps.fetchDriveContent(archive.drive_jsonl_id).catch(() => "");
  const next = `${String(current || "").replace(/\s*$/, "")}${current ? "\n" : ""}${line}\n`;
  await deps.updateDriveFileContent(archive.drive_jsonl_id, next, "application/x-ndjson");
}

function previewDocSection(value = "", limit = TOOL_DOC_SECTION_PREVIEW_CHARS) {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...[truncated; full content in JSONL sidecar]`;
}

function extractArchiveSection(text = "", sectionName = "") {
  const marker = `${sectionName}:\n`;
  const start = String(text || "").indexOf(marker);
  if (start === -1) return "";
  const bodyStart = start + marker.length;
  const tail = String(text || "").slice(bodyStart);
  const next = tail.search(/\n\n(?:Args|Result):\n/);
  return (next === -1 ? tail : tail.slice(0, next)).trim();
}

function firstPrefixedLine(text = "", prefix = "") {
  return String(text || "")
    .split(/\r?\n/)
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
    .trim() || "";
}

function buildToolCallDocSummary({ content, actionKey, contentHash }) {
  const text = String(content || "");
  const toolName = firstPrefixedLine(text, "Tool:") || actionKey || "unknown";
  const status = firstPrefixedLine(text, "Status:") || "unknown";
  const argsPreview = previewDocSection(extractArchiveSection(text, "Args"));
  const resultPreview = previewDocSection(extractArchiveSection(text, "Result"));
  return [
    "### Tool Call Summary",
    "",
    `Tool: ${toolName}`,
    `Action key: ${actionKey || toolName}`,
    `Status: ${status}`,
    "Full content: JSONL sidecar",
    `Content SHA256: ${contentHash}`,
    "",
    argsPreview ? "Args preview:" : null,
    argsPreview ? "```json" : null,
    argsPreview || null,
    argsPreview ? "```" : null,
    argsPreview ? "" : null,
    resultPreview ? "Result preview:" : null,
    resultPreview ? "```json" : null,
    resultPreview || null,
    resultPreview ? "```" : null,
    "",
  ].filter((line) => line !== null).join("\n");
}

function buildDocContentForTurn({ role, content, actionKey, contentHash }) {
  if (role === "tool") return buildToolCallDocSummary({ content, actionKey, contentHash });
  return String(content || "");
}

function docContentModeForRole(role) {
  return role === "tool" ? "summary_only" : "full_turn_text";
}

function buildRuntimeEvent({
  eventId,
  sessionId,
  turnId,
  turnIndex,
  role,
  actionKey,
  contentHash,
  content,
  timestamp,
  includeContent = false,
  bookmark = null,
  docContentMode = null,
  fullContentStorage = null,
  driveDocId = null,
  driveDocPart = null,
}) {
  return {
    event_id: eventId,
    session_id: sessionId,
    turn_id: turnId,
    turn_index: turnIndex,
    event_type: role,
    role,
    action_key: actionKey,
    content_sha256: contentHash,
    ...(bookmark ? { bookmark } : {}),
    ...(docContentMode ? { doc_content_mode: docContentMode } : {}),
    ...(fullContentStorage ? { full_content_storage: fullContentStorage } : {}),
    ...(driveDocId ? { drive_doc_id: driveDocId } : {}),
    ...(driveDocPart ? { drive_doc_part: driveDocPart } : {}),
    ...(includeContent ? { content } : {}),
    created_at: timestamp,
  };
}

function buildTranscriptSection({ role, content, turnIndex, timestamp, runtimeEvent }) {
  const bookmark = runtimeEvent?.bookmark || `turn-${turnIndex}`;
  return [
    "",
    `## Turn ${turnIndex} - ${String(role).toUpperCase()} - ${timestamp}`,
    "",
    `Bookmark: ${bookmark}`,
    "",
    String(content || ""),
    "",
    "### Runtime Event",
    "",
    "```json",
    JSON.stringify(runtimeEvent, null, 2),
    "```",
    "",
  ].join("\n");
}

function parseJsonlRecords(text = "") {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function renderTranscriptTextFromJsonl(session = {}, jsonlText = "") {
  const records = parseJsonlRecords(jsonlText);
  const heading = [
    `Session ${session.session_id}`,
    `Tenant: ${session.tenant_id || PLATFORM_TENANT_ID}`,
    `User: ${session.user_id || "platform_admin"}`,
    `Rebuilt from JSONL: ${new Date().toISOString()}`,
    "",
  ];
  const sections = records.map((record) => {
    const role = record.role || record.event_type || "unknown";
    const content = record.content || "";
    const contentHash = record.content_sha256 || sha256(content);
    const bookmark = `turn-${record.turn_index ?? "unknown"}`;
    return buildTranscriptSection({
      role,
      content: buildDocContentForTurn({ role, content, actionKey: record.action_key || null, contentHash }),
      turnIndex: record.turn_index ?? "unknown",
      timestamp: record.created_at || "unknown",
      runtimeEvent: {
        event_id: record.event_id || null,
        session_id: record.session_id || session.session_id,
        turn_id: record.turn_id || null,
        turn_index: record.turn_index ?? null,
        role,
        action_key: record.action_key || null,
        content_sha256: contentHash,
        bookmark,
        doc_content_mode: docContentModeForRole(role),
        full_content_storage: "jsonl_sidecar",
        rebuilt_from_jsonl: true,
        secrets_included: false,
      },
    });
  });
  return [...heading, ...sections].join("\n");
}

async function rebuildTranscriptDocFromJsonl({ pool, session, archive, deps, timestamp }) {
  if (!archive?.drive_jsonl_id || !archive?.drive_folder_id) return null;
  const jsonlText = await deps.fetchDriveContent(archive.drive_jsonl_id);
  const records = parseJsonlRecords(jsonlText);
  const transcriptText = renderTranscriptTextFromJsonl(session, jsonlText);
  const safeTimestamp = String(timestamp || new Date().toISOString()).replace(/[:.]/g, "-");
  let rebuilt = null;
  let artifactType = "google_doc";
  let rebuildError = null;

  if (deps.createGoogleDocFromTextInDrive) {
    try {
      rebuilt = await deps.createGoogleDocFromTextInDrive(
        `Session Transcript Rebuilt ${safeTimestamp}`,
        archive.drive_folder_id,
        transcriptText
      );
    } catch (err) {
      rebuildError = err;
    }
  }

  if (!rebuilt && deps.uploadContentToDrive) {
    artifactType = "text_snapshot";
    rebuilt = await deps.uploadContentToDrive(
      transcriptText,
      `Session_Transcript_Rebuilt_${safeTimestamp}.txt`,
      "text/plain",
      null,
      archive.drive_folder_id
    );
  }

  if (!rebuilt) {
    if (rebuildError) throw rebuildError;
    return null;
  }

  archive.drive_doc_id = rebuilt.drive_file_id;
  archive.drive_doc_url = rebuilt.drive_web_url || null;
  await pool.query(
    `UPDATE \`customer_sessions\`
     SET drive_doc_id = ?, drive_doc_url = ?, archive_last_written_at = NOW()
     WHERE session_id = ?`,
    [archive.drive_doc_id, archive.drive_doc_url, session.session_id]
  );
  return {
    drive_doc_id: archive.drive_doc_id,
    drive_doc_url: archive.drive_doc_url,
    rebuilt_from_jsonl: true,
    record_count: records.length,
    artifact_type: artifactType,
    google_doc_import_error: rebuildError ? String(rebuildError.message || rebuildError).slice(0, 500) : null,
    secrets_included: false,
  };
}

export async function backfillGptSessionArchiveFromJsonl({ pool, sessionId, injectedDeps = {}, reason = "legacy_tool_only_backfill" }) {
  const deps = { ...defaultDeps(), ...injectedDeps };
  const [[session]] = await pool.query("SELECT * FROM `customer_sessions` WHERE session_id = ? LIMIT 1", [sessionId]);
  if (!session?.session_id) {
    const err = new Error(`GPT session not found: ${sessionId}`);
    err.status = 404;
    err.code = "gpt_session_not_found";
    throw err;
  }
  if (!session.drive_folder_id || !session.drive_jsonl_id) {
    const err = new Error("Session must have drive_folder_id and drive_jsonl_id before JSONL backfill.");
    err.status = 400;
    err.code = "gpt_session_archive_backfill_missing_drive_artifacts";
    err.details = { session_id: session.session_id, has_drive_folder_id: Boolean(session.drive_folder_id), has_drive_jsonl_id: Boolean(session.drive_jsonl_id) };
    throw err;
  }

  const timestamp = deps.now().toISOString();
  const previousDocId = session.drive_doc_id || null;
  const previousDocUrl = session.drive_doc_url || null;
  const archive = {
    drive_folder_id: session.drive_folder_id,
    drive_exports_folder_id: session.drive_exports_folder_id || null,
    drive_doc_id: session.drive_doc_id || null,
    drive_doc_url: session.drive_doc_url || null,
    drive_doc_part_index: positiveInt(session.drive_doc_part_index, 1),
    drive_doc_part_count: positiveInt(session.drive_doc_part_count || session.drive_doc_part_index, 1),
    drive_jsonl_id: session.drive_jsonl_id,
    drive_jsonl_url: session.drive_jsonl_url || null,
  };

  const rebuilt = await rebuildTranscriptDocFromJsonl({ pool, session, archive, deps, timestamp });
  if (!rebuilt?.rebuilt_from_jsonl) {
    const err = new Error("JSONL backfill did not produce a rebuilt transcript artifact.");
    err.status = 500;
    err.code = "gpt_session_archive_backfill_failed";
    throw err;
  }

  const archiveStatus = rebuilt.artifact_type === "text_snapshot" ? "ready_text_snapshot" : "ready_rebuilt";
  await updateArchiveStatus(pool, session.session_id, archiveStatus, JSON.stringify({
    status: archiveStatus,
    reason,
    previous_drive_doc_id: previousDocId,
    rebuilt_drive_doc_id: rebuilt.drive_doc_id,
    record_count: rebuilt.record_count,
    secrets_included: false,
  }));

  const eventId = randomUUID();
  const payload = {
    action: "gpt_session_archive_backfill",
    reason,
    session_id: session.session_id,
    previous_drive_doc_id: previousDocId,
    previous_drive_doc_url: previousDocUrl,
    rebuilt_drive_doc_id: rebuilt.drive_doc_id,
    rebuilt_drive_doc_url: rebuilt.drive_doc_url || null,
    drive_jsonl_id: session.drive_jsonl_id,
    record_count: rebuilt.record_count,
    artifact_type: rebuilt.artifact_type,
    google_doc_import_error: rebuilt.google_doc_import_error || null,
    backfilled_from_jsonl: true,
    secrets_included: false,
  };
  const payloadText = JSON.stringify(payload);
  await pool.query(
    `INSERT INTO \`session_events\`
       (event_id, session_id, tenant_id, workspace_key, user_id,
        actor_id, actor_type, brand_key, correlation_id, action_key,
        record_type, event_type, payload_json, payload_preview, payload_sha256,
        drive_artifact_id, drive_artifact_url, redaction_status, event_timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'gpt_session_archive_backfill',
        'archive', 'archive_backfill', ?, ?, ?, ?, ?, 'not_required', NOW())`,
    [
      eventId,
      session.session_id,
      session.tenant_id || PLATFORM_TENANT_ID,
      session.workspace_key || null,
      session.user_id || null,
      session.user_id || null,
      session.user_id ? "user" : "system",
      session.brand_key || null,
      eventId,
      payloadText,
      previewText(payloadText, PREVIEW_CHARS),
      sha256(payloadText),
      rebuilt.drive_doc_id,
      rebuilt.drive_doc_url || null,
    ]
  );

  return {
    ok: true,
    session_id: session.session_id,
    archive_status: archiveStatus,
    previous_drive_doc_id: previousDocId,
    rebuilt_drive_doc_id: rebuilt.drive_doc_id,
    rebuilt_drive_doc_url: rebuilt.drive_doc_url || null,
    record_count: rebuilt.record_count,
    artifact_type: rebuilt.artifact_type,
    event_id: eventId,
    secrets_included: false,
  };
}

export async function recordGptSessionTurn({
  pool,
  session,
  role,
  content,
  action_key = null,
  turnIndex,
  workspace_key = null,
  brand_key = null,
  business_type_key = null,
  business_activity_type_key = null,
  activity_key = null,
  knowledge_profile_key = null,
  injectedDeps = {},
}) {
  const deps = { ...defaultDeps(), ...injectedDeps };
  let effectiveTurnIndex = Number(turnIndex);
  if (!Number.isFinite(effectiveTurnIndex) || effectiveTurnIndex < 0) effectiveTurnIndex = 0;
  try {
    const [[freshIndexRow]] = await pool.query(
      "SELECT COALESCE(MAX(turn_index), -1) AS max_idx FROM `gpt_session_turns` WHERE session_id = ?",
      [session.session_id]
    );
    const nextAvailable = Number(freshIndexRow?.max_idx || -1) + 1;
    if (effectiveTurnIndex < nextAvailable) effectiveTurnIndex = nextAvailable;
  } catch {
    // Keep caller-provided turnIndex if the collision check is unavailable.
  }
  turnIndex = effectiveTurnIndex;

  try {
    const [[freshSession]] = await pool.query(
      "SELECT * FROM `customer_sessions` WHERE session_id = ? LIMIT 1",
      [session.session_id]
    );
    if (freshSession?.session_id) session = { ...session, ...freshSession };
  } catch {
    // Keep caller-provided session if fresh readback is unavailable.
  }

  const turnWorkspaceKey = String(workspace_key || session.workspace_key || "").trim() || null;
  const turnBrandKey = String(brand_key || session.brand_key || "").trim() || null;
  const businessContext = await resolveInheritedBusinessContext({
    pool,
    brand_key: turnBrandKey,
    business_type_key,
    business_activity_type_key,
    activity_key,
    knowledge_profile_key,
  });
  const turnContextStack = {
    tenant_id: session.tenant_id || PLATFORM_TENANT_ID,
    user_id: session.user_id || null,
    workspace_key: turnWorkspaceKey,
    brand_key: turnBrandKey,
    business_type_key: businessContext.business_type_key,
    business_activity_type_key: businessContext.business_activity_type_key,
    activity_key: businessContext.activity_key,
    knowledge_profile_key: businessContext.knowledge_profile_key,
    inherited_from_brand: businessContext.inherited_from_brand,
    lifecycle_contract: businessContext.lifecycle_contract,
    secrets_included: false,
  };

  const timestamp = deps.now().toISOString();
  const turnId = randomUUID();
  const eventId = randomUUID();
  const contentHash = sha256(content);
  const contentPreview = previewText(content);
  const driveAnchor = `turn-${turnIndex}`;
  const docContent = buildDocContentForTurn({ role, content, actionKey: action_key, contentHash });
  const docContentMode = docContentModeForRole(role);
  let docRuntimeEvent = null;
  let jsonlRuntimeEvent = null;
  let archiveResult = { configured: false, archive: null };
  let archiveStatus = "not_configured";
  let archiveError = null;
  const archiveErrors = [];

  try {
    archiveResult = await ensureSessionArchive(pool, session, deps);
    if (archiveResult.configured) {
      let docWritten = false;
      let jsonlWritten = false;
      try {
        const initialPart = positiveInt(archiveResult.archive.drive_doc_part_index, 1);
        docRuntimeEvent = buildRuntimeEvent({
          eventId,
          sessionId: session.session_id,
          turnId,
          turnIndex,
          role,
          actionKey: action_key,
          contentHash,
          content,
          timestamp,
          includeContent: false,
          bookmark: driveAnchor,
          docContentMode,
          fullContentStorage: "jsonl_sidecar",
          driveDocId: archiveResult.archive.drive_doc_id,
          driveDocPart: initialPart,
        });
        let docSectionText = buildTranscriptSection({ role, content: docContent, turnIndex, timestamp, runtimeEvent: docRuntimeEvent });
        const beforeRolloverDocId = archiveResult.archive.drive_doc_id;
        archiveResult.archive = await maybeRolloverTranscriptDoc({ pool, session, archive: archiveResult.archive, deps, sectionText: docSectionText, timestamp });
        const effectivePart = positiveInt(archiveResult.archive.drive_doc_part_index, initialPart);
        if (archiveResult.archive.drive_doc_id !== beforeRolloverDocId) {
          archiveErrors.push({ stage: "drive_doc_rollover", status: "new_doc_part", drive_doc_part: effectivePart, drive_doc_id: archiveResult.archive.drive_doc_id, secrets_included: false });
          docRuntimeEvent = buildRuntimeEvent({
            eventId,
            sessionId: session.session_id,
            turnId,
            turnIndex,
            role,
            actionKey: action_key,
            contentHash,
            content,
            timestamp,
            includeContent: false,
            bookmark: driveAnchor,
            docContentMode,
            fullContentStorage: "jsonl_sidecar",
            driveDocId: archiveResult.archive.drive_doc_id,
            driveDocPart: effectivePart,
          });
          docSectionText = buildTranscriptSection({ role, content: docContent, turnIndex, timestamp, runtimeEvent: docRuntimeEvent });
        }
        await deps.appendTextToGoogleDoc(
          archiveResult.archive.drive_doc_id,
          docSectionText
        );
        docWritten = true;
      } catch (err) {
        archiveErrors.push({ stage: "drive_doc_append", message: err.message });
      }
      try {
        const effectivePart = positiveInt(archiveResult.archive.drive_doc_part_index, 1);
        jsonlRuntimeEvent = buildRuntimeEvent({
          eventId,
          sessionId: session.session_id,
          turnId,
          turnIndex,
          role,
          actionKey: action_key,
          contentHash,
          content,
          timestamp,
          includeContent: true,
          bookmark: driveAnchor,
          docContentMode,
          fullContentStorage: "jsonl_sidecar",
          driveDocId: archiveResult.archive.drive_doc_id,
          driveDocPart: effectivePart,
        });
        await appendJsonlLine(
          archiveResult.archive,
          JSON.stringify(jsonlRuntimeEvent),
          deps
        );
        jsonlWritten = true;
      } catch (err) {
        archiveErrors.push({ stage: "drive_jsonl_append", message: err.message });
      }
      if (!docWritten && jsonlWritten) {
        try {
          const rebuilt = await rebuildTranscriptDocFromJsonl({ pool, session, archive: archiveResult.archive, deps, timestamp });
          if (rebuilt?.rebuilt_from_jsonl) {
            docWritten = true;
            archiveErrors.push({
              stage: "drive_doc_rebuild",
              status: rebuilt.artifact_type === "text_snapshot" ? "rebuilt_text_snapshot_from_jsonl" : "rebuilt_google_doc_from_jsonl",
              artifact_type: rebuilt.artifact_type || "google_doc",
              drive_doc_id: rebuilt.drive_doc_id,
              google_doc_import_error: rebuilt.google_doc_import_error || null,
              secrets_included: false,
            });
          }
        } catch (err) {
          archiveErrors.push({ stage: "drive_doc_rebuild", message: err.message });
        }
      }

      if (docWritten && jsonlWritten) {
        archiveStatus = archiveErrors.some((item) => item.status === "rebuilt_text_snapshot_from_jsonl")
          ? "ready_text_snapshot"
          : archiveErrors.some((item) => item.stage === "drive_doc_append") ? "ready_rebuilt" : "ready";
        await updateArchiveStatus(
          pool,
          session.session_id,
          archiveStatus,
          archiveStatus === "ready_rebuilt" ? JSON.stringify({ status: archiveStatus, notes: archiveErrors, secrets_included: false }) : null
        );
      } else if (docWritten || jsonlWritten) {
        archiveStatus = "ready_partial";
        archiveError = new Error(JSON.stringify({ status: "ready_partial", errors: archiveErrors, secrets_included: false }));
        await updateArchiveStatus(pool, session.session_id, "ready_partial", archiveError.message);
      } else {
        archiveStatus = "write_failed";
        archiveError = new Error(JSON.stringify({ status: "write_failed", errors: archiveErrors, secrets_included: false }));
        await updateArchiveStatus(pool, session.session_id, "write_failed", archiveError.message);
      }
    }
  } catch (err) {
    archiveStatus = "write_failed";
    archiveError = err;
    await updateArchiveStatus(pool, session.session_id, "write_failed", err.message);
  }

  const archive = archiveResult.archive || {};
  const storageMode = archive.drive_doc_id ? "drive" : "preview_only";
  const sqlContent = null;
  const eventPayload = {
    role,
    action_key,
    content_preview: contentPreview,
    content_sha256: contentHash,
    storage_mode: storageMode,
    drive_doc_id: archive.drive_doc_id || null,
    drive_doc_part: archive.drive_doc_id ? positiveInt(archive.drive_doc_part_index, 1) : null,
    drive_anchor: archive.drive_doc_id ? driveAnchor : null,
    context_stack: turnContextStack,
    business_context: businessContext,
  };

  await pool.query(
    `INSERT INTO \`gpt_session_turns\`
       (session_id, tenant_id, workspace_key, user_id, actor_id, actor_type,
        brand_key, correlation_id, execution_context_json,
        turn_id, turn_index, role, content, action_key, content_preview,
        content_sha256, drive_doc_id, drive_anchor, storage_mode, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      session.session_id,
      session.tenant_id || PLATFORM_TENANT_ID,
      turnWorkspaceKey,
      session.user_id || null,
      session.user_id || null,
      session.user_id ? "user" : "system",
      turnBrandKey,
      turnId,
      JSON.stringify({
        source: "session_archive_service",
        session_id: session.session_id,
        turn_id: turnId,
        drive_doc_id: archive.drive_doc_id || null,
        drive_doc_part: archive.drive_doc_id ? positiveInt(archive.drive_doc_part_index, 1) : null,
        secrets_included: false,
      }),
      turnId,
      turnIndex,
      role,
      sqlContent,
      action_key,
      contentPreview,
      contentHash,
      archive.drive_doc_id || null,
      archive.drive_doc_id ? driveAnchor : null,
      storageMode,
    ]
  );

  await pool.query(
    "UPDATE `gpt_session_turns` SET drive_doc_part = ? WHERE session_id = ? AND turn_id = ?",
    [archive.drive_doc_id ? positiveInt(archive.drive_doc_part_index, 1) : null, session.session_id, turnId]
  ).catch(() => {});

  await pool.query(
    `INSERT INTO \`session_events\`
       (event_id, session_id, turn_id, tenant_id, workspace_key, user_id,
        actor_id, actor_type, brand_key, correlation_id, action_key,
        record_type, event_type, payload_json, payload_preview, payload_sha256,
        drive_artifact_id, drive_artifact_url, redaction_status, event_timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'message', ?, ?, ?, ?, ?, ?, 'not_required', NOW())`,
    [
      eventId,
      session.session_id,
      turnId,
      session.tenant_id || PLATFORM_TENANT_ID,
      turnWorkspaceKey,
      session.user_id || null,
      session.user_id || null,
      session.user_id ? "user" : "system",
      turnBrandKey,
      eventId,
      action_key || null,
      role,
      JSON.stringify(eventPayload),
      contentPreview,
      contentHash,
      archive.drive_doc_id || null,
      archive.drive_doc_url || null,
    ]
  );

  await pool.query(
    "UPDATE `customer_sessions` SET turn_count = COALESCE(turn_count, 0) + 1, archive_last_written_at = NOW() WHERE session_id = ?",
    [session.session_id]
  );

  return {
    turn_id: turnId,
    turn_index: turnIndex,
    drive_doc_id: archive.drive_doc_id || null,
    drive_doc_part: archive.drive_doc_id ? positiveInt(archive.drive_doc_part_index, 1) : null,
    drive_anchor: archive.drive_doc_id ? driveAnchor : null,
    archive_status: archiveStatus,
    archive_error: archiveError ? archiveError.message : null,
  };
}

export async function closeGptSessionArchive({ pool, session, summary = null, injectedDeps = {} }) {
  const deps = { ...defaultDeps(), ...injectedDeps };
  try {
    try {
      const [[freshSession]] = await pool.query(
        "SELECT * FROM `customer_sessions` WHERE session_id = ? LIMIT 1",
        [session.session_id]
      );
      if (freshSession?.session_id) session = { ...session, ...freshSession };
    } catch {
      // Keep caller-provided session if fresh readback is unavailable.
    }
    const archiveResult = await ensureSessionArchive(pool, session, deps);
    if (archiveResult.configured && summary) {
      const summarySection = ["", "## Session Summary", "", String(summary), ""].join("\n");
      archiveResult.archive = await maybeRolloverTranscriptDoc({
        pool,
        session,
        archive: archiveResult.archive,
        deps,
        sectionText: summarySection,
        timestamp: deps.now().toISOString(),
      });
      await deps.appendTextToGoogleDoc(
        archiveResult.archive.drive_doc_id,
        summarySection
      );
    }
    if (archiveResult.configured) {
      await pool.query(
        `UPDATE \`customer_sessions\`
         SET drive_export_id = ?, drive_export_url = ?, drive_exported_at = NOW()
         WHERE session_id = ?`,
        [
          archiveResult.archive.drive_doc_id,
          archiveResult.archive.drive_doc_url,
          session.session_id,
        ]
      );
    }
    await updateArchiveStatus(pool, session.session_id, "closed");
    return {
      ok: true,
      drive_doc_id: archiveResult.archive?.drive_doc_id || null,
      drive_doc_url: archiveResult.archive?.drive_doc_url || null,
      archive_status: archiveResult.configured ? "closed" : "not_configured",
    };
  } catch (err) {
    await updateArchiveStatus(pool, session.session_id, "write_failed", err.message);
    return { ok: false, error: err.message, archive_status: "write_failed" };
  }
}
