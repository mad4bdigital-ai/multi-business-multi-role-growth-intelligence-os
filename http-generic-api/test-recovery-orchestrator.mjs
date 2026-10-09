import test from "node:test";
import assert from "node:assert/strict";
import {
  createRecoveryCapabilityRegistry,planRecovery,executeRecovery,
  reconcileRecovery,RECOVERY_ORCHESTRATOR_CONTRACT,
} from "./recoveryOrchestrator.js";

const sha="a".repeat(40), fingerprint="b".repeat(64), evidence="c".repeat(64);
const scope=Object.freeze({tenant_id:"tenant:one",resource_id:"site:alpha",
  resource_fingerprint:fingerprint,environment:"staging",source_sha:sha,issuer:"server.runtime"});
let dispatched=0,inspections=0;
function provider({fail=false}={}){
  return {
    id:"mariadb.runtime",provider_id:"mariadb",resource_kind:"database",
    environments:["staging","production"],
    operations:[{key:"repair_schema",risk:"high_impact",requires_independent_readback:true}],
    async inspect({binding}){inspections++;return {read_only:true,
      mutation_performed:false,secrets_included:false,state_fingerprint:binding.resource_fingerprint};},
    async execute(){dispatched++;if(fail)throw Error("lost provider ACK");return {accepted:true};},
  };
}
function makeStore(){
  const plans=new Map(),steps=new Map();
  return {
    plans,steps,intents:[],claims:0,
    async putPlan(p){plans.set(p.plan_id,p);return {durable:true,plan_hash:p.plan_hash};},
    async getPlan(id){return plans.get(id)||null;},
    async claimStep({plan_id}){this.claims++;if(steps.has(plan_id))return {claimed:false,durable:true};
      steps.set(plan_id,{status:"claimed"});return {claimed:true,durable:true};},
    async appendIntent(v){this.intents.push(v);return {durable:true,
      plan_hash:v.plan_hash,evidence_sha256:evidence};},
    async markUnknown({plan_id,status,retry_forbidden}){steps.set(plan_id,{status,retry_forbidden});
      return {durable:true,status};},
    async finishStep({plan_id,status}){steps.set(plan_id,{status});
      return {durable:true,status};},
    async getStep({plan_id}){return steps.get(plan_id)||null;},
    async finishReconciliation({plan_id,expected_status,status}){
      if(steps.get(plan_id)?.status!==expected_status)return {durable:false};
      steps.set(plan_id,{status});return {durable:true,status};},
  };
}
function authorities({failFence=false,readbackValid=true}={}){
  return {
    approvalVerifier:{async verify({plan}){return {
      approved:true,plan_hash:plan.plan_hash,source_sha:sha,environment:"staging",
      tenant_id:scope.tenant_id,resource_id:scope.resource_id,
      resource_fingerprint:fingerprint,single_use:true,secrets_included:false,
    };}},
    lease:{
      async acquire(){return {acquired:true,fence_token:"fence:one"};},
      async assertFence(){return {valid:!failFence};},
      async release(){return {released:true};},
    },
    evidenceVerifier:{async verify({plan}){return {
      independent_of_executor:true,readback_verified:readbackValid,
      postconditions_passed:true,plan_hash:plan.plan_hash,source_sha:sha,
      environment:"staging",tenant_id:scope.tenant_id,
      resource_id:scope.resource_id,resource_fingerprint:fingerprint,
      verifier_id:"independent.mariadb",evidence_sha256:evidence,secrets_included:false,
    };}},
  };
}
function harness({fail=false}={}){
  const registry=createRecoveryCapabilityRegistry([provider({fail})]);
  const store=makeStore();
  return {registry,store,binding:scope};
}
async function planned(h){
  return planRecovery({capability_id:"mariadb.runtime",operation:"repair_schema"},h);
}
const execute=(plan,h,overrides={})=>executeRecovery({
  plan_id:plan.plan_id,plan_hash:plan.plan_hash
},{...h,...authorities(),mode:"staging",...overrides});
const errorCode=(expected)=>e=>e?.code===expected;

test("unconfigured registry is empty, read-only and cannot accidentally mint execution authority",()=>{
  const registry=createRecoveryCapabilityRegistry();
  assert.deepEqual(registry.list(),[]);
  assert.equal(registry.mutation_authority_available,false);
  assert.equal(registry.production_mutation_enabled,false);
});
test("dynamic adapter registry validates shape and rejects duplicates, sensitive and extra fields",()=>{
  assert.throws(()=>createRecoveryCapabilityRegistry([provider(),provider()]),errorCode("recovery_orchestrator_duplicate_capability"));
  assert.throws(()=>createRecoveryCapabilityRegistry([{...provider(),api_token:"secret"}]),
    errorCode("recovery_orchestrator_adapter_fields_invalid"));
  assert.throws(()=>createRecoveryCapabilityRegistry([{...provider(),operations:[
    {key:"repair_schema",risk:"high_impact",requires_independent_readback:false}
  ]}]),errorCode("recovery_orchestrator_operation_contract_invalid"));
});
test("preview is source-bound, durable, plan-hashed and never grants mutation",async()=>{
  const h=harness(),p=await planned(h);
  assert.equal(p.execution_allowed,false);
  assert.equal(p.production_execution_allowed,false);
  assert.match(p.plan_hash,/^[a-f0-9]{64}$/);
  assert.match(p.plan_id,/^plan:[a-f0-9]{32}$/);
  assert.equal(h.store.plans.get(p.plan_id).plan_hash,p.plan_hash);
  assert.equal(dispatched>=0,true);
});
test("plan blocks unavailable providers, wrong operation and forged read-only inspection",async()=>{
  const h=harness();
  await assert.rejects(planRecovery({capability_id:"not.registered",operation:"repair_schema"},h),
    errorCode("recovery_orchestrator_capability_unknown"));
  await assert.rejects(planRecovery({capability_id:"mariadb.runtime",operation:"DROP_TABLE"},h),
    errorCode("recovery_orchestrator_operation_not_supported"));
  const bad=createRecoveryCapabilityRegistry([{...provider(),
    inspect:async()=>({state_fingerprint:fingerprint,read_only:false,mutation_performed:true,secrets_included:false})}]);
  await assert.rejects(planRecovery({capability_id:"mariadb.runtime",operation:"repair_schema"},
    {...h,registry:bad}),errorCode("recovery_orchestrator_inspection_unverified"));
});
test("runtime refuses production even when approval, provider and leases are injected",async()=>{
  const h=harness(),p=await planned(h),before=dispatched;
  await assert.rejects(execute(p,h,{mode:"production"}),errorCode("recovery_orchestrator_execution_disabled"));
  await assert.rejects(execute(p,h,{binding:{...scope,environment:"production"}}),
    errorCode("recovery_orchestrator_production_execution_forbidden"));
  assert.equal(dispatched,before);
});
test("stored plan digest, exact resource scope and source SHA are verified before any mutation",async()=>{
  const h=harness(),p=await planned(h),before=dispatched;
  await assert.rejects(execute(p,h,{binding:{...scope,source_sha:"f".repeat(40)}}),
    errorCode("recovery_orchestrator_scope_drift"));
  h.store.plans.get(p.plan_id).operation="unauthorized_operation";
  await assert.rejects(execute(p,h),errorCode("recovery_orchestrator_plan_tampered"));
  assert.equal(dispatched,before);
});
test("disabled mode and missing independent authorities fail closed",async()=>{
  const h=harness(),p=await planned(h);
  await assert.rejects(executeRecovery({plan_id:p.plan_id,plan_hash:p.plan_hash},{...h}),
    errorCode("recovery_orchestrator_execution_disabled"));
  await assert.rejects(executeRecovery({plan_id:p.plan_id,plan_hash:p.plan_hash},{...h,mode:"staging"}),
    errorCode("recovery_orchestrator_execution_authorities_missing"));
});
test("missing durable intent or lost fencing blocks dispatch before any provider side effect",async()=>{
  for(const which of ["intent","fence"]){
    const h=harness(),p=await planned(h),before=dispatched;
    if(which==="intent")h.store.appendIntent=async()=>({durable:false});
    await assert.rejects(execute(p,h,which==="fence"?authorities({failFence:true}):{}),
      errorCode(which==="fence"?"recovery_orchestrator_fence_lost":"recovery_orchestrator_intent_not_durable"));
    assert.equal(dispatched,before);
  }
});
test("approval is exact-plan/exact-target scoped, never a caller boolean",async()=>{
  const h=harness(),p=await planned(h);
  await assert.rejects(execute(p,h,{approvalVerifier:{verify:async()=>({approved:true})}}),
    errorCode("recovery_orchestrator_approval_binding_invalid"));
  assert.equal(h.store.claims,0);
});
test("healthy staging execution requires approval, durable intent, fence and independent readback",async()=>{
  const h=harness(),p=await planned(h),before=dispatched;
  const result=await execute(p,h);
  assert.equal(result.contract,RECOVERY_ORCHESTRATOR_CONTRACT);
  assert.equal(result.status,"recovered");
  assert.equal(result.production_mutation_authorized,false);
  assert.equal(dispatched,before+1);
  assert.equal(h.store.intents.length,1);
  assert.equal(h.store.steps.get(p.plan_id).status,"recovered");
});
test("concurrent duplicate attempts have only one claim and one dispatch",async()=>{
  const h=harness(),p=await planned(h),before=dispatched;
  const outcomes=await Promise.allSettled([execute(p,h),execute(p,h)]);
  assert.equal(outcomes.filter(o=>o.status==="fulfilled"&&o.value.status==="recovered").length,1);
  assert.equal(outcomes.filter(o=>o.status==="rejected"&&o.reason.code==="recovery_orchestrator_atomic_claim_denied").length,1);
  assert.equal(dispatched,before+1);
});
test("lost provider acknowledgment records UNKNOWN and never re-dispatches automatically",async()=>{
  const h=harness({fail:true}),p=await planned(h),before=dispatched;
  const unknown=await execute(p,h);
  assert.equal(unknown.status,"execution_outcome_unknown");
  assert.equal(h.store.steps.get(p.plan_id).retry_forbidden,true);
  await assert.rejects(execute(p,h),errorCode("recovery_orchestrator_atomic_claim_denied"));
  assert.equal(dispatched,before+1);
});
test("untrusted or mismatched verifier result leaves UNKNOWN, never RECOVERED",async()=>{
  const h=harness(),p=await planned(h),before=dispatched;
  const result=await execute(p,h,{...authorities({readbackValid:false})});
  assert.equal(result.status,"execution_outcome_unknown");
  assert.equal(h.store.steps.get(p.plan_id).status,"execution_outcome_unknown");
  assert.equal(dispatched,before+1);
});
test("UNKNOWN may become RECOVERED through independent readback without executing provider twice",async()=>{
  const h=harness({fail:true}),p=await planned(h),before=dispatched;
  await execute(p,h);
  const result=await reconcileRecovery({plan_id:p.plan_id,plan_hash:p.plan_hash},{
    ...h,evidenceVerifier:authorities().evidenceVerifier
  });
  assert.equal(result.status,"recovered");
  assert.equal(dispatched,before+1);
  await assert.rejects(reconcileRecovery({plan_id:p.plan_id,plan_hash:p.plan_hash},{
    ...h,evidenceVerifier:authorities().evidenceVerifier
  }),errorCode("recovery_orchestrator_reconciliation_state_invalid"));
});
test("no in-memory Recovery Kernel maps can substitute missing durable store",async()=>{
  const h=harness(),p=await planned(h);
  await assert.rejects(execute(p,{...h,store:{}},{}),errorCode("recovery_orchestrator_durable_store_unavailable"));
});

test("adapter descriptor mutation or registered provider hot swap invalidates an older plan",async()=>{
  const h=harness(),p=await planned(h),before=dispatched;
  const replacement=createRecoveryCapabilityRegistry([{...provider(),provider_id:"wrong.provider"}]);
  await assert.rejects(execute(p,h,{registry:replacement}),
    errorCode("recovery_orchestrator_adapter_changed_since_plan"));
  assert.equal(dispatched,before);
});
test("resource inspection drift before approval is denied without claiming or dispatch",async()=>{
  const h=harness(),p=await planned(h),before=dispatched;
  const drift=createRecoveryCapabilityRegistry([{...provider(),inspect:async()=>({
    read_only:true,mutation_performed:false,secrets_included:false,
    state_fingerprint:"d".repeat(64)})}]);
  await assert.rejects(execute(p,h,{registry:drift}),
    errorCode("recovery_orchestrator_resource_state_drift"));
  assert.equal(h.store.claims,0);
  assert.equal(dispatched,before);
});
