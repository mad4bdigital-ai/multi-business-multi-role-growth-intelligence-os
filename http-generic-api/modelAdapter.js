import { randomUUID } from "node:crypto";
import {
  recordAgentModelRunCompleted,
  recordAgentModelRunFailed,
  recordAgentModelRunStarted,
  recordAgentToolCallAuthorization,
  recordAgentToolCallCompleted,
  recordAgentToolCallFailed,
  recordAgentToolCallStarted,
} from "./agentRuntimeLedger.js";
import { assembleAgentSystemPrompt } from "./agentPromptAssembler.js";

function extractContent(response = {}) {
  if (typeof response.content === "string") return response.content;
  if (Array.isArray(response.content)) {
    return response.content
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n");
  }
  return "";
}

async function runToolCalls(toolCalls = [], context, deps, modelRunId = null) {
  const results = [];
  for (const tc of toolCalls) {
    const name = tc.function?.name || tc.name;
    const args = tc.function?.arguments
      ? (typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments)
      : (tc.arguments || {});
    const ledgerToolCallId = await recordAgentToolCallStarted({ context, modelRunId, toolKey: name, args });
    try {
      const authorization = typeof deps.authorizeToolCall === "function"
        ? await deps.authorizeToolCall({ tool_name: name, args, context, phase: "dispatch" })
        : {
            allowed: false,
            status: "denied",
            code: "agent_tool_authorization_gate_unavailable",
            blockers: ["agent_tool_authorization_gate_unavailable"],
            secrets_included: false,
          };
      await recordAgentToolCallAuthorization({ toolCallId: ledgerToolCallId, decision: authorization });
      if (!authorization.allowed) {
        const deniedResult = {
          ok: false,
          error: {
            code: authorization.code || "agent_tool_authorization_denied",
            message: "The governed agent tool authorization gate denied this call.",
          },
          authorization: {
            status: "denied",
            blocker_codes: authorization.blockers || [],
            consequence_class: authorization.classification?.consequence_class || null,
            action_key: authorization.action?.action_key || null,
            secrets_included: false,
          },
          external_send_performed: false,
          secrets_included: false,
        };
        await recordAgentToolCallCompleted({ toolCallId: ledgerToolCallId, result: deniedResult, status: "denied" });
        results.push({ tool_call_id: tc.id, ledger_tool_call_id: ledgerToolCallId, tool_name: name, args, result: deniedResult });
        continue;
      }
      const result = await deps.dispatchTool(name, args, { ...context, tool_authorization: authorization });
      await recordAgentToolCallCompleted({ toolCallId: ledgerToolCallId, result, status: result?.ok === false ? "failed" : "authorized" });
      results.push({ tool_call_id: tc.id, ledger_tool_call_id: ledgerToolCallId, tool_name: name, args, result });
    } catch (error) {
      await recordAgentToolCallFailed({ toolCallId: ledgerToolCallId, error });
      throw error;
    }
  }
  return results;
}

function toolResultMessages(results = []) {
  return results.map(r => ({
    role: "tool",
    tool_call_id: r.tool_call_id,
    content: typeof r.result === "string" ? r.result : JSON.stringify(r.result),
  }));
}

export async function runLogicWithModel(input = {}, deps = {}) {
  const {
    logic_key,
    logic_body = {},
    user_input = "",
    context = {},
    agent_system_prompt = "",
    engine_skill_prompts = [],
    tools = [],
    conversation = [],
    max_iterations = 5,
  } = input;

  const execution_trace_id = randomUUID();
  const systemPrompt = assembleAgentSystemPrompt({
    logicBody: logic_body,
    context,
    agentSystemPrompt: agent_system_prompt,
    engineSkillPrompts: engine_skill_prompts,
  });

  let messages = [
    { role: "system", content: systemPrompt },
    ...conversation,
    ...(user_input && !conversation.length ? [{ role: "user", content: user_input }] : []),
  ];

  let iteration_count = 0;
  let tool_calls_made = [];
  let tokens_used = 0;
  let output = "";

  while (iteration_count < max_iterations) {
    iteration_count++;
    const modelRunId = await recordAgentModelRunStarted({
      context: { ...context, logic_key, iteration: iteration_count, execution_trace_id },
      messages,
      tools,
      providerKey: deps.provider_key || deps.providerKey || deps.callModel?.provider_key || deps.callModel?.providerKey || "unknown",
      modelKey: deps.model_key || deps.modelKey || deps.callModel?.model_key || deps.callModel?.modelKey || "unknown",
      traceId: execution_trace_id,
    });
    let response;
    try {
      response = await deps.callModel(messages, tools);
      await recordAgentModelRunCompleted({ modelRunId, response, status: "completed" });
    } catch (error) {
      await recordAgentModelRunFailed({ modelRunId, error });
      throw error;
    }
    tokens_used += response.tokens_used || 0;

    const hasCalls = Array.isArray(response.tool_calls) && response.tool_calls.length > 0;

    if (!hasCalls) {
      output = extractContent(response);
      break;
    }

    messages.push({ role: "assistant", content: response.content || null, tool_calls: response.tool_calls });

    const results = await runToolCalls(response.tool_calls, { ...context, execution_trace_id }, deps, modelRunId);
    tool_calls_made.push(...results.map(r => ({ tool_name: r.tool_name, args: r.args, result: r.result, ledger_tool_call_id: r.ledger_tool_call_id })));
    messages.push(...toolResultMessages(results));
  }

  if (!output) {
    const finalModelRunId = await recordAgentModelRunStarted({
      context: { ...context, logic_key, iteration: "final", execution_trace_id },
      messages,
      tools: [],
      providerKey: deps.provider_key || deps.providerKey || deps.callModel?.provider_key || deps.callModel?.providerKey || "unknown",
      modelKey: deps.model_key || deps.modelKey || deps.callModel?.model_key || deps.callModel?.modelKey || "unknown",
      traceId: execution_trace_id,
    });
    try {
      const finalResponse = await deps.callModel(messages, []);
      await recordAgentModelRunCompleted({ modelRunId: finalModelRunId, response: finalResponse, status: "completed" });
      output = extractContent(finalResponse);
    } catch (error) {
      await recordAgentModelRunFailed({ modelRunId: finalModelRunId, error });
      throw error;
    }
  }

  return {
    ok: true,
    logic_key,
    output,
    tool_calls_made,
    iteration_count,
    tokens_used,
    execution_trace_id,
  };
}
