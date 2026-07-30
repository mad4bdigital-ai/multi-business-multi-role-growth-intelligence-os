export {
  ContextApplicationError,
  ensureUniqueCandidateReferences,
  freezeApplicationValue,
  sanitizeApplicationValue,
} from "./applicationSupport.js";

export { createContextPinService } from "./contextPinService.js";
export { createContextResolutionService } from "./contextResolutionService.js";
export { createContextSwitchService } from "./contextSwitchService.js";
export {
  ExecutionCapsuleValidationStatus,
  createExecutionCapsuleService,
} from "./executionCapsuleService.js";
export { createExecutionPlanService } from "./executionPlanService.js";
export { createPrincipalResolverService } from "./principalResolverService.js";
export { createResourceGraphResolverService } from "./resourceGraphResolverService.js";
export { createSubjectScopeDelegationResolverService } from "./subjectScopeDelegationResolverService.js";
export { createUnknownOutcomeReconciliationService } from "./unknownOutcomeReconciliationService.js";

export {
  assertPrincipalRepository,
  assertSubjectScopeRepository,
  assertDelegationContextRepository,
  assertAuthorizedScopeRepository,
  assertBoundedResourceGraphRepository,
  assertCapabilityReadinessRepository,
  assertContextPinRepository,
  assertExactConnectionRepository,
  assertExecutionLedgerRepository,
  assertResourceGraphRepository,
  ContextKernelRepositoryPorts,
} from "./repositoryPorts.js";
