// chainEventDispatcher.js — Sprint 23
//
// Picks up pending agent_chain_events and executes the target workflow by
// creating an execution_plan in 'validated' status then calling dispatchPlan().
//
// Called from POST /agent-chain-events/dispatch-pending (batch sweep)
// or POST /agent-chain-events/:id/dispatch (single manual trigger).
//
// Flow per event:
//   1. Lock event (set status = 'processing') — prevents double-dispatch
//   2. Load target workflow definition
//   3. Create a child execution_plan (inherits tenant + source run context)
//   4. dispatchPlan(plan_id) — routes to wordpress / mcp_connector / content_workflow
//   5. Update event status → 'dispatched' or 'failed'

import { randomUUID } from "node:crypto";
import { getPool }    from "./db.js";
import { dispatchPlan } from "./connectorExecutor.js";

const LOCK_STATUS = "processing"; // intermediate guard — not in the ENUM; see note below
// Note: agent_chain_events.status ENUM = pending|dispatched|failed|skipped
// We use a DB UPDATE with WHERE status='pending' as an atomic claim (no separate LOCK status needed).

// ── Loaders ───────────────────────────────────────────────────────────────────

async function loadEvent(event_id) {
  const [rows] = await getPool().query(
    "SELECT * FROM `agent_chain_events` WHERE event_id = ? LIMIT 1",
    [event_id]
  );
  return rows[0] || null;
}

async function loadWorkflowDef(workflow_key) {
  if (!workflow_key) return null;
  const [rows] = await getPool().query(
    `SELECT workflow_key, execution_mode, execution_class, target_module,
            review_required, agent_id
     FROM \`workflows\`
     WHERE workflow_key = ? AND (active = 1 OR active = 'TRUE' OR active = '1') LIMIT 1`,
    [workflow_key]
  );
  return rows[0] || null;
}

async function resolveAgentForWorkflow(workflow_key, hintAgentId) {
  if (hintAgentId) return hintAgentId;
  // Try task_routes → execution_layer → agents join
  const [rows] = await getPool().query(
    `SELECT a.agent_id
     FROM \`task_routes\` tr
     JOIN \`agents\` a ON a.execution_layer = tr.execution_layer
     WHERE tr.workflow_key = ? AND a.status = 'active' LIMIT 1`,
    [workflow_key]
  ).catch(() => [[]]);
  return rows[0]?.agent_id || null;
}

// ── Plan factory ──────────────────────────────────────────────────────────────

async function createChainPlan(event, workflowDef) {
  const plan_id  = randomUUID();
  const agent_id = await resolveAgentForWorkflow(
    event.target_workflow_key,
    event.target_agent_id || workflowDef?.agent_id || null
  );

  // Carry source payload into the plan's steps so the target workflow has context
  let sourcePayload = {};
  try { sourcePayload = JSON.parse(event.payload_json || "{}"); } catch {}

  await getPool().query(
    `INSERT INTO \`execution_plans\`
       (plan_id, tenant_id, user_id, agent_id, workflow_key, intent_key,
        plan_status, access_decision, service_mode, steps_json, created_at)
     VALUES (?,?,?,?,?,?,
             'validated','ALLOW_SELF_SERVE','self_serve',?,NOW())`,
    [
      plan_id,
      event.tenant_id,
      null,                               // no user — system-driven chain
      agent_id,
      event.target_workflow_key,
      event.target_workflow_key,          // intent_key mirrors workflow_key for chain plans
      JSON.stringify([{
        step_key:     "chain_trigger",
        source_event: event.event_id,
        source_run:   event.source_run_id,
        payload:      sourcePayload,
      }]),
    ]
  );

  return { plan_id, agent_id };
}

// ── Core dispatcher ───────────────────────────────────────────────────────────

export async function dispatchChainEvent(event_id) {
  const pool = getPool();

  // Atomic claim — only proceed if still pending
  const [claim] = await pool.query(
    "UPDATE `agent_chain_events` SET status = 'dispatched', dispatched_at = NOW() WHERE event_id = ? AND status = 'pending'",
    [event_id]
  );

  if (claim.affectedRows === 0) {
    // Already dispatched/failed/skipped by another caller
    const evt = await loadEvent(event_id);
    return { ok: false, skipped: true, reason: `event already in status '${evt?.status}'`, event_id };
  }

  const event = await loadEvent(event_id);
  if (!event) {
    return { ok: false, error: "event_not_found", event_id };
  }

  let plan_id, dispatchResult, dispatchError;

  try {
    const workflowDef = await loadWorkflowDef(event.target_workflow_key);
    if (!workflowDef) {
      throw new Error(`Workflow '${event.target_workflow_key}' not found or inactive`);
    }

    ({ plan_id } = await createChainPlan(event, workflowDef));

    dispatchResult = await dispatchPlan(plan_id, {
      apply:          false,
      actor_id:       `chain:${event.source_agent_id || "system"}`,
    });

    if (!dispatchResult.ok) {
      throw new Error(dispatchResult.error?.message || "dispatchPlan returned ok=false");
    }
  } catch (err) {
    dispatchError = err;
    // Revert to failed if dispatch errored after we already marked dispatched
    await pool.query(
      "UPDATE `agent_chain_events` SET status = 'failed' WHERE event_id = ?",
      [event_id]
    ).catch(() => {});
  }

  return {
    ok:              !dispatchError,
    event_id,
    plan_id:         plan_id || null,
    target_workflow: event.target_workflow_key,
    run_id:          dispatchResult?.run_id || null,
    error:           dispatchError ? dispatchError.message : undefined,
  };
}

// ── Batch sweep ───────────────────────────────────────────────────────────────

export async function dispatchPendingChainEvents({ tenant_id, limit = 20 } = {}) {
  let sql = "SELECT event_id FROM `agent_chain_events` WHERE status = 'pending'";
  const params = [];
  if (tenant_id) { sql += " AND tenant_id = ?"; params.push(tenant_id); }
  sql += " ORDER BY created_at ASC LIMIT ?";
  params.push(Number(limit));

  const [rows] = await getPool().query(sql, params);
  if (!rows.length) return { ok: true, dispatched: 0, results: [] };

  // Run sequentially to avoid lock contention on concurrent plan creation
  const results = [];
  for (const { event_id } of rows) {
    results.push(await dispatchChainEvent(event_id));
  }

  const succeeded = results.filter(r => r.ok).length;
  const failed    = results.filter(r => !r.ok && !r.skipped).length;
  const skipped   = results.filter(r => r.skipped).length;

  return {
    ok:         failed === 0,
    dispatched: succeeded,
    failed,
    skipped,
    results,
  };
}
