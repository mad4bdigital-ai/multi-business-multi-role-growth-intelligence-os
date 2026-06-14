function boundedJson(value, max = 8000) {
  try {
    return JSON.stringify(value ?? {}, null, 2).slice(0, max);
  } catch {
    return JSON.stringify({ serialization_error: true, secrets_included: false });
  }
}

function engineSkillPromptSection(skill = {}) {
  const identity = [skill.skill_key, skill.engine_key].filter(Boolean).join(" @ ");
  const contract = {
    required_tools: Array.isArray(skill.required_tools) ? skill.required_tools : [],
    forbidden_tools: Array.isArray(skill.forbidden_tools) ? skill.forbidden_tools : [],
    success_criteria: skill.success_criteria || {},
    fallback_behavior: skill.fallback_behavior || {},
    secrets_included: false,
  };
  return [
    `Selected engine skill contract: ${identity || "unknown"}`,
    skill.prompt_contract_version ? `Contract version: ${skill.prompt_contract_version}` : "",
    String(skill.prompt_template || "").trim(),
    `Governance contract:\n${boundedJson(contract, 5000)}`,
  ].filter(Boolean).join("\n");
}

export function assembleAgentSystemPrompt({
  logicBody = {},
  context = {},
  agentSystemPrompt = "",
  engineSkillPrompts = [],
} = {}) {
  const parts = [
    "You are executing inside a governed platform runtime. Follow the supplied authority and output contracts. Never infer missing authority.",
  ];
  if (agentSystemPrompt) parts.push(`Agent system prompt:\n${String(agentSystemPrompt).trim()}`);
  if (context.prompt_envelope) parts.push(`Governed execution envelope:\n${boundedJson(context.prompt_envelope)}`);
  for (const skill of Array.isArray(engineSkillPrompts) ? engineSkillPrompts : []) {
    parts.push(engineSkillPromptSection(skill));
  }
  if (logicBody.trigger_phrase) parts.push(`Trigger: ${logicBody.trigger_phrase}`);
  if (logicBody.action_class) parts.push(`Action class: ${logicBody.action_class}`);
  if (logicBody.execution_layer) parts.push(`Execution layer: ${logicBody.execution_layer}`);
  if (logicBody.module_binding) parts.push(`Module: ${logicBody.module_binding}`);
  if (logicBody.system_prompt) parts.push(`Logic system prompt:\n${String(logicBody.system_prompt)}`);
  return parts.filter(Boolean).join("\n\n");
}
