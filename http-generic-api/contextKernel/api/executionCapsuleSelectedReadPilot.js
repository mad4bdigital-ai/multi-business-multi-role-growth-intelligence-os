import { createExecutionCapsuleShadowResolutionService } from "../integration/executionCapsuleShadow.js";
import { createContextKernelController } from "./controller.js";

const VIEW_MODES = Object.freeze(["tenant", "admin"]);

function requireOperations(operations) {
  if (!operations || typeof operations !== "object") {
    throw new TypeError("operations must be an object.");
  }
  if (typeof operations.getContextResolution !== "function") {
    throw new TypeError("operations.getContextResolution must be a function.");
  }
  return operations;
}

function controllerOptions({ operations, viewMode, resolvePrincipalContext }) {
  const options = {
    operations,
    resolveViewMode: () => viewMode,
  };
  if (resolvePrincipalContext !== undefined) {
    if (typeof resolvePrincipalContext !== "function") {
      throw new TypeError("resolvePrincipalContext must be a function when provided.");
    }
    options.resolvePrincipalContext = resolvePrincipalContext;
  }
  return options;
}

function createDisabledView({ operations, viewMode, resolvePrincipalContext }) {
  return Object.freeze({
    viewMode,
    operations,
    controller: createContextKernelController(controllerOptions({
      operations,
      viewMode,
      resolvePrincipalContext,
    })),
  });
}

function createDisabledPilot({ operations, resolvePrincipalContext }) {
  const tenant = createDisabledView({ operations, viewMode: "tenant", resolvePrincipalContext });
  const admin = createDisabledView({ operations, viewMode: "admin", resolvePrincipalContext });
  return Object.freeze({
    enabled: false,
    mode: "disabled",
    tenant,
    admin,
    rollback() {
      return createDisabledPilot({ operations, resolvePrincipalContext });
    },
  });
}

function createViewPilot({
  operations,
  viewMode,
  capsuleService,
  capsuleEvidenceProvider,
  emitTelemetry,
  clock,
  resolvePrincipalContext,
}) {
  const legacyReadService = Object.freeze({
    resolve(input) {
      return operations.getContextResolution(input);
    },
  });
  const decoratedReadService = createExecutionCapsuleShadowResolutionService({
    resolutionService: legacyReadService,
    capsuleService,
    capsuleEvidenceProvider: ({ resolution, resolutionInput }) => capsuleEvidenceProvider({
      resolution,
      resolutionInput,
      viewMode,
    }),
    emitTelemetry: (event) => emitTelemetry(Object.freeze({
      ...event,
      pilotType: "execution_capsule_selected_read",
      viewMode,
    })),
    clock,
  });
  const pilotOperations = Object.freeze({
    ...operations,
    getContextResolution(input) {
      return decoratedReadService.resolve(input);
    },
  });
  return Object.freeze({
    viewMode,
    operations: pilotOperations,
    controller: createContextKernelController(controllerOptions({
      operations: pilotOperations,
      viewMode,
      resolvePrincipalContext,
    })),
  });
}

export function createExecutionCapsuleSelectedReadPilot({
  enabled = false,
  operations = null,
  capsuleService = null,
  capsuleEvidenceProvider = null,
  emitTelemetry = null,
  clock = () => Date.now(),
  resolvePrincipalContext,
} = {}) {
  const legacyOperations = requireOperations(operations);
  if (enabled !== true) {
    return createDisabledPilot({ operations: legacyOperations, resolvePrincipalContext });
  }
  if (typeof capsuleEvidenceProvider !== "function") {
    throw new TypeError("capsuleEvidenceProvider must be a function when the pilot is enabled.");
  }
  if (typeof emitTelemetry !== "function") {
    throw new TypeError("emitTelemetry must be a function when the pilot is enabled.");
  }
  if (typeof clock !== "function") throw new TypeError("clock must be a function.");

  const views = Object.fromEntries(VIEW_MODES.map((viewMode) => [
    viewMode,
    createViewPilot({
      operations: legacyOperations,
      viewMode,
      capsuleService,
      capsuleEvidenceProvider,
      emitTelemetry,
      clock,
      resolvePrincipalContext,
    }),
  ]));

  return Object.freeze({
    enabled: true,
    mode: "execution_capsule_selected_read_pilot",
    tenant: views.tenant,
    admin: views.admin,
    rollback() {
      return createDisabledPilot({
        operations: legacyOperations,
        resolvePrincipalContext,
      });
    },
  });
}

export const _testingExecutionCapsuleSelectedReadPilot = Object.freeze({
  VIEW_MODES,
  createDisabledPilot,
});
