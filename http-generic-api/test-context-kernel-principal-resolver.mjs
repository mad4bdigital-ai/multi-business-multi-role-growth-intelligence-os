import assert from "node:assert/strict";

import { createPrincipalResolverService } from "./contextKernel/application/index.js";

const evaluatedAt = new Date("2026-07-30T00:00:00.000Z");
const clock = () => evaluatedAt;
const activePrincipalRecord = {
  principalType: "tenant_user",
  principalRef: "user-a",
  status: "active",
  authorizedTenantRefs: ["tenant-b", "tenant-a"],
  sourceRef: "principal-registry",
  versionRef: "principal-v7",
  attributes: {
    displayName: "User A",
    accessToken: "remove-me",
  },
};

function createResolver({
  record = activePrincipalRecord,
  membershipStatus = "active",
  scopeCalls = [],
} = {}) {
  return createPrincipalResolverService({
    principalRepository: {
      async findPrincipal() {
        return record;
      },
    },
    authorizedScopeRepository: {
      async findAuthorizedScope({ tenantRef, userRef }) {
        scopeCalls.push({ tenantRef, userRef });
        return {
          tenantRef,
          userRef,
          membership: {
            role: "owner",
            status: membershipStatus,
            sourceRef: "membership-registry",
            versionRef: "membership-v3",
          },
          workspaces: [{ workspaceRef: "workspace-a" }],
        };
      },
    },
    clock,
  });
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
}

const scopeCalls = [];
const resolver = createResolver({ scopeCalls });
const resolved = await resolver.resolve({
  authentication: {
    principalType: "tenant_user",
    principalRef: "user-a",
    status: "active",
    authorizedTenantRefs: ["tenant-a"],
    authenticationRef: "auth-a",
    sourceRef: "signed-session",
    versionRef: "session-v2",
    expiresAt: "2026-07-30T01:00:00.000Z",
    accessToken: "remove-me",
  },
  requestedTenantRefs: ["tenant-a"],
});
assert.equal(resolved.status, "resolved");
assert.deepEqual(resolved.principal.authorizedTenantRefs, ["tenant-a"]);
assert.equal(resolved.principal.attributes.displayName, "User A");
assert.equal(Object.hasOwn(resolved.principal.attributes, "accessToken"), false);
assert.equal(resolved.sourceEvidence.authenticationRef, "auth-a");
assert.equal(resolved.sourceEvidence.principalVersionRef, "principal-v7");
assert.equal(resolved.sourceEvidence.membershipEvidence[0].status, "active");
assert.equal(resolved.automaticWritePerformed, false);
assert.equal(resolved.providerCallMade, false);
assert.equal(resolved.credentialPayloadRead, false);
assert.equal(resolved.secretsIncluded, false);
assert.deepEqual(scopeCalls, [{ tenantRef: "tenant-a", userRef: "user-a" }]);
assert.equal(Object.isFrozen(resolved), true);
assert.equal(Object.isFrozen(resolved.principal), true);

await expectCode(
  () => resolver.resolve({
    authentication: {
      principalType: "tenant_user",
      principalRef: "user-a",
      status: "active",
      authorizedTenantRefs: ["tenant-a"],
      expiresAt: "2026-07-30T01:00:00.000Z",
    },
    requestedTenantRefs: ["tenant-b"],
  }),
  "principal_scope_expansion_not_allowed",
);
await expectCode(
  () => resolver.resolve({
    authentication: {
      principalType: "tenant_user",
      principalRef: "user-a",
      status: "active",
      authorizedTenantRefs: ["tenant-c"],
      expiresAt: "2026-07-30T01:00:00.000Z",
    },
  }),
  "principal_signed_scope_mismatch",
);
await expectCode(
  () => createResolver({ membershipStatus: "revoked" }).resolve({
    authentication: {
      principalType: "tenant_user",
      principalRef: "user-a",
      status: "active",
      authorizedTenantRefs: ["tenant-a"],
      expiresAt: "2026-07-30T01:00:00.000Z",
    },
  }),
  "principal_membership_not_active",
);
await expectCode(
  () => createResolver({
    record: { ...activePrincipalRecord, revokedAt: "2026-07-29T23:00:00.000Z" },
  }).resolve({
    authentication: {
      principalType: "tenant_user",
      principalRef: "user-a",
      status: "active",
      authorizedTenantRefs: ["tenant-a"],
      expiresAt: "2026-07-30T01:00:00.000Z",
    },
  }),
  "principal_revoked",
);
await expectCode(
  () => resolver.resolve({
    authentication: {
      principalType: "tenant_user",
      principalRef: "user-a",
      status: "active",
      authorizedTenantRefs: ["tenant-a"],
      expiresAt: "2026-07-30T00:00:00.000Z",
    },
  }),
  "principal_authentication_expired",
);
await expectCode(
  () => createResolver({
    record: { ...activePrincipalRecord, principalType: "service_principal" },
  }).resolve({
    authentication: {
      principalType: "tenant_user",
      principalRef: "user-a",
      status: "active",
      authorizedTenantRefs: ["tenant-a"],
      expiresAt: "2026-07-30T01:00:00.000Z",
    },
  }),
  "principal_type_mismatch",
);
await expectCode(
  () => createResolver({
    record: { ...activePrincipalRecord, authorizedTenantRefs: ["*"] },
  }).resolve({
    authentication: {
      principalType: "tenant_user",
      principalRef: "user-a",
      status: "active",
      authorizedTenantRefs: ["*"],
      expiresAt: "2026-07-30T01:00:00.000Z",
    },
  }),
  "principal_global_scope_not_allowed",
);

const delegatedResolver = createPrincipalResolverService({
  principalRepository: {
    async findPrincipal() {
      return {
        principalType: "delegated_agent",
        principalRef: "agent-a",
        status: "active",
        authorizedTenantRefs: ["tenant-a"],
        attributes: { delegatedByPrincipalRef: "support-a" },
      };
    },
  },
  authorizedScopeRepository: {
    async findAuthorizedScope() {
      throw new Error("Delegated agents do not use tenant-user memberships.");
    },
  },
  clock,
});
await expectCode(
  () => delegatedResolver.resolve({
    authentication: {
      principalType: "delegated_agent",
      principalRef: "agent-a",
      status: "active",
      authorizedTenantRefs: ["tenant-a"],
      delegatedByPrincipalRef: "support-b",
      expiresAt: "2026-07-30T01:00:00.000Z",
    },
  }),
  "principal_delegation_chain_mismatch",
);

let adminScopeCalls = 0;
const adminResolver = createPrincipalResolverService({
  principalRepository: {
    async findPrincipal() {
      return {
        principalType: "admin",
        principalRef: "admin-a",
        status: "active",
        authorizedTenantRefs: ["*"],
        attributes: { actorClass: "platform_admin" },
      };
    },
  },
  authorizedScopeRepository: {
    async findAuthorizedScope() {
      adminScopeCalls += 1;
      return null;
    },
  },
  clock,
});
const resolvedAdmin = await adminResolver.resolve({
  authentication: {
    principalType: "admin",
    principalRef: "admin-a",
    status: "active",
    authorizedTenantRefs: ["*"],
    expiresAt: "2026-07-30T01:00:00.000Z",
  },
  requestedTenantRefs: ["tenant-z"],
});
assert.deepEqual(resolvedAdmin.principal.authorizedTenantRefs, ["*"]);
assert.deepEqual(resolvedAdmin.sourceEvidence.membershipEvidence, []);
assert.equal(adminScopeCalls, 0);

assert.throws(
  () => createPrincipalResolverService({
    principalRepository: {},
    authorizedScopeRepository: { async findAuthorizedScope() {} },
    clock,
  }),
  /Principal repository is missing methods: findPrincipal/,
);

console.log("context kernel principal resolver tests passed");
