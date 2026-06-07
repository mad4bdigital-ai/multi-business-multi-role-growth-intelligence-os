import { Router } from "express";
import { getPool } from "../db.js";
import { exportSessionToDrive } from "../sessionExportPipeline.js";
import { closeGptSessionArchive, recordGptSessionTurn } from "../sessionArchiveService.js";
import { summarizeSessionIfNeeded, writeProvidedSessionSummary } from "../sessionSummaryService.js";

const VALID_TURN_ROLES = new Set(["user", "assistant", "tool"]);
const MAX_BATCH_TURNS = 20;

const CHATGPT_INTERFACES = Object.freeze({
  "g-69c82c73bd6081918c52e38525b2d154": {
    interface_scope: "admin_custom_gpt",
    display_name: "Growth Intelligence Platform Admin Assistant",
    expected_url_prefix: "https://chatgpt.com/g/g-69c82c73bd6081918c52e38525b2d154-growth-intelligence-platform-admin-assistant",
  },
  "g-69b6e4de8fd88191ac132362e1ee300e": {
    interface_scope: "tenant_custom_gpt",
    display_name: "MAD4B Growth Intelligence Tenant",
    expected_url_prefix: "https://chatgpt.com/g/g-69b6e4de8fd88191ac132362e1ee300e-mad4b-growth-intelligence-tenant",
  },
});

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http/https URLs are supported.");
  if (!/(^|\.)chatgpt\.com$/i.test(url.hostname)) throw new Error("Only chatgpt.com conversation URLs are supported.");
  url.hash = "";
  return url.toString();
}

function parseChatGptUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "g" && parts[1] && parts[2] === "c" && parts[3]) {
    const gptMatch = parts[1].match(/^(g-[a-z0-9]+)(?:-(.*))?$/i);
    return {
      url: normalized,
      url_kind: "personal_conversation_url",
      gpt_app_id: gptMatch?.[1] || null,
      gpt_slug: gptMatch?.[2] || null,
      conversation_id: parts[3],
      share_id: null,
    };
  }
  if (parts[0] === "c" && parts[1]) {
    return {
      url: normalized,
      url_kind: "personal_conversation_url",
      gpt_app_id: null,
      gpt_slug: null,
      conversation_id: parts[1],
      share_id: null,
    };
  }
  if (parts[0] === "share" && parts[1]) {
    return {
      url: normalized,
      url_kind: "share_url",
      gpt_app_id: null,
      gpt_slug: null,
      conversation_id: null,
      share_id: parts[1],
    };
  }
  const err = new Error("Unsupported ChatGPT conversation URL format.");
  err.code = "unsupported_chatgpt_url";
  throw err;
}

function resolveInterfaceScope({ gptAppId = null, interfaceHint = null } = {}) {
  const known = gptAppId ? CHATGPT_INTERFACES[gptAppId] : null;
  const hint = String(interfaceHint || "").trim();
  if (known) return { ...known, gpt_app_id: gptAppId, source: "known_gpt_url" };
  if (["admin_custom_gpt", "tenant_custom_gpt"].includes(hint)) {
    return { interface_scope: hint, display_name: hint, expected_url_prefix: null, gpt_app_id: gptAppId || null, source: "interface_hint" };
  }
  return { interface_scope: "unknown_custom_gpt", display_name: "Unknown ChatGPT interface", expected_url_prefix: null, gpt_app_id: gptAppId || null, source: "unknown" };
}

function buildConversationRefInput(body = {}) {
  const personal = parseChatGptUrl(body.conversation_url || body.personal_conversation_url || null);
  const share = parseChatGptUrl(body.share_url || null);
  if (personal && personal.url_kind !== "personal_conversation_url") {
    const err = new Error("conversation_url must be a personal ChatGPT conversation URL.");
    err.code = "invalid_conversation_url_kind";
    throw err;
  }
  if (share && share.url_kind !== "share_url") {
    const err = new Error("share_url must be a ChatGPT share URL.");
    err.code = "invalid_share_url_kind";
    throw err;
  }
  if (!personal && !share) {
    const err = new Error("conversation_url or share_url is required.");
    err.code = "missing_conversation_ref";
    throw err;
  }

  const gptAppId = personal?.gpt_app_id || String(body.gpt_app_id || "").trim() || null;
  const iface = resolveInterfaceScope({ gptAppId, interfaceHint: body.interface_scope || body.interface_hint });
  return {
    interface_scope: iface.interface_scope,
    interface_display_name: iface.display_name,
    interface_source: iface.source,
    gpt_app_id: gptAppId,
    gpt_slug: personal?.gpt_slug || null,
    conversation_id: personal?.conversation_id || String(body.conversation_id || "").trim() || null,
    personal_conversation_url: personal?.url || null,
    share_id: share?.share_id || null,
    share_url: share?.url || null,
    source: String(body.source || "manual_user_supplied").trim().slice(0, 64),
    captured_by: String(body.captured_by || "custom_gpt").trim().slice(0, 128),
    metadata_json: JSON.stringify({
      known_interfaces: CHATGPT_INTERFACES,
      note: "Personal ChatGPT conversation URLs are private to the GPT account owner; share URLs are optional public/shareable references.",
      secrets_included: false,
    }),
  };
}

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

function validateTurnInput(turn = {}) {
  const role = String(turn.role || "").trim();
  const content = typeof turn.content === "string" ? turn.content : "";
  if (!role || !content) {
    return { ok: false, error: { code: "missing_fields", message: "role and content are required." } };
  }
  if (!VALID_TURN_ROLES.has(role)) {
    return { ok: false, error: { code: "invalid_role", message: "role must be user, assistant, or tool." } };
  }
  return { ok: true, turn: { role, content, action_key: turn.action_key || null } };
}

async function resolveWritableSession(pool, req) {
  const session = await resolveSessionForCaller(pool, req.params.id, req);
  if (!session) {
    const err = new Error("Session not found.");
    err.status = 404;
    err.code = "session_not_found";
    throw err;
  }
  if (session.session_status === "completed" || session.session_status === "closed") {
    const err = new Error("Cannot add turns to a closed session.");
    err.status = 409;
    err.code = "session_closed";
    throw err;
  }
  return session;
}

async function nextTurnIndex(pool, sessionId) {
  const [[{ max_idx }]] = await pool.query(
    "SELECT COALESCE(MAX(turn_index), -1) AS max_idx FROM `gpt_session_turns` WHERE session_id = ?",
    [sessionId]
  );
  return Number(max_idx) + 1;
}

export function buildGptSessionRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // POST /gpt/sessions/:id/turn
  router.post("/gpt/sessions/:id/turn", requireBackendApiKey, async (req, res) => {
    const pool = getPool();
    try {
      const validation = validateTurnInput(req.body || {});
      if (!validation.ok) {
        return res.status(400).json({ ok: false, error: validation.error });
      }
      const { role, content, action_key = null } = validation.turn;

      const session = await resolveWritableSession(pool, req);
      const turnIndex = await nextTurnIndex(pool, session.session_id);

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

  // POST /gpt/sessions/:id/turns
  router.post("/gpt/sessions/:id/turns", requireBackendApiKey, async (req, res) => {
    const pool = getPool();
    try {
      const turns = Array.isArray(req.body?.turns) ? req.body.turns : [];
      if (!turns.length || turns.length > MAX_BATCH_TURNS) {
        return res.status(400).json({
          ok: false,
          error: { code: "invalid_turn_batch", message: `turns must contain 1-${MAX_BATCH_TURNS} items.` },
        });
      }
      const normalizedTurns = [];
      for (const turn of turns) {
        const validation = validateTurnInput(turn);
        if (!validation.ok) {
          return res.status(400).json({ ok: false, error: validation.error });
        }
        normalizedTurns.push(validation.turn);
      }

      const session = await resolveWritableSession(pool, req);
      let turnIndex = await nextTurnIndex(pool, session.session_id);
      const written = [];
      for (const turn of normalizedTurns) {
        const writeback = await recordGptSessionTurn({
          pool,
          session,
          role: turn.role,
          content: turn.content,
          action_key: turn.action_key,
          turnIndex,
        });
        written.push({
          role: turn.role,
          turn_index: turnIndex,
          turn_id: writeback.turn_id,
          drive_doc_id: writeback.drive_doc_id,
          drive_anchor: writeback.drive_anchor,
          archive_status: writeback.archive_status,
        });
        turnIndex += 1;
      }

      return res.status(200).json({
        ok: true,
        session_id: session.session_id,
        turn_count: written.length,
        turns: written,
        capture_policy: {
          intended_use: "Call once per conversational exchange with the user prompt and assistant reply so Drive archives contain non-tool transcript turns.",
          sql_content_mode: "preview_hash_only",
          full_content_storage: "drive_doc_and_jsonl",
          secrets_included: false,
        },
      });
    } catch (err) {
      if (err.status === 403) return res.status(403).json({ ok: false, error: { code: "forbidden", message: err.message } });
      if (err.status === 404) return res.status(404).json({ ok: false, error: { code: err.code || "session_not_found", message: err.message } });
      if (err.status === 409) return res.status(409).json({ ok: false, error: { code: err.code || "session_closed", message: err.message } });
      return res.status(500).json({ ok: false, error: { code: "turn_batch_write_failed", message: err.message } });
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
