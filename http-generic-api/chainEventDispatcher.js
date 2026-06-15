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
import { requireAgentDelegationOptIn } from "./agentDelegationOptIn.js";

function runtimeDeps(deps = {}) {
  return {
    pool: deps.pool || getPool(),
    dispatchPlan: deps.dispatchPlan || dispatchPlan,
    resolveRuntimeWorkflow: deps.resolveRuntimeWorkflow || resolveRuntimeWorkflow,
    randomUUID: deps.randomUUID || randomUUID,
  };
}

// ─── Loaders ───────────────────────────────────────────────────────────────────

async function loadEvent(event_id, deps = {}) {
  const [rows] = await runtimeDeps(deps).pool.query(
    "SELECT * FROM `agent_chain_events` WHERE event_id = ? LIMIT 1",
    [event_id]
  );
  return rows[0] || null;
}

async function resolveAgentForWorkflow(workflow_key, hintAgentId, deps = {}) {
  const { pool } = runtimeDeps(deps);
  if (hintAgentId) {
    const [hintRows] = await pool.query(
      `SELECT agent_id FROM \`agents\`
       WHERE agent_id = ? AND status = 'active' AND health_status = 'active'
       LIMIT 1`,
      [hintAgentId]
    ).catch(() => [[]]);
    if (hintRows[0]?.agent_id) return hintRows[0].agent_id;
  }
  const [rows] = await pool.query(
    `SELECT a.agent_id FROM \`task_routes\` tr
     JOIN \`agents\` a ON a.execution_layer = tr.execution_layer
     WHERE tr.workflow_key = ? AND a.status = 'active' AND a.health_status = 'active'
     ORDER BY a.agent_id ASC LIMIT 1`,
    [workflow_key]
  ).catch(() => [[]]);
  return rows[0]?.agent_id || null;
}

async function resolveFallbackAgent(agent_id, deps = {}) {
  if (!agent_id) return null;
  const [rows] = await runtimeDeps(deps).pool.query(
    `SELECT fallback.agent_id
     FROM \`agents\` source
     JOIN \`agents\` fallback ON fallback.agent_id = source.fallback_agent_id
     WHERE source.agent_id = ?
       AND fallback.status = 'active' AND fallback.health_status = 'active'
     LIMIT 1`,
    [agent_id]
  ).catch(() => [[]]);
  return rows[0]?.agent_id || null;
}

// ─── Plan factory ──────────────────────────────────────────────────────────────

async function createChainPlan(event, workflowDef, overrideAgentId = null, deps = {}) {
  const { pool, randomUUID: nextId } = runtimeDeps(deps);
  const plan_id = nextId();
  const agent_id = overrideAgentId || await resolveAgentForWorkflow(
    event.target_workflow_key,
    event.target_agent_id,
    deps
  );
  if (!agent_id) {
    const error = new Error(`No healthy agent is available for workflow '${event.target_workflow_key}'.`);
    error.code = "chain_agent_unavailable";
    throw error;
  }

  let sourcePayload = {};
  try { sourcePayload = JSON.parse(event.payload_json || "{}"); } catch {}

  await pool.query(
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

export async function dispatchChainEvent(event_id, deps = {}) {
  const delegation = requireAgentDelegationOptIn(deps.delegationRequest);
  const runtime = runtimeDeps(deps);
  const { pool } = runtime;
  const pendingEvent = await loadEvent(event_id, deps);
  if (!pendingEvent) return { ok: false, error: "event_not_found", event_id };
  let workflowPath = [];
  try {
    workflowPath = Array.isArray(pendingEvent.workflow_path_json)
      ? pendingEvent.workflow_path_json
      : JSON.parse(pendingEvent.workflow_path_json || "[]");
  } catch {}
  if (workflowPath.length !== new Set(workflowPath).size) {
    await pool.query(
      "UPDATE `agent_chain_events` SET status = 'skipped', failure_reason = 'chain_cycle_detected' WHERE event_id = ? AND status = 'pending'",
      [event_id]
    );
    return { ok: false, skipped: true, reason: "chain_cycle_detected", event_id };
  }
  if (Number(pendingEvent.chain_depth || 0) > Number(pendingEvent.max_chain_depth || 8)) {
    await pool.query(
      "UPDATE `agent_chain_events` SET status = 'skipped', failure_reason = 'chain_depth_exceeded' WHERE event_id = ? AND status = 'pending'",
      [event_id]
    );
    return { ok: false, skipped: true, reason: "chain_depth_exceeded", event_id };
  }

  const [claim] = await pool.query(
    "UPDATE `agent_chain_events` SET status = 'dispatched', dispatched_at = NOW() WHERE event_id = ? AND status = 'pending'",
    [event_id]
  );

  if (claim.affectedRows === 0) {
    const evt = await loadEvent(event_id, deps);
    return { ok: false, skipped: true, reason: `event already in status '${evt?.status || 'unknown'}'`, event_id };
  }

  const event = await loadEvent(event_id, deps);
  if (!event) return { ok: false, error: "event_not_found", event_id };

  let plan_id, agent_id, fallback_agent_id, workflowDef, dispatchResult, dispatchError;
  try {
    const workflowResolution = await runtime.resolveRuntimeWorkflow({
      workflow_key: event.target_workflow_key,
    });
    if (!workflowResolution.ok) {
      const error = new Error(workflowResolution.resolution.message);
      error.code = workflowResolution.resolution.code;
      throw error;
    }
    workflowDef = workflowResolution.workflow;

    ({ plan_id, agent_id } = await createChainPlan(event, workflowDef, null, deps));
    dispatchResult = await runtime.dispatchPlan(plan_id, { apply: false, actor_id: `chain:${event.source_agent_id || "system"}` });
    if (!dispatchResult.ok) {
      const error = new Error(dispatchResult.error?.message || "dispatchPlan returned ok=false");
      error.code = dispatchResult.error?.code || "chain_primary_dispatch_failed";
      throw error;
    }
    await pool.query(
      "UPDATE `agent_chain_events` SET dispatched_run_id = ? WHERE event_id = ?",
      [dispatchResult.run_id || null, event_id]
    );

  } catch (err) {
    dispatchError = err;
    fallback_agent_id = delegation.fallback_agent_allowed
      ? await resolveFallbackAgent(agent_id || event.target_agent_id, deps)
      : null;
    if (delegation.fallback_agent_allowed && workflowDef && fallback_agent_id && fallback_agent_id !== agent_id) {
      try {
        ({ plan_id, agent_id } = await createChainPlan(event, workflowDef, fallback_agent_id, deps));
        dispatchResult = await runtime.dispatchPlan(plan_id, { apply: false, actor_id: `chain-fallback:${event.source_agent_id || "system"}` });
        if (!dispatchResult.ok) throw new Error(dispatchResult.error?.message || "Fallback dispatch returned ok=false");
        dispatchError = null;
        await pool.query(
          "UPDATE `agent_chain_events` SET fallback_agent_id = ?, dispatched_run_id = ?, failure_reason = NULL WHERE event_id = ?",
          [fallback_agent_id, dispatchResult.run_id || null, event_id]
        );
      } catch (fallbackError) {
        dispatchError = fallbackError;
      }
    }
    if (dispatchError) {
      await pool.query(
        "UPDATE `agent_chain_events` SET status = 'failed', fallback_agent_id = ?, failure_reason = ? WHERE event_id = ?",
        [fallback_agent_id, dispatchError.message.slice(0, 255), event_id]
      ).catch(() => {});
    }
  }

  return { ok: !dispatchError, event_id, plan_id: plan_id || null, agent_id: agent_id || null, fallback_agent_id: fallback_agent_id || null, target_workflow: event.target_workflow_key, run_id: dispatchResult?.run_id || null, delegation_mode: delegation.delegation_mode, error: dispatchError ? dispatchError.message : undefined };
}

// ─── Batch sweep ───────────────────────────────────────────────────────────────

export async function dispatchPendingChainEvents({ tenant_id, limit = 20 } = {}, deps = {}) {
  requireAgentDelegationOptIn(deps.delegationRequest);
  const { pool } = runtimeDeps(deps);
  let sql = "SELECT event_id FROM `agent_chain_events` WHERE status = 'pending'";
  const params = [];
  if (tenant_id) { sql += " AND tenant_id = ?"; params.push(tenant_id); }
  sql += " ORDER BY created_at ASC LIMIT ?";
  params.push(Number(limit));

  const [rows] = await pool.query(sql, params);
  if (!rows.length) return { ok: true, dispatched: 0, failed: 0, skipped: 0, results: [] };

  // Sequential — avoids lock contention on execution_plan creation for the same tenant.
  const results = [];
  for (const { event_id } of rows) {
    results.push(await dispatchChainEvent(event_id, deps));
  }
  const succeeded = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;

  return { ok: failed === 0, dispatched: succeeded, failed, skipped, results };
}
