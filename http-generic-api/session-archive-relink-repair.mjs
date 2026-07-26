#!/usr/bin/env node
import { getPool } from "./db.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { apply: false };
  let applyFlagSeen = false;
  let dryRunFlagSeen = false;
  for (const arg of argv) {
    if (arg === "--apply") {
      applyFlagSeen = true;
      args.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRunFlagSeen = true;
      args.apply = false;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1].replace(/-/g, "_")] = match[2];
  }
  if (applyFlagSeen && dryRunFlagSeen) {
    const err = new Error("Conflicting mode flags: use either --dry-run or --apply, not both.");
    err.code = "conflicting_mode_flags";
    throw err;
  }
  return args;
}

function required(args, key) {
  const value = String(args[key] || "").trim();
  if (!value) throw new Error(`Missing required argument --${key.replace(/_/g, "-")}`);
  return value;
}

function optional(args, key, fallback = "") {
  return String(args[key] || fallback || "").trim();
}

function usage() {
  return `Usage:\n\nnode session-archive-relink-repair.mjs \\\n  --target-session-id=<uuid> \\\n  --target-drive-folder-id=<drive_folder_id> \\\n  --target-drive-doc-id=<google_doc_id> \\\n  --target-drive-jsonl-id=<drive_file_id> \\\n  --target-drive-exports-folder-id=<drive_folder_id> \\\n  --superseded-session-id=<uuid> \\\n  --copy-after=<YYYY-MM-DD HH:mm:ss> \\\n  --start-turn-index=<number> \\\n  [--tenant-id=<uuid>] [--user-id=<uuid|null>] [--target-drive-doc-url=<url>] [--target-drive-jsonl-url=<url>] \\\n  [--apply|--dry-run]\n\nDefault mode is dry-run. No broad DELETE/DROP/TRUNCATE operations are used.`;
}

async function getSingle(conn, sql, params = []) {
  const [rows] = await conn.query(sql, params);
  return rows?.[0] || null;
}

async function main() {
  const args = parseArgs();
  const targetSessionId = required(args, "target_session_id");
  const targetDriveFolderId = required(args, "target_drive_folder_id");
  const targetDriveDocId = required(args, "target_drive_doc_id");
  const targetDriveJsonlId = required(args, "target_drive_jsonl_id");
  const targetDriveExportsFolderId = required(args, "target_drive_exports_folder_id");
  const supersededSessionId = required(args, "superseded_session_id");
  const copyAfter = required(args, "copy_after");
  const startTurnIndex = Number(required(args, "start_turn_index"));

  if (!Number.isInteger(startTurnIndex) || startTurnIndex < 0) {
    throw new Error("--start-turn-index must be a non-negative integer");
  }

  const tenantId = optional(args, "tenant_id", "00000000-0000-0000-0000-000000000000");
  const userId = optional(args, "user_id", "");
  const targetDriveDocUrl = optional(args, "target_drive_doc_url", `https://docs.google.com/document/d/${targetDriveDocId}/edit?usp=drivesdk`);
  const targetDriveJsonlUrl = optional(args, "target_drive_jsonl_url", `https://drive.google.com/file/d/${targetDriveJsonlId}/view?usp=drivesdk`);
  const apply = Boolean(args.apply);

  const conn = await getPool().getConnection();
  try {
    const sourceSummary = await getSingle(
      conn,
      `SELECT COUNT(*) AS source_rows, MIN(turn_index) AS min_turn, MAX(turn_index) AS max_turn,
              MIN(created_at) AS first_at, MAX(created_at) AS last_at
         FROM gpt_session_turns
        WHERE session_id=? AND created_at > ?`,
      [supersededSessionId, copyAfter]
    );

    const targetSummaryBefore = await getSingle(
      conn,
      `SELECT COUNT(*) AS target_rows, MIN(turn_index) AS min_turn, MAX(turn_index) AS max_turn,
              MAX(created_at) AS last_at
         FROM gpt_session_turns
        WHERE session_id=?`,
      [targetSessionId]
    );

    const missingSummary = await getSingle(
      conn,
      `SELECT COUNT(*) AS missing_rows
         FROM gpt_session_turns src
        WHERE src.session_id=?
          AND src.created_at > ?
          AND NOT EXISTS (
            SELECT 1
              FROM gpt_session_turns existing
             WHERE existing.session_id=?
               AND existing.content_sha256=src.content_sha256
               AND existing.created_at=src.created_at
          )`,
      [supersededSessionId, copyAfter, targetSessionId]
    );

    console.log(JSON.stringify({
      ok: true,
      mode: apply ? "apply" : "dry-run",
      targetSessionId,
      supersededSessionId,
      copyAfter,
      startTurnIndex,
      sourceSummary,
      targetSummaryBefore,
      planned: {
        recreateCustomerSession: true,
        copyMissingTurns: Number(missingSummary?.missing_rows || 0),
        sourceRowsAfterCutoff: Number(sourceSummary?.source_rows || 0),
        closeSupersededSession: true
      }
    }, null, 2));

    if (!apply) {
      console.log("\nDry-run only. Re-run with --apply to write changes.");
      return;
    }

    await conn.beginTransaction();

    await conn.query(
      `INSERT INTO customer_sessions
        (session_id, tenant_id, user_id, originator, source, model_provider, model_name, session_status,
         drive_folder_id, drive_doc_id, drive_doc_url, drive_jsonl_id, drive_jsonl_url, drive_exports_folder_id,
         archive_status, archive_last_error, archive_last_written_at, turn_count, started_at, created_at)
       VALUES (?, ?, NULLIF(?, ''), 'gpt_action', 'session_archive_relink_repair', 'openai', 'gpt-5.5-thinking', 'active',
         ?, ?, ?, ?, ?, ?, 'ready', NULL, NOW(), ?, COALESCE((SELECT MIN(created_at) FROM gpt_session_turns WHERE session_id=?), NOW()), NOW())
       ON DUPLICATE KEY UPDATE
         tenant_id=VALUES(tenant_id), user_id=VALUES(user_id), originator='gpt_action', session_status='active',
         drive_folder_id=VALUES(drive_folder_id), drive_doc_id=VALUES(drive_doc_id), drive_doc_url=VALUES(drive_doc_url),
         drive_jsonl_id=VALUES(drive_jsonl_id), drive_jsonl_url=VALUES(drive_jsonl_url),
         drive_exports_folder_id=VALUES(drive_exports_folder_id), archive_status='ready', archive_last_error=NULL,
         archive_last_written_at=NOW()`,
      [
        targetSessionId,
        tenantId,
        userId,
        targetDriveFolderId,
        targetDriveDocId,
        targetDriveDocUrl,
        targetDriveJsonlId,
        targetDriveJsonlUrl,
        targetDriveExportsFolderId,
        startTurnIndex,
        supersededSessionId,
      ]
    );

    await conn.query("SET @relink_turn_idx := ?", [startTurnIndex - 1]);
    const [copyResult] = await conn.query(
      `INSERT INTO gpt_session_turns
        (session_id, turn_id, turn_index, role, content, action_key, content_preview, content_sha256,
         drive_doc_id, drive_anchor, storage_mode, created_at)
       SELECT ?, UUID(), (@relink_turn_idx := @relink_turn_idx + 1), role, NULL, action_key,
              COALESCE(content_preview, LEFT(content, 512)), content_sha256, ?, CONCAT('turn-', @relink_turn_idx), 'drive', created_at
         FROM gpt_session_turns src
        WHERE src.session_id=?
          AND src.created_at > ?
          AND NOT EXISTS (
            SELECT 1
              FROM gpt_session_turns existing
             WHERE existing.session_id=?
               AND existing.content_sha256=src.content_sha256
               AND existing.created_at=src.created_at
          )
        ORDER BY src.created_at ASC, src.turn_index ASC`,
      [targetSessionId, targetDriveDocId, supersededSessionId, copyAfter, targetSessionId]
    );

    await conn.query(
      `UPDATE customer_sessions
          SET turn_count=(SELECT COALESCE(MAX(turn_index), -1) + 1 FROM gpt_session_turns WHERE session_id=?),
              archive_status='ready', archive_last_error=NULL, archive_last_written_at=NOW()
        WHERE session_id=?`,
      [targetSessionId, targetSessionId]
    );

    await conn.query(
      `UPDATE customer_sessions
          SET session_status='completed',
              archive_status=COALESCE(archive_status, 'superseded'),
              archive_last_error=CONCAT('superseded by ', ?,' via session_archive_relink_repair'),
              ended_at=COALESCE(ended_at, NOW())
        WHERE session_id=?`,
      [targetSessionId, supersededSessionId]
    );

    await conn.commit();

    const targetSummaryAfter = await getSingle(
      conn,
      `SELECT COUNT(*) AS target_rows, MIN(turn_index) AS min_turn, MAX(turn_index) AS max_turn,
              MAX(created_at) AS last_at
         FROM gpt_session_turns
        WHERE session_id=?`,
      [targetSessionId]
    );

    console.log(JSON.stringify({
      ok: true,
      applied: true,
      copiedRows: copyResult.affectedRows,
      targetSummaryAfter
    }, null, 2));
  } catch (err) {
    try { await conn.rollback(); } catch {}
    console.error(JSON.stringify({ ok: false, error: { code: err.code || "session_archive_relink_failed", message: err.message }, usage: usage() }, null, 2));
    process.exitCode = 1;
  } finally {
    conn.release();
    await getPool().end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "fatal", message: err.message }, usage: usage() }, null, 2));
  process.exitCode = 1;
});
