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
  assert.equal(x.ok,false);assert.equal(x.evaluation_completed,true);
  assert.equal(x.candidate_ready,false);
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
  assert.equal(complete.reported_prerequisites_complete,true);
  assert.equal(complete.account_specific_authority_verified,false);
  assert.equal(complete.candidate_ready,false);
  assert.equal(complete.plan_eligible,false);
  assert.equal(complete.execution_allowed,false);
  assert(complete.blockers.includes("independent_provider_account_proof_and_certified_executor_missing"));
});

test("blocked Hostinger evaluation never represents a successful execution decision",()=>{
  const missing=assessHostingerNodeEnvReplacement({});
  assert.equal(missing.ok,false);
  assert.equal(missing.evaluation_completed,true);
  assert.equal(missing.execution_allowed,false);
  assert(missing.blockers.includes("hostinger_provider_entitlement_unverified"));
  const invalid=assessHostingerNodeEnvReplacement({observedKeys:"not-an-array"});
  assert.equal(invalid.ok,false);
  assert.equal(invalid.evaluation_completed,false);
  assert.equal(invalid.candidate_ready,false);
  assert.equal(invalid.execution_allowed,false);
});

test("string-typed approvals are not equivalent to independently verified boolean true",()=>{
  const envInput=nominal();
  envInput.providerEntitlementProven="true";
  envInput.exactWebsiteBound="true";
  const env=assessHostingerNodeEnvReplacement(envInput);
  assert.equal(env.execution_allowed,false);
  assert(env.blockers.includes("hostinger_provider_entitlement_unverified"));
  assert(env.blockers.includes("hostinger_website_identity_not_bound"));
  const database=assessHostingerDatabaseCreate({
    exactHostingAccount:"true",exactWebsiteDomain:"true",databaseAbsent:"true",
    providerAccountEntitlementProven:"true",managedCredentialIntakeReady:"true",
    exactProductionPlan:"true",separateOwnerApproval:"true",
  });
  assert.equal(database.execution_allowed,false);
  assert.equal(database.candidate_ready,false);
  assert.equal(database.blockers.length,7);
});

test("untrusted environment keys and opaque secret reference values fail closed",()=>{
  const wrongSecret=nominal();
  wrongSecret.desiredBindings[0].secret_reference={path:"vault/prod"};
  assert(assessHostingerNodeEnvReplacement(wrongSecret).blockers.includes(
    "managed_secret_reference_only"
  ));
  const emptyValue=nominal();
  emptyValue.desiredBindings[0].value="";
  assert(assessHostingerNodeEnvReplacement(emptyValue).blockers.includes(
    "managed_secret_reference_only"
  ));
  const oversized=nominal();
  oversized.approvedRecoveryKeys=Array(1001).fill("DB_HOST");
  const denied=assessHostingerNodeEnvReplacement(oversized);
  assert.equal(denied.evaluation_completed,false);
  assert(denied.blockers.includes("invalid_or_unbounded_environment_inventory"));
  const duplicateApproved=nominal();
  duplicateApproved.approvedRecoveryKeys.push("RECOVERY_CONTROL_DB_HOST");
  assert(assessHostingerNodeEnvReplacement(duplicateApproved).blockers.includes(
    "duplicate_environment_key"
  ));
});

test("caller-asserted entitlement can never become independent provider account authority",()=>{
  const untrusted=assessHostingerDatabaseCreate({
    exactHostingAccount:true,exactWebsiteDomain:true,databaseAbsent:true,
    providerAccountEntitlementProven:true,managedCredentialIntakeReady:true,
    exactProductionPlan:true,separateOwnerApproval:true,
  });
  assert.equal(untrusted.reported_prerequisites_complete,true);
  assert.equal(untrusted.account_specific_authority_verified,false);
  assert.equal(untrusted.candidate_ready,false);
  assert.equal(untrusted.execution_allowed,false);
  assert(untrusted.blockers.includes("independent_provider_account_proof_and_certified_executor_missing"));
});

