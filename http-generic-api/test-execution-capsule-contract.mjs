import assert from "node:assert/strict";

import {
  compareExecutionCapsuleDependencies,
  createExecutionCapsule,
  createExecutionCapsuleDependencyVector,
  projectExecutionCapsule,
} from "./contextKernel/domain/executionCapsule.js";
import {
  ExecutionCapsuleValidationStatus,
  createExecutionCapsuleService,
} from "./contextKernel/application/executionCapsuleService.js";
import { ContextApplicationError } from "./contextKernel/application/applicationSupport.js";

const ISSUED_AT = "2030-01-01T00:00:00.000Z";
const EXPIRES_AT = "2030-01-01T00:10:00.000Z";

const baseCapsuleInput = Object.freeze({
  contextHash: "context-hash-a",
  contextRevision: "context-revision-a",
  principalType: "tenant_user",
  principalRef: "principal-a",
  effectiveSubjectRef: "subject-a",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  brandRef: "brand-a",
  resourceType: "repository",
  resourceRef: "repository-a",
  connectionRef: "connection-a",
  authorityPathRef: "authority-path-a",
  capabilityKey: "repository.read",
  authorityRevision: "authority-revision-a",
  capabilityRevision: "capability-revision-a",
  registryRevision: "registry-revision-a",
  credentialReadinessRevision: "credential-readiness-revision-a",
  issuedAt: ISSUED_AT,
  expiresAt: EXPIRES_AT,
});

const extraDependencies = [
  {
    domain: "resource",
    ref: "repository:repository-extra",
    revision: "resource-extra-revision-a",
    refreshClass: "static",
  },
  {
    domain: "connection",
    ref: "connection-extra",
    revision: "connection-extra-revision-a",
    refreshClass: "dynamic",
  },
];

function createBaseCapsule(overrides = {}) {
  return createExecutionCapsule({
    ...baseCapsuleInput,
    ...overrides,
    invalidationDependencies:
      overrides.invalidationDependencies || extraDependencies,
  });
}

const capsule = createBaseCapsule();
const reorderedCapsule = createBaseCapsule({
  invalidationDependencies: [...extraDependencies].reverse(),
});
assert.equal(capsule.capsuleHash, reorderedCapsule.capsuleHash);
assert.equal(capsule.capsuleRef, reorderedCapsule.capsuleRef);
assert.match(capsule.capsuleHash, /^[0-9a-f]{64}$/u);
assert.match(capsule.capsuleRef, /^ctxc-[0-9a-f]{32}$/u);
assert.equal(capsule.executionAllowed, false);
assert.equal(capsule.secretsIncluded, false);
assert(Object.isFrozen(capsule));
assert(Object.isFrozen(capsule.invalidationDependencies));
assert(capsule.invalidationDependencies.every(Object.isFrozen));

for (const [field, value] of [
  ["authorityRevision", "authority-revision-b"],
  ["capabilityRevision", "capability-revision-b"],
  ["registryRevision", "registry-revision-b"],
  ["credentialReadinessRevision", "credential-readiness-revision-b"],
]) {
  assert.notEqual(
    capsule.capsuleHash,
    createBaseCapsule({ [field]: value }).capsuleHash,
    `${field} must participate in canonical capsule identity`,
  );
}

assert.throws(
  () => createBaseCapsule({ principalRef: "Bearer secret-token" }),
  /secret-like value/u,
);
assert.throws(
  () => createBaseCapsule({ capsuleRef: "ctxc-not-canonical" }),
  /canonical capsule identity/u,
);
assert.throws(
  () => createBaseCapsule({ expiresAt: ISSUED_AT }),
  /later than issuedAt/u,
);
assert.throws(
  () => createBaseCapsule({
    invalidationDependencies: [
      {
        domain: "authority",
        ref: "authority-path-a",
        revision: "conflicting-authority-revision",
        refreshClass: "static",
      },
    ],
  }),
  /Conflicting execution capsule dependency/u,
);

const tenantProjection = projectExecutionCapsule(capsule, "tenant");
const adminProjection = projectExecutionCapsule(capsule, "admin");
assert.equal(tenantProjection.capsuleRef, capsule.capsuleRef);
assert.equal(tenantProjection.executionAllowed, false);
assert.equal("principalRef" in tenantProjection, false);
assert.equal("authorityPathRef" in tenantProjection, false);
assert.equal("credentialReadinessRevision" in tenantProjection, false);
assert.equal("invalidationDependencies" in tenantProjection, false);
assert.equal(adminProjection.principalRef, "principal-a");
assert.equal(adminProjection.authorityPathRef, "authority-path-a");
assert.equal(
  adminProjection.credentialReadinessRevision,
  "credential-readiness-revision-a",
);
assert(Object.isFrozen(tenantProjection));
assert(Object.isFrozen(adminProjection));

const exactDependencies = capsule.invalidationDependencies.map((dependency) => ({
  ...dependency,
}));
const exactComparison = compareExecutionCapsuleDependencies(
  capsule.invalidationDependencies,
  [
    ...exactDependencies,
    {
      domain: "resource",
      ref: "repository:unrelated-repository",
      revision: "unrelated-revision",
      refreshClass: "static",
    },
  ],
);
assert.equal(exactComparison.valid, true, "unreferenced dependency changes must not invalidate a capsule");

const credentialDependency = capsule.invalidationDependencies.find(
  (dependency) => dependency.domain === "credentialReadiness",
);
const dynamicComparison = compareExecutionCapsuleDependencies(
  capsule.invalidationDependencies,
  exactDependencies.map((dependency) =>
    dependency.domain === "credentialReadiness"
      ? { ...dependency, revision: "credential-readiness-revision-b" }
      : dependency
  ),
);
assert.equal(dynamicComparison.valid, false);
assert.equal(dynamicComparison.dynamicRefreshRequired, true);
assert.equal(dynamicComparison.staticInvalidated, false);
assert.equal(dynamicComparison.changed[0].ref, credentialDependency.ref);

const staticComparison = compareExecutionCapsuleDependencies(
  capsule.invalidationDependencies,
  exactDependencies.map((dependency) =>
    dependency.domain === "authority"
      ? { ...dependency, revision: "authority-revision-b" }
      : dependency
  ),
);
assert.equal(staticComparison.staticInvalidated, true);
assert.equal(staticComparison.dynamicRefreshRequired, false);
assert.throws(
  () => compareExecutionCapsuleDependencies(
    capsule.invalidationDependencies,
    [...exactDependencies, { ...exactDependencies[0] }],
  ),
  /Duplicate currentDependencies dependency/u,
);

const selectedCandidate = Object.freeze({
  candidateType: "connection",
  stableRef: "connection-a",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  brandRef: "brand-a",
  resourceType: "repository",
  resourceRef: "repository-a",
  connectionRef: "connection-a",
});

function createResolution(overrides = {}) {
  const contextOverrides = overrides.context || {};
  const selected = overrides.selectedCandidate || selectedCandidate;
  const contextSelected = contextOverrides.selectedCandidate || selectedCandidate;
  const capabilityReadiness = overrides.capabilityReadiness || {
    capabilityKey: "repository.read",
    dispatchAllowed: true,
    applyAllowed: false,
  };
  return {
    status: overrides.status || "resolved",
    selectedCandidate: selected,
    candidates: overrides.candidates || [selectedCandidate],
    authorityScope: {
      tenantRef: "tenant-a",
      role: "member",
    },
    capabilityReadiness,
    context: {
      contextHash: "context-hash-a",
      contextRevision: "context-revision-a",
      principal: {
        principalType: "tenant_user",
        principalRef: "principal-a",
      },
      effectiveSubject: {
        subjectRef: "subject-a",
        tenantRef: "tenant-a",
        workspaceRef: "workspace-a",
      },
      tenantRef: "tenant-a",
      workspaceRef: "workspace-a",
      brandRef: "brand-a",
      resourceType: "repository",
      resourceRef: "repository-a",
      connectionRef: "connection-a",
      selectedCandidate: contextSelected,
      capability: capabilityReadiness,
      credentials: { accessToken: "must-never-appear" },
      authorization: "Bearer must-never-appear",
      ...contextOverrides,
    },
    credentials: { password: "must-never-appear" },
    authorization: "Bearer must-never-appear",
  };
}

const service = createExecutionCapsuleService({
  clock: () => new Date(ISSUED_AT),
  defaultTtlMs: 10 * 60 * 1000,
});

function resolveCapsule(resolution = createResolution(), overrides = {}) {
  return service.resolve({
    resolution,
    authorityPathRef: "authority-path-a",
    authorityRevision: "authority-revision-a",
    capabilityRevision: "capability-revision-a",
    registryRevision: "registry-revision-a",
    credentialReadinessRevision: "credential-readiness-revision-a",
    ...overrides,
  });
}

const resolved = resolveCapsule();
assert.equal(resolved.status, "resolved");
assert.equal(resolved.executionAllowed, false);
assert.equal(resolved.automaticWritePerformed, false);
assert.equal(resolved.capsule.credentialReadinessRevision, "credential-readiness-revision-a");
assert.equal(resolved.adminProjection.credentialReadinessRevision, "credential-readiness-revision-a");
assert.equal("principalRef" in resolved.tenantProjection, false);
assert.equal(JSON.stringify(resolved).includes("must-never-appear"), false);
assert(Object.isFrozen(resolved));
assert(Object.isFrozen(resolved.capsule));

assert.throws(
  () => resolveCapsule(createResolution({ status: "blocked" })),
  (error) => error instanceof ContextApplicationError &&
    error.code === "execution_capsule_requires_resolved_context",
);
assert.throws(
  () => resolveCapsule(createResolution({ candidates: [] })),
  (error) => error?.code === "execution_capsule_selected_candidate_missing",
);
assert.throws(
  () => resolveCapsule(createResolution({ candidates: [selectedCandidate, selectedCandidate] })),
  (error) => error?.code === "execution_capsule_selected_candidate_ambiguous",
);
assert.throws(
  () => resolveCapsule(createResolution({
    context: { connectionRef: "connection-b" },
  })),
  (error) => error?.code === "execution_capsule_context_candidate_mismatch",
);

const forgedSelectedCandidate = {
  ...selectedCandidate,
  resourceRef: "repository-forged",
  connectionRef: "connection-forged",
};
assert.throws(
  () => resolveCapsule(createResolution({
    selectedCandidate: forgedSelectedCandidate,
    candidates: [selectedCandidate],
    context: {
      selectedCandidate: forgedSelectedCandidate,
      resourceRef: "repository-forged",
      connectionRef: "connection-forged",
    },
  })),
  (error) => error?.code === "execution_capsule_context_candidate_mismatch",
  "caller-selected fields must not override the authorized candidate set",
);
assert.throws(
  () => resolveCapsule(createResolution({
    context: {
      selectedCandidate: {
        ...selectedCandidate,
        resourceRef: "repository-nested-forged",
      },
    },
  })),
  (error) => error?.code === "execution_capsule_context_candidate_mismatch",
  "nested selected candidate must match the authorized candidate exactly",
);
assert.throws(
  () => resolveCapsule(createResolution({
    context: {
      capability: {
        capabilityKey: "repository.write",
        dispatchAllowed: true,
      },
    },
  })),
  (error) => error?.code === "execution_capsule_capability_context_mismatch",
  "context capability and readiness decision must identify the same capability",
);
assert.throws(
  () => resolveCapsule(createResolution({
    capabilityReadiness: {
      capabilityKey: "repository.read",
      dispatchAllowed: false,
      applyAllowed: false,
    },
  })),
  (error) => error?.code === "execution_capsule_capability_not_ready",
);
assert.throws(
  () => resolveCapsule(createResolution(), { expiresAt: ISSUED_AT }),
  (error) => error?.code === "execution_capsule_expiry_invalid",
);

const currentContext = createResolution().context;
const currentDependencies = resolved.capsule.invalidationDependencies.map((dependency) => ({
  ...dependency,
}));

const validRead = service.validate({
  capsule: resolved.capsule,
  currentContext,
  currentDependencies,
  operationKind: "read",
  now: new Date("2030-01-01T00:05:00.000Z"),
});
assert.equal(validRead.status, ExecutionCapsuleValidationStatus.VALID);
assert.equal(validRead.valid, true);
assert.equal(validRead.executionAllowed, false);
assert.equal(validRead.requiresContextReresolution, false);
assert.equal(validRead.dynamicRefreshRequired, false);

const mutationNeedsRefresh = service.validate({
  capsule: resolved.capsule,
  currentContext,
  currentDependencies,
  operationKind: "mutation",
  now: new Date("2030-01-01T00:05:00.000Z"),
});
assert.equal(
  mutationNeedsRefresh.status,
  ExecutionCapsuleValidationStatus.DYNAMIC_REFRESH_REQUIRED,
);
assert.equal(mutationNeedsRefresh.dynamicRefreshRequired, true);
assert.equal(mutationNeedsRefresh.executionAllowed, false);

const mutationContextValid = service.validate({
  capsule: resolved.capsule,
  currentContext,
  currentDependencies,
  operationKind: "mutation",
  dynamicRefreshComplete: true,
  now: new Date("2030-01-01T00:05:00.000Z"),
});
assert.equal(mutationContextValid.status, ExecutionCapsuleValidationStatus.VALID);
assert.equal(mutationContextValid.executionAllowed, false);

const dynamicRefresh = service.validate({
  capsule: resolved.capsule,
  currentContext,
  currentDependencies: currentDependencies.map((dependency) =>
    dependency.domain === "credentialReadiness"
      ? { ...dependency, revision: "credential-readiness-revision-b" }
      : dependency
  ),
  now: new Date("2030-01-01T00:05:00.000Z"),
});
assert.equal(
  dynamicRefresh.status,
  ExecutionCapsuleValidationStatus.DYNAMIC_REFRESH_REQUIRED,
);
assert.equal(dynamicRefresh.dynamicRefreshRequired, true);
assert.equal(dynamicRefresh.requiresContextReresolution, false);

const staticRevisionMismatch = service.validate({
  capsule: resolved.capsule,
  currentContext,
  currentDependencies: currentDependencies.map((dependency) =>
    dependency.domain === "authority"
      ? { ...dependency, revision: "authority-revision-b" }
      : dependency
  ),
  now: new Date("2030-01-01T00:05:00.000Z"),
});
assert.equal(
  staticRevisionMismatch.status,
  ExecutionCapsuleValidationStatus.REVISION_MISMATCH,
);
assert.equal(staticRevisionMismatch.requiresContextReresolution, true);

const contextRevisionMismatch = service.validate({
  capsule: resolved.capsule,
  currentContext: {
    ...currentContext,
    contextRevision: "context-revision-b",
  },
  currentDependencies,
  now: new Date("2030-01-01T00:05:00.000Z"),
});
assert.equal(
  contextRevisionMismatch.status,
  ExecutionCapsuleValidationStatus.REVISION_MISMATCH,
);
assert.deepEqual(
  contextRevisionMismatch.reasonCodes,
  ["execution_capsule_context_revision_mismatch"],
);

const contextMismatch = service.validate({
  capsule: resolved.capsule,
  currentContext: {
    ...currentContext,
    connectionRef: "connection-b",
  },
  currentDependencies,
  now: new Date("2030-01-01T00:05:00.000Z"),
});
assert.equal(contextMismatch.status, ExecutionCapsuleValidationStatus.CONTEXT_MISMATCH);
assert.deepEqual(contextMismatch.mismatchFields, ["connectionRef"]);

const expired = service.validate({
  capsule: resolved.capsule,
  currentContext,
  currentDependencies,
  now: new Date("2030-01-01T00:10:00.000Z"),
});
assert.equal(expired.status, ExecutionCapsuleValidationStatus.EXPIRED);
assert.equal(expired.requiresContextReresolution, true);

const blocked = service.validate({
  capsule: resolved.capsule,
  currentContext,
  currentDependencies,
  blockedReasonCodes: ["authority_revoked", "authority_revoked"],
});
assert.equal(blocked.status, ExecutionCapsuleValidationStatus.BLOCKED);
assert.deepEqual(blocked.reasonCodes, ["authority_revoked"]);
assert.equal(blocked.executionAllowed, false);

const interpretation = service.validate({
  capsule: resolved.capsule,
  currentContext,
  currentDependencies,
  interpretationRequired: true,
});
assert.equal(
  interpretation.status,
  ExecutionCapsuleValidationStatus.INTERPRETATION_REQUIRED,
);
assert.equal(interpretation.requiresContextReresolution, true);
assert.throws(
  () => service.validate({
    capsule: resolved.capsule,
    currentContext,
    currentDependencies,
    blockedReasonCodes: ["Bearer unsafe-value"],
  }),
  /bounded reason code/u,
);

const dependencyVector = createExecutionCapsuleDependencyVector({
  ...baseCapsuleInput,
});
assert(dependencyVector.some((dependency) =>
  dependency.domain === "credentialReadiness" &&
  dependency.refreshClass === "dynamic"
));

console.log("execution capsule contract tests passed");
