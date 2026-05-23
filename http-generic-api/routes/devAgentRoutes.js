// routes/devAgentRoutes.js — Developer agent growth loop endpoints.
//
// POST /dev-agent/run              — trigger a sweep (summarise sessions → extract proposals)
// GET  /dev-agent/runs             — list past sweeps
// GET  /dev-agent/proposals        — list proposals (filters: scope, status, priority, tenant_id)
// GET  /dev-agent/proposals/:id    — single proposal
// POST /dev-agent/proposals/:id/confirm   — confirm a proposal
// POST /dev-agent/proposals/:id/dismiss   — dismiss a proposal
// GET  /dev-agent/proposals/:id/discussion        — full discussion thread
// POST /dev-agent/proposals/:id/discussion        — send user message + get AI reply
// GET  /dev-agent/session-summaries               — recent session summaries

import { Router }           from "express";
import { randomUUID }       from "node:crypto";
import { getPool }          from "../db.js";
import { runDevAgentSweep } from "../devAgentRunner.js";
import { runSessionSummaryAutosweep } from "../sessionSummaryService.js";
import {
  loadAgentModelRuntimeSettings,
  saveAgentModelRuntimeSettings,
  summarizeModelRuntimeSettings,
} from "../agentModelRuntimeSettings.js";

// ── Discussion AI prompt ──────────────────────────────────────────────────────

function buildDiscussionSystemPrompt(proposal, userCtx) {
  return `You are a helpful AI platform advisor embedded in the user's growth intelligence OS.
You are discussing a specific platform improvement proposal with the user. Help them understand,
refine, and decide on this proposal using full knowledge of their context.

PROPOSAL:
  Title: ${proposal.title}
  Scope: ${proposal.scope} / Layer: ${proposal.layer || "general"}
  Priority: ${proposal.priority}
  Status: ${proposal.status}
  Description: ${proposal.description}
  Rationale: ${proposal.rationale || "Not specified"}

USER CONTEXT:
  Tenant: ${userCtx.tenant_id || "unknown"}
  Connected apps: ${userCtx.connected_apps?.map(a => `${a.app_name} (${a.app_key})`).join(", ") || "none"}
  Recent sessions: ${userCtx.recent_sessions?.length || 0} sessions in last 7 days
  Active workspaces: ${userCtx.workspace_keys?.join(", ") || "none"}

Be concrete and actionable. If the user confirms the proposal, acknowledge and suggest next steps.
If they want to refine it, help narrow scope and priority. Keep replies focused and under 300 words.`;
}

function sanitizeModelReadinessError(error) {
  const message = String(error?.message || error || "model_readiness_failed");
  const providerMatch = message.match(/\b(Anthropic|OpenAI|Gemini) API\s+(\d{3})/i);
  if (providerMatch) {
    return {
      code: "model_provider_error",
      provider: providerMatch[1].toLowerCase(),
      upstream_status: Number(providerMatch[2]),
      message: `${providerMatch[1]} API returned ${providerMatch[2]}`,
    };
  }
  if (/invalid\s+(x-api-key|api key|authorization|credentials?)/i.test(message)) {
    return { code: "invalid_model_credentials", message: "Model credentials are invalid." };
  }
  if (/missing\s+.*(api key|credential|token)/i.test(message)) {
    return { code: "missing_model_credentials", message: "Model credentials are missing." };
  }
  return { code: "model_readiness_failed", message: message.replace(/\{[\s\S]*\}/g, "[upstream_error_body_redacted]").slice(0, 240) };
}

async function resolveStandardCallModel(deps) {
  if (deps.getCallModelForClassAsync) return await deps.getCallModelForClassAsync("standard");
  if (deps.getCallModelForClass) return deps.getCallModelForClass("standard");
  return deps.callModel || null;
}

async function loadUserContext(tenant_id) {
  const ctx = { tenant_id, connected_apps: [], recent_sessions: [], workspace_keys: [] };

  // Recent sessions
  const [sessions] = await getPool().query(
    `SELECT session_id, model_name, turn_count, started_at, workspace_key
     FROM \`customer_sessions\`
     WHERE tenant_id = ? AND started_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
     ORDER BY started_at DESC LIMIT 10`,
    [tenant_id]
  ).catch(() => [[]]);
  ctx.recent_sessions = sessions;

  // Workspace keys
  const [ws] = await getPool().query(
    "SELECT workspace_key FROM `workspace_registry` WHERE tenant_id = ? AND status = 'active' LIMIT 20",
    [tenant_id]
  ).catch(() => [[]]);
  ctx.workspace_keys = ws.map(r => r.workspace_key);

  // App connections (metadata only — no tokens)
  const [conns] = await getPool().query(
    `SELECT uac.app_key, ai.display_name AS app_name, uac.account_label
     FROM \`user_app_connections\` uac
     JOIN \`app_integrations\` ai ON ai.app_key = uac.app_key
     WHERE uac.tenant_id = ? AND uac.status = 'active'
     ORDER BY uac.app_key`,
    [tenant_id]
  ).catch(() => [[]]);
  ctx.connected_apps = conns;

  return ctx;
}

// ── Router ────────────────────────────────────────────────────────────────────

export function buildDevAgentRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();
  router.use(requireBackendApiKey);

  // ── GET /dev-agent/model-readiness ────────────────────────────────────────
  router.get("/dev-agent/model-readiness", async (req, res) => {
    const selection = deps.resolveAgentModelProviderAsync
      ? await deps.resolveAgentModelProviderAsync("standard", process.env)
      : {
          provider: deps.resolveAgentModelProvider
            ? deps.resolveAgentModelProvider(process.env)
            : String(process.env.AGENT_MODEL_PROVIDER || "anthropic").toLowerCase(),
          model: process.env.AGENT_MODEL || null,
          source: "legacy_env",
          explicit_provider: String(process.env.AGENT_MODEL_PROVIDER || "").trim().toLowerCase() || null,
        };
    const provider = selection.provider;
    const explicit_provider = selection.explicit_provider || null;
    const modelOverride = Boolean(process.env.AGENT_MODEL);
    const envPresence = {
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY),
    };

    try {
      const callModel = deps.getCallModelForClass
        ? deps.getCallModelForClass("standard")
        : deps.callModel;

      if (!callModel) {
        return res.status(503).json({
          ok: false,
          readiness: "blocked",
          provider,
          model: selection.model || null,
          selection_source: selection.source || "unknown",
          explicit_provider,
          model_override: modelOverride,
          env_presence: envPresence,
          error: { code: "call_model_not_configured", message: "callModel is not wired into route dependencies." },
        });
      }

      const response = await callModel([
        { role: "system", content: "Return only JSON." },
        { role: "user", content: "Return {\"ok\":true,\"purpose\":\"model_readiness\"}." },
      ], []);

      return res.json({
        ok: true,
        readiness: "active",
        provider,
        model_override: modelOverride,
        env_presence: envPresence,
        response_shape: {
          has_content: typeof response?.content === "string" && response.content.length > 0,
          has_tool_calls: Array.isArray(response?.tool_calls),
          tokens_used: Number(response?.tokens_used || 0),
        },
      });
    } catch (err) {
      const error = sanitizeModelReadinessError(err);
      return res.status(error.upstream_status === 401 ? 401 : 503).json({
        ok: false,
        readiness: "blocked",
        provider,
        model_override: modelOverride,
        env_presence: envPresence,
        error,
      });
    }
  });

  // ── GET/PATCH /dev-agent/model-settings ──────────────────────────────────
  router.get("/dev-agent/model-settings", async (req, res) => {
    try {
      const state = await loadAgentModelRuntimeSettings({ force: req.query.force === "true" });
      res.json({
        ok: true,
        source: state.source,
        updated_at: state.updated_at || null,
        settings: summarizeModelRuntimeSettings(state.config, process.env),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: "model_settings_read_failed", message: err.message } });
    }
  });

  router.patch("/dev-agent/model-settings", async (req, res) => {
    try {
      const body = req.body || {};
      const payload = body.settings && typeof body.settings === "object" ? body.settings : body;
      const result = await saveAgentModelRuntimeSettings({ config: payload });
      res.json({
        ok: true,
        settings: summarizeModelRuntimeSettings(result.config, process.env),
      });
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ ok: false, error: { code: err.code || "model_settings_update_failed", message: err.message } });
    }
  });

  // ── POST /dev-agent/run ───────────────────────────────────────────────────
  router.post("/dev-agent/run", async (req, res) => {
    try {
      const callModel = await resolveStandardCallModel(deps);

      if (!callModel) return res.status(503).json({ ok: false, error: "callModel not configured" });

      // Run async — respond immediately with run_id, sweep continues in background
      const run_id = randomUUID();
      res.json({ ok: true, run_id, message: "Dev agent sweep started" });

      // Fire-and-forget (don't await — let it complete in background)
      runDevAgentSweep({ ...deps, callModel, run_id })
        .then(result => {
          console.log(`[devAgent] sweep ${result.run_id} done:`, result);
        })
        .catch(err => {
          console.error(`[devAgent] sweep error:`, err?.message);
        });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── POST /dev-agent/session-summaries/autosweep ─────────────────────────
  router.post("/dev-agent/session-summaries/autosweep", async (req, res) => {
    try {
      const callModel = await resolveStandardCallModel(deps);
      const body = req.body || {};
      const result = await runSessionSummaryAutosweep({
        pool: getPool(),
        callModel: callModel || null,
        limit: Math.min(Number(body.limit || req.query.limit || 20), 100),
        minTurnCount: Math.max(Number(body.min_turn_count || req.query.min_turn_count || 1), 1),
        includeActiveLong: body.include_active_long === true || req.query.include_active_long === "true",
        activeTurnThreshold: Math.max(Number(body.active_turn_threshold || req.query.active_turn_threshold || 80), 1),
        minNewTurns: Math.max(Number(body.min_new_turns || req.query.min_new_turns || 10), 1),
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: "session_summary_autosweep_failed", message: err.message } });
    }
  });

  // ── GET /dev-agent/runs ───────────────────────────────────────────────────
  router.get("/dev-agent/runs", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const [rows] = await getPool().query(
        `SELECT run_id, status, sessions_analyzed, summaries_created,
                proposals_created, proposals_updated, run_summary,
                started_at, completed_at
         FROM \`dev_agent_runs\`
         ORDER BY started_at DESC LIMIT ?`,
        [limit]
      );
      res.json({ ok: true, runs: rows });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── GET /dev-agent/proposals ──────────────────────────────────────────────
  router.get("/dev-agent/proposals", async (req, res) => {
    try {
      const { scope, status, priority, tenant_id, limit: lim = 50, offset: off = 0 } = req.query;
      const where = ["1=1"];
      const params = [];

      if (scope)     { where.push("scope = ?");     params.push(scope); }
      if (status)    { where.push("status = ?");    params.push(status); }
      if (priority)  { where.push("priority = ?");  params.push(priority); }
      if (tenant_id) { where.push("tenant_id = ?"); params.push(tenant_id); }

      const [rows] = await getPool().query(
        `SELECT proposal_id, tenant_id, scope, layer, title, description,
                rationale, priority, status, evidence_session_ids,
                confirmed_by, confirmed_at, dismissed_by, dismissed_at,
                created_at, updated_at
         FROM \`dev_agent_proposals\`
         WHERE ${where.join(" AND ")}
         ORDER BY
           FIELD(priority, 'critical', 'high', 'medium', 'low'),
           FIELD(status, 'pending', 'in_discussion', 'confirmed', 'implemented', 'dismissed'),
           created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, parseInt(lim), parseInt(off)]
      );
      res.json({ ok: true, proposals: rows });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── GET /dev-agent/proposals/:id ─────────────────────────────────────────
  router.get("/dev-agent/proposals/:id", async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT * FROM `dev_agent_proposals` WHERE proposal_id = ? LIMIT 1",
        [req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ ok: false, error: "proposal_not_found" });
      res.json({ ok: true, proposal: rows[0] });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── POST /dev-agent/proposals/:id/confirm ────────────────────────────────
  router.post("/dev-agent/proposals/:id/confirm", async (req, res) => {
    try {
      const { confirmed_by, implementation_notes } = req.body || {};
      const [result] = await getPool().query(
        `UPDATE \`dev_agent_proposals\`
           SET status = 'confirmed', confirmed_by = ?, confirmed_at = NOW(),
               implementation_notes = COALESCE(?, implementation_notes)
         WHERE proposal_id = ? AND status IN ('pending','in_discussion')`,
        [confirmed_by || null, implementation_notes || null, req.params.id]
      );
      if (!result.affectedRows) return res.status(404).json({ ok: false, error: "proposal_not_found_or_already_actioned" });
      res.json({ ok: true, proposal_id: req.params.id, status: "confirmed" });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── POST /dev-agent/proposals/:id/dismiss ────────────────────────────────
  router.post("/dev-agent/proposals/:id/dismiss", async (req, res) => {
    try {
      const { dismissed_by } = req.body || {};
      const [result] = await getPool().query(
        `UPDATE \`dev_agent_proposals\`
           SET status = 'dismissed', dismissed_by = ?, dismissed_at = NOW()
         WHERE proposal_id = ? AND status IN ('pending','in_discussion')`,
        [dismissed_by || null, req.params.id]
      );
      if (!result.affectedRows) return res.status(404).json({ ok: false, error: "proposal_not_found_or_already_actioned" });
      res.json({ ok: true, proposal_id: req.params.id, status: "dismissed" });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── GET /dev-agent/proposals/:id/discussion ──────────────────────────────
  router.get("/dev-agent/proposals/:id/discussion", async (req, res) => {
    try {
      const [messages] = await getPool().query(
        `SELECT message_id, role, content, user_id, model_used, created_at
         FROM \`proposal_discussions\`
         WHERE proposal_id = ?
         ORDER BY created_at ASC`,
        [req.params.id]
      );
      res.json({ ok: true, proposal_id: req.params.id, messages });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── POST /dev-agent/proposals/:id/discussion ─────────────────────────────
  router.post("/dev-agent/proposals/:id/discussion", async (req, res) => {
    try {
      const { message, user_id, tenant_id } = req.body || {};
      if (!message) return res.status(400).json({ ok: false, error: "message required" });

      // Load proposal
      const [propRows] = await getPool().query(
        "SELECT * FROM `dev_agent_proposals` WHERE proposal_id = ? LIMIT 1",
        [req.params.id]
      );
      if (!propRows[0]) return res.status(404).json({ ok: false, error: "proposal_not_found" });
      const proposal = propRows[0];

      // Load conversation history
      const [history] = await getPool().query(
        `SELECT role, content FROM \`proposal_discussions\`
         WHERE proposal_id = ? ORDER BY created_at ASC LIMIT 40`,
        [req.params.id]
      );

      // Load user context
      const userCtx = tenant_id ? await loadUserContext(tenant_id) : { tenant_id: null };

      // Persist user message
      const userMsgId = randomUUID();
      await getPool().query(
        `INSERT INTO \`proposal_discussions\`
           (message_id, proposal_id, tenant_id, user_id, role, content)
         VALUES (?, ?, ?, ?, 'user', ?)`,
        [userMsgId, req.params.id, tenant_id || null, user_id || null, message]
      );

      // Update proposal status to in_discussion if still pending
      await getPool().query(
        `UPDATE \`dev_agent_proposals\` SET status = 'in_discussion'
         WHERE proposal_id = ? AND status = 'pending'`,
        [req.params.id]
      ).catch(() => {});

      // Build LLM messages
      const callModel = await resolveStandardCallModel(deps);

      if (!callModel) {
        return res.status(503).json({ ok: false, error: "callModel not configured" });
      }

      const llmMessages = [
        { role: "system", content: buildDiscussionSystemPrompt(proposal, userCtx) },
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: "user", content: message },
      ];

      const response = await callModel(llmMessages, []);
      const aiText = typeof response.content === "string"
        ? response.content
        : (response.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");

      // Persist AI reply
      const aiMsgId = randomUUID();
      const modelName = response.model || "unknown";
      await getPool().query(
        `INSERT INTO \`proposal_discussions\`
           (message_id, proposal_id, tenant_id, user_id, role, content,
            context_snapshot, model_used)
         VALUES (?, ?, ?, NULL, 'assistant', ?, ?, ?)`,
        [
          aiMsgId,
          req.params.id,
          tenant_id || null,
          aiText,
          JSON.stringify({ proposal_id: req.params.id, user_context_loaded: Boolean(tenant_id) }),
          modelName,
        ]
      );

      res.json({
        ok: true,
        user_message_id:      userMsgId,
        assistant_message_id: aiMsgId,
        reply:                aiText,
        model:                modelName,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── GET /dev-agent/session-summaries ─────────────────────────────────────
  router.get("/dev-agent/session-summaries", async (req, res) => {
    try {
      const { tenant_id, analyzed, limit: lim = 30 } = req.query;
      const where = ["1=1"];
      const params = [];

      if (tenant_id) { where.push("tenant_id = ?"); params.push(tenant_id); }
      if (analyzed !== undefined) { where.push("analyzed = ?"); params.push(analyzed === "true" ? 1 : 0); }

      const [rows] = await getPool().query(
        `SELECT summary_id, session_id, tenant_id, user_id, workspace_key,
                summary_text, tasks_completed, blockers, feature_requests,
                integration_needs, complexity, turn_count, analyzed, created_at
         FROM \`session_summaries\`
         WHERE ${where.join(" AND ")}
         ORDER BY created_at DESC LIMIT ?`,
        [...params, parseInt(lim)]
      );
      res.json({ ok: true, summaries: rows });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
