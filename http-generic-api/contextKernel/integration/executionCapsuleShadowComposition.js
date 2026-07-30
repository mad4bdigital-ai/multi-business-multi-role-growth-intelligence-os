import { createExecutionCapsuleShadowResolutionService } from "./executionCapsuleShadow.js";
import { createResourceApiContextShadowMiddleware } from "./resourceApiShadow.js";

function assertResolutionService(resolutionService) {
  if (!resolutionService || typeof resolutionService.resolve !== "function") {
    throw new TypeError("resolutionService.resolve must be a function.");
  }
}

function createDisabledComposition(resolutionService) {
  return Object.freeze({
    enabled: false,
    mode: "disabled",
    resolutionService,
    resourceApiShadowMiddleware: createResourceApiContextShadowMiddleware({ enabled: false }),
  });
}

export function createExecutionCapsuleResourceApiShadowComposition({
  enabled = false,
  resolutionService = null,
  capsuleService = null,
  capsuleEvidenceProvider = null,
  emitCapsuleTelemetry = null,
  emitResourceTelemetry = null,
  clock = () => Date.now(),
  schedule,
} = {}) {
  assertResolutionService(resolutionService);

  if (enabled !== true) return createDisabledComposition(resolutionService);

  const decoratedResolutionService = createExecutionCapsuleShadowResolutionService({
    resolutionService,
    capsuleService,
    capsuleEvidenceProvider,
    emitTelemetry: emitCapsuleTelemetry,
    clock,
  });

  const middlewareOptions = {
    enabled: true,
    resolutionService: decoratedResolutionService,
    emitTelemetry: emitResourceTelemetry,
    clock,
  };
  if (schedule !== undefined) middlewareOptions.schedule = schedule;

  const resourceApiShadowMiddleware = createResourceApiContextShadowMiddleware(middlewareOptions);

  return Object.freeze({
    enabled: true,
    mode: "execution_capsule_shadow",
    resolutionService: decoratedResolutionService,
    resourceApiShadowMiddleware,
    rollback() {
      return createDisabledComposition(resolutionService);
    },
  });
}

export const _testingExecutionCapsuleShadowComposition = Object.freeze({
  createDisabledComposition,
});
