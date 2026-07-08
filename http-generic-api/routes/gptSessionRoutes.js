import { Router } from "express";
import { getPool } from "../db.js";
import { exportSessionToDrive } from "../sessionExportPipeline.js";
import { closeGptSessionArchive, recordGptSessionTurn } from "../sessionArchiveService.js";
import { summarizeSessionIfNeeded, writeProvidedSessionSummary } from "../sessionSummaryService.js";
import {
  capabilityFamilyAuthorizationError,
  resolveToolCapabilityFamilyAuthorization,
} from "../toolCapabilityFamilyAuthorization.js";

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
    correction_reason: String(body.correction_reason || body.reason || "").trim().slice(0, 512) || null,
    metadata_json: JSON.stringify({
      known_interfaces: CHATGPT_INTERFACES,
      note: "Personal ChatGPT conversation URLs are private to the GPT account owner; share URLs are optional public/shareable references.",
      secrets_included: false,
    }),
  };
}

function buildConversationRefCaptureCurrentInput(body = {}) {
  const rawUrl = body.current_url || body.active_tab_url || body.location_href || body.conversation_url || body.share_url || null;
  if (!rawUrl) {
    const err = new Error("current_url, active_tab_url, location_href, conversation_url, or share_url is required.");
    err.code = "missing_current_chatgpt_url";
    throw err;
  }
  const source = String(body.source || "browser_connector").trim().slice(0, 64);
  const allowedSources = new Set(["browser_connector", "browser_extension", "local_connector", "manual_user_supplied"]);
  if (!allowedSources.has(source)) {
    const err = new Error("source must be browser_connector, browser_extension, local_connector, or manual_user_supplied.");
    err.code = "invalid_capture_source";
    throw err;
  }
  const parsed = parseChatGptUrl(rawUrl);
  const nextBody = {
    ...body,
    source,
    captured_by: String(body.captured_by || source).trim().slice(0, 128),
    correction_reason: body.correction_reason || body.reason || `Captured current ChatGPT URL via ${source}; primary session must be activation_session_context.current_session_id.`,
  };
  if (parsed.url_kind === "share_url") {
    nextBody.share_url = parsed.url;
    delete nextBody.conversation_url;
    delete nextBody.personal_conversation_url;
  } else {
    nextBody.conversation_url = parsed.url;
  }
  return nextBody;
}

function conversationRefSelectSql() {
  return `SELECT ref_id, session_id, interface_scope, interface_display_name,
                 gpt_app_id, gpt_slug, conversation_id, personal_conversation_url,
                 share_id, share_url, source, captured_by, status,
                 COALESCE(is_primary, 0) AS is_primary,
                 superseded_by_ref_id, superseded_at, correction_reason,
                 created_at, updated_at
            FROM \`gpt_session_conversation_refs\``;
}

async function listConversationRefs(pool, sessionId, { includeSuperseded = true } = {}) {
  const statusFilter = includeSuperseded ? "" : " AND status = 'active'";
  const [rows] = await pool.query(
    `${conversationRefSelectSql()}
      WHERE session_id = ?${statusFilter}
      ORDER BY is_primary DESC, updated_at DESC
      LIMIT 20`,
    [sessionId]
  );
  return rows;
}

async function upsertConversationRef(pool, session, ref) {
  await pool.query(
    `INSERT INTO \`gpt_session_conversation_refs\`
       (ref_id, session_id, tenant_id, user_id, interface_scope, interface_display_name,
        gpt_app_id, gpt_slug, conversation_id, personal_conversation_url,
        share_id, share_url, source, captured_by, status, metadata_json, correction_reason)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       tenant_id = VALUES(tenant_id),
       user_id = VALUES(user_id),
       interface_scope = VALUES(interface_scope),
       interface_display_name = VALUES(interface_display_name),
       gpt_slug = VALUES(gpt_slug),
       personal_conversation_url = COALESCE(VALUES(personal_conversation_url), personal_conversation_url),
       share_id = COALESCE(VALUES(share_id), share_id),
       share_url = COALESCE(VALUES(share_url), share_url),
       source = VALUES(source),
       captured_by = VALUES(captured_by),
       status = 'active',
       metadata_json = VALUES(metadata_json),
       correction_reason = COALESCE(VALUES(correction_reason), correction_reason),
       updated_at = NOW()`,
    [
      session.session_id,
      session.tenant_id || null,
      session.user_id || null,
      ref.interface_scope,
      ref.interface_display_name,
      ref.gpt_app_id,
      ref.gpt_slug,
      ref.conversation_id,
      ref.personal_conversation_url,
      ref.share_id,
      ref.share_url,
      ref.source,
      ref.captured_by,
      ref.metadata_json,
      ref.correction_reason,
    ]
  );
}

async function findConversationRefTarget(pool, sessionId, body = {}) {
  const refId = String(body.ref_id || "").trim();
  if (refId) {
    const [rows] = await pool.query(`${conversationRefSelectSql()} WHERE session_id = ? AND ref_id = ? LIMIT 1`, [sessionId, refId]);
    return rows[0] || null;
  }
  const ref = buildConversationRefInput(body);
  const where = [];
  const params = [sessionId];
  if (ref.conversation_id) {
    where.push("conversation_id = ?");
    params.push(ref.conversation_id);
    if (ref.gpt_app_id) {
      where.push("gpt_app_id = ?");
      params.push(ref.gpt_app_id);
    }
  } else if (ref.share_id) {
    where.push("share_id = ?");
    params.push(ref.share_id);
  }
  if (!where.length) return null;
  const [rows] = await pool.query(
    `${conversationRefSelectSql()} WHERE session_id = ? AND ${where.join(" AND ")} ORDER BY updated_at DESC LIMIT 1`,
    params
  );
  return rows[0] || null;
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
  const workspace_key = String(turn.workspace_key || turn.workspaceKey || "").trim() || null;
  const brand_key = String(turn.brand_key || turn.brandKey || turn.target_key || turn.targetKey || "").trim() || null;
  const business_type_key = String(turn.business_type_key || turn.businessTypeKey || "").trim() || null;
  const business_activity_type_key = String(turn.business_activity_type_key || turn.businessActivityTypeKey || turn.activity_type_key || turn.activityTypeKey || "").trim() || null;
  const activity_key = String(turn.activity_key || turn.activityKey || "").trim() || null;
  const knowledge_profile_key = String(turn.knowledge_profile_key || turn.knowledgeProfileKey || "").trim() || null;
  return { ok: true, turn: { role, content, action_key: turn.action_key || null, workspace_key, brand_key, business_type_key, business_activity_type_key, activity_key, knowledge_profile_key } };
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

  // POST /gpt/sessions/:id/conversation-ref
  router.post("/gpt/sessions/:id/conversation-ref", requireBackendApiKey, async (req, res) => {
    const pool = getPool();
    try {
      const session = await resolveSessionForCaller(pool, req.params.id, req);
      if (!session) {
        return res.status(404).json({ ok: false, error: { code: "session_not_found", message: "Session not found." } });
      }
      const ref = buildConversationRefInput(req.body || {});
      await upsertConversationRef(pool, session, ref);
      const rows = await listConversationRefs(pool, session.session_id);
      return res.status(200).json({
        ok: true,
        session_id: session.session_id,
        conversation_ref: rows[0] || null,
        conversation_refs: rows,
        supported_interfaces: CHATGPT_INTERFACES,
        visibility_note: "Personal ChatGPT conversation URLs are private to the GPT account owner; share URLs may be used when a shareable reference is needed.",
        secrets_included: false,
      });
    } catch (err) {
      if (err.status === 403) return res.status(403).json({ ok: false, error: { code: "forbidden", message: err.message } });
      if (err.status === 404) return res.status(404).json({ ok: false, error: { code: err.code || "session_not_found", message: err.message } });
      if (["missing_conversation_ref", "invalid_conversation_url_kind", "invalid_share_url_kind", "unsupported_chatgpt_url"].includes(err.code)) {
        return res.status(400).json({ ok: false, error: { code: err.code, message: err.message } });
      }
      if (err instanceof TypeError || err.message?.includes("URL")) {
        return res.status(400).json({ ok: false, error: { code: "invalid_chatgpt_url", message: err.message } });
      }
      return res.status(500).json({ ok: false, error: { code: "conversation_ref_write_failed", message: err.message } });
    }
  });

  // POST /gpt/sessions/:id/conversation-ref/capture-current
  router.post("/gpt/sessions/:id/conversation-ref/capture-current", requireBackendApiKey, async (req, res) => {
    const pool = getPool();
    try {
      const session = await resolveSessionForCaller(pool, req.params.id, req);
      if (!session) {
        return res.status(404).json({ ok: false, error: { code: "session_not_found", message: "Session not found." } });
      }

      const capturedBody = buildConversationRefCaptureCurrentInput(req.body || {});
      const ref = buildConversationRefInput(capturedBody);
      await upsertConversationRef(pool, session, ref);
      const target = await findConversationRefTarget(pool, session.session_id, capturedBody);
      if (!target) {
        return res.status(404).json({ ok: false, error: { code: "conversation_ref_not_found", message: "Captured conversation reference was not found for this session." } });
      }

      const reason = String(capturedBody.correction_reason || "captured current ChatGPT URL from browser context").slice(0, 512);
      const supersedeParams = [target.ref_id, reason, session.session_id, target.ref_id];
      let matchClause = "";
      if (target.conversation_id) {
        matchClause = "conversation_id = ? AND COALESCE(gpt_app_id, '') = COALESCE(?, '')";
        supersedeParams.push(target.conversation_id, target.gpt_app_id || null);
      } else if (target.share_id) {
        matchClause = "share_id = ?";
        supersedeParams.push(target.share_id);
      } else {
        return res.status(400).json({ ok: false, error: { code: "conversation_ref_not_markable", message: "Captured reference needs a conversation_id or share_id before it can be marked primary." } });
      }

      await pool.query(
        `UPDATE \`gpt_session_conversation_refs\`
            SET is_primary = 0,
                status = 'superseded',
                superseded_by_ref_id = ?,
                superseded_at = NOW(),
                correction_reason = COALESCE(correction_reason, ?),
                updated_at = NOW()
          WHERE session_id <> ?
            AND ref_id <> ?
            AND ${matchClause}`,
        supersedeParams
      );

      await pool.query(
        `UPDATE \`gpt_session_conversation_refs\`
            SET is_primary = 1,
                status = 'active',
                superseded_by_ref_id = NULL,
                superseded_at = NULL,
                correction_reason = ?,
                updated_at = NOW()
          WHERE ref_id = ?
            AND session_id = ?`,
        [reason, target.ref_id, session.session_id]
      );

      const rows = await listConversationRefs(pool, session.session_id);
      return res.status(200).json({
        ok: true,
        session_id: session.session_id,
        captured_url_kind: target.conversation_id ? "personal_conversation_url" : "share_url",
        capture_source: capturedBody.source,
        primary_ref: rows.find((row) => row.ref_id === target.ref_id) || null,
        conversation_refs: rows,
        policy: {
          source_of_truth: "activation_session_context.current_session_id",
          supported_sources: ["browser_connector", "browser_extension", "local_connector", "manual_user_supplied"],
          old_session_refs_for_same_chatgpt_conversation: "superseded",
          secrets_included: false,
        },
      });
    } catch (err) {
      if (err.status === 403) return res.status(403).json({ ok: false, error: { code: "forbidden", message: err.message } });
      if (err.status === 404) return res.status(404).json({ ok: false, error: { code: err.code || "session_not_found", message: err.message } });
      if (["missing_current_chatgpt_url", "invalid_capture_source", "missing_conversation_ref", "invalid_conversation_url_kind", "invalid_share_url_kind", "unsupported_chatgpt_url"].includes(err.code)) {
        return res.status(400).json({ ok: false, error: { code: err.code, message: err.message } });
      }
      if (err instanceof TypeError || err.message?.includes("URL")) {
        return res.status(400).json({ ok: false, error: { code: "invalid_chatgpt_url", message: err.message } });
      }
      return res.status(500).json({ ok: false, error: { code: "conversation_ref_capture_failed", message: err.message } });
    }
  });

  // POST /gpt/sessions/:id/conversation-ref/mark-primary
  router.post("/gpt/sessions/:id/conversation-ref/mark-primary", requireBackendApiKey, async (req, res) => {
    const pool = getPool();
    try {
      const session = await resolveSessionForCaller(pool, req.params.id, req);
      if (!session) {
        return res.status(404).json({ ok: false, error: { code: "session_not_found", message: "Session not found." } });
      }

      if (!req.body?.ref_id) {
        const ref = buildConversationRefInput(req.body || {});
        await upsertConversationRef(pool, session, ref);
      }
      const target = await findConversationRefTarget(pool, session.session_id, req.body || {});
      if (!target) {
        return res.status(404).json({ ok: false, error: { code: "conversation_ref_not_found", message: "Conversation reference was not found for this session." } });
      }

      const reason = String(req.body?.correction_reason || req.body?.reason || "primary reference selected from current activation session evidence").slice(0, 512);
      const supersedeParams = [target.ref_id, reason, session.session_id, target.ref_id];
      let matchClause = "";
      if (target.conversation_id) {
        matchClause = "conversation_id = ? AND COALESCE(gpt_app_id, '') = COALESCE(?, '')";
        supersedeParams.push(target.conversation_id, target.gpt_app_id || null);
      } else if (target.share_id) {
        matchClause = "share_id = ?";
        supersedeParams.push(target.share_id);
      } else {
        return res.status(400).json({ ok: false, error: { code: "conversation_ref_not_markable", message: "Reference needs a conversation_id or share_id before it can be marked primary." } });
      }

      await pool.query(
        `UPDATE \`gpt_session_conversation_refs\`
            SET is_primary = 0,
                status = 'superseded',
                superseded_by_ref_id = ?,
                superseded_at = NOW(),
                correction_reason = COALESCE(correction_reason, ?),
                updated_at = NOW()
          WHERE session_id <> ?
            AND ref_id <> ?
            AND ${matchClause}`,
        supersedeParams
      );

      await pool.query(
        `UPDATE \`gpt_session_conversation_refs\`
            SET is_primary = 1,
                status = 'active',
                superseded_by_ref_id = NULL,
                superseded_at = NULL,
                correction_reason = ?,
                updated_at = NOW()
          WHERE ref_id = ?
            AND session_id = ?`,
        [reason, target.ref_id, session.session_id]
      );

      const [allRefs] = await pool.query(
        `${conversationRefSelectSql()}
          WHERE (conversation_id = ? AND COALESCE(gpt_app_id, '') = COALESCE(?, ''))
             OR (share_id IS NOT NULL AND share_id = ?)
          ORDER BY is_primary DESC, updated_at DESC
          LIMIT 25`,
        [target.conversation_id || "", target.gpt_app_id || null, target.share_id || ""]
      );
      const rows = await listConversationRefs(pool, session.session_id);
      return res.status(200).json({
        ok: true,
        session_id: session.session_id,
        primary_ref: rows.find((row) => row.ref_id === target.ref_id) || null,
        related_refs: allRefs,
        policy: {
          source_of_truth: "activation_session_context.current_session_id",
          old_session_refs_for_same_chatgpt_conversation: "superseded",
          secrets_included: false,
        },
      });
    } catch (err) {
      if (err.status === 403) return res.status(403).json({ ok: false, error: { code: "forbidden", message: err.message } });
      if (err.status === 404) return res.status(404).json({ ok: false, error: { code: err.code || "session_not_found", message: err.message } });
      if (["missing_conversation_ref", "invalid_conversation_url_kind", "invalid_share_url_kind", "unsupported_chatgpt_url"].includes(err.code)) {
        return res.status(400).json({ ok: false, error: { code: err.code, message: err.message } });
      }
      if (err instanceof TypeError || err.message?.includes("URL")) {
        return res.status(400).json({ ok: false, error: { code: "invalid_chatgpt_url", message: err.message } });
      }
      return res.status(500).json({ ok: false, error: { code: "conversation_ref_primary_failed", message: err.message } });
    }
  });

  // POST /gpt/sessions/:id/turn
  router.post("/gpt/sessions/:id/turn", requireBackendApiKey, async (req, res) => {
    const pool = getPool();
    try {
      const validation = validateTurnInput(req.body || {});
      if (!validation.ok) {
        return res.status(400).json({ ok: false, error: validation.error });
      }
      const {
        role,
        content,
        action_key = null,
        workspace_key = null,
        brand_key = null,
        business_type_key = null,
        business_activity_type_key = null,
        activity_key = null,
        knowledge_profile_key = null,
      } = validation.turn;

      const session = await resolveWritableSession(pool, req);
      const turnIndex = await nextTurnIndex(pool, session.session_id);

      const writeback = await recordGptSessionTurn({
        pool,
        session,
        role,
        content,
        action_key,
        turnIndex,
        workspace_key,
        brand_key,
        business_type_key,
        business_activity_type_key,
        activity_key,
        knowledge_profile_key,
      });

      return res.status(200).json({
        ok: true,
        session_id: session.session_id,
        turn_index: turnIndex,
        turn_id: writeback.turn_id,
        drive_doc_id: writeback.drive_doc_id,
        drive_doc_part: writeback.drive_doc_part,
        drive_anchor: writeback.drive_anchor,
        archive_status: writeback.archive_status,
      });
    } catch (err) {
      if (err.status === 403) return res.status(403).json({ ok: false, error: { code: "forbidden", message: err.message } });
      if (err.status === 404) return res.status(404).json({ ok: false, error: { code: err.code || "session_not_found", message: err.message } });
      if (err.status === 409) return res.status(409).json({ ok: false, error: { code: err.code || "session_closed", message: err.message } });
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

      const callerType = ["user_jwt", "api_credential"].includes(req.auth?.mode) ? "tenant" : "admin";
      const capabilityFamilyAuthorization = await resolveToolCapabilityFamilyAuthorization({
        pool,
        callerType,
        principal: {
          tenant_id: req.auth?.tenant_id || null,
          user_id: req.auth?.user_id || req.auth?.admin_id || null,
        },
        toolKey: "gpt_session_turns_write_batch",
        args: { id: req.params.id, turns: normalizedTurns },
        expectedFamily: "session_archive_write",
        requirePolicy: true,
      });
      if (!capabilityFamilyAuthorization.ok) {
        throw capabilityFamilyAuthorizationError(
          capabilityFamilyAuthorization,
          "Session archive write capability-family authorization denied this operation.",
        );
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
          workspace_key: turn.workspace_key,
          brand_key: turn.brand_key,
        });
        written.push({
          role: turn.role,
          turn_index: turnIndex,
          turn_id: writeback.turn_id,
          drive_doc_id: writeback.drive_doc_id,
          drive_doc_part: writeback.drive_doc_part,
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
