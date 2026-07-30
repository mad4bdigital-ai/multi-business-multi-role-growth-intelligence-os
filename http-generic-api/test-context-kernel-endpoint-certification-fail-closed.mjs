import assert from "node:assert/strict";

import {
  evaluateEndpointCertificationDecision,
} from "./contextKernel/domain/endpointCertificationDecision.js";
import {
  createEndpointCertificationResolverService,
} from "./contextKernel/application/endpointCertificationResolverService.js";

const NOW = new Date("2030-01-01T00:10:00.000Z");
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
  configuredEndpointKey: "repository.read",
});

function endpoint(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function certification(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function alias(overrides = {}) {
  return {
    ...binding,
    aliasRef: "alias-a",
    aliasEndpointKey: "repository.read",
    canonicalEndpointKey: "repository.read",
    status: "active",
    revisionRef: "alias-revision-a",
    validFrom: "2030-01-01T00:00:00.000Z",
    validUntil: "2030-01-01T01:00:00.000Z",
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
    aliases: [],
    endpoints: [endpoint()],
    certifications: [certification()],
    ...overrides,
  };
}

function evaluate(snapshotValue, inputOverrides = {}) {
  return evaluateEndpointCertificationDecision({
    snapshot: snapshotValue,
    ...binding,
    now: NOW,
    ...inputOverrides,
  });
}

function assertBlocked(result, reasonCode) {
  assert.equal(result.status, "blocked");
  assert.equal(result.decision, "deny");
  assert.ok(result.reasonCodes.includes(reasonCode), `${reasonCode} was not returned`);
  assert.equal(result.endpointResolved, false);
  assert.equal(result.certificationSatisfied, false);
  assert.equal(result.dispatchCertified, false);
  assert.equal(result.authorityGranted, false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.runtimeAuthorityChanged, false);
  assert.equal(result.automaticWritePerformed, false);
  assert.equal(result.providerCallMade, false);
  assert.equal(result.credentialPayloadRead, false);
  assert.equal(result.secretsIncluded, false);
}

assertBlocked(evaluate(null), "ENDPOINT_CERTIFICATION_SNAPSHOT_MALFORMED");
assertBlocked(
  evaluate(snapshot({ tenantRef: "tenant-b" })),
  "ENDPOINT_CERTIFICATION_SNAPSHOT_BINDING_MISMATCH",
);
assertBlocked(
  evaluate(snapshot({ evaluatedAt: "2030-01-01T00:20:00.000Z" })),
  "ENDPOINT_CERTIFICATION_SNAPSHOT_FROM_FUTURE",
);
assertBlocked(
  evaluate(snapshot({ expiresAt: "2030-01-01T00:10:00.000Z" })),
  "ENDPOINT_CERTIFICATION_SNAPSHOT_STALE",
);

assertBlocked(
  evaluate(snapshot({
    aliases: [
      alias({ aliasRef: "alias-a", canonicalEndpointKey: "repository.read" }),
      alias({ aliasRef: "alias-b", canonicalEndpointKey: "repository.inspect" }),
    ],
  })),
  "ENDPOINT_ALIAS_AMBIGUOUS",
);
assertBlocked(
  evaluate(snapshot({ aliases: [alias({ status: "revoked" })] })),
  "ENDPOINT_ALIAS_NOT_ACTIVE",
);
assertBlocked(
  evaluate(snapshot({ aliases: [alias({ status: "mystery" })] })),
  "ENDPOINT_ALIAS_STATUS_UNSUPPORTED",
);
assertBlocked(
  evaluate(snapshot({ aliases: [alias({ tenantRef: "tenant-b" })] })),
  "ENDPOINT_ALIAS_BINDING_MISMATCH",
);

assertBlocked(
  evaluate(snapshot({ endpoints: [] })),
  "CANONICAL_ENDPOINT_UNAVAILABLE",
);
assertBlocked(
  evaluate(snapshot({ endpoints: [endpoint({ schemaPresent: false })] })),
  "ENDPOINT_SCHEMA_MISSING",
);
assertBlocked(
  evaluate(snapshot({ endpoints: [endpoint({ status: "revoked" })] })),
  "CANONICAL_ENDPOINT_DENIED",
);
assertBlocked(
  evaluate(snapshot({
    endpoints: [
      endpoint({ endpointRef: "endpoint-a" }),
      endpoint({ endpointRef: "endpoint-b" }),
    ],
  })),
  "CANONICAL_ENDPOINT_AMBIGUOUS",
);
assertBlocked(
  evaluate(snapshot({ endpoints: [endpoint({ status: "mystery" })] })),
  "ENDPOINT_STATUS_UNSUPPORTED",
);
assertBlocked(
  evaluate(snapshot({ endpoints: [endpoint({ tenantRef: "tenant-b" })] })),
  "ENDPOINT_EVIDENCE_BINDING_MISMATCH",
);
assertBlocked(
  evaluate(snapshot({
    endpoints: [
      endpoint({ endpointRef: "endpoint-a" }),
      endpoint({ endpointRef: "endpoint-a", endpointKey: "repository.inspect" }),
    ],
  })),
  "ENDPOINT_REFERENCE_AMBIGUOUS",
);

assertBlocked(
  evaluate(snapshot({ certifications: [] })),
  "RUNTIME_CERTIFICATION_MISSING",
);
assertBlocked(
  evaluate(snapshot({ certifications: [certification({ status: "revoked" })] })),
  "RUNTIME_CERTIFICATION_DENIED",
);
assertBlocked(
  evaluate(snapshot({
    certifications: [
      certification({ certificationRef: "certification-deny", dispatchAllowed: false }),
      certification({ certificationRef: "certification-allow" }),
    ],
  })),
  "RUNTIME_CERTIFICATION_DENIED",
);
assertBlocked(
  evaluate(snapshot({
    certifications: [
      certification({ certificationRef: "certification-a" }),
      certification({ certificationRef: "certification-b" }),
    ],
  })),
  "RUNTIME_CERTIFICATION_AMBIGUOUS",
);
assertBlocked(
  evaluate(snapshot({
    certifications: [certification({ certifiedAt: "2030-01-01T00:20:00.000Z" })],
  })),
  "RUNTIME_CERTIFICATION_FROM_FUTURE",
);
assertBlocked(
  evaluate(snapshot({ certifications: [certification({ status: "mystery" })] })),
  "CERTIFICATION_STATUS_UNSUPPORTED",
);
assertBlocked(
  evaluate(snapshot({ certifications: [certification({ tenantRef: "tenant-b" })] })),
  "CERTIFICATION_EVIDENCE_BINDING_MISMATCH",
);
assertBlocked(
  evaluate(snapshot({
    certifications: [
      certification({ certificationRef: "certification-a" }),
      certification({ certificationRef: "certification-a", status: "expired" }),
    ],
  })),
  "CERTIFICATION_REFERENCE_AMBIGUOUS",
);

const tooManyEndpoints = Array.from({ length: 51 }, (_, index) => endpoint({
  endpointRef: `endpoint-${index}`,
}));
assertBlocked(
  evaluate(snapshot({ endpoints: tooManyEndpoints })),
  "ENDPOINT_EVIDENCE_LIMIT_EXCEEDED",
);

const missingSnapshotService = createEndpointCertificationResolverService({
  endpointCertificationEvidenceRepository: {
    async findEndpointCertificationEvidence() {
      return null;
    },
  },
});
await assert.rejects(
  () => missingSnapshotService.resolve({
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
    now: NOW,
  }),
  (error) => error?.code === "endpoint_certification_snapshot_not_found" && error?.status === 404,
);

let repositoryCalled = false;
const unauthorizedService = createEndpointCertificationResolverService({
  endpointCertificationEvidenceRepository: {
    async findEndpointCertificationEvidence() {
      repositoryCalled = true;
      return snapshot();
    },
  },
});
await assert.rejects(
  () => unauthorizedService.resolve({
    principal: {
      principalType: binding.principalType,
      principalRef: binding.principalRef,
      authorizedTenantRefs: ["tenant-b"],
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
    now: NOW,
  }),
  (error) => error?.code === "endpoint_certification_tenant_not_authorized" && error?.status === 403,
);
assert.equal(repositoryCalled, false, "unauthorized Tenant scope must not query endpoint evidence");

console.log("context kernel endpoint certification fail-closed tests passed");
