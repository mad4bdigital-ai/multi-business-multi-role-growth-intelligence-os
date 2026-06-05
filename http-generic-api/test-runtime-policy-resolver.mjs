import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveRuntimePolicyContext } from "./runtimePolicyResolver.js";
import { evaluateAppActionPreflight } from "./governedExecutionPreflight.js";

function makePool({ failTargetRuleRead = false } = {}) {
  const executionPolicyRows = [
    {
      id: 1,
      policy_group: "External App Action Governance",
      policy_key: "n8n Workflow Execution Guard",
      policy_value: JSON.stringify({ enforcement_mode: "blocking", min_reason_chars: 10 }),
      active: "TRUE",
      execution_scope: "app_action|external_app_action|n8n|execute_workflow",
      affects_layer: "appAdapters|appAdapters/index.js|n8n",
      blocking: "TRUE",
      notes: "test policy",
    },
  ];
  const targetRuleRows = [
    {
      rule_key: "runtime_n8n_execute_workflow_guard",
      policy_key: "runtime_n8n_workflow_execution_policy_v1",
      engine_key: null,
      policy_mode: "dry_run",
      priority: 1000,
      task_class: "external_app_action",
      resource_kind: "n8n_execute_workflow",
      resource_pattern: "n8n.execute_workflow",
      condition_json: JSON.stringify({
        execution_policy_group: "External App Action Governance",
        execution_policy_key: "n8n Workflow Execution Guard",
        requires_execution_reason: true,
        min_reason_chars: 10,
      }),
      strategy_key: "manual_only",
      risk_level: "high",
      auto_apply_allowed: 0,
      dry_run_required: 1,
      approval_required: 1,
      validator_commands_json: JSON.stringify(["n8n_reason_presence_check"]),
      status: "active",
      notes: "test target rule",
    },
  ];
  return {
    async query(sql) {
      const text = String(sql || "");
      if (text.includes("FROM `execution_policies`")) return [executionPolicyRows];
      if (text.includes("FROM platform_engine_policy_rules")) {
        if (failTargetRuleRead) throw new Error("simulated target rule registry read failure");
        return [targetRuleRows];
      }
      throw new Error(`Unexpected SQL in fake pool: ${text.slice(0, 120)}`);
    },
  };
}

const deps = { pool: makePool(), skipSurfaceAuthority: true };

const resolution = await resolveRuntimePolicyContext({
  execution_scope: ["app_action", "external_app_action", "n8n", "execute_workflow"],
  affects_layer: ["appAdapters", "appAdapters/index.js", "n8n"],
}, deps);

assert.equal(resolution.ok, true);
assert.equal(resolution.enforcement_source, "execution_policies");
assert.equal(resolution.target_rule_source, "platform_engine_policy_rules");
assert.equal(resolution.cutover_enabled, false);
assert.equal(resolution.execution_policy_count, 1);
assert.equal(resolution.target_rule_count, 1);
assert.equal(resolution.target_rule_load_status, "loaded");
assert.deepEqual(resolution.evidence.target_rule_keys, ["runtime_n8n_execute_workflow_guard"]);

const blocked = await evaluateAppActionPreflight({
  appKey: "n8n",
  actionKey: "execute_workflow",
  args: {},
}, deps);

assert.equal(blocked.ok, false);
assert.equal(blocked.classification, "blocked");
assert.equal(blocked.enforcement_source, "execution_policies");
assert.equal(blocked.target_rule_source, "platform_engine_policy_rules");
assert.equal(blocked.target_rule_load_status, "loaded");
assert.equal(blocked.target_rules.length, 1);
assert.equal(blocked.target_rules[0].rule_key, "runtime_n8n_execute_workflow_guard");
assert.deepEqual(blocked.errors, ["n8n_workflow_execution_requires_explicit_reason"]);
assert.equal(blocked.evidence.runtime_policy_resolution.cutover_enabled, false);

const allowed = await evaluateAppActionPreflight({
  appKey: "n8n",
  actionKey: "execute_workflow",
  args: {
    allow_n8n_workflow_execution: true,
    execution_reason: "Approved explicit safe smoke run.",
  },
}, deps);

assert.equal(allowed.ok, true);
assert.equal(allowed.classification, "allow_with_policy_advisory");
assert.equal(allowed.enforcement_source, "execution_policies");
assert.equal(allowed.target_rule_source, "platform_engine_policy_rules");
assert.equal(allowed.target_rules.length, 1);

const fallbackDeps = { pool: makePool({ failTargetRuleRead: true }), skipSurfaceAuthority: true };
const fallbackResolution = await resolveRuntimePolicyContext({
  execution_scope: ["app_action", "external_app_action", "n8n", "execute_workflow"],
  affects_layer: ["appAdapters", "appAdapters/index.js", "n8n"],
}, fallbackDeps);

assert.equal(fallbackResolution.ok, true);
assert.equal(fallbackResolution.policy_source, "execution_policies_fallback_after_target_rule_error");
assert.equal(fallbackResolution.enforcement_source, "execution_policies");
assert.equal(fallbackResolution.target_rule_source, null);
assert.equal(fallbackResolution.target_rule_load_status, "unavailable_fallback_applied");
assert.equal(fallbackResolution.execution_policy_count, 1);
assert.equal(fallbackResolution.target_rule_count, 0);
assert.equal(fallbackResolution.evidence.target_rule_load_status, "unavailable_fallback_applied");

const fallbackBlocked = await evaluateAppActionPreflight({
  appKey: "n8n",
  actionKey: "execute_workflow",
  args: {},
}, fallbackDeps);

assert.equal(fallbackBlocked.ok, false);
assert.equal(fallbackBlocked.classification, "blocked");
assert.equal(fallbackBlocked.policy_source, "execution_policies_fallback_after_target_rule_error");
assert.equal(fallbackBlocked.enforcement_source, "execution_policies");
assert.equal(fallbackBlocked.target_rule_source, null);
assert.equal(fallbackBlocked.target_rule_load_status, "unavailable_fallback_applied");
assert.deepEqual(fallbackBlocked.errors, ["n8n_workflow_execution_requires_explicit_reason"]);

const migration = readFileSync(
  new URL("./migrations/199_sprint67_runtime_policy_resolver_monitoring_and_mirror_classification.sql", import.meta.url),
  "utf8",
);
assert.match(migration, /CREATE OR REPLACE VIEW v_execution_association_monitoring_summary/i);
assert.match(migration, /CREATE OR REPLACE VIEW v_runtime_policy_resolver_rule_coverage/i);
assert.match(migration, /CREATE TABLE IF NOT EXISTS policy_logic_mirror_classification/i);
assert.match(migration, /CREATE OR REPLACE VIEW v_policy_logic_mirror_classification_summary/i);
assert.match(migration, /CREATE OR REPLACE VIEW v_policy_logic_mirror_classification_detail/i);
assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE)\b/i);

console.log("runtime policy resolver regression tests passed");
