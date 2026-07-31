import assert from "node:assert/strict";

import { createAuthenticatedProviderConsentUseCaseService } from "./contextKernel/application/index.js";

const AUTHENTICATION = Object.freeze({
  principalType: "tenant_user",
  principalRef: "user-a",
  status: "active",
  authorizedTenantRefs: ["tenant-a"],
  authenticationRef: "auth-a",
  expiresAt: "2026-07-31T12:00:00.000Z",
});
const BASE_REQUEST = Object.freeze({
  authentication: AUTHENTICATION,
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
});
const ACCOUNT_HASH = "a".repeat(64);

async function expectCode(run, code) {
  let caught = null;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `Expected ${code}.`);
  assert.equal(caught.code, code);
  return caught;
}

function createHarness({
  readiness = {
    status: "ready",
    migrationReadbackVerified: true,
    applicationUseCasesEnabled: true,
    versionRef: "readiness-v1",
  },
  principalType = "tenant_user",
  principalRef = "user-a",
  membershipRole = "owner",
  workspaceRefs = ["workspace-a"],
  workspaceOwnershipType = "personal",
  workspaceOwnerUserRef = "user-a",
  brandAuthority = {
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    brandRef: "brand-a",
    principalRef: "user-a",
    status: "active",
    permissions: ["provider_connection.manage"],
    versionRef: "brand-authority-v1",
  },
  connectionOwnership = {
    connectionRef: "connection-a",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    ownerScopeType: "personal_workspace",
    ownerScopeRef: "workspace-a",
    brandRef: null,
    providerKey: "google_workspace",
    providerAccountRef: null,
    providerAccountBindingHash: ACCOUNT_HASH,
    connectionRevision: 7,
    authorizationRevision: 3,
    status: "active",
  },
  listedConnections = null,
  revokeResult = null,
} = {}) {
  const calls = {
    readiness: [],
    principal: [],
    workspace: [],
    brand: [],
    connection: [],
    list: [],
    revoke: [],
    issue: [],
  };
  const service = createAuthenticatedProviderConsentUseCaseService({
    providerConsentReadinessRepository: {
      async findProviderConsentReadiness(input) {
        calls.readiness.push(input);
        return readiness;
      },
    },
    principalResolverService: {
      async resolve(input) {
        calls.principal.push(input);
        return {
          principal: {
            principalType,
            principalRef,
            authorizedTenantRefs: ["tenant-a"],
            attributes: {},
          },
          sourceEvidence: {
            authenticationRef: "auth-a",
            principalVersionRef: "principal-v1",
            membershipEvidence: [{
              tenantRef: "tenant-a",
              userRef: principalRef,
              role: membershipRole,
              status: "active",
              versionRef: "membership-v1",
              workspaceRefs,
            }],
          },
        };
      },
    },
    workspaceOwnershipRepository: {
      async findWorkspaceOwnership(input) {
        calls.workspace.push(input);
        return {
          tenantRef: "tenant-a",
          workspaceRef: "workspace-a",
          workspaceOwnershipType,
          ownerUserRef: workspaceOwnerUserRef,
          ownershipRevision: 11,
        };
      },
    },
    brandManagementAuthorityRepository: {
      async findBrandManagementAuthority(input) {
        calls.brand.push(input);
        return brandAuthority;
      },
    },
    connectionOwnershipRepository: {
      async findConnectionOwnership(input) {
        calls.connection.push(input);
        return connectionOwnership;
      },
    },
    providerConnectionAccessRepository: {
      async listProviderConnections(input) {
        calls.list.push(input);
        return {
          connections: listedConnections || [{
            connectionRef: "connection-a",
            tenantRef: "tenant-a",
            workspaceRef: "workspace-a",
            ownerScopeType:
              workspaceOwnershipType === "personal" ? "personal_workspace" : "company_workspace",
            ownerScopeRef: "workspace-a",
            brandRef: null,
            providerKey: "google_workspace",
            status: "active",
            connectionRevision: 7,
            authorizationRevision: 3,
            credentialPayload: "must-not-escape",
            updatedAt: "2026-07-31T08:00:00.000Z",
          }],
          nextCursor: null,
        };
      },
      async revokeProviderConnection(input) {
        calls.revoke.push(input);
        return revokeResult || {
          connectionRef: input.connectionRef,
          status: "revoked",
          connectionRevision: input.expectedConnectionRevision + 1,
        };
      },
    },
    providerConsentService: {
      async issue(input) {
        calls.issue.push(input);
        return {
          authorizationState: `opaque-${input.flowType}-state`,
          stateRef: `state-${input.flowType}`,
          providerKey: input.providerKey,
          expiresAt: "2026-07-31T09:10:00.000Z",
          stateRevision: 1,
          persistedStatus: "issued",
        };
      },
    },
  });
  return { service, calls };
}

{
  const { service, calls } = createHarness({
    readiness: {
      status: "blocked",
      migrationReadbackVerified: false,
      applicationUseCasesEnabled: false,
      reasonCode: "migration_readback_missing",
    },
  });
  await expectCode(() => service.list(BASE_REQUEST), "provider_consent_runtime_not_ready");
  assert.equal(calls.principal.length, 0);
  assert.equal(calls.workspace.length, 0);
  assert.equal(calls.list.length, 0);
}

{
  const { service, calls } = createHarness();
  await expectCode(
    () => service.list({ ...BASE_REQUEST, userRef: "user-b" }),
    "provider_consent_caller_identity_forbidden",
  );
  assert.equal(calls.readiness.length, 0);
}

{
  const { service, calls } = createHarness();
  const result = await service.list({ ...BASE_REQUEST, limit: 25 });
  assert.equal(result.operation, "list");
  assert.equal(result.userRef, "user-a");
  assert.equal(result.ownerScopeType, "personal_workspace");
  assert.equal(result.connections.length, 1);
  assert.equal(result.connections[0].connectionRef, "connection-a");
  assert.equal(Object.hasOwn(result.connections[0], "credentialPayload"), false);
  assert.equal(result.automaticWritePerformed, false);
  assert.equal(result.providerCallMade, false);
  assert.equal(result.credentialPayloadRead, false);
  assert.equal(result.secretsIncluded, false);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(calls.list[0], {
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    brandRef: null,
    ownerScopeType: "personal_workspace",
    ownerScopeRef: "workspace-a",
    limit: 25,
    cursor: null,
  });
}

{
  const { service } = createHarness({ workspaceOwnerUserRef: "user-b" });
  await expectCode(
    () => service.list(BASE_REQUEST),
    "provider_consent_personal_owner_mismatch",
  );
}

{
  const { service, calls } = createHarness({
    workspaceOwnershipType: "company",
    workspaceOwnerUserRef: null,
    membershipRole: "manager",
  });
  const result = await service.authorize({
    ...BASE_REQUEST,
    providerKey: "google_workspace",
    requestedProviderScopes: ["drive.readonly"],
    redirectTargetRef: "provider-consent://callback/google",
  });
  assert.equal(result.operation, "authorize");
  assert.equal(result.ownerScopeType, "company_workspace");
  assert.equal(result.authorizationState, "opaque-authorize-state");
  assert.equal(result.automaticWritePerformed, true);
  assert.equal(calls.issue.length, 1);
  assert.deepEqual(calls.issue[0], {
    flowType: "authorize",
    providerKey: "google_workspace",
    principalRef: "user-a",
    userRef: "user-a",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    brandRef: null,
    ownerScopeType: "company_workspace",
    ownerScopeRef: "workspace-a",
    requestedProviderScopes: ["drive.readonly"],
    redirectTargetRef: "provider-consent://callback/google",
  });
}

{
  const { service, calls } = createHarness({
    workspaceOwnershipType: "company",
    workspaceOwnerUserRef: null,
    membershipRole: "member",
  });
  await expectCode(
    () => service.authorize({
      ...BASE_REQUEST,
      providerKey: "google_workspace",
      redirectTargetRef: "provider-consent://callback/google",
    }),
    "provider_consent_company_management_required",
  );
  assert.equal(calls.issue.length, 0);
}

{
  const brandConnections = [{
    connectionRef: "brand-connection-a",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    ownerScopeType: "brand",
    ownerScopeRef: "brand-a",
    brandRef: "brand-a",
    providerKey: "meta_ads",
    status: "active",
    connectionRevision: 4,
    authorizationRevision: 2,
  }];
  const { service, calls } = createHarness({
    workspaceOwnershipType: "company",
    workspaceOwnerUserRef: null,
    membershipRole: "member",
    listedConnections: brandConnections,
    brandAuthority: {
      tenantRef: "tenant-a",
      workspaceRef: "workspace-a",
      brandRef: "brand-a",
      principalRef: "user-a",
      status: "active",
      permissions: ["provider_connection.read"],
      versionRef: "brand-read-v1",
    },
  });
  const result = await service.list({ ...BASE_REQUEST, brandRef: "brand-a" });
  assert.equal(result.ownerScopeType, "brand");
  assert.equal(result.ownerScopeRef, "brand-a");
  assert.equal(result.connections[0].connectionRef, "brand-connection-a");
  assert.equal(calls.brand.length, 1);
}

{
  const { service, calls } = createHarness({
    workspaceOwnershipType: "company",
    workspaceOwnerUserRef: null,
    brandAuthority: {
      tenantRef: "tenant-a",
      workspaceRef: "workspace-a",
      brandRef: "brand-a",
      principalRef: "user-a",
      status: "active",
      permissions: ["provider_connection.read"],
    },
  });
  await expectCode(
    () => service.authorize({
      ...BASE_REQUEST,
      brandRef: "brand-a",
      providerKey: "meta_ads",
      redirectTargetRef: "provider-consent://callback/meta",
    }),
    "provider_consent_brand_permission_required",
  );
  assert.equal(calls.issue.length, 0);
}

{
  const { service, calls } = createHarness({
    workspaceOwnershipType: "company",
    workspaceOwnerUserRef: null,
    membershipRole: "owner",
    connectionOwnership: {
      connectionRef: "brand-connection-a",
      tenantRef: "tenant-a",
      workspaceRef: "workspace-a",
      ownerScopeType: "brand",
      ownerScopeRef: "brand-a",
      brandRef: "brand-a",
      providerKey: "meta_ads",
      providerAccountRef: null,
      providerAccountBindingHash: ACCOUNT_HASH,
      connectionRevision: 9,
      authorizationRevision: 5,
      status: "active",
    },
  });
  const result = await service.reconnect({
    ...BASE_REQUEST,
    brandRef: "brand-a",
    connectionRef: "brand-connection-a",
    requestedProviderScopes: ["ads.read"],
    redirectTargetRef: "provider-consent://callback/meta",
  });
  assert.equal(result.ownerScopeType, "brand");
  assert.equal(result.expectedConnectionRevision, 9);
  assert.equal(result.providerKey, "meta_ads");
  assert.equal(calls.issue[0].expectedConnectionRevision, 9);
  assert.equal(calls.issue[0].expectedProviderAccountBindingHash, ACCOUNT_HASH);
  assert.equal(calls.issue[0].expectedProviderAccountRef, null);
  assert.equal(calls.connection[0].brandRef, "brand-a");
}

{
  const { service, calls } = createHarness();
  await expectCode(
    () => service.reconnect({
      ...BASE_REQUEST,
      connectionRef: "connection-a",
      redirectTargetRef: "provider-consent://callback/google",
      expectedConnectionRevision: 99,
    }),
    "provider_consent_caller_binding_forbidden",
  );
  assert.equal(calls.readiness.length, 0);
  assert.equal(calls.issue.length, 0);
}

{
  const { service } = createHarness({
    connectionOwnership: {
      connectionRef: "connection-a",
      tenantRef: "tenant-a",
      workspaceRef: "workspace-a",
      ownerScopeType: "company_workspace",
      ownerScopeRef: "workspace-a",
      brandRef: null,
      providerKey: "google_workspace",
      providerAccountBindingHash: ACCOUNT_HASH,
      connectionRevision: 7,
      authorizationRevision: 3,
      status: "active",
    },
  });
  await expectCode(
    () => service.reconnect({
      ...BASE_REQUEST,
      connectionRef: "connection-a",
      redirectTargetRef: "provider-consent://callback/google",
    }),
    "provider_consent_connection_owner_scope_mismatch",
  );
}

{
  const { service, calls } = createHarness();
  const result = await service.revoke({
    ...BASE_REQUEST,
    connectionRef: "connection-a",
    reasonCode: "user_requested",
  });
  assert.equal(result.status, "revoked");
  assert.equal(result.previousConnectionRevision, 7);
  assert.equal(result.connectionRevision, 8);
  assert.equal(result.automaticWritePerformed, true);
  assert.equal(calls.revoke[0].expectedConnectionRevision, 7);
  assert.equal(calls.revoke[0].principalRef, "user-a");
  assert.equal(calls.revoke[0].userRef, "user-a");
  assert.equal(calls.revoke[0].ownerScopeType, "personal_workspace");
}

{
  const { service } = createHarness({ principalType: "admin", principalRef: "admin-a" });
  await expectCode(
    () => service.list(BASE_REQUEST),
    "provider_consent_tenant_user_required",
  );
}

{
  const { service } = createHarness({ workspaceRefs: ["workspace-b"] });
  await expectCode(
    () => service.list(BASE_REQUEST),
    "provider_consent_workspace_membership_required",
  );
}

{
  const { service } = createHarness({
    listedConnections: [{
      connectionRef: "cross-brand",
      tenantRef: "tenant-a",
      workspaceRef: "workspace-a",
      ownerScopeType: "brand",
      ownerScopeRef: "brand-b",
      brandRef: "brand-b",
      providerKey: "meta_ads",
      status: "active",
      connectionRevision: 1,
      authorizationRevision: 1,
    }],
    workspaceOwnershipType: "company",
    workspaceOwnerUserRef: null,
  });
  await expectCode(
    () => service.list({ ...BASE_REQUEST, brandRef: "brand-a" }),
    "provider_consent_connection_projection_scope_mismatch",
  );
}

assert.throws(
  () => createAuthenticatedProviderConsentUseCaseService({
    principalResolverService: { async resolve() {} },
    providerConsentReadinessRepository: {},
    workspaceOwnershipRepository: { async findWorkspaceOwnership() {} },
    brandManagementAuthorityRepository: { async findBrandManagementAuthority() {} },
    connectionOwnershipRepository: { async findConnectionOwnership() {} },
    providerConnectionAccessRepository: {
      async listProviderConnections() {},
      async revokeProviderConnection() {},
    },
    providerConsentService: { async issue() {} },
  }),
  /Provider consent readiness repository is missing methods: findProviderConsentReadiness/,
);

console.log("context kernel authenticated provider consent use-case phase tests passed");