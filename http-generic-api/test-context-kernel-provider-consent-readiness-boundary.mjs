import assert from "node:assert/strict";

import { createAuthenticatedProviderConsentUseCaseService } from "./contextKernel/application/index.js";

const readinessCalls = [];
let principalCalls = 0;
const service = createAuthenticatedProviderConsentUseCaseService({
  providerConsentReadinessRepository: {
    async findProviderConsentReadiness(input) {
      readinessCalls.push(input);
      return {
        status: "blocked",
        migrationReadbackVerified: false,
        applicationUseCasesEnabled: false,
        reasonCode: "migration_readback_missing",
      };
    },
  },
  principalResolverService: {
    async resolve() {
      principalCalls += 1;
      throw new Error("Principal resolution must not run while global readiness is blocked.");
    },
  },
  workspaceOwnershipRepository: { async findWorkspaceOwnership() { return null; } },
  brandManagementAuthorityRepository: { async findBrandManagementAuthority() { return null; } },
  connectionOwnershipRepository: { async findConnectionOwnership() { return null; } },
  providerConnectionAccessRepository: {
    async listProviderConnections() { return { connections: [] }; },
    async revokeProviderConnection() { return null; },
  },
  providerConsentService: { async issue() { return null; } },
});

await assert.rejects(
  () => service.list({
    authentication: {
      principalType: "tenant_user",
      principalRef: "user-a",
      status: "active",
      authorizedTenantRefs: ["tenant-a"],
    },
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    brandRef: "brand-a",
  }),
  (error) => {
    assert.equal(error?.code, "provider_consent_runtime_not_ready");
    return true;
  },
);

assert.deepEqual(readinessCalls, [{ operation: "list" }]);
assert.equal(principalCalls, 0);

console.log("context kernel provider consent global readiness boundary tests passed");
