#!/usr/bin/env node
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";
import { runOpenClaudeOpenRouterLiveDispatch } from "../openClaudeBridgeRuntime.js";
import { writeExecutionEvidence } from "../executionEvidenceLogger.js";

const CONFIRMATION = "CERTIFY_SUPERVISOR_CAUSAL_PROVIDER_LANE";
const TENANT_ID = "supervisor-certification";
const WORKFLOW_KEY = "supervisor_causal_provider_certification";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { confirm: "", maxTokens: 32, timeoutMs: 30000 };
  for (const item of argv) {
    if (item.startsWith("--confirm=")) args.confirm = item.slice("--confirm=".length);
    else if (item.startsWith("--max-tokens=")) args.maxTokens = Number(item.slice("--max-tokens=".length));
    else if (item.startsWith("--timeout-ms=")) args.timeoutMs = Number(item.slice("--timeout-ms=".length));
  }
  args.maxTokens = Math.min(Math.max(Number(args.maxTokens) || 32, 1), 64);
  args.timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 30000, 1000), 30000);
  return args;
}

async function selectHealthySupervisorAgent(pool) {
  const [rows] = await pool.query(
    `SELECT DISTINCT a.agent_id
       FROM agents a
       JOIN agent_skill_grants g ON BINARY g.agent_id = BINARY a.agent_id
      WHERE a.status = 'active' AND a.health_status = 'active'
        AND g.skill_key = 'logic.evaluate_pack' AND g.status = 'active'
      ORDER BY a.agent_id
      LIMIT 1`
  );
  if (!rows[0]?.agent_id) throw new Error("No healthy supervisor-eligible agent with logic.evaluate_pack authority is available.");
  return rows[0].agent_id;
}

async function createCausalRecords(pool, { planId, runId, traceId, agentId }) {
  const context = JSON.stringify({
    certification: "supervisor_causal_provider_lane",
    trace_id: traceId,
    provider_calls_allowed: 1,
    tools_allowed: 0,
    repo_mutation_allowed: false,
    secrets_included: false,
  });
  await pool.query(
    `INSERT INTO execution_plans
      (plan_id, tenant_id, actor_id, actor_type, intent_key, correlation_id, execution_context_json,
       workflow_key, agent_id, service_mode, access_decision, plan_status, runtime_status, steps_json)
     VALUES (?, ?, 'codex', 'system', 'certify_supervisor_causal_provider_lane', ?, ?, ?, ?,
             'self_serve', 'ALLOW_SELF_SERVE', 'executing', 'provider_dispatch_running', ?)`,
    [planId, TENANT_ID, traceId, context, WORKFLOW_KEY, agentId, JSON.stringify([{ step_key: "provider_dispatch", tools_allowed: 0 }])]
  );
  await pool.query(
    `INSERT INTO workflow_runs
      (run_id, tenant_id, actor_id, actor_type, correlation_id, execution_context_json,
       workflow_key, agent_id, plan_id, service_mode, status, current_step, input_json, started_at)
     VALUES (?, ?, 'codex', 'system', ?, ?, ?, ?, ?, 'self_serve', 'running', 'provider_dispatch', ?, NOW())`,
    [runId, TENANT_ID, traceId, context, WORKFLOW_KEY, agentId, planId, context]
  );
}

async function finalizeRecords(pool, { planId, runId, ok, output, error }) {
  await pool.query(
    `UPDATE workflow_runs
        SET status = ?, output_json = ?, error_json = ?, completed_at = NOW()
      WHERE run_id = ?`,
    [ok ? "completed" : "failed", output ? JSON.stringify(output) : null, error ? JSON.stringify(error) : null, runId]
  );
  await pool.query(
    "UPDATE execution_plans SET plan_status = ?, runtime_status = ? WHERE plan_id = ?",
    [ok ? "completed" : "failed", ok ? "provider_response_certified" : "provider_dispatch_failed", planId]
  );
}

export async function runSupervisorCausalProviderCertification(options = {}) {
  if (options.confirm !== CONFIRMATION) throw new Error(`Use --confirm=${CONFIRMATION}`);
  const pool = getPool();
  const planId = randomUUID();
  const runId = randomUUID();
  const traceId = `supervisor_causal_provider_certification:${new Date().toISOString().slice(0, 10)}:${randomUUID()}`;
  const agentId = await selectHealthySupervisorAgent(pool);

  await createCausalRecords(pool, { planId, runId, traceId, agentId });
  try {
    const provider = await runOpenClaudeOpenRouterLiveDispatch({
      maxTokens: options.maxTokens,
      timeoutMs: options.timeoutMs,
      messages: [
        { role: "system", content: "You are a bounded supervisor causal certification. Do not call tools. Reply with exactly SUPERVISOR_CAUSAL_PROVIDER_OK." },
        { role: "user", content: "Return exactly SUPERVISOR_CAUSAL_PROVIDER_OK." },
      ],
    });
    const output = {
      response_exact: String(provider.content || "").trim() === "SUPERVISOR_CAUSAL_PROVIDER_OK",
      model: provider.model,
      provider_key: provider.provider_key,
      profile_key: provider.profile_key,
      tokens_used: provider.tokens_used,
      provider_dispatch_attempted: provider.provider_dispatch_attempted === true,
      local_execution_attempted: provider.local_execution_attempted === true,
      repo_mutation_allowed: provider.repo_mutation_allowed === true,
      tool_call_count: Array.isArray(provider.tool_calls) ? provider.tool_calls.length : 0,
      secrets_included: false,
    };
    if (!provider.ok || !output.response_exact || output.tool_call_count !== 0 || output.local_execution_attempted || output.repo_mutation_allowed) {
      throw new Error(`Causal provider certification boundary failed: ${JSON.stringify(output)}`);
    }
    await finalizeRecords(pool, { planId, runId, ok: true, output });
    await writeExecutionEvidence({
      pool,
      traceId,
      entryType: "supervisor_causal_provider_certification",
      executionClass: "governed_supervisor_certification",
      sourceLayer: "supervisor_causal_provider_certification",
      userInput: "Bounded supervisor plan-to-workflow-run-to-provider certification",
      routeKeys: WORKFLOW_KEY,
      selectedWorkflows: WORKFLOW_KEY,
      executionMode: "live_provider_no_tools",
      decisionTrigger: "explicit_user_approval",
      executionStatus: "success",
      executionReadyStatus: "causal_provider_certified",
      outputSummary: { plan_id: planId, run_id: runId, ...output },
      actorId: "codex",
      actorType: "system",
      agentId,
      workflowKey: WORKFLOW_KEY,
      modelKey: output.model,
      modelProviderKey: output.provider_key,
      resourceType: "execution_plan",
      resourceId: planId,
      targetType: "workflow_run",
      targetId: runId,
      correlationId: traceId,
      idempotencyKey: traceId,
      runtimeEvidence: { plan_id: planId, run_id: runId, ...output },
      executionEvidenceStatus: "complete",
    });
    return { ok: true, trace_id: traceId, plan_id: planId, run_id: runId, agent_id: agentId, ...output };
  } catch (error) {
    await finalizeRecords(pool, { planId, runId, ok: false, error: { code: error.code || "causal_provider_certification_failed", message: error.message } }).catch(() => {});
    throw error;
  }
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  runSupervisorCausalProviderCertification(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
    })
    .catch(async (error) => {
      process.stderr.write(`${JSON.stringify({ ok: false, error: { code: error.code || "supervisor_causal_provider_certification_failed", message: error.message }, secrets_included: false })}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
