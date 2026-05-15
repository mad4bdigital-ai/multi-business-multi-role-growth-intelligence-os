import { Router } from "express";
import { getPool } from "../db.js";
import { exportSessionToDrive } from "../sessionExportPipeline.js";

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

      await pool.query(
        `INSERT INTO \`gpt_session_turns\` (session_id, turn_index, role, content, action_key, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [session.session_id, turnIndex, role, content, action_key]
      );

      await pool.query(
        "UPDATE `customer_sessions` SET turn_count = COALESCE(turn_count, 0) + 1 WHERE session_id = ?",
        [session.session_id]
      );

      await pool.query(
        `INSERT INTO \`session_events\` (event_id, session_id, record_type, event_type, payload_json, event_timestamp)
         VALUES (UUID(), ?, 'message', ?, ?, NOW())`,
        [session.session_id, role, JSON.stringify({ role, content, action_key })]
      );

      return res.status(200).json({ ok: true, session_id: session.session_id, turn_index: turnIndex });
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

      if (summary) {
        await pool.query(
          "INSERT INTO `session_summaries` (session_id, summary_text, created_at) VALUES (?, ?, NOW())",
          [session.session_id, summary]
        );
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
