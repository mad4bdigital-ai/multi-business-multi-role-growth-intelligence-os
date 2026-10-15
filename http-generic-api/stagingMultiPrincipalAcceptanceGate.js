// Read-only, PII-free prerequisite gate for the live OA-01..08 / MC-01..10 matrix.
// Does not provision QA identities, infer Production authority, or certify any case.
export const OA_MC_CASES = Object.freeze([
  "OA-01","OA-02","OA-03","OA-04","OA-05","OA-06","OA-07","OA-08",
  "MC-01","MC-02","MC-03","MC-04","MC-05","MC-06","MC-07","MC-08","MC-09","MC-10",
]);
function finiteCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isSafeInteger(num) && num >= 0 ? num : null;
}
function safeAggregate(value) {
  return {
    owners:finiteCount(value?.owners),
    members:finiteCount(value?.members),
    distinct_users:finiteCount(value?.distinct_users),
  };
}
export function assessStagingMultiPrincipalReadiness(input={}) {
  const environment=String(input.environment||"").toLowerCase();
  const staging=environment.includes("staging") && !environment.includes("production");
  const counts=Object.fromEntries(
    ["users","tenants","memberships","cross_tenant_users","inactive_users","inactive_memberships","revoked_grants"]
      .map(key=>[key,finiteCount(input.counts?.[key])]),
  );
  const groups=Array.isArray(input.tenant_role_groups)
    ? input.tenant_role_groups.map(safeAggregate).filter(g=>Object.values(g).every(Number.isSafeInteger))
    : [];
  const ownerMemberTenant=groups.some(g=>g.owners>=1 && g.members>=1 && g.distinct_users>=2);
  const independentOwnerTenant=groups.filter(g=>g.owners>=1).length>=2;
  const missing=[];
  if(!staging) missing.push("STAGING_RUNTIME_IDENTITY_NOT_VERIFIED");
  if(Object.values(counts).some(v=>v===null)) missing.push("INCOMPLETE_AGGREGATE_CENSUS");
  if((counts.users??0)<3) missing.push("THREE_DISTINCT_TENANT_QA_USERS_REQUIRED");
  if((counts.tenants??0)<2) missing.push("TWO_ACTIVE_QA_TENANTS_REQUIRED");
  if((counts.memberships??0)<3) missing.push("THREE_TENANT_QA_MEMBERSHIPS_REQUIRED");
  if(!ownerMemberTenant) missing.push("TENANT_A_OWNER_AND_MEMBER_REQUIRED");
  if(!independentOwnerTenant) missing.push("TENANT_B_INDEPENDENT_OWNER_REQUIRED");
  if((counts.cross_tenant_users??0)<1) missing.push("SAME_USER_TWO_TENANT_BOUNDARY_FIXTURE_REQUIRED");
  // Aggregate census cannot prove the owner, scope, reversible snapshot, clean-up
  // or that any identity is an approved disposable fixture. Those are independent
  // signed operational evidence gates, never caller assertions.
  missing.push("GOVERNED_QA_FIXTURE_PROVENANCE_UNVERIFIED");
  missing.push("INDEPENDENT_PLATFORM_ADMIN_TEST_PRINCIPAL_UNVERIFIED");
  missing.push("EXACT_HEAD_LIVE_18_CASE_EVIDENCE_NOT_COLLECTED");
  const blocked=Array.from(new Set(missing));
  return {
    contract:"mad4b.staging.oa-mc-four-principal-preflight.v1",
    source:"read_only_sql_aggregate_census",
    environment_valid:staging,
    outcome:"blocked",
    status:"fail_closed",
    counts,
    tenant_role_group_counts:groups,
    prerequisite_objections:blocked,
    matrix:OA_MC_CASES.map(id=>({id,status:"not_live_certified"})),
    qa_fixture_created:false,
    qa_identity_mutation:false,
    database_mutation:false,
    production_mutation:false,
    production_promotion_eligible:false,
    secrets_included:false,
  };
}
