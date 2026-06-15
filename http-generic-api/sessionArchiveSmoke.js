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

  const driveFileIds = new Set([
    archivedSession?.drive_doc_id,
    archivedSession?.drive_jsonl_id,
  ].filter(Boolean));

  try {
    const [docRows] = await pool.query(
      "SELECT DISTINCT drive_doc_id FROM `gpt_session_turns` WHERE session_id = ? AND drive_doc_id IS NOT NULL",
      [sessionId]
    );
    for (const row of docRows || []) {
      if (row?.drive_doc_id) driveFileIds.add(row.drive_doc_id);
    }
  } catch (err) {
    cleanup.errors.push({ stage: "collect_drive_doc_parts", message: String(err?.message || err).slice(0, 200) });
  }

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
  forceDocRollover = false,
  docRolloverChars = null,
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
  const assistantFollowupContent = `${longPrefix}assistant follow-up after tool ${marker}`;
  const toolContent = [
    "Tool: release_session_archive_smoke",
    "Status: HTTP 200 ok=true",
    "",
    "Args:",
    JSON.stringify({ include_drive_readback: true, smoke_subfolder: smokeSubfolder }, null, 2),
    "",
    "Result:",
    JSON.stringify({ marker, log: `${longPrefix}${longPrefix}tool result ${marker}` }, null, 2),
  ].join("\n");
  const effectiveDocRolloverChars = Number(docRolloverChars) > 0 ? Math.floor(Number(docRolloverChars)) : null;
  const archiveDeps = { subfolderHint: smokeSubfolder, ...(!forceDocRollover && effectiveDocRolloverChars ? { docRolloverChars: effectiveDocRolloverChars } : {}), ...injectedArchiveDeps };

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
  if (forceDocRollover && effectiveDocRolloverChars) {
    await pool.query(
      "UPDATE `customer_sessions` SET drive_doc_rollover_threshold_chars = ? WHERE session_id = ?",
      [effectiveDocRolloverChars, sessionId]
    ).catch(() => {});
  }
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
  const [sessionAfterSecondTurnRows] = await pool.query("SELECT * FROM `customer_sessions` WHERE session_id = ? LIMIT 1", [sessionId]);
  const sessionAfterSecondTurn = sessionAfterSecondTurnRows[0] || sessionAfterFirstTurn;
  const thirdTurn = await recordGptSessionTurn({
    pool,
    session: sessionAfterSecondTurn,
    role: "tool",
    content: toolContent,
    action_key: actionKey,
    turnIndex: 2,
    injectedDeps: archiveDeps,
  });
  const [sessionAfterThirdTurnRows] = await pool.query("SELECT * FROM `customer_sessions` WHERE session_id = ? LIMIT 1", [sessionId]);
  const sessionAfterThirdTurn = sessionAfterThirdTurnRows[0] || sessionAfterSecondTurn;
  const fourthTurn = await recordGptSessionTurn({
    pool,
    session: sessionAfterThirdTurn,
    role: "assistant",
    content: assistantFollowupContent,
    action_key: actionKey,
    turnIndex: 3,
    injectedDeps: archiveDeps,
  });

  const [freshRows] = await pool.query("SELECT * FROM `customer_sessions` WHERE session_id = ? LIMIT 1", [sessionId]);
  const freshSession = freshRows[0] || sessionAfterThirdTurn;

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
    `SELECT session_id, archive_status, drive_folder_id, drive_doc_id, drive_doc_part_index, drive_doc_part_count, drive_jsonl_id, drive_export_url
     FROM \`customer_sessions\`
     WHERE session_id = ? LIMIT 1`,
    [sessionId]
  );
  const [turnRows] = await pool.query(
    `SELECT turn_index, role, storage_mode, drive_doc_id, drive_doc_part, drive_anchor, content_preview, content_sha256
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
  const readbackDocIds = [...new Set([
    ...turnRows.map((row) => row.drive_doc_id).filter(Boolean),
    archivedSession.drive_doc_id,
  ].filter(Boolean))];
  if (includeDriveReadback && readbackDocIds.length && archivedSession.drive_jsonl_id) {
    try {
      const docTexts = [];
      for (const docId of readbackDocIds) {
        docTexts.push(await fetchDriveContentFn(docId));
      }
      docText = docTexts.join("\n\n--- TRANSCRIPT DOC PART BREAK ---\n\n");
      jsonlText = await fetchDriveContentFn(archivedSession.drive_jsonl_id);
      jsonlRows = parseJsonl(jsonlText);
    } catch (err) {
      driveReadError = err;
    }
  }

  const persistedUserId = freshSession?.user_id || userId;
  let activationContext = null;
  let activationError = null;
  try {
    activationContext = await activationContextReader({
      query: {
        tenant_id: tenantId,
        user_id: persistedUserId,
        limit: 10,
        include_smoke_sessions: true,
        read_only: true,
        no_open_session: true,
      },
      auth: { is_admin: true },
    });
  } catch (err) {
    activationError = err;
  }
  const activationSession = (activationContext?.gpt_sessions || []).find((row) => row.session_id === sessionId);
  const distinctTurnDocIds = [...new Set(turnRows.map((row) => row.drive_doc_id).filter(Boolean))];
  const maxTurnDocPart = Math.max(0, ...turnRows.map((row) => Number(row.drive_doc_part || 0)));

  const checks = [
    check("session_created", Boolean(sessionId), { session_id: sessionId }),
    check("turn_writes_ready", firstTurn.archive_status === "ready" && secondTurn.archive_status === "ready" && thirdTurn.archive_status === "ready" && fourthTurn.archive_status === "ready"),
    check("conversation_exchange_complete", turnRows.map((row) => row.role).join("|") === "user|assistant|tool|assistant"),
    check("archive_closed", closeResult.archive_status === "closed" && archivedSession.archive_status === "closed"),
    check("drive_doc_pointer", Boolean(archivedSession.drive_doc_id)),
    check("drive_jsonl_pointer", Boolean(archivedSession.drive_jsonl_id)),
    check("drive_export_url", Boolean(archivedSession.drive_export_url)),
    check("sql_turn_count", turnRows.length === 4, { count: turnRows.length }),
    check(
      "drive_doc_rollover",
      !forceDocRollover || (distinctTurnDocIds.length >= 2 && maxTurnDocPart >= 2 && Number(archivedSession.drive_doc_part_count || 0) >= 2),
      forceDocRollover ? { distinct_doc_count: distinctTurnDocIds.length, max_turn_doc_part: maxTurnDocPart, session_part_count: Number(archivedSession.drive_doc_part_count || 0) } : null
    ),
    check(
      "sql_stores_pointers_only",
      turnRows.every((row) => row.storage_mode === "drive" && row.drive_doc_id && row.drive_anchor)
    ),
    check("sql_hashes_present", turnRows.every((row) => String(row.content_sha256 || "").length === 64)),
    check(
      "drive_doc_readback",
      !includeDriveReadback || (docText.includes(marker) && docText.includes("### Runtime Event") && docText.includes(`"action_key": "${actionKey}"`)),
      driveReadError ? { error: driveReadError.message } : null
    ),
    check(
      "drive_doc_bookmarks",
      !includeDriveReadback || [0, 1, 2, 3].every((idx) => docText.includes(`Bookmark: turn-${idx}`)),
      driveReadError ? { error: driveReadError.message } : null
    ),
    check(
      "drive_doc_tool_summary",
      !includeDriveReadback || (
        docText.includes("### Tool Call Summary") &&
        docText.includes("Full content: JSONL sidecar") &&
        docText.includes('"doc_content_mode": "summary_only"') &&
        !docText.includes(toolContent)
      ),
      driveReadError ? { error: driveReadError.message } : null
    ),
    check(
      "drive_jsonl_readback",
      !includeDriveReadback || (jsonlRows.length >= 4 && jsonlRows.some((row) => String(row.content || "").includes(marker))),
      driveReadError ? { error: driveReadError.message } : null
    ),
    check(
      "drive_jsonl_tool_full_fidelity",
      !includeDriveReadback || jsonlRows.some((row) => row.role === "tool" && row.content === toolContent),
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
    user_id: persistedUserId,
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
