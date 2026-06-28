import assert from "node:assert/strict";

import {
  compareAuthorityScopeShadow,
  principalToAuthorityAuth,
  resolveAuthorityScopeShadowContext
} from "./authorityScopeShadowBridge.js";
import {
  invalidateContainerAuthorityCache,
  resolveEffectiveContainerContext
} from "./dynamicContainerAuthorityResolver.js";

const TENANT = "tenant-shadow";
const TARGET = "brand-shadow";

assert.deepEqual(principalToAuthorityAuth({ type: "service", id: "platform_admin" }, TENANT), {
  mode: "backend_api_key",
  is_admin: true,
  principal_type: "platform_admin",
  user_id: "platform_admin"
});
assert.deepEqual(principalToAuthorityAuth({ type: "user", id: "user-shadow" }, TENANT), {
  principal_type: "user",
  principal_id: "user-shadow",
  user_id: "user-shadow",
  agent_id: null,
  service_id: null,
  tenant_id: TENANT
});

const matchingResolution = {
  source: "authority_scope_registry",
  selectionMode: "explicit_tenant",
  principal: { principalType: "tenant_member", principalId: "user-shadow" },
  scope: {
    scopeId: "ascope-shadow",
    scopeKey: `tenant:${TENANT}`,
    scopeType: "tenant",
    tenantId: TENANT,
    status: "active",
    version: 1
  }
};

assert.deepEqual(compareAuthorityScopeShadow({ tenantId: TENANT, resolution: matchingResolution }), {
  status: "match",
  mismatchCodes: []
});
assert.deepEqual(compareAuthorityScopeShadow({
  tenantId: TENANT,
  resolution: { ...matchingResolution, scope: { ...matchingResolution.scope, scopeType: "platform", tenantId: null } }
}), {
  status: "mismatch",
  mismatchCodes: ["authority_scope_type_mismatch", "authority_scope_tenant_mismatch"]
});

const bridgeResolved = await resolveAuthorityScopeShadowContext({
  principal: { type: "user", id: "user-shadow" },
  tenantId: TENANT,
  requestId: "request-shadow"
}, {
  service: { preview: async () => matchingResolution }
});
assert.equal(bridgeResolved.status, "resolved");
assert.equal(bridgeResolved.comparisonStatus, "match");
assert.equal(bridgeResolved.authorityGranted, false);
assert.equal(bridgeResolved.enforcementMode, "shadow_only");
assert.equal(bridgeResolved.providerCallMade, false);
assert.equal(bridgeResolved.secretsIncluded, false);

const bridgeFailure = await resolveAuthorityScopeShadowContext({
  principal: { type: "user", id: "user-shadow" },
  tenantId: TENANT
}, {
  service: {
    preview: async () => {
      const error = new Error("missing");
      error.code = "AUTHORITY_SCOPE_NOT_REGISTERED";
      error.status = 404;
      throw error;
    }
  }
});
assert.equal(bridgeFailure.status, "unresolved");
assert.equal(bridgeFailure.authorityGranted, false);
assert.deepEqual(bridgeFailure.mismatchCodes, ["AUTHORITY_SCOPE_NOT_REGISTERED"]);

const state = {
  target: { container_id: TARGET, tenant_id: TENANT, container_type_key: "brand", status: "active", version: 1 },
  containers: [
    { container_id: "workspace-shadow", tenant_id: TENANT, container_type_key: "workspace", status: "active", version: 1 },
    { container_id: TARGET, tenant_id: TENANT, container_type_key: "brand", status: "active", version: 1 }
  ],
  containerTypes: [
    { container_type_key: "workspace", status: "active", version: 1 },
    { container_type_key: "brand", status: "active", version: 1 }
  ],
  relationships: [
    {
      relationship_id: "contains-shadow",
      tenant_id: TENANT,
      from_container_id: "workspace-shadow",
      to_container_id: TARGET,
      relationship_type_key: "contains",
      status: "active",
      version: 1
    }
  ],
  relationshipTypes: [
    { relationship_type_key: "contains", relationship_class: "containment", contributes_to_ancestry: 1, status: "active" }
  ],
  classificationTypes: [],
  classifications: [],
  roleAssignments: [
    {
      assignment_id: "role-shadow",
      tenant_id: TENANT,
      container_id: "workspace-shadow",
      principal_type: "user",
      principal_id: "user-shadow",
      role_template_key: "container_viewer",
      inheritance_mode: "inherit_down",
      status: "active",
      version: 1
    }
  ],
  roleTemplates: [
    {
      role_template_key: "container_viewer",
      composition_json: [],
      authority_rank: 1,
      eligible_container_types_json: ["workspace", "brand"],
      status: "active",
      version: 1
    }
  ],
  rolePermissions: [
    {
      role_template_key: "container_viewer",
      dimension_key: "assets",
      permission_key: "read",
      effect: "allow",
      operation_patterns_json: ["read.*"],
      merge_priority: 10,
      status: "active"
    }
  ],
  dimensions: [
    {
      dimension_key: "assets",
      supports_sharing: 0,
      supports_delegation: 0,
      default_merge_strategy: "deny_wins",
      override_allowed: 0,
      status: "active",
      version: 1
    }
  ],
  bindings: [
    {
      binding_id: "binding-shadow",
      tenant_id: TENANT,
      container_id: "workspace-shadow",
      dimension_key: "assets",
      resource_type: "asset",
      resource_ref: "asset-shadow",
      effect: "allow",
      permission_key: "read",
      operation_patterns_json: ["read.*"],
      capability_keys_json: [],
      inheritance_mode: "inherit_down",
      merge_priority: 0,
      conditions_json: {},
      status: "active",
      version: 1
    }
  ],
  authorityEpoch: 3
};

const persisted = [];
const samples = [];
invalidateContainerAuthorityCache();
const result = await resolveEffectiveContainerContext({
  principal: { type: "user", id: "user-shadow" },
  tenantId: TENANT,
  targetContainerId: TARGET,
  mode: "preview",
  requestId: "request-shadow-integration",
  dimensionRequests: [
    {
      dimension: "assets",
      resourceType: "asset",
      resourceRef: "asset-shadow",
      operation: "read.asset",
      capabilityKey: "asset_read"
    }
  ]
}, {
  loadState: async () => state,
  readEpoch: async () => ({ authority_epoch: 3 }),
  persistResolution: async value => { persisted.push(value); return value; },
  persistComparison: async value => value,
  recordPerformance: async value => { samples.push(value); return value; },
  readPolicy: async () => ({ p99_budget_ms: 400 }),
  readIdempotency: async () => null,
  storeIdempotency: async () => null,
  resolveAuthorityScopeShadow: async () => ({
    status: "resolved",
    enforcementMode: "shadow_only",
    authorityGranted: false,
    scope: matchingResolution.scope,
    comparisonStatus: "match",
    mismatchCodes: [],
    providerCallMade: false,
    credentialPayloadRead: false,
    secretsIncluded: false
  }),
  enforcementEnabled: false
});

assert.equal(result.decision, "allow");
assert.equal(result.authorityScopeShadow.comparisonStatus, "match");
assert.equal(result.authorityScopeShadow.authorityGranted, false);
assert.equal(persisted.length, 1);
assert.equal(persisted[0].authorityScopeShadow.comparisonStatus, "match");
assert.equal(samples.length, 1);
assert.equal(samples[0].metadata.authorityScopeShadowStatus, "resolved");
assert.equal(samples[0].metadata.authorityScopeShadowComparison, "match");

invalidateContainerAuthorityCache();
const unchangedDecision = await resolveEffectiveContainerContext({
  principal: { type: "user", id: "user-shadow" },
  tenantId: TENANT,
  targetContainerId: TARGET,
  mode: "preview",
  dimensionRequests: [
    {
      dimension: "assets",
      resourceType: "asset",
      resourceRef: "asset-shadow",
      operation: "read.asset"
    }
  ]
}, {
  loadState: async () => state,
  readEpoch: async () => ({ authority_epoch: 3 }),
  persistResolution: async value => value,
  persistComparison: async value => value,
  recordPerformance: async value => value,
  readPolicy: async () => null,
  readIdempotency: async () => null,
  storeIdempotency: async () => null,
  resolveAuthorityScopeShadow: async () => {
    throw Object.assign(new Error("shadow unavailable"), {
      code: "AUTHORITY_SCOPE_SHADOW_UNAVAILABLE",
      status: 503
    });
  },
  enforcementEnabled: false
});

assert.equal(unchangedDecision.decision, "allow");
assert.equal(unchangedDecision.authorityScopeShadow.status, "unresolved");
assert.equal(unchangedDecision.authorityScopeShadow.authorityGranted, false);
assert.deepEqual(unchangedDecision.authorityScopeShadow.mismatchCodes, ["AUTHORITY_SCOPE_SHADOW_UNAVAILABLE"]);

console.log("authority scope shadow integration tests passed");
