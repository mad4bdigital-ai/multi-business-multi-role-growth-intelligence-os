#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { runOpenRouterProviderSmoke } from "./openrouter-provider-smoke.mjs";
import {
  recordAgentModelRunStarted,
  recordAgentModelRunCompleted,
  recordAgentModelRunFailed,
  recordAgentToolCallStarted,
  recordAgentToolCallCompleted,
  recordAgentToolCallFailed,
} from "../agentRuntimeLedger.js";
import { writeExecutionEvidence } from "../executionEvidenceLogger.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { maxTokens: 8, timeoutMs: 30000 };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--max-tokens") args.maxTokens = Number(argv[++i] || args.maxTokens);
    else if (item.startsWith("--max-tokens=")) args.maxTokens = Number(item.slice("--max-tokens=".length));
    else if (item === "--timeout-ms") args.timeoutMs = Number(argv[++i] || args.timeoutMs);
    else if (item.startsWith("--timeout-ms=")) args.timeoutMs = Number(item.slice("--timeout-ms=".length));
  }
  args.maxTokens = Math.min(Math.max(Number(args.maxTokens) || 8, 1), 32);
  args.timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 30000, 1000), 30000);
  return args;
}

async function readTraceRows(pool, traceId) {
  const [[modelRows]] = await pool.query(
    `SELECT COUNT(*) AS row_count,
            SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed_count,
            SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(COALESCE(input_message_summary_json,'{}'),'$.raw_content_stored')) = 'false' THEN 1 ELSE 0 END) AS no_raw_input_count,
            SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(COALESCE(output_message_summary_json,'{}'),'$.raw_content_stored')) = 'false' THEN 1 ELSE 0 END) AS no_raw_output_count,
            SUM(CASE WHEN no_raw_thinking_stored = 1 THEN 1 ELSE 0 END) AS no_raw_thinking_count
       FROM agent_model_runs
      WHERE trace_id = ?`,
    [traceId]
  );
  const [[toolRows]] = await pool.query(
    `SELECT COUNT(*) AS row_count,
            SUM(CASE WHEN authorization_status='authorized' THEN 1 ELSE 0 END) AS authorized_count,
            SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(COALESCE(input_summary_json,'{}'),'$.raw_args_stored')) = 'false' THEN 1 ELSE 0 END) AS no_raw_args_count,
            SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(COALESCE(output_summary_json,'{}'),'$.raw_result_stored')) = 'false' THEN 1 ELSE 0 END) AS no_raw_result_count,
            SUM(CASE WHEN secrets_returned_to_model = 0 THEN 1 ELSE 0 END) AS no_secret_return_count
       FROM agent_tool_calls
      WHERE trace_id = ?`,
    [traceId]
  );
  const [[executionRow]] = await pool.query(
    `SELECT id, execution_status, execution_evidence_status, model_run_id, model_key, model_provider_key,
            tool_key, app_key, action_key, JSON_VALID(COALESCE(model_evidence_json,'{}')) AS model_evidence_json_valid,
            JSON_VALID(COALESCE(runtime_evidence_json,'{}')) AS runtime_evidence_json_valid
       FROM execution_log
      WHERE execution_trace_id_writeback = ?
      ORDER BY id DESC
      LIMIT 1`,
    [traceId]
  );
  return { modelRows, toolRows, executionRow: executionRow || null };
}

async function writeLiveTraceEvidence({ pool, traceId, modelRunId, providerResult, startedAt, endedAt }) {
  const policyKeys = [
    "model_never_executes_tools_policy_v1",
    "openrouter_provider_smoke_capability_binding_policy_v1",
    "openrouter_provider_smoke_app_map_binding_policy_v1",
  ];
  await writeExecutionEvidence({
    pool,
    traceId,
    entryType: "agent_runtime_live_trace_smoke",
    executionClass: "agent_runtime_live_trace",
    sourceLayer: "agent_runtime_live_trace_smoke",
    userInput: "bounded OpenRouter live trace smoke without external write",
    routeKeys: "openrouter_provider_smoke",
    selectedWorkflows: "agent_runtime_live_trace_smoke",
    executionMode: "live_provider_dispatch_smoke",
    decisionTrigger: "capability_envelope_approved_live_trace",
    executionStatus: "success",
    createdAt: startedAt,
    endedAt,
    durationSeconds: Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000)),
    outputSummary: {
      smoke: "agent_runtime_live_trace_smoke",
      provider_key: providerResult.provider_key,
      model_key: providerResult.model,
      response_nonempty: providerResult.response_nonempty,
      tokens_used: providerResult.tokens_used,
      external_write: false,
      external_send: false,
      credential_payload_returned: false,
      secrets_included: false,
    },
    tenantId: "00000000-0000-0000-0000-000000000000",
    workspaceId: "b50db01b-617e-4b7a-8bda-6bf4876f754f",
    userId: "platform_admin",
    actorId: "platform_admin",
    actorType: "admin_gpt",
    roleKeys: ["platform_admin", "operator"],
    policyKeys,
    parentActionKey: "openrouter_provider_smoke",
    endpointKey: "admin_control.shell.openrouter_provider_smoke",
    toolKey: "openrouter_provider_smoke",
    appKey: "openrouter_openai_compatible",
    actionKey: "openrouter_provider_smoke",
    connectorFamily: "openai_compatible",
    providerFamily: "openrouter",
    modelKey: providerResult.model,
    modelProviderKey: providerResult.provider_key,
    modelRunId,
    resourceType: "agent_runtime_live_trace",
    resourceId: traceId,
    targetType: "agent_runtime_ledger",
    targetId: modelRunId,
    correlationId: traceId,
    idempotencyKey: traceId,
    agentKey: "platform_agent_runtime_live_trace_smoke",
    skillKey: "provider_smoke_certification",
    workflowKey: "agent_runtime_live_trace_smoke",
    workflowBindingKey: "openrouter_provider_smoke_capability_binding_v1",
    appEvidence: { app_key: "openrouter_openai_compatible", credential_source: "platform_managed" },
    workflowEvidence: { workflow_key: "agent_runtime_live_trace_smoke", external_write: false, external_send: false },
    roleEvidence: { role_keys: ["platform_admin", "operator"] },
    policyEvidence: { policy_keys: policyKeys },
    authorizationEvidence: { envelope_required: true, dispatch_allowed: true, approval_required: true },
    runtimeEvidence: { live_provider_call: true, provider_key: providerResult.provider_key, no_external_write: true, no_secret_return: true },
    modelEvidence: { model_key: providerResult.model, provider_key: providerResult.provider_key, model_run_id: modelRunId, tokens_used: providerResult.tokens_used },
    engineEvidence: { engine_key: "provider_smoke_certification_engine" },
    logicEvidence: { logic_key: "agent_runtime_live_trace_smoke" },
    knowledgeEvidence: { source: "platform_runtime_config.openrouter_model_selection_policy_v1" },
    executionEvidenceStatus: "complete",
  });
}

async function main() {
  const pool = getPool();
  const args = parseArgs();
  const traceId = `agent_runtime_live_trace:${randomUUID()}`;
  const context = {
    decision_run_id: traceId,
    execution_trace_id: traceId,
    logic_key: "agent_runtime_live_trace_smoke",
  };
  const messages = [
    { role: "system", content: "You are a provider smoke test. Reply with exactly OK." },
    { role: "user", content: "Return exactly OK." },
  ];
  let modelRunId = null;
  let toolCallId = null;
  const startedAt = new Date().toISOString();
  try {
    modelRunId = await recordAgentModelRunStarted({
      context,
      messages,
      tools: [{ type: "function", function: { name: "openrouter_provider_smoke" } }],
      providerKey: "openrouter_openai_compatible",
      modelKey: "openai/gpt-4o-mini",
      traceId,
    });
    toolCallId = await recordAgentToolCallStarted({
      context,
      modelRunId,
      toolKey: "openrouter_provider_smoke",
      args: { max_tokens: args.maxTokens, timeout_ms: args.timeoutMs, promote_active: false, raw_args_stored: false },
    });

    const providerResult = await runOpenRouterProviderSmoke({ maxTokens: args.maxTokens, timeoutMs: args.timeoutMs, promoteActive: false });
    await recordAgentToolCallCompleted({ toolCallId, result: providerResult, status: "authorized" });
    await recordAgentModelRunCompleted({
      modelRunId,
      response: {
        content: providerResult.response_preview || "OK",
        tokens_used: providerResult.tokens_used || 0,
        provider_key: providerResult.provider_key,
        model_key: providerResult.model,
      },
      status: "completed",
    });
    const endedAt = new Date().toISOString();
    await writeLiveTraceEvidence({ pool, traceId, modelRunId, providerResult, startedAt, endedAt });
    const readback = await readTraceRows(pool, traceId);
    const ok = providerResult.ok === true
      && Number(readback.modelRows?.row_count || 0) >= 1
      && Number(readback.modelRows?.completed_count || 0) >= 1
      && Number(readback.toolRows?.row_count || 0) >= 1
      && Number(readback.toolRows?.authorized_count || 0) >= 1
      && readback.executionRow?.execution_evidence_status === "complete"
      && readback.executionRow?.model_run_id === modelRunId;

    console.log(JSON.stringify({
      ok,
      smoke: "agent_runtime_live_trace_smoke",
      trace_id: traceId,
      model_run_id: modelRunId,
      tool_call_id: toolCallId,
      provider_result: providerResult,
      readback,
      external_write: false,
      external_send: false,
      credential_payload_returned: false,
      secrets_included: false,
    }, null, 2));
    await pool.end().catch(() => {});
    process.exit(ok ? 0 : 2);
  } catch (error) {
    await recordAgentToolCallFailed({ toolCallId, error }).catch(() => {});
    await recordAgentModelRunFailed({ modelRunId, error }).catch(() => {});
    console.log(JSON.stringify({
      ok: false,
      smoke: "agent_runtime_live_trace_smoke",
      trace_id: traceId,
      model_run_id: modelRunId,
      tool_call_id: toolCallId,
      error: { code: error.code || "agent_runtime_live_trace_failed", message: error.message },
      external_write: false,
      external_send: false,
      credential_payload_returned: false,
      secrets_included: false,
    }, null, 2));
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

main();
