// frontend-surface-operation: POST /platform/remote-runtime/hosting/recovery-allowlist/discover
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateHostingerRecoveryCapabilities, discoverHostingerRecoveryCapabilities } from "./hostingerRecoveryCapabilityDiscovery.js";

const target=()=>({
  target_id:"target-1",plugin_key:"remote_ssh_runtime",provider_family:"hostinger",
  connector_family:"hostinger_ssh",registered_environment:"production",registered_system_status:"active",status:"active",
  validation_status:"valid",command_allowlist_json:JSON.stringify([
    "status","hostinger_recovery_database_inventory",
    "hostinger_recovery_database_create",
    "hostinger_recovery_environment_binding_apply"]),
});
const commands=()=>[
  {command_key:"hostinger_recovery_database_inventory",status:"planned",requires_approval:1},
  {command_key:"hostinger_recovery_database_create",status:"planned",requires_approval:1},
  {command_key:"hostinger_recovery_environment_binding_apply",status:"planned",requires_approval:1},
];
function rejects(fn,code) { assert.throws(fn,error=>error.code===code); }
test("discovery never infers execution from an active SSH account or target allowlist",()=>{
  const result=evaluateHostingerRecoveryCapabilities({target:target(),commands:commands(),environment:"production"});
  assert.equal(result.commands.length,3);
  assert(result.commands.every(x=>x.execution_allowed===false && x.dispatch_ready===false));
  assert.equal(result.ssh_used,false);assert.equal(result.mutation_performed,false);
  assert.equal(result.secrets_included,false);
  assert(result.commands.every(x=>x.plan_allowed===false));
  assert.equal(result.commands.find(x=>x.command_key==="hostinger_recovery_database_create").plan_allowed,false);
});
test("inactive target or planned command is not promoted by presence of credential binding",()=>{
  const t={...target(),status:"planned",validation_status:"pending_configuration"};
  const result=evaluateHostingerRecoveryCapabilities({target:t,commands:commands(),environment:"production"});
  assert(result.commands.every(x=>x.prerequisites.includes("validated_live_target_and_system")));
  assert(result.commands.every(x=>x.prerequisites.includes("catalog_activation_after_certification")));
});
test("tenant, provider and environment crossings fail closed",()=>{
  rejects(()=>evaluateHostingerRecoveryCapabilities({target:{...target(),connector_family:"other"},
    commands:commands(),environment:"production"}),"recovery_target_provider_mismatch");
  rejects(()=>evaluateHostingerRecoveryCapabilities({target:target(),commands:commands(),
    environment:"development"}),"recovery_environment_mismatch");
  rejects(()=>evaluateHostingerRecoveryCapabilities({target:target(),commands:commands(),
    environment:"unknown"}),"recovery_environment_invalid");
});
test("unknown and duplicate registry rows never create new execution authority",()=>{
  const xs=[...commands(),commands()[0],{command_key:"shell",status:"active"},
    {command_key:"hostinger_recovery_unsafe",status:"active"}];
  const out=evaluateHostingerRecoveryCapabilities({target:target(),commands:xs,environment:"production"});
  assert.equal(out.commands.filter(x=>x.command_key==="hostinger_recovery_database_inventory").length,1);
  assert(!out.commands.some(x=>x.command_key==="shell"));
  assert(out.commands.every(x=>x.execution_allowed===false));
  assert.equal(out.commands.find(x=>x.command_key==="hostinger_recovery_unsafe").target_allowlisted,false);
});
test("inventory rejects ambiguous targets and scoped database errors",async()=>{
  const db={query:async(sql,params)=>[sql.includes("FROM remote_runtime_targets")
    ? [target(),target()] : commands()]};
  await assert.rejects(discoverHostingerRecoveryCapabilities({targetId:"target-1",pool:db}),
    e=>e.code==="recovery_target_not_found_or_ambiguous");
  await assert.rejects(discoverHostingerRecoveryCapabilities({
    targetId:"target-1",pool:{query:async()=>{throw Error("db offline");}}}),/db offline/);
});
test("command discovery reads metadata only and returns no SQL templates or secret values",async()=>{
  const calls=[];
  const db={query:async(sql,params)=>{calls.push({sql,params});
    return [sql.includes("FROM remote_runtime_targets")?[target()]:commands()];}};
  const result=await discoverHostingerRecoveryCapabilities({targetId:"target-1",pool:db});
  assert.equal(calls.length,2);
  assert.deepEqual(calls[0].params,["target-1"]);
  assert(calls.every(c=>c.sql.trim().startsWith("SELECT")));
  assert(!JSON.stringify(result).includes("command_template"));
  assert(!JSON.stringify(result).includes("cf_token"));
});
test("migration adds planned capabilities only and does not widen SSH shell execution",()=>{
  const sql=readFileSync(new URL("./migrations/20261009_hostinger_recovery_allowlist_discovery.sql",
    import.meta.url),"utf8");
  assert(sql.includes("'planned'"));
  assert(sql.includes("status IN")===false);
  assert(!/UPDATE\s+remote_runtime_command_allowlists\s+SET\s+status\s*=\s*'active'/i.test(sql));
  assert(sql.includes("is_enabled=0"));
  assert(!/UPDATE remote_runtime_targets/i.test(sql),
    "Catalog-only migration must never pre-authorize target command allowlist writes");
  assert(!/freeform_command|raw_sql_execute/i.test(sql));
});

test("inactive Hostinger connected-system cannot be treated as a ready planner",()=>{
  const out=evaluateHostingerRecoveryCapabilities({target:{...target(),registered_system_status:"disabled"},
    commands:commands(),environment:"production"});
  assert(out.commands.every(x=>x.plan_allowed===false));
  assert(out.commands.every(x=>x.discovery_ready===false && x.plan_candidate===false));
  assert(out.commands.every(x=>x.prerequisites.includes("validated_live_target_and_system")));
});
