import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  authorizeAgentToolCall,
  classifyAgentTool,
  filterAuthorizedAgentTools,
  inferRequiredSkillAlternatives,
} from "./agentToolAuthorizationGate.js";

function buildPool({
  actions = {},
  grantedSkills = {},
  configuredAppGrants = {},
  matchingAppGrants = {},
} = {}) {
  return {
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.includes(" FROM actions ")) {
        const toolName = params[0];
        return [[actions[toolName]].filter(Boolean)];
      }
      if (text.includes(" FROM v_effective_agent_skill_grants ")) {
        const agentId = params[0];
        const alternatives = params.slice(3, 3 + ((params.length - 3) / 2));
        const granted = new Set(grantedSkills[agentId] || []);
        const matched = alternatives.find((skillKey) => granted.has(skillKey));
        return [matched ? [{ skill_key: matched, grant_id: `grant-${agentId}-${matched}` }] : []];
      }
      if (text.includes("COUNT(*) AS configured_count") && text.includes("FROM app_action_grants")) {
        const actionKey = params[0];
        return [[{ configured_count: configuredAppGrants[actionKey] || 0 }]];
      }
      if (text.includes(" FROM app_action_grants ")) {
        const actionKey = params[0];
        return [matchingAppGrants[actionKey] ? [{ grant_id: matchingAppGrants[actionKey] }] : []];
      }
      throw new Error(`Unexpected authorization SQL: ${text}`);
    },
  };
}

const readClassification = classifyAgentTool("platform_status_lookup");
assert.equal(readClassification.consequence_class, "read_only");
assert.equal(readClassification.consequential, false);
assert.deepEqual(inferRequiredSkillAlternatives("wordpress_publish"), ["api.wordpress_write"]);
assert.deepEqual(inferRequiredSkillAlternatives("local_shell_execute"), ["local.connector.shell_execute"]);

const unregisteredWrite = await authorizeAgentToolCall({
  tool_name: "repository_write",
  args: { apply: true },
  context: { agent_id: "agent-1" },
  phase: "dispatch",
  pool: buildPool(),
});
assert.equal(unregisteredWrite.allowed, false);
assert.equal(unregisteredWrite.code, "consequential_tool_registry_authority_missing");

const unregisteredReadDispatch = await authorizeAgentToolCall({
  tool_name: "platform_status_lookup",
  context: { agent_id: "agent-1" },
  phase: "dispatch",
  pool: buildPool(),
});
assert.equal(unregisteredReadDispatch.allowed, true);
assert.equal(unregisteredReadDispatch.advisory_unregistered_read_only, true);

const unregisteredReadExposure = await authorizeAgentToolCall({
  tool_name: "platform_status_lookup",
  context: { agent_id: "agent-1" },
  phase: "exposure",
  pool: buildPool(),
});
assert.equal(unregisteredReadExposure.allowed, false);
assert.equal(unregisteredReadExposure.code, "tool_registry_authority_required_for_model_exposure");

const disabled = await authorizeAgentToolCall({
  tool_name: "disabled_action",
  context: { agent_id: "agent-1" },
  pool: buildPool({
    actions: {
      disabled_action: {
        action_key: "disabled_action",
        status: "active",
        runtime_callable: "FALSE",
        runtime_capability_class: "external_action_only",
      },
    },
  }),
});
assert.equal(disabled.allowed, false);
assert(disabled.blockers.includes("action_not_runtime_callable"));

const wordpressAction = {
  action_key: "wordpress_publish",
  status: "active",
  runtime_callable: "TRUE",
  runtime_capability_class: "external_action_only",
  connector_family: "wordpress",
};
const wordpressAllowed = await authorizeAgentToolCall({
  tool_name: "wordpress_publish",
  args: { status: "draft" },
  context: { agent_id: "content-agent", tenant_id: "tenant-1", brand_key: "brand-1" },
  pool: buildPool({
    actions: { wordpress_publish: wordpressAction },
    grantedSkills: { "content-agent": ["api.wordpress_write"] },
  }),
});
assert.equal(wordpressAllowed.allowed, true);
assert.equal(wordpressAllowed.skill.matched_skill_key, "api.wordpress_write");

const wordpressDenied = await authorizeAgentToolCall({
  tool_name: "wordpress_publish",
  args: { status: "publish" },
  context: { agent_id: "analysis-agent", tenant_id: "tenant-1", brand_key: "brand-1" },
  pool: buildPool({ actions: { wordpress_publish: wordpressAction } }),
});
assert.equal(wordpressDenied.allowed, false);
assert(wordpressDenied.blockers.includes("required_agent_skill_grant_missing"));

const appGrantDenied = await authorizeAgentToolCall({
  tool_name: "registered_status",
  context: { agent_id: "agent-1", workspace_id: "workspace-1" },
  phase: "dispatch",
  pool: buildPool({
    actions: {
      registered_status: {
        action_key: "registered_status",
        status: "active",
        runtime_callable: "TRUE",
        runtime_capability_class: "read_only",
      },
    },
    configuredAppGrants: { registered_status: 1 },
  }),
});
assert.equal(appGrantDenied.allowed, false);
assert(appGrantDenied.blockers.includes("app_action_grant_missing"));

const filtered = await filterAuthorizedAgentTools([
  { type: "function", function: { name: "registered_status", parameters: { type: "object" } } },
  { type: "function", function: { name: "unregistered_status", parameters: { type: "object" } } },
], { agent_id: "agent-1" }, {
  pool: buildPool({
    actions: {
      registered_status: {
        action_key: "registered_status",
        status: "active",
        runtime_callable: "TRUE",
        runtime_capability_class: "read_only",
      },
    },
  }),
});
assert.equal(filtered.candidate_count, 2);
assert.equal(filtered.authorized_count, 1);
assert.equal(filtered.denied_count, 1);
assert.equal(filtered.tools[0].function.name, "registered_status");

const agentLoop = readFileSync("agentLoopRunner.js", "utf8");
assert(agentLoop.includes("filterAuthorizedTools(candidateTools, context)"));
assert(agentLoop.includes("authorizeToolCall: deps.authorizeToolCall"));
assert(agentLoop.includes("tool_authorization: authorization"));

const modelAdapter = readFileSync("modelAdapter.js", "utf8");
assert(modelAdapter.includes("recordAgentToolCallAuthorization"));
assert(modelAdapter.includes("agent_tool_authorization_gate_unavailable"));
assert(modelAdapter.includes("tool_authorization: authorization"));

const ledger = readFileSync("agentRuntimeLedger.js", "utf8");
assert(ledger.includes("authorization_status: \"pending\""));
assert(ledger.includes("result_returned_unverified"));
assert(ledger.includes("side_effect_confirmed_by_readback = ?"));

const connectorExecutor = readFileSync("connectorExecutor.js", "utf8");
assert.equal(connectorExecutor.includes("proceeding (fail-open until grants are fully seeded)"), false);
assert(connectorExecutor.includes("required_agent_skill_grant_missing"));
assert(connectorExecutor.includes("agent_skill_grant_resolution_failed"));

console.log("agent tool authorization gate tests passed");
