import { randomUUID } from "node:crypto";
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

async function runToolCalls(toolCalls = [], context, deps) {
  const results = [];
  for (const tc of toolCalls) {
    const name = tc.function?.name || tc.name;
    const args = tc.function?.arguments
      ? (typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments)
      : (tc.arguments || {});
    const result = await deps.dispatchTool(name, args, context);
    results.push({ tool_call_id: tc.id, tool_name: name, args, result });
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
    tools = [],
    conversation = [],
    max_iterations = 5,
  } = input;

  const execution_trace_id = randomUUID();
  const systemPrompt = assembleAgentSystemPrompt({ logicBody: logic_body, context });

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
    const response = await deps.callModel(messages, tools);
    tokens_used += response.tokens_used || 0;

    const hasCalls = Array.isArray(response.tool_calls) && response.tool_calls.length > 0;

    if (!hasCalls) {
      output = extractContent(response);
      break;
    }

    messages.push({ role: "assistant", content: response.content || null, tool_calls: response.tool_calls });

    const results = await runToolCalls(response.tool_calls, context, deps);
    tool_calls_made.push(...results.map(r => ({ tool_name: r.tool_name, args: r.args, result: r.result })));
    messages.push(...toolResultMessages(results));
  }

  if (!output) {
    output = extractContent(await deps.callModel(messages, []));
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
