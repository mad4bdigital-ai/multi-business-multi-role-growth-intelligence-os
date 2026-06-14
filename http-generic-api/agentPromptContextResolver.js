import { getPool } from "./db.js";

const MAX_AGENT_SYSTEM_PROMPT_LENGTH = 12000;
const MAX_ENGINE_SKILL_PROMPT_LENGTH = 5000;
const MAX_TOTAL_ENGINE_SKILL_PROMPT_LENGTH = 16000;
const SECRET_MATERIAL_PATTERN = /\b(?:bearer\s+[a-z0-9._~+/=-]{12,}|(?:password|secret|token|api[_ -]?key|private[_ -]?key)\s*[:=]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function splitMappedEngines(value = "") {
  return [...new Set(String(value || "")
    .split(/[|,;]/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

function assertPromptText(value, { label, maxLength }) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length > maxLength) {
    const error = new Error(`${label} exceeds the governed prompt length limit.`);
    error.status = 409;
    error.code = `${label}_too_long`;
    throw error;
  }
  if (SECRET_MATERIAL_PATTERN.test(text)) {
    const error = new Error(`${label} contains forbidden secret material.`);
    error.status = 409;
    error.code = `${label}_secret_material_forbidden`;
    throw error;
  }
  return text;
}

function matchesTaskClass(row, taskClass) {
  const classes = parseJson(row.task_classes_json, []);
  if (!taskClass || !classes.length || classes.includes("*")) return true;
  return classes.includes(taskClass);
}

export async function resolveAgentPromptContext(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const agentId = String(input.agent_id || "").trim();
  const taskClass = String(input.task_class || "").trim();
  const mappedEngines = splitMappedEngines(input.mapped_engines);

  let agent = null;
  if (agentId) {
    const [agentRows] = await pool.query(
      `SELECT agent_id, name, display_name, execution_class, system_prompt, status
         FROM agents
        WHERE agent_id = ? AND status = 'active'
        LIMIT 1`,
      [agentId]
    );
    agent = agentRows[0] || null;
  }

  const agentSystemPrompt = assertPromptText(agent?.system_prompt, {
    label: "agent_system_prompt",
    maxLength: MAX_AGENT_SYSTEM_PROMPT_LENGTH,
  });

  let promptRows = [];
  if (mappedEngines.length) {
    const placeholders = mappedEngines.map(() => "?").join(",");
    const [rows] = await pool.query(
      `SELECT skill_key, engine_key, display_name, prompt_contract_version,
              task_classes_json, required_tools_json, forbidden_tools_json,
              success_criteria_json, fallback_behavior_json, prompt_template
         FROM platform_engine_skill_prompt_registry
        WHERE status = 'active' AND engine_key IN (${placeholders})
        ORDER BY FIELD(engine_key, ${placeholders}), skill_key`,
      [...mappedEngines, ...mappedEngines]
    );
    promptRows = rows;
  }

  const engineSkillPrompts = [];
  let totalPromptLength = 0;
  for (const row of promptRows) {
    if (!matchesTaskClass(row, taskClass)) continue;
    const promptTemplate = assertPromptText(row.prompt_template, {
      label: "engine_skill_prompt",
      maxLength: MAX_ENGINE_SKILL_PROMPT_LENGTH,
    });
    if (!promptTemplate) continue;
    totalPromptLength += promptTemplate.length;
    if (totalPromptLength > MAX_TOTAL_ENGINE_SKILL_PROMPT_LENGTH) {
      const error = new Error("Selected engine skill prompts exceed the governed total prompt budget.");
      error.status = 409;
      error.code = "engine_skill_prompt_budget_exceeded";
      throw error;
    }
    engineSkillPrompts.push({
      skill_key: row.skill_key,
      engine_key: row.engine_key,
      display_name: row.display_name || row.skill_key,
      prompt_contract_version: row.prompt_contract_version || null,
      prompt_template: promptTemplate,
      required_tools: parseJson(row.required_tools_json, []),
      forbidden_tools: parseJson(row.forbidden_tools_json, []),
      success_criteria: parseJson(row.success_criteria_json, {}),
      fallback_behavior: parseJson(row.fallback_behavior_json, {}),
      secrets_included: false,
    });
  }

  return {
    agent_system_prompt: agentSystemPrompt,
    engine_skill_prompts: engineSkillPrompts,
    resolution: {
      agent_id: agent?.agent_id || agentId || null,
      agent_name: agent?.name || null,
      agent_prompt_present: Boolean(agentSystemPrompt),
      mapped_engines: mappedEngines,
      task_class: taskClass || null,
      selected_skill_prompt_keys: engineSkillPrompts.map((row) => row.skill_key),
      selected_skill_prompt_count: engineSkillPrompts.length,
      total_skill_prompt_characters: totalPromptLength,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export const AGENT_PROMPT_LIMITS = Object.freeze({
  agent_system_prompt: MAX_AGENT_SYSTEM_PROMPT_LENGTH,
  engine_skill_prompt: MAX_ENGINE_SKILL_PROMPT_LENGTH,
  total_engine_skill_prompts: MAX_TOTAL_ENGINE_SKILL_PROMPT_LENGTH,
});
