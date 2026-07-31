import assert from "node:assert/strict";

import {
  compileGrowthControlPolicyDecision,
  growthControlPolicyCompilerContract,
} from "./src/domain/growthControlPlane/growthControlPolicyCompiler.js";

const context = Object.freeze({
  tenant_id: "tenant-policy-01",
  workspace_id: "workspace-policy-01",
  brand_id: "brand-policy-01",
  activity_binding_id: "binding-policy-01",
  operation_key: "content.publish",
  capability_key: "content.publish",
  action_ids: ["publish.copy", "content.publish"],
  resource_ids: ["provider:cms/site-01", "provider:cms/site-02"],
  resource_count: 2,
  environment: "production",
  effect_class: "provider_write",
  actor_roles: ["editor", "publisher"],
  provider_write: true,
  external_write: true,
  budget_amount: 500,
  concurrency: 2,
  certification_keys: ["cms.publish.v1"],
  delegation_requested: false,
  plan_hash_sha256: "a".repeat(64),
  request_hash_sha256: "b".repeat(64),
});

function policy({
  key,
  id,
  version = 1,
  priority = 0,
  conditions = [],
  effects,
} = {}) {
  return {
    policy_key: key,
    policy_version_id: id,
    version,
    priority,
    status: "active",
    immutable: true,
    conditions,
    effects,
  };
}

const operatorPolicy = policy({
  key: "policy.operator.coverage",
  id: "policy-version-operator-01",
  priority: 100,
  conditions: [
    { field: "operation_key", operator: "equals", value: "content.publish" },
    { field: "environment", operator: "not_equals", value: "development" },
    { field: "capability_key", operator: "in", value: ["content.publish", "content.draft"] },
    { field: "environment", operator: "not_in", value: ["development", "test"] },
    { field: "brand_id", operator: "exists", value: true },
    { field: "budget_amount", operator: "less_than", value: 1000 },
    { field: "resource_count", operator: "less_than_or_equal", value: 2 },
    { field: "concurrency", operator: "greater_than", value: 1 },
    { field: "budget_amount", operator: "greater_than_or_equal", value: 500 },
    { field: "actor_roles", operator: "contains_all", value: ["editor", "publisher"] },
  ],
  effects: [
    {
      type: "require_approval",
      profile: {
        required_roles: ["publisher"],
        separation_of_duties: false,
        expires_in_seconds: 3600,
        delegation_allowed: true,
        max_resource_count: 10,
      },
      reason_code: "approval.publisher_required",
    },
    { type: "limit_resources", maximum: 10 },
    { type: "force_environment", environment: "staging" },
    { type: "require_resource_authority", authority_keys: ["cms.site.publish"] },
    { type: "require_readback", readback_keys: ["cms.publish.readback"] },
  ],
});

const restrictivePolicy = policy({
  key: "policy.restrictive.controls",
  id: "policy-version-restrictive-01",
  priority: 50,
  conditions: [
    { field: "effect_class", operator: "equals", value: "provider_write" },
    { field: "provider_write", operator: "equals", value: true },
  ],
  effects: [
    {
      type: "require_approval",
      profile: {
        required_roles: ["compliance"],
        separation_of_duties: true,
        expires_in_seconds: 900,
        delegation_allowed: false,
        max_resource_count: 5,
      },
      reason_code: "approval.compliance_required",
    },
    { type: "require_typed_confirmation", confirmation_key: "publish.production.confirm" },
    { type: "require_certification", certification_keys: ["cms.publish.v1", "provider.production.v1"] },
    { type: "require_rollback", rollback_keys: ["cms.publish.rollback"] },
    { type: "limit_resources", maximum: 3 },
    { type: "limit_concurrency", maximum: 2 },
    { type: "limit_budget", maximum: 750 },
    { type: "force_provider_write_false", reason_code: "provider.write.disabled_until_boundary" },
  ],
});

const unmatchedPolicy = policy({
  key: "policy.unmatched",
  id: "policy-version-unmatched-01",
  priority: 999,
  conditions: [{ field: "environment", operator: "equals", value: "development" }],
  effects: [{ type: "deny", reason_code: "development.only" }],
});

const decision = compileGrowthControlPolicyDecision({
  context,
  policies: [restrictivePolicy, unmatchedPolicy, operatorPolicy],
});
assert.equal(decision.contract_version, "growth-control-policy-decision-v1");
assert.equal(decision.decision, "allow_with_requirements");
assert.equal(decision.denials.length, 0);
assert.deepEqual(
  decision.matched_policy_versions.map((item) => item.policy_key),
  ["policy.operator.coverage", "policy.restrictive.controls"],
);
assert.deepEqual(decision.reason_codes, [
  "approval.compliance_required",
  "approval.publisher_required",
  "provider.write.disabled_until_boundary",
]);
assert.match(decision.context_sha256, /^[a-f0-9]{64}$/);
assert.match(decision.decision_sha256, /^[a-f0-9]{64}$/);
assert.equal(decision.grants_authority, false);
assert.equal(decision.provider_calls, false);
assert.equal(decision.provider_dispatch_allowed, false);
assert.equal(decision.provider_apply_allowed, false);
assert.equal(decision.external_writes, false);
assert.equal(decision.secrets_included, false);
assert.equal(Object.isFrozen(decision), true);
assert.equal(Object.isFrozen(decision.requirements), true);

const requirement = (type) => decision.requirements.find((item) => item.type === type);
assert.deepEqual(requirement("force_provider_write_false"), { type: "force_provider_write_false", required: true });
assert.deepEqual(requirement("force_environment"), { type: "force_environment", environment: "staging", priority: 100 });
assert.deepEqual(requirement("limit_resources"), { type: "limit_resources", maximum: 3 });
assert.deepEqual(requirement("limit_concurrency"), { type: "limit_concurrency", maximum: 2 });
assert.deepEqual(requirement("limit_budget"), { type: "limit_budget", maximum: 750 });
assert.deepEqual(requirement("require_resource_authority").authority_keys, ["cms.site.publish"]);
assert.deepEqual(requirement("require_certification").certification_keys, ["cms.publish.v1", "provider.production.v1"]);
assert.deepEqual(requirement("require_typed_confirmation").confirmation_keys, ["publish.production.confirm"]);
assert.deepEqual(requirement("require_readback").readback_keys, ["cms.publish.readback"]);
assert.deepEqual(requirement("require_rollback").rollback_keys, ["cms.publish.rollback"]);

const approval = requirement("require_approval").approval_profile;
assert.deepEqual(approval.required_roles, ["compliance", "publisher"]);
assert.equal(approval.separation_of_duties, true);
assert.equal(approval.expires_in_seconds, 900);
assert.equal(approval.delegation_allowed, false);
assert.equal(approval.max_resource_count, 5);
assert.deepEqual(approval.target_scope, {
  tenant_id: "tenant-policy-01",
  workspace_id: "workspace-policy-01",
  brand_id: "brand-policy-01",
  activity_binding_id: "binding-policy-01",
});
assert.deepEqual(approval.action_ids, ["content.publish", "publish.copy"]);
assert.deepEqual(approval.resource_ids, ["provider:cms/site-01", "provider:cms/site-02"]);
assert.equal(approval.resource_count, 2);
assert.equal(approval.environment, "staging");
assert.equal(approval.effect_class, "provider_write");
assert.equal(approval.plan_hash_sha256, "a".repeat(64));
assert.equal(approval.request_hash_sha256, "b".repeat(64));
assert.equal(approval.provider_write_allowed, false);
assert.equal(approval.grants_authority, false);

const reordered = compileGrowthControlPolicyDecision({
  context: {
    ...context,
    action_ids: [...context.action_ids].reverse(),
    resource_ids: [...context.resource_ids].reverse(),
    actor_roles: [...context.actor_roles].reverse(),
  },
  policies: [operatorPolicy, restrictivePolicy, unmatchedPolicy],
});
assert.equal(reordered.decision_sha256, decision.decision_sha256, "policy order and set order must not affect the decision hash");

const denied = compileGrowthControlPolicyDecision({
  context,
  policies: [
    operatorPolicy,
    policy({
      key: "policy.explicit.deny",
      id: "policy-version-deny-01",
      priority: 1,
      conditions: [{ field: "external_write", operator: "equals", value: true }],
      effects: [{ type: "deny", reason_code: "external.write.denied" }],
    }),
  ],
});
assert.equal(denied.decision, "deny");
assert.deepEqual(denied.denials, [{
  policy_key: "policy.explicit.deny",
  policy_version_id: "policy-version-deny-01",
  reason_code: "external.write.denied",
}]);
assert.equal(denied.requirements.length > 0, true, "deny-wins retains bounded requirement evidence");

const noMatch = compileGrowthControlPolicyDecision({
  context,
  policies: [unmatchedPolicy],
});
assert.equal(noMatch.decision, "allow");
assert.deepEqual(noMatch.requirements, []);
assert.deepEqual(noMatch.denials, []);
assert.deepEqual(noMatch.matched_policy_versions, []);

assert.throws(
  () => compileGrowthControlPolicyDecision({
    context,
    policies: [
      policy({
        key: "policy.environment.staging",
        id: "policy-version-environment-01",
        priority: 100,
        effects: [{ type: "force_environment", environment: "staging" }],
      }),
      policy({
        key: "policy.environment.production",
        id: "policy-version-environment-02",
        priority: 100,
        effects: [{ type: "force_environment", environment: "production" }],
      }),
    ],
  }),
  (error) => error?.code === "POLICY_AMBIGUOUS",
);

const precedence = compileGrowthControlPolicyDecision({
  context,
  policies: [
    policy({
      key: "policy.environment.staging",
      id: "policy-version-environment-03",
      priority: 100,
      effects: [{ type: "force_environment", environment: "staging" }],
    }),
    policy({
      key: "policy.environment.development",
      id: "policy-version-environment-04",
      priority: 10,
      effects: [{ type: "force_environment", environment: "development" }],
    }),
  ],
});
assert.equal(precedence.requirements[0].environment, "staging");
assert.equal(precedence.requirements[0].priority, 100);

assert.throws(
  () => compileGrowthControlPolicyDecision({
    context: { ...context, api_key: "forbidden" },
    policies: [],
  }),
  (error) => error?.code === "GROWTH_CONTROL_POLICY_SENSITIVE_INPUT",
);
assert.throws(
  () => compileGrowthControlPolicyDecision({
    context: { ...context, resource_count: 1 },
    policies: [],
  }),
  (error) => error?.code === "GROWTH_CONTROL_POLICY_CONTEXT_INVALID",
);
assert.throws(
  () => compileGrowthControlPolicyDecision({
    context,
    policies: [{ ...operatorPolicy, immutable: false }],
  }),
  (error) => error?.code === "GROWTH_CONTROL_POLICY_VERSION_INVALID",
);
assert.throws(
  () => compileGrowthControlPolicyDecision({
    context,
    policies: [operatorPolicy, { ...operatorPolicy }],
  }),
  (error) => error?.code === "GROWTH_CONTROL_POLICY_VERSION_INVALID",
);

assert.equal(growthControlPolicyCompilerContract.deny_wins, true);
assert.equal(growthControlPolicyCompilerContract.most_restrictive_limits, true);
assert.equal(growthControlPolicyCompilerContract.equal_priority_scalar_conflict, "POLICY_AMBIGUOUS");
assert.equal(growthControlPolicyCompilerContract.grants_authority, false);
assert.equal(growthControlPolicyCompilerContract.provider_dispatch_allowed, false);
assert.equal(growthControlPolicyCompilerContract.secrets_included, false);
assert.deepEqual(growthControlPolicyCompilerContract.condition_operators, [
  "contains_all",
  "equals",
  "exists",
  "greater_than",
  "greater_than_or_equal",
  "in",
  "less_than",
  "less_than_or_equal",
  "not_equals",
  "not_in",
]);

console.log("growth control bounded policy compiler tests passed");
