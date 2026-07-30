import assert from "node:assert/strict";

import { createSubjectScopeDelegationResolverService } from "./contextKernel/application/index.js";

const evaluatedAt = new Date("2026-07-30T00:00:00.000Z");
const clock = () => evaluatedAt;

const tenantPrincipal = Object.freeze({
  principalType: "tenant_user",
  principalRef: "user-a",
  authorizedTenantRefs: ["tenant-a"],
  attributes: {},
});

const supportPrincipal = Object.freeze({
  principalType: "service_principal",
  principalRef: "support-a",
  authorizedTenantRefs: ["tenant-a"],
  attributes: { actorClass: "support" },
});

const subjectScope = Object.freeze({
  subjectType: "tenant_user",
  subjectRef: "user-a",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  status: "active",
  validFrom: "2026-07-29T00:00:00.000Z",
  expiresAt: "2026-07-31T00:00:00.000Z",
  delegationAllowed: true,
  sourceRef: "subject-scope-registry",
  versionRef: "subject-scope-v4",
});

const delegationContext = Object.freeze({
  delegationRef: "delegation-a",
  mode: "support_impersonation",
  actorPrincipalRef: "support-a",
  subjectRef: "user-a",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  reasonCode: "SUPPORT_CASE",
  auditRef: "audit-a",
  allowedOperations: ["workspace.read"],
  validFrom: "2026-07-29T00:00:00.000Z",
  expiresAt: "2026-07-31T00:00:00.000Z",
  status: "active",
  sourceRef: "delegation-registry",
  versionRef: "delegation-v3",
  accessToken: "remove-me",
  nested: { secret: "remove-me", safeValue: "keep-me" },
});

function createResolver({
  scopeRecord = subjectScope,
  delegationRecord = delegationContext,
  membershipStatus = "active",
  workspaces = [{
    workspaceRef: "workspace-a",
    status: "active",
    sourceRef: "workspace-registry",
    versionRef: "workspace-v2",
  }],
  subjectCalls = [],
  delegationCalls = [],
  authorizedScopeCalls = [],
} = {}) {
  return createSubjectScopeDelegationResolverService({
    subjectScopeRepository: {
      async findSubjectScope(input) {
        subjectCalls.push(input);
        return scopeRecord;
      },
    },
    delegationContextRepository: {
      async findDelegationContext(input) {
        delegationCalls.push(input);
        return delegationRecord;
      },
    },
    authorizedScopeRepository: {
      async findAuthorizedScope(input) {
        authorizedScopeCalls.push(input);
        return {
          tenantRef: input.tenantRef,
          userRef: input.userRef,
          sourceRef: "authorized-scope-registry",
          versionRef: "authorized-scope-v5",
          membership: {
            role: "owner",
            status: membershipStatus,
            sourceRef: "membership-registry",
            versionRef: "membership-v7",
          },
          workspaces,
        };
      },
    },
    clock,
  });
}

async function expectCode(run, code, reasonCode = null) {
  let caught = null;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `Expected ${code}.`);
  assert.equal(caught.code, code);
  if (reasonCode) {
    assert.ok(caught.details?.reason_codes?.includes(reasonCode), `${reasonCode} missing.`);
  }
  return caught;
}

function directInput(overrides = {}) {
  return {
    principal: tenantPrincipal,
    subject: {
      subjectType: "tenant_user",
      subjectRef: "user-a",
      tenantRef: "tenant-a",
      workspaceRef: "workspace-a",
    },
    operationIntent: "workspace.read",
    ...overrides,
  };
}

function delegatedInput(overrides = {}) {
  return {
    principal: supportPrincipal,
    subject: {
      subjectType: "tenant_user",
      subjectRef: "user-a",
      tenantRef: "tenant-a",
      workspaceRef: "workspace-a",
    },
    delegationRef: "delegation-a",
    operationIntent: "workspace.read",
    ...overrides,
  };
}

const directSubjectCalls = [];
const directDelegationCalls = [];
const directScopeCalls = [];
const directResolver = createResolver({
  subjectCalls: directSubjectCalls,
  delegationCalls: directDelegationCalls,
  authorizedScopeCalls: directScopeCalls,
});
const direct = await directResolver.resolve(directInput());
assert.equal(direct.status, "resolved");
assert.equal(direct.resolutionMode, "direct");
assert.equal(direct.effectiveSubject.subjectRef, "user-a");
assert.equal(direct.effectiveSubject.delegatedByPrincipalRef, null);
assert.equal(direct.delegationDecision, null);
assert.equal(direct.sourceEvidence.membershipEvidence.status, "active");
assert.equal(direct.sourceEvidence.membershipEvidence.workspace.status, "active");
assert.equal(direct.automaticWritePerformed, false);
assert.equal(direct.providerCallMade, false);
assert.equal(direct.credentialPayloadRead, false);
assert.equal(direct.secretsIncluded, false);
assert.equal(Object.isFrozen(direct), true);
assert.equal(Object.isFrozen(direct.effectiveSubject), true);
assert.equal(directDelegationCalls.length, 0);
assert.deepEqual(directScopeCalls, [{ tenantRef: "tenant-a", userRef: "user-a" }]);
assert.deepEqual(directSubjectCalls, [{
  subjectType: "tenant_user",
  subjectRef: "user-a",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
}]);

let adminMembershipCalls = 0;
const adminResolver = createSubjectScopeDelegationResolverService({
  subjectScopeRepository: {
    async findSubjectScope() {
      return {
        subjectType: "admin",
        subjectRef: "admin-a",
        tenantRef: "tenant-z",
        workspaceRef: null,
        status: "active",
      };
    },
  },
  delegationContextRepository: {
    async findDelegationContext() {
      throw new Error("Direct admin resolution must not query delegation.");
    },
  },
  authorizedScopeRepository: {
    async findAuthorizedScope() {
      adminMembershipCalls += 1;
      return null;
    },
  },
  clock,
});
const directAdmin = await adminResolver.resolve({
  principal: {
    principalType: "admin",
    principalRef: "admin-a",
    authorizedTenantRefs: ["*"],
    attributes: { actorClass: "platform_admin" },
  },
  subject: {
    subjectType: "admin",
    subjectRef: "admin-a",
    tenantRef: "tenant-z",
  },
  operationIntent: "authority.inspect",
});
assert.equal(directAdmin.resolutionMode, "direct");
assert.equal(directAdmin.sourceEvidence.membershipEvidence, null);
assert.equal(adminMembershipCalls, 0);

await expectCode(
  () => createResolver({ membershipStatus: "revoked" }).resolve(directInput()),
  "subject_membership_not_active",
);
await expectCode(
  () => createResolver({ workspaces: [] }).resolve(directInput()),
  "subject_workspace_not_authorized",
);
await expectCode(
  () => createResolver().resolve(directInput({
    subject: {
      subjectType: "tenant_user",
      subjectRef: "user-a",
      tenantRef: "tenant-b",
      workspaceRef: "workspace-a",
    },
  })),
  "subject_tenant_not_authorized",
);
await expectCode(
  () => createResolver({
    scopeRecord: { ...subjectScope, workspaceRef: "workspace-b" },
  }).resolve(directInput()),
  "subject_scope_workspace_mismatch",
);
await expectCode(
  () => createResolver({
    scopeRecord: { ...subjectScope, stale: true },
  }).resolve(directInput()),
  "subject_scope_stale",
);
await expectCode(
  () => createResolver({
    scopeRecord: { ...subjectScope, expiresAt: "2026-07-30T00:00:00.000Z" },
  }).resolve(directInput()),
  "subject_scope_expired",
);
await expectCode(
  () => createResolver({
    scopeRecord: { ...subjectScope, subjectRef: "user-b" },
  }).resolve(directInput()),
  "subject_scope_reference_mismatch",
);
await expectCode(
  () => createResolver().resolve(directInput({
    subject: {
      subjectType: "tenant_user",
      subjectRef: "user-b",
      tenantRef: "tenant-a",
      workspaceRef: "workspace-a",
    },
  })),
  "subject_delegation_context_required",
);

const delegatedCalls = [];
const delegatedScopeCalls = [];
const delegatedResolver = createResolver({
  delegationCalls: delegatedCalls,
  authorizedScopeCalls: delegatedScopeCalls,
});
const delegated = await delegatedResolver.resolve(delegatedInput());
assert.equal(delegated.status, "resolved");
assert.equal(delegated.resolutionMode, "delegated");
assert.equal(delegated.effectiveSubject.delegatedByPrincipalRef, "support-a");
assert.equal(delegated.delegationDecision.allowed, true);
assert.deepEqual(delegatedCalls, [{ delegationRef: "delegation-a" }]);
assert.deepEqual(delegatedScopeCalls, [{ tenantRef: "tenant-a", userRef: "user-a" }]);
assert.equal(Object.hasOwn(delegated.sourceEvidence.delegationContext, "accessToken"), false);
assert.equal(Object.hasOwn(delegated.sourceEvidence.delegationContext.nested, "secret"), false);
assert.equal(delegated.sourceEvidence.delegationContext.nested.safeValue, "keep-me");
assert.equal(delegated.sourceEvidence.delegationAuditRef, "audit-a");
assert.equal(delegated.automaticWritePerformed, false);
assert.equal(delegated.providerCallMade, false);
assert.equal(delegated.credentialPayloadRead, false);
assert.equal(delegated.secretsIncluded, false);
assert.equal(Object.isFrozen(delegated), true);
assert.equal(Object.isFrozen(delegated.delegationDecision), true);

await expectCode(
  () => createResolver().resolve({
    ...delegatedInput(),
    delegationRef: null,
  }),
  "subject_delegation_context_required",
);
const missingDelegationSubjectCalls = [];
await expectCode(
  () => createResolver({
    delegationRecord: null,
    subjectCalls: missingDelegationSubjectCalls,
  }).resolve(delegatedInput()),
  "subject_delegation_context_not_found",
);
assert.equal(missingDelegationSubjectCalls.length, 0);
await expectCode(
  () => createResolver({
    delegationRecord: {
      ...delegationContext,
      status: "revoked",
      revokedAt: "2026-07-29T12:00:00.000Z",
    },
  }).resolve(delegatedInput()),
  "subject_delegation_blocked",
  "SUPPORT_DELEGATION_REVOKED",
);
await expectCode(
  () => createResolver({
    delegationRecord: {
      ...delegationContext,
      validFrom: "2026-07-28T00:00:00.000Z",
      expiresAt: "2026-07-29T00:00:00.000Z",
    },
  }).resolve(delegatedInput()),
  "subject_delegation_blocked",
  "SUPPORT_DELEGATION_EXPIRED",
);
await expectCode(
  () => createResolver({
    delegationRecord: { ...delegationContext, allowedOperations: ["workspace.write"] },
  }).resolve(delegatedInput()),
  "subject_delegation_blocked",
  "SUPPORT_DELEGATION_OPERATION_NOT_ALLOWED",
);
const actorMismatchSubjectCalls = [];
await expectCode(
  () => createResolver({
    delegationRecord: { ...delegationContext, actorPrincipalRef: "support-b" },
    subjectCalls: actorMismatchSubjectCalls,
  }).resolve(delegatedInput()),
  "subject_delegation_actor_mismatch",
);
assert.equal(actorMismatchSubjectCalls.length, 0);
await expectCode(
  () => createResolver({
    delegationRecord: { ...delegationContext, subjectRef: "user-b" },
  }).resolve(delegatedInput()),
  "subject_delegation_subject_mismatch",
);
await expectCode(
  () => createResolver({
    delegationRecord: { ...delegationContext, tenantRef: "tenant-b" },
  }).resolve(delegatedInput()),
  "subject_delegation_tenant_mismatch",
);
await expectCode(
  () => createResolver({
    delegationRecord: { ...delegationContext, workspaceRef: "workspace-b" },
  }).resolve(delegatedInput()),
  "subject_delegation_workspace_mismatch",
);
await expectCode(
  () => createResolver().resolve(delegatedInput({
    principal: {
      ...supportPrincipal,
      attributes: { actorClass: "automation" },
    },
  })),
  "subject_delegation_blocked",
  "SUPPORT_IMPERSONATION_ACTOR_INVALID",
);

const delegatedAgentPrincipal = {
  principalType: "delegated_agent",
  principalRef: "agent-a",
  authorizedTenantRefs: ["tenant-a"],
  attributes: {
    actorClass: "agent",
    delegatedByPrincipalRef: "support-a",
  },
};
await expectCode(
  () => createResolver({
    delegationRecord: {
      ...delegationContext,
      mode: "support_delegated_agent",
      actorPrincipalRef: "agent-a",
      delegatedByPrincipalRef: "support-b",
    },
  }).resolve(delegatedInput({ principal: delegatedAgentPrincipal })),
  "subject_delegation_blocked",
  "SUPPORT_DELEGATED_AGENT_CHAIN_MISMATCH",
);

assert.throws(
  () => createSubjectScopeDelegationResolverService({
    subjectScopeRepository: {},
    delegationContextRepository: { async findDelegationContext() {} },
    authorizedScopeRepository: { async findAuthorizedScope() {} },
    clock,
  }),
  /Subject scope repository is missing methods: findSubjectScope/,
);
assert.throws(
  () => createSubjectScopeDelegationResolverService({
    subjectScopeRepository: { async findSubjectScope() {} },
    delegationContextRepository: {},
    authorizedScopeRepository: { async findAuthorizedScope() {} },
    clock,
  }),
  /Delegation context repository is missing methods: findDelegationContext/,
);

console.log("context kernel subject scope delegation resolver tests passed");
