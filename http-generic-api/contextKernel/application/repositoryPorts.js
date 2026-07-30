const PORT_METHODS = Object.freeze({
  principal: Object.freeze(["findPrincipal"]),
  subjectScope: Object.freeze(["findSubjectScope"]),
  delegationContext: Object.freeze(["findDelegationContext"]),
  authorizedScope: Object.freeze(["findAuthorizedScope"]),
  resourceGraph: Object.freeze(["listAuthorizedResources"]),
  exactConnection: Object.freeze(["findExactConnection"]),
  capabilityReadiness: Object.freeze(["findCapabilityReadiness"]),
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

export function assertExactConnectionRepository(repository) {
  return assertRepositoryMethods(repository, "Exact connection", PORT_METHODS.exactConnection);
}

export function assertCapabilityReadinessRepository(repository) {
  return assertRepositoryMethods(repository, "Capability readiness", PORT_METHODS.capabilityReadiness);
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
