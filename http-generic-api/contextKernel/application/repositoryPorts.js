const PORT_METHODS = Object.freeze({
  principal: Object.freeze(["findPrincipal"]),
  subjectScope: Object.freeze(["findSubjectScope"]),
  delegationContext: Object.freeze(["findDelegationContext"]),
  authorizedScope: Object.freeze(["findAuthorizedScope"]),
  resourceGraph: Object.freeze(["listAuthorizedResources"]),
  boundedResourceGraph: Object.freeze(["findBoundedResourceGraph"]),
  exactConnection: Object.freeze(["findExactConnection"]),
  workspaceOwnership: Object.freeze(["findWorkspaceOwnership"]),
  connectionOwnership: Object.freeze(["findConnectionOwnership"]),
  providerAuthorizationState: Object.freeze([
    "findAuthorizationState",
    "claimAuthorizationState",
    "completeClaimedAuthorization",
  ]),
  capabilityReadiness: Object.freeze(["findCapabilityReadiness"]),
  policyGrantEvidence: Object.freeze(["findPolicyGrantEvidence"]),
  endpointCertificationEvidence: Object.freeze(["findEndpointCertificationEvidence"]),
  contextPin: Object.freeze(["findContextPin", "createPin", "invalidatePin"]),
  executionLedger: Object.freeze(["findExecutionPlan", "listExecutionEvents", "appendExecutionEvent"]),
});

function assertRepositoryMethods(repository, portName, requiredMethods) {
  if (!repository || typeof repository !== "object") {
    throw new TypeError(`${portName} repository is required.`);
  }
  const missing = requiredMethods.filter((methodName) => typeof repository[methodName] !== "function");
  if (missing.length > 0) {
    throw new TypeError(`${portName} repository is missing methods: ${missing.join(", ")}.`);
  }
  return repository;
}

export function assertPrincipalRepository(repository) {
  return assertRepositoryMethods(repository, "Principal", PORT_METHODS.principal);
}

export function assertSubjectScopeRepository(repository) {
  return assertRepositoryMethods(repository, "Subject scope", PORT_METHODS.subjectScope);
}

export function assertDelegationContextRepository(repository) {
  return assertRepositoryMethods(repository, "Delegation context", PORT_METHODS.delegationContext);
}

export function assertAuthorizedScopeRepository(repository) {
  return assertRepositoryMethods(repository, "Authorized scope", PORT_METHODS.authorizedScope);
}

export function assertResourceGraphRepository(repository) {
  return assertRepositoryMethods(repository, "Resource graph", PORT_METHODS.resourceGraph);
}

export function assertBoundedResourceGraphRepository(repository) {
  return assertRepositoryMethods(
    repository,
    "Bounded resource graph",
    PORT_METHODS.boundedResourceGraph,
  );
}

export function assertExactConnectionRepository(repository) {
  return assertRepositoryMethods(repository, "Exact connection", PORT_METHODS.exactConnection);
}

export function assertWorkspaceOwnershipRepository(repository) {
  return assertRepositoryMethods(repository, "Workspace ownership", PORT_METHODS.workspaceOwnership);
}

export function assertConnectionOwnershipRepository(repository) {
  return assertRepositoryMethods(repository, "Connection ownership", PORT_METHODS.connectionOwnership);
}

export function assertProviderAuthorizationStateRepository(repository) {
  return assertRepositoryMethods(
    repository,
    "Provider authorization state",
    PORT_METHODS.providerAuthorizationState,
  );
}

export function assertCapabilityReadinessRepository(repository) {
  return assertRepositoryMethods(repository, "Capability readiness", PORT_METHODS.capabilityReadiness);
}

export function assertPolicyGrantEvidenceRepository(repository) {
  return assertRepositoryMethods(
    repository,
    "Policy grant evidence",
    PORT_METHODS.policyGrantEvidence,
  );
}

export function assertEndpointCertificationEvidenceRepository(repository) {
  return assertRepositoryMethods(
    repository,
    "Endpoint certification evidence",
    PORT_METHODS.endpointCertificationEvidence,
  );
}

export function assertContextPinRepository(repository) {
  return assertRepositoryMethods(repository, "Context pin", PORT_METHODS.contextPin);
}

export function assertExecutionLedgerRepository(repository) {
  return assertRepositoryMethods(repository, "Execution ledger", PORT_METHODS.executionLedger);
}

export const ContextKernelRepositoryPorts = PORT_METHODS;

export const _testingRepositoryPorts = Object.freeze({
  assertRepositoryMethods,
});
