function boundedJson(value, max = 8000) {
  try {
    return JSON.stringify(value ?? {}, null, 2).slice(0, max);
  } catch {
    return JSON.stringify({ serialization_error: true, secrets_included: false });
  }
}

export function assembleAgentSystemPrompt({ logicBody = {}, context = {} } = {}) {
  const parts = [
    "You are executing inside a governed platform runtime. Follow the supplied authority and output contracts. Never infer missing authority.",
  ];
  if (context.prompt_envelope) parts.push(`Governed execution envelope:\n${boundedJson(context.prompt_envelope)}`);
  if (logicBody.trigger_phrase) parts.push(`Trigger: ${logicBody.trigger_phrase}`);
  if (logicBody.action_class) parts.push(`Action class: ${logicBody.action_class}`);
  if (logicBody.execution_layer) parts.push(`Execution layer: ${logicBody.execution_layer}`);
  if (logicBody.module_binding) parts.push(`Module: ${logicBody.module_binding}`);
  if (logicBody.system_prompt) parts.push(String(logicBody.system_prompt));
  return parts.filter(Boolean).join("\n\n");
}
