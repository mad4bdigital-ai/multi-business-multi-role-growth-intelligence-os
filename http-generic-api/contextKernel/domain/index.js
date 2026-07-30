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
  compareExecutionCapsuleDependencies,
  createExecutionCapsule,
  createExecutionCapsuleDependencyVector,
  createExecutionCapsuleHash,
  projectExecutionCapsule,
} from "./executionCapsule.js";
