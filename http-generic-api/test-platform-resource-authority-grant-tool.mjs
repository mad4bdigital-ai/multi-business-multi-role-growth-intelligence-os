import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPlatformResourceAuthorityGrantPlan } from "./platformResourceAuthorityGrantTool.js";

const base = {
  tenant_id: "00000000-0000-0000-0000-000000000000",
  workspace_id: "b50db01b-617e-4b7a-8bda-6bf4876f754f",
  user_id: "f242960c-2857-4b4d-a504-ee50f8a278b4",
  resource_type: "github_repo",
  resource_uri: "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
  recipe_key: "repo_patch_batch_apply",
  resource_ref: {
    branch: "gpt/007-resource-authority-dynamic-grants-20260703",
    expected_commit_sha: "085df480799a021083afc00ba6389a89e681012e",
  },
};

const dry = buildPlatformResourceAuthorityGrantPlan(base);
assert.equal(dry.mode, "dry_run");
assert.equal(dry.permission_level, "patch");
assert.equal(dry.resource_ref.main_write_allowed, false);
assert.equal(dry.resource_ref.protected_branch_write_allowed, false);
assert.equal(dry.resource_ref.requires_same_cycle_readback, true);
assert.equal(dry.secrets_included, false);
assert.match(dry.expected_confirm, /^GRANT_RESOURCE_AUTHORITY_/);

assert.throws(() => buildPlatformResourceAuthorityGrantPlan({ ...base, mode: "apply", confirm: "WRONG", ttl_minutes: 60 }), /exact typed confirmation/);
assert.throws(() => buildPlatformResourceAuthorityGrantPlan({ ...base, mode: "apply", confirm: dry.expected_confirm }), /ttl_minutes/);
assert.throws(() => buildPlatformResourceAuthorityGrantPlan({ ...base, resource_ref: { ...base.resource_ref, branch: "main" } }), /protected branches/);
assert.throws(() => buildPlatformResourceAuthorityGrantPlan({ ...base, permission_level: "admin" }), /cannot exceed/);
assert.throws(() => buildPlatformResourceAuthorityGrantPlan({ ...base, allowed_modes: ["merge"] }), /outside the recipe allowlist/);

const apply = buildPlatformResourceAuthorityGrantPlan({ ...base, mode: "apply", confirm: dry.expected_confirm, ttl_minutes: 30 });
assert.equal(apply.ttl_minutes, 30);

const shellReadBase = {
  tenant_id: base.tenant_id,
  workspace_id: base.workspace_id,
  user_id: base.user_id,
  resource_type: "shell_alias",
  resource_uri: "shell://dev_governed_migration_client",
  recipe_key: "dev_growth_intelligence_pilot_read",
  resource_ref: { expected_commit_sha: "26a5e15aa6477a662a2e10073bd8613d34806fa2" },
};
const shellRead = buildPlatformResourceAuthorityGrantPlan(shellReadBase);
assert.equal(shellRead.permission_level, "diagnostic");
assert.deepEqual(shellRead.allowed_modes, ["dev_governed_migration_client"]);
assert.equal(shellRead.resource_ref.alias, "dev_governed_migration_client");
assert.equal(shellRead.resource_ref.arbitrary_shell_allowed, false);
assert.equal(shellRead.resource_ref.production_execution_allowed, false);
assert.equal(shellRead.resource_ref.requires_same_cycle_readback, true);

const shellApplyBase = {
  ...shellReadBase,
  resource_uri: "shell://dev_governed_migration_client_apply",
  recipe_key: "dev_growth_intelligence_pilot_apply",
};
const shellApplyDry = buildPlatformResourceAuthorityGrantPlan(shellApplyBase);
assert.equal(shellApplyDry.permission_level, "patch");
assert.deepEqual(shellApplyDry.allowed_modes, ["dev_governed_migration_client_apply"]);
assert.equal(shellApplyDry.resource_ref.alias, "dev_governed_migration_client_apply");
const shellApply = buildPlatformResourceAuthorityGrantPlan({ ...shellApplyBase, mode: "apply", confirm: shellApplyDry.expected_confirm, ttl_minutes: 15 });
assert.equal(shellApply.ttl_minutes, 15);

assert.throws(() => buildPlatformResourceAuthorityGrantPlan({ ...shellReadBase, resource_uri: "shell://powershell" }), /exact allowlisted shell alias/);
assert.throws(() => buildPlatformResourceAuthorityGrantPlan({ ...shellReadBase, allowed_modes: ["dev_governed_migration_client_apply"] }), /outside the recipe allowlist/);
assert.throws(() => buildPlatformResourceAuthorityGrantPlan({ ...shellReadBase, resource_type: "github_repo" }), /does not match the selected grant recipe/);
assert.throws(() => buildPlatformResourceAuthorityGrantPlan({ ...shellReadBase, resource_ref: {} }), /40 character commit SHA/);

const routeFile = fs.readFileSync(new URL("./routes/resourceAuthorityGrantRoutes.js", import.meta.url), "utf8");
assert(routeFile.includes("/admin/resource-authority/grants"));
assert(routeFile.includes("requireAdminPrincipal"));

const source = fs.readFileSync(new URL("./platformResourceAuthorityGrantTool.js", import.meta.url), "utf8");
assert(source.includes("dev_growth_intelligence_pilot_read"));
assert(source.includes("dev_growth_intelligence_pilot_apply"));
assert(source.includes("shell://"));
assert(source.includes("arbitrary_shell_allowed: false"));
assert(source.includes("production_execution_allowed: false"));

const migration = fs.readFileSync(new URL("./migrations/20260704_platform_resource_authority_grant_tool.sql", import.meta.url), "utf8");
assert(migration.includes("platform_resource_authority_grant_apply"));
assert(migration.includes("dry_run_default"));
assert(migration.includes("typed_confirmation"));
assert(migration.includes("readback"));
assert(migration.includes("no_secrets"));
assert(!/\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(migration));

console.log("platform resource authority grant tool tests passed");
