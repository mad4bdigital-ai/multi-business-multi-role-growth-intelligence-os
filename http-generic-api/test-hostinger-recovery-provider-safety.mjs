import test from "node:test";
import assert from "node:assert/strict";
import {HOSTINGER_RECOVERY_PROVIDER_API,assessHostingerNodeEnvReplacement,assessHostingerDatabaseCreate} from "./hostingerRecoveryProviderContract.js";

const nominal=()=>({
  observedKeys:["DB_HOST","DB_USER","DB_PASSWORD","APP_ENV"],
  desiredBindings:["DB_HOST","DB_USER","DB_PASSWORD","APP_ENV","RECOVERY_CONTROL_DB_HOST"]
    .map(name=>({name,secret_reference:"vault/hostinger/prod/"+name})),
  approvedRecoveryKeys:["RECOVERY_CONTROL_DB_HOST"],
  exactWebsiteBound:true,providerEntitlementProven:true,
  exclusiveHostMutationLease:true,secretVaultComplete:true,
  exactProductionPlan:true,sameCycleKeyInventory:true,
});
test("documented Hostinger Node env endpoint replaces all keys and lists only masked values",()=>{
  assert.match(HOSTINGER_RECOVERY_PROVIDER_API.node_env_replace,/^PUT /);
  assert.equal(HOSTINGER_RECOVERY_PROVIDER_API.node_env_mutation_semantics,"FULL_REPLACE_AND_RESTART");
  assert.equal(HOSTINGER_RECOVERY_PROVIDER_API.node_env_read_semantics,"KEYS_WITH_MASKED_VALUES_ONLY");
  assert.equal(HOSTINGER_RECOVERY_PROVIDER_API.provider_dispatch_enabled,false);
});
test("full-replace refuses to proceed even with a complete vault mapping without provider CAS proof",()=>{
  const x=assessHostingerNodeEnvReplacement(nominal());
  assert.equal(x.execution_allowed,false);assert.equal(x.plan_eligible,false);
  assert(x.blockers.includes("provider_revision_compare_and_set_not_certified"));
  assert.equal(x.secrets_included,false);
});
test("missing a single existing env variable blocks destructive replace",()=>{
  const input=nominal();
  input.desiredBindings=input.desiredBindings.filter(x=>x.name!=="APP_ENV");
  const x=assessHostingerNodeEnvReplacement(input);
  assert(x.blockers.includes("would_delete_existing_environment_variable"));
});
test("masked value from list API cannot be used as secret reference or value",()=>{
  const input=nominal();
  input.desiredBindings[0].value="********";
  const x=assessHostingerNodeEnvReplacement(input);
  assert(x.blockers.includes("managed_secret_reference_only"));
});
test("duplicate keys and unapproved new environment values fail closed",()=>{
  const input=nominal();input.desiredBindings.push({name:"EVIL_VAR",secret_reference:"ref"});
  input.desiredBindings.push({name:"EVIL_VAR",secret_reference:"ref"});
  const x=assessHostingerNodeEnvReplacement(input);
  assert(x.blockers.includes("duplicate_environment_key"));
  assert(x.blockers.includes("unapproved_environment_key"));
});
test("database create needs exact provider entitlement, host, absence and separate approval",()=>{
  const denied=assessHostingerDatabaseCreate({});
  assert.equal(denied.execution_allowed,false);
  assert(denied.blockers.includes("provider_db_create_entitlement_unverified"));
  const complete=assessHostingerDatabaseCreate({
    exactHostingAccount:true,exactWebsiteDomain:true,databaseAbsent:true,
    providerAccountEntitlementProven:true,managedCredentialIntakeReady:true,
    exactProductionPlan:true,separateOwnerApproval:true
  });
  assert.equal(complete.candidate_ready,true);
  assert.equal(complete.execution_allowed,false);
});
