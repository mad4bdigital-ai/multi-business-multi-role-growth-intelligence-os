#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { dispatchChainEvent } from "../chainEventDispatcher.js";
import { writeExecutionEvidence } from "../executionEvidenceLogger.js";

const APPLY_CONFIRMATION = "APPLY_SUPERVISOR_BEHAVIORAL_CERTIFICATION";
const apply = process.argv.includes("--apply");
const confirm = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length) || "";

if (!apply) {
  console.log(JSON.stringify({
    ok: true,
    mode: "dry_run",
    applies_provider_calls: false,
    persistent_fixture_writes: false,
    transaction_rollback_required: true,
    required_confirmation: APPLY_CONFIRMATION,
    secrets_included: false,
  }, null, 2));
  process.exit(0);
}
if (confirm !== APPLY_CONFIRMATION) throw new Error(`Apply requires --confirm=${APPLY_CONFIRMATION}`);

const pool = getPool();
const connection = await pool.getConnection();
const tenantId = "supervisor-certification";
const workflowKey = "supervisor_certification_no_provider";
const delegationRequest = {
  delegation_approved: true,
  delegation_mode: "manual_api",
  delegation_reason: "Controlled transaction-rollback supervisor behavioral certification.",
  allow_fallback_agent: true,
};
const createdPlanIds = [];
const createdRunIds = [];
let rolledBack = false;

async function insertEvent(event) {
  await connection.query(
    `INSERT INTO agent_chain_events
      (event_id, root_event_id, parent_event_id, chain_depth, max_chain_depth, workflow_path_json,
       source_run_id, source_agent_id, target_workflow_key, target_agent_id, tenant_id,
       trigger_condition, payload_json, status, failure_reason)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'always', ?, 'pending', NULL)`,
    [
      event.event_id, event.event_id, event.chain_depth || 0, event.max_chain_depth || 8,
      JSON.stringify(event.workflow_path || [workflowKey]), event.source_run_id || randomUUID(),
      event.source_agent_id || null, workflowKey, event.target_agent_id || null, tenantId,
      JSON.stringify({ certification: true, provider_calls: 0, secrets_included: false }),
    ]
  );
}

try {
  await connection.beginTransaction();
  const [agentRows] = await connection.query(
    `SELECT source.agent_id AS primary_agent_id, fallback.agent_id AS fallback_agent_id
       FROM agents source
       JOIN agents fallback ON BINARY fallback.agent_id = BINARY source.fallback_agent_id
      WHERE source.status='active' AND source.health_status='active'
        AND fallback.status='active' AND fallback.health_status='active'
      ORDER BY source.agent_id
      LIMIT 1`
  );
  const agents = agentRows[0];
  if (!agents) throw new Error("No active primary/fallback agent pair is available for live certification.");

  const workflowResolver = async () => ({ ok: true, workflow: { workflow_id: null, workflow_key: workflowKey } });
  const controlledDispatch = async (planId, options = {}) => {
    if (options.actor_id?.startsWith("chain:cert-fallback-primary")) {
      return { ok: false, error: { code: "controlled_primary_failure", message: "Controlled primary failure for fallback certification." } };
    }
    const runId = randomUUID();
    await connection.query(
      `INSERT INTO workflow_runs
        (run_id, tenant_id, workflow_key, plan_id, service_mode, status, input_json, output_json, started_at, completed_at)
       VALUES (?, ?, ?, ?, 'self_serve', 'completed', ?, ?, NOW(), NOW())`,
      [
        runId, tenantId, workflowKey, planId,
        JSON.stringify({ certification: true, provider_calls: 0, secrets_included: false }),
        JSON.stringify({ ok: true, certification: true, secrets_included: false }),
      ]
    );
    createdPlanIds.push(planId);
    createdRunIds.push(runId);
    return { ok: true, run_id: runId };
  };
  const deps = { pool: connection, dispatchPlan: controlledDispatch, resolveRuntimeWorkflow: workflowResolver, delegationRequest };

  const claimEventId = randomUUID();
  await insertEvent({ event_id: claimEventId, source_agent_id: "cert-claim", target_agent_id: agents.primary_agent_id });
  const claimed = await dispatchChainEvent(claimEventId, deps);
  const duplicate = await dispatchChainEvent(claimEventId, deps);

  const fallbackEventId = randomUUID();
  await insertEvent({ event_id: fallbackEventId, source_agent_id: "cert-fallback-primary", target_agent_id: agents.primary_agent_id });
  const fallback = await dispatchChainEvent(fallbackEventId, deps);

  const cycleEventId = randomUUID();
  await insertEvent({ event_id: cycleEventId, target_agent_id: agents.primary_agent_id, workflow_path: [workflowKey, workflowKey] });
  const cycle = await dispatchChainEvent(cycleEventId, deps);

  const depthEventId = randomUUID();
  await insertEvent({ event_id: depthEventId, target_agent_id: agents.primary_agent_id, chain_depth: 9, max_chain_depth: 8 });
  const depth = await dispatchChainEvent(depthEventId, deps);

  const checks = {
    atomic_claim: claimed.ok === true && duplicate.skipped === true,
    workflow_run_created: createdRunIds.length === 2,
    fallback_dispatch: fallback.ok === true && fallback.fallback_agent_id === agents.fallback_agent_id,
    cycle_rejection: cycle.reason === "chain_cycle_detected",
    depth_rejection: depth.reason === "chain_depth_exceeded",
  };
  if (Object.values(checks).some((value) => value !== true)) {
    throw new Error(`Live certification check failed: ${JSON.stringify(checks)}`);
  }

  await connection.rollback();
  rolledBack = true;

  const traceId = `supervisor_behavioral_certification:${new Date().toISOString().slice(0, 10)}:${randomUUID()}`;
  await writeExecutionEvidence({
    pool,
    traceId,
    entryType: "supervisor_behavioral_certification",
    executionClass: "governed_supervisor_certification",
    sourceLayer: "supervisor_behavioral_certification",
    userInput: "Controlled transaction-rollback supervisor behavioral certification",
    routeKeys: "supervisor_behavioral_certification",
    selectedWorkflows: workflowKey,
    executionMode: "transaction_rollback_no_provider",
    decisionTrigger: "explicit_user_approval",
    executionStatus: "success",
    executionReadyStatus: "behaviorally_certified",
    outputSummary: { checks, created_plan_count: createdPlanIds.length, created_run_count: createdRunIds.length, transaction_rolled_back: true, provider_calls: 0, secrets_included: false },
    actorId: "codex",
    actorType: "system",
    roleKeys: ["admin_operator"],
    policyKeys: ["governed_migration_runner_authorization_v1"],
    workflowKey,
    resourceType: "supervisor_runtime",
    resourceId: "behavioral_certification",
    targetType: "supervisor_runtime",
    targetId: "production",
    correlationId: traceId,
    idempotencyKey: traceId,
    runtimeEvidence: { checks, transaction_rolled_back: true, provider_calls: 0 },
    executionEvidenceStatus: "complete",
  });

  console.log(JSON.stringify({
    ok: true,
    mode: "apply_transaction_rollback",
    checks,
    created_plan_count: createdPlanIds.length,
    created_run_count: createdRunIds.length,
    transaction_rolled_back: true,
    execution_trace_id: traceId,
    provider_calls: 0,
    secrets_included: false,
  }, null, 2));
} finally {
  if (!rolledBack) await connection.rollback().catch(() => {});
  connection.release();
  await pool.end();
}
