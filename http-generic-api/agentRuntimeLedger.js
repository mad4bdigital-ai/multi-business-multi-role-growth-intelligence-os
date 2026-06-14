import { randomUUID } from "node:crypto";

async function pool() {
  const { getPool } = await import("./db.js");
  return getPool();
}

function safeJson(value, fallback = {}) {
  try { return JSON.stringify(value ?? fallback); } catch { return JSON.stringify(fallback); }
}

function roleCounts(messages = []) {
  const counts = {};
  for (const msg of Array.isArray(messages) ? messages : []) {
    const role = String(msg?.role || "unknown").slice(0, 32);
    counts[role] = (counts[role] || 0) + 1;
  }
  return counts;
}

function summarizeMessages(messages = [], tools = [], extra = {}) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  return {
    message_count: safeMessages.length,
    role_counts: roleCounts(safeMessages),
    total_content_chars: safeMessages.reduce((sum, msg) => sum + String(msg?.content || "").length, 0),
    tool_count: Array.isArray(tools) ? tools.length : 0,
    has_tool_messages: safeMessages.some((msg) => msg?.role === "tool"),
    raw_content_stored: false,
    secrets_included: false,
    ...extra,
  };
}

function summarizeOutput(response = {}) {
  const content = typeof response?.content === "string"
    ? response.content
    : Array.isArray(response?.content)
      ? response.content.filter((b) => b?.type === "text").map((b) => b?.text || "").join("\n")
      : "";
  return {
    content_chars: String(content || "").length,
    tool_call_count: Array.isArray(response?.tool_calls) ? response.tool_calls.length : 0,
    tokens_used: Number(response?.tokens_used || 0) || 0,
    raw_content_stored: false,
    secrets_included: false,
  };
}

function summarizeToolInput(args = {}) {
  const obj = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  return {
    arg_keys: Object.keys(obj).slice(0, 50),
    arg_count: Object.keys(obj).length,
    raw_args_stored: false,
    secrets_included: false,
  };
}

function summarizeToolOutput(result = {}) {
  const ok = result?.ok !== false;
  const code = result?.error?.code || result?.code || result?.error || null;
  return {
    ok,
    error_code: code ? String(code).slice(0, 191) : null,
    result_type: Array.isArray(result) ? "array" : typeof result,
    raw_result_stored: false,
    secrets_included: false,
  };
}

function summarizeError(error = {}) {
  return {
    code: String(error?.code || error?.status || "runtime_error").slice(0, 191),
    message: String(error?.message || "runtime error").slice(0, 500),
    status: error?.status || null,
    secrets_included: false,
  };
}

export async function recordAgentModelRunStarted({ context = {}, messages = [], tools = [], providerKey = "unknown", modelKey = "unknown", traceId = null } = {}) {
  const modelRunId = randomUUID();
  try {
    await (await pool()).query(
      `INSERT INTO \`agent_model_runs\`
         (model_run_id, decision_run_id, model_key, provider_key, status,
          input_message_summary_json, content_block_counts_json, no_raw_thinking_stored, trace_id, created_at)
       VALUES (?, ?, ?, ?, 'started', ?, ?, 1, ?, UTC_TIMESTAMP())`,
      [
        modelRunId,
        context.decision_run_id || context.run_id || context.plan_id || null,
        String(modelKey || "unknown").slice(0, 191),
        String(providerKey || "unknown").slice(0, 191),
        safeJson(summarizeMessages(messages, tools, { logic_key: context.logic_key || null, iteration: context.iteration || null })),
        safeJson({ input_message_count: Array.isArray(messages) ? messages.length : 0, tool_count: Array.isArray(tools) ? tools.length : 0, secrets_included: false }),
        traceId || context.execution_trace_id || null,
      ]
    );
  } catch { /* non-blocking ledger */ }
  return modelRunId;
}

export async function recordAgentModelRunCompleted({ modelRunId, response = {}, status = "completed" } = {}) {
  if (!modelRunId) return;
  const normalizedStatus = ["completed", "failed", "cancelled", "streaming", "started"].includes(status) ? status : "completed";
  try {
    await (await pool()).query(
      `UPDATE \`agent_model_runs\`
          SET status = ?, output_message_summary_json = ?, cost_ledger_json = ?, completed_at = UTC_TIMESTAMP()
        WHERE model_run_id = ?`,
      [
        normalizedStatus,
        safeJson(summarizeOutput(response)),
        safeJson({ tokens_used: Number(response?.tokens_used || 0) || 0, provider_key: response?.provider_key || null, model_key: response?.model_key || null, secrets_included: false }),
        modelRunId,
      ]
    );
  } catch { /* non-blocking ledger */ }
}

export async function recordAgentModelRunFailed({ modelRunId, error } = {}) {
  if (!modelRunId) return;
  try {
    await (await pool()).query(
      `UPDATE \`agent_model_runs\`
          SET status = 'failed', output_message_summary_json = ?, completed_at = UTC_TIMESTAMP()
        WHERE model_run_id = ?`,
      [safeJson({ error: summarizeError(error), raw_content_stored: false, secrets_included: false }), modelRunId]
    );
  } catch { /* non-blocking ledger */ }
}

export async function recordAgentToolCallStarted({ context = {}, modelRunId = null, toolKey, args = {} } = {}) {
  const toolCallId = randomUUID();
  try {
    await (await pool()).query(
      `INSERT INTO \`agent_tool_calls\`
         (tool_call_id, decision_run_id, model_run_id, tool_key, authorization_status,
          pre_tool_gate_json, input_summary_json, secrets_returned_to_model, side_effect_confirmed_by_readback, trace_id, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, 0, 0, ?, UTC_TIMESTAMP())`,
      [
        toolCallId,
        context.decision_run_id || context.run_id || context.plan_id || null,
        modelRunId || null,
        String(toolKey || "unknown").slice(0, 191),
        safeJson({ gate: "agent_loop_dispatch", authorization_status: "authorized", secrets_included: false }),
        safeJson(summarizeToolInput(args)),
        context.execution_trace_id || context.trace_id || null,
      ]
    );
  } catch { /* non-blocking ledger */ }
  return toolCallId;
}

export async function recordAgentToolCallCompleted({ toolCallId, result = {}, status = "authorized" } = {}) {
  if (!toolCallId) return;
  const authStatus = ["authorized", "failed", "denied", "pending"].includes(status) ? status : "authorized";
  try {
    await (await pool()).query(
      `UPDATE \`agent_tool_calls\`
          SET authorization_status = ?, post_tool_readback_json = ?, output_summary_json = ?, completed_at = UTC_TIMESTAMP()
        WHERE tool_call_id = ?`,
      [
        authStatus,
        safeJson({ readback_status: result?.ok === false ? "failed" : "completed", side_effect_confirmed_by_readback: false, secrets_included: false }),
        safeJson(summarizeToolOutput(result)),
        toolCallId,
      ]
    );
  } catch { /* non-blocking ledger */ }
}

export async function recordAgentToolCallFailed({ toolCallId, error } = {}) {
  if (!toolCallId) return;
  try {
    await (await pool()).query(
      `UPDATE \`agent_tool_calls\`
          SET authorization_status = 'failed', error_json = ?, completed_at = UTC_TIMESTAMP()
        WHERE tool_call_id = ?`,
      [safeJson(summarizeError(error)), toolCallId]
    );
  } catch { /* non-blocking ledger */ }
}
