import assert from "node:assert/strict";
import fs from "node:fs";

import {
  TENANT_REPOSITORY_GOVERNANCE_V6_SYSTEM_TOOLS,
  buildRepositoryMutationPlanV6,
  resolveRepositoryPrincipalScopeV6,
} from "./repositoryGovernanceV6.js";
import { buildBindingContext } from "./scripts/capability-resolution-envelope-create.mjs";
import { executeRepositoryPrReconciliationReadOnlyForAdminReadiness } from "./platformResourceRecipeCapability.js";

const releaseReadinessSource = fs.readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");
assert.match(releaseReadinessSource, /function safeJsonArray/);
assert.match(releaseReadinessSource, /isRepositoryAuthorizationGatedSmoke/);
const systemLayerSource = fs.readFileSync(new URL("./routes/systemLayerRoutes.js", import.meta.url), "utf8");
assert.match(systemLayerSource, /authorization_gated_source_count/);
assert.match(systemLayerSource, /system_layer_descriptor_callability_authorization_gated/);
assert.match(systemLayerSource, /export function systemLayerDescriptorReadiness/);
assert.doesNotMatch(systemLayerSource, /\.\.\.TENANT_REPOSITORY_GOVERNANCE_V6_SYSTEM_TOOLS,\n  \{/);
const governanceSource = fs.readFileSync(new URL("./repositoryGovernanceV6.js", import.meta.url), "utf8");
assert.match(governanceSource, /repository_governance_v6_authorization_gated/);
assert.match(governanceSource, /findRepositoryGovernanceV6ReadinessBinding/);
assert.match(governanceSource, /readinessRunGovernedResource/);
assert.doesNotMatch(governanceSource, /findUsableRepositoryProviderBinding/);
assert.match(governanceSource, /"repo\.pr\.comment_advisory": "repo\.pr\.comment_advisory\.apply"/);
assert.match(releaseReadinessSource, /systemLayerModule\.systemLayerDescriptorReadiness/);
assert.match(releaseReadinessSource, /!authorization_gated && Number\(evidenceRows/);
const bindingContext = buildBindingContext([
  "--plan-id=plan-1",
  "--plan-item-id=item-1",
  "--resource-uri=github://example/repo",
  "--recipe-key=repo.pr.comment_advisory",
  `--expected-commit-sha=${"a".repeat(40)}`,
]);
assert.deepEqual(bindingContext, {
  plan_id: "plan-1",
  plan_item_id: "item-1",
  resource_uri: "github://example/repo",
  recipe_key: "repo.pr.comment_advisory",
  expected_commit_sha: "a".repeat(40),
});
assert.throws(
  () => buildBindingContext(["--expected-commit-sha=not-a-sha"]),
  (error) => error?.code === "capability_resolution_expected_commit_sha_invalid"
);
assert.throws(
  () => buildBindingContext(["--resource-uri=relative/path"]),
  (error) => error?.code === "capability_resolution_resource_uri_invalid"
);

const tenantAuth = { tenant_id: "tenant-a", user_id: "user-a", is_admin: false };
const scope = resolveRepositoryPrincipalScopeV6(
  { tenant_id: "tenant-a", workspace_id: "workspace-a", user_id: "user-a" },
  tenantAuth
);
assert.deepEqual(
  { tenant_id: scope.tenant_id, workspace_id: scope.workspace_id, user_id: scope.user_id, principal_type: scope.principal_type },
  { tenant_id: "tenant-a", workspace_id: "workspace-a", user_id: "user-a", principal_type: "user" }
);
assert.throws(
  () => resolveRepositoryPrincipalScopeV6({ tenant_id: "tenant-b" }, tenantAuth),
  (error) => error?.code === "repository_tenant_scope_override_forbidden"
);
assert.throws(
  () => resolveRepositoryPrincipalScopeV6({ user_id: "user-b" }, tenantAuth),
  (error) => error?.code === "repository_user_scope_override_forbidden"
);
const adminScope = resolveRepositoryPrincipalScopeV6(
  { tenant_id: "tenant-b", user_id: "user-b" },
  { is_admin: true }
);
assert.equal(adminScope.tenant_id, "tenant-b");
assert.equal(adminScope.user_id, "user-b");

const report = {
  schema_version: "tenant_repository_intelligence_report.v6",
  resource_uri: "github://example/repo",
  pull_requests: [
    { number: 1, head_sha: "a".repeat(40), head_ref_name: "feature/one", base_ref_name: "main", classification_v6: "superseded_by_main", reason_code_v6: "exact_changed_file_parity_with_main", confidence_v6: 0.99, recommended_action_v6: "repo.pr.close_superseded" },
    { number: 2, head_sha: "b".repeat(40), head_ref_name: "feature/two", base_ref_name: "main", classification_v6: "merge_ready", reason_code_v6: "deep_readiness_checks_passed", confidence_v6: 0.92, recommended_action_v6: "repo.pr.merge_ready" },
    { number: 3, head_sha: "c".repeat(40), head_ref_name: "feature/three", base_ref_name: "main", classification_v6: "clean_but_ci_missing", reason_code_v6: "no_ci_evidence_for_exact_head", confidence_v6: 0.88, recommended_action_v6: "repo.pr.comment_advisory" },
    { number: 4, head_sha: "d".repeat(40), head_ref_name: "feature/four", base_ref_name: "main", classification_v6: "unsafe_to_merge", reason_code_v6: "failing_checks", confidence_v6: 0.94, recommended_action_v6: "fix_before_merge" },
  ],
};

const plan = buildRepositoryMutationPlanV6(report);
assert.equal(plan.schema_version, "tenant_repository_mutation_plan.v6");
assert.equal(plan.items.length, 4);
const closeItem = plan.items.find((item) => item.pr_number === 1);
const mergeItem = plan.items.find((item) => item.pr_number === 2);
const commentItem = plan.items.find((item) => item.pr_number === 3);
const labelItem = plan.items.find((item) => item.pr_number === 4);
assert.equal(closeItem.action, "repo.pr.close_superseded");
assert.equal(closeItem.adapter_implemented, true);
assert.equal(closeItem.execution_status, "recipe_activation_required");
assert.equal(mergeItem.action, "repo.pr.merge_ready");
assert.equal(mergeItem.execution_status, "recipe_activation_required");
assert.equal(commentItem.action, "repo.pr.comment_advisory");
assert.equal(commentItem.execution_status, "approval_required");
assert.equal(labelItem.action, "repo.pr.label");
assert.deepEqual(labelItem.labels, ["governance:unsafe-to-merge"]);
assert.equal(plan.items.every((item) => item.requires_capability_envelope), true);
assert.equal(plan.items.every((item) => item.requires_approval_hold), true);
assert.equal(plan.items.every((item) => item.requires_typed_confirmation), true);
assert.equal(plan.items.every((item) => item.requires_same_cycle_readback), true);
assert.equal(plan.items.every((item) => /^[a-f0-9]{64}$/.test(item.evidence_sha256)), true);
assert.equal(plan.apply_allowed, false);
assert.equal(plan.mutations_executed, false);

const toolNames = TENANT_REPOSITORY_GOVERNANCE_V6_SYSTEM_TOOLS.map((tool) => tool.name);
assert.deepEqual(toolNames, [
  "tenant_repository_intelligence_v6_report",
  "tenant_repository_mutation_plan_v6",
  "platform_repository_mutation_authority_binding_create_v6",
  "tenant_repository_mutation_apply_v6",
  "tenant_repository_mutation_readback_v6",
  "tenant_repository_governance_v6_readiness_smoke",
]);
assert.equal(TENANT_REPOSITORY_GOVERNANCE_V6_SYSTEM_TOOLS[0].requires_admin, false);
assert.equal(TENANT_REPOSITORY_GOVERNANCE_V6_SYSTEM_TOOLS[2].requires_admin, true);
assert.equal(TENANT_REPOSITORY_GOVERNANCE_V6_SYSTEM_TOOLS[3].requires_admin, false);
assert.equal(TENANT_REPOSITORY_GOVERNANCE_V6_SYSTEM_TOOLS[4].requires_admin, false);
assert.equal(TENANT_REPOSITORY_GOVERNANCE_V6_SYSTEM_TOOLS[5].requires_admin, true);
const capabilitySource = fs.readFileSync(new URL("./platformResourceRecipeCapability.js", import.meta.url), "utf8");
assert.match(capabilitySource, /blocked_unscoped_non_admin_resource_access/);
assert.match(capabilitySource, /blocked_workspace_tenant_scope_mismatch/);
assert.match(capabilitySource, /blocked_user_tenant_membership_missing/);
assert.match(capabilitySource, /repository_provider_binding_required/);
assert.match(capabilitySource, /const tenantScoped = Boolean\(binding\.scope\?\.tenant_id \|\| binding\.scope\?\.workspace_id \|\| binding\.scope\?\.user_id\)/);
assert.match(capabilitySource, /const compatible = !tenantScoped/);
assert.match(capabilitySource, /source_installation_id/);
assert.doesNotMatch(capabilitySource, /scopeClauses\.join\(" OR "\)/);

const authSource = fs.readFileSync(new URL("./githubAppAuth.js", import.meta.url), "utf8");
assert.match(authSource, /const cachedInstallationTokens = new Map\(\)/);
assert.match(authSource, /const cacheKey = `\$\{appId\}:\$\{installationId\}`/);
assert.match(authSource, /cachedInstallationTokens\.get\(cacheKey\)/);
assert.match(authSource, /cachedInstallationTokens\.set\(cacheKey/);
assert.match(authSource, /cachedInstallationTokens\.clear\(\)/);

const v2Source = fs.readFileSync(new URL("./repositoryTenantIntelligenceV2.js", import.meta.url), "utf8");
assert.match(v2Source, /file\.filename \|\| file\.path/);

const v6Source = fs.readFileSync(new URL("./repositoryGovernanceV6.js", import.meta.url), "utf8");
for (const token of [
  "repository_mutation_replay_blocked_existing_run",
  "unknown_provider_outcome",
  "capability_resolution_envelope_apply_not_allowed",
  "repository_mutation_head_sha_changed",
  "repository_merge_ready_evidence_failed",
  "repository_fast_forward_protected_branch",
  "repository_mutation_runs_v6",
]) assert.match(v6Source, new RegExp(token));
assert.match(v6Source, /force: false/);
assert.match(v6Source, /hold\.request_id === "capability_resolution_envelope_apply_authorization"/);
assert.match(v6Source, /hold\.correlation_id === envelope\.envelope_id/);
assert.match(v6Source, /context\.apply_authorization_source === "dynamic_capability_apply_authorization_policy"/);
assert.match(v6Source, /context\.allow_external_write === true/);
assert.match(v6Source, /requireNoApprovalRequired: false/);
assert.match(v6Source, /repository_mutation_plan_workspace_mismatch/);
assert.match(v6Source, /let phase = "prewrite"/);
assert.match(v6Source, /phase === "prewrite" \? "failed_prewrite"/);
assert.match(v6Source, /dispatching" && Boolean\(priorRun\.provider_write_started_at\)/);
assert.match(v6Source, /loadMutationPlanV6\(run\.plan_id, \{ allowExpired: true \}\)/);
assert.match(v6Source, /function mutationOperationIntentV6/);
assert.match(v6Source, /acceptedIntents: \[mutationOperationIntentV6\(item\.action\)\]/);
assert.match(v6Source, /sha_by_path: shaByPath/);
assert.match(v6Source, /const headFileSha = s\(file\.sha\) \|\| null/);
assert.doesNotMatch(v6Source, /async function fetchFileSha/);
assert.match(v6Source, /status\?per_page=100/);
assert.match(v6Source, /compareFilesComplete/);
assert.match(v6Source, /commit_statuses_page_complete/);
assert.match(v6Source, /repository_mutation_no_provider_write_to_read_back/);

const routesSource = fs.readFileSync(new URL("./routes/systemLayerRoutes.js", import.meta.url), "utf8");
assert.match(routesSource, /source_key: "repository_governance_v6"/);
assert.match(routesSource, /TENANT_REPOSITORY_GOVERNANCE_V6_SYSTEM_TOOLS/);
for (const handler of [
  "createRepositoryMutationAuthorityBindingV6",
  "tenantRepositoryMutationApplyV6",
  "tenantRepositoryMutationReadbackV6",
]) assert.match(routesSource, new RegExp(handler));

const migrationSource = fs.readFileSync(new URL("./migrations/1011_sprint69_governed_repository_engine_v6.sql", import.meta.url), "utf8");
for (const token of [
  "repository_mutation_plans_v6",
  "repository_mutation_runs_v6",
  "github_repo_comment_authority",
  "github_repo_patch_authority",
  "repo.pr.close_superseded",
  "repo.file.patch_apply",
  "repo.pr.merge_ready",
  "tenant_repository_mutation_apply_v6",
  "tenant_repository_mutation_readback_v6",
  "unique_plan_item_run_ledger",
  "bind_tool_github_tenant_repository_mutation_apply_v6",
  "repo_pr_comment_advisory_v6_apply_policy",
  "repo.pr.comment_advisory.apply",
  "negative_gate_passed_positive_apply_pending",
]) assert.match(migrationSource, new RegExp(token.replaceAll(".", "\\.")));
assert.match(migrationSource, /repository_governance_v6\x27[\s\S]*?,6,\x27active\x27/);
assert.match(migrationSource, /force_push_allowed',false/);
assert.match(migrationSource, /readback_failed\x27,\x27failed_prewrite\x27,\x27unknown_provider_outcome/);
const tenantExportStart = migrationSource.indexOf("INSERT INTO `tenant_platform_endpoint_tools`");
const tenantExportEnd = migrationSource.indexOf("INSERT INTO `platform_resource_authority_requirements`");
const tenantExportSection = migrationSource.slice(tenantExportStart, tenantExportEnd);
for (const toolName of [
  "tenant_repository_intelligence_v6_report",
  "tenant_repository_mutation_plan_v6",
  "tenant_repository_mutation_apply_v6",
  "tenant_repository_mutation_readback_v6",
]) assert.match(tenantExportSection, new RegExp(`\\x27${toolName}\\x27`));
for (const toolName of [
  "platform_repository_mutation_authority_binding_create_v6",
  "tenant_repository_governance_v6_readiness_smoke",
]) assert.doesNotMatch(tenantExportSection, new RegExp(`\\x27${toolName}\\x27`));
assert.match(migrationSource, /admin_only_tools/);


const releaseSource = fs.readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");
assert.match(releaseSource, /repository_mutation_runs_v6/);
assert.match(releaseSource, /tool_count_expected \|\| 0\) !== 6/);
assert.match(releaseSource, /tenant_repository_mutation_apply_v6/);
assert.match(releaseSource, /tenant_repository_mutation_readback_v6/);
assert.match(releaseSource, /repo_pr_comment_advisory_v6_apply_policy/);
assert.match(releaseSource, /applyPolicy\.operation_intent !== "repo\.pr\.comment_advisory\.apply"/);
assert.match(releaseSource, /Number\(certification\.apply_allowed\) !== 0/);
assert.match(releaseSource, /Admin-only V6 tools exposed to tenant catalog/);
assert.match(releaseSource, /tenant_catalog_admin_exposure/);

const envelopeCreatorSource = fs.readFileSync(new URL("./scripts/capability-resolution-envelope-create.mjs", import.meta.url), "utf8");
for (const flag of ["--plan-id", "--plan-item-id", "--resource-uri", "--recipe-key", "--expected-commit-sha"]) assert.match(envelopeCreatorSource, new RegExp(flag));
assert.match(envelopeCreatorSource, /request_context: \{ \.\.\.\(dryRun\.request_context \|\| \{\}\), \.\.\.bindingContext \}/);
assert.match(envelopeCreatorSource, /--expected-commit-sha must be a 40-character hexadecimal commit SHA/);

const openapiSource = fs.readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");
for (const toolName of toolNames) assert.match(openapiSource, new RegExp(toolName));

console.log("repository governance v6 tests passed");
