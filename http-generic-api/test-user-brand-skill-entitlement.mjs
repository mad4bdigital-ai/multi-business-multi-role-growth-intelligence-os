import assert from "node:assert/strict";
import { authorizeAgentToolCall } from "./agentToolAuthorizationGate.js";
import {
  inferBrandSkillOperation,
  resolveUserBrandSkillEntitlement,
} from "./userBrandSkillEntitlement.js";

const action = {
  action_key: "wordpress_publish",
  status: "active",
  runtime_callable: "1",
  runtime_capability_class: "mcp_connector",
  connector_family: "wordpress",
  admin_only: "0",
  review_required: "0",
  allowed_actor_roles: "",
  allowed_governance_levels: "",
};

function buildPool({ policy = null, grants = [], policyError = null, grantError = null } = {}) {
  return {
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ");
      if (text.includes(" FROM actions ")) return [[action]];
      if (text.includes(" FROM v_effective_agent_skill_grants ")) {
        return [[{ skill_key: "api.wordpress_write", grant_id: "agent-skill-grant-1" }]];
      }
      if (text.includes(" FROM brand_skill_policies p ")) {
        if (policyError) throw policyError;
        return [[policy].filter(Boolean)];
      }
      if (text.includes(" FROM v_effective_user_brand_skill_grants ")) {
        if (grantError) throw grantError;
        const [tenantId, userId, brandKey, agentId, skillKey, operation, resourceType, resourceRef] = params;
        const match = grants.find((grant) =>
          grant.tenant_id === tenantId
          && grant.user_id === userId
          && grant.brand_key === brandKey
          && grant.agent_id === agentId
          && grant.skill_key === skillKey
          && grant.allowed_operations.includes(operation)
          && (!grant.resource_type || (grant.resource_type === resourceType && grant.resource_ref === resourceRef))
        );
        return [match ? [{ grant_id: match.grant_id, resource_type: match.resource_type, resource_ref: match.resource_ref }] : []];
      }
      if (text.includes("COUNT(*) AS configured_count") && text.includes(" FROM app_action_grants ")) {
        return [[{ configured_count: 0 }]];
      }
      if (text.includes(" FROM app_action_grants ")) return [[]];
      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

const selfServicePolicy = { policy_id: "policy-1", activation_mode: "self_service" };
const exactGrant = {
  grant_id: "user-brand-grant-1",
  tenant_id: "tenant-1",
  user_id: "user-1",
  brand_key: "brand-1",
  agent_id: "content-agent",
  skill_key: "api.wordpress_write",
  resource_type: "site",
  resource_ref: "site-1",
  allowed_operations: ["publish"],
};

assert.equal(inferBrandSkillOperation("wordpress_publish", {}, action, {}), "publish");
assert.equal(inferBrandSkillOperation("wordpress_update", {}, action, {}), "update");
assert.equal(inferBrandSkillOperation("wordpress_delete", {}, action, {}), "delete");
assert.equal(inferBrandSkillOperation("wordpress_publish", {}, action, { operation_intent: "create" }), "create");

const backwardCompatible = await resolveUserBrandSkillEntitlement(
  buildPool(),
  { required: true, granted: true, matched_skill_key: "api.wordpress_write" },
  { tenant_id: "tenant-1", brand_key: "brand-1", agent_id: "content-agent" },
  { toolName: "wordpress_publish", action },
);
assert.equal(backwardCompatible.configured, false);
assert.equal(backwardCompatible.granted, true);

const explicitPolicyRequired = await resolveUserBrandSkillEntitlement(
  buildPool(),
  { required: true, granted: true, matched_skill_key: "api.wordpress_write" },
  {
    tenant_id: "tenant-1",
    brand_key: "brand-1",
    agent_id: "content-agent",
    enforce_brand_skill_entitlement: true,
  },
  { toolName: "wordpress_publish", action },
);
assert.equal(explicitPolicyRequired.granted, false);
assert.equal(explicitPolicyRequired.reason, "brand_skill_policy_required");

for (const failurePool of [
  buildPool({ policyError: Object.assign(new Error("policy unavailable"), { code: "ER_NO_SUCH_TABLE" }) }),
  buildPool({ policy: selfServicePolicy, grantError: Object.assign(new Error("view unavailable"), { code: "ER_VIEW_INVALID" }) }),
]) {
  const failedClosed = await resolveUserBrandSkillEntitlement(
    failurePool,
    { required: true, granted: true, matched_skill_key: "api.wordpress_write" },
    {
      tenant_id: "tenant-1",
      brand_key: "brand-1",
      agent_id: "content-agent",
      user_id: "user-1",
      resource_type: "site",
      resource_ref: "site-1",
    },
    { toolName: "wordpress_publish", action },
  );
  assert.equal(failedClosed.configured, true);
  assert.equal(failedClosed.granted, false);
  assert.equal(failedClosed.reason, "user_brand_skill_grant_resolution_failed");
}

const deniedWithoutUserGrant = await authorizeAgentToolCall({
  tool_name: "wordpress_publish",
  args: { status: "publish" },
  context: {
    agent_id: "content-agent",
    user_id: "user-1",
    tenant_id: "tenant-1",
    brand_key: "brand-1",
    resource_type: "site",
    resource_ref: "site-1",
  },
  pool: buildPool({ policy: selfServicePolicy }),
});
assert.equal(deniedWithoutUserGrant.allowed, false);
assert(deniedWithoutUserGrant.blockers.includes("user_brand_skill_grant_missing"));
assert.equal(deniedWithoutUserGrant.user_brand_skill_grant.configured, true);
assert.equal(deniedWithoutUserGrant.user_brand_skill_grant.operation, "publish");

const deniedOnResolutionFailure = await authorizeAgentToolCall({
  tool_name: "wordpress_publish",
  args: { status: "publish" },
  context: {
    agent_id: "content-agent",
    user_id: "user-1",
    tenant_id: "tenant-1",
    brand_key: "brand-1",
    resource_type: "site",
    resource_ref: "site-1",
  },
  pool: buildPool({ policyError: Object.assign(new Error("policy unavailable"), { code: "ER_NO_SUCH_TABLE" }) }),
});
assert.equal(deniedOnResolutionFailure.allowed, false);
assert(deniedOnResolutionFailure.blockers.includes("user_brand_skill_grant_resolution_failed"));

const allowedExactScope = await authorizeAgentToolCall({
  tool_name: "wordpress_publish",
  args: { status: "publish" },
  context: {
    agent_id: "content-agent",
    user_id: "user-1",
    tenant_id: "tenant-1",
    brand_key: "brand-1",
    resource_type: "site",
    resource_ref: "site-1",
  },
  pool: buildPool({ policy: selfServicePolicy, grants: [exactGrant] }),
});
assert.equal(allowedExactScope.allowed, true);
assert.equal(allowedExactScope.user_brand_skill_grant.grant_id, "user-brand-grant-1");

for (const contextOverride of [
  { user_id: "user-2" },
  { brand_key: "brand-2" },
  { resource_ref: "site-2" },
  { operation_intent: "delete" },
]) {
  const denied = await authorizeAgentToolCall({
    tool_name: "wordpress_publish",
    args: { status: "publish" },
    context: {
      agent_id: "content-agent",
      user_id: "user-1",
      tenant_id: "tenant-1",
      brand_key: "brand-1",
      resource_type: "site",
      resource_ref: "site-1",
      ...contextOverride,
    },
    pool: buildPool({ policy: selfServicePolicy, grants: [exactGrant] }),
  });
  assert.equal(denied.allowed, false, JSON.stringify(contextOverride));
  assert(denied.blockers.includes("user_brand_skill_grant_missing"));
}

const disabledPolicy = await authorizeAgentToolCall({
  tool_name: "wordpress_publish",
  context: {
    agent_id: "content-agent",
    user_id: "user-1",
    tenant_id: "tenant-1",
    brand_key: "brand-1",
    resource_type: "site",
    resource_ref: "site-1",
  },
  pool: buildPool({
    policy: { policy_id: "policy-disabled", activation_mode: "disabled" },
    grants: [exactGrant],
  }),
});
assert.equal(disabledPolicy.allowed, false);
assert(disabledPolicy.blockers.includes("brand_skill_policy_disabled"));

console.log("PASS user brand skill entitlement runtime isolation");
