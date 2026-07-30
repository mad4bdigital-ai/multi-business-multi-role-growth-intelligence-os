export {
  DomainEnums,
  createAuthenticatedPrincipal,
  createContextCandidate,
  createContextPin,
  createEffectiveSubject,
  deepFreeze,
  normalizeDecisionInput,
} from "./model.js";

export {
  DecisionReason,
  DecisionStatus,
  compareContextCandidates,
  enumerateAuthorizedCandidates,
  resolveContextDecision,
  sortContextCandidates,
} from "./decisionPolicy.js";

export {
  ContextDimensions,
  computeInvalidatedDimensions,
  createContextHash,
  createContextRevision,
  validateContextRevision,
} from "./contextIntegrity.js";

export {
  EXECUTION_CAPSULE_SCHEMA_VERSION,
  ExecutionCapsuleDependencyDomains,
  ExecutionCapsuleProjectionModes,
  assertExecutionCapsuleIntegrity,
  compareExecutionCapsuleDependencies,
  createExecutionCapsule,
  createExecutionCapsuleDependencyVector,
  projectExecutionCapsule,
} from "./executionCapsule.js";

export {
  POLICY_GRANT_LIMITS,
  evaluatePolicyGrantDecision,
} from "./policyGrantDecision.js";

export {
  RESOURCE_GRAPH_LIMITS,
  evaluateBoundedResourceGraph,
} from "./resourceGraphPolicy.js";

export {
  SUPPORT_DELEGATION_MODES,
  createSupportDelegationEvidence,
  evaluateSupportDelegation,
} from "./supportDelegationPolicy.js";
