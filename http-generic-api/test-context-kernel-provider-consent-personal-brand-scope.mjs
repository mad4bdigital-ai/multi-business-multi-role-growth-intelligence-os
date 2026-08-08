import assert from "node:assert/strict";
import { createAuthenticatedProviderConsentUseCaseService } from "./contextKernel/application/index.js";

const AUTHENTICATION = Object.freeze({
  principalType: "tenant_user",
  principalRef: "user-a",
  status: "active",
  authorizedTenantRefs: ["tenant-a"],
  authenticationRef: "auth-a",
  expiresAt: "2026-08-08T18:00:00.000Z",
});

const BASE_REQUEST = Object.freeze({
  authentication: AUTHENTICATION,
  tenantRef: "tenant-a",
  workspaceRef: "workspace-personal-a",
  brandRef: "brand-a",
});

function createHarness({
  workspaceOwnerUserRef = "user-a",
  brandPermissions = ["provider_connection.manage"],
} = {}) {
  const calls = {
    readiness: [],
    principal: [],
    workspace: [],
    brand: [],
    list: [],
    issue: [],
    connection: [],
    revoke: [],
  };

  const service = createAuthenticatedProviderConsentUseCaseService({
    providerConsentReadinessRepository: {
      async findProviderConsentReadiness(input) {
        calls.readiness.push(input);
        return {
          status: "ready",
          migrationReadbackVerified: true,
          applicationUseCasesEnabled: true,
          versionRef: "readiness-personal-brand-v1",
        };
      },
    },
    principalResolverService: {
      async resolve(input) {
        calls.principal.push(input);
        return {
          principal: {
            principalType: "tenant_user",
            principalRef: "user-a",
            authorizedTenantRefs: ["tenant-a"],
            attributes: {},
          },
          sourceEvidence: {
            authenticationRef: "auth-a",
            principalVersionRef: "principal-v1",
            membershipEvidence: [{
              tenantRef: "tenant-a",
              userRef: "user-a",
              role: "owner",
              status: "active",
              versionRef: "membership-v1",
              workspaceRefs: ["workspace-personal-a"],
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
          workspaceRef: "workspace-personal-a",
          workspaceOwnershipType: "personal",
          ownerUserRef: workspaceOwnerUserRef,
          ownershipRevision: 17,
        };
      },
    },
    brandManagementAuthorityRepository: {
      async findBrandManagementAuthority(input) {
        calls.brand.push(input);
        return {
          tenantRef: "tenant-a",
          workspaceRef: "workspace-personal-a",
          brandRef: "brand-a",
          principalRef: "user-a",
          status: "active",
          permissions: brandPermissions,
          versionRef: "brand-authority-v1",
        };
      },
    },
    connectionOwnershipRepository: {
      async findConnectionOwnership(input) {
        calls.connection.push(input);
        return null;
      },
    },
    providerConnectionAccessRepository: {
      async listProviderConnections(input) {
        calls.list.push(input);
        return {
          connections: [{
            connectionRef: "brand-connection-a",
            tenantRef: "tenant-a",
            workspaceRef: "workspace-personal-a",
            ownerScopeType: "brand",
            ownerScopeRef: "brand-a",
            brandRef: "brand-a",
            providerKey: "meta_ads",
            status: "active",
            connectionRevision: 4,
            authorizationRevision: 2,
            credentialPayload: "must-not-escape",
            updatedAt: "2026-08-08T12:00:00.000Z",
          }],
          nextCursor: null,
        };
      },
      async revokeProviderConnection(input) {
        calls.revoke.push(input);
        return {
          connectionRef: input.connectionRef,
          status: "revoked",
          connectionRevision: Number(input.expectedConnectionRevision || 0) + 1,
        };
      },
    },
    providerConsentService: {
      async issue(input) {
        calls.issue.push(input);
        return {
          authorizationState: "opaque-personal-brand-state",
          stateRef: "state-personal-brand",
          providerKey: input.providerKey,
          expiresAt: "2026-08-08T18:30:00.000Z",
          stateRevision: 1,
          persistedStatus: "issued",
        };
      },
    },
  });

  return { service, calls };
}

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

{
  const { service, calls } = createHarness({ brandPermissions: ["provider_connection.read"] });
  const result = await service.list(BASE_REQUEST);

  assert.equal(result.operation, "list");
  assert.equal(result.workspaceRef, "workspace-personal-a");
  assert.equal(result.brandRef, "brand-a");
  assert.equal(result.ownerScopeType, "brand");
  assert.equal(result.ownerScopeRef, "brand-a");
  assert.equal(result.workspaceOwnershipRevision, 17);
  assert.equal(result.authorityVersionRef, "brand-authority-v1");
  assert.equal(result.connections.length, 1);
  assert.equal(result.connections[0].connectionRef, "brand-connection-a");
  assert.equal(Object.hasOwn(result.connections[0], "credentialPayload"), false);
  assert.equal(result.providerCallMade, false);
  assert.equal(result.credentialPayloadRead, false);
  assert.equal(result.secretsIncluded, false);
  assert.deepEqual(calls.brand[0], {
    tenantRef: "tenant-a",
    workspaceRef: "workspace-personal-a",
    brandRef: "brand-a",
    principalRef: "user-a",
  });
  assert.deepEqual(calls.list[0], {
    tenantRef: "tenant-a",
    workspaceRef: "workspace-personal-a",
    brandRef: "brand-a",
    ownerScopeType: "brand",
    ownerScopeRef: "brand-a",
    limit: 50,
    cursor: null,
  });
}

{
  const { service, calls } = createHarness({ brandPermissions: ["provider_connection.manage"] });
  const result = await service.authorize({
    ...BASE_REQUEST,
    providerKey: "meta_ads",
    requestedProviderScopes: ["ads.read"],
    redirectTargetRef: "provider-consent://callback/meta",
  });

  assert.equal(result.operation, "authorize");
  assert.equal(result.ownerScopeType, "brand");
  assert.equal(result.ownerScopeRef, "brand-a");
  assert.equal(result.brandRef, "brand-a");
  assert.equal(result.authorizationState, "opaque-personal-brand-state");
  assert.equal(result.automaticWritePerformed, true);
  assert.equal(calls.issue.length, 1);
  assert.equal(calls.issue[0].workspaceRef, "workspace-personal-a");
  assert.equal(calls.issue[0].brandRef, "brand-a");
  assert.equal(calls.issue[0].ownerScopeType, "brand");
  assert.equal(calls.issue[0].ownerScopeRef, "brand-a");
  assert.equal(calls.issue[0].principalRef, "user-a");
  assert.equal(calls.issue[0].userRef, "user-a");
}

{
  const { service, calls } = createHarness({ workspaceOwnerUserRef: "user-b" });
  await expectCode(
    () => service.list(BASE_REQUEST),
    "provider_consent_personal_owner_mismatch",
  );

  assert.equal(calls.workspace.length, 1);
  assert.equal(calls.brand.length, 0, "personal ownership must be verified before Brand authority lookup");
  assert.equal(calls.list.length, 0, "owner mismatch must block connection lookup");
  assert.equal(calls.issue.length, 0, "owner mismatch must block provider consent issuance");
}

console.log("Context Kernel provider consent personal Root + Brand scope regression passed");
