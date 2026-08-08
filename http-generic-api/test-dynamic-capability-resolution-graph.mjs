import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  authorityStatus,
  hasExactAdminResourceAuthority,
  permissionSatisfiesResourceOperation,
} from "./scripts/capability-resolution-dry-run.mjs";

const script = readFileSync(new URL("./scripts/capability-resolution-dry-run.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/221_sprint67_dynamic_capability_resolution_graph.sql", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(script, /dynamic_capability_resolution_policy_v1/);
assert.match(script, /dynamic_capability_source_tiers_v1/);
assert.match(script, /v_app_integration_capability_map/);
assert.match(script, /workspace_registry/);
assert.match(script, /v_workspace_resource_grant_effective/);
assert.match(script, /platform_resource_authority_bindings/);
assert.match(script, /brand_core/);
assert.match(script, /business_activity_types/);
assert.match(script, /credential_bindings/);
assert.match(script, /runtime_dispatch_certification_registry/);
assert.match(script, /user_app_connections/);
assert.match(script, /runCapabilityResolutionDryRun/);
assert.match(script, /--principal-type/);
assert.match(script, /--principal-id/);
assert.match(script, /--resource-uri/);
assert.match(script, /--operation-mode/);
assert.match(script, /exact_platform_resource_authority_present/);
assert.match(script, /approval_required/);
assert.match(script, /quota_required/);
assert.match(script, /audit_required: true/);
assert.match(script, /certifications\.some\(\(row\) => Number\(row\.requires_readback \|\| 0\) === 1\)/);
assert.match(script, /secrets_included: false/);
assert.match(script, /This is a dry-run envelope only; no tool\/app\/runtime was executed/);
assert.doesNotMatch(script, /decryptToken|value_ciphertext|private_key|oauth_token/i);
assert.doesNotMatch(script, /fetch\(|axios|child_process|exec\(|spawn\(/);
assert.doesNotMatch(script, /endsWith\(["']_service["']\)/);
assert.doesNotMatch(script, /userRole\s*===\s*["']admin["']/);

const tenantId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const resourceUri = "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
const principal = { principal_type: "service", principal_id: "platform_admin_service" };
const resourceRef = {
  branch: "gpt/019-governed-database-lifecycle-pressure-relief-20260807",
  expected_commit_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  principal,
};
const exactBinding = {
  binding_id: "270b0d29-c7fc-4520-83f3-630162861ff7",
  tenant_id: tenantId,
  workspace_id: workspaceId,
  user_id: principal.principal_id,
  resource_type: "github_repo",
  resource_uri: resourceUri,
  resource_ref_json: JSON.stringify(resourceRef),
  recipe_key: "repo_patch_batch_apply",
  permission_level: "patch",
  allowed_modes_json: JSON.stringify(["write_file", "replace_block", "apply_unified_diff", "delete_file", "atomic_change_set"]),
  status: "active",
  expires_at: "2099-01-01T00:00:00.000Z",
};
const exactAuthorityArgs = {
  principal,
  bindings: [exactBinding],
  tenantId,
  workspaceId,
  resourceType: "github_repo",
  resourceUri,
  recipeKey: "repo_patch_batch_apply",
  operationMode: "atomic_change_set",
  now: new Date("2026-08-08T08:00:00.000Z"),
};

// Case A: typed admin service principal + exact active binding succeeds.
assert.equal(hasExactAdminResourceAuthority(exactAuthorityArgs), true);
assert.equal(permissionSatisfiesResourceOperation("patch", "atomic_change_set"), true);

const exactAuthorityStatus = authorityStatus({
  workspace: { workspace_id: workspaceId },
  grants: [],
  platformResourceAuthorityBindings: [exactBinding],
  principal,
  resourceType: "github_repo",
  resourceUri,
  recipeKey: "repo_patch_batch_apply",
  operationMode: "atomic_change_set",
  tenantId,
  workspaceId,
  brandKey: "",
  brandCore: null,
  activity: null,
  risk: "high",
  certifications: [],
  sourceTiers: { selected_source_tier: "tenant_managed" },
});
assert.equal(exactAuthorityStatus.exact_platform_resource_authority, true);
assert.equal(exactAuthorityStatus.missing.includes("workspace_resource_grant_missing_for_high_risk_operation"), false);
assert.equal(exactAuthorityStatus.missing.includes("elevated_permission_missing"), false);
assert.equal(exactAuthorityStatus.missing.includes("dispatch_certification_missing_or_not_allowed"), true);

// Case B: exact repository URI is mandatory.
assert.equal(hasExactAdminResourceAuthority({
  ...exactAuthorityArgs,
  resourceUri: "github://mad4bdigital-ai/another-repo",
}), false);

// Case C: expired bindings never authorize.
assert.equal(hasExactAdminResourceAuthority({
  ...exactAuthorityArgs,
  bindings: [{ ...exactBinding, expires_at: "2026-08-08T07:59:59.000Z" }],
}), false);

// Case D: recipe mismatch remains blocked.
assert.equal(hasExactAdminResourceAuthority({
  ...exactAuthorityArgs,
  recipeKey: "github_pr_create",
}), false);

// Case E: operation mode must be explicitly allowed by the exact binding.
assert.equal(hasExactAdminResourceAuthority({
  ...exactAuthorityArgs,
  operationMode: "branch_delete",
}), false);

// Case F: tenant/user principals cannot borrow platform service authority.
const tenantPrincipal = { principal_type: "user", principal_id: "33333333-3333-4333-8333-333333333333" };
assert.equal(hasExactAdminResourceAuthority({ ...exactAuthorityArgs, principal: tenantPrincipal }), false);
const tenantAuthorityStatus = authorityStatus({
  workspace: { workspace_id: workspaceId },
  grants: [],
  platformResourceAuthorityBindings: [exactBinding],
  principal: tenantPrincipal,
  resourceType: "github_repo",
  resourceUri,
  recipeKey: "repo_patch_batch_apply",
  operationMode: "atomic_change_set",
  tenantId,
  workspaceId,
  brandKey: "",
  brandCore: null,
  activity: null,
  risk: "high",
  certifications: [{ dispatch_allowed: 1 }],
  sourceTiers: { selected_source_tier: "tenant_managed" },
});
assert.equal(tenantAuthorityStatus.missing.includes("workspace_resource_grant_missing_for_high_risk_operation"), true);
assert.equal(tenantAuthorityStatus.missing.includes("elevated_permission_missing"), true);

// Case G: a service principal without an exact binding remains blocked.
const noBindingStatus = authorityStatus({
  workspace: { workspace_id: workspaceId },
  grants: [],
  platformResourceAuthorityBindings: [],
  principal,
  resourceType: "github_repo",
  resourceUri,
  recipeKey: "repo_patch_batch_apply",
  operationMode: "atomic_change_set",
  tenantId,
  workspaceId,
  brandKey: "",
  brandCore: null,
  activity: null,
  risk: "high",
  certifications: [{ dispatch_allowed: 1 }],
  sourceTiers: { selected_source_tier: "tenant_managed" },
});
assert.equal(noBindingStatus.missing.includes("workspace_resource_grant_missing_for_high_risk_operation"), true);
assert.equal(noBindingStatus.missing.includes("elevated_permission_missing"), true);

// Wildcard authority is never accepted for this high-risk service-principal path.
assert.equal(hasExactAdminResourceAuthority({
  ...exactAuthorityArgs,
  bindings: [{ ...exactBinding, resource_uri: "github://mad4bdigital-ai/*" }],
  resourceUri: "github://mad4bdigital-ai/*",
}), false);
assert.equal(hasExactAdminResourceAuthority({
  ...exactAuthorityArgs,
  bindings: [{ ...exactBinding, allowed_modes_json: JSON.stringify(["*"]) }],
}), false);

assert.match(migration, /dynamic_capability_resolution_policy_v1/);
assert.match(migration, /dynamic_capability_source_tiers_v1/);
assert.match(migration, /capability_resolution_dry_run/);
assert.match(migration, /platform_managed_fallback/);
assert.match(migration, /requires_quota.*true|requires_quota',true/s);
assert.match(migration, /requires_audit_log.*true|requires_audit_log',true/s);
assert.match(migration, /requires_user_disclosure.*true|requires_user_disclosure',true/s);
assert.match(migration, /admin_personal_oauth_must_not_be_shared.*true|admin_personal_oauth_must_not_be_shared',true/s);
assert.match(migration, /extended_workspace_archetypes_policy_only/);
assert.match(migration, /current_workspace_type_enum/);
assert.match(migration, /no_secrets_returned/);
assert.match(migration, /must_not_include/);
assert.match(migration, /no_execution/);
assert.match(migration, /secrets_included',false/);
assert.match(migration, /admin_platform_endpoint_tools/);
assert.doesNotMatch(migration, /ALTER\s+TABLE\s+workspace_registry/i);
assert.doesNotMatch(migration, /OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

assert.match(adminCli, /capability_resolution_dry_run/);
assert.match(adminCli, /scripts\/capability-resolution-dry-run\.mjs/);
assert.match(runner, /221_sprint67_dynamic_capability_resolution_graph\.sql/);

const refinement = readFileSync(new URL("./migrations/222_sprint67_dynamic_capability_resolution_risk_refinement.sql", import.meta.url), "utf8");
assert.match(refinement, /source_tier_priority_high_risk/);
assert.match(refinement, /client_dedicated','remote_dedicated_runtime/);
assert.match(refinement, /low_risk_workspace_context_required/);
assert.match(refinement, /false/);
assert.match(refinement, /dynamic_capability_resolution_policy_v1/);
assert.doesNotMatch(refinement, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.match(runner, /222_sprint67_dynamic_capability_resolution_risk_refinement\.sql/);

console.log("Dynamic capability resolution graph guard passed");
