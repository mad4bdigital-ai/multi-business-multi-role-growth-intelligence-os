import assert from "node:assert/strict";

import {
  createPrincipalResolverService,
  PrincipalResolutionError,
} from "./contextKernel/application/principalResolverService.js";

const now = new Date("2026-07-29T12:00:00.000Z");

const principalRecords = new Map([
  [
    "tenant-user-1",
    {
      principalRef: "tenant-user-1",
      principalType: "tenant_user",
      status: "active",
      authorizedTenantRefs: ["tenant-a", "tenant-b", "tenant-c"],
      sourceRef: "principal-registry-row-1",
      version: "principal-v4",
      attributes: {
        region: "eu",
        accessToken: "must-not-escape",
        nested: {
          displayName: "Tenant User",
          privateKey: "must-not-escape",
        },
      },
    },
  ],
  [
    "admin-1",
    {
      principalRef: "admin-1",
      principalType: "admin",
      status: "active",
      authorizedTenantRefs: ["*"],
      sourceRef: "principal-registry-row-admin",
      version: "principal-v2",
      attributes: { actorClass: "platform_admin" },
    },
  ],
  [
    "agent-1",
    {
      principalRef: "agent-1",
      principalType: "delegated_agent",
      status: "active",
      authorizedTenantRefs: ["tenant-a"],
      delegatedByPrincipalRef: "support-1",
      sourceRef: "principal-registry-row-agent",
      version: "principal-v3",
      attributes: { actorClass: "agent" },
    },
  ],
]);

const scopeReadbacks = new Map([
  [
    "tenant-user-1",
    {
      tenantRefs: ["tenant-a", "tenant-b"],
      sourceRef: "membership-view-tenant-user-1",
      version: "membership-v7",
    },
  ],
  [
    "agent-1",
    {
      tenantRefs: ["tenant-a"],
      sourceRef: "membership-view-agent-1",
      version: "membership-v2",
    },
  ],
]);

const principalRepository = {
  async findPrincipal({ principalRef }) {
    return principalRecords.get(principalRef) ?? null;
  },
};

const authorizedScopeRepository = {
  async listAuthorizedTenantRefs({ principalRef }) {
    return (
      scopeReadbacks.get(principalRef) ?? {
        tenantRefs: [],
        sourceRef: `membership-view-${principalRef}`,
        version: "membership-empty",
      }
    );
  },
};

function tenantEvidence(overrides = {}) {
  return {
    principalRef: "tenant-user-1",
    principalType: "tenant_user",
    status: "authenticated",
    evidenceRef: "auth-evidence-tenant-user-1",
    version: "auth-v5",
    authenticatedAt: "2026-07-29T11:00:00.000Z",
    expiresAt: "2026-07-29T13:00:00.000Z",
    authorizedTenantRefs: ["tenant-a", "tenant-b"],
    ...overrides,
  };
}

const resolver = createPrincipalResolverService({
  principalRepository,
  authorizedScopeRepository,
  clock: () => now,
});

const resolvedTenant = await resolver.resolve({
  authenticationEvidence: tenantEvidence(),
  requestedTenantRefs: ["tenant-a"],
});
assert.equal(resolvedTenant.status, "resolved");
assert.equal(resolvedTenant.principal.principalRef, "tenant-user-1");
assert.equal(resolvedTenant.principal.principalType, "tenant_user");
assert.deepEqual(resolvedTenant.principal.authorizedTenantRefs, ["tenant-a"]);
assert.equal(resolvedTenant.principal.attributes.region, "eu");
assert.equal("accessToken" in resolvedTenant.principal.attributes, false);
assert.equal(
  "privateKey" in resolvedTenant.principal.attributes.nested,
  false,
);
assert.equal(
  resolvedTenant.sourceEvidence.authorizedScope.sourceRef,
  "membership-view-tenant-user-1",
);
assert.equal(resolvedTenant.automaticWritePerformed, false);
assert.equal(resolvedTenant.providerCallMade, false);
assert.equal(resolvedTenant.secretsIncluded, false);
assert.equal(Object.isFrozen(resolvedTenant), true);
assert.equal(Object.isFrozen(resolvedTenant.principal), true);
assert.equal(Object.isFrozen(resolvedTenant.sourceEvidence), true);

const resolvedAdmin = await resolver.resolve({
  authenticationEvidence: {
    principalRef: "admin-1",
    principalType: "admin",
    status: "authenticated",
    evidenceRef: "auth-evidence-admin-1",
    version: "auth-v3",
    authenticatedAt: "2026-07-29T11:00:00.000Z",
    expiresAt: "2026-07-29T13:00:00.000Z",
    authorizedTenantRefs: ["*"],
  },
});
assert.deepEqual(resolvedAdmin.principal.authorizedTenantRefs, ["*"]);
assert.equal(
  resolvedAdmin.sourceEvidence.authorizedScope.sourceRef,
  "principal_registry",
);

const resolvedAgent = await resolver.resolve({
  authenticationEvidence: {
    principalRef: "agent-1",
    principalType: "delegated_agent",
    status: "authenticated",
    evidenceRef: "auth-evidence-agent-1",
    version: "auth-v4",
    authenticatedAt: "2026-07-29T11:00:00.000Z",
    expiresAt: "2026-07-29T13:00:00.000Z",
    authorizedTenantRefs: ["tenant-a"],
    delegatedByPrincipalRef: "support-1",
  },
});
assert.deepEqual(resolvedAgent.principal.authorizedTenantRefs, ["tenant-a"]);
assert.equal(
  resolvedAgent.principal.attributes.delegatedByPrincipalRef,
  "support-1",
);

async function expectResolutionError(input, expectedCode) {
  await assert.rejects(
    () => resolver.resolve(input),
    (error) => {
      assert.equal(error instanceof PrincipalResolutionError, true);
      assert.equal(error.code, expectedCode);
      return true;
    },
  );
}

await expectResolutionError(
  {
    authenticationEvidence: tenantEvidence(),
    requestedPrincipalRef: "tenant-user-2",
  },
  "principal_identity_override_rejected",
);
await expectResolutionError(
  {
    authenticationEvidence: tenantEvidence(),
    requestedTenantRefs: ["tenant-c"],
  },
  "principal_scope_expansion_rejected",
);
await expectResolutionError(
  {
    authenticationEvidence: tenantEvidence({
      authorizedTenantRefs: ["tenant-c"],
    }),
  },
  "principal_scope_unresolved",
);
await expectResolutionError(
  {
    authenticationEvidence: tenantEvidence({
      expiresAt: "2026-07-29T12:00:00.000Z",
    }),
  },
  "authentication_evidence_expired",
);
await expectResolutionError(
  {
    authenticationEvidence: tenantEvidence({
      authenticatedAt: "2026-07-29T12:01:00.000Z",
    }),
  },
  "authentication_evidence_not_yet_valid",
);
await expectResolutionError(
  {
    authenticationEvidence: tenantEvidence({
      principalRef: "missing-user",
    }),
  },
  "principal_not_found",
);

principalRecords.set("tenant-user-1", {
  ...principalRecords.get("tenant-user-1"),
  status: "revoked",
  revokedAt: "2026-07-29T11:30:00.000Z",
});
await expectResolutionError(
  { authenticationEvidence: tenantEvidence() },
  "principal_revoked",
);
principalRecords.set("tenant-user-1", {
  ...principalRecords.get("tenant-user-1"),
  status: "active",
  revokedAt: null,
  expiresAt: "2026-07-29T11:59:59.000Z",
});
await expectResolutionError(
  { authenticationEvidence: tenantEvidence() },
  "principal_expired",
);
principalRecords.set("tenant-user-1", {
  ...principalRecords.get("tenant-user-1"),
  expiresAt: null,
  principalType: "service_principal",
});
await expectResolutionError(
  { authenticationEvidence: tenantEvidence() },
  "principal_type_mismatch",
);
principalRecords.set("tenant-user-1", {
  ...principalRecords.get("tenant-user-1"),
  principalType: "tenant_user",
});

scopeReadbacks.set("tenant-user-1", {
  tenantRefs: [],
  sourceRef: "membership-view-tenant-user-1",
  version: "membership-v8",
});
await expectResolutionError(
  { authenticationEvidence: tenantEvidence() },
  "principal_scope_unresolved",
);
scopeReadbacks.set("tenant-user-1", {
  tenantRefs: ["tenant-a", "tenant-b"],
  sourceRef: "membership-view-tenant-user-1",
  version: "membership-v9",
});

await expectResolutionError(
  {
    authenticationEvidence: {
      principalRef: "agent-1",
      principalType: "delegated_agent",
      status: "authenticated",
      evidenceRef: "auth-evidence-agent-1",
      version: "auth-v4",
      authenticatedAt: "2026-07-29T11:00:00.000Z",
      expiresAt: "2026-07-29T13:00:00.000Z",
      authorizedTenantRefs: ["tenant-a"],
      delegatedByPrincipalRef: "support-2",
    },
  },
  "delegation_chain_mismatch",
);
await expectResolutionError(
  {
    authenticationEvidence: tenantEvidence({
      authorizedTenantRefs: ["*"],
    }),
  },
  "principal_global_scope_forbidden",
);

assert.throws(
  () =>
    createPrincipalResolverService({
      principalRepository: {},
      authorizedScopeRepository,
    }),
  /principalRepository\.findPrincipal must be a function/,
);
assert.throws(
  () =>
    createPrincipalResolverService({
      principalRepository,
      authorizedScopeRepository: {},
    }),
  /authorizedScopeRepository\.listAuthorizedTenantRefs must be a function/,
);

console.log("context kernel principal resolver tests passed");
