import assert from "node:assert/strict";
import {
  resolveEffectiveContainerContext,
  invalidateContainerAuthorityCache
} from "../dynamicContainerAuthorityResolver.js";
import { summarizeResolutionPerformance } from "../dynamicContainerRolloutSafety.js";

const POLICY = { p95BudgetMs:150,p99BudgetMs:400 };
const TENANT = "tenant-benchmark";
const TARGET = "brand-benchmark";

const state = {
  tenantId:TENANT,
  target:{ container_id:TARGET,tenant_id:TENANT,container_type_key:"brand",status:"active",version:1 },
  containers:[
    { container_id:"workspace-benchmark",tenant_id:TENANT,container_type_key:"workspace",status:"active",version:1 },
    { container_id:TARGET,tenant_id:TENANT,container_type_key:"brand",status:"active",version:1 }
  ],
  containerTypes:[
    { container_type_key:"workspace",status:"active",version:1 },
    { container_type_key:"brand",status:"active",version:1 }
  ],
  relationships:[{
    relationship_id:"contains-benchmark",tenant_id:TENANT,
    from_container_id:"workspace-benchmark",to_container_id:TARGET,
    relationship_type_key:"contains",status:"active",version:1
  }],
  relationshipTypes:[{
    relationship_type_key:"contains",relationship_class:"containment",
    contributes_to_ancestry:1,status:"active"
  }],
  classificationTypes:[],
  classifications:[],
  roleTemplates:[{
    role_template_key:"container_viewer",composition_json:[],authority_rank:1,
    eligible_container_types_json:["workspace","brand"],status:"active",version:1
  }],
  rolePermissions:[{
    role_template_key:"container_viewer",dimension_key:"assets",permission_key:"read",
    effect:"allow",operation_patterns_json:["read.*"],merge_priority:10,status:"active"
  }],
  roleAssignments:[{
    assignment_id:"role-benchmark",tenant_id:TENANT,container_id:"workspace-benchmark",
    principal_type:"user",principal_id:"user-benchmark",role_template_key:"container_viewer",
    inline_permissions_json:null,inheritance_mode:"inherit_down",status:"active",version:1
  }],
  dimensions:[{
    dimension_key:"assets",supports_sharing:0,supports_delegation:0,
    default_merge_strategy:"deny_wins",override_allowed:0,status:"active",version:1
  }],
  bindings:[{
    binding_id:"binding-benchmark",tenant_id:TENANT,container_id:"workspace-benchmark",
    dimension_key:"assets",resource_type:"asset",resource_ref:"asset-benchmark",
    effect:"allow",permission_key:"read",operation_patterns_json:["read.*"],
    capability_keys_json:["asset_read"],inheritance_mode:"inherit_down",merge_priority:0,
    conditions_json:{},status:"active",version:1
  }],
  authorityEpoch:1
};

const samples = [];
const dependencies = {
  loadState:async () => state,
  readEpoch:async () => ({ authority_epoch:1 }),
  persistResolution:async value => value,
  persistComparison:async value => value,
  recordPerformance:async value => samples.push(value),
  readPolicy:async () => ({ p99_budget_ms:POLICY.p99BudgetMs }),
  readIdempotency:async () => null,
  storeIdempotency:async () => null,
  enforcementEnabled:false
};
const request = {
  principal:{ type:"user",id:"user-benchmark" },
  tenantId:TENANT,
  targetContainerId:TARGET,
  mode:"preview",
  dimensionRequests:[{
    dimension:"assets",resourceType:"asset",resourceRef:"asset-benchmark",
    operation:"read.asset",capabilityKey:"asset_read"
  }]
};

for (let index=0; index<25; index += 1) {
  invalidateContainerAuthorityCache(TENANT);
  await resolveEffectiveContainerContext(request,dependencies);
}

samples.length=0;
for (let index=0; index<200; index += 1) {
  invalidateContainerAuthorityCache(TENANT);
  await resolveEffectiveContainerContext(request,dependencies);
}
const cold = summarizeResolutionPerformance(samples,{ mode:"preview" });

samples.length=0;
invalidateContainerAuthorityCache(TENANT);
await resolveEffectiveContainerContext(request,dependencies);
samples.length=0;
for (let index=0; index<1000; index += 1) {
  await resolveEffectiveContainerContext(request,dependencies);
}
const warm = summarizeResolutionPerformance(samples,{ mode:"preview" });

assert.equal(cold.sampleCount,200);
assert.equal(warm.sampleCount,1000);
assert(cold.p95LatencyMs<=POLICY.p95BudgetMs,`cold p95 ${cold.p95LatencyMs}ms exceeds ${POLICY.p95BudgetMs}ms`);
assert(cold.p99LatencyMs<=POLICY.p99BudgetMs,`cold p99 ${cold.p99LatencyMs}ms exceeds ${POLICY.p99BudgetMs}ms`);
assert(warm.p95LatencyMs<=POLICY.p95BudgetMs,`warm p95 ${warm.p95LatencyMs}ms exceeds ${POLICY.p95BudgetMs}ms`);
assert(warm.p99LatencyMs<=POLICY.p99BudgetMs,`warm p99 ${warm.p99LatencyMs}ms exceeds ${POLICY.p99BudgetMs}ms`);

console.log(JSON.stringify({
  ok:true,
  policy:POLICY,
  cold,
  warm,
  providerCalls:false,
  credentialPayloadReads:false,
  externalWrites:false,
  secretsIncluded:false
}));
