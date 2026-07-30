import { createEffectiveSubject } from "../domain/model.js";
import { evaluateSupportDelegation } from "../domain/supportDelegationPolicy.js";
import {
  assertAuthorizedScopeRepository,
  assertDelegationContextRepository,
  assertSubjectScopeRepository,
} from "./repositoryPorts.js";
import {
  ContextApplicationError,
  freezeApplicationValue,
  requireApplicationFunction,
  requireApplicationObject,
  requireApplicationString,
  sanitizeApplicationValue,
} from "./applicationSupport.js";

function fail(code, message, status = 403, details = {}) {
  throw new ContextApplicationError(code, message, status, details);
}

function optionalString(value, fieldName) {
  if (value == null || value === "") return null;
  return requireApplicationString(value, fieldName);
}

function parseOptionalInstant(value, fieldName) {
  if (value == null || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${fieldName} must be a valid timestamp.`);
  }
  return parsed;
}

function tenantIsAuthorized(principal, tenantRef) {
  const refs = Array.isArray(principal?.authorizedTenantRefs)
    ? principal.authorizedTenantRefs
    : [];
  return refs.includes("*") || refs.includes(tenantRef);
}

function assertActiveWindow({
  status,
  revokedAt,
  validFrom,
  expiresAt,
  stale,
  conflicting,
  prefix,
  now,
}) {
  if (stale === true) {
    fail(`${prefix}_stale`, `${prefix.replaceAll("_", " ")} evidence is stale.`, 409);
  }
  if (conflicting === true) {
    fail(`${prefix}_conflicting`, `${prefix.replaceAll("_", " ")} evidence is conflicting.`, 409);
  }
  if (revokedAt) {
    fail(`${prefix}_revoked`, `${prefix.replaceAll("_", " ")} has been revoked.`);
  }
  const normalizedStatus = requireApplicationString(status, `${prefix}.status`).toLowerCase();
  if (normalizedStatus !== "active") {
    fail(`${prefix}_status_not_active`, `${prefix.replaceAll("_", " ")} is not active.`);
  }
  const normalizedValidFrom = parseOptionalInstant(validFrom, `${prefix}.validFrom`);
  if (normalizedValidFrom && now.getTime() < normalizedValidFrom.getTime()) {
    fail(`${prefix}_not_yet_active`, `${prefix.replaceAll("_", " ")} is not active yet.`);
  }
  const normalizedExpiresAt = parseOptionalInstant(expiresAt, `${prefix}.expiresAt`);
  if (normalizedExpiresAt && now.getTime() >= normalizedExpiresAt.getTime()) {
    fail(`${prefix}_expired`, `${prefix.replaceAll("_", " ")} has expired.`);
  }
}

function normalizeRequestedSubject(input) {
  const requested = requireApplicationObject(input.subject, "subject");
  return {
    subjectType: requireApplicationString(requested.subjectType, "subject.subjectType"),
    subjectRef: requireApplicationString(requested.subjectRef, "subject.subjectRef"),
    tenantRef: requireApplicationString(requested.tenantRef, "subject.tenantRef"),
    workspaceRef: optionalString(requested.workspaceRef, "subject.workspaceRef"),
  };
}

function normalizeSubjectScopeRecord(record) {
  return {
    subjectType: requireApplicationString(record.subjectType, "subjectScope.subjectType"),
    subjectRef: requireApplicationString(record.subjectRef, "subjectScope.subjectRef"),
    tenantRef: requireApplicationString(record.tenantRef, "subjectScope.tenantRef"),
    workspaceRef: optionalString(record.workspaceRef, "subjectScope.workspaceRef"),
  };
}

function assertSubjectScopeMatchesRequest({ requested, record }) {
  const authoritative = normalizeSubjectScopeRecord(record);
  if (authoritative.subjectType !== requested.subjectType) {
    fail(
      "subject_scope_type_mismatch",
      "Requested and authoritative subject types differ.",
      403,
      {
        requested_subject_type: requested.subjectType,
        authoritative_subject_type: authoritative.subjectType,
      },
    );
  }
  if (authoritative.subjectRef !== requested.subjectRef) {
    fail(
      "subject_scope_reference_mismatch",
      "Requested and authoritative subject references differ.",
    );
  }
  if (authoritative.tenantRef !== requested.tenantRef) {
    fail(
      "subject_scope_tenant_mismatch",
      "Requested tenant scope differs from the authoritative subject scope.",
      403,
      {
        requested_tenant_ref: requested.tenantRef,
        authoritative_tenant_ref: authoritative.tenantRef,
      },
    );
  }
  if (authoritative.workspaceRef !== requested.workspaceRef) {
    fail(
      "subject_scope_workspace_mismatch",
      "Requested workspace scope differs from the authoritative subject scope.",
      403,
      {
        requested_workspace_ref: requested.workspaceRef,
        authoritative_workspace_ref: authoritative.workspaceRef,
      },
    );
  }
  return authoritative;
}

function expectedDirectSubjectType(principalType) {
  if (principalType === "tenant_user") return "tenant_user";
  return principalType;
}

function assertDirectSubject(principal, requested) {
  if (requested.subjectRef !== principal.principalRef) {
    fail(
      "subject_delegation_context_required",
      "A subject different from the acting principal requires delegation context.",
      403,
      { subject_ref: requested.subjectRef },
    );
  }
  const expectedType = expectedDirectSubjectType(principal.principalType);
  if (requested.subjectType !== expectedType) {
    fail(
      "subject_direct_type_mismatch",
      "Direct subject type must match the acting principal type.",
      403,
      {
        principal_type: principal.principalType,
        subject_type: requested.subjectType,
      },
    );
  }
}

function findWorkspace(workspaces, workspaceRef) {
  if (!workspaceRef) return null;
  return (Array.isArray(workspaces) ? workspaces : []).find(
    (workspace) => workspace?.workspaceRef === workspaceRef,
  ) || null;
}

async function revalidateSubjectScope({
  effectiveSubject,
  authorizedScopeRepository,
}) {
  if (effectiveSubject.subjectType !== "tenant_user") return null;

  const scope = await authorizedScopeRepository.findAuthorizedScope({
    tenantRef: effectiveSubject.tenantRef,
    userRef: effectiveSubject.subjectRef,
  });
  const membershipStatus = scope?.membership?.status || null;
  if (!scope || membershipStatus !== "active") {
    fail(
      "subject_membership_not_active",
      "Current tenant membership does not authorize the effective subject.",
      403,
      {
        tenant_ref: effectiveSubject.tenantRef,
        subject_ref: effectiveSubject.subjectRef,
        membership_status: membershipStatus,
      },
    );
  }

  let workspaceEvidence = null;
  if (effectiveSubject.workspaceRef) {
    const workspace = findWorkspace(scope.workspaces, effectiveSubject.workspaceRef);
    const workspaceStatus = workspace?.status || "active";
    if (!workspace || workspaceStatus !== "active") {
      fail(
        "subject_workspace_not_authorized",
        "Current workspace scope does not authorize the effective subject.",
        403,
        {
          tenant_ref: effectiveSubject.tenantRef,
          workspace_ref: effectiveSubject.workspaceRef,
          workspace_status: workspace ? workspaceStatus : null,
        },
      );
    }
    workspaceEvidence = {
      workspaceRef: workspace.workspaceRef,
      status: workspaceStatus,
      sourceRef: workspace.sourceRef || scope.sourceRef || null,
      versionRef: workspace.versionRef || scope.versionRef || null,
    };
  }

  return {
    tenantRef: effectiveSubject.tenantRef,
    subjectRef: effectiveSubject.subjectRef,
    role: scope.membership?.role || null,
    status: membershipStatus,
    sourceRef: scope.membership?.sourceRef || scope.sourceRef || null,
    versionRef: scope.membership?.versionRef || scope.versionRef || null,
    workspace: workspaceEvidence,
  };
}

function evaluateDelegation({
  principal,
  effectiveSubject,
  evidence,
  operationIntent,
  now,
}) {
  try {
    return evaluateSupportDelegation({
      principal,
      effectiveSubject,
      evidence,
      operationIntent,
      tenantRef: effectiveSubject.tenantRef,
      workspaceRef: effectiveSubject.workspaceRef,
      now,
    });
  } catch (error) {
    if (error instanceof ContextApplicationError) throw error;
    fail(
      "subject_delegation_evidence_invalid",
      "Delegation evidence does not satisfy the domain contract.",
      409,
      {
        delegation_ref: optionalString(evidence?.delegationRef, "delegation.delegationRef"),
      },
    );
  }
}

export function createSubjectScopeDelegationResolverService({
  subjectScopeRepository,
  delegationContextRepository,
  authorizedScopeRepository,
  clock = () => new Date(),
}) {
  assertSubjectScopeRepository(subjectScopeRepository);
  assertDelegationContextRepository(delegationContextRepository);
  assertAuthorizedScopeRepository(authorizedScopeRepository);
  requireApplicationFunction(clock, "clock");

  async function resolve(input = {}) {
    const principal = requireApplicationObject(input.principal, "principal");
    const principalType = requireApplicationString(principal.principalType, "principal.principalType");
    const principalRef = requireApplicationString(principal.principalRef, "principal.principalRef");
    const operationIntent = requireApplicationString(input.operationIntent, "operationIntent");
    const requested = normalizeRequestedSubject(input);
    const delegationRef = optionalString(input.delegationRef, "delegationRef");
    const now = input.now instanceof Date ? input.now : clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new TypeError("clock must return a valid Date.");
    }

    if (!tenantIsAuthorized(principal, requested.tenantRef)) {
      fail(
        "subject_tenant_not_authorized",
        "Requested tenant scope exceeds the acting principal authority.",
        403,
        { tenant_ref: requested.tenantRef },
      );
    }

    const requestIndicatesDelegation =
      principalType === "delegated_agent" || requested.subjectRef !== principalRef;
    if (requestIndicatesDelegation && !delegationRef) {
      fail(
        "subject_delegation_context_required",
        "Delegated subject resolution requires delegation context.",
      );
    }

    const subjectScope = await subjectScopeRepository.findSubjectScope({
      subjectType: requested.subjectType,
      subjectRef: requested.subjectRef,
      tenantRef: requested.tenantRef,
      workspaceRef: requested.workspaceRef,
    });
    if (!subjectScope) {
      fail("subject_scope_not_found", "No authoritative subject scope was found.", 404);
    }
    assertActiveWindow({
      status: subjectScope.status,
      revokedAt: subjectScope.revokedAt,
      validFrom: subjectScope.validFrom,
      expiresAt: subjectScope.expiresAt,
      stale: subjectScope.stale,
      conflicting: subjectScope.conflicting,
      prefix: "subject_scope",
      now,
    });
    const authoritativeSubject = assertSubjectScopeMatchesRequest({
      requested,
      record: subjectScope,
    });

    const requiresDelegation = Boolean(delegationRef) || requestIndicatesDelegation;

    let delegationContext = null;
    let delegationDecision = null;
    let effectiveSubject = null;

    if (!requiresDelegation) {
      assertDirectSubject(principal, authoritativeSubject);
      if (subjectScope.delegationRequired === true) {
        fail(
          "subject_delegation_context_required",
          "The authoritative subject scope requires delegation context.",
        );
      }
      effectiveSubject = createEffectiveSubject(authoritativeSubject);
    } else {
      if (subjectScope.delegationAllowed === false) {
        fail(
          "subject_delegation_not_allowed",
          "The authoritative subject scope does not permit delegation.",
        );
      }
      delegationContext = await delegationContextRepository.findDelegationContext({
        delegationRef,
      });
      if (!delegationContext) {
        fail("subject_delegation_context_not_found", "No delegation context was found.", 404);
      }
      const authoritativeDelegationRef = requireApplicationString(
        delegationContext.delegationRef,
        "delegationContext.delegationRef",
      );
      if (authoritativeDelegationRef !== delegationRef) {
        fail(
          "subject_delegation_reference_mismatch",
          "Requested and authoritative delegation references differ.",
        );
      }
      if (delegationContext.stale === true) {
        fail("subject_delegation_context_stale", "Delegation context evidence is stale.", 409);
      }
      if (delegationContext.conflicting === true) {
        fail(
          "subject_delegation_context_conflicting",
          "Delegation context evidence is conflicting.",
          409,
        );
      }

      const delegatedByPrincipalRef =
        delegationContext.mode === "support_impersonation"
          ? principalRef
          : optionalString(
              delegationContext.delegatedByPrincipalRef,
              "delegationContext.delegatedByPrincipalRef",
            );
      effectiveSubject = createEffectiveSubject({
        ...authoritativeSubject,
        delegatedByPrincipalRef,
      });
      delegationDecision = evaluateDelegation({
        principal,
        effectiveSubject,
        evidence: delegationContext,
        operationIntent,
        now,
      });
      if (!delegationDecision.allowed) {
        fail(
          "subject_delegation_blocked",
          "Delegation policy blocked the requested effective subject.",
          403,
          {
            delegation_ref: delegationRef,
            reason_codes: delegationDecision.reasonCodes,
          },
        );
      }
    }

    const membershipEvidence = await revalidateSubjectScope({
      effectiveSubject,
      authorizedScopeRepository,
    });

    return freezeApplicationValue({
      status: "resolved",
      resolutionMode: requiresDelegation ? "delegated" : "direct",
      actor: {
        principalType,
        principalRef,
      },
      effectiveSubject,
      operationIntent,
      delegationDecision,
      sourceEvidence: {
        subjectScopeSourceRef: optionalString(subjectScope.sourceRef, "subjectScope.sourceRef"),
        subjectScopeVersionRef: optionalString(subjectScope.versionRef, "subjectScope.versionRef"),
        membershipEvidence,
        delegationSourceRef: optionalString(
          delegationContext?.sourceRef,
          "delegationContext.sourceRef",
        ),
        delegationVersionRef: optionalString(
          delegationContext?.versionRef,
          "delegationContext.versionRef",
        ),
        delegationAuditRef: optionalString(
          delegationContext?.auditRef,
          "delegationContext.auditRef",
        ),
        delegationContext: delegationContext
          ? sanitizeApplicationValue(delegationContext)
          : null,
      },
      evaluatedAt: now.toISOString(),
      automaticWritePerformed: false,
      providerCallMade: false,
      credentialPayloadRead: false,
      secretsIncluded: false,
    });
  }

  return Object.freeze({ resolve });
}

export const _testingSubjectScopeDelegationResolverService = Object.freeze({
  assertActiveWindow,
  assertDirectSubject,
  assertSubjectScopeMatchesRequest,
  tenantIsAuthorized,
});
