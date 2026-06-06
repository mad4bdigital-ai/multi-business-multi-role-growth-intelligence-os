// chainEventDispatcher.js — Sprint 21
//
// Picks up pending agent_chain_events and executes the target workflow by
// creating an execution_plan in 'validated' status then calling dispatchPlan().
//
// Called from POST /agent-chain-events/dispatch-pending (batch sweep)
// or POST /agent-chain-events/:id/dispatch (single manual trigger).

import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { dispatchPlan } from "./connectorExecutor.js"; // Assuming this is the correct dispatcher
import { resolveRuntimeWorkflow } from "./runtimeWorkflowResolver.js";

// ─── Loaders ───────────────────────────────────────────────────────────────────

async function loadEvent(event_id) {
  const [rows] = await getPool().query(
    "SELECT * FROM `agent_chain_events` WHERE event_id = ? LIMIT 1",
    [event_id]
  );
  return rows[0] || null;
}

async function resolveAgentForWorkflow(workflow_key, hintAgentId) {
  if (hintAgentId) return hintAgentId;
  const [rows] = await getPool().query(
    `SELECT a.agent_id FROM \`task_routes\` tr
     JOIN \`agents\` a ON a.execution_layer = tr.execution_layer
     WHERE tr.workflow_key = ? AND a.status = 'active' LIMIT 1`,
    [workflow_key]
  ).catch(() => [[]]);
  return rows[0]?.agent_id || null;
}

// ─── Plan factory ──────────────────────────────────────────────────────────────

async function createChainPlan(event, workflowDef) {
  const plan_id = randomUUID();
  const agent_id = await resolveAgentForWorkflow(
    event.target_workflow_key,
    event.target_agent_id
  );

  let sourcePayload = {};
  try { sourcePayload = JSON.parse(event.payload_json || "{}"); } catch {}

  await getPool().query(
    `INSERT INTO \`execution_plans\`
       (plan_id, tenant_id, user_id, agent_id, workflow_key, workflow_id, intent_key,
        plan_status, access_decision, service_mode, steps_json, created_at)
     VALUES (?,?,?,?,?,?,?, 'validated','ALLOW_SELF_SERVE','self_serve',?,NOW())`,
    [
      plan_id, event.tenant_id, null, agent_id,
      event.target_workflow_key, workflowDef.workflow_id || null, event.target_workflow_key,
      JSON.stringify([{
        step_key: "chain_trigger",
        source_event: event.event_id,
        source_run: event.source_run_id,
        payload: sourcePayload,
      }]),
    ]
  );
  return { plan_id, agent_id };
}

// ─── Core dispatcher ───────────────────────────────────────────────────────────

export async function dispatchChainEvent(event_id) {
  const pool = getPool();
  const [claim] = await pool.query(
    "UPDATE `agent_chain_events` SET status = 'dispatched', dispatched_at = NOW() WHERE event_id = ? AND status = 'pending'",
    [event_id]
  );

  if (claim.affectedRows === 0) {
    const evt = await loadEvent(event_id);
    return { ok: false, skipped: true, reason: `event already in status '${evt?.status || 'unknown'}'`, event_id };
  }

  const event = await loadEvent(event_id);
  if (!event) return { ok: false, error: "event_not_found", event_id };

  let plan_id, dispatchResult, dispatchError;
  try {
    const workflowResolution = await resolveRuntimeWorkflow({
      workflow_key: event.target_workflow_key,
    });
    if (!workflowResolution.ok) {
      const error = new Error(workflowResolution.resolution.message);
      error.code = workflowResolution.resolution.code;
      throw error;
    }
    const workflowDef = workflowResolution.workflow;

    ({ plan_id } = await createChainPlan(event, workflowDef));
    dispatchResult = await dispatchPlan(plan_id, { apply: false, actor_id: `chain:${event.source_agent_id || "system"}` });
    if (!dispatchResult.ok) throw new Error(dispatchResult.error?.message || "dispatchPlan returned ok=false");

  } catch (err) {
    dispatchError = err;
    await pool.query("UPDATE `agent_chain_events` SET status = 'failed' WHERE event_id = ?", [event_id]).catch(() => {});
  }

  return { ok: !dispatchError, event_id, plan_id: plan_id || null, target_workflow: event.target_workflow_key, run_id: dispatchResult?.run_id || null, error: dispatchError ? dispatchError.message : undefined };
}

// ─── Batch sweep ───────────────────────────────────────────────────────────────

export async function dispatchPendingChainEvents({ tenant_id, limit = 20 } = {}) {
  let sql = "SELECT event_id FROM `agent_chain_events` WHERE status = 'pending'";
  const params = [];
  if (tenant_id) { sql += " AND tenant_id = ?"; params.push(tenant_id); }
  sql += " ORDER BY created_at ASC LIMIT ?";
  params.push(Number(limit));

  const [rows] = await getPool().query(sql, params);
  if (!rows.length) return { ok: true, dispatched: 0, failed: 0, skipped: 0, results: [] };

  // Sequential — avoids lock contention on execution_plan creation for the same tenant.
  const results = [];
  for (const { event_id } of rows) {
    results.push(await dispatchChainEvent(event_id));
  }
  const succeeded = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;

  return { ok: failed === 0, dispatched: succeeded, failed, skipped, results };
}
