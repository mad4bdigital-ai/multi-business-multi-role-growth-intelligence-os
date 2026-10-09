// Governed Recovery Orchestrator v1: server-owned adapters only.
// This is NOT an alternative Production activation path. No implicit executors,
// authorization issuers, stores, leases, or browser/Hostinger/SQL mutations.
import {createHash} from "node:crypto";

export const RECOVERY_ORCHESTRATOR_CONTRACT="mad4b.recovery-orchestrator.v1";
const SHA=/^[0-9a-f]{40}$/u;
const HASH=/^[0-9a-f]{64}$/u;
const KEY=/^[a-z][a-z0-9_.:-]{2,127}$/u;
const SAFE_ID=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{2,127}$/u;
const ENVIRONMENTS=new Set(["local_windows","staging","production"]);
const RISK=new Set(["read_only","bounded_mutation","high_impact"]);
const FORBIDDEN_FIELDS=/(?:password|secret|token|credential|authorization|private.key|connection.string|raw.sql|shell|command|api.key)/iu;
const PLAN_TTL_MS=5*60*1000;

function refuse(code,status=409) {
  throw Object.assign(new Error(code),{code,status,secrets_included:false});
}
const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
function only(value,allowed,code="recovery_orchestrator_input_invalid") {
  if(!object(value)||Object.keys(value).some(k=>!allowed.includes(k)))refuse(code,400);
  return value;
}
function requireText(value,pattern,code) {
  if(typeof value!=="string"||!pattern.test(value))refuse(code,400);
  return value;
}
function stable(value) {
  if(Array.isArray(value))return value.map(stable);
  if(!object(value))return value;
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
}
const sha256=value=>createHash("sha256").update(JSON.stringify(stable(value)),"utf8").digest("hex");
const copy=value=>JSON.parse(JSON.stringify(value));
function noSecrets(value,depth=0) {
  if(depth>12)refuse("recovery_orchestrator_data_too_deep",400);
  if(Array.isArray(value))return value.forEach(x=>noSecrets(x,depth+1));
  if(!object(value))return;
  for(const [key,part] of Object.entries(value)) {
    // Explicit false confidentiality attestations are safe metadata, not
    // credential content. Never allow the flag to be true or a string.
    if(key==="secrets_included" && part===false)continue;
    if(FORBIDDEN_FIELDS.test(key)||key==="__proto__"||key==="constructor"||key==="prototype")
      refuse("recovery_orchestrator_sensitive_or_unsafe_field",400);
    noSecrets(part,depth+1);
  }
}
function trustedScope(binding) {
  only(binding,["tenant_id","resource_id","resource_fingerprint","environment","source_sha","issuer"],"recovery_orchestrator_binding_invalid");
  const environment=requireText(binding.environment,/^(staging|production|local_windows)$/u,"recovery_orchestrator_environment_invalid");
  const tenant_id=requireText(binding.tenant_id,SAFE_ID,"recovery_orchestrator_tenant_missing");
  const resource_id=requireText(binding.resource_id,SAFE_ID,"recovery_orchestrator_resource_missing");
  const resource_fingerprint=requireText(binding.resource_fingerprint,HASH,"recovery_orchestrator_resource_fingerprint_missing");
  const source_sha=requireText(binding.source_sha,SHA,"recovery_orchestrator_source_missing");
  const issuer=requireText(binding.issuer,KEY,"recovery_orchestrator_binding_issuer_missing");
  return Object.freeze({tenant_id,resource_id,resource_fingerprint,environment,source_sha,issuer});
}
function descriptor(item) {
  only(item,["id","provider_id","resource_kind","environments","operations","inspect","execute"],"recovery_orchestrator_adapter_fields_invalid");
  const id=requireText(item.id,KEY,"recovery_orchestrator_adapter_id_invalid");
  const provider_id=requireText(item.provider_id,KEY,"recovery_orchestrator_provider_invalid");
  const resource_kind=requireText(item.resource_kind,KEY,"recovery_orchestrator_resource_kind_invalid");
  if(!Array.isArray(item.environments)||!item.environments.length||
    item.environments.some(x=>!ENVIRONMENTS.has(x))||
    new Set(item.environments).size!==item.environments.length)
    refuse("recovery_orchestrator_adapter_environment_invalid",400);
  if(!Array.isArray(item.operations)||!item.operations.length||item.operations.length>32)
    refuse("recovery_orchestrator_operations_invalid",400);
  const keys=new Set();
  const operations=item.operations.map(op=>{
    only(op,["key","risk","requires_independent_readback"],"recovery_orchestrator_operation_fields_invalid");
    const key=requireText(op.key,KEY,"recovery_orchestrator_operation_invalid");
    if(keys.has(key)||!RISK.has(op.risk)||op.requires_independent_readback!==true)
      refuse("recovery_orchestrator_operation_contract_invalid",400);
    keys.add(key);
    return Object.freeze({key,risk:op.risk,requires_independent_readback:true});
  });
  if(typeof item.inspect!=="function"||
      (operations.some(op=>op.risk!=="read_only")&&typeof item.execute!=="function"))
    refuse("recovery_orchestrator_adapter_methods_missing",503);
  const publicDescriptor=Object.freeze({id,provider_id,resource_kind,
    environments:Object.freeze([...item.environments]),
    operations:Object.freeze(operations),
    credential_intake:"server_managed_only",default_execution_enabled:false,
    production_execution_enabled:false,secrets_included:false});
  return Object.freeze({publicDescriptor,inspect:item.inspect,execute:item.execute||null});
}
export function createRecoveryCapabilityRegistry(adapters=[]) {
  if(!Array.isArray(adapters)||adapters.length>64)refuse("recovery_orchestrator_registry_invalid",400);
  const entries=new Map();
  for(const candidate of adapters) {
    const entry=descriptor(candidate);
    if(entries.has(entry.publicDescriptor.id))refuse("recovery_orchestrator_duplicate_capability",409);
    entries.set(entry.publicDescriptor.id,entry);
  }
  return Object.freeze({
    contract:"mad4b.recovery-capability-registry.v1",
    list:()=>[...entries.values()].map(v=>v.publicDescriptor),
    lookup:id=>entries.get(id)||null,
    mutation_authority_available:false,
    production_mutation_enabled:false,
  });
}
function validateStore(store,method) {
  if(!object(store)||typeof store[method]!=="function")
    refuse("recovery_orchestrator_durable_store_unavailable",503);
  // Match the existing Recovery Composition durable-store provenance contract.
  // Shape flags alone are not native certification: the server composition
  // must additionally attest and independently test its backing implementation.
  if(store.recovery_store_contract!=="mad4b.recovery-durable-store.v1"||
     store.independent_of_target_databases!==true||
     store.shared_replica_safe!==true||
     store.payload_integrity_verified_on_read!==true||
     store.target_database_binding!=="forbidden")
    refuse("recovery_orchestrator_durable_store_authority_unverified",503);
}
function verifyPlan(plan) {
  if(!object(plan)||plan.contract!=="mad4b.recovery-orchestrator-plan.v1")
    refuse("recovery_orchestrator_plan_missing",404);
  const {plan_hash,...unsigned}=plan;
  if(typeof plan_hash!=="string"||!HASH.test(plan_hash)||sha256(unsigned)!==plan_hash||
    plan.plan_id!=="plan:"+plan_hash.slice(0,32))
    refuse("recovery_orchestrator_plan_tampered",409);
  noSecrets(plan);
  return plan;
}
export async function planRecovery({capability_id,operation}={},{
  registry,store,binding,now=Date.now(),
}={}) {
  only({capability_id,operation},["capability_id","operation"]);
  if(!registry||typeof registry.lookup!=="function")refuse("recovery_orchestrator_registry_missing",503);
  validateStore(store,"putPlan");
  validateStore(store,"getPlan");
  if(!Number.isSafeInteger(now))refuse("recovery_orchestrator_clock_invalid",503);
  const scope=trustedScope(binding);
  const entry=registry.lookup(requireText(capability_id,KEY,"recovery_orchestrator_capability_unknown"));
  if(!entry)refuse("recovery_orchestrator_capability_unknown",404);
  if(!entry.publicDescriptor.environments.includes(scope.environment))
    refuse("recovery_orchestrator_capability_environment_mismatch",403);
  const declared=entry.publicDescriptor.operations.find(x=>x.key===operation);
  if(!declared)refuse("recovery_orchestrator_operation_not_supported",403);
  const observed=await entry.inspect({binding:scope,operation});
  if(!object(observed)||observed.read_only!==true||observed.mutation_performed!==false||
     observed.secrets_included!==false||typeof observed.state_fingerprint!=="string"||
     !HASH.test(observed.state_fingerprint))
    refuse("recovery_orchestrator_inspection_unverified",409);
  // Do not store arbitrary provider output; only the server-owned bounded digest.
  const base={
    contract:"mad4b.recovery-orchestrator-plan.v1",
    capability_id,operation,risk:declared.risk,provider_id:entry.publicDescriptor.provider_id,
    resource_kind:entry.publicDescriptor.resource_kind,
    capability_descriptor_sha256:sha256(entry.publicDescriptor),
    binding:{...scope},
    observed_state_fingerprint:observed.state_fingerprint,
    created_at_ms:now,expires_at_ms:now+PLAN_TTL_MS,
    execution_allowed:false,production_execution_allowed:false,
    secrets_included:false,
  };
  const plan_hash=sha256(base);
  const plan=Object.freeze({...base,plan_id:"plan:"+plan_hash.slice(0,32),plan_hash});
  // Hash must bind the ID to an immutable plan with no circular dependency.
  const stored=await store.putPlan(copy(plan));
  if(stored?.durable!==true||stored?.plan_hash!==plan_hash)
    refuse("recovery_orchestrator_plan_persistence_unverified",503);
  const confirmed=assertPlan(await store.getPlan(plan.plan_id));
  if(confirmed.plan_hash!==plan_hash)
    refuse("recovery_orchestrator_plan_readback_mismatch",503);
  return plan;
}
function assertPlan(plan) {
  if(!object(plan)||plan.contract!=="mad4b.recovery-orchestrator-plan.v1")refuse("recovery_orchestrator_plan_missing",404);
  const {plan_hash,plan_id,...unsigned}=plan;
  if(!HASH.test(String(plan_hash))||sha256(unsigned)!==plan_hash||plan_id!=="plan:"+plan_hash.slice(0,32))
    refuse("recovery_orchestrator_plan_tampered",409);
  trustedScope(plan.binding);
  noSecrets(plan);
  return plan;
}
function assertReceipt(receipt,plan) {
  if(!object(receipt)||receipt.independent_of_executor!==true||
     receipt.readback_verified!==true||receipt.postconditions_passed!==true||
     receipt.plan_hash!==plan.plan_hash||
     receipt.source_sha!==plan.binding.source_sha||
     receipt.environment!==plan.binding.environment||
     receipt.resource_fingerprint!==plan.binding.resource_fingerprint||
     receipt.tenant_id!==plan.binding.tenant_id||
     receipt.resource_id!==plan.binding.resource_id||
     !KEY.test(String(receipt.verifier_id||""))||
     !HASH.test(String(receipt.evidence_sha256||""))||
     receipt.secrets_included!==false)
    refuse("recovery_orchestrator_independent_readback_unverified",409);
}
function assertProof(proof,plan) {
  if(!object(proof)||proof.approved!==true||proof.plan_hash!==plan.plan_hash||
     proof.source_sha!==plan.binding.source_sha||
     proof.environment!==plan.binding.environment||
     proof.resource_fingerprint!==plan.binding.resource_fingerprint||
     proof.tenant_id!==plan.binding.tenant_id||
     proof.resource_id!==plan.binding.resource_id||
     proof.single_use!==true||proof.secrets_included!==false)
    refuse("recovery_orchestrator_approval_binding_invalid",403);
}
const safeStatus=(state,plan)=>Object.freeze({contract:RECOVERY_ORCHESTRATOR_CONTRACT,
  status:state,plan_id:plan.plan_id,plan_hash:plan.plan_hash,
  production_mutation_authorized:false,secrets_included:false});
export async function executeRecovery({plan_id,plan_hash}={},{
  registry,store,binding,mode="disabled",approvalVerifier,lease,evidenceVerifier,now=Date.now(),
}={}) {
  only({plan_id,plan_hash},["plan_id","plan_hash"]);
  if(mode!=="staging")refuse("recovery_orchestrator_execution_disabled",403);
  if(!registry||typeof registry.lookup!=="function")refuse("recovery_orchestrator_registry_missing",503);
  for(const method of ["getPlan","claimStep","appendIntent","getIntent","markUnknown","finishStep"])
    validateStore(store,method);
  if(typeof approvalVerifier?.verify!=="function"||
     typeof lease?.acquire!=="function"||typeof lease?.assertFence!=="function"||
     typeof lease?.release!=="function"||typeof evidenceVerifier?.verify!=="function")
    refuse("recovery_orchestrator_execution_authorities_missing",503);
  const current=trustedScope(binding);
  if(current.environment!=="staging")refuse("recovery_orchestrator_production_execution_forbidden",403);
  const plan=assertPlan(await store.getPlan(plan_id));
  if(plan.plan_id!==plan_id||plan.plan_hash!==plan_hash)
    refuse("recovery_orchestrator_plan_reference_mismatch",409);
  if(!Number.isSafeInteger(now)||now<plan.created_at_ms||now>=plan.expires_at_ms)
    refuse("recovery_orchestrator_plan_expired",409);
  if(Object.keys(current).some(k=>current[k]!==plan.binding[k]))
    refuse("recovery_orchestrator_scope_drift",409);
  const entry=registry.lookup(plan.capability_id);
  const op=entry?.publicDescriptor?.operations?.find(o=>o.key===plan.operation);
  if(!entry||!op||op.risk==="read_only"||typeof entry.execute!=="function")
    refuse("recovery_orchestrator_execution_capability_unavailable",403);
  if(!entry.publicDescriptor.environments.includes("staging"))
    refuse("recovery_orchestrator_capability_environment_mismatch",403);
  if(plan.capability_descriptor_sha256!==sha256(entry.publicDescriptor)||
     plan.risk!==op.risk||
     plan.provider_id!==entry.publicDescriptor.provider_id||
     plan.resource_kind!==entry.publicDescriptor.resource_kind)
    refuse("recovery_orchestrator_adapter_changed_since_plan",409);
  // Re-inspect the exact resource before any authority is consumed or external
  // change attempted: a cached plan is not a stale-resource mutation ticket.
  const fresh=await entry.inspect({binding:current,operation:plan.operation});
  if(!object(fresh)||fresh.read_only!==true||fresh.mutation_performed!==false||
     fresh.secrets_included!==false||
     fresh.state_fingerprint!==plan.observed_state_fingerprint)
    refuse("recovery_orchestrator_resource_state_drift",409);
  const proof=await approvalVerifier.verify({plan:copy(plan),scope:current});
  assertProof(proof,plan);
  const lock=await lease.acquire({plan_id,plan_hash,scope:current});
  if(!object(lock)||lock.acquired!==true||
     !SAFE_ID.test(String(lock.fence_token||"")))
    refuse("recovery_orchestrator_fenced_lease_missing",409);
  let dispatched=false;
  try {
    const claimed=await store.claimStep({plan_id,plan_hash,fence_token:lock.fence_token});
    if(claimed?.claimed!==true||claimed?.durable!==true)
      refuse("recovery_orchestrator_atomic_claim_denied",409);
    const immutableIntent={
      contract:"mad4b.recovery-intent.v1",plan_id,plan_hash,
      fence_token:lock.fence_token,source_sha:current.source_sha,
      environment:current.environment,tenant_id:current.tenant_id,
      resource_id:current.resource_id,
    };
    const intentHash=sha256(immutableIntent);
    const intent=await store.appendIntent({...immutableIntent,intent_hash:intentHash});
    if(intent?.durable!==true||intent?.plan_hash!==plan_hash||
       intent?.intent_hash!==intentHash||
       !HASH.test(String(intent?.evidence_sha256||"")))
      refuse("recovery_orchestrator_intent_not_durable",503);
    const storedIntent=await store.getIntent({plan_id,plan_hash,fence_token:lock.fence_token});
    if(storedIntent?.durable!==true||storedIntent?.commit_state!=="committed"||
       storedIntent?.plan_hash!==plan_hash||
       storedIntent?.intent_hash!==intentHash||
       storedIntent?.evidence_sha256!==intent.evidence_sha256||
       storedIntent?.fence_token!==lock.fence_token)
      refuse("recovery_orchestrator_intent_readback_unverified",503);
    const fence=await lease.assertFence({plan_id,fence_token:lock.fence_token});
    if(fence?.valid!==true)refuse("recovery_orchestrator_fence_lost",409);
    // No user-supplied endpoint, SQL, command, token, or provider credential.
    dispatched=true;
    const execution=await entry.execute({plan:copy(plan),fence_token:lock.fence_token,
      intent_evidence_sha256:intent.evidence_sha256});
    // The verifier is a separately injected server authority, NEVER adapter.execute.
    const receipt=await evidenceVerifier.verify({plan:copy(plan),execution});
    assertReceipt(receipt,plan);
    const final=await store.finishStep({plan_id,plan_hash,
      fence_token:lock.fence_token,evidence_sha256:receipt.evidence_sha256,
      status:"recovered"});
    if(final?.durable!==true||final?.status!=="recovered")
      refuse("recovery_orchestrator_finalization_unverified",503);
    return safeStatus("recovered",plan);
  }catch(error){
    if(dispatched){
      try {
        // CAS against executing prevents downgrading an already-completed
        // Recovery after a lost finalization acknowledgement.
        const recorded=await store.markUnknown({plan_id,plan_hash,
          fence_token:lock.fence_token,expected_status:"executing",
          status:"execution_outcome_unknown",retry_forbidden:true});
        if(recorded?.durable!==true||recorded?.status!=="execution_outcome_unknown")
          refuse("recovery_orchestrator_unknown_state_persistence_failed",503);
      }catch{refuse("recovery_orchestrator_unknown_state_persistence_failed",503);}
      return safeStatus("execution_outcome_unknown",plan);
    }
    throw error;
  }finally{
    try{await lease.release({plan_id,fence_token:lock.fence_token});}catch{/* release failure cannot confer authority */}
  }
}
export async function reconcileRecovery({plan_id,plan_hash}={},{
  store,registry,binding,evidenceVerifier,now=Date.now(),
}={}) {
  only({plan_id,plan_hash},["plan_id","plan_hash"]);
  for(const name of ["getPlan","getStep","finishReconciliation"])validateStore(store,name);
  if(typeof evidenceVerifier?.verify!=="function")refuse("recovery_orchestrator_verifier_missing",503);
  const scope=trustedScope(binding);
  if(scope.environment!=="staging")
    refuse("recovery_orchestrator_production_reconciliation_forbidden",403);
  const plan=assertPlan(await store.getPlan(plan_id));
  if(plan.plan_hash!==plan_hash||plan.plan_id!==plan_id)refuse("recovery_orchestrator_plan_reference_mismatch",409);
  if(Object.keys(scope).some(k=>scope[k]!==plan.binding[k]))
    refuse("recovery_orchestrator_scope_drift",409);
  const step=await store.getStep({plan_id,plan_hash});
  if(step?.status!=="execution_outcome_unknown"||step?.retry_forbidden!==true)
    refuse("recovery_orchestrator_reconciliation_state_invalid",409);
  const receipt=await evidenceVerifier.verify({plan:copy(plan),reconciliation:true});
  assertReceipt(receipt,plan);
  const done=await store.finishReconciliation({plan_id,plan_hash,expected_status:"execution_outcome_unknown",
    evidence_sha256:receipt.evidence_sha256,status:"recovered"});
  if(done?.durable!==true||done?.status!=="recovered")
    refuse("recovery_orchestrator_reconciliation_not_durable",503);
  return safeStatus("recovered",plan);
}
