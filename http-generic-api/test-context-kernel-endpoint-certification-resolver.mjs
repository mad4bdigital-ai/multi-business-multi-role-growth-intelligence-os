import assert from "node:assert/strict";

import {
  createEndpointCertificationResolverService,
} from "./contextKernel/application/endpointCertificationResolverService.js";

const binding = Object.freeze({
  principalType: "tenant_user",
  principalRef: "user-a",
  subjectType: "tenant_user",
  subjectRef: "user-a",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  capabilityKey: "repository.read",
  providerBindingRef: "binding-a",
  appKey: "github",
  parentActionKey: "repository.read",
  configuredEndpointKey: "legacy.repository.read",
});

function collectObjectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectObjectKeys(child, keys);
    return keys;
  }
  if (!value || typeof value !== "object") return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    collectObjectKeys(child, keys);
  }
  return keys;
}

const repositoryCalls = [];
const service = createEndpointCertificationResolverService({
  endpointCertificationEvidenceRepository: {
    async findEndpointCertificationEvidence(query) {
      repositoryCalls.push(query);
      assert.deepEqual(query, binding);
      return {
        ...binding,
        sourceRef: "endpoint-certification-source-a",
        versionRef: "endpoint-certification-version-a",
        evaluatedAt: "2030-01-01T00:00:00.000Z",
        expiresAt: "2030-01-01T01:00:00.000Z",
        aliases: [
          {
            ...binding,
            aliasRef: "alias-a",
            aliasEndpointKey: binding.configuredEndpointKey,
            canonicalEndpointKey: "repository.read",
            status: "active",
            revisionRef: "alias-revision-a",
            validFrom: "2030-01-01T00:00:00.000Z",
            validUntil: "2030-01-01T01:00:00.000Z",
            metadata: { accessToken: "must-not-leak" },
          },
        ],
        endpoints: [
          {
            ...binding,
            endpointRef: "endpoint-a",
            endpointKey: "repository.read",
            status: "active",
            executionReadiness: "ready",
            schemaPresent: true,
            method: "GET",
            endpointPathOrFunction: "/repositories/{repository}",
            moduleBinding: "github.repository.read",
            connectorFamily: "github",
            revisionRef: "endpoint-revision-a",
            validFrom: "2030-01-01T00:00:00.000Z",
            validUntil: "2030-01-01T01:00:00.000Z",
            authorizationHeader: "must-not-leak",
          },
        ],
        certifications: [
          {
            ...binding,
            certificationRef: "certification-a",
            endpointKey: "repository.read",
            status: "certified",
            dispatchAllowed: true,
            applyAllowed: false,
            revisionRef: "certification-revision-a",
            certifiedAt: "2030-01-01T00:00:00.000Z",
            validFrom: "2030-01-01T00:00:00.000Z",
            validUntil: "2030-01-01T01:00:00.000Z",
            credentialPayload: { password: "must-not-leak" },
          },
        ],
        secret: "must-not-leak",
      };
    },
  },
});

const result = await service.resolve({
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
  providerBinding: {
    providerBindingRef: binding.providerBindingRef,
    appKey: binding.appKey,
    parentActionKey: binding.parentActionKey,
    configuredEndpointKey: binding.configuredEndpointKey,
  },
  now: new Date("2030-01-01T00:10:00.000Z"),
});

assert.equal(repositoryCalls.length, 1);
assert.equal(result.status, "resolved");
assert.equal(result.decision, "allow");
assert.deepEqual(result.reasonCodes, ["ENDPOINT_CERTIFICATION_RESOLVED"]);
assert.equal(result.configuredEndpointKey, binding.configuredEndpointKey);
assert.equal(result.canonicalEndpointKey, "repository.read");
assert.equal(result.aliasApplied, true);
assert.deepEqual(result.aliasEvidence, {
  aliasRef: "alias-a",
  aliasEndpointKey: binding.configuredEndpointKey,
  canonicalEndpointKey: "repository.read",
  revisionRef: "alias-revision-a",
});
assert.deepEqual(result.endpointEvidence, {
  endpointRef: "endpoint-a",
  endpointKey: "repository.read",
  method: "GET",
  endpointPathOrFunction: "/repositories/{repository}",
  moduleBinding: "github.repository.read",
  connectorFamily: "github",
  revisionRef: "endpoint-revision-a",
});
assert.deepEqual(result.certificationEvidence, {
  certificationRef: "certification-a",
  endpointKey: "repository.read",
  status: "certified",
  dispatchAllowed: true,
  applyAllowed: false,
  revisionRef: "certification-revision-a",
  certifiedAt: "2030-01-01T00:00:00.000Z",
  validUntil: "2030-01-01T01:00:00.000Z",
});
assert.equal(result.endpointResolved, true);
assert.equal(result.certificationSatisfied, true);
assert.equal(result.dispatchCertified, true);
assert.equal(result.applyCertified, false);
assert.equal(result.authorityGranted, false);
assert.equal(result.executionAuthorized, false);
assert.equal(result.runtimeAuthorityChanged, false);
assert.equal(result.automaticWritePerformed, false);
assert.equal(result.providerCallMade, false);
assert.equal(result.credentialPayloadRead, false);
assert.equal(result.secretsIncluded, false);

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
assert.deepEqual(result.providerBinding, {
  providerBindingRef: binding.providerBindingRef,
  appKey: binding.appKey,
  parentActionKey: binding.parentActionKey,
  configuredEndpointKey: binding.configuredEndpointKey,
});

const serialized = JSON.stringify(result);
assert.equal(serialized.includes("must-not-leak"), false);
const outputKeys = new Set(collectObjectKeys(result));
for (const forbiddenKey of [
  "accessToken",
  "authorizationHeader",
  "credentialPayload",
  "password",
  "secret",
]) {
  assert.equal(outputKeys.has(forbiddenKey), false, `${forbiddenKey} leaked into the decision`);
}

assert.equal(Object.isFrozen(result), true);
assert.equal(Object.isFrozen(result.endpointEvidence), true);
assert.equal(Object.isFrozen(result.certificationEvidence), true);
assert.throws(() => {
  result.endpointEvidence.endpointRef = "mutated";
}, TypeError);

assert.throws(
  () => createEndpointCertificationResolverService({ endpointCertificationEvidenceRepository: {} }),
  /findEndpointCertificationEvidence/,
);

console.log("context kernel endpoint certification resolver tests passed");
