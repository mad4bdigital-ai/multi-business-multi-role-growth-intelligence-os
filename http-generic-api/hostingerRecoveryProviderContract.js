// Hostinger documented provider capabilities and fail-closed safety predicates.
// Documentation is NOT evidence that this account/token has the entitlements.
// No network, DB, credentials or mutations occur in this module.
export const HOSTINGER_RECOVERY_PROVIDER_API = Object.freeze({
  database_list: "GET /api/hosting/v1/accounts/{username}/databases",
  database_create: "POST /api/hosting/v1/accounts/{username}/databases",
  node_env_list: "GET /api/hosting/v1/accounts/{username}/websites/{domain}/nodejs/builds/settings/env",
  node_env_replace: "PUT /api/hosting/v1/accounts/{username}/websites/{domain}/nodejs/builds/settings/env",
  website_database_setup: "POST /api/hosting/v1/accounts/{username}/websites/{domain}/databases/setup",
  documentation: "https://developers.hostinger.com",
  node_env_mutation_semantics: "FULL_REPLACE_AND_RESTART",
  node_env_read_semantics: "KEYS_WITH_MASKED_VALUES_ONLY",
  account_entitlement_attested: false,
  provider_dispatch_enabled: false,
});

const key = name => String(name ?? "").trim();
const KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const MASK_PATTERN = /^\*{3,}$/;

export function assessHostingerNodeEnvReplacement({
  observedKeys = [], desiredBindings = [], approvedRecoveryKeys = [],
  exactWebsiteBound = false, providerEntitlementProven = false,
  exclusiveHostMutationLease = false, secretVaultComplete = false,
  exactProductionPlan = false, sameCycleKeyInventory = false,
} = {}) {
  const reasons = [];
  if (!Array.isArray(observedKeys) || !Array.isArray(desiredBindings) ||
      !Array.isArray(approvedRecoveryKeys) || observedKeys.length > 1000 ||
      desiredBindings.length > 1000 || approvedRecoveryKeys.length > 1000) {
    return {ok:false, evaluation_completed:false, candidate_ready:false,
      plan_eligible:false, execution_allowed:false,
      blockers:["invalid_or_unbounded_environment_inventory"], secrets_included:false};
  }
  const existing = observedKeys.map(key);
  const desired = desiredBindings.map(row => key(row?.name));
  const approvedValues = approvedRecoveryKeys.map(key);
  const approved = new Set(approvedValues);
  if (existing.some(v => !KEY_PATTERN.test(v)) || desired.some(v => !KEY_PATTERN.test(v)))
    reasons.push("invalid_environment_key");
  if (new Set(existing).size !== existing.length || new Set(desired).size !== desired.length ||
      approved.size !== approvedValues.length)
    reasons.push("duplicate_environment_key");
  if (approvedValues.some(name => !KEY_PATTERN.test(name)))
    reasons.push("invalid_approved_recovery_key");
  if (desiredBindings.some(row => !row || typeof row !== "object" ||
      typeof row.name !== "string" || typeof row.secret_reference !== "string" ||
      !key(row.secret_reference) || Object.hasOwn(row, "value") ||
      MASK_PATTERN.test(key(row.secret_reference))))
    reasons.push("managed_secret_reference_only");
  const desiredSet = new Set(desired);
  if (existing.some(name => !desiredSet.has(name))) reasons.push("would_delete_existing_environment_variable");
  const changed = desired.filter(name => !existing.includes(name));
  if (changed.some(name => !approved.has(name))) reasons.push("unapproved_environment_key");
  if (exactWebsiteBound !== true) reasons.push("hostinger_website_identity_not_bound");
  if (providerEntitlementProven !== true) reasons.push("hostinger_provider_entitlement_unverified");
  if (exclusiveHostMutationLease !== true) reasons.push("atomic_host_mutation_lease_missing");
  if (secretVaultComplete !== true) reasons.push("complete_authoritative_environment_values_missing");
  if (exactProductionPlan !== true) reasons.push("exact_production_plan_missing");
  if (sameCycleKeyInventory !== true) reasons.push("same_cycle_key_inventory_missing");
  // A complete inventory and vault mapping are necessary but not sufficient.
  // Hostinger's public API does not advertise a conditional ETag replace.
  if (!reasons.length) reasons.push("provider_revision_compare_and_set_not_certified");
  return {
    ok:false, evaluation_completed:true, candidate_ready:false,
    contract:"mad4b.hostinger-node-env-replacement-safety.v1",
    provider_operation:HOSTINGER_RECOVERY_PROVIDER_API.node_env_replace,
    observed_key_count:existing.length, desired_key_count:desired.length,
    added_recovery_keys:changed.sort(), blockers:reasons.sort(),
    plan_eligible:false, execution_allowed:false,
    full_replace_semantics:true, response_values_masked:true,
    restart_is_consequential:true, secret_values_included:false,
    secrets_included:false,
  };
}

export function assessHostingerDatabaseCreate({
  exactHostingAccount=false, exactWebsiteDomain=false, databaseAbsent=false,
  providerAccountEntitlementProven=false, managedCredentialIntakeReady=false,
  exactProductionPlan=false, separateOwnerApproval=false,
}={}) {
  const blockers=[];
  if(exactHostingAccount !== true)blockers.push("exact_hosting_account_required");
  if(exactWebsiteDomain !== true)blockers.push("exact_hostinger_website_domain_required");
  if(databaseAbsent !== true)blockers.push("database_absence_unproven_or_exists");
  if(providerAccountEntitlementProven !== true)blockers.push("provider_db_create_entitlement_unverified");
  if(managedCredentialIntakeReady !== true)blockers.push("managed_secret_intake_required");
  if(exactProductionPlan !== true)blockers.push("exact_production_plan_required");
  if(separateOwnerApproval !== true)blockers.push("independent_database_create_approval_required");
  // These booleans are caller-supplied *claims*, not independently signed
  // provider-account proof. A syntactically complete plan is never an executable
  // or provider-certified database-creation candidate in the discovery adapter.
  const reportedPrerequisitesComplete = blockers.length === 0;
  blockers.push("independent_provider_account_proof_and_certified_executor_missing");
  return {contract:"mad4b.hostinger-database-create-safety.v1",
    provider_operation:HOSTINGER_RECOVERY_PROVIDER_API.database_create,
    discovery_only:true, account_specific_authority_verified:false,
    reported_prerequisites_complete:reportedPrerequisitesComplete,
    candidate_ready:false, plan_eligible:false,
    execution_allowed:false, blockers, secrets_included:false};
}
