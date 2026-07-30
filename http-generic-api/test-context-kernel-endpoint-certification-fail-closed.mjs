import assert from "node:assert/strict";

import { createEndpointCertificationResolverService } from "./contextKernel/application/endpointCertificationResolverService.js";
import { evaluateEndpointCertification } from "./contextKernel/domain/endpointCertificationPolicy.js";

const binding = Object.freeze({
  principalType: "tenant_user",
  principalRef: "user-a",
  subjectType: "tenant_user",
  subjectRef: "user-a",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  capabilityKey: "content.article.create_draft",
  providerBindingRef: "binding-wordpress-a",
  providerFamily: "wordpress_rest",
  connectionRef: "connection-wordpress-a",
  parentActionKey: "wordpress_create_post",
  configuredEndpointKey: "wordpress_api",
  environmentKey: "production",
  riskClass: "C",
});

const now = new Date("2030-01-01T00:10:00.000Z");

function alias(overrides = {}) {
  return {
    aliasRef: "alias-wordpress-api",
    parentActionKey: binding.parentActionKey,
    aliasEndpointKey: binding.configuredEndpointKey,
    canonicalEndpointKey: "wordpress_create_post_v2",
    status: "active",
    validFrom: "2030-01-01T00:00:00.000Z",
    validUntil: "2030-01-01T01:00:00.000Z",
    ...overrides,
  };
}

function endpoint(overrides = {}) {
  return {
    endpointRef: "endpoint-wordpress-create-post-v2",
    parentActionKey: binding.parentActionKey,
    endpointKey: "wordpress_create_post_v2",
    providerFamily: binding.providerFamily,
    environmentKey: binding.environmentKey,
    status: "active",
    executionReadiness: "ready",
    schemaPresent: true,
    method: "POST",
    revisionRef: "endpoint-revision-a",
    validFrom: "2030-01-01T00:00:00.000Z",
    validUntil: "2030-01-01T01:00:00.000Z",
    ...overrides,
  };
}

function certification(overrides = {}) {
  return {
    certificationRef: "certification-wordpress-create-post-v2",
    endpointRef: "endpoint-wordpress-create-post-v2",
    canonicalEndpointKey: "wordpress_create_post_v2",
    parentActionKey: binding.parentActionKey,
    providerBindingRef: binding.providerBindingRef,
    providerFamily: binding.providerFamily,
    connectionRef: binding.connectionRef,
    environmentKey: binding.environmentKey,
    riskClass: binding.riskClass,
    certificationStatus: "runtime_certified",
    dispatchAllowed: true,
    applyAllowed: false,
    requiresResourceAuthority: true,
    requiresDryRun: true,
    requiresAuditEvidence: true,
    requiresReadback: true,
    evidenceRef: "ci-evidence-wordpress-a",
    certifiedAt: "2030-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T01:00:00.000Z",
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    ...binding,
    sourceRef: "endpoint-certification-source-a",
    versionRef: "endpoint-certification-version-a",
    evaluatedAt: "2030-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T01:00:00.000Z",
    aliases: [alias()],
    endpoints: [endpoint()],
    certifications: [certification()],
    ...overrides,
  };
}

function evaluate(overrides = {}) {
  return evaluateEndpointCertification({
    snapshot: snapshot(overrides.snapshot || {}),
    ...binding,
    now,
    ...overrides.input,
  });
}

function assertSafeBlocked(result, expectedReasons) {
  assert.equal(result.status, "blocked");
  for (const reason of expectedReasons) assert.equal(result.reasonCodes.includes(reason), true);
  assert.equal(result.endpointResolved, false);
  assert.equal(result.certificationResolved, false);
  assert.equal(result.dispatchCertified, false);
  assert.equal(result.authorityGranted, false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.runtimeAuthorityChanged, false);
  assert.equal(result.automaticWritePerformed, false);
  assert.equal(result.providerCallMade, false);
  assert.equal(result.credentialPayloadRead, false);
  assert.equal(result.secretsIncluded, false);
  assert.equal(Object.isFrozen(result), true);
}

const directCanonical = evaluate({
  snapshot: {
    aliases: [],
    endpoints: [endpoint({ endpointKey: binding.configuredEndpointKey })],
    certifications: [certification({
      endpointRef: "endpoint-wordpress-create-post-v2",
      canonicalEndpointKey: binding.configuredEndpointKey,
    })],
  },
});
assert.equal(directCanonical.status, "resolved");
assert.equal(directCanonical.canonicalEndpointKey, binding.configuredEndpointKey);
assert.equal(directCanonical.aliasEvidence, null);
assert.equal(directCanonical.authorityGranted, false);
assert.equal(directCanonical.executionAuthorized, false);

assertSafeBlocked(evaluate({ snapshot: { resourceRef: "unexpected" } }), [
  "ENDPOINT_CERTIFICATION_SNAPSHOT_MALFORMED",
]);
assertSafeBlocked(evaluate({ snapshot: { tenantRef: "tenant-b" } }), [
  "ENDPOINT_CERTIFICATION_SNAPSHOT_BINDING_MISMATCH",
]);
assertSafeBlocked(evaluate({ snapshot: { evaluatedAt: "2030-01-01T00:11:00.000Z" } }), [
  "ENDPOINT_CERTIFICATION_SNAPSHOT_FROM_FUTURE",
]);
assertSafeBlocked(evaluate({ snapshot: { expiresAt: "2030-01-01T00:10:00.000Z" } }), [
  "ENDPOINT_CERTIFICATION_SNAPSHOT_STALE",
]);

assertSafeBlocked(evaluate({ snapshot: { aliases: {} } }), ["ENDPOINT_ALIAS_MALFORMED"]);
assertSafeBlocked(evaluate({
  snapshot: { aliases: [alias(), alias({ aliasRef: "alias-wordpress-api-b" })] },
}), ["ENDPOINT_ALIAS_AMBIGUOUS"]);
assertSafeBlocked(evaluate({
  snapshot: { aliases: [alias(), alias()] },
}), ["ENDPOINT_ALIAS_REFERENCE_AMBIGUOUS"]);
assertSafeBlocked(evaluate({
  snapshot: { aliases: [alias({ parentActionKey: "other-action" })] },
}), ["ENDPOINT_ALIAS_BINDING_MISMATCH"]);
assertSafeBlocked(evaluate({
  snapshot: { aliases: [alias({ status: "pending" })] },
}), ["ENDPOINT_ALIAS_STATUS_UNSUPPORTED"]);

assertSafeBlocked(evaluate({ snapshot: { endpoints: [] } }), ["CANONICAL_ENDPOINT_UNAVAILABLE"]);
assertSafeBlocked(evaluate({
  snapshot: { endpoints: [endpoint(), endpoint({ endpointRef: "endpoint-b" })] },
}), ["CANONICAL_ENDPOINT_AMBIGUOUS"]);
assertSafeBlocked(evaluate({
  snapshot: { endpoints: [endpoint(), endpoint()] },
}), ["CANONICAL_ENDPOINT_REFERENCE_AMBIGUOUS"]);
assertSafeBlocked(evaluate({
  snapshot: { endpoints: [endpoint({ providerFamily: "generic_runtime" })] },
}), ["CANONICAL_ENDPOINT_BINDING_MISMATCH"]);
assertSafeBlocked(evaluate({
  snapshot: { endpoints: [endpoint({ environmentKey: "staging" })] },
}), ["CANONICAL_ENDPOINT_BINDING_MISMATCH"]);
assertSafeBlocked(evaluate({
  snapshot: { endpoints: [endpoint({ executionReadiness: "pending" })] },
}), ["CANONICAL_ENDPOINT_NOT_READY"]);
assertSafeBlocked(evaluate({
  snapshot: { endpoints: [endpoint({ schemaPresent: false })] },
}), ["CANONICAL_ENDPOINT_SCHEMA_MISSING"]);
assertSafeBlocked(evaluate({
  snapshot: { endpoints: [endpoint({ status: "unknown" })] },
}), ["CANONICAL_ENDPOINT_STATUS_UNSUPPORTED"]);

assertSafeBlocked(evaluate({ snapshot: { certifications: [] } }), ["RUNTIME_CERTIFICATION_MISSING"]);
assertSafeBlocked(evaluate({
  snapshot: {
    certifications: [certification(), certification({ certificationRef: "certification-b" })],
  },
}), ["RUNTIME_CERTIFICATION_AMBIGUOUS"]);
assertSafeBlocked(evaluate({
  snapshot: { certifications: [certification(), certification()] },
}), ["RUNTIME_CERTIFICATION_REFERENCE_AMBIGUOUS"]);
assertSafeBlocked(evaluate({
  snapshot: {
    certifications: [certification({ canonicalEndpointKey: "runtime_endpoint_call" })],
  },
}), ["RUNTIME_CERTIFICATION_BINDING_MISMATCH"]);
assertSafeBlocked(evaluate({
  snapshot: { certifications: [certification({ providerBindingRef: "binding-generic" })] },
}), ["RUNTIME_CERTIFICATION_BINDING_MISMATCH"]);
assertSafeBlocked(evaluate({
  snapshot: { certifications: [certification({ environmentKey: "staging" })] },
}), ["RUNTIME_CERTIFICATION_BINDING_MISMATCH"]);
assertSafeBlocked(evaluate({
  snapshot: { certifications: [certification({ dispatchAllowed: false })] },
}), ["RUNTIME_CERTIFICATION_DISPATCH_NOT_ALLOWED"]);
assertSafeBlocked(evaluate({
  snapshot: { certifications: [certification({ certificationStatus: "baseline_registered" })] },
}), ["RUNTIME_CERTIFICATION_NOT_CURRENT"]);
assertSafeBlocked(evaluate({
  snapshot: { certifications: [certification({ expiresAt: "2030-01-01T00:10:00.000Z" })] },
}), ["RUNTIME_CERTIFICATION_STALE"]);
assertSafeBlocked(evaluate({
  snapshot: { certifications: [certification({ certifiedAt: "2030-01-01T00:11:00.000Z" })] },
}), ["RUNTIME_CERTIFICATION_FROM_FUTURE"]);
assertSafeBlocked(evaluate({
  snapshot: { certifications: [certification({ certificationStatus: "unknown" })] },
}), ["RUNTIME_CERTIFICATION_STATUS_UNSUPPORTED"]);

let repositoryCalls = 0;
const guardedService = createEndpointCertificationResolverService({
  endpointCertificationEvidenceRepository: {
    async findEndpointCertificationEvidence() {
      repositoryCalls += 1;
      return snapshot();
    },
  },
});

const baseServiceInput = {
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
  providerBindingRef: binding.providerBindingRef,
  providerFamily: binding.providerFamily,
  connectionRef: binding.connectionRef,
  parentActionKey: binding.parentActionKey,
  configuredEndpointKey: binding.configuredEndpointKey,
  environmentKey: binding.environmentKey,
  riskClass: binding.riskClass,
  now,
};

await assert.rejects(
  guardedService.resolve({
    ...baseServiceInput,
    effectiveSubject: {
      ...baseServiceInput.effectiveSubject,
      tenantRef: "tenant-b",
    },
    tenantRef: "tenant-b",
  }),
  (error) => error?.code === "endpoint_certification_tenant_not_authorized",
);
assert.equal(repositoryCalls, 0);

await assert.rejects(
  guardedService.resolve({
    ...baseServiceInput,
    workspaceRef: "workspace-b",
  }),
  (error) => error?.code === "endpoint_certification_subject_workspace_mismatch",
);
assert.equal(repositoryCalls, 0);

const missingSnapshotService = createEndpointCertificationResolverService({
  endpointCertificationEvidenceRepository: {
    async findEndpointCertificationEvidence(query) {
      repositoryCalls += 1;
      assert.deepEqual(query, binding);
      return null;
    },
  },
});
await assert.rejects(
  missingSnapshotService.resolve(baseServiceInput),
  (error) => error?.code === "endpoint_certification_snapshot_not_found" && error?.status === 404,
);
assert.equal(repositoryCalls, 1);

console.log("context kernel endpoint certification fail-closed tests passed");
