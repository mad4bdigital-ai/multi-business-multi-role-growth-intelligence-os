import { evaluateEndpointCertification } from "../domain/endpointCertificationPolicy.js";
import { assertEndpointCertificationEvidenceRepository } from "./repositoryPorts.js";
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

export function createEndpointCertificationResolverService({
  endpointCertificationEvidenceRepository,
}) {
  assertEndpointCertificationEvidenceRepository(endpointCertificationEvidenceRepository);

  async function resolve(input = {}) {
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
        "endpoint_certification_tenant_not_authorized",
        "The principal is not authorized for the requested Tenant scope.",
        403,
        { tenant_ref: tenantRef },
      );
    }
    if (effectiveSubject.tenantRef !== tenantRef) {
      fail(
        "endpoint_certification_subject_tenant_mismatch",
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
        "endpoint_certification_subject_workspace_mismatch",
        "The effective subject does not match the requested Workspace scope.",
      );
    }
    const workspaceRef = requestedWorkspaceRef || subjectWorkspaceRef;

    const capabilityKey = requireApplicationString(input.capabilityKey, "capabilityKey");
    const providerBindingRef = requireApplicationString(
      input.providerBindingRef,
      "providerBindingRef",
    );
    const providerFamily = requireApplicationString(input.providerFamily, "providerFamily");
    const connectionRef = optionalString(input.connectionRef, "connectionRef");
    const parentActionKey = requireApplicationString(input.parentActionKey, "parentActionKey");
    const configuredEndpointKey = requireApplicationString(
      input.configuredEndpointKey,
      "configuredEndpointKey",
    );
    const environmentKey = requireApplicationString(input.environmentKey, "environmentKey");
    const riskClass = requireApplicationString(input.riskClass, "riskClass");
    const now = input.now instanceof Date ? input.now : new Date();
    if (Number.isNaN(now.getTime())) throw new TypeError("now must be a valid Date.");

    const query = {
      principalType,
      principalRef,
      subjectType,
      subjectRef,
      tenantRef,
      workspaceRef,
      capabilityKey,
      providerBindingRef,
      providerFamily,
      connectionRef,
      parentActionKey,
      configuredEndpointKey,
      environmentKey,
      riskClass,
    };
    const snapshot = await endpointCertificationEvidenceRepository.findEndpointCertificationEvidence(
      query,
    );
    if (!snapshot) {
      fail(
        "endpoint_certification_snapshot_not_found",
        "No authoritative endpoint/certification evidence snapshot was found.",
        404,
      );
    }

    const sanitizedSnapshot = sanitizeApplicationValue(snapshot);
    const decision = evaluateEndpointCertification({
      snapshot: sanitizedSnapshot,
      ...query,
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
      providerBindingRef,
      providerFamily,
      connectionRef,
      parentActionKey,
      configuredEndpointKey,
      environmentKey,
      riskClass,
      authorityGranted: false,
      executionAuthorized: false,
      runtimeAuthorityChanged: false,
      automaticWritePerformed: false,
      providerCallMade: false,
      credentialPayloadRead: false,
      secretsIncluded: false,
    });
  }

  return Object.freeze({ resolve });
}

export const _testingEndpointCertificationResolverService = Object.freeze({
  optionalString,
  tenantIsAuthorized,
});
