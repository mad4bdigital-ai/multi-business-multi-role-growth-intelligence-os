import { evaluatePolicyGrantDecision } from "../domain/policyGrantDecision.js";
import { assertPolicyGrantEvidenceRepository } from "./repositoryPorts.js";
import {
  ContextApplicationError,
  freezeApplicationValue,
  requireApplicationObject,
  requireApplicationString,
  sanitizeApplicationValue,
} from "./applicationSupport.js";

function fail(code, message, status = 403, details = {}) {
  throw new ContextApplicationError(code, message, status, details);
}

function optionalString(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  return requireApplicationString(value, fieldName);
}

function tenantIsAuthorized(principal, tenantRef) {
  const tenantRefs = Array.isArray(principal?.authorizedTenantRefs)
    ? principal.authorizedTenantRefs
    : [];
  return tenantRefs.includes("*") || tenantRefs.includes(tenantRef);
}

export function createPolicyGrantEvaluatorService({ policyGrantEvidenceRepository }) {
  assertPolicyGrantEvidenceRepository(policyGrantEvidenceRepository);

  async function evaluate(input = {}) {
    const principal = requireApplicationObject(input.principal, "principal");
    const effectiveSubject = requireApplicationObject(input.effectiveSubject, "effectiveSubject");
    const principalType = requireApplicationString(
      principal.principalType,
      "principal.principalType",
    );
    const principalRef = requireApplicationString(principal.principalRef, "principal.principalRef");
    const subjectType = requireApplicationString(
      effectiveSubject.subjectType,
      "effectiveSubject.subjectType",
    );
    const subjectRef = requireApplicationString(
      effectiveSubject.subjectRef,
      "effectiveSubject.subjectRef",
    );
    const tenantRef = requireApplicationString(
      input.tenantRef || effectiveSubject.tenantRef,
      "tenantRef",
    );
    if (!tenantIsAuthorized(principal, tenantRef)) {
      fail(
        "policy_grant_tenant_not_authorized",
        "The principal is not authorized for the requested Tenant scope.",
        403,
        { tenant_ref: tenantRef },
      );
    }
    if (effectiveSubject.tenantRef !== tenantRef) {
      fail(
        "policy_grant_subject_tenant_mismatch",
        "The effective subject does not match the requested Tenant scope.",
      );
    }

    const subjectWorkspaceRef = optionalString(
      effectiveSubject.workspaceRef,
      "effectiveSubject.workspaceRef",
    );
    const requestedWorkspaceRef = optionalString(input.workspaceRef, "workspaceRef");
    if (
      subjectWorkspaceRef &&
      requestedWorkspaceRef &&
      subjectWorkspaceRef !== requestedWorkspaceRef
    ) {
      fail(
        "policy_grant_subject_workspace_mismatch",
        "The effective subject does not match the requested Workspace scope.",
      );
    }
    const workspaceRef = requestedWorkspaceRef || subjectWorkspaceRef;

    const capabilityKey = requireApplicationString(input.capabilityKey, "capabilityKey");
    const operation = requireApplicationString(input.operation, "operation");
    const resource = requireApplicationObject(input.resource, "resource");
    const resourceType = requireApplicationString(resource.resourceType, "resource.resourceType");
    const resourceRef = requireApplicationString(resource.resourceRef, "resource.resourceRef");
    const now = input.now instanceof Date ? input.now : new Date();
    if (Number.isNaN(now.getTime())) throw new TypeError("now must be a valid Date.");

    const snapshot = await policyGrantEvidenceRepository.findPolicyGrantEvidence({
      principalType,
      principalRef,
      subjectType,
      subjectRef,
      tenantRef,
      workspaceRef,
      capabilityKey,
      operation,
      resourceType,
      resourceRef,
    });
    if (!snapshot) {
      fail(
        "policy_grant_snapshot_not_found",
        "No authoritative policy/grant evidence snapshot was found.",
        404,
      );
    }

    const sanitizedSnapshot = sanitizeApplicationValue(snapshot);
    const decision = evaluatePolicyGrantDecision({
      snapshot: sanitizedSnapshot,
      principalType,
      principalRef,
      subjectType,
      subjectRef,
      tenantRef,
      workspaceRef,
      capabilityKey,
      operation,
      resourceType,
      resourceRef,
      now,
    });

    return freezeApplicationValue({
      ...decision,
      actor: {
        principalType,
        principalRef,
      },
      effectiveSubject: {
        subjectType,
        subjectRef,
        tenantRef,
        workspaceRef,
        delegatedByPrincipalRef: effectiveSubject.delegatedByPrincipalRef || null,
      },
      capabilityKey,
      operation,
      resource: {
        resourceType,
        resourceRef,
      },
      authorityGranted: false,
      executionAuthorized: false,
      runtimeAuthorityChanged: false,
      automaticWritePerformed: false,
      providerCallMade: false,
      credentialPayloadRead: false,
      secretsIncluded: false,
    });
  }

  return Object.freeze({ evaluate });
}

export const _testingPolicyGrantEvaluatorService = Object.freeze({
  optionalString,
  tenantIsAuthorized,
});
