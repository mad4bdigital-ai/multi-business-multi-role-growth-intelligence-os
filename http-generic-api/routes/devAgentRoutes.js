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
import { runSessionSummaryAutosweep, summarizeTranscriptWithModel } from "../sessionSummaryService.js";
import { runN8nWorkflowRuntime } from "../n8nWorkflowRuntime.js";
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

async function resolveStandardCallModel(deps, taskClass = "summary") {
  if (deps.getCallModelForTaskAsync) return await deps.getCallModelForTaskAsync(taskClass, "standard");
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

function boundedPositiveInt(value, fallback, min = 1, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function normalizeComparisonText(value = "", limit = 12000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...[truncated]` : text;
}

function normalizeComparisonTurns(body = {}) {
  if (Array.isArray(body.turns) && body.turns.length) {
    return body.turns.slice(0, 80).map((turn, index) => ({
      turn_index: Number.isFinite(Number(turn.turn_index)) ? Number(turn.turn_index) : index,
      role: String(turn.role || "user"),
      content: normalizeComparisonText(turn.content || turn.text || ""),
      action_key: turn.action_key || null,
    })).filter((turn) => turn.content);
  }
  const text = normalizeComparisonText(body.text || body.content || body.input?.text || "");
  return text ? [{ turn_index: 0, role: "user", content: text, action_key: null }] : [];
}

function summarizeComparisonShape(result = {}) {
  const text = String(result.summary_text || result.summary || "");
  const bullets = Array.isArray(result.bullets) ? result.bullets : [];
  return {
    summary_chars: text.length,
    bullet_count: bullets.length,
    source: result.source || "current_model_summary",
    method: result.method || "model_backed",
  };
}

async function timedStep(fn) {
  const started = Date.now();
  try {
    const result = await fn();
    return { ok: true, latency_ms: Date.now() - started, result };
  } catch (err) {
    return { ok: false, latency_ms: Date.now() - started, error: { code: err.code || "summary_comparison_step_failed", message: String(err.message || err).slice(0, 240) } };
  }
}

function normalizeQualityScore(value) {
  if (value === undefined || value === null || value === "") return null;
  const score = Number(value);
  if (!Number.isFinite(score) || score < 1 || score > 5) {
    const err = new Error("quality scores must be integers between 1 and 5.");
    err.code = "summary_comparison_quality_score_invalid";
    err.status = 400;
    throw err;
  }
  return Math.round(score);
}

function normalizePreferredOutput(value) {
  const preferred = String(value || "").trim();
  const allowed = new Set(["current_model_summary", "n8n_experiment", "tie", "neither"]);
  if (!allowed.has(preferred)) {
    const err = new Error("preferred_output must be current_model_summary, n8n_experiment, tie, or neither.");
    err.code = "summary_comparison_preferred_output_invalid";
    err.status = 400;
    throw err;
  }
  return preferred;
}

function stableSignalKey(parts = []) {
  return parts
    .map((part) => String(part || "").trim().toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, "_").replace(/^_+|_+$/g, ""))
    .filter(Boolean)
    .join(":")
    .slice(0, 190);
}

function clampText(value, limit = 1000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function safeParseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function inferSignalPriority(type, evidence = "") {
  const text = String(evidence || "").toLowerCase();
  if (/security|secret|token|credential|auth|blocked|critical|production|canonical|فشل|خطر|سري/.test(text)) return "high";
  if (["blocker", "security_need", "runtime_gap"].includes(type)) return "high";
  if (["automation_need", "browser_need", "integration_need"].includes(type)) return "medium";
  return "medium";
}

function recommendedRuntimeForSignal(type, evidence = "") {
  const text = String(evidence || "").toLowerCase();
  if (/openclaude|coding agent|repo|patch|code|branch|pull request|pr\b/.test(text)) return "openclaude_essam_local_v1";
  if (/browser|inspect|screenshot|extract|scrap|crawl|dom|network|console|متصفح|استخراج|تشخيص/.test(text)) return null;
  if (/fallback|rate limit|429|openrouter/.test(text)) return "platform_openrouter_dev_agent_v1";
  return "platform_gemini_dev_agent_v1";
}

function buildSummaryDevelopmentSignal({ source_surface, source_ref, tenant_id, user_id, type, title, description, evidence, source_summary_id = null, source_comparison_id = null }) {
  const signalType = type || "feature_request";
  const safeTitle = clampText(title || evidence || signalType, 240);
  return {
    signal_id: randomUUID(),
    signal_key: stableSignalKey([source_surface, source_ref, signalType, safeTitle]),
    tenant_id: tenant_id || null,
    user_id: user_id || null,
    source_surface,
    source_ref: source_ref || null,
    source_summary_id,
    source_comparison_id,
    signal_type: signalType,
    title: safeTitle,
    description: clampText(description || evidence, 2000),
    evidence_text: clampText(evidence, 4000),
    recommended_runtime_key: recommendedRuntimeForSignal(signalType, evidence || description || title),
    recommended_action: "human_review",
    priority: inferSignalPriority(signalType, evidence || description || title),
    policy_json: JSON.stringify({
      auto_execute_code: false,
      auto_mutate_repo: false,
      requires_human_approval: true,
      agent_runtime_may_dry_run_only: true,
      secrets_included: false,
    }),
    metadata_json: JSON.stringify({ extracted_by: "summary_development_automation_v1" }),
  };
}

async function insertSummaryDevelopmentSignal(pool, signal) {
  const [result] = await pool.query(
    `INSERT INTO \`summary_development_signals\`
       (signal_id, signal_key, tenant_id, user_id, source_surface, source_ref,
        source_summary_id, source_comparison_id, signal_type, title, description,
        evidence_text, recommended_runtime_key, recommended_action, priority,
        status, policy_json, metadata_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, 'summary_development_automation_v1')
     ON DUPLICATE KEY UPDATE
       description = VALUES(description),
       evidence_text = VALUES(evidence_text),
       recommended_runtime_key = VALUES(recommended_runtime_key),
       priority = VALUES(priority),
       policy_json = VALUES(policy_json),
       metadata_json = VALUES(metadata_json),
       updated_at = CURRENT_TIMESTAMP`,
    [
      signal.signal_id,
      signal.signal_key,
      signal.tenant_id,
      signal.user_id,
      signal.source_surface,
      signal.source_ref,
      signal.source_summary_id,
      signal.source_comparison_id,
      signal.signal_type,
      signal.title,
      signal.description,
      signal.evidence_text,
      signal.recommended_runtime_key,
      signal.recommended_action,
      signal.priority,
      signal.policy_json,
      signal.metadata_json,
    ]
  );
  return result.affectedRows === 1 ? "created" : "updated";
}

async function persistSummaryComparisonRun({ pool = getPool(), payload, tenant_id = null, user_id = null, n8nBindingKey = "summary_n8n_experiment_v1" } = {}) {
  if (!payload?.comparison_id) return { ok: false, skipped: true, reason: "missing_comparison_id" };
  const modelShape = payload.current_model_summary?.shape || {};
  const n8nShape = payload.n8n_experiment?.shape || {};
  await pool.query(
    `INSERT INTO \`summary_comparison_runs\`
       (comparison_id, tenant_id, user_id, n8n_binding_key,
        input_text_chars, input_turn_count,
        current_model_ok, current_model_latency_ms, current_model_summary_chars,
        current_model_bullet_count, current_model_source, current_model_method,
        n8n_ok, n8n_latency_ms, n8n_summary_chars, n8n_bullet_count,
        n8n_source, n8n_method, faster_path,
        production_route_unchanged, writes_session_summaries, result_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`,
    [
      payload.comparison_id,
      tenant_id,
      user_id,
      n8nBindingKey,
      Number(payload.input?.text_chars || 0),
      Number(payload.input?.turn_count || 0),
      payload.current_model_summary?.ok ? 1 : 0,
      payload.current_model_summary?.latency_ms ?? null,
      modelShape.summary_chars ?? null,
      modelShape.bullet_count ?? null,
      modelShape.source || null,
      modelShape.method || null,
      payload.n8n_experiment?.ok ? 1 : 0,
      payload.n8n_experiment?.latency_ms ?? null,
      n8nShape.summary_chars ?? null,
      n8nShape.bullet_count ?? null,
      n8nShape.source || null,
      n8nShape.method || null,
      payload.comparison?.faster_path || null,
      JSON.stringify(payload),
    ]
  );
  return { ok: true, comparison_id: payload.comparison_id };
}

async function loadSessionSummaryHealth({ pool = getPool(), lookbackDays = 7, limit = 20 } = {}) {
  const [status_breakdown] = await pool.query(
    `SELECT execution_status, recovery_status, recovery_notes, COUNT(*) AS count, MAX(created_at) AS last_seen
     FROM \`execution_log\`
     WHERE entry_type = 'session_summary_autosweep'
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY execution_status, recovery_status, recovery_notes
     ORDER BY count DESC, last_seen DESC`,
    [lookbackDays]
  );

  const [daily_breakdown] = await pool.query(
    `SELECT DATE(created_at) AS day, execution_status, recovery_status, COUNT(*) AS count
     FROM \`execution_log\`
     WHERE entry_type = 'session_summary_autosweep'
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY DATE(created_at), execution_status, recovery_status
     ORDER BY day DESC, execution_status, recovery_status`,
    [lookbackDays]
  );

  const [archive_coverage] = await pool.query(
    `SELECT archive_status,
            COUNT(*) AS sessions,
            SUM(CASE WHEN drive_jsonl_id IS NULL OR drive_jsonl_id = '' THEN 1 ELSE 0 END) AS missing_drive_jsonl,
            SUM(CASE WHEN drive_jsonl_id IS NOT NULL AND drive_jsonl_id <> '' THEN 1 ELSE 0 END) AS has_drive_jsonl
     FROM \`customer_sessions\`
     WHERE originator = 'gpt_action'
       AND session_status IN ('completed', 'closed')
       AND started_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY archive_status
     ORDER BY sessions DESC`,
    [lookbackDays]
  );

  const [[summary_backlog]] = await pool.query(
    `SELECT COUNT(*) AS unsummarized_completed_sessions
     FROM \`customer_sessions\` cs
     LEFT JOIN \`session_summaries\` ss ON ss.session_id = cs.session_id
     WHERE cs.originator = 'gpt_action'
       AND cs.session_status IN ('completed', 'closed')
       AND cs.turn_count >= 1
       AND ss.summary_id IS NULL`
  );

  const [recent_runs] = await pool.query(
    `SELECT id, execution_status, recovery_status, recovery_notes, failure_reason,
            artifact_json_asset_id, execution_trace_id_writeback, created_at
     FROM \`execution_log\`
     WHERE entry_type = 'session_summary_autosweep'
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit]
  );

  const totalRuns = status_breakdown.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const warningRuns = status_breakdown
    .filter(row => String(row.execution_status || '').includes('warning') || (row.recovery_status && row.recovery_status !== 'not_required'))
    .reduce((sum, row) => sum + Number(row.count || 0), 0);
  const failedRuns = status_breakdown
    .filter(row => String(row.execution_status || '').toLowerCase() === 'failed')
    .reduce((sum, row) => sum + Number(row.count || 0), 0);

  return {
    ok: true,
    lookback_days: lookbackDays,
    totals: {
      summary_runs: totalRuns,
      warning_runs: warningRuns,
      failed_runs: failedRuns,
      unsummarized_completed_sessions: Number(summary_backlog?.unsummarized_completed_sessions || 0),
    },
    status_breakdown,
    daily_breakdown,
    archive_coverage,
    recent_runs,
  };
}

// ── Router ────────────────────────────────────────────────────────────────────

export function buildDevAgentRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();
  router.use(requireBackendApiKey);

  // ── GET /dev-agent/model-readiness ────────────────────────────────────────
  router.get("/dev-agent/model-readiness", async (req, res) => {
    const taskClass = String(req.query.task_class || "summary").trim() || "summary";
    const selection = deps.resolveAgentModelProviderAsync
      ? await deps.resolveAgentModelProviderAsync("standard", process.env, taskClass)
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
      const callModel = await resolveStandardCallModel(deps);

      if (!callModel) {
        return res.status(503).json({
          ok: false,
          readiness: "blocked",
          provider,
          model: selection.model || null,
          task_class: selection.task_class || taskClass,
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

  // ── POST /dev-agent/summary-comparison/run ───────────────────────────────
  router.post("/dev-agent/summary-comparison/run", async (req, res) => {
    const body = req.body || {};
    const comparison_id = randomUUID();
    const tenant_id = body.tenant_id || null;
    const user_id = body.user_id || null;
    const turns = normalizeComparisonTurns(body);
    if (!turns.length) {
      return res.status(400).json({
        ok: false,
        error: { code: "summary_comparison_input_required", message: "Provide text, content, input.text, or turns[]." },
      });
    }

    const text = turns.map((turn) => turn.content).join("\n\n");
    const n8nBindingKey = String(body.n8n_binding_key || "summary_n8n_experiment_v1").trim();
    const session = {
      session_id: `summary_comparison_${comparison_id}`,
      tenant_id: tenant_id || "00000000-0000-0000-0000-000000000000",
      user_id,
      turn_count: turns.length,
      workspace_key: "summary_comparison",
    };

    const modelStep = await timedStep(async () => {
      const callModel = await resolveStandardCallModel(deps, "summary");
      if (!callModel) {
        const err = new Error("callModel is not configured for summary comparison.");
        err.code = "call_model_not_configured";
        throw err;
      }
      const insight = await summarizeTranscriptWithModel({ session, turns, callModel });
      return {
        summary: insight.summary_text,
        tasks_completed: insight.tasks_completed || [],
        blockers: insight.blockers || [],
        feature_requests: insight.feature_requests || [],
        integration_needs: insight.integration_needs || [],
        complexity: insight.complexity || "medium",
        source: "current_model_summary",
        method: "sessionSummaryService.summarizeTranscriptWithModel",
      };
    });

    const n8nStep = await timedStep(async () => {
      const runtime = await runN8nWorkflowRuntime({
        pool: getPool(),
        binding_key: n8nBindingKey,
        tenant_id,
        user_id,
        input: {
          text,
          max_bullets: Number(body.max_bullets || 5),
          max_chars: Number(body.max_chars || 900),
        },
      });
      if (!runtime.ok) {
        const err = new Error(runtime.error?.message || "n8n summary experiment failed");
        err.code = runtime.error?.code || "n8n_summary_experiment_failed";
        throw err;
      }
      return runtime.result;
    });

    const payload = {
      ok: modelStep.ok && n8nStep.ok,
      comparison_id,
      production_route_unchanged: true,
      writes_session_summaries: false,
      input: {
        turn_count: turns.length,
        text_chars: text.length,
      },
      current_model_summary: {
        ...modelStep,
        shape: modelStep.ok ? summarizeComparisonShape(modelStep.result) : null,
      },
      n8n_experiment: {
        binding_key: n8nBindingKey,
        ...n8nStep,
        shape: n8nStep.ok ? summarizeComparisonShape(n8nStep.result) : null,
      },
      comparison: {
        model_latency_ms: modelStep.latency_ms,
        n8n_latency_ms: n8nStep.latency_ms,
        faster_path: modelStep.ok && n8nStep.ok
          ? (modelStep.latency_ms <= n8nStep.latency_ms ? "current_model_summary" : "n8n_experiment")
          : null,
        source_difference: modelStep.ok && n8nStep.ok
          ? `${modelStep.result.source || "current_model_summary"} vs ${n8nStep.result.source || "n8n_experiment"}`
          : null,
      },
      secrets_included: false,
    };

    let persistence = { ok: false, skipped: true };
    try {
      persistence = await persistSummaryComparisonRun({
        pool: getPool(),
        payload,
        tenant_id,
        user_id,
        n8nBindingKey,
      });
    } catch (err) {
      persistence = { ok: false, error: { code: "summary_comparison_persist_failed", message: String(err.message || err).slice(0, 240) } };
    }

    const statusCode = modelStep.ok && n8nStep.ok ? 200 : 207;
    return res.status(statusCode).json({ ...payload, persistence });
  });

  // ── POST /dev-agent/summary-comparison/score ─────────────────────────────
  router.post("/dev-agent/summary-comparison/score", async (req, res) => {
    try {
      const body = req.body || {};
      const comparisonId = String(body.comparison_id || "").trim();
      if (!comparisonId) {
        return res.status(400).json({ ok: false, error: { code: "comparison_id_required", message: "comparison_id is required." } });
      }
      const preferredOutput = normalizePreferredOutput(body.preferred_output);
      const qualityScoreModel = normalizeQualityScore(body.quality_score_model);
      const qualityScoreN8n = normalizeQualityScore(body.quality_score_n8n);
      const qualityNotes = String(body.quality_notes || "").trim().slice(0, 1000) || null;
      const useCaseFit = String(body.use_case_fit || "").trim().slice(0, 128) || null;
      const reviewedBy = String(body.reviewed_by || body.user_id || "").trim().slice(0, 64) || null;

      const [updateResult] = await getPool().query(
        `UPDATE \`summary_comparison_runs\`
         SET preferred_output = ?,
             quality_score_model = ?,
             quality_score_n8n = ?,
             quality_notes = ?,
             use_case_fit = ?,
             reviewed_by = ?,
             reviewed_at = NOW()
         WHERE comparison_id = ?`,
        [preferredOutput, qualityScoreModel, qualityScoreN8n, qualityNotes, useCaseFit, reviewedBy, comparisonId]
      );
      if (!updateResult.affectedRows) {
        return res.status(404).json({ ok: false, error: { code: "summary_comparison_not_found", message: "comparison_id was not found." } });
      }
      const [rows] = await getPool().query(
        `SELECT comparison_id, n8n_binding_key, preferred_output,
                quality_score_model, quality_score_n8n, quality_notes,
                use_case_fit, reviewed_by, reviewed_at,
                production_route_unchanged, writes_session_summaries
         FROM \`summary_comparison_runs\`
         WHERE comparison_id = ?
         LIMIT 1`,
        [comparisonId]
      );
      res.json({
        ok: true,
        comparison_id: comparisonId,
        score: rows[0] || null,
        production_route_unchanged: true,
        writes_session_summaries: false,
        secrets_included: false,
      });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, error: { code: err.code || "summary_comparison_score_failed", message: err.message } });
    }
  });

  // ── GET /dev-agent/summary-comparison/report ─────────────────────────────
  router.get("/dev-agent/summary-comparison/report", async (req, res) => {
    try {
      const lookbackDays = boundedPositiveInt(req.query.lookback_days, 7, 1, 90);
      const limit = boundedPositiveInt(req.query.limit, 20, 1, 100);
      const bindingKey = String(req.query.n8n_binding_key || "").trim();
      const where = ["created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"];
      const params = [lookbackDays];
      if (bindingKey) {
        where.push("n8n_binding_key = ?");
        params.push(bindingKey);
      }
      const whereSql = where.join(" AND ");

      const [[totals]] = await getPool().query(
        `SELECT COUNT(*) AS total_runs,
                SUM(CASE WHEN current_model_ok = 1 THEN 1 ELSE 0 END) AS current_model_ok_runs,
                SUM(CASE WHEN n8n_ok = 1 THEN 1 ELSE 0 END) AS n8n_ok_runs,
                AVG(current_model_latency_ms) AS avg_model_latency_ms,
                AVG(n8n_latency_ms) AS avg_n8n_latency_ms,
                AVG(current_model_summary_chars) AS avg_model_summary_chars,
                AVG(n8n_summary_chars) AS avg_n8n_summary_chars,
                SUM(CASE WHEN faster_path = 'n8n_experiment' THEN 1 ELSE 0 END) AS n8n_faster_runs,
                SUM(CASE WHEN faster_path = 'current_model_summary' THEN 1 ELSE 0 END) AS model_faster_runs,
                SUM(CASE WHEN writes_session_summaries = 1 THEN 1 ELSE 0 END) AS session_summary_write_violations,
                SUM(CASE WHEN production_route_unchanged = 0 THEN 1 ELSE 0 END) AS production_route_change_violations,
                SUM(CASE WHEN preferred_output IS NOT NULL THEN 1 ELSE 0 END) AS reviewed_runs,
                AVG(quality_score_model) AS avg_quality_score_model,
                AVG(quality_score_n8n) AS avg_quality_score_n8n
         FROM \`summary_comparison_runs\`
         WHERE ${whereSql}`,
        params
      );

      const [byBinding] = await getPool().query(
        `SELECT n8n_binding_key,
                COUNT(*) AS total_runs,
                AVG(current_model_latency_ms) AS avg_model_latency_ms,
                AVG(n8n_latency_ms) AS avg_n8n_latency_ms,
                SUM(CASE WHEN faster_path = 'n8n_experiment' THEN 1 ELSE 0 END) AS n8n_faster_runs,
                MAX(created_at) AS last_seen
         FROM \`summary_comparison_runs\`
         WHERE ${whereSql}
         GROUP BY n8n_binding_key
         ORDER BY total_runs DESC, last_seen DESC`,
        params
      );

      const [preferredOutputBreakdown] = await getPool().query(
        `SELECT COALESCE(preferred_output, 'unreviewed') AS preferred_output,
                COUNT(*) AS count,
                ROUND(AVG(quality_score_model), 2) AS avg_quality_score_model,
                ROUND(AVG(quality_score_n8n), 2) AS avg_quality_score_n8n
         FROM \`summary_comparison_runs\`
         WHERE ${whereSql}
         GROUP BY COALESCE(preferred_output, 'unreviewed')
         ORDER BY count DESC, preferred_output ASC`,
        params
      );

      const [useCaseFitBreakdown] = await getPool().query(
        `SELECT COALESCE(use_case_fit, 'unreviewed') AS use_case_fit,
                COALESCE(preferred_output, 'unreviewed') AS preferred_output,
                COUNT(*) AS count,
                ROUND(AVG(quality_score_model), 2) AS avg_quality_score_model,
                ROUND(AVG(quality_score_n8n), 2) AS avg_quality_score_n8n
         FROM \`summary_comparison_runs\`
         WHERE ${whereSql}
         GROUP BY COALESCE(use_case_fit, 'unreviewed'), COALESCE(preferred_output, 'unreviewed')
         ORDER BY use_case_fit ASC, count DESC, preferred_output ASC`,
        params
      );

      const [recentRuns] = await getPool().query(
        `SELECT comparison_id, tenant_id, user_id, n8n_binding_key,
                input_text_chars, input_turn_count,
                current_model_ok, current_model_latency_ms, current_model_summary_chars,
                n8n_ok, n8n_latency_ms, n8n_summary_chars,
                faster_path, production_route_unchanged, writes_session_summaries,
                created_at
         FROM \`summary_comparison_runs\`
         WHERE ${whereSql}
         ORDER BY created_at DESC
         LIMIT ?`,
        [...params, limit]
      );

      const totalRuns = Number(totals?.total_runs || 0);
      const n8nFasterRuns = Number(totals?.n8n_faster_runs || 0);
      const reviewedRuns = Number(totals?.reviewed_runs || 0);
      const avgModelQuality = Number(Number(totals?.avg_quality_score_model || 0).toFixed(2));
      const avgN8nQuality = Number(Number(totals?.avg_quality_score_n8n || 0).toFixed(2));
      const modelPreferredRuns = Number(preferredOutputBreakdown.find(row => row.preferred_output === "current_model_summary")?.count || 0);
      const n8nPreferredRuns = Number(preferredOutputBreakdown.find(row => row.preferred_output === "n8n_experiment")?.count || 0);
      const qualityDecisionHint = reviewedRuns < 10
        ? "needs_more_reviewed_samples"
        : (avgModelQuality > avgN8nQuality && modelPreferredRuns >= n8nPreferredRuns
          ? "keep_current_model_as_default_use_n8n_for_preview_or_fallback"
          : "review_for_possible_preview_expansion_only");
      res.json({
        ok: true,
        lookback_days: lookbackDays,
        filter: { n8n_binding_key: bindingKey || null },
        totals: {
          total_runs: totalRuns,
          current_model_ok_runs: Number(totals?.current_model_ok_runs || 0),
          n8n_ok_runs: Number(totals?.n8n_ok_runs || 0),
          avg_model_latency_ms: Math.round(Number(totals?.avg_model_latency_ms || 0)),
          avg_n8n_latency_ms: Math.round(Number(totals?.avg_n8n_latency_ms || 0)),
          avg_model_summary_chars: Math.round(Number(totals?.avg_model_summary_chars || 0)),
          avg_n8n_summary_chars: Math.round(Number(totals?.avg_n8n_summary_chars || 0)),
          n8n_faster_runs: n8nFasterRuns,
          model_faster_runs: Number(totals?.model_faster_runs || 0),
          n8n_speed_win_rate: totalRuns ? Number((n8nFasterRuns / totalRuns).toFixed(3)) : 0,
          session_summary_write_violations: Number(totals?.session_summary_write_violations || 0),
          production_route_change_violations: Number(totals?.production_route_change_violations || 0),
          reviewed_runs: reviewedRuns,
          avg_quality_score_model: avgModelQuality,
          avg_quality_score_n8n: avgN8nQuality,
        },
        preferred_output_breakdown: preferredOutputBreakdown,
        use_case_fit_breakdown: useCaseFitBreakdown,
        quality_decision_hint: {
          status: qualityDecisionHint,
          model_preferred_runs: modelPreferredRuns,
          n8n_preferred_runs: n8nPreferredRuns,
          reviewed_runs: reviewedRuns,
          recommended_default: qualityDecisionHint === "keep_current_model_as_default_use_n8n_for_preview_or_fallback" ? "current_model_summary" : null,
          recommended_n8n_role: qualityDecisionHint === "keep_current_model_as_default_use_n8n_for_preview_or_fallback" ? "quick_preview_or_limited_fallback_candidate" : "needs_more_review",
        },
        by_binding: byBinding,
        recent_runs: recentRuns,
        production_route_unchanged: true,
        reads_only: true,
        secrets_included: false,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: "summary_comparison_report_failed", message: err.message } });
    }
  });

  // ── Summary development automation ───────────────────────────────────────
  router.get("/dev-agent/summary-development/runtimes", async (req, res) => {
    try {
      const status = String(req.query.status || "").trim();
      const where = [];
      const params = [];
      if (status) {
        where.push("status = ?");
        params.push(status);
      }
      const [runtimes] = await getPool().query(
        `SELECT runtime_key, display_name, runtime_type, provider_key,
                execution_surface, device_id, endpoint_url, command_hint,
                supported_use_cases_json, capabilities_json, policy_json,
                status, notes, updated_at
         FROM \`dev_agent_runtime_registry\`
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY FIELD(status, 'active', 'available', 'planned', 'degraded', 'disabled'), runtime_key`,
        params
      );
      res.json({ ok: true, runtimes, secrets_included: false, reads_only: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: "summary_development_runtimes_failed", message: err.message } });
    }
  });

  router.get("/dev-agent/summary-development/signals", async (req, res) => {
    try {
      const status = String(req.query.status || "").trim();
      const signalType = String(req.query.signal_type || "").trim();
      const limit = boundedPositiveInt(req.query.limit, 50, 1, 200);
      const where = ["1=1"];
      const params = [];
      if (status) { where.push("status = ?"); params.push(status); }
      if (signalType) { where.push("signal_type = ?"); params.push(signalType); }
      const [signals] = await getPool().query(
        `SELECT signal_id, signal_key, tenant_id, user_id, source_surface, source_ref,
                source_summary_id, source_comparison_id, signal_type, title,
                description, recommended_runtime_key, recommended_action,
                priority, status, converted_task_id, created_at, updated_at
         FROM \`summary_development_signals\`
         WHERE ${where.join(" AND ")}
         ORDER BY FIELD(priority, 'critical', 'high', 'medium', 'low'), created_at DESC
         LIMIT ?`,
        [...params, limit]
      );
      res.json({ ok: true, signals, count: signals.length, secrets_included: false, reads_only: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: "summary_development_signals_failed", message: err.message } });
    }
  });

  router.post("/dev-agent/summary-development/extract", async (req, res) => {
    const pool = getPool();
    const body = req.body || {};
    const runId = randomUUID();
    const runKey = `summary_dev_extract_${runId}`;
    const lookbackDays = boundedPositiveInt(body.lookback_days || req.query.lookback_days, 14, 1, 90);
    const limit = boundedPositiveInt(body.limit || req.query.limit, 80, 1, 250);
    const tenantId = body.tenant_id || null;
    const createPendingTasks = body.create_pending_tasks === true || req.query.create_pending_tasks === "true";
    const sourceFilter = { lookback_days: lookbackDays, limit, tenant_id: tenantId, create_pending_tasks: createPendingTasks };

    await pool.query(
      `INSERT INTO \`summary_development_automation_runs\`
         (run_id, run_key, mode, tenant_id, requested_by, source_filter_json, policy_json, status, started_at)
       VALUES (?, ?, 'extract_signals', ?, ?, ?, ?, 'running', NOW())`,
      [
        runId,
        runKey,
        tenantId,
        body.requested_by || body.user_id || null,
        JSON.stringify(sourceFilter),
        JSON.stringify({ auto_execute_code: false, auto_mutate_repo: false, create_pending_tasks: createPendingTasks, secrets_included: false }),
      ]
    ).catch(() => {});

    try {
      const where = ["created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"];
      const params = [lookbackDays];
      if (tenantId) { where.push("tenant_id = ?"); params.push(tenantId); }

      const [summaries] = await pool.query(
        `SELECT summary_id, session_id, tenant_id, user_id, summary_text,
                blockers, feature_requests, integration_needs, created_at
         FROM \`session_summaries\`
         WHERE ${where.join(" AND ")}
         ORDER BY created_at DESC
         LIMIT ?`,
        [...params, limit]
      );

      const [comparisons] = await pool.query(
        `SELECT comparison_id, tenant_id, user_id, n8n_binding_key,
                preferred_output, quality_score_model, quality_score_n8n,
                quality_notes, use_case_fit, faster_path, created_at
         FROM \`summary_comparison_runs\`
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
           ${tenantId ? "AND tenant_id = ?" : ""}
           AND (preferred_output IS NOT NULL OR faster_path = 'n8n_experiment')
         ORDER BY created_at DESC
         LIMIT ?`,
        tenantId ? [lookbackDays, tenantId, Math.min(limit, 80)] : [lookbackDays, Math.min(limit, 80)]
      ).catch(() => [[]]);

      const signals = [];
      for (const summary of summaries) {
        const sourceRef = summary.summary_id || summary.session_id;
        for (const item of safeParseJsonArray(summary.feature_requests)) {
          signals.push(buildSummaryDevelopmentSignal({
            source_surface: "session_summary",
            source_ref: sourceRef,
            source_summary_id: summary.summary_id,
            tenant_id: summary.tenant_id,
            user_id: summary.user_id,
            type: "feature_request",
            title: item,
            description: `Feature request extracted from session summary ${summary.summary_id}.`,
            evidence: `${item}\n\nSummary: ${summary.summary_text || ""}`,
          }));
        }
        for (const item of safeParseJsonArray(summary.blockers)) {
          signals.push(buildSummaryDevelopmentSignal({
            source_surface: "session_summary",
            source_ref: sourceRef,
            source_summary_id: summary.summary_id,
            tenant_id: summary.tenant_id,
            user_id: summary.user_id,
            type: "blocker",
            title: item,
            description: `Blocker extracted from session summary ${summary.summary_id}.`,
            evidence: `${item}\n\nSummary: ${summary.summary_text || ""}`,
          }));
        }
        for (const item of safeParseJsonArray(summary.integration_needs)) {
          signals.push(buildSummaryDevelopmentSignal({
            source_surface: "session_summary",
            source_ref: sourceRef,
            source_summary_id: summary.summary_id,
            tenant_id: summary.tenant_id,
            user_id: summary.user_id,
            type: "integration_need",
            title: item,
            description: `Integration need extracted from session summary ${summary.summary_id}.`,
            evidence: `${item}\n\nSummary: ${summary.summary_text || ""}`,
          }));
        }
      }

      for (const comparison of comparisons) {
        const modelScore = Number(comparison.quality_score_model || 0);
        const n8nScore = Number(comparison.quality_score_n8n || 0);
        const preferred = String(comparison.preferred_output || "");
        if (preferred === "current_model_summary" || (modelScore && n8nScore && modelScore > n8nScore)) {
          signals.push(buildSummaryDevelopmentSignal({
            source_surface: "summary_comparison",
            source_ref: comparison.comparison_id,
            source_comparison_id: comparison.comparison_id,
            tenant_id: comparison.tenant_id,
            user_id: comparison.user_id,
            type: "quality_gap",
            title: `Improve ${comparison.n8n_binding_key || "n8n summary experiment"} for ${comparison.use_case_fit || "summary quality"}`,
            description: "Summary comparison preferred the current model path; keep this as evidence for n8n summary runtime improvement.",
            evidence: comparison.quality_notes || `preferred_output=${preferred}; model=${modelScore}; n8n=${n8nScore}`,
          }));
        }
        if (preferred === "n8n_experiment" || comparison.faster_path === "n8n_experiment") {
          signals.push(buildSummaryDevelopmentSignal({
            source_surface: "summary_comparison",
            source_ref: comparison.comparison_id,
            source_comparison_id: comparison.comparison_id,
            tenant_id: comparison.tenant_id,
            user_id: comparison.user_id,
            type: "runtime_gap",
            title: `Evaluate ${comparison.n8n_binding_key || "n8n runtime"} for preview/fallback expansion`,
            description: "Summary comparison showed n8n can provide useful fast preview/fallback behavior; keep this as routing policy evidence, not production promotion.",
            evidence: comparison.quality_notes || `preferred_output=${preferred}; faster_path=${comparison.faster_path}`,
          }));
        }
      }

      let created = 0;
      let updated = 0;
      let tasksCreated = 0;
      for (const signal of signals.slice(0, 300)) {
        const action = await insertSummaryDevelopmentSignal(pool, signal);
        if (action === "created") created += 1;
        else updated += 1;

        if (createPendingTasks && ["high", "critical"].includes(signal.priority)) {
          const taskId = randomUUID();
          const taskKey = stableSignalKey(["summary_dev_signal", signal.signal_key]);
          const [taskResult] = await pool.query(
            `INSERT INTO \`platform_pending_tasks\`
               (task_id, task_key, title, description, brief, activation_prompt,
                task_type, priority, status, blocker_level, owner_scope,
                tenant_id, user_id, source_surface, source_ref,
                activation_visibility, context_json, created_by)
             VALUES (?, ?, ?, ?, ?, ?, 'automation', ?, 'pending', 'soft', 'platform', ?, ?, 'summary_development_signal', ?, 1, ?, 'summary_development_automation_v1')
             ON DUPLICATE KEY UPDATE
               description = VALUES(description),
               brief = VALUES(brief),
               activation_prompt = VALUES(activation_prompt),
               priority = VALUES(priority),
               updated_at = CURRENT_TIMESTAMP`,
            [
              taskId,
              taskKey,
              signal.title,
              signal.description,
              `Summary-derived ${signal.signal_type}: ${signal.title}`,
              `Review this summary-derived development signal. Do not execute code automatically. Recommended runtime: ${signal.recommended_runtime_key || "human_review"}. Evidence: ${signal.evidence_text}`,
              signal.priority,
              signal.tenant_id,
              signal.user_id,
              signal.signal_key,
              JSON.stringify({ signal_key: signal.signal_key, signal_type: signal.signal_type, policy: JSON.parse(signal.policy_json) }),
            ]
          );
          if (taskResult.affectedRows === 1) tasksCreated += 1;
        }
      }

      await pool.query(
        `UPDATE \`summary_development_automation_runs\`
           SET status = 'completed', scanned_count = ?, signals_created = ?,
               signals_updated = ?, tasks_created = ?, result_json = ?, completed_at = NOW()
         WHERE run_id = ?`,
        [summaries.length + comparisons.length, created, updated, tasksCreated, JSON.stringify({ signals_considered: signals.length }), runId]
      ).catch(() => {});

      res.json({
        ok: true,
        run_id: runId,
        scanned_count: summaries.length + comparisons.length,
        signals_considered: signals.length,
        signals_created: created,
        signals_updated: updated,
        tasks_created: tasksCreated,
        create_pending_tasks: createPendingTasks,
        auto_execute_code: false,
        auto_mutate_repo: false,
        secrets_included: false,
      });
    } catch (err) {
      await pool.query(
        `UPDATE \`summary_development_automation_runs\`
           SET status = 'failed', error_json = ?, completed_at = NOW()
         WHERE run_id = ?`,
        [JSON.stringify({ code: err.code || "summary_development_extract_failed", message: String(err.message || err).slice(0, 240) }), runId]
      ).catch(() => {});
      res.status(500).json({ ok: false, error: { code: err.code || "summary_development_extract_failed", message: err.message } });
    }
  });

  router.post("/dev-agent/summary-development/agent-dry-run", async (req, res) => {
    const pool = getPool();
    const body = req.body || {};
    const runId = randomUUID();
    const runtimeKey = String(body.runtime_key || "openclaude_essam_local_v1").trim();
    const signalId = String(body.signal_id || "").trim();
    const signalKey = String(body.signal_key || "").trim();
    const requestedBy = String(body.requested_by || body.user_id || "").trim() || null;
    const mode = String(body.mode || "plan_only").trim();

    if (!signalId && !signalKey) {
      return res.status(400).json({ ok: false, error: { code: "summary_development_signal_required", message: "signal_id or signal_key is required." } });
    }
    if (mode !== "plan_only") {
      return res.status(403).json({
        ok: false,
        blocked: true,
        error: { code: "summary_development_agent_execution_blocked", message: "Only plan_only dry-run mode is currently allowed." },
        auto_execute_code: false,
        auto_mutate_repo: false,
        secrets_included: false,
      });
    }

    try {
      const [runtimeRows] = await pool.query(
        `SELECT runtime_key, display_name, runtime_type, provider_key, execution_surface,
                device_id, command_hint, capabilities_json, policy_json, status, notes
         FROM \`dev_agent_runtime_registry\`
         WHERE runtime_key = ?
         LIMIT 1`,
        [runtimeKey]
      );
      const runtime = runtimeRows[0];
      if (!runtime) {
        return res.status(404).json({ ok: false, error: { code: "summary_development_runtime_not_found", message: "runtime_key was not found." } });
      }

      const signalWhere = signalId ? "signal_id = ?" : "signal_key = ?";
      const [signalRows] = await pool.query(
        `SELECT signal_id, signal_key, tenant_id, user_id, source_surface, source_ref,
                signal_type, title, description, evidence_text, recommended_runtime_key,
                recommended_action, priority, status, policy_json
         FROM \`summary_development_signals\`
         WHERE ${signalWhere}
         LIMIT 1`,
        [signalId || signalKey]
      );
      const signal = signalRows[0];
      if (!signal) {
        return res.status(404).json({ ok: false, error: { code: "summary_development_signal_not_found", message: "signal was not found." } });
      }

      const runtimePolicy = typeof runtime.policy_json === "string" ? JSON.parse(runtime.policy_json || "{}") : (runtime.policy_json || {});
      const signalPolicy = typeof signal.policy_json === "string" ? JSON.parse(signal.policy_json || "{}") : (signal.policy_json || {});
      const localRuntimeReady = runtime.status === "active" || runtime.status === "available";
      const localExecutionAllowed = false;
      const plan = {
        objective: signal.title,
        source: {
          surface: signal.source_surface,
          ref: signal.source_ref,
          signal_type: signal.signal_type,
          priority: signal.priority,
        },
        recommended_runtime: runtime.runtime_key,
        runtime_status: runtime.status,
        local_runtime_ready: localRuntimeReady,
        local_execution_attempted: false,
        local_execution_allowed: localExecutionAllowed,
        dry_run_mode: "plan_only",
        proposed_steps: [
          "Review the signal evidence and confirm the intended platform change.",
          "Inspect relevant routes, migrations, tests, and registry rows before editing.",
          "Prepare a minimal patch plan with files, migrations, tests, and rollback notes.",
          "Run CI and live smoke only after a human approves repository mutation.",
        ],
        likely_files_or_surfaces: [
          "http-generic-api/routes/devAgentRoutes.js",
          "http-generic-api/migrations/",
          "admin_platform_endpoint_tools registry rows",
          "tests covering the affected runtime/policy contract",
        ],
        acceptance_criteria: [
          "No secrets are printed or persisted in outputs.",
          "No code is executed during this dry run.",
          "No repository files are modified by this dry run.",
          "Any future patch must be on a non-protected branch with CI evidence.",
          "A human must approve before OpenClaude or another coding agent can write files.",
        ],
        blockers: runtime.status === "planned"
          ? [`Runtime ${runtime.runtime_key} is planned and not installed/activated yet.`]
          : [],
        evidence_excerpt: clampText(signal.evidence_text || signal.description || "", 1000),
      };

      await pool.query(
        `INSERT INTO \`summary_development_automation_runs\`
           (run_id, run_key, mode, tenant_id, requested_by, runtime_key,
            source_filter_json, policy_json, status, scanned_count,
            signals_created, signals_updated, tasks_created, result_json,
            started_at, completed_at)
         VALUES (?, ?, 'agent_dry_run', ?, ?, ?, ?, ?, 'completed', 1, 0, 0, 0, ?, NOW(), NOW())`,
        [
          runId,
          `summary_dev_agent_dry_run_${runId}`,
          signal.tenant_id || null,
          requestedBy,
          runtime.runtime_key,
          JSON.stringify({ signal_id: signal.signal_id, signal_key: signal.signal_key, mode }),
          JSON.stringify({
            ...runtimePolicy,
            ...signalPolicy,
            auto_execute_code: false,
            auto_mutate_repo: false,
            local_execution_allowed: false,
            secrets_included: false,
          }),
          JSON.stringify(plan),
        ]
      );

      res.json({
        ok: true,
        run_id: runId,
        signal_id: signal.signal_id,
        signal_key: signal.signal_key,
        runtime_key: runtime.runtime_key,
        runtime_status: runtime.status,
        plan,
        auto_execute_code: false,
        auto_mutate_repo: false,
        local_execution_attempted: false,
        secrets_included: false,
      });
    } catch (err) {
      await pool.query(
        `INSERT INTO \`summary_development_automation_runs\`
           (run_id, run_key, mode, requested_by, runtime_key, status, error_json, started_at, completed_at)
         VALUES (?, ?, 'agent_dry_run', ?, ?, 'failed', ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE status = 'failed', error_json = VALUES(error_json), completed_at = NOW()`,
        [runId, `summary_dev_agent_dry_run_${runId}`, requestedBy, runtimeKey, JSON.stringify({ code: err.code || "summary_development_agent_dry_run_failed", message: String(err.message || err).slice(0, 240) })]
      ).catch(() => {});
      res.status(500).json({ ok: false, error: { code: err.code || "summary_development_agent_dry_run_failed", message: err.message } });
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
      const callModel = await resolveStandardCallModel(deps, "summary");
      const body = req.body || {};
      const run_id = body.run_id || randomUUID();
      const result = await runSessionSummaryAutosweep({
        pool: getPool(),
        callModel: callModel || null,
        run_id,
        limit: Math.min(Number(body.limit || req.query.limit || 20), 100),
        minTurnCount: Math.max(Number(body.min_turn_count || req.query.min_turn_count || 1), 1),
        includeActiveLong: body.include_active_long === true || req.query.include_active_long === "true",
        activeTurnThreshold: Math.max(Number(body.active_turn_threshold || req.query.active_turn_threshold || 80), 1),
        minNewTurns: Math.max(Number(body.min_new_turns || req.query.min_new_turns || 10), 1),
      });
      res.status(result.ok ? 200 : 207).json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: "session_summary_autosweep_failed", message: err.message } });
    }
  });

  // ── GET /dev-agent/session-summaries/health ──────────────────────────────
  router.get("/dev-agent/session-summaries/health", async (req, res) => {
    try {
      const lookbackDays = boundedPositiveInt(req.query.lookback_days, 7, 1, 90);
      const limit = boundedPositiveInt(req.query.limit, 20, 1, 100);
      const health = await loadSessionSummaryHealth({ pool: getPool(), lookbackDays, limit });
      res.json(health);
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: "session_summary_health_failed", message: err.message } });
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
