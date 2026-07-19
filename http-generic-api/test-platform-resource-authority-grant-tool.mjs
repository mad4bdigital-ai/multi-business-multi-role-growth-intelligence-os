import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPlatformResourceAuthorityGrantPlan } from "./platformResourceAuthorityGrantTool.js";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";

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
assert.equal(dry.resource_ref.requires_expected_commit_sha, true);
assert.equal(dry.resource_ref.requires_typed_confirmation, true);
assert.equal(dry.resource_ref.requires_same_cycle_readback, true);
assert.equal(dry.secrets_included, false);
assert.match(dry.expected_confirm, /^GRANT_RESOURCE_AUTHORITY_/);
assert.equal(dry.principal.principal_type, "user");
assert.equal(dry.principal.principal_id, base.user_id);
assert.deepEqual(dry.resource_ref.principal, { principal_type: "user", principal_id: base.user_id });

assert.throws(() => buildPlatformResourceAuthorityGrantPlan({ ...base, mode: "apply", confirm: "WRONG", ttl_minutes: 60 }), /exact typed confirmation/);
assert.throws(() => buildPlatformResourceAuthorityGrantPlan({ ...base, mode: "apply", confirm: dry.expected_confirm }), /ttl_minutes/);
assert.throws(() => buildPlatformResourceAuthorityGrantPlan({ ...base, resource_ref: { ...base.resource_ref, branch: "main" } }), /protected branches/);
assert.throws(() => buildPlatformResourceAuthorityGrantPlan({ ...base, permission_level: "admin" }), /cannot exceed/);
assert.throws(() => buildPlatformResourceAuthorityGrantPlan({ ...base, allowed_modes: ["merge"] }), /outside the recipe allowlist/);

const apply = buildPlatformResourceAuthorityGrantPlan({ ...base, mode: "apply", confirm: dry.expected_confirm, ttl_minutes: 30 });
assert.equal(apply.ttl_minutes, 30);

const servicePrincipalBase = {
  ...base,
  user_id: undefined,
  principal: {
    principal_type: "service",
    principal_id: "platform_admin_service",
  },
};
const servicePrincipalDry = buildPlatformResourceAuthorityGrantPlan(servicePrincipalBase);
assert.equal(servicePrincipalDry.user_id, "platform_admin_service");
assert.equal(servicePrincipalDry.principal.principal_type, "service");
assert.equal(servicePrincipalDry.principal.principal_id, "platform_admin_service");
assert.deepEqual(servicePrincipalDry.resource_ref.principal, {
  principal_type: "service",
  principal_id: "platform_admin_service",
});

const backendPrincipalDry = buildPlatformResourceAuthorityGrantPlan({
  ...base,
  user_id: undefined,
  principal: { principal_type: "backend_api_key", principal_id: "platform_backend_api_key" },
});
assert.equal(backendPrincipalDry.principal.principal_type, "backend_api_key");
assert.throws(
  () => buildPlatformResourceAuthorityGrantPlan({ ...servicePrincipalBase, principal: { principal_type: "robot", principal_id: "x" } }),
  /principal_type must be user, service, or backend_api_key/
);
assert.throws(
  () => buildPlatformResourceAuthorityGrantPlan({ ...servicePrincipalBase, principal: { principal_type: "service" } }),
  /principal_id is required/
);
assert.throws(
  () => buildPlatformResourceAuthorityGrantPlan({ ...servicePrincipalBase, principal: { principal_type: "service", principal_id: "invalid principal" } }),
  /unsupported characters/
);
assert.throws(
  () => buildPlatformResourceAuthorityGrantPlan({ ...servicePrincipalBase, user_id: base.user_id }),
  /may only accompany a matching user principal/
);
assert.throws(
  () => buildPlatformResourceAuthorityGrantPlan({ ...servicePrincipalBase, principal: { principal_type: "user", principal_id: "not-a-uuid" } }),
  /must be a UUID/
);

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

const oauthSmokeBase = {
  ...shellReadBase,
  resource_uri: "shell://tenant_gpt_oauth_live_smoke",
  recipe_key: "tenant_gpt_oauth_live_smoke",
};
const oauthSmokeDry = buildPlatformResourceAuthorityGrantPlan(oauthSmokeBase);
assert.equal(oauthSmokeDry.permission_level, "diagnostic");
assert.deepEqual(oauthSmokeDry.allowed_modes, ["tenant_gpt_oauth_live_smoke"]);
assert.equal(oauthSmokeDry.resource_ref.alias, "tenant_gpt_oauth_live_smoke");
assert.equal(oauthSmokeDry.resource_ref.arbitrary_shell_allowed, false);
assert.equal(oauthSmokeDry.resource_ref.production_execution_allowed, true);
assert.equal(oauthSmokeDry.resource_ref.requires_same_cycle_readback, true);
const oauthSmokeApply = buildPlatformResourceAuthorityGrantPlan({ ...oauthSmokeBase, mode: "apply", confirm: oauthSmokeDry.expected_confirm, ttl_minutes: 10 });
assert.equal(oauthSmokeApply.ttl_minutes, 10);

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
assert(source.includes("tenant_gpt_oauth_live_smoke"));
assert(source.includes("shell://"));
assert(source.includes("arbitrary_shell_allowed: false"));
assert(source.includes("production_execution_allowed: false"));
assert(source.includes("PRINCIPAL_TYPES"));
assert(source.includes("principal_type"));
assert(source.includes("legacy_user_id"));
assert(source.includes("production_execution_allowed: recipe.production_execution_allowed === true"));

const migration = fs.readFileSync(new URL("./migrations/20260704_platform_resource_authority_grant_tool.sql", import.meta.url), "utf8");
assert(migration.includes("platform_resource_authority_grant_apply"));
assert(migration.includes("dry_run_default"));
assert(migration.includes("typed_confirmation"));
assert(migration.includes("readback"));
assert(migration.includes("no_secrets"));
assert(!/\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(migration));

const contractMigrationName = "20260718_expand_resource_authority_shell_alias_contract.sql";
const contractMigration = fs.readFileSync(new URL(`./migrations/${contractMigrationName}`, import.meta.url), "utf8");
for (const marker of [
  "platform_resource_authority_grant_apply",
  "shell_alias",
  "dev_growth_intelligence_pilot_read",
  "dev_growth_intelligence_pilot_apply",
  "dev_governed_migration_client",
  "dev_governed_migration_client_apply",
  "no_arbitrary_shell",
  "expected_commit_sha",
]) {
  assert.ok(contractMigration.includes(marker), `shell alias contract migration missing ${marker}`);
}
assert.doesNotMatch(contractMigration, /shell:\/\/powershell|shell:\/\/bash|arbitrary_shell_allowed[^\n]*true/i);
assert.doesNotMatch(contractMigration, /^\s*(DELETE FROM|DROP|TRUNCATE|ALTER)\b/mi);

for (const marker of [
  "no_provider_call=true",
  "no_credential_payload_read=true",
  "no_raw_secrets=true",
  "no_external_send=true",
  "no_external_write=true",
  "secrets_included=false",
]) {
  assert.ok(contractMigration.includes(marker), `shell alias contract migration missing safety marker ${marker}`);
}

const contractPreflight = assessMigrationSqlPreflight(contractMigrationName, contractMigration);
assert.equal(contractPreflight.status, "pass", JSON.stringify(contractPreflight, null, 2));
assert.equal(contractPreflight.risk_count, 0, JSON.stringify(contractPreflight, null, 2));
assert.equal(contractPreflight.secrets_included, false, JSON.stringify(contractPreflight, null, 2));

const principalContractMigrationName = "20260719_expand_resource_authority_principal_contract.sql";
const principalContractMigration = fs.readFileSync(new URL(`./migrations/${principalContractMigrationName}`, import.meta.url), "utf8");
for (const marker of [
  "platform_resource_authority_grant_apply",
  "principal_type",
  "principal_id",
  "backend_api_key",
  "platform_admin_service",
  "deprecated",
  "anyOf",
]) {
  assert.ok(principalContractMigration.includes(marker), `principal contract migration missing ${marker}`);
}
assert.doesNotMatch(principalContractMigration, /^\s*(DELETE FROM|DROP|TRUNCATE|ALTER)\b/mi);
for (const marker of [
  "no_provider_call=true",
  "no_credential_payload_read=true",
  "no_raw_secrets=true",
  "no_external_write=true",
  "secrets_included=false",
]) {
  assert.ok(principalContractMigration.includes(marker), `principal contract migration missing safety marker ${marker}`);
}
const principalContractPreflight = assessMigrationSqlPreflight(principalContractMigrationName, principalContractMigration);
assert.equal(principalContractPreflight.status, "pass", JSON.stringify(principalContractPreflight, null, 2));
assert.equal(principalContractPreflight.risk_count, 0, JSON.stringify(principalContractPreflight, null, 2));
const oauthSmokeContractMigrationName = "20260719_expand_resource_authority_tenant_gpt_oauth_smoke.sql";
const oauthSmokeContractMigration = fs.readFileSync(new URL(`./migrations/${oauthSmokeContractMigrationName}`, import.meta.url), "utf8");
for (const marker of [
  "tenant_gpt_oauth_live_smoke",
  "bounded_production_smoke",
  "temporary",
  "diagnostic",
  "typed confirmation",
  "same-cycle readback",
  "arbitrary_shell_allowed=false",
  "temporary_production_smoke=true",
  "secrets_included=false",
]) {
  assert.ok(oauthSmokeContractMigration.includes(marker), `OAuth smoke resource authority migration missing ${marker}`);
}
assert.doesNotMatch(oauthSmokeContractMigration, /shell:\/\/powershell|shell:\/\/bash|client_secret|backend_api_key|jwt_secret/i);
assert.doesNotMatch(oauthSmokeContractMigration, /^\s*(DELETE FROM|DROP|TRUNCATE|ALTER)\b/mi);
const oauthSmokeContractPreflight = assessMigrationSqlPreflight(oauthSmokeContractMigrationName, oauthSmokeContractMigration);
assert.equal(oauthSmokeContractPreflight.status, "pass", JSON.stringify(oauthSmokeContractPreflight, null, 2));
assert.equal(oauthSmokeContractPreflight.risk_count, 0, JSON.stringify(oauthSmokeContractPreflight, null, 2));
assert.equal(oauthSmokeContractPreflight.secrets_included, false, JSON.stringify(oauthSmokeContractPreflight, null, 2));

console.log("platform resource authority grant tool tests passed");
