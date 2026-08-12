import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildDeploymentAttestation, evaluateRuntimeIntegrity } from "./deploymentAttestation.js";
import { repositoryReconciliationApplyConfirmation } from "./repositoryReconciliationAdminSurfaceLegacy.js";
import { requiredBreakGlassFollowupConfirmation } from "./runtimeBreakGlassReconciliationClosure.js";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

const routes = read("./routes/gptToolsRoutes.js");
assert.match(routes, /repository_reconciliation_orchestrator/);
assert.match(routes, /runtime_break_glass_reconciliation_transition/);
assert.match(routes, /deployment_attestation_generate/);
assert.match(routes, /enum: \["dry_run", "apply"\]/);
assert.match(routes, /getGovernancePool/);

const reconciliation = read("./repositoryReconciliationAdminSurface.js");
assert.match(reconciliation, /REQUIRED_MUTATION_STEPS/);
assert.match(reconciliation, /build_resolution_commit/);
assert.match(reconciliation, /create_merge_commit/);
assert.match(reconciliation, /finalize_pr/);
assert.match(reconciliation, /acceptedCapabilityKeys: \["repo_patch_apply"\]/);
assert.match(reconciliation, /contextPlanSha/);
assert.match(reconciliation, /contextStepKey/);
assert.match(reconciliation, /getGovernancePool/);

const reconciliationCore = read("./repositoryReconciliationAdminSurfaceLegacy.js");
assert.match(reconciliationCore, /resolution_entries_sha256/);
assert.match(reconciliationCore, /same_cycle_plan_authority_verified/);
assert.match(reconciliationCore, /per_step_authority_verified/);
assert.match(reconciliationCore, /force_push_allowed: false/);
assert.equal(repositoryReconciliationApplyConfirmation("abc-123"), "APPLY_REPOSITORY_RECONCILIATION_ABC_123");

const activationMigration = read("./migrations/20260812_repository_reconciliation_admin_apply_activation.sql");
assert.match(activationMigration, /repo\.pr\.reconcile_and_finalize/);
assert.match(activationMigration, /status='active'/);
assert.match(activationMigration, /per_step_plan_authority_required/);
assert.match(activationMigration, /force_push_allowed/);
assert.match(activationMigration, /v_repository_reconciliation_apply_readiness/);

const collationPolicy = JSON.parse(read("./config/database-engine-collation-policy.json"));
assert.equal(collationPolicy.contract, "mad4b.database-engine-collation-policy.v1");
assert.ok(collationPolicy.engine_profiles.some((profile) => profile.engine_family === "mariadb"));
assert.ok(collationPolicy.engine_profiles.some((profile) => profile.engine_family === "mysql"));
assert.ok(collationPolicy.engine_profiles.some((profile) => profile.engine_family === "postgresql"));
assert.equal(collationPolicy.unknown_engine_policy, "block");

const migrationRunner = read("./scripts/governed-migration-runner.mjs");
const collGuardIndex = migrationRunner.indexOf("assessDatabaseCollationPolicy(sql)");
const legacyExecIndex = migrationRunner.indexOf("execFileAsync(process.execPath");
assert.ok(collGuardIndex > -1 && legacyExecIndex > collGuardIndex, "collation preflight must run before legacy SQL runner dispatch");
assert.match(migrationRunner, /database_collation_policy_mismatch/);
assert.match(migrationRunner, /applies_sql: false/);

const activation = read("./activationDynamicEvidence.js");
assert.match(activation, /resolveActivationCanonicalReferences/);
assert.match(activation, /sql_canonical_resource_registry_plus_repo_filesystem_readback/);
assert.match(activation, /legacy_fallback_used/);
assert.match(activation, /parity_required_before_fallback_retirement/);

const registryMigration = read("./migrations/20260812_dynamic_canonical_resource_registry.sql");
assert.match(registryMigration, /canonical_resource_registry/);
assert.match(registryMigration, /required_at_activation/);
assert.match(registryMigration, /on_demand_searchable/);
assert.match(registryMigration, /AI_Agent_Knowledge_Guide\.md/);

const providerCertification = read("./providerCanonicalResponseCertification.js");
assert.match(providerCertification, /provider_canonical_response_schema_drift/);
assert.match(providerCertification, /dereferenceLocalSchema/);

const breakGlassClosure = read("./runtimeBreakGlassReconciliationClosure.js");
for (const state of ["MAIN_COMMITTED", "STAGING_VERIFIED", "PRODUCTION_PROMOTED", "REDEPLOYED", "CLEAN_READBACK", "CLOSED"]) {
  assert.match(breakGlassClosure, new RegExp(state));
}
assert.equal(
  requiredBreakGlassFollowupConfirmation("11111111-1111-4111-8111-111111111111", "CLOSED"),
  "ADVANCE_BREAK_GLASS_11111111_1111_4111_8111_111111111111_CLOSED",
);

const runtimeVerificationRoutes = read("./routes/runtimeVerificationRoutes.js");
assert.match(runtimeVerificationRoutes, /recordRuntimeBreakGlassVerificationReadback/);
assert.match(runtimeVerificationRoutes, /getGovernancePool/);
assert.match(runtimeVerificationRoutes, /runtime_break_glass_readback_hash_mismatch/);

const attestationMigration = read("./migrations/20260812_deployment_attestation_runtime_integrity_v1.sql");
assert.match(attestationMigration, /deployment_attestations/);
assert.match(attestationMigration, /runtime_integrity_state/);

const productionSha = "a".repeat(40);
const attestation = buildDeploymentAttestation({
  attestation_id: "11111111-1111-4111-8111-111111111111",
  environment_key: "production",
  repository_uri: "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
  source_branch: "Production",
  source_commit_sha: productionSha,
  build_id: "test-build",
  build_timestamp: "2026-08-12T12:00:00.000Z",
  canonical_resource_hashes: [{ resource_key: "bootstrap", path: "system_bootstrap.md", sha256: "b".repeat(64) }],
});
const integrity = evaluateRuntimeIntegrity({
  attestation,
  runtime_readback: { commit_sha: productionSha, readback_verified: true, working_tree_clean: true, unapproved_local_change_count: 0 },
});
assert.equal(integrity.state, "verified_clean");
assert.equal(integrity.ready, true);

const governancePrivileges = read("./governanceDbPrivilegeContract.js");
assert.match(governancePrivileges, /capability_resolution_envelope_ledger/);
assert.match(governancePrivileges, /approval_holds: Object\.freeze\(\["SELECT", "INSERT"\]\)/);
assert.match(governancePrivileges, /repository_operation_leases/);
assert.match(governancePrivileges, /repository_mutation_plans_v6/);
assert.match(governancePrivileges, /runtime_break_glass_incidents/);
assert.match(governancePrivileges, /runtime_verification_evidence_chunks/);
assert.match(governancePrivileges, /deployment_attestations/);

const canonicalSchemaGovernance = read("../canonicals/direct_instructions_registry_patch/15_schema_repair_governance.md");
assert.match(canonicalSchemaGovernance, /semantic and engine-aware/);
assert.match(canonicalSchemaGovernance, /database_engine_profile_unresolved/);
assert.match(canonicalSchemaGovernance, /do \*\*not\*\* authorize automatic schema conversion/i);

console.log("consolidated governance/runtime contracts: ok");
