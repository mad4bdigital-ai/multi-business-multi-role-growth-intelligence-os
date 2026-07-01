import assert from "node:assert/strict";
import {
  acquireRepositoryOperationLease, assertRepositoryOperationLease,
  releaseRepositoryOperationLease, repositoryLeaseResourceHash,
} from "./repositoryOperationLeaseService.js";
import { runRepositoryReconciliationOrchestrator } from "./repositoryReconciliationOrchestrator.js";

class Pool {
  constructor() {
    this.leases = [];
    this.recipe = { recipe_key:"repo.pr.reconcile_and_finalize", policy_json:"{}",
      status:"planned", requires_capability_envelope:1, requires_typed_confirmation:1,
      requires_same_cycle_readback:1 };
    this.steps = [{ step_order:10, step_key:"reconcile", step_kind:"installed_tool_call",
      tool_key:"admin_branch_reconcile", required:1, on_error_policy:"fail", status:"active" }];
  }
  async query(sql, params=[]) {
    const q=String(sql).replace(/\s+/g," ").trim();
    if (q.startsWith("UPDATE repository_operation_leases") && q.includes("expires_at<=?")) return [{affectedRows:0}];
    if (q.startsWith("INSERT INTO repository_operation_leases")) {
      if (this.leases.some((row)=>row.active_resource_sha256===params[10])) {
        const error=new Error("duplicate"); error.code="ER_DUP_ENTRY"; throw error;
      }
      this.leases.push({ lease_id:params[0],resource_uri:params[1],repository_owner:params[2],
        repository_name:params[3],branch_name:params[4],operation_key:params[5],
        holder_run_id:params[6],holder_actor_type:params[7],holder_actor_id:params[8],
        lease_mode:"exclusive_mutation",status:"active",resource_fingerprint:params[9],
        active_resource_sha256:params[10],acquired_at:params[11],renewed_at:params[12],expires_at:params[13] });
      return [{affectedRows:1}];
    }
    if (q.startsWith("SELECT lease_id") && q.includes("repository_operation_leases")) {
      return [[this.leases.find((row)=>row.status==="active" && row.active_resource_sha256===params[0])].filter(Boolean)];
    }
    if (q.startsWith("UPDATE repository_operation_leases") && q.includes("status='released'")) {
      const row=this.leases.find((item)=>item.lease_id===params[3] && item.holder_run_id===params[4]);
      if(row){row.status="released";row.active_resource_sha256=null;} return [{affectedRows:row?1:0}];
    }
    if(q.includes("FROM platform_resource_recipes")) return [[this.recipe]];
    if(q.includes("FROM platform_resource_recipe_steps")) return [this.steps];
    throw new Error(`Unexpected SQL: ${q.slice(0,100)}`);
  }
}
const now=new Date("2026-06-30T12:00:00Z"), pool=new Pool();
const lease={owner:"o",repo:"r",branch:"gpt/test",operation_key:"recipe",holder_run_id:"run-1",resource_fingerprint:"a".repeat(64)};
assert.equal(repositoryLeaseResourceHash(lease),repositoryLeaseResourceHash({...lease}));
await assert.rejects(()=>acquireRepositoryOperationLease({...lease,lease_mode:"shared_read"},{pool,now}),e=>e.code==="repository_lease_mode_invalid");
const acquired=await acquireRepositoryOperationLease(lease,{pool,now,randomUUID:()=>"lease-1"});
assert.equal(acquired.lease.lease_id,"lease-1");
assert.equal((await acquireRepositoryOperationLease(lease,{pool,now,randomUUID:()=>"lease-2"})).reused,true);
assert.equal((await assertRepositoryOperationLease(lease,{pool,now})).lease.holder_run_id,"run-1");
await assert.rejects(()=>acquireRepositoryOperationLease({...lease,holder_run_id:"run-2"},{pool,now}),e=>e.code==="repository_branch_lease_conflict");
assert.equal((await releaseRepositoryOperationLease({lease_id:"lease-1",holder_run_id:"run-1"},{pool,now})).released,true);

const args={owner:"o",repo:"r",branch:"gpt/test",pull_number:1980,
  expected_base_sha:"b".repeat(40),expected_branch_sha:"c".repeat(40),mode:"dry_run",operation_id:"operation-1"};
const result=await runRepositoryReconciliationOrchestrator(args,{pool,now,reconcileBranch:async()=>({
  classification:{classification:"diverged_same_files",ahead_by:1,behind_by:2,overlapping_files:["a.js"]},
  evidence:{base_ref_sha:"b".repeat(40),branch_ref_sha:"c".repeat(40)}})});
assert.equal(result.ok,true);
assert.equal(result.apply_allowed,false);
assert.equal(result.plan.plan.force_push_allowed,false);
assert.equal(result.plan.plan.migration_apply_allowed,false);
await assert.rejects(()=>runRepositoryReconciliationOrchestrator({...args,mode:"apply",
  capability_envelope_id:"e",approval_hold_id:"h"},{pool,now,reconcileBranch:async()=>({
    evidence:{base_ref_sha:"b".repeat(40),branch_ref_sha:"c".repeat(40)}})}),
  e=>e.code==="repository_reconciliation_recipe_not_active");
console.log("repository reconciliation lease and orchestrator tests passed");
