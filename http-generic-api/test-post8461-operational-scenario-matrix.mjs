import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,join} from "node:path";
import {previewHostingerRecoveryDatabase} from "./hostingerRecoveryReadOnlyPlanner.js";
import {classifyMcpCatalogRecoveryReadback} from "./mcpCatalogRecoveryDecision.js";
import {classifyAdminRecoveryReadback} from "./adminLocalConnectorTarget.js";
import {assessHostingerDatabaseCreate,assessHostingerNodeEnvReplacement} from "./hostingerRecoveryProviderContract.js";

const root=dirname(fileURLToPath(import.meta.url));
const scenarios=JSON.parse(readFileSync(join(root,"config/post8461-operational-scenario-matrix.json"),"utf8"));
const required=["hostinger","mcp","device","migration","policy","release"];
const ids=new Set();
const allowed=new Set(["blocked","read_only","diagnostic_only","retry_later"]);
const evidencePath={
  hostinger:"test-hostinger-recovery-readonly-planner.mjs",
  mcp:"test-mcp-catalog-recovery-decision.mjs",
  device:"test-device-generation-challenge-verifier.mjs",
  migration:"test-production-recovery-control-store-bootstrap.mjs",
  policy:"test-github-repository-policy-controller.mjs",
  release:"test-production-promotion-candidate-workflow.mjs",
};
test("60 exact documented operating cases across six domains remain distinct and nonexecuting",()=>{
  assert.equal(scenarios.contract,"mad4b.post8461-operational-scenario-matrix.v1");
  assert.equal(scenarios.scenarios.length,60);
  assert.deepEqual(scenarios.families,required);
  for(const entry of scenarios.scenarios){
    assert.match(entry.id,/^(hostinger|mcp|device|migration|policy|release)\.[a-z][a-z0-9_]+$/);
    assert(!ids.has(entry.id),"duplicate scenario: "+entry.id);
    ids.add(entry.id);
    assert(allowed.has(entry.expected_state),entry.id);
    assert(entry.trigger.length>14,entry.id);
    assert(entry.live_evidence.length>10,entry.id);
    assert(entry.required_response.length>14,entry.id);
    assert.equal(entry.live_certified,false,entry.id);
    assert.equal(entry.execution_authorized,false,entry.id);
    assert.equal(entry.production_mutation_allowed,false,entry.id);
    assert.equal(entry.readback_proof_required,true,entry.id);
    assert.equal(entry.secrets_included,false,entry.id);
    assert.equal(entry.source_coverage,"partial_or_negative_contract_only",entry.id);
    assert(readFileSync(join(root,evidencePath[entry.domain]),"utf8").length>100,
      "source regression reference not present for "+entry.id);
  }
  for(const domain of required)assert(scenarios.scenarios.some(x=>x.domain===domain));
});

test("hostinger absent database is a preview, never a provider create permission",async()=>{
  const x=await previewHostingerRecoveryDatabase({
    accountUsername:"u123456789",websiteDomain:"app.example.com",
    recoveryDatabaseName:"u123456789_recovery",
    provider:{databaseInventory:async()=>({database_names:[],provider_http_status:200})}
  });
  assert.equal(x.target_database_exists,false);
  assert.equal(x.execution_allowed,false);
  assert.equal(x.plan_allowed,false);
  assert.equal(x.inventory_readback_proven,false);
  assert.equal(x.website_identity_verified,false);
});

test("all purported Hostinger CREATE authority booleans remain insufficient for DDL",()=>{
  const x=assessHostingerDatabaseCreate({
    exactHostingAccount:true,exactWebsiteDomain:true,databaseAbsent:true,
    providerAccountEntitlementProven:true,managedCredentialIntakeReady:true,
    exactProductionPlan:true,separateOwnerApproval:true
  });
  assert.equal(x.execution_allowed,false);
  assert.equal(x.candidate_ready,false);
  assert.equal(x.account_specific_authority_verified,false);
});

test("Hostinger masked PUT of environment is never allowed by observer claims",()=>{
  const x=assessHostingerNodeEnvReplacement({
    observedKeys:["DB_PASSWORD","RECOVERY_CONTROL_DB_HOST"],
    desiredBindings:[{name:"RECOVERY_CONTROL_DB_HOST",secret_reference:"vault/recovery/host"}],
    approvedRecoveryKeys:["RECOVERY_CONTROL_DB_HOST"],
    exactWebsiteBound:true,providerEntitlementProven:true,
    exclusiveHostMutationLease:true,secretVaultComplete:true,
    exactProductionPlan:true,sameCycleKeyInventory:true
  });
  assert.equal(x.execution_allowed,false);
  assert.equal(x.plan_eligible,false);
});

test("forged MCP catalog readback cannot approve metadata or DDL",()=>{
  const forged={
    identity:{ok:true,database_matches:true,principal_matches:true,
      identity_readback_performed:true},
    ok:true,sql_readback_performed:true,database_connection_performed:true,
    migration_apply_required:false
  };
  const d=classifyMcpCatalogRecoveryReadback(forged);
  assert.equal(d.schema_ready,false);
  assert.equal(d.migration_apply_allowed,false);
  assert.equal(d.production_deploy_allowed,false);
  assert(d.blockers.includes("live_runtime_collector_evidence_missing"));
});

test("healthy /policy and arbitrary generation attestation cannot mark Windows recovered",()=>{
  const result=classifyAdminRecoveryReadback({
    deviceState:"ACTIVE",publicStatus:"pass",authenticatedStatus:"pass",
    observedDeviceId:"current",expectedDeviceId:"current",
    observedConfigId:"config-1",expectedConfigId:"config-1",
    deviceGenerationAttested:true
  });
  assert.equal(result.operational_verified,true);
  assert.equal(result.device_generation_attested,false);
  assert.equal(result.recovered,false);
});

test("full matrix explicitly keeps operational certification separate from source checks",()=>{
  for(const family of required){
    const items=scenarios.scenarios.filter(x=>x.domain===family);
    assert(items.length>=3,"too few operational failure modes for "+family);
    for(const x of items)
      assert(x.live_evidence && x.execution_authorized===false,
        "source-only success misclassified as production permission: "+x.id);
  }
});
