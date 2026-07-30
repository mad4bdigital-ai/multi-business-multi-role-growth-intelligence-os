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
export { createUnknownOutcomeReconciliationService } from "./unknownOutcomeReconciliationService.js";

export {
  assertAuthorizedScopeRepository,
  assertCapabilityReadinessRepository,
  assertContextPinRepository,
  assertExactConnectionRepository,
  assertExecutionLedgerRepository,
  assertResourceGraphRepository,
  ContextKernelRepositoryPorts,
} from "./repositoryPorts.js";
