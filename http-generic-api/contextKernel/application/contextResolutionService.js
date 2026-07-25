import {
  createContextCandidate,
  createContextHash,
  createContextRevision,
  DecisionStatus,
  resolveContextDecision,
} from "../domain/index.js";
import {
  assertAuthorizedScopeRepository,
  assertCapabilityReadinessRepository,
  assertContextPinRepository,
  assertExactConnectionRepository,
  assertResourceGraphRepository,
} from "./repositoryPorts.js";
import {
  ensureUniqueCandidateReferences,
  freezeApplicationValue,
  requireApplicationObject,
  requireApplicationString,
} from "./applicationSupport.js";

function mapResourceCandidate(resource) {
  const resourceType = resource.resourceType || "resource";
  const resourceRef = resource.resourceRef || resource.stableRef;
  return createContextCandidate({
    candidateType: resource.sourceType || "resource_authority",
    stableRef: resource.stableRef,
    tenantRef: resource.tenantRef,
    workspaceRef: resource.workspaceRef || (resourceType === "workspace" ? resourceRef : null),
    brandRef: resourceType === "brand" ? resourceRef : null,
    resourceType,
    resourceRef,
    displayLabel: `${resourceType}:${resourceRef}`,
    authoritySummary: [resource.permission, resource.authoritySource].filter(Boolean).join(":"),
    metadata: {
      permission: resource.permission || null,
      authoritySource: resource.authoritySource || null,
      recipeKey: resource.recipeKey || null,
      allowedModes: Array.isArray(resource.allowedModes) ? resource.allowedModes : [],
    },
  });
}

function mapConnectionCandidate(connection) {
  return createContextCandidate({
    candidateType: "connection",
    stableRef: connection.connectionRef,
    tenantRef: connection.tenantRef,
    workspaceRef: connection.workspaceRef,
    resourceType: "app_connection",
    resourceRef: `${connection.appKey}:${connection.connectionRef}`,
    connectionRef: connection.connectionRef,
    displayLabel: connection.displayLabel || connection.accountLabel || connection.connectionRef,
    authoritySummary: connection.permissionMode || "",
    readinessSummary: connection.validationStatus || "",
    metadata: {
      appKey: connection.appKey,
      authType: connection.authType,
      primary: connection.primary === true,
      status: connection.status,
      validationStatus: connection.validationStatus || null,
      actionGrantRef: connection.actionGrant?.grantRef || null,
      actionGrantMode: connection.actionGrant?.grantMode || null,
    },
  });
}

function authoritySummary(scope) {
  if (!scope) return null;
  return freezeApplicationValue({
    tenantRef: scope.tenantRef,
    userRef: scope.userRef,
    role: scope.membership?.role || null,
    membershipStatus: scope.membership?.status || null,
    workspaceRefs: (scope.workspaces || []).map((workspace) => workspace.workspaceRef).sort(),
  });
}

function capabilitySummary(readiness) {
  if (!readiness) return null;
  return freezeApplicationValue({
    capabilityKey: readiness.capabilityKey,
    runtimeStatus: readiness.runtimeStatus,
    operationClass: readiness.operationClass,
    riskClass: readiness.riskClass,
    dispatchAllowed: readiness.dispatchAllowed === true,
    applyAllowed: readiness.applyAllowed === true,
    hardBlockCount: Number(readiness.hardBlockCount || 0),
    manifestHash: readiness.currentManifest?.manifestHash || null,
    manifestVersion: readiness.currentManifest?.manifestVersion || null,
  });
}

function contextSnapshot({ principal, effectiveSubject, candidate, authority, capability }) {
  return freezeApplicationValue({
    principal: {
      principalType: principal.principalType,
      principalRef: principal.principalRef,
      authorizedTenantRefs: [...(principal.authorizedTenantRefs || [])].sort(),
    },
    effectiveSubject: effectiveSubject || null,
    selectedCandidate: {
      candidateType: candidate.candidateType,
      stableRef: candidate.stableRef,
      tenantRef: candidate.tenantRef,
      workspaceRef: candidate.workspaceRef,
      brandRef: candidate.brandRef,
      resourceType: candidate.resourceType,
      resourceRef: candidate.resourceRef,
      connectionRef: candidate.connectionRef,
    },
    authority,
    capability,
  });
}

function blockedResolution(reasonCode, {
  candidates = [],
  authority = null,
  capability = null,
} = {}) {
  return freezeApplicationValue({
    status: DecisionStatus.BLOCKED,
    reasonCodes: [reasonCode],
    selectedCandidate: null,
    candidates,
    authorityScope: authority,
    capabilityReadiness: capability,
    context: null,
    automaticWritePerformed: false,
    secretsIncluded: false,
  });
}

export function createContextResolutionService({
  authorizedScopeRepository,
  resourceGraphRepository,
  exactConnectionRepository,
  capabilityReadinessRepository,
  contextPinRepository,
}) {
  assertAuthorizedScopeRepository(authorizedScopeRepository);
  assertResourceGraphRepository(resourceGraphRepository);
  assertExactConnectionRepository(exactConnectionRepository);
  assertCapabilityReadinessRepository(capabilityReadinessRepository);
  assertContextPinRepository(contextPinRepository);

  async function resolve(input = {}) {
    const principal = requireApplicationObject(input.principal, "principal");
    const principalRef = requireApplicationString(principal.principalRef, "principal.principalRef");
    const principalType = requireApplicationString(principal.principalType, "principal.principalType");
    const effectiveSubject = input.effectiveSubject || null;
    const tenantRef = requireApplicationString(
      input.tenantRef || effectiveSubject?.tenantRef,
      "tenantRef",
    );
    const userRef = requireApplicationString(
      input.userRef || effectiveSubject?.subjectRef || principalRef,
      "userRef",
    );

    const scope = await authorizedScopeRepository.findAuthorizedScope({ tenantRef, userRef });
    const authority = authoritySummary(scope);
    if (!scope) return blockedResolution("authorized_scope_not_found");

    const resources = await resourceGraphRepository.listAuthorizedResources({
      tenantRef,
      userRef,
      resourceType: input.resourceType || null,
      limit: input.candidateLimit || 100,
    });
    const candidates = resources.map(mapResourceCandidate);

    const pin = input.pinRef
      ? await contextPinRepository.findContextPin({
          tenantRef,
          pinRef: input.pinRef,
          principalType,
          principalRef,
        })
      : null;
    if (input.pinRef && !pin) {
      return blockedResolution("context_pin_not_found", {
        candidates,
        authority,
      });
    }

    const explicitConnectionRef = input.connectionRef || null;
    const requestedWorkspaceRef = input.workspaceRef || effectiveSubject?.workspaceRef || null;
    const connectionRef = explicitConnectionRef || (pin && requestedWorkspaceRef ? pin.stableRef : null);
    if (connectionRef) {
      const connection = await exactConnectionRepository.findExactConnection({
        tenantRef,
        workspaceRef: requireApplicationString(requestedWorkspaceRef, "workspaceRef"),
        connectionRef,
        appKey: input.appKey || null,
        actionKey: input.actionKey || null,
        userRef,
      });
      if (connection) candidates.push(mapConnectionCandidate(connection));
    }

    const authorizedCandidates = ensureUniqueCandidateReferences(candidates);
    const capability = input.capabilityKey
      ? await capabilityReadinessRepository.findCapabilityReadiness({ capabilityKey: input.capabilityKey })
      : null;
    const safeCapability = capabilitySummary(capability);
    if (input.capabilityKey && !capability) {
      return blockedResolution("capability_readiness_not_found", {
        candidates: authorizedCandidates,
        authority,
      });
    }
    if (safeCapability?.hardBlockCount > 0) {
      return blockedResolution("capability_hard_blocked", {
        candidates: authorizedCandidates,
        authority,
        capability: safeCapability,
      });
    }
    if (safeCapability && !safeCapability.dispatchAllowed) {
      return blockedResolution("capability_dispatch_not_allowed", {
        candidates: authorizedCandidates,
        authority,
        capability: safeCapability,
      });
    }

    let currentContextRevision = input.currentContextRevision || null;
    if (pin && !currentContextRevision) {
      const pinnedCandidates = authorizedCandidates.filter((candidate) => candidate.stableRef === pin.stableRef);
      if (pinnedCandidates.length === 1) {
        currentContextRevision = createContextRevision(contextSnapshot({
          principal,
          effectiveSubject,
          candidate: pinnedCandidates[0],
          authority,
          capability: safeCapability,
        }));
      }
    }

    const decision = resolveContextDecision({
      principal,
      effectiveSubject,
      candidates: authorizedCandidates,
      operationIntent: input.operationIntent,
      operationKind: input.operationKind || "read",
      riskClass: input.riskClass || "read",
      explicitRef: input.explicitRef || null,
      verifiedPin: pin,
      currentContextRevision,
      exactBindingRef: input.exactBindingRef || explicitConnectionRef,
      fallbackRef: input.fallbackRef || null,
      allowLowRiskFallback: input.allowLowRiskFallback === true,
      now: input.now instanceof Date ? input.now : new Date(),
    });

    if (decision.status !== DecisionStatus.RESOLVED) {
      return freezeApplicationValue({
        ...decision,
        authorityScope: authority,
        capabilityReadiness: safeCapability,
        context: null,
        automaticWritePerformed: false,
        secretsIncluded: false,
      });
    }

    const snapshot = contextSnapshot({
      principal,
      effectiveSubject,
      candidate: decision.selectedCandidate,
      authority,
      capability: safeCapability,
    });
    const contextHash = createContextHash(snapshot);
    const contextRevision = createContextRevision(snapshot);
    const selected = decision.selectedCandidate;

    return freezeApplicationValue({
      ...decision,
      authorityScope: authority,
      capabilityReadiness: safeCapability,
      context: {
        contextHash,
        contextRevision,
        principal,
        effectiveSubject,
        tenantRef: selected.tenantRef,
        workspaceRef: selected.workspaceRef,
        brandRef: selected.brandRef,
        resourceType: selected.resourceType,
        resourceRef: selected.resourceRef,
        connectionRef: selected.connectionRef,
        selectedCandidate: selected,
        authority,
        capability: safeCapability,
        pinRef: pin?.pinRef || null,
      },
      automaticWritePerformed: false,
      secretsIncluded: false,
    });
  }

  return Object.freeze({ resolve });
}

export const _testingContextResolutionService = Object.freeze({
  authoritySummary,
  capabilitySummary,
  contextSnapshot,
  mapConnectionCandidate,
  mapResourceCandidate,
});
