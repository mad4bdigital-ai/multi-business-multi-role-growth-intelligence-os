import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { exportSessionToDrive } from "../sessionExportPipeline.js";
import { closeGptSessionArchive, recordGptSessionTurn } from "../sessionArchiveService.js";
import { summarizeSessionIfNeeded, writeProvidedSessionSummary } from "../sessionSummaryService.js";

async function resolveSessionForCaller(pool, sessionId, req) {
  const [rows] = await pool.query(
    "SELECT * FROM `customer_sessions` WHERE session_id = ? LIMIT 1",
    [sessionId]
  );
  const session = rows[0];
  if (!session) return null;

  const isUserAuth = req.auth?.mode === "user_jwt" || req.auth?.mode === "api_credential";
  if (isUserAuth && session.user_id && session.user_id !== req.auth.user_id) {
    const err = new Error("Session belongs to a different user.");
    err.status = 403;
    throw err;
  }
  return session;
}

export function buildGptSessionRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // POST /gpt/sessions/:id/turn
  router.post("/gpt/sessions/:id/turn", requireBackendApiKey, async (req, res) => {
    const pool = getPool();
    try {
      const { role, content, action_key = null } = req.body || {};
      if (!role || !content) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "role and content are required." } });
      }
      if (!["user", "assistant", "tool"].includes(role)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_role", message: "role must be user, assistant, or tool." } });
      }

      const session = await resolveSessionForCaller(pool, req.params.id, req);
      if (!session) {
        return res.status(404).json({ ok: false, error: { code: "session_not_found", message: "Session not found." } });
      }
      if (session.session_status === "completed" || session.session_status === "closed") {
        return res.status(409).json({ ok: false, error: { code: "session_closed", message: "Cannot add turns to a closed session." } });
      }

      const [[{ max_idx }]] = await pool.query(
        "SELECT COALESCE(MAX(turn_index), -1) AS max_idx FROM `gpt_session_turns` WHERE session_id = ?",
        [session.session_id]
      );
      const turnIndex = Number(max_idx) + 1;

      const writeback = await recordGptSessionTurn({
        pool,
        session,
        role,
        content,
        action_key,
        turnIndex,
      });

      return res.status(200).json({
        ok: true,
        session_id: session.session_id,
        turn_index: turnIndex,
        turn_id: writeback.turn_id,
        drive_doc_id: writeback.drive_doc_id,
        drive_anchor: writeback.drive_anchor,
        archive_status: writeback.archive_status,
      });
    } catch (err) {
      if (err.status === 403) return res.status(403).json({ ok: false, error: { code: "forbidden", message: err.message } });
      return res.status(500).json({ ok: false, error: { code: "turn_write_failed", message: err.message } });
    }
  });

  // POST /gpt/sessions/:id/end
  router.post("/gpt/sessions/:id/end", requireBackendApiKey, async (req, res) => {
    const pool = getPool();
    try {
      const { summary = null, user_email = null } = req.body || {};

      const session = await resolveSessionForCaller(pool, req.params.id, req);
      if (!session) {
        return res.status(404).json({ ok: false, error: { code: "session_not_found", message: "Session not found." } });
      }
      if (session.session_status === "completed" || session.session_status === "closed") {
        return res.status(409).json({ ok: false, error: { code: "session_already_ended", message: "Session is already closed." } });
      }

      await pool.query(
        "UPDATE `customer_sessions` SET session_status = 'completed', ended_at = NOW() WHERE session_id = ?",
        [session.session_id]
      );

      const archiveClose = await closeGptSessionArchive({ pool, session, summary });

      const [[freshSession]] = await pool.query(
        "SELECT * FROM `customer_sessions` WHERE session_id = ? LIMIT 1",
        [session.session_id]
      );
      const sessionForSummary = freshSession || session;
      let summaryResult = null;
      try {
        if (summary) {
          summaryResult = await writeProvidedSessionSummary({ pool, session: sessionForSummary, summaryText: summary });
        } else {
          const callModel = deps.getCallModelForClass
            ? deps.getCallModelForClass("standard")
            : deps.callModel;
          summaryResult = await summarizeSessionIfNeeded({ pool, session: sessionForSummary, callModel });
        }
      } catch (summaryErr) {
        summaryResult = { ok: false, error: { code: "session_summary_failed", message: summaryErr.message } };
      }

      let driveResult = null;
      try {
        driveResult = await exportSessionToDrive(session.session_id, user_email);
      } catch (exportErr) {
        console.warn(`[gpt-sessions] Drive export failed for ${session.session_id}:`, exportErr.message);
      }

      return res.status(200).json({
        ok: true,
        session_id: session.session_id,
        archive: archiveClose,
        session_summary: summaryResult,
        drive_export: driveResult
          ? { drive_file_id: driveResult.drive_file_id, drive_web_url: driveResult.drive_web_url }
          : null,
      });
    } catch (err) {
      if (err.status === 403) return res.status(403).json({ ok: false, error: { code: "forbidden", message: err.message } });
      return res.status(500).json({ ok: false, error: { code: "session_end_failed", message: err.message } });
    }
  });

  return router;
}
