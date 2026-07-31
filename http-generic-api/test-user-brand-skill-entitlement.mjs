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

const activeMembership = {
  role: "member",
  status: "active",
  tenant_status: "active",
};

const activeSiteBinding = {
  target_key: "brand-1",
  resource_ref: "site-1",
  site_id: "site-1",
  binding_id: "site-binding-1",
};

function buildPool({
  policy = null,
  grants = [],
  membership = activeMembership,
  resourceGrants = [],
  siteBindings = [activeSiteBinding],
  entitlementError = false,
  actionError = false,
  registryAction = action,
} = {}) {
  return {
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ");
      if (text.includes(" FROM actions ")) {
        if (actionError) {
          const error = new Error("simulated action registry query failure");
          error.code = "ER_QUERY_INTERRUPTED";
          throw error;
        }
        return [[registryAction].filter(Boolean)];
      }
      if (text.includes(" FROM v_effective_agent_skill_grants ")) {
        return [[{ skill_key: "api.wordpress_write", grant_id: "agent-skill-grant-1" }]];
      }
      if (text.includes(" FROM brand_skill_policies p ")) {
        if (entitlementError) {
          const error = new Error("simulated entitlement query failure");
          error.code = "ER_QUERY_INTERRUPTED";
          throw error;
        }
        return [[policy].filter(Boolean)];
      }
      if (text.includes(" FROM memberships m ")) {
        return [[membership].filter(Boolean)];
      }
      if (text.includes(" FROM v_effective_user_brand_skill_grants ")) {
        const [tenantId, userId, brandKey, agentId, skillKey, policyId, operation] = params;
        const resourceType = params[8];
        const resourceRef = params[9];
        const requiresResourceBinding = Number(params[7] || 0) === 1;
        const match = grants.find((grant) =>
          grant.tenant_id === tenantId &&
          grant.user_id === userId &&
          grant.brand_key === brandKey &&
          grant.agent_id === agentId &&
          grant.skill_key === skillKey &&
          grant.policy_id === policyId &&
          grant.allowed_operations.includes(operation) &&
          (requiresResourceBinding
            ? grant.resource_type === resourceType && grant.resource_ref === resourceRef
            : !grant.resource_type || (grant.resource_type === resourceType && grant.resource_ref === resourceRef))
        );
        return [match ? [{
          grant_id: match.grant_id,
          resource_grant_id: match.resource_grant_id,
          resource_type: match.resource_type,
          resource_ref: match.resource_ref,
        }] : []];
      }
      if (text.includes(" FROM workspace_resource_grants ")) {
        const [grantId, tenantId, userId, resourceType, resourceRef] = params;
        const match = resourceGrants.find((grant) =>
          grant.grant_id === grantId &&
          grant.tenant_id === tenantId &&
          grant.grantee_user_id === userId &&
          grant.resource_type === resourceType &&
          grant.resource_ref === resourceRef &&
          grant.status === "active" &&
          grant.expired !== true
        );
        return [match ? [{ grant_id: match.grant_id, permission: match.permission || "operate" }] : []];
      }
      if (text.includes(" FROM brand_site_bindings b ")) {
        const [brandKey, resourceRef] = params;
        const matches = siteBindings
          .filter((binding) => binding.target_key === brandKey && binding.resource_ref === resourceRef)
          .map((binding) => ({ binding_id: binding.binding_id, site_id: binding.site_id }));
        return [matches];
      }
      if (text.includes("COUNT(*) AS configured_count") && text.includes(" FROM app_action_grants ")) {
        return [[{ configured_count: 0 }]];
      }
      if (text.includes(" FROM app_action_grants ")) return [[]];
      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

const selfServicePolicy = {
  policy_id: "policy-1",
  activation_mode: "self_service",
  allowed_roles_json: JSON.stringify(["member", "admin"]),
  allowed_agent_ids_json: JSON.stringify(["content-agent"]),
  allowed_operations_json: JSON.stringify(["publish", "update"]),
  requires_resource_binding: 1,
};
const exactGrant = {
  grant_id: "user-brand-grant-1",
  resource_grant_id: "resource-grant-1",
  tenant_id: "tenant-1",
  user_id: "user-1",
  brand_key: "brand-1",
  agent_id: "content-agent",
  skill_key: "api.wordpress_write",
  policy_id: "policy-1",
  resource_type: "site",
  resource_ref: "site-1",
  allowed_operations: ["publish", "update"],
};
const exactResourceGrant = {
  grant_id: "resource-grant-1",
  tenant_id: "tenant-1",
  grantee_user_id: "user-1",
  resource_type: "site",
  resource_ref: "site-1",
  permission: "operate",
  status: "active",
};

assert.equal(inferBrandSkillOperation("wordpress_publish", {}, action, {}), "publish");
assert.equal(inferBrandSkillOperation("wordpress_send", {}, action, {}), "publish");
assert.equal(inferBrandSkillOperation("wordpress_update", {}, action, {}), "update");
assert.equal(inferBrandSkillOperation("wordpress_delete", {}, action, {}), "delete");
assert.equal(inferBrandSkillOperation("wordpress_revoke", {}, action, {}), "delete");
assert.equal(inferBrandSkillOperation("wordpress_publish", {}, action, { operation_intent: "create" }), null);
assert.equal(inferBrandSkillOperation("wordpress_publish", {}, action, { operation_intent: "publish" }), "publish");
assert.equal(inferBrandSkillOperation("wordpress_create_post", { status: "publish" }, {
  ...action,
  action_key: "wordpress_create_post",
}, {}), "publish");
assert.equal(inferBrandSkillOperation("wordpress_mutation", { operation: "publish" }, {
  ...action,
  action_key: "wordpress_mutation",
}, {}), null);
assert.equal(inferBrandSkillOperation("wordpress_mutation", {}, {
  ...action,
  action_key: "wordpress_mutation",
}, {
  operation_intent: "update",
  brand_skill_operation_intent_trusted: true,
}), "update");
assert.equal(inferBrandSkillOperation("wordpress_mutation", {}, {
  ...action,
  action_key: "wordpress_mutation",
}, {}), null);

const backwardCompatible = await resolveUserBrandSkillEntitlement(
  buildPool(),
  { required: true, granted: true, matched_skill_key: "api.wordpress_write" },
  { tenant_id: "tenant-1", brand_key: "brand-1", agent_id: "content-agent" },
  { toolName: "wordpress_publish", action }
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
  { toolName: "wordpress_publish", action }
);
assert.equal(explicitPolicyRequired.granted, false);
assert.equal(explicitPolicyRequired.reason, "brand_skill_policy_required");

const deniedActionRegistryFailure = await authorizeAgentToolCall({
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
  pool: buildPool({ actionError: true }),
});
assert.equal(deniedActionRegistryFailure.allowed, false);
assert(deniedActionRegistryFailure.blockers.includes("action_registry_resolution_failed"));
assert.equal(deniedActionRegistryFailure.action_registry.resolved, false);
assert.equal(deniedActionRegistryFailure.action_registry.failure.code, "er_query_interrupted");

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
  pool: buildPool({
    policy: selfServicePolicy,
    grants: [exactGrant],
    resourceGrants: [exactResourceGrant],
  }),
});
assert.equal(allowedExactScope.allowed, true);
assert.equal(allowedExactScope.user_brand_skill_grant.grant_id, "user-brand-grant-1");

const allowedDomainAlias = await resolveUserBrandSkillEntitlement(
  buildPool({
    policy: selfServicePolicy,
    grants: [exactGrant],
    resourceGrants: [exactResourceGrant],
    siteBindings: [{
      target_key: "brand-1",
      resource_ref: "example.com",
      site_id: "site-1",
      binding_id: "site-binding-domain",
    }],
  }),
  { required: true, granted: true, matched_skill_key: "api.wordpress_write" },
  {
    tenant_id: "tenant-1",
    user_id: "user-1",
    brand_key: "brand-1",
    agent_id: "content-agent",
    resource_type: "site",
    resource_ref: "example.com",
  },
  { toolName: "wordpress_publish", action }
);
assert.equal(allowedDomainAlias.granted, true);
assert.equal(allowedDomainAlias.resource_ref, "site-1");
assert.equal(allowedDomainAlias.resource_binding_source, "brand_site_bindings");

for (const { override, blocker } of [
  { override: { user_id: "user-2" }, blocker: "user_brand_skill_grant_missing" },
  { override: { brand_key: "brand-2" }, blocker: "user_brand_skill_resource_brand_binding_inactive" },
  { override: { resource_ref: "site-2" }, blocker: "user_brand_skill_resource_brand_binding_inactive" },
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
      ...override,
    },
    pool: buildPool({
      policy: selfServicePolicy,
      grants: [exactGrant],
      resourceGrants: [exactResourceGrant],
    }),
  });
  assert.equal(denied.allowed, false, JSON.stringify(override));
  assert(denied.blockers.includes(blocker));
}

const policyNarrowed = await authorizeAgentToolCall({
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
    policy: { ...selfServicePolicy, allowed_operations_json: JSON.stringify(["update"]) },
    grants: [exactGrant],
    resourceGrants: [exactResourceGrant],
  }),
});
assert.equal(policyNarrowed.allowed, false);
assert(policyNarrowed.blockers.includes("brand_skill_operation_no_longer_allowed"));

const agentRemoved = await authorizeAgentToolCall({
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
    policy: { ...selfServicePolicy, allowed_agent_ids_json: JSON.stringify(["other-agent"]) },
    grants: [exactGrant],
    resourceGrants: [exactResourceGrant],
  }),
});
assert.equal(agentRemoved.allowed, false);
assert(agentRemoved.blockers.includes("user_brand_skill_agent_no_longer_allowed"));

const membershipInactive = await authorizeAgentToolCall({
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
    policy: selfServicePolicy,
    membership: { ...activeMembership, status: "suspended" },
    grants: [exactGrant],
    resourceGrants: [exactResourceGrant],
  }),
});
assert.equal(membershipInactive.allowed, false);
assert(membershipInactive.blockers.includes("user_brand_skill_membership_inactive"));

const roleRemoved = await authorizeAgentToolCall({
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
    policy: { ...selfServicePolicy, allowed_roles_json: JSON.stringify(["admin"]) },
    grants: [exactGrant],
    resourceGrants: [exactResourceGrant],
  }),
});
assert.equal(roleRemoved.allowed, false);
assert(roleRemoved.blockers.includes("user_brand_skill_role_no_longer_allowed"));

const resourceAuthorityInactive = await authorizeAgentToolCall({
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
    policy: selfServicePolicy,
    grants: [exactGrant],
    resourceGrants: [{ ...exactResourceGrant, status: "revoked" }],
  }),
});
assert.equal(resourceAuthorityInactive.allowed, false);
assert(resourceAuthorityInactive.blockers.includes("user_brand_skill_resource_authority_inactive"));

const resourcePermissionInsufficient = await authorizeAgentToolCall({
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
    policy: selfServicePolicy,
    grants: [exactGrant],
    resourceGrants: [{ ...exactResourceGrant, permission: "view" }],
  }),
});
assert.equal(resourcePermissionInsufficient.allowed, false);
assert(resourcePermissionInsufficient.blockers.includes("user_brand_skill_resource_permission_insufficient"));

const resourceBrandBindingInactive = await authorizeAgentToolCall({
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
    policy: selfServicePolicy,
    grants: [exactGrant],
    resourceGrants: [exactResourceGrant],
    siteBindings: [],
  }),
});
assert.equal(resourceBrandBindingInactive.allowed, false);
assert(resourceBrandBindingInactive.blockers.includes("user_brand_skill_resource_brand_binding_inactive"));

const resourceScopeMissing = await authorizeAgentToolCall({
  tool_name: "wordpress_publish",
  context: {
    agent_id: "content-agent",
    user_id: "user-1",
    tenant_id: "tenant-1",
    brand_key: "brand-1",
  },
  pool: buildPool({ policy: selfServicePolicy, grants: [exactGrant] }),
});
assert.equal(resourceScopeMissing.allowed, false);
assert(resourceScopeMissing.blockers.includes("user_brand_skill_resource_scope_required"));

const unknownConsequentialOperation = await authorizeAgentToolCall({
  tool_name: "wordpress_mutation",
  context: {
    agent_id: "content-agent",
    user_id: "user-1",
    tenant_id: "tenant-1",
    brand_key: "brand-1",
    resource_type: "site",
    resource_ref: "site-1",
  },
  pool: buildPool({
    registryAction: { ...action, action_key: "wordpress_mutation" },
    policy: selfServicePolicy,
    grants: [exactGrant],
    resourceGrants: [exactResourceGrant],
  }),
});
assert.equal(unknownConsequentialOperation.allowed, false);
assert(unknownConsequentialOperation.blockers.includes("brand_skill_operation_unresolved"));

const resolutionFailure = await authorizeAgentToolCall({
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
  pool: buildPool({ entitlementError: true }),
});
assert.equal(resolutionFailure.allowed, false);
assert.equal(resolutionFailure.user_brand_skill_grant.configured, true);
assert.equal(resolutionFailure.user_brand_skill_grant.granted, false);
assert(resolutionFailure.blockers.includes("user_brand_skill_grant_resolution_failed"));

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
    policy: { ...selfServicePolicy, policy_id: "policy-disabled", activation_mode: "disabled" },
    grants: [exactGrant],
  }),
});
assert.equal(disabledPolicy.allowed, false);
assert(disabledPolicy.blockers.includes("brand_skill_policy_disabled"));

console.log("PASS user brand skill entitlement runtime isolation and stale-authority rejection");
