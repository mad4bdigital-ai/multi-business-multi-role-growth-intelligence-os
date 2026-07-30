import assert from "node:assert/strict";

import { createPolicyGrantEvaluatorService } from "./contextKernel/application/policyGrantEvaluatorService.js";
import { evaluatePolicyGrantDecision } from "./contextKernel/domain/policyGrantDecision.js";

const binding = Object.freeze({
  principalType: "tenant_user",
  principalRef: "user-a",
  subjectType: "tenant_user",
  subjectRef: "user-a",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  capabilityKey: "repository.read",
  operation: "repository_read",
  resourceType: "repository",
  resourceRef: "repo-a",
});

const now = new Date("2030-01-01T00:10:00.000Z");

function policy(overrides = {}) {
  return {
    policyRef: "policy-allow-a",
    ...binding,
    effect: "allow",
    status: "active",
    reasonCode: "POLICY_TENANT_ALLOW",
    revisionRef: "policy-revision-a",
    validFrom: "2030-01-01T00:00:00.000Z",
    validUntil: "2030-01-01T01:00:00.000Z",
    ...overrides,
  };
}

function grant(overrides = {}) {
  return {
    grantRef: "grant-allow-a",
    ...binding,
    effect: "allow",
    status: "active",
    reasonCode: "GRANT_USER_ALLOW",
    revisionRef: "grant-revision-a",
    validFrom: "2030-01-01T00:00:00.000Z",
    validUntil: "2030-01-01T01:00:00.000Z",
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    ...binding,
    sourceRef: "policy-grant-source-a",
    versionRef: "policy-grant-version-a",
    evaluatedAt: "2030-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T01:00:00.000Z",
    policies: [policy()],
    grants: [grant()],
    ...overrides,
  };
}

function evaluate(overrides = {}) {
  return evaluatePolicyGrantDecision({
    snapshot: snapshot(overrides.snapshot || {}),
    ...binding,
    now,
    ...overrides.input,
  });
}

function assertSafeBlocked(result, expectedReasons) {
  assert.equal(result.status, "blocked");
  assert.equal(result.decision, "deny");
  for (const reason of expectedReasons) assert.equal(result.reasonCodes.includes(reason), true);
  assert.equal(result.policySatisfied, false);
  assert.equal(result.grantSatisfied, false);
  assert.equal(result.authorityGranted, false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.runtimeAuthorityChanged, false);
  assert.equal(result.automaticWritePerformed, false);
  assert.equal(result.providerCallMade, false);
  assert.equal(result.credentialPayloadRead, false);
  assert.equal(result.secretsIncluded, false);
  assert.equal(Object.isFrozen(result), true);
}

const policyDeny = evaluate({
  snapshot: {
    policies: [
      policy(),
      policy({
        policyRef: "policy-deny-a",
        effect: "deny",
        reasonCode: "POLICY_RESOURCE_RESTRICTED",
      }),
    ],
  },
});
assertSafeBlocked(policyDeny, ["POLICY_EXPLICIT_DENY", "POLICY_RESOURCE_RESTRICTED"]);
assert.deepEqual(policyDeny.policyEvidence, [{
  reference: "policy-deny-a",
  effect: "deny",
  reasonCode: "POLICY_RESOURCE_RESTRICTED",
  revisionRef: "policy-revision-a",
}]);

const grantDeny = evaluate({
  snapshot: {
    grants: [
      grant(),
      grant({
        grantRef: "grant-deny-a",
        effect: "deny",
        reasonCode: "GRANT_SUBJECT_SUSPENDED",
      }),
    ],
  },
});
assertSafeBlocked(grantDeny, ["GRANT_EXPLICIT_DENY", "GRANT_SUBJECT_SUSPENDED"]);

assertSafeBlocked(evaluate({ snapshot: { policies: [] } }), ["POLICY_ALLOW_NOT_FOUND"]);
assertSafeBlocked(evaluate({ snapshot: { grants: [] } }), ["GRANT_ALLOW_NOT_FOUND"]);
assertSafeBlocked(evaluate({
  snapshot: { policies: [policy({ status: "inactive" })] },
}), ["POLICY_ALLOW_NOT_FOUND"]);
assertSafeBlocked(evaluate({
  snapshot: { grants: [grant({ revokedAt: "2030-01-01T00:05:00.000Z" })] },
}), ["GRANT_ALLOW_NOT_FOUND"]);

assertSafeBlocked(evaluate({
  snapshot: { resourceRef: "repo-b" },
}), ["POLICY_GRANT_SNAPSHOT_BINDING_MISMATCH"]);
assertSafeBlocked(evaluate({
  snapshot: { expiresAt: "2030-01-01T00:10:00.000Z" },
}), ["POLICY_GRANT_SNAPSHOT_STALE"]);
assertSafeBlocked(evaluate({
  snapshot: { evaluatedAt: "2030-01-01T00:11:00.000Z" },
}), ["POLICY_GRANT_SNAPSHOT_FROM_FUTURE"]);

assertSafeBlocked(evaluate({
  snapshot: { policies: [policy(), policy()] },
}), ["POLICY_REFERENCE_AMBIGUOUS"]);
assertSafeBlocked(evaluate({
  snapshot: { grants: [grant(), grant()] },
}), ["GRANT_REFERENCE_AMBIGUOUS"]);
assertSafeBlocked(evaluate({
  snapshot: { policies: [policy({ effect: "audit" })] },
}), ["POLICY_EFFECT_UNSUPPORTED"]);
assertSafeBlocked(evaluate({
  snapshot: { grants: [grant({ status: "pending" })] },
}), ["GRANT_STATUS_UNSUPPORTED"]);
assertSafeBlocked(evaluate({
  snapshot: { policies: [policy({ resourceRef: "repo-b" })] },
}), ["POLICY_EVIDENCE_BINDING_MISMATCH"]);
assertSafeBlocked(evaluate({
  snapshot: { grants: [grant({ tenantRef: "tenant-b" })] },
}), ["GRANT_EVIDENCE_BINDING_MISMATCH"]);
assertSafeBlocked(evaluate({
  snapshot: { policies: { invalid: true } },
}), ["POLICY_EVIDENCE_MALFORMED"]);
assertSafeBlocked(evaluate({
  snapshot: { grants: null },
}), ["GRANT_EVIDENCE_MALFORMED"]);

const tooManyPolicies = Array.from({ length: 101 }, (_, index) => policy({
  policyRef: `policy-${index}`,
}));
assertSafeBlocked(evaluate({
  snapshot: { policies: tooManyPolicies },
}), ["POLICY_EVIDENCE_LIMIT_EXCEEDED"]);

const tooManyGrants = Array.from({ length: 101 }, (_, index) => grant({
  grantRef: `grant-${index}`,
}));
assertSafeBlocked(evaluate({
  snapshot: { grants: tooManyGrants },
}), ["GRANT_EVIDENCE_LIMIT_EXCEEDED"]);

let repositoryCalls = 0;
const tenantGuardService = createPolicyGrantEvaluatorService({
  policyGrantEvidenceRepository: {
    async findPolicyGrantEvidence() {
      repositoryCalls += 1;
      return snapshot();
    },
  },
});

await assert.rejects(
  tenantGuardService.evaluate({
    principal: {
      principalType: binding.principalType,
      principalRef: binding.principalRef,
      authorizedTenantRefs: [binding.tenantRef],
    },
    effectiveSubject: {
      subjectType: binding.subjectType,
      subjectRef: binding.subjectRef,
      tenantRef: "tenant-b",
      workspaceRef: binding.workspaceRef,
    },
    tenantRef: "tenant-b",
    capabilityKey: binding.capabilityKey,
    operation: binding.operation,
    resource: {
      resourceType: binding.resourceType,
      resourceRef: binding.resourceRef,
    },
    now,
  }),
  (error) => error?.code === "policy_grant_tenant_not_authorized" && error?.status === 403,
);
assert.equal(repositoryCalls, 0);

const workspaceGuardService = createPolicyGrantEvaluatorService({
  policyGrantEvidenceRepository: {
    async findPolicyGrantEvidence() {
      repositoryCalls += 1;
      return snapshot();
    },
  },
});
await assert.rejects(
  workspaceGuardService.evaluate({
    principal: {
      principalType: binding.principalType,
      principalRef: binding.principalRef,
      authorizedTenantRefs: [binding.tenantRef],
    },
    effectiveSubject: {
      subjectType: binding.subjectType,
      subjectRef: binding.subjectRef,
      tenantRef: binding.tenantRef,
      workspaceRef: binding.workspaceRef,
    },
    workspaceRef: "workspace-b",
    capabilityKey: binding.capabilityKey,
    operation: binding.operation,
    resource: {
      resourceType: binding.resourceType,
      resourceRef: binding.resourceRef,
    },
    now,
  }),
  (error) => error?.code === "policy_grant_subject_workspace_mismatch",
);
assert.equal(repositoryCalls, 0);

const missingSnapshotService = createPolicyGrantEvaluatorService({
  policyGrantEvidenceRepository: {
    async findPolicyGrantEvidence(query) {
      repositoryCalls += 1;
      assert.deepEqual(query, binding);
      return null;
    },
  },
});
await assert.rejects(
  missingSnapshotService.evaluate({
    principal: {
      principalType: binding.principalType,
      principalRef: binding.principalRef,
      authorizedTenantRefs: [binding.tenantRef],
    },
    effectiveSubject: {
      subjectType: binding.subjectType,
      subjectRef: binding.subjectRef,
      tenantRef: binding.tenantRef,
      workspaceRef: binding.workspaceRef,
    },
    capabilityKey: binding.capabilityKey,
    operation: binding.operation,
    resource: {
      resourceType: binding.resourceType,
      resourceRef: binding.resourceRef,
    },
    now,
  }),
  (error) => error?.code === "policy_grant_snapshot_not_found" && error?.status === 404,
);
assert.equal(repositoryCalls, 1);

console.log("context kernel policy grant fail-closed tests passed");
