import { createHash, randomUUID } from "node:crypto";
import {
  appendTextToGoogleDoc,
  createGoogleDocInDrive,
  fetchDriveContent,
  getOrCreateDriveFolder,
  updateDriveFileContent,
  uploadContentToDrive,
} from "./uploadPipeline.js";

const PREVIEW_CHARS = 512;
const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_SESSIONS_DRIVE_FOLDER_ID = "1TIxUmnh0RrLCfXYfkjf96EwGc8OYnEw1";

function defaultDeps() {
  return {
    getOrCreateDriveFolder,
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

  for (const part of buildSessionArchivePath(session, deps.now())) {
    parentId = await deps.getOrCreateDriveFolder(part, parentId);
  }

  const exportsFolderId = await deps.getOrCreateDriveFolder("Exports", parentId);
  await deps.getOrCreateDriveFolder("Artifacts", parentId);

  const heading = [
    `Session ${session.session_id}`,
    `Tenant: ${session.tenant_id || PLATFORM_TENANT_ID}`,
    `User: ${session.user_id || "platform_admin"}`,
    `Started: ${(session.started_at ? new Date(session.started_at) : deps.now()).toISOString()}`,
    "",
  ].join("\n");

  const transcript = await deps.createGoogleDocInDrive("Session Transcript", parentId, heading);
  const jsonl = await deps.uploadContentToDrive("", "Tool Calls.jsonl", "application/jsonl", null, parentId);

  return {
    drive_folder_id: parentId,
    drive_exports_folder_id: exportsFolderId,
    drive_doc_id: transcript.drive_file_id,
    drive_doc_url: transcript.drive_web_url || null,
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
         drive_jsonl_id = ?, drive_jsonl_url = ?, drive_exports_folder_id = ?,
         archive_status = 'ready', archive_last_error = NULL, archive_last_written_at = NOW()
     WHERE session_id = ?`,
    [
      archive.drive_folder_id,
      archive.drive_doc_id,
      archive.drive_doc_url,
      archive.drive_jsonl_id,
      archive.drive_jsonl_url,
      archive.drive_exports_folder_id,
      session.session_id,
    ]
  );

  return { configured: true, archive };
}

async function appendJsonlLine(archive, line, deps) {
  if (!archive?.drive_jsonl_id) return;
  const current = await deps.fetchDriveContent(archive.drive_jsonl_id).catch(() => "");
  const next = `${String(current || "").replace(/\s*$/, "")}${current ? "\n" : ""}${line}\n`;
  await deps.updateDriveFileContent(archive.drive_jsonl_id, next, "application/jsonl");
}

function buildTranscriptSection({ role, content, turnIndex, timestamp }) {
  return [
    "",
    `## Turn ${turnIndex} - ${String(role).toUpperCase()} - ${timestamp}`,
    "",
    String(content || ""),
    "",
  ].join("\n");
}

export async function recordGptSessionTurn({
  pool,
  session,
  role,
  content,
  action_key = null,
  turnIndex,
  injectedDeps = {},
}) {
  const deps = { ...defaultDeps(), ...injectedDeps };
  const timestamp = deps.now().toISOString();
  const turnId = randomUUID();
  const eventId = randomUUID();
  const contentHash = sha256(content);
  const contentPreview = previewText(content);
  const driveAnchor = `turn-${turnIndex}`;
  let archiveResult = { configured: false, archive: null };
  let archiveError = null;

  try {
    archiveResult = await ensureSessionArchive(pool, session, deps);
    if (archiveResult.configured) {
      await deps.appendTextToGoogleDoc(
        archiveResult.archive.drive_doc_id,
        buildTranscriptSection({ role, content, turnIndex, timestamp })
      );
      await appendJsonlLine(
        archiveResult.archive,
        JSON.stringify({
          event_id: eventId,
          session_id: session.session_id,
          turn_id: turnId,
          turn_index: turnIndex,
          event_type: role,
          role,
          action_key,
          content_sha256: contentHash,
          content,
          created_at: timestamp,
        }),
        deps
      );
    }
  } catch (err) {
    archiveError = err;
    await updateArchiveStatus(pool, session.session_id, "write_failed", err.message);
  }

  const archive = archiveResult.archive || {};
  const eventPayload = {
    role,
    action_key,
    content_preview: contentPreview,
    content_sha256: contentHash,
    storage_mode: archive.drive_doc_id ? "drive" : "inline_preview",
    drive_doc_id: archive.drive_doc_id || null,
    drive_anchor: archive.drive_doc_id ? driveAnchor : null,
  };

  await pool.query(
    `INSERT INTO \`gpt_session_turns\`
       (session_id, turn_id, turn_index, role, content, action_key, content_preview,
        content_sha256, drive_doc_id, drive_anchor, storage_mode, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      session.session_id,
      turnId,
      turnIndex,
      role,
      contentPreview,
      action_key,
      contentPreview,
      contentHash,
      archive.drive_doc_id || null,
      archive.drive_doc_id ? driveAnchor : null,
      archive.drive_doc_id ? "drive" : "inline",
    ]
  );

  await pool.query(
    `INSERT INTO \`session_events\`
       (event_id, session_id, turn_id, tenant_id, record_type, event_type,
        payload_json, payload_preview, payload_sha256, drive_artifact_id,
        drive_artifact_url, redaction_status, event_timestamp)
     VALUES (?, ?, ?, ?, 'message', ?, ?, ?, ?, ?, ?, 'not_required', NOW())`,
    [
      eventId,
      session.session_id,
      turnId,
      session.tenant_id || PLATFORM_TENANT_ID,
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
    drive_anchor: archive.drive_doc_id ? driveAnchor : null,
    archive_status: archiveError ? "write_failed" : archiveResult.configured ? "ready" : "not_configured",
    archive_error: archiveError ? archiveError.message : null,
  };
}

export async function closeGptSessionArchive({ pool, session, summary = null, injectedDeps = {} }) {
  const deps = { ...defaultDeps(), ...injectedDeps };
  try {
    const archiveResult = await ensureSessionArchive(pool, session, deps);
    if (archiveResult.configured && summary) {
      await deps.appendTextToGoogleDoc(
        archiveResult.archive.drive_doc_id,
        ["", "## Session Summary", "", String(summary), ""].join("\n")
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
