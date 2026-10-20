import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OA_MC_CASES, assessStagingMultiPrincipalReadiness } from "./stagingMultiPrincipalAcceptanceGate.js";

const realStagingShape={
  environment:"staging_local_windows_docker",
  counts:{users:1,tenants:1,memberships:1,cross_tenant_users:0,inactive_users:0,inactive_memberships:0,revoked_grants:0},
  tenant_role_groups:[{owners:1,members:0,distinct_users:1}],
};
const real=assessStagingMultiPrincipalReadiness(realStagingShape);
assert.equal(real.contract,"mad4b.staging.oa-mc-four-principal-preflight.v1");
assert.equal(real.production_promotion_eligible,false);
assert(real.prerequisite_objections.includes("TWO_ACTIVE_QA_TENANTS_REQUIRED"));
assert(real.prerequisite_objections.includes("TENANT_A_OWNER_AND_MEMBER_REQUIRED"));
assert(real.prerequisite_objections.includes("SAME_USER_TWO_TENANT_BOUNDARY_FIXTURE_REQUIRED"));
assert.equal(real.matrix.length,18);
assert.equal(new Set(OA_MC_CASES).size,18);
assert(real.matrix.every(c=>c.status==="not_live_certified"));
assert.equal(real.database_mutation,false);
assert.equal(real.secrets_included,false);

const fixtureShaped=assessStagingMultiPrincipalReadiness({
  environment:"staging",
  counts:{users:4,tenants:2,memberships:5,cross_tenant_users:1,inactive_users:1,inactive_memberships:1,revoked_grants:1},
  tenant_role_groups:[{owners:1,members:2,distinct_users:3},{owners:1,members:1,distinct_users:2}],
});
assert.equal(fixtureShaped.prerequisite_objections.includes("TWO_ACTIVE_QA_TENANTS_REQUIRED"),false);
assert.equal(fixtureShaped.prerequisite_objections.includes("TENANT_A_OWNER_AND_MEMBER_REQUIRED"),false);
assert.equal(fixtureShaped.production_promotion_eligible,false);
assert(fixtureShaped.prerequisite_objections.includes("GOVERNED_QA_FIXTURE_PROVENANCE_UNVERIFIED"));
assert(fixtureShaped.prerequisite_objections.includes("EXACT_HEAD_LIVE_18_CASE_EVIDENCE_NOT_COLLECTED"));
assert(fixtureShaped.prerequisite_objections.includes("INDEPENDENT_PLATFORM_ADMIN_TEST_PRINCIPAL_UNVERIFIED"));

for(const environment of ["production_hostinger_autodeploy","", "prod", "production_staging"]){
 const out=assessStagingMultiPrincipalReadiness({...fixtureShaped,environment});
 assert.equal(out.environment_valid,false);
 assert.equal(out.production_promotion_eligible,false);
}
const invalid=assessStagingMultiPrincipalReadiness({
 environment:"staging",counts:{users:-1,tenants:"not_num",memberships:Infinity,cross_tenant_users:null},
 tenant_role_groups:[{owners:"oops",members:1,distinct_users:2}],
});
assert(invalid.prerequisite_objections.includes("INCOMPLETE_AGGREGATE_CENSUS"));
assert.equal(invalid.tenant_role_group_counts.length,0);
const scrub=JSON.stringify(real);
assert.doesNotMatch(scrub, /@|password|access_token|refresh_token|Bearer |client_secret/iu);
const source=readFileSync(new URL("./scripts/staging-multi-principal-acceptance-preflight.mjs",import.meta.url),"utf8");
assert.match(source, /SELECT COUNT\(\*\)/u);
assert.match(source, /FROM memberships m/u);
assert.doesNotMatch(source, /\b(?:INSERT INTO|UPDATE\s+[a-z_]+\s+SET|DELETE FROM|DROP TABLE|TRUNCATE TABLE|CREATE USER|GRANT\s+ALL)\b/iu);
assert.match(source, /production_promotion_eligible\?0:2/u);
const phase=JSON.parse(readFileSync(new URL("../.changes/e2e/staging-oa-mc-live-multi-principal-prerequisite-gate-20261015.json",import.meta.url),"utf8"));
assert.deepEqual(phase.environment_impact.declared_targets,["staging","production"]);
assert.equal(phase.environment_impact.cross_environment_reviewed,true);
assert.equal(phase.environment_impact.live_staging_certification_required,true);
assert.equal(phase.environment_impact.production_mutation_allowed,false);
const declaration=".changes/e2e/staging-oa-mc-live-multi-principal-prerequisite-gate-20261015.json";
const constitution=JSON.parse(readFileSync(new URL("./config/repository-governance-constitution.json",import.meta.url),"utf8"));
const derived=JSON.parse(readFileSync(new URL("../.github/derived-state-governance.json",import.meta.url),"utf8"));
assert(constitution.control_plane_paths.includes(declaration),"critical path must be registered in Constitution");
assert(derived.convergence.automation_control_paths.includes(declaration),"critical path must be registered in convergence automation");
assert(phase.scope.include.includes("http-generic-api/config/repository-governance-constitution.json"));
assert(phase.scope.include.includes(".github/derived-state-governance.json"));
console.log(JSON.stringify({contract:"mad4b.staging.oa-mc-four-principal-preflight.test.v1",ok:true,synthetic_cases:6,matrix_cases:OA_MC_CASES.length,mutations:false}));
