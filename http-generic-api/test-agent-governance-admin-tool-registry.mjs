import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/1004_sprint69_agent_governance_admin_tools.sql", "utf8");
const routes = readFileSync("routes/agentGovernanceRoutes.js", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");
const supportPolicy = readFileSync("supportTicketExternalDeliveryPolicyService.js", "utf8");

const tools = [
  ["agent_governance_response_profile_resolve", "POST", "/platform/agent-governance/response-profile/resolve"],
  ["agent_governance_research_policy_resolve", "POST", "/platform/agent-governance/research-policy/resolve"],
  ["agent_governance_research_execution_record", "POST", "/platform/agent-governance/research-executions"],
  ["agent_governance_research_plan_create", "POST", "/platform/agent-governance/research-plans"],
  ["agent_governance_research_plan_run", "POST", "/platform/agent-governance/research-plans/{plan_id}/run"],
  ["agent_governance_handoff_create", "POST", "/platform/agent-governance/handoffs"],
  ["agent_governance_handoff_read", "GET", "/platform/agent-governance/handoffs/{state_id}"],
  ["agent_governance_handoff_consume", "POST", "/platform/agent-governance/handoffs/{state_id}/consume"],
  ["agent_governance_handoff_revoke", "POST", "/platform/agent-governance/handoffs/{state_id}/revoke"],
  ["agent_governance_external_prompt_classify", "POST", "/platform/agent-governance/external-prompts/classify"],
  ["agent_governance_skill_coverage", "GET", "/platform/agent-governance/skill-coverage"],
  ["agent_governance_readiness", "GET", "/platform/agent-governance/readiness"],
  ["agent_governance_memory_scope_resolve", "POST", "/platform/agent-governance/memory-scope/resolve"],
];

for (const [toolKey, method, path] of tools) {
  assert(migration.includes(`'${toolKey}'`), `missing admin tool migration row: ${toolKey}`);
  assert(migration.includes(`'${method}', '${path}'`), `migration method/path mismatch for ${toolKey}`);
  const expressPath = path.replaceAll("{plan_id}", ":plan_id").replaceAll("{state_id}", ":state_id");
  assert(routes.includes(`\"${expressPath}\"`), `missing live route: ${expressPath}`);
  assert(openapi.includes(`  ${path}:`), `missing OpenAPI path: ${path}`);
}

assert.equal((migration.match(/'agent_governance_/g) || []).length, 13, "migration must register exactly 13 Agent Governance tools");
assert(migration.includes("ON DUPLICATE KEY UPDATE"));
assert(migration.includes("support_ticket.admin_gpt_repair_link"));
assert(migration.includes("opaque_handoff_id"));
assert(migration.includes("agent_handoff_state_registry"));
assert(migration.includes("additionalProperties',false"));
assert(!migration.includes("'actor_id',JSON_OBJECT"), "client schemas must not expose caller-controlled actor_id");
assert(!migration.includes("'principal_actor_id',JSON_OBJECT"), "client schemas must not expose principal_actor_id");
assert(!migration.includes("client_secret"));
assert(!migration.includes("access_token"));

assert(supportPolicy.includes("createAgentHandoffState"));
assert(supportPolicy.includes("admin_gpt_resume_state_id: handoff.resume_state_id"));
assert(supportPolicy.includes("resume_state_id=${resumeStateId}"));
assert(!supportPolicy.includes("state_json=${JSON.stringify(state)}"));
const handoffState = supportPolicy.slice(
  supportPolicy.indexOf("current_state: {"),
  supportPolicy.indexOf("required_checks: repairPromptState.required_checks")
);
assert(!handoffState.includes("credential_ref"));
assert(supportPolicy.includes("admin_gpt_repair_prompt_state: repairPromptState"), "legacy internal approval context must remain additive");

console.log("Agent Governance admin tool registry parity tests passed");
