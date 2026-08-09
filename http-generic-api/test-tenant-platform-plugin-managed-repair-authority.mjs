import assert from "node:assert/strict";
import { resolveTenantPlatformPluginManagedRepairAuthority } from "./tenantPlatformPluginManagedRepairAuthority.js";

const baseAuth = {
  mode: "user_jwt",
  is_admin: false,
  tenant_id: "tenant-1",
  user_id: "user-1",
  tenant_role: "member",
};

function scopeRepository({ workspaces = [{ workspaceRef: "workspace-1", tenantRef: "tenant-1" }], membership = { status: "active", role: "admin" } } = {}) {
  return {
    async findAuthorizedScope({ tenantRef, userRef }) {
      assert.equal(tenantRef, "tenant-1");
      assert.equal(userRef, "user-1");
      return { membership, workspaces };
    },
  };
}

function ownershipRepository(overrides = {}) {
  return {
    async findWorkspaceOwnership({ tenantRef, workspaceRef }) {
      assert.equal(tenantRef, "tenant-1");
      return {
        tenantRef,
        workspaceRef,
        workspaceOwnershipType: "company",
        ownerUserRef: null,
        ownershipRevision: 7,
        ...overrides,
      };
    },
  };
}

const company = await resolveTenantPlatformPluginManagedRepairAuthority({
  authContext: baseAuth,
  workspaceRef: "workspace-1",
  authorizedScopeRepository: scopeRepository(),
  workspaceOwnershipRepository: ownershipRepository(),
});
assert.equal(company.mode, "user_jwt");
assert.equal(company.tenant_id, "tenant-1");
assert.equal(company.user_id, "user-1");
assert.equal(company.tenant_role, "admin");
assert.equal(company.workspace_id, "workspace-1");
assert.equal(company.workspace_ownership_type, "company");
assert.equal(company.workspace_ownership_revision, 7);
assert.equal(company.source, "context_kernel_authorized_scope_and_workspace_ownership");
assert.equal(company.secrets_included, false);

const personal = await resolveTenantPlatformPluginManagedRepairAuthority({
  authContext: baseAuth,
  workspaceRef: "workspace-1",
  authorizedScopeRepository: scopeRepository(),
  workspaceOwnershipRepository: ownershipRepository({
    workspaceOwnershipType: "personal",
    ownerUserRef: "user-1",
  }),
});
assert.equal(personal.workspace_ownership_type, "personal");

await assert.rejects(
  resolveTenantPlatformPluginManagedRepairAuthority({
    authContext: baseAuth,
    workspaceRef: "workspace-other",
    authorizedScopeRepository: scopeRepository(),
    workspaceOwnershipRepository: ownershipRepository(),
  }),
  (error) => error.code === "tenant_managed_repair_workspace_membership_required",
);

await assert.rejects(
  resolveTenantPlatformPluginManagedRepairAuthority({
    authContext: baseAuth,
    workspaceRef: "workspace-1",
    authorizedScopeRepository: scopeRepository({ membership: { status: "inactive", role: "admin" } }),
    workspaceOwnershipRepository: ownershipRepository(),
  }),
  (error) => error.code === "tenant_managed_repair_active_membership_required",
);

await assert.rejects(
  resolveTenantPlatformPluginManagedRepairAuthority({
    authContext: baseAuth,
    workspaceRef: "workspace-1",
    authorizedScopeRepository: scopeRepository(),
    workspaceOwnershipRepository: ownershipRepository({
      workspaceOwnershipType: "personal",
      ownerUserRef: "user-other",
    }),
  }),
  (error) => error.code === "tenant_managed_repair_personal_owner_mismatch",
);

await assert.rejects(
  resolveTenantPlatformPluginManagedRepairAuthority({
    authContext: baseAuth,
    workspaceRef: "workspace-1",
    authorizedScopeRepository: scopeRepository(),
    workspaceOwnershipRepository: ownershipRepository({ workspaceOwnershipType: "legacy" }),
  }),
  (error) => error.code === "tenant_managed_repair_workspace_ownership_unclassified",
);

await assert.rejects(
  resolveTenantPlatformPluginManagedRepairAuthority({
    authContext: { ...baseAuth, mode: "backend_api", is_admin: true },
    workspaceRef: "workspace-1",
    authorizedScopeRepository: scopeRepository(),
    workspaceOwnershipRepository: ownershipRepository(),
  }),
  (error) => error.code === "tenant_managed_repair_user_jwt_required",
);

console.log("tenant Platform Plugin managed repair authority tests passed");
