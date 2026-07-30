import assert from "node:assert/strict";

import { createSubjectScopeDelegationResolverService } from "./contextKernel/application/index.js";

const clock = () => new Date("2026-07-30T00:00:00.000Z");
const tenantPrincipal = {
  principalType: "tenant_user",
  principalRef: "user-a",
  authorizedTenantRefs: ["tenant-a"],
  attributes: {},
};
const supportPrincipal = {
  principalType: "service_principal",
  principalRef: "support-a",
  authorizedTenantRefs: ["tenant-a"],
  attributes: { actorClass: "support" },
};
const subject = {
  subjectType: "tenant_user",
  subjectRef: "user-a",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
};
const subjectScope = {
  ...subject,
  status: "active",
  delegationAllowed: true,
  sourceRef: "subject-scope-registry",
  versionRef: "subject-scope-v1",
};
const delegation = {
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
};

function resolver({
  subjectScopeRecord = subjectScope,
  delegationRecord = delegation,
  workspace = { workspaceRef: "workspace-a", status: "active" },
} = {}) {
  return createSubjectScopeDelegationResolverService({
    subjectScopeRepository: {
      async findSubjectScope() {
        return subjectScopeRecord;
      },
    },
    delegationContextRepository: {
      async findDelegationContext() {
        return delegationRecord;
      },
    },
    authorizedScopeRepository: {
      async findAuthorizedScope() {
        return {
          membership: { status: "active", role: "owner" },
          workspaces: [workspace],
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

await expectCode(
  () => resolver({
    subjectScopeRecord: {
      ...subjectScope,
      delegationAllowed: undefined,
    },
  }).resolve({
    principal: supportPrincipal,
    subject,
    delegationRef: "delegation-a",
    operationIntent: "workspace.read",
  }),
  "subject_delegation_not_allowed",
);

await expectCode(
  () => resolver({
    workspace: { workspaceRef: "workspace-a" },
  }).resolve({
    principal: tenantPrincipal,
    subject,
    operationIntent: "workspace.read",
  }),
  "subject_workspace_not_authorized",
);

await expectCode(
  () => resolver({
    delegationRecord: {
      ...delegation,
      status: undefined,
    },
  }).resolve({
    principal: supportPrincipal,
    subject,
    delegationRef: "delegation-a",
    operationIntent: "workspace.read",
  }),
  "subject_delegation_evidence_invalid",
);

console.log("context kernel subject delegation fail-closed tests passed");
