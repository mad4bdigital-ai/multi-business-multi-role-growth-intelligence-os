// devAgentRunner.js — Background developer agent: watches every completed session,
// summarises it, then sweeps across summaries to generate platform improvement proposals.
//
// Two-phase loop:
//   Phase 1 — Summarise: find completed sessions with no summary → LLM → session_summaries
//   Phase 2 — Propose:   batch unanalysed summaries → LLM → dev_agent_proposals (upsert)
//
// Called from POST /dev-agent/run (manual) or an external cron (Make.com / n8n).

import { randomUUID }  from "node:crypto";
import { getPool }     from "./db.js";
import { runSessionSummaryAutosweep } from "./sessionSummaryService.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadSessionEvents(session_id, limit = 200) {
  const [rows] = await getPool().query(
    `SELECT record_type, event_type, payload_json
     FROM \`session_events\`
     WHERE session_id = ?
     ORDER BY id ASC
     LIMIT ?`,
    [session_id, limit]
  ).catch(() => [[]]);
  return rows.map(r => {
    let p = r.payload_json;
    if (typeof p === "string") { try { p = JSON.parse(p); } catch { p = {}; } }
    return { record_type: r.record_type, event_type: r.event_type, payload: p || {} };
  });
}

async function createRunRecord(run_id) {
  await getPool().query(
    `INSERT INTO \`dev_agent_runs\` (run_id, status, started_at)
     VALUES (?, 'running', NOW())`,
    [run_id]
  ).catch(() => {});
}

async function finishRunRecord(run_id, stats, error_msg = null) {
  await getPool().query(
    `UPDATE \`dev_agent_runs\`
       SET status = ?, sessions_analyzed = ?, summaries_created = ?,
           proposals_created = ?, proposals_updated = ?,
           run_summary = ?, error_msg = ?, completed_at = NOW()
     WHERE run_id = ?`,
    [
      error_msg ? "failed" : "completed",
      stats.sessions_analyzed || 0,
      stats.summaries_created || 0,
      stats.proposals_created || 0,
      stats.proposals_updated || 0,
      stats.run_summary || null,
      error_msg || null,
      run_id,
    ]
  ).catch(() => {});
}

// ── Phase 1: Summarise sessions ───────────────────────────────────────────────

const SUMMARISE_PROMPT = `You are an AI developer agent analysing work sessions on a multi-tenant growth platform.
Read the session events below and extract structured insights.

Output ONLY valid JSON with these keys:
{
  "summary_text": "2-4 sentence prose narrative of what happened in this session",
  "tasks_completed": ["..."],
  "blockers": ["..."],
  "feature_requests": ["..."],
  "integration_needs": ["..."],
  "complexity": "low|medium|high"
}

Keep each array to ≤5 items. Be specific and concrete. Do not invent details not present in the events.`;

async function summariseSession(session, events, callModel) {
  const eventLines = events
    .slice(0, 80)
    .map(e => {
      const content = e.payload?.content || e.payload?.message || e.payload?.text || "";
      return `[${e.event_type || e.record_type}] ${String(content).slice(0, 300)}`;
    })
    .join("\n");

  const messages = [
    { role: "system", content: SUMMARISE_PROMPT },
    {
      role: "user",
      content: `Session model: ${session.model_name || "unknown"}\nBranch: ${session.git_branch || "n/a"}\nTurns: ${session.turn_count || 0}\n\nEvents:\n${eventLines}`,
    },
  ];

  try {
    const response = await callModel(messages, []);
    const text = typeof response.content === "string"
      ? response.content
      : (response.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "null");
    if (!json?.summary_text) throw new Error("no summary_text in response");
    return json;
  } catch (err) {
    return {
      summary_text: `Session ${session.session_id} ended with ${session.turn_count || 0} turns. Auto-summary failed: ${err.message}`,
      tasks_completed: [],
      blockers: [],
      feature_requests: [],
      integration_needs: [],
      complexity: "medium",
    };
  }
}

async function runSummarisePhase(run_id, callModel, batchSize = 20) {
  const result = await runSessionSummaryAutosweep({
    pool: getPool(),
    callModel,
    limit: batchSize,
    minTurnCount: 1,
    includeActiveLong: true,
    activeTurnThreshold: 80,
    minNewTurns: 10,
  });
  return {
    sessions_analyzed: result.scanned_sessions || 0,
    summaries_created: result.summaries_created || 0,
  };
}

// ── Phase 2: Generate proposals ───────────────────────────────────────────────

const PROPOSAL_PROMPT = `You are a senior developer agent for a multi-tenant AI platform.
You have analysed a batch of user work sessions. Your job is to identify the highest-value platform improvements.

Look for patterns across sessions:
- Features users need that don't exist yet
- Friction points or blockers appearing repeatedly
- Missing integrations (tools users tried to connect that aren't supported)
- Agent capability gaps (things agents couldn't do)
- Database or schema improvements
- Code layer improvements (routes, adapters, runners)

Output ONLY a valid JSON array (max 8 items):
[
  {
    "scope": "code|db|workflow|integration|agent|ux",
    "layer": "specific file/module/table, e.g. appAdapters, agentLoopRunner, migrations",
    "title": "concise title ≤80 chars",
    "description": "what should be built or changed, 2-4 sentences",
    "rationale": "why — what evidence from sessions supports this",
    "priority": "low|medium|high|critical"
  }
]

Only include items with at least moderate confidence. Quality over quantity.`;

async function generateProposals(summaries, run_id, tenant_id, callModel) {
  const summaryBlock = summaries
    .map((s, i) => {
      const fr = safeParseArr(s.feature_requests).join("; ");
      const bl = safeParseArr(s.blockers).join("; ");
      const in_ = safeParseArr(s.integration_needs).join("; ");
      return `[${i + 1}] ${s.summary_text}${fr ? `\n  Feature requests: ${fr}` : ""}${bl ? `\n  Blockers: ${bl}` : ""}${in_ ? `\n  Integration needs: ${in_}` : ""}`;
    })
    .join("\n\n");

  const messages = [
    { role: "system", content: PROPOSAL_PROMPT },
    { role: "user", content: `Batch of ${summaries.length} session summaries:\n\n${summaryBlock}` },
  ];

  let proposals = [];
  try {
    const response = await callModel(messages, []);
    const text = typeof response.content === "string"
      ? response.content
      : (response.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    const arr = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || "null");
    if (Array.isArray(arr)) proposals = arr;
  } catch (err) {
    console.warn("[devAgent] proposal extraction failed:", err?.message);
    return { proposals_created: 0, proposals_updated: 0 };
  }

  const evidenceIds = summaries.map(s => s.session_id);
  let created = 0;
  let updated = 0;

  for (const p of proposals) {
    if (!p.title || !p.description || !p.scope) continue;

    // Check for existing proposal with matching title+scope (dedup)
    const [existing] = await getPool().query(
      `SELECT proposal_id, status FROM \`dev_agent_proposals\`
       WHERE tenant_id <=> ? AND scope = ? AND title = ? LIMIT 1`,
      [tenant_id || null, p.scope, p.title.slice(0, 255)]
    ).catch(() => [[]]);

    if (existing[0]) {
      // Only update if still pending (don't overwrite confirmed/dismissed)
      if (existing[0].status === "pending") {
        await getPool().query(
          `UPDATE \`dev_agent_proposals\`
             SET rationale = ?, evidence_session_ids = ?,
                 priority = ?, updated_at = NOW()
           WHERE proposal_id = ?`,
          [
            p.rationale || null,
            JSON.stringify(evidenceIds),
            p.priority || "medium",
            existing[0].proposal_id,
          ]
        ).catch(() => {});
        updated++;
      }
    } else {
      await getPool().query(
        `INSERT INTO \`dev_agent_proposals\`
           (proposal_id, tenant_id, scope, layer, title, description,
            rationale, evidence_session_ids, priority, status, source_run_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [
          randomUUID(),
          tenant_id || null,
          p.scope,
          (p.layer || "").slice(0, 255) || null,
          p.title.slice(0, 255),
          p.description,
          p.rationale || null,
          JSON.stringify(evidenceIds),
          p.priority || "medium",
          run_id,
        ]
      ).catch(() => {});
      created++;
    }
  }

  return { proposals_created: created, proposals_updated: updated };
}

// ── Tenant-aware proposal sweeps ──────────────────────────────────────────────
// Run the proposal extractor per tenant (so tenant proposals are scoped correctly)
// plus one global pass for platform-wide patterns (tenant_id = null).

async function runProposalPhase(run_id, callModel, maxSummariesPerTenant = 30) {
  // Find unanalysed summaries grouped by tenant
  const [rows] = await getPool().query(
    `SELECT summary_id, session_id, tenant_id, summary_text,
            feature_requests, blockers, integration_needs
     FROM \`session_summaries\`
     WHERE analyzed = 0
     ORDER BY created_at DESC
     LIMIT 200`
  ).catch(() => [[]]);

  if (!rows.length) return { proposals_created: 0, proposals_updated: 0 };

  // Group by tenant
  const byTenant = {};
  for (const r of rows) {
    const key = r.tenant_id || "__global__";
    if (!byTenant[key]) byTenant[key] = [];
    byTenant[key].push(r);
  }

  let totalCreated = 0;
  let totalUpdated = 0;

  for (const [tenantKey, summaries] of Object.entries(byTenant)) {
    const tenant_id = tenantKey === "__global__" ? null : tenantKey;
    const batch = summaries.slice(0, maxSummariesPerTenant);

    const stats = await generateProposals(batch, run_id, tenant_id, callModel);
    totalCreated += stats.proposals_created;
    totalUpdated += stats.proposals_updated;

    // Mark summaries as analysed
    const ids = batch.map(s => s.summary_id);
    await getPool().query(
      `UPDATE \`session_summaries\`
         SET analyzed = 1, analyzed_at = NOW(), dev_agent_run_id = ?
       WHERE summary_id IN (${ids.map(() => "?").join(",")})`,
      [run_id, ...ids]
    ).catch(() => {});
  }

  return { proposals_created: totalCreated, proposals_updated: totalUpdated };
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function runDevAgentSweep(deps = {}) {
  const { callModel } = deps;
  if (!callModel) throw new Error("devAgentRunner: callModel is required in deps");

  const run_id = randomUUID();
  await createRunRecord(run_id);

  const stats = { sessions_analyzed: 0, summaries_created: 0, proposals_created: 0, proposals_updated: 0 };

  try {
    const phase1 = await runSummarisePhase(run_id, callModel);
    stats.sessions_analyzed = phase1.sessions_analyzed;
    stats.summaries_created = phase1.summaries_created;

    const phase2 = await runProposalPhase(run_id, callModel);
    stats.proposals_created = phase2.proposals_created;
    stats.proposals_updated = phase2.proposals_updated;

    stats.run_summary =
      `Summarised ${stats.summaries_created} sessions (from ${stats.sessions_analyzed} analysed). ` +
      `Created ${stats.proposals_created} new proposals, updated ${stats.proposals_updated} existing.`;

    await finishRunRecord(run_id, stats);
    return { ok: true, run_id, ...stats };
  } catch (err) {
    await finishRunRecord(run_id, stats, err.message);
    return { ok: false, run_id, error: err.message, ...stats };
  }
}

// ── Util ──────────────────────────────────────────────────────────────────────

function safeParseArr(val) {
  if (Array.isArray(val)) return val;
  try { const p = JSON.parse(val || "[]"); return Array.isArray(p) ? p : []; } catch { return []; }
}
