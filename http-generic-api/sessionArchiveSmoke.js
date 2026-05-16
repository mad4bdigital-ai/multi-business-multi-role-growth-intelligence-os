import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { buildActivationSessionContext } from "./routes/activationRoutes.js";
import { closeGptSessionArchive, recordGptSessionTurn } from "./sessionArchiveService.js";
import { fetchDriveContent } from "./uploadPipeline.js";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";

function check(name, pass, detail = null) {
  return { name, pass: Boolean(pass), ...(detail === null ? {} : { detail }) };
}

function parseJsonl(raw = "") {
  const lines = String(raw || "").split(/\r?\n/).filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

export async function runSessionArchiveSmoke({
  pool = getPool(),
  tenantId = PLATFORM_TENANT_ID,
  userId = `session_archive_smoke_${Date.now()}`,
  actionKey = "session_archive_live_smoke",
  includeDriveReadback = true,
  activationContextReader = buildActivationSessionContext,
  fetchDriveContentFn = fetchDriveContent,
  injectedArchiveDeps = {},
} = {}) {
  const startedAt = new Date();
  const sessionId = randomUUID();
  const marker = `SESSION_ARCHIVE_SMOKE_${startedAt.getTime()}_${randomUUID()}`;
  const longPrefix = "smoke-context ".repeat(80);
  const userContent = `${longPrefix}user turn ${marker}`;
  const assistantContent = `${longPrefix}assistant turn ${marker}`;

  await pool.query(
    `INSERT INTO \`customer_sessions\`
       (session_id, tenant_id, user_id, originator, session_status, started_at)
     VALUES (?, ?, ?, 'gpt_action_smoke', 'open', NOW())`,
    [sessionId, tenantId, userId]
  );

  const session = {
    session_id: sessionId,
    tenant_id: tenantId,
    user_id: userId,
    originator: "gpt_action_smoke",
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
    injectedDeps: injectedArchiveDeps,
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
    injectedDeps: injectedArchiveDeps,
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
    injectedDeps: injectedArchiveDeps,
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
  return {
    ok,
    status: ok ? "pass" : "fail",
    smoke_type: "session_archive_drive_writeback",
    checked_at: new Date().toISOString(),
    session_id: sessionId,
    tenant_id: tenantId,
    user_id: userId,
    drive: {
      folder_id: archivedSession.drive_folder_id || null,
      doc_id: archivedSession.drive_doc_id || null,
      jsonl_id: archivedSession.drive_jsonl_id || null,
      export_url_present: Boolean(archivedSession.drive_export_url),
    },
    checks,
  };
}
