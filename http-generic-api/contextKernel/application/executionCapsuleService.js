import {
  compareExecutionCapsuleDependencies,
  createExecutionCapsule,
  projectExecutionCapsule,
} from "../domain/executionCapsule.js";
import {
  ContextApplicationError,
  freezeApplicationValue,
  requireApplicationFunction,
  requireApplicationObject,
  requireApplicationString,
} from "./applicationSupport.js";

export const ExecutionCapsuleValidationStatus = Object.freeze({
  VALID: "valid",
  EXPIRED: "expired",
  REVISION_MISMATCH: "revision_mismatch",
  CONTEXT_MISMATCH: "context_mismatch",
  DYNAMIC_REFRESH_REQUIRED: "dynamic_refresh_required",
  INTERPRETATION_REQUIRED: "interpretation_required",
  BLOCKED: "blocked",
});

const OPERATION_KINDS = new Set(["read", "mutation"]);

function optionalString(value) {
  if (value == null || value === "") return null;
  return requireApplicationString(value, "value");
}

function normalizedDate(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${fieldName} must be a valid date.`);
  return date;
}

function selectedCandidateFromResolution(resolution) {
  const selected = requireApplicationObject(
    resolution.selectedCandidate,
    "resolution.selectedCandidate",
  );
  const stableRef = requireApplicationString(selected.stableRef, "selectedCandidate.stableRef");
  const candidates = Array.isArray(resolution.candidates) ? resolution.candidates : [];
  const exactMatches = candidates.filter((candidate) => candidate?.stableRef === stableRef);
  if (exactMatches.length !== 1) {
    throw new ContextApplicationError(
      exactMatches.length === 0
        ? "execution_capsule_selected_candidate_missing"
        : "execution_capsule_selected_candidate_ambiguous",
      exactMatches.length === 0
        ? "The selected execution candidate is not present in the resolved candidate set."
        : "The selected execution candidate is ambiguous in the resolved candidate set.",
      409,
      { selected_candidate_ref: stableRef, exact_match_count: exactMatches.length },
    );
  }
  return selected;
}

function assertExactContextConsistency(context, selected) {
  const contextSelected = requireApplicationObject(
    context.selectedCandidate,
    "resolution.context.selectedCandidate",
  );
  const pairs = [
    ["stableRef", contextSelected.stableRef, selected.stableRef],
    ["tenantRef", context.tenantRef, selected.tenantRef],
    ["workspaceRef", context.workspaceRef, selected.workspaceRef],
    ["brandRef", context.brandRef ?? null, selected.brandRef ?? null],
    ["resourceType", context.resourceType, selected.resourceType],
    ["resourceRef", context.resourceRef, selected.resourceRef],
    ["connectionRef", context.connectionRef, selected.connectionRef],
  ];
  const mismatches = pairs
    .filter(([, left, right]) => (left ?? null) !== (right ?? null))
    .map(([field]) => field);
  if (contextSelected.stableRef !== selected.stableRef) mismatches.push("contextSelectedCandidateRef");
  if (mismatches.length > 0) {
    throw new ContextApplicationError(
      "execution_capsule_context_candidate_mismatch",
      "Resolved context and selected candidate do not describe the same exact target.",
      409,
      { mismatch_fields: [...new Set(mismatches)].sort() },
    );
  }
}

function contextIdentity(context) {
  const principal = requireApplicationObject(context.principal, "context.principal");
  const subject = requireApplicationObject(
    context.effectiveSubject,
    "context.effectiveSubject",
  );
  return {
    contextHash: requireApplicationString(context.contextHash, "context.contextHash"),
    contextRevision: requireApplicationString(
      context.contextRevision,
      "context.contextRevision",
    ),
    principalType: requireApplicationString(
      principal.principalType,
      "context.principal.principalType",
    ),
    principalRef: requireApplicationString(
      principal.principalRef,
      "context.principal.principalRef",
    ),
    effectiveSubjectRef: requireApplicationString(
      subject.subjectRef,
      "context.effectiveSubject.subjectRef",
    ),
    tenantRef: requireApplicationString(context.tenantRef, "context.tenantRef"),
    workspaceRef: requireApplicationString(context.workspaceRef, "context.workspaceRef"),
    brandRef: optionalString(context.brandRef),
    resourceType: requireApplicationString(context.resourceType, "context.resourceType"),
    resourceRef: requireApplicationString(context.resourceRef, "context.resourceRef"),
    connectionRef: requireApplicationString(context.connectionRef, "context.connectionRef"),
  };
}

function capsuleContextMismatchFields(capsule, currentContext) {
  const current = contextIdentity(currentContext);
  const pairs = [
    ["contextHash", capsule.contextHash, current.contextHash],
    ["contextRevision", capsule.contextRevision, current.contextRevision],
    ["principalType", capsule.principalType, current.principalType],
    ["principalRef", capsule.principalRef, current.principalRef],
    ["effectiveSubjectRef", capsule.effectiveSubjectRef, current.effectiveSubjectRef],
    ["tenantRef", capsule.tenantRef, current.tenantRef],
    ["workspaceRef", capsule.workspaceRef, current.workspaceRef],
    ["brandRef", capsule.brandRef ?? null, current.brandRef ?? null],
    ["resourceType", capsule.resourceType, current.resourceType],
    ["resourceRef", capsule.resourceRef, current.resourceRef],
    ["connectionRef", capsule.connectionRef, current.connectionRef],
  ];
  return pairs
    .filter(([, expected, actual]) => expected !== actual)
    .map(([field]) => field)
    .sort();
}

function validationResult({
  status,
  capsule,
  reasonCodes = [],
  mismatchFields = [],
  dependencyComparison = null,
  validatedAt,
}) {
  return freezeApplicationValue({
    status,
    valid: status === ExecutionCapsuleValidationStatus.VALID,
    capsuleRef: capsule.capsuleRef,
    contextHash: capsule.contextHash,
    contextRevision: capsule.contextRevision,
    reasonCodes: [...new Set(reasonCodes)],
    mismatchFields: [...new Set(mismatchFields)].sort(),
    dependencyComparison,
    requiresContextReresolution: [
      ExecutionCapsuleValidationStatus.REVISION_MISMATCH,
      ExecutionCapsuleValidationStatus.CONTEXT_MISMATCH,
      ExecutionCapsuleValidationStatus.INTERPRETATION_REQUIRED,
    ].includes(status),
    dynamicRefreshRequired:
      status === ExecutionCapsuleValidationStatus.DYNAMIC_REFRESH_REQUIRED,
    executionAllowed: false,
    automaticWritePerformed: false,
    validatedAt,
    secretsIncluded: false,
  });
}

export function createExecutionCapsuleService({
  clock = () => new Date(),
  defaultTtlMs = 15 * 60 * 1000,
} = {}) {
  requireApplicationFunction(clock, "clock");
  if (!Number.isFinite(defaultTtlMs) || defaultTtlMs <= 0) {
    throw new TypeError("defaultTtlMs must be a positive finite number.");
  }

  function resolve({
    resolution,
    authorityPathRef,
    authorityRevision,
    capabilityRevision,
    registryRevision,
    credentialReadinessRevision,
    invalidationDependencies = [],
    expiresAt = null,
  }) {
    const resolved = requireApplicationObject(resolution, "resolution");
    if (resolved.status !== "resolved" || !resolved.context || !resolved.selectedCandidate) {
      throw new ContextApplicationError(
        "execution_capsule_requires_resolved_context",
        "An execution capsule can only be created from one resolved exact context.",
        409,
      );
    }
    const context = requireApplicationObject(resolved.context, "resolution.context");
    const selected = selectedCandidateFromResolution(resolved);
    assertExactContextConsistency(context, selected);
    const identity = contextIdentity(context);
    const readiness = resolved.capabilityReadiness || context.capability || null;
    const capabilityKey = requireApplicationString(
      readiness?.capabilityKey,
      "capabilityKey",
    );

    const issued = normalizedDate(clock(), "clock result");
    const expiry = expiresAt == null
      ? new Date(issued.getTime() + defaultTtlMs)
      : normalizedDate(expiresAt, "expiresAt");
    if (expiry.getTime() <= issued.getTime()) {
      throw new ContextApplicationError(
        "execution_capsule_expiry_invalid",
        "Execution capsule expiry must be later than issuance.",
        422,
      );
    }

    const capsule = createExecutionCapsule({
      ...identity,
      authorityPathRef: requireApplicationString(authorityPathRef, "authorityPathRef"),
      capabilityKey,
      authorityRevision: requireApplicationString(authorityRevision, "authorityRevision"),
      capabilityRevision: requireApplicationString(capabilityRevision, "capabilityRevision"),
      registryRevision: requireApplicationString(registryRevision, "registryRevision"),
      credentialReadinessRevision: requireApplicationString(
        credentialReadinessRevision,
        "credentialReadinessRevision",
      ),
      invalidationDependencies,
      issuedAt: issued,
      expiresAt: expiry,
    });

    return freezeApplicationValue({
      status: "resolved",
      capsule,
      tenantProjection: projectExecutionCapsule(capsule, "tenant"),
      adminProjection: projectExecutionCapsule(capsule, "admin"),
      executionAllowed: false,
      automaticWritePerformed: false,
      secretsIncluded: false,
    });
  }

  function validate({
    capsule,
    currentContext,
    currentDependencies,
    operationKind = "read",
    dynamicRefreshComplete = false,
    interpretationRequired = false,
    blockedReasonCodes = [],
    now = clock(),
  }) {
    const value = requireApplicationObject(capsule, "capsule");
    const context = requireApplicationObject(currentContext, "currentContext");
    if (!OPERATION_KINDS.has(operationKind)) {
      throw new TypeError(`Unsupported operationKind: ${operationKind}`);
    }
    if (!Array.isArray(currentDependencies)) {
      throw new TypeError("currentDependencies must be an array.");
    }
    if (!Array.isArray(blockedReasonCodes)) {
      throw new TypeError("blockedReasonCodes must be an array.");
    }
    const validatedAt = normalizedDate(now, "now").toISOString();

    if (blockedReasonCodes.length > 0) {
      return validationResult({
        status: ExecutionCapsuleValidationStatus.BLOCKED,
        capsule: value,
        reasonCodes: blockedReasonCodes.map((reason) => String(reason)),
        validatedAt,
      });
    }
    if (interpretationRequired === true) {
      return validationResult({
        status: ExecutionCapsuleValidationStatus.INTERPRETATION_REQUIRED,
        capsule: value,
        reasonCodes: ["execution_capsule_interpretation_required"],
        validatedAt,
      });
    }

    const mismatchFields = capsuleContextMismatchFields(value, context);
    if (mismatchFields.length > 0) {
      return validationResult({
        status: ExecutionCapsuleValidationStatus.CONTEXT_MISMATCH,
        capsule: value,
        reasonCodes: ["execution_capsule_context_mismatch"],
        mismatchFields,
        validatedAt,
      });
    }

    if (Date.parse(value.expiresAt) <= Date.parse(validatedAt)) {
      return validationResult({
        status: ExecutionCapsuleValidationStatus.EXPIRED,
        capsule: value,
        reasonCodes: ["execution_capsule_expired"],
        validatedAt,
      });
    }

    const comparison = compareExecutionCapsuleDependencies(
      value.invalidationDependencies,
      currentDependencies,
    );
    if (comparison.staticInvalidated) {
      return validationResult({
        status: ExecutionCapsuleValidationStatus.REVISION_MISMATCH,
        capsule: value,
        reasonCodes: ["execution_capsule_static_revision_mismatch"],
        dependencyComparison: comparison,
        validatedAt,
      });
    }
    if (
      comparison.dynamicRefreshRequired ||
      (operationKind === "mutation" && dynamicRefreshComplete !== true)
    ) {
      return validationResult({
        status: ExecutionCapsuleValidationStatus.DYNAMIC_REFRESH_REQUIRED,
        capsule: value,
        reasonCodes: comparison.dynamicRefreshRequired
          ? ["execution_capsule_dynamic_dependency_changed"]
          : ["execution_capsule_mutation_refresh_required"],
        dependencyComparison: comparison,
        validatedAt,
      });
    }

    return validationResult({
      status: ExecutionCapsuleValidationStatus.VALID,
      capsule: value,
      dependencyComparison: comparison,
      validatedAt,
    });
  }

  return Object.freeze({ resolve, validate });
}
