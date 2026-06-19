import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildContainerClosureRows,
  enumerateContainerPaths,
  resolveOverridePolicy,
  resolveRoleTemplateComposition
} from "./dynamicContainerAuthority.js";
import {
  invalidateContainerAuthorityCache,
  resolveEffectiveContainerContext
} from "./dynamicContainerAuthorityResolver.js";
import {
  createContainerOverrideRequestRecord,
  persistContainerResolution,
  persistShadowComparison,
  recordContainerPerformanceSample,
  storeIdempotentResult
} from "./dynamicContainerAuthorityRepository.js";
import { buildLegacyContainerProjectionPlan } from "./dynamicContainerProjectionService.js";
import { _testingDynamicContainerOverrideService } from "./dynamicContainerOverrideService.js";

const TENANT = "tenant-1";
const TARGET = "brand-1";
const relationshipTypes = [
  { relationship_type_key:"contains",relationship_class:"containment",contributes_to_ancestry:1,status:"active" },
  { relationship_type_key:"shares",relationship_class:"sharing",contributes_to_ancestry:0,status:"active" },
  { relationship_type_key:"delegates",relationship_class:"delegation",contributes_to_ancestry:0,status:"active" }
];
const containers = [
  { container_id:"workspace-1",tenant_id:TENANT,container_type_key:"workspace",status:"active",version:1 },
  { container_id:"workspace-2",tenant_id:TENANT,container_type_key:"workspace",status:"active",version:1 },
  { container_id:"source-1",tenant_id:TENANT,container_type_key:"workspace",status:"active",version:1 },
  { container_id:TARGET,tenant_id:TENANT,container_type_key:"brand",status:"active",version:1 },
  { container_id:"platform-1",tenant_id:TENANT,container_type_key:"platform",status:"active",version:1 }
];
const containmentRelationships = [
  { relationship_id:"contains-1",tenant_id:TENANT,from_container_id:"workspace-1",to_container_id:TARGET,relationship_type_key:"contains",status:"active",version:1 },
  { relationship_id:"contains-2",tenant_id:TENANT,from_container_id:"workspace-2",to_container_id:TARGET,relationship_type_key:"contains",status:"active",version:1 }
];
const roleTemplates = [
  { role_template_key:"container_viewer",composition_json:[],authority_rank:1,eligible_container_types_json:["workspace","brand"],status:"active",version:1 },
  { role_template_key:"container_operator",composition_json:["container_viewer"],authority_rank:2,eligible_container_types_json:["workspace","brand"],status:"active",version:1 },
  { role_template_key:"platform_owner",composition_json:["container_operator"],authority_rank:4,eligible_container_types_json:["platform"],status:"active",version:1 }
];
const rolePermissions = [
  { role_template_key:"container_viewer",dimension_key:"assets",permission_key:"read",effect:"allow",operation_patterns_json:["read.*"],merge_priority:10,status:"active" },
  { role_template_key:"container_operator",dimension_key:"assets",permission_key:"write",effect:"allow",operation_patterns_json:["write.*"],merge_priority:20,status:"active" }
];
const roleAssignments = [
  { assignment_id:"role-1",tenant_id:TENANT,container_id:"workspace-1",principal_type:"user",principal_id:"user-1",role_template_key:"container_operator",inline_permissions_json:null,inheritance_mode:"inherit_down",status:"active",version:1 },
  { assignment_id:"role-2",tenant_id:TENANT,container_id:"workspace-2",principal_type:"user",principal_id:"user-1",role_template_key:"container_operator",inline_permissions_json:null,inheritance_mode:"inherit_down",status:"active",version:1 }
];
const dimensions = [
  { dimension_key:"assets",supports_sharing:1,supports_delegation:1,default_merge_strategy:"union",override_allowed:1,status:"active",version:1 }
];

function binding(id,containerId,effect="allow",operations=["read.*","write.*"],extra={}) {
  return {
    binding_id:id,tenant_id:TENANT,container_id:containerId,dimension_key:"assets",resource_type:"asset",resource_ref:"asset-1",
    effect,permission_key:"use",operation_patterns_json:operations,capability_keys_json:[],inheritance_mode:"inherit_down",
    merge_priority:0,conditions_json:{},status:"active",version:1,...extra
  };
}

function makeState(overrides={}) {
  return {
    tenantId:TENANT,
    target:containers.find(row => row.container_id === TARGET),
    containers,
    containerTypes:[
      { container_type_key:"workspace",status:"active",version:1 },
      { container_type_key:"brand",status:"active",version:1 },
      { container_type_key:"platform",status:"active",version:1 }
    ],
    relationships:containmentRelationships,
    relationshipTypes,
    classificationTypes:[],
    classifications:[],
    roleAssignments,
    roleTemplates,
    rolePermissions,
    dimensions,
    bindings:[binding("allow-1","workspace-1"),binding("allow-2","workspace-2")],
    authorityEpoch:7,
    ...overrides
  };
}

function depsFor(state,{ epoch=state.authorityEpoch,idempotencyStore=new Map(),persisted=[],comparisons=[],samples=[] }={}) {
  return {
    loadState:async () => state,
    readEpoch:async () => ({ authority_epoch:epoch }),
    persistResolution:async value => { persisted.push(value); return value; },
    persistComparison:async value => { comparisons.push(value); return value; },
    recordPerformance:async value => { samples.push(value); return value; },
    readPolicy:async () => ({ p99_budget_ms:400 }),
    readIdempotency:async (scope,key) => idempotencyStore.get(`${scope}|${key}`) || null,
    storeIdempotency:async value => { idempotencyStore.set(`${value.scopeKey}|${value.idempotencyKey}`,{ request_sha256:value.requestSha256,response:value.response }); },
    enforcementEnabled:false
  };
}

function request(operation="read.asset",mode="preview") {
  return {
    principal:{ type:"user",id:"user-1" },tenantId:TENANT,targetContainerId:TARGET,mode,
    dimensionRequests:[{ dimension:"assets",resourceType:"asset",resourceRef:"asset-1",operation,capabilityKey:"asset_use" }]
  };
}

const pathResult = enumerateContainerPaths({ targetContainerId:TARGET,relationships:containmentRelationships,relationshipTypes });
assert.equal(pathResult.ok,true);
assert.equal(pathResult.pathCount,2);
assert.deepEqual(pathResult.paths.map(path => path.rootContainerId),["workspace-1","workspace-2"]);
const closure = buildContainerClosureRows({ tenantId:TENANT,containers,relationships:containmentRelationships,relationshipTypes,authorityEpoch:7 });
assert.equal(closure.ok,true);
assert(closure.rows.some(row => row.ancestor_container_id === "workspace-1" && row.descendant_container_id === TARGET));
assert(closure.rows.some(row => row.ancestor_container_id === "workspace-2" && row.descendant_container_id === TARGET));

const composed = resolveRoleTemplateComposition({ rootRoleTemplateKey:"container_operator",roleTemplates });
assert.equal(composed.ok,true);
assert.deepEqual(composed.templateKeys,["container_viewer","container_operator"]);
const roleCycle = resolveRoleTemplateComposition({
  rootRoleTemplateKey:"role-a",
  roleTemplates:[
    { role_template_key:"role-a",composition_json:["role-b"],status:"active" },
    { role_template_key:"role-b",composition_json:["role-a"],status:"active" }
  ]
});
assert.equal(roleCycle.blocked,true);
assert.equal(roleCycle.code,"role_template_cycle_detected");

invalidateContainerAuthorityCache();
const allowPersisted=[];
const allowSamples=[];
const allowDeps=depsFor(makeState(),{ persisted:allowPersisted,samples:allowSamples });
const allowed = await resolveEffectiveContainerContext(request(),allowDeps);
assert.equal(allowed.decision,"allow");
assert.equal(allowed.containerPaths.length,2);
assert.equal(allowed.providerCallMade,false);
assert.equal(allowed.credentialPayloadRead,false);
assert.equal(allowed.secretsIncluded,false);
assert.equal(allowPersisted.length,1);
assert.equal(allowSamples.length,1);
const cached = await resolveEffectiveContainerContext(request(),allowDeps);
assert.equal(cached.cacheHit,true);
invalidateContainerAuthorityCache(TENANT);
const uncached = await resolveEffectiveContainerContext(request(),allowDeps);
assert.equal(uncached.cacheHit,false);

invalidateContainerAuthorityCache();
const denyState=makeState({ bindings:[binding("allow-1","workspace-1"),binding("deny-2","workspace-2","deny")] });
const denied = await resolveEffectiveContainerContext(request(),depsFor(denyState));
assert.equal(denied.decision,"deny");
assert(denied.blockingCodes.includes("inherited_policy_restriction"));

invalidateContainerAuthorityCache();
const blockerState=makeState({ bindings:[
  binding("ancestor-allow","workspace-1"),
  binding("target-block",TARGET,"allow",["read.*"],{ inheritance_mode:"block_inheritance" }),
  binding("allow-2","workspace-2")
] });
const blockedInheritance = await resolveEffectiveContainerContext(request(),depsFor(blockerState));
assert.equal(blockedInheritance.decision,"allow");
assert(!blockedInheritance.effectiveBindings.some(row => row.bindingId === "ancestor-allow"));

invalidateContainerAuthorityCache();
const shareRelationships=[
  { relationship_id:"contains-share",tenant_id:TENANT,from_container_id:"workspace-1",to_container_id:TARGET,relationship_type_key:"contains",status:"active",version:1 },
  { relationship_id:"share-1",tenant_id:TENANT,from_container_id:"source-1",to_container_id:TARGET,relationship_type_key:"shares",status:"active",priority:1,version:1 }
];
const shareState=makeState({
  relationships:shareRelationships,
  roleAssignments:[roleAssignments[0]],
  bindings:[binding("share-source","source-1","allow",["read.*","write.*"],{ inheritance_mode:"explicit_share" })]
});
const sharedRead = await resolveEffectiveContainerContext(request("read.asset"),depsFor(shareState));
assert.equal(sharedRead.decision,"allow");
const sharedWrite = await resolveEffectiveContainerContext(request("write.asset"),depsFor(shareState));
assert.equal(sharedWrite.decision,"deny");
assert(sharedWrite.blockingCodes.includes("sharing_write_not_delegated"));

invalidateContainerAuthorityCache();
const delegatedState=makeState({
  relationships:[...shareRelationships,{ relationship_id:"delegate-1",tenant_id:TENANT,from_container_id:"source-1",to_container_id:TARGET,relationship_type_key:"delegates",status:"active",priority:10,version:1 }],
  roleAssignments:[roleAssignments[0]],
  bindings:[
    binding("share-source","source-1","allow",["read.*","write.*"],{ inheritance_mode:"explicit_share" }),
    binding("delegate-source","source-1","delegate",["write.asset"],{
      inheritance_mode:"explicit_share",delegator_resolution_id:"resolution-source",delegation_relationship_id:"delegate-1"
    })
  ]
});
const delegatedWrite = await resolveEffectiveContainerContext(request("write.asset"),depsFor(delegatedState));
assert.equal(delegatedWrite.decision,"allow");
assert.equal(delegatedWrite.appliedDelegations.length,1);

invalidateContainerAuthorityCache();
const cycleState=makeState({
  relationships:[containmentRelationships[0]],
  roleAssignments:[{ ...roleAssignments[0],role_template_key:"role-a" }],
  roleTemplates:[
    { role_template_key:"role-a",composition_json:["role-b"],authority_rank:2,eligible_container_types_json:["workspace"],status:"active" },
    { role_template_key:"role-b",composition_json:["role-a"],authority_rank:2,eligible_container_types_json:["workspace"],status:"active" }
  ],
  bindings:[binding("allow-1","workspace-1")]
});
const cycleDecision = await resolveEffectiveContainerContext(request(),depsFor(cycleState));
assert.equal(cycleDecision.decision,"deny");
assert(cycleDecision.blockingCodes.includes("role_template_cycle_detected"));

invalidateContainerAuthorityCache();
const invalidClassificationState=makeState({
  classificationTypes:[{
    classification_type_key:"brand_maturity",value_schema_json:{ type:"string",enum:["new","mature"] },
    eligible_container_types_json:["brand"],merge_strategy:"nearest_replace",status:"active",version:1
  }],
  classifications:[{
    classification_id:"class-1",tenant_id:TENANT,container_id:"workspace-1",classification_type_key:"brand_maturity",
    value_json:"mature",inheritance_mode:"inherit_down",merge_priority:0,status:"active",version:1
  }]
});
const invalidClassification = await resolveEffectiveContainerContext(request(),depsFor(invalidClassificationState));
assert.equal(invalidClassification.decision,"deny");
assert(invalidClassification.blockingCodes.includes("classification_invalid"));

invalidateContainerAuthorityCache();
const platformState=makeState({
  relationships:[{ relationship_id:"platform-brand",tenant_id:TENANT,from_container_id:"platform-1",to_container_id:TARGET,relationship_type_key:"contains",status:"active",version:1 }],
  roleAssignments:[{ assignment_id:"platform-owner",tenant_id:TENANT,container_id:"platform-1",principal_type:"user",principal_id:"user-1",role_template_key:"platform_owner",inheritance_mode:"inherit_down",status:"active",version:1 }],
  bindings:[]
});
const platformOwnerWithoutBinding = await resolveEffectiveContainerContext(request(),depsFor(platformState));
assert.equal(platformOwnerWithoutBinding.decision,"deny");
assert(platformOwnerWithoutBinding.blockingCodes.includes("resource_binding_missing"));

await assert.rejects(() => resolveEffectiveContainerContext({ ...request(),mode:"enforce" },depsFor(makeState())),error => error.code === "effective_context_blocked");
await assert.rejects(() => resolveEffectiveContainerContext({ ...request(),access_token:"forbidden" },depsFor(makeState())),error => error.code === "container_secret_field_forbidden");
await assert.rejects(() => resolveEffectiveContainerContext({ ...request(),expectedAuthorityEpoch:8 },depsFor(makeState())),error => error.code === "container_authority_epoch_changed");
await assert.rejects(() => resolveEffectiveContainerContext(request(),depsFor(makeState(),{ epoch:8 })),error => error.code === "container_authority_epoch_changed");

invalidateContainerAuthorityCache();
const idempotencyStore=new Map();
const idemDeps=depsFor(makeState(),{ idempotencyStore });
const idemRequest={ ...request(),idempotencyKey:"idem-resolution-0001" };
const firstIdem=await resolveEffectiveContainerContext(idemRequest,idemDeps);
const secondIdem=await resolveEffectiveContainerContext(idemRequest,idemDeps);
assert.equal(secondIdem.idempotentReplay,true);
assert.equal(secondIdem.resolutionId,firstIdem.resolutionId);
await assert.rejects(
  () => resolveEffectiveContainerContext({ ...idemRequest,dimensionRequests:[{ ...idemRequest.dimensionRequests[0],operation:"write.asset" }] },idemDeps),
  error => error.code === "idempotency_key_conflict"
);

const comparisons=[];
invalidateContainerAuthorityCache();
const shadow=await resolveEffectiveContainerContext({ ...request(),mode:"shadow",legacyDecision:"deny" },depsFor(makeState(),{ comparisons }));
assert.equal(shadow.decision,"allow");
assert.equal(comparisons[0].comparisonStatus,"mismatch");

assert.deepEqual(resolveOverridePolicy("standard",120),{
  riskClass:"standard",critical:false,dualApprovalRequired:false,maximumTtlMinutes:60,ttlMinutes:60,requiredApprovalCount:1,selfApprovalAllowed:true
});
assert.equal(resolveOverridePolicy("critical").requiredApprovalCount,1);
assert.equal(resolveOverridePolicy("critical").selfApprovalAllowed,false);
assert.equal(resolveOverridePolicy("critical").ttlMinutes,15);
for (const riskClass of ["destructive","credential_touching","deployment_affecting"]) {
  const policy=resolveOverridePolicy(riskClass);
  assert.equal(policy.requiredApprovalCount,2);
  assert.equal(policy.selfApprovalAllowed,false);
  assert.equal(policy.ttlMinutes,15);
}
assert.throws(() => _testingDynamicContainerOverrideService.requireExactValue("*","operation"),error => error.code === "override_scope_mismatch");

function emptyProjectionSources() {
  return {
    tenants:[],workspaces:[],brands:[],brandPaths:[],activities:[],workflows:[],memberships:[],roleAssignments:[],
    workspaceGrants:[],workspaceAppLinks:[],actionGrants:[],skillGrants:[],workspaceAssets:[]
  };
}
const projectionSources={
  ...emptyProjectionSources(),
  tenants:[{ tenant_id:TENANT,display_name:"Tenant One",status:"active" }],
  workspaces:[{ workspace_id:"workspace-db-1",tenant_id:TENANT,workspace_key:"workspace-one",display_name:"Workspace One",bootstrap_status:"ready",linked_brand_key:"brand-key-1" }],
  brands:[{ id:1,brand_name:"Brand One",normalized_brand_name:"brand one",target_key:"brand-key-1",status:"active" }],
  brandPaths:[{ brand_key:"brand-key-1",target_key:"brand-key-1",business_type_key:"business-type-1",status:"active",active:"active" }],
  activities:[{ business_activity_type_key:"activity-1",business_type_key:"business-type-1",label:"Activity One",supported_workflows:'["workflow-1"]',status:"active",active:"active" }],
  workflows:[{ workflow_key:"workflow-1",workflow_id:"workflow-1",workflow_name:"Workflow One",status:"active",active:"active" }],
  memberships:[{ user_id:"user-1",tenant_id:TENANT,role:"admin",status:"active" }]
};
const projection=await buildLegacyContainerProjectionPlan({ sourceRows:projectionSources });
assert.equal(projection.summary.highRiskIssueCount,0);
assert.equal(projection.secretsIncluded,false);
for (const type of ["platform","tenant","workspace","brand","activity","workflow"]) {
  assert(projection.containers.some(row => row.container_type_key === type),`projection must create ${type} container`);
}
const projectionAgain=await buildLegacyContainerProjectionPlan({ sourceRows:projectionSources });
assert.deepEqual(projection.containers.map(row => row.container_id).sort(),projectionAgain.containers.map(row => row.container_id).sort());
const namespaceMismatch=await buildLegacyContainerProjectionPlan({
  sourceRows:{ ...projectionSources,workspaces:[{ ...projectionSources.workspaces[0],linked_brand_key:"Brand One" }] }
});
assert(namespaceMismatch.issues.some(row => row.issue_code === "workspace_brand_key_namespace_mismatch" && row.status === "held"));

function placeholderExecutor() {
  const calls=[];
  return {
    calls,
    query:async (sql,params=[]) => {
      const placeholderCount=(String(sql).match(/\?/g) || []).length;
      assert.equal(placeholderCount,params.length,`placeholder mismatch for SQL: ${String(sql).slice(0,80)}`);
      calls.push({ sql:String(sql),params });
      return [[],[]];
    }
  };
}
const executor=placeholderExecutor();
await persistContainerResolution({
  resolutionId:"resolution-1",requestId:"request-1",idempotencyKey:"idem-1",principal:{ type:"user",id:"user-1" },tenantId:TENANT,
  targetContainerId:TARGET,mode:"preview",decision:"allow",authorityEpoch:7,resolverVersion:"v1",requestSha256:"a".repeat(64),
  containerPathHash:"b".repeat(64),registrySnapshotHash:"c".repeat(64),resolutionSha256:"d".repeat(64),requestContext:{},
  containerPaths:[],effectiveClassifications:{},effectiveRoles:[],effectiveBindings:[],appliedDenies:[],appliedDelegations:[],blockingCodes:[],expiresAt:null
},executor);
await persistShadowComparison({ comparisonId:"comparison-1",resolutionId:"resolution-1",tenantId:TENANT,targetContainerId:TARGET,legacyDecision:"allow",containerDecision:"allow",comparisonStatus:"match",mismatchCodes:[] },executor);
await recordContainerPerformanceSample({ sampleId:"sample-1",mode:"synthetic",durationMs:1,withinBudget:true },executor);
await storeIdempotentResult({ scopeKey:"scope",idempotencyKey:"idem",requestSha256:"e".repeat(64),resultType:"test",resultId:"result",response:{} },executor);
await createContainerOverrideRequestRecord({
  overrideId:"override-1",originalResolutionId:"resolution-1",originalResolutionSha256:"d".repeat(64),originalDecision:"deny",originalBlockingCodes:["blocked"],
  authorityEpoch:7,registrySnapshotHash:"c".repeat(64),tenantId:TENANT,requesterPrincipalType:"user",requesterPrincipalId:"user-1",targetContainerId:TARGET,
  containerPathHash:"b".repeat(64),dimensionKey:"assets",resourceType:"asset",resourceRef:"asset-1",operationKey:"write.asset",riskClass:"standard",
  reason:"This is a sufficiently detailed governed override reason.",requiredApprovalCount:1,status:"ready_requires_approval",overrideSha256:"f".repeat(64),expiresAt:"2026-06-20 20:00:00"
},executor);
assert.equal(executor.calls.length,5);

const migration319=readFileSync("migrations/319_sprint69_dynamic_container_authority_foundation.sql","utf8");
const migration320=readFileSync("migrations/320_sprint69_dynamic_container_authority_runtime_contracts.sql","utf8");
const resolverSource=readFileSync("dynamicContainerAuthorityResolver.js","utf8");
const mutationSource=readFileSync("dynamicContainerAuthorityMutationService.js","utf8");
const repositorySource=readFileSync("dynamicContainerAuthorityRepository.js","utf8");
const routeSource=readFileSync("routes/dynamicContainerAuthorityRoutes.js","utf8");
for (const migration of [migration319,migration320]) {
  assert.doesNotMatch(migration,/\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(migration,/\bTRUNCATE\b/i);
}
assert.match(migration319,/eligible_container_types_json/);
assert.match(migration319,/delegation_relationship_id/);
assert.match(migration320,/container_effective_context_ledger/);
assert.match(migration320,/dynamic_container_authority_v1','shadow'/);
assert.match(migration320,/'critical',15,1,0,1/);
assert.match(migration320,/'destructive',15,2,0,1/);
assert.match(mutationSource,/Delegated resource bindings require explicit approval evidence/);
assert.match(repositorySource,/FOR UPDATE/);
assert.match(repositorySource,/same-cycle readback references are required/);
assert.doesNotMatch(routeSource,/container-overrides\/:overrideId\/consume/);
assert.doesNotMatch(resolverSource,/resolveCredential|materializeToken|buildAuthorizedClient|providerClient/i);
assert.match(routeSource,/mode:principalContext\.isAdmin[^\n]+:\s*"preview"/);

console.log("dynamic container authority runtime tests passed");
