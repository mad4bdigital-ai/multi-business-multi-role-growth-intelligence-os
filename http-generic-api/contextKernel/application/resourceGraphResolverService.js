import { evaluateBoundedResourceGraph, RESOURCE_GRAPH_LIMITS } from "../domain/resourceGraphPolicy.js";
import { assertBoundedResourceGraphRepository } from "./repositoryPorts.js";
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

function normalizeStringList(values, fieldName) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${fieldName} must contain at least one value.`);
  }
  return [...new Set(values.map((value) => requireApplicationString(value, fieldName)))].sort();
}

function tenantIsAuthorized(principal, tenantRef) {
  const tenantRefs = Array.isArray(principal?.authorizedTenantRefs)
    ? principal.authorizedTenantRefs
    : [];
  return tenantRefs.includes("*") || tenantRefs.includes(tenantRef);
}

export function createResourceGraphResolverService({ boundedResourceGraphRepository }) {
  assertBoundedResourceGraphRepository(boundedResourceGraphRepository);

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
    const subjectRef = requireApplicationString(effectiveSubject.subjectRef, "effectiveSubject.subjectRef");
    const tenantRef = requireApplicationString(
      input.tenantRef || effectiveSubject.tenantRef,
      "tenantRef",
    );
    if (!tenantIsAuthorized(principal, tenantRef)) {
      fail(
        "resource_graph_tenant_not_authorized",
        "The principal is not authorized for the requested Tenant scope.",
        403,
        { tenant_ref: tenantRef },
      );
    }
    if (effectiveSubject.tenantRef !== tenantRef) {
      fail(
        "resource_graph_subject_tenant_mismatch",
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
        "resource_graph_subject_workspace_mismatch",
        "The effective subject does not match the requested Workspace scope.",
      );
    }
    const workspaceRef = requestedWorkspaceRef || subjectWorkspaceRef;

    const rootResource = requireApplicationObject(input.rootResource, "rootResource");
    const rootNodeRef = requireApplicationString(rootResource.nodeRef, "rootResource.nodeRef");
    const rootResourceType = requireApplicationString(
      rootResource.resourceType,
      "rootResource.resourceType",
    );
    const rootResourceRef = requireApplicationString(
      rootResource.resourceRef,
      "rootResource.resourceRef",
    );
    const operationIntent = requireApplicationString(input.operationIntent, "operationIntent");
    const relationTypes = normalizeStringList(input.relationTypes, "relationTypes");
    const inheritancePolicyKeys = normalizeStringList(
      input.inheritancePolicyKeys,
      "inheritancePolicyKeys",
    );
    const maxDepth = input.maxDepth ?? RESOURCE_GRAPH_LIMITS.defaultMaxDepth;
    const maxNodes = input.maxNodes ?? RESOURCE_GRAPH_LIMITS.defaultMaxNodes;
    const now = input.now instanceof Date ? input.now : new Date();
    if (Number.isNaN(now.getTime())) throw new TypeError("now must be a valid Date.");

    const snapshot = await boundedResourceGraphRepository.findBoundedResourceGraph({
      principalType,
      principalRef,
      subjectType,
      subjectRef,
      tenantRef,
      workspaceRef,
      rootNodeRef,
      rootResourceType,
      rootResourceRef,
      operationIntent,
      relationTypes,
      inheritancePolicyKeys,
      maxDepth,
      maxNodes,
    });
    if (!snapshot) {
      fail(
        "resource_graph_snapshot_not_found",
        "No authoritative bounded Resource Graph snapshot was found.",
        404,
      );
    }

    const sanitizedSnapshot = sanitizeApplicationValue(snapshot);
    const decision = evaluateBoundedResourceGraph({
      snapshot: sanitizedSnapshot,
      tenantRef,
      workspaceRef,
      rootNodeRef,
      rootResourceType,
      rootResourceRef,
      relationTypes,
      inheritancePolicyKeys,
      operationIntent,
      maxDepth,
      maxNodes,
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
      rootResource: {
        nodeRef: rootNodeRef,
        resourceType: rootResourceType,
        resourceRef: rootResourceRef,
      },
      operationIntent,
      authorityGranted: false,
      runtimeAuthorityChanged: false,
      automaticWritePerformed: false,
      providerCallMade: false,
      credentialPayloadRead: false,
      secretsIncluded: false,
    });
  }

  return Object.freeze({ resolve });
}

export const _testingResourceGraphResolverService = Object.freeze({
  normalizeStringList,
  tenantIsAuthorized,
});
