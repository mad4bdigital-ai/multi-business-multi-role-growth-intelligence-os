import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveAgentPromptContext } from "./agentPromptContextResolver.js";
import { assembleAgentSystemPrompt } from "./agentPromptAssembler.js";
import { getSkillRuntimeCoverage } from "./agentGovernanceRuntime.js";

function promptPool({ systemPrompt = "Operate as the governed admin agent." } = {}) {
  return {
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes(" FROM agents ")) {
        assert.deepEqual(params, ["agent-1"]);
        return [[{
          agent_id: "agent-1",
          name: "admin_gpt_assistant",
          display_name: "Admin GPT Assistant",
          execution_class: "authority",
          system_prompt: systemPrompt,
          status: "active",
        }]];
      }
      if (text.includes(" FROM platform_engine_skill_prompt_registry ")) {
        assert(text.includes("engine_key IN (?,?)"));
        assert.deepEqual(params, ["resource_authority_engine", "recovery_capability_taxonomy_engine", "resource_authority_engine", "recovery_capability_taxonomy_engine"]);
        return [[
          {
            skill_key: "resource_authority",
            engine_key: "resource_authority_engine",
            display_name: "Resource Authority",
            prompt_contract_version: "v1",
            task_classes_json: JSON.stringify(["resource_authority_check"]),
            required_tools_json: JSON.stringify(["resource.resolve"]),
            forbidden_tools_json: JSON.stringify(["external.write"]),
            success_criteria_json: JSON.stringify({ authority_resolved: true }),
            fallback_behavior_json: JSON.stringify({ mode: "deny" }),
            prompt_template: "Evaluate authority before any external write.",
          },
          {
            skill_key: "github_ci_recovery",
            engine_key: "recovery_capability_taxonomy_engine",
            display_name: "GitHub CI Recovery",
            prompt_contract_version: "v1",
            task_classes_json: JSON.stringify(["ci_failure_classify"]),
            required_tools_json: "[]",
            forbidden_tools_json: "[]",
            success_criteria_json: "{}",
            fallback_behavior_json: "{}",
            prompt_template: "Classify bounded CI evidence.",
          },
        ]];
      }
      throw new Error(`Unexpected prompt resolver SQL: ${text}`);
    },
  };
}

const resolved = await resolveAgentPromptContext({
  agent_id: "agent-1",
  mapped_engines: "resource_authority_engine|recovery_capability_taxonomy_engine",
  task_class: "resource_authority_check",
}, { pool: promptPool() });
assert.equal(resolved.agent_system_prompt, "Operate as the governed admin agent.");
assert.equal(resolved.engine_skill_prompts.length, 1);
assert.equal(resolved.engine_skill_prompts[0].skill_key, "resource_authority");
assert.deepEqual(resolved.engine_skill_prompts[0].required_tools, ["resource.resolve"]);
assert.deepEqual(resolved.engine_skill_prompts[0].forbidden_tools, ["external.write"]);
assert.equal(resolved.resolution.selected_skill_prompt_count, 1);
assert.equal(resolved.secrets_included, false);

const prompt = assembleAgentSystemPrompt({
  agentSystemPrompt: resolved.agent_system_prompt,
  engineSkillPrompts: resolved.engine_skill_prompts,
  context: { prompt_envelope: { authority: "governed", secrets_included: false } },
  logicBody: { action_class: "resource_authority_check", system_prompt: "Return a structured decision." },
});
const platformIndex = prompt.indexOf("governed platform runtime");
const agentIndex = prompt.indexOf("Agent system prompt:");
const envelopeIndex = prompt.indexOf("Governed execution envelope:");
const skillIndex = prompt.indexOf("Selected engine skill contract:");
const logicIndex = prompt.indexOf("Logic system prompt:");
assert(platformIndex >= 0 && platformIndex < agentIndex);
assert(agentIndex < envelopeIndex);
assert(envelopeIndex < skillIndex);
assert(skillIndex < logicIndex);
assert(prompt.includes("resource.resolve"));
assert(prompt.includes("external.write"));
assert.equal(prompt.includes("private user request"), false);

await assert.rejects(
  () => resolveAgentPromptContext({ agent_id: "agent-1" }, { pool: promptPool({ systemPrompt: "token=abcdefghijklmnop" }) }),
  (error) => error.code === "agent_system_prompt_secret_material_forbidden"
);

let coverageSql = "";
let coverageParams = [];
const coverage = await getSkillRuntimeCoverage({
  skill_type: "api_access",
  coverage_status: "covered",
  limit: 25,
}, {
  pool: {
    async query(sql, params) {
      coverageSql = String(sql).replace(/\s+/g, " ").trim();
      coverageParams = params;
      return [[
        { skill_key: "api.wordpress_read", skill_type: "api_access", coverage_status: "covered", runtime_binding_status: "ready" },
      ]];
    },
  },
});
assert(coverageSql.includes("skill_type = ?"));
assert(coverageSql.includes("coverage_status = ?"));
assert.deepEqual(coverageParams, ["api_access", "covered", 25]);
assert.equal(coverage.total, 1);
assert.equal(coverage.covered_count, 1);
assert.equal(coverage.gap_count, 0);
assert.equal(coverage.secrets_included, false);

await assert.rejects(
  () => getSkillRuntimeCoverage({ skill_type: "unknown" }, { pool: { query: async () => [[]] } }),
  (error) => error.code === "agent_skill_coverage_skill_type_invalid"
);
await assert.rejects(
  () => getSkillRuntimeCoverage({ coverage_status: "ready" }, { pool: { query: async () => [[]] } }),
  (error) => error.code === "agent_skill_coverage_status_invalid"
);

const migration = readFileSync("migrations/1005_sprint69_agent_skill_coverage_prompt_enrichment.sql", "utf8");
assert(migration.includes("active_grant+active_manifest+manifest_prompt"));
assert(migration.includes("missing_active_grant"));
assert(migration.includes("missing_active_manifest"));
assert(migration.includes("missing_manifest_prompt"));
assert(migration.includes("g.expires_at IS NULL OR g.expires_at > CURRENT_TIMESTAMP"));
assert(migration.includes("JSON_EXTRACT(s.capability_json, '$.skill_manifest_key')"));
assert.equal(/\b(?:DROP|TRUNCATE|DELETE)\b/i.test(migration), false);

const runtime = readFileSync("agentRuntime.js", "utf8");
const loop = readFileSync("agentLoopRunner.js", "utf8");
const modelAdapter = readFileSync("modelAdapter.js", "utf8");
assert(runtime.includes("resolveAgentPromptContext"));
assert(loop.includes("context.prompt_resolution = promptContext.resolution"));
assert(loop.includes("agent_system_prompt: promptContext.agent_system_prompt"));
assert(loop.includes("engine_skill_prompts: promptContext.engine_skill_prompts"));
assert(modelAdapter.includes("agentSystemPrompt: agent_system_prompt"));
assert(modelAdapter.includes("engineSkillPrompts: engine_skill_prompts"));

console.log("agent prompt enrichment and typed skill coverage tests passed");
