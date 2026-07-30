import assert from "node:assert/strict";

import {
  createPolicyGrantEvaluatorService,
} from "./contextKernel/application/policyGrantEvaluatorService.js";

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

function evidenceRecord(sourceType, overrides = {}) {
  return {
    ...(sourceType === "policy"
      ? { policyRef: "policy-allow-a" }
      : { grantRef: "grant-allow-a" }),
    ...binding,
    effect: "allow",
    status: "active",
    reasonCode: sourceType === "policy" ? "POLICY_TENANT_ALLOW" : "GRANT_USER_ALLOW",
    revisionRef: sourceType === "policy" ? "policy-revision-a" : "grant-revision-a",
    validFrom: "2030-01-01T00:00:00.000Z",
    validUntil: "2030-01-01T01:00:00.000Z",
    ...overrides,
  };
}

const repositoryCalls = [];
const service = createPolicyGrantEvaluatorService({
  policyGrantEvidenceRepository: {
    async findPolicyGrantEvidence(query) {
      repositoryCalls.push(query);
      assert.deepEqual(query, binding);
      return {
        ...binding,
        sourceRef: "policy-grant-source-a",
        versionRef: "policy-grant-version-a",
        evaluatedAt: "2030-01-01T00:00:00.000Z",
        expiresAt: "2030-01-01T01:00:00.000Z",
        policies: [
          evidenceRecord("policy", {
            metadata: {
              accessToken: "must-not-leak",
              nested: { privateKey: "must-not-leak" },
            },
          }),
        ],
        grants: [
          evidenceRecord("grant", {
            credentialPayload: {
              secret: "must-not-leak",
              password: "must-not-leak",
            },
          }),
        ],
        authorizationHeader: "must-not-leak",
      };
    },
  },
});

const result = await service.evaluate({
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
  now: new Date("2030-01-01T00:10:00.000Z"),
});

assert.equal(repositoryCalls.length, 1);
assert.equal(result.status, "resolved");
assert.equal(result.decision, "allow");
assert.deepEqual(result.reasonCodes, ["POLICY_GRANT_ALLOW_RESOLVED"]);
assert.equal(result.policySatisfied, true);
assert.equal(result.grantSatisfied, true);
assert.deepEqual(result.policyEvidence, [{
  reference: "policy-allow-a",
  effect: "allow",
  reasonCode: "POLICY_TENANT_ALLOW",
  revisionRef: "policy-revision-a",
}]);
assert.deepEqual(result.grantEvidence, [{
  reference: "grant-allow-a",
  effect: "allow",
  reasonCode: "GRANT_USER_ALLOW",
  revisionRef: "grant-revision-a",
}]);
assert.deepEqual(result.actor, {
  principalType: binding.principalType,
  principalRef: binding.principalRef,
});
assert.deepEqual(result.effectiveSubject, {
  subjectType: binding.subjectType,
  subjectRef: binding.subjectRef,
  tenantRef: binding.tenantRef,
  workspaceRef: binding.workspaceRef,
  delegatedByPrincipalRef: null,
});
assert.equal(result.capabilityKey, binding.capabilityKey);
assert.equal(result.operation, binding.operation);
assert.deepEqual(result.resource, {
  resourceType: binding.resourceType,
  resourceRef: binding.resourceRef,
});
assert.equal(result.authorityGranted, false);
assert.equal(result.executionAuthorized, false);
assert.equal(result.runtimeAuthorityChanged, false);
assert.equal(result.automaticWritePerformed, false);
assert.equal(result.providerCallMade, false);
assert.equal(result.credentialPayloadRead, false);
assert.equal(result.secretsIncluded, false);

const serialized = JSON.stringify(result);
for (const forbidden of [
  "must-not-leak",
  "accessToken",
  "privateKey",
  "credentialPayload",
  "authorizationHeader",
  "password",
]) {
  assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked into the decision`);
}

assert.equal(Object.isFrozen(result), true);
assert.equal(Object.isFrozen(result.policyEvidence), true);
assert.equal(Object.isFrozen(result.policyEvidence[0]), true);
assert.throws(() => {
  result.policyEvidence.push({});
}, TypeError);
assert.throws(() => {
  result.actor.principalRef = "mutated";
}, TypeError);

assert.throws(
  () => createPolicyGrantEvaluatorService({ policyGrantEvidenceRepository: {} }),
  /findPolicyGrantEvidence/,
);

console.log("context kernel policy grant evaluator tests passed");
