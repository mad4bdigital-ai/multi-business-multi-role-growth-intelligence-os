import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { buildActivationSessionContext } from "./routes/activationRoutes.js";
import { closeGptSessionArchive, recordGptSessionTurn } from "./sessionArchiveService.js";
import { fetchDriveContent, deleteDriveFile } from "./uploadPipeline.js";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_SMOKE_SUBFOLDER = "_smoke_archives";
const SMOKE_ORIGINATOR = "gpt_action_smoke";

function check(name, pass, detail = null) {
  return { name, pass: Boolean(pass), ...(detail === null ? {} : { detail }) };
}

function parseJsonl(raw = "") {
  const lines = String(raw || "").split(/\r?\n/).filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

async function cleanupSmokeArtifacts({ pool, sessionId, archivedSession, deleteDriveFn }) {
  const cleanup = {
    sql_session_deleted: false,
    sql_turns_deleted: 0,
    sql_events_deleted: 0,
    drive_files_deleted: 0,
    drive_files_failed: 0,
    errors: [],
  };

  try {
    const [turnRes] = await pool.query("DELETE FROM `gpt_session_turns` WHERE session_id = ?", [sessionId]);
    cleanup.sql_turns_deleted = Number(turnRes?.affectedRows || 0);
  } catch (err) {
    cleanup.errors.push({ stage: "delete_turns", message: String(err?.message || err).slice(0, 200) });
  }

  try {
    const [eventRes] = await pool.query("DELETE FROM `session_events` WHERE session_id = ?", [sessionId]);
    cleanup.sql_events_deleted = Number(eventRes?.affectedRows || 0);
  } catch (err) {
    cleanup.errors.push({ stage: "delete_events", message: String(err?.message || err).slice(0, 200) });
  }

  try {
    const [sessionRes] = await pool.query("DELETE FROM `customer_sessions` WHERE session_id = ?", [sessionId]);
    cleanup.sql_session_deleted = Number(sessionRes?.affectedRows || 0) > 0;
  } catch (err) {
    cleanup.errors.push({ stage: "delete_session", message: String(err?.message || err).slice(0, 200) });
  }

  const driveFileIds = [
    archivedSession?.drive_doc_id,
    archivedSession?.drive_jsonl_id,
  ].filter(Boolean);
  for (const fileId of driveFileIds) {
    try {
      await deleteDriveFn(fileId);
      cleanup.drive_files_deleted += 1;
    } catch (err) {
      cleanup.drive_files_failed += 1;
      cleanup.errors.push({ stage: "delete_drive_file", file_id: fileId, message: String(err?.message || err).slice(0, 200) });
    }
  }

  return cleanup;
}

export async function runSessionArchiveSmoke({
  pool = getPool(),
  tenantId = PLATFORM_TENANT_ID,
  userId = `session_archive_smoke_${Date.now()}`,
  actionKey = "session_archive_live_smoke",
  includeDriveReadback = true,
  cleanup: shouldCleanup = true,
  smokeSubfolder = DEFAULT_SMOKE_SUBFOLDER,
  activationContextReader = buildActivationSessionContext,
  fetchDriveContentFn = fetchDriveContent,
  deleteDriveFileFn = deleteDriveFile,
  injectedArchiveDeps = {},
} = {}) {
  const startedAt = new Date();
  const sessionId = randomUUID();
  const marker = `SESSION_ARCHIVE_SMOKE_${startedAt.getTime()}_${randomUUID()}`;
  const longPrefix = "smoke-context ".repeat(80);
  const userContent = `${longPrefix}user turn ${marker}`;
  const assistantContent = `${longPrefix}assistant turn ${marker}`;
  const archiveDeps = { subfolderHint: smokeSubfolder, ...injectedArchiveDeps };

  await pool.query(
    `INSERT INTO \`customer_sessions\`
       (session_id, tenant_id, user_id, originator, session_status, started_at)
     VALUES (?, ?, ?, ?, 'open', NOW())`,
    [sessionId, tenantId, userId, SMOKE_ORIGINATOR]
  );

  const session = {
    session_id: sessionId,
    tenant_id: tenantId,
    user_id: userId,
    originator: SMOKE_ORIGINATOR,
    session_status: "open",
    started_at: startedAt,
  };

  const firstTurn = await recordGptSessionTurn({
    pool,
    session,
    role: "user",
    content: userContent,
    action_key: actionKey,
    turnIndex: 0,
    injectedDeps: archiveDeps,
  });
  const [sessionAfterFirstTurnRows] = await pool.query("SELECT * FROM `customer_sessions` WHERE session_id = ? LIMIT 1", [sessionId]);
  const sessionAfterFirstTurn = sessionAfterFirstTurnRows[0] || session;
  const secondTurn = await recordGptSessionTurn({
    pool,
    session: sessionAfterFirstTurn,
    role: "assistant",
    content: assistantContent,
    action_key: actionKey,
    turnIndex: 1,
    injectedDeps: archiveDeps,
  });

  const [freshRows] = await pool.query("SELECT * FROM `customer_sessions` WHERE session_id = ? LIMIT 1", [sessionId]);
  const freshSession = freshRows[0] || session;

  await pool.query(
    "UPDATE `customer_sessions` SET session_status = 'completed', ended_at = NOW() WHERE session_id = ?",
    [sessionId]
  );

  const closeResult = await closeGptSessionArchive({
    pool,
    session: freshSession,
    summary: `Session archive smoke summary ${marker}`,
    injectedDeps: archiveDeps,
  });

  const [sessionRows] = await pool.query(
    `SELECT session_id, archive_status, drive_folder_id, drive_doc_id, drive_jsonl_id, drive_export_url
     FROM \`customer_sessions\`
     WHERE session_id = ? LIMIT 1`,
    [sessionId]
  );
  const [turnRows] = await pool.query(
    `SELECT turn_index, role, storage_mode, drive_doc_id, drive_anchor, content_preview, content_sha256
     FROM \`gpt_session_turns\`
     WHERE session_id = ?
     ORDER BY turn_index`,
    [sessionId]
  );
  const archivedSession = sessionRows[0] || {};

  let docText = "";
  let jsonlText = "";
  let jsonlRows = [];
  let driveReadError = null;
  if (includeDriveReadback && archivedSession.drive_doc_id && archivedSession.drive_jsonl_id) {
    try {
      docText = await fetchDriveContentFn(archivedSession.drive_doc_id);
      jsonlText = await fetchDriveContentFn(archivedSession.drive_jsonl_id);
      jsonlRows = parseJsonl(jsonlText);
    } catch (err) {
      driveReadError = err;
    }
  }

  let activationContext = null;
  let activationError = null;
  try {
    activationContext = await activationContextReader({
      query: { tenant_id: tenantId, user_id: userId, limit: 10 },
      auth: { is_admin: true },
    });
  } catch (err) {
    activationError = err;
  }
  const activationSession = (activationContext?.gpt_sessions || []).find((row) => row.session_id === sessionId);

  const checks = [
    check("session_created", Boolean(sessionId), { session_id: sessionId }),
    check("turn_writes_ready", firstTurn.archive_status === "ready" && secondTurn.archive_status === "ready"),
    check("archive_closed", closeResult.archive_status === "closed" && archivedSession.archive_status === "closed"),
    check("drive_doc_pointer", Boolean(archivedSession.drive_doc_id)),
    check("drive_jsonl_pointer", Boolean(archivedSession.drive_jsonl_id)),
    check("drive_export_url", Boolean(archivedSession.drive_export_url)),
    check("sql_turn_count", turnRows.length === 2, { count: turnRows.length }),
    check(
      "sql_stores_pointers_only",
      turnRows.every((row) => row.storage_mode === "drive" && row.drive_doc_id && row.drive_anchor && !String(row.content_preview || "").includes(marker))
    ),
    check("sql_hashes_present", turnRows.every((row) => String(row.content_sha256 || "").length === 64)),
    check(
      "drive_doc_readback",
      !includeDriveReadback || (docText.includes(marker) && docText.includes("### Runtime Event") && docText.includes(`"action_key": "${actionKey}"`)),
      driveReadError ? { error: driveReadError.message } : null
    ),
    check(
      "drive_jsonl_readback",
      !includeDriveReadback || (jsonlRows.length >= 2 && jsonlRows.some((row) => String(row.content || "").includes(marker))),
      driveReadError ? { error: driveReadError.message } : null
    ),
    check(
      "activation_readback",
      Boolean(activationSession?.drive_export_url),
      activationError ? { error: activationError.message } : { found: Boolean(activationSession) }
    ),
  ];

  const ok = checks.every((item) => item.pass);

  let cleanup = null;
  if (shouldCleanup) {
    cleanup = await cleanupSmokeArtifacts({
      pool,
      sessionId,
      archivedSession,
      deleteDriveFn: deleteDriveFileFn,
    });
  }

  return {
    ok,
    status: ok ? "pass" : "fail",
    smoke_type: "session_archive_drive_writeback",
    checked_at: new Date().toISOString(),
    session_id: sessionId,
    tenant_id: tenantId,
    user_id: userId,
    originator: SMOKE_ORIGINATOR,
    smoke_subfolder: smokeSubfolder,
    drive: {
      folder_id: archivedSession.drive_folder_id || null,
      doc_id: archivedSession.drive_doc_id || null,
      jsonl_id: archivedSession.drive_jsonl_id || null,
      export_url_present: Boolean(archivedSession.drive_export_url),
    },
    cleanup,
    checks,
  };
}
