import { deepFreeze } from "../domain/index.js";

const REASON_CODE_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,190}$/u;

function cleanString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function nowMilliseconds(clock) {
  const value = clock();
  if (value instanceof Date) return value.getTime();
  if (Number.isFinite(Number(value))) return Number(value);
  throw new TypeError("clock must return a Date or finite timestamp.");
}

function candidateCountFrom(resolution) {
  return Array.isArray(resolution?.candidates) ? resolution.candidates.length : 0;
}

function selectedCandidateFrom(resolution) {
  return resolution?.selectedCandidate || resolution?.context?.selectedCandidate || null;
}

function safeReasonCode(error, fallback = "execution_capsule_shadow_failed") {
  const candidate = cleanString(error?.code);
  return candidate && REASON_CODE_PATTERN.test(candidate) ? candidate : fallback;
}

function targetMatches(resolution, capsule) {
  const selected = selectedCandidateFrom(resolution);
  const context = resolution?.context || {};
  if (!selected || !capsule) return false;
  const pairs = [
    [capsule.tenantRef, selected.tenantRef ?? context.tenantRef],
    [capsule.workspaceRef, selected.workspaceRef ?? context.workspaceRef],
    [capsule.brandRef ?? null, selected.brandRef ?? context.brandRef ?? null],
    [capsule.resourceType, selected.resourceType ?? context.resourceType],
    [capsule.resourceRef, selected.resourceRef ?? context.resourceRef],
    [capsule.connectionRef, selected.connectionRef ?? context.connectionRef],
  ];
  return pairs.every(([actual, expected]) => actual === expected);
}

function assertShadowSecurityInvariants(result) {
  const capsule = result?.capsule;
  if (
    result?.status !== "resolved" ||
    !capsule ||
    result.executionAllowed !== false ||
    result.automaticWritePerformed !== false ||
    result.secretsIncluded !== false ||
    capsule.executionAllowed !== false ||
    capsule.secretsIncluded !== false
  ) {
    const error = new Error("Execution capsule shadow result violated security invariants.");
    error.code = "execution_capsule_shadow_security_invariant_failed";
    throw error;
  }
}

function baseEvent(resolution, durationMs) {
  return {
    eventType: "execution_capsule_shadow",
    shadowMode: true,
    durationMs: Math.max(0, Math.round(durationMs)),
    resolutionStatus: cleanString(resolution?.status),
    candidateCount: candidateCountFrom(resolution),
    selectedCandidatePresent: Boolean(selectedCandidateFrom(resolution)),
    providerDispatchPerformed: false,
    legacyResolutionModified: false,
    executionAllowed: false,
    automaticWritePerformed: false,
    secretsIncluded: false,
  };
}

async function emitSafely(emitTelemetry, event) {
  try {
    await emitTelemetry(deepFreeze(event));
  } catch {
    // Shadow telemetry must never alter the legacy resolution result.
  }
}

export function createExecutionCapsuleShadowResolutionService({
  resolutionService,
  capsuleService,
  capsuleEvidenceProvider,
  emitTelemetry,
  clock = () => Date.now(),
} = {}) {
  if (!resolutionService || typeof resolutionService.resolve !== "function") {
    throw new TypeError("resolutionService.resolve must be a function.");
  }
  if (!capsuleService || typeof capsuleService.resolve !== "function") {
    throw new TypeError("capsuleService.resolve must be a function.");
  }
  if (typeof capsuleEvidenceProvider !== "function") {
    throw new TypeError("capsuleEvidenceProvider must be a function.");
  }
  if (typeof emitTelemetry !== "function") {
    throw new TypeError("emitTelemetry must be a function.");
  }
  if (typeof clock !== "function") throw new TypeError("clock must be a function.");

  return Object.freeze({
    async resolve(input) {
      const startedAt = nowMilliseconds(clock);
      const resolution = await resolutionService.resolve(input);
      const common = baseEvent(resolution, nowMilliseconds(clock) - startedAt);

      if (resolution?.status !== "resolved") {
        await emitSafely(emitTelemetry, {
          ...common,
          capsuleAttempted: false,
          capsuleCreated: false,
          capsuleOutcome: "not_attempted",
          capsuleStatus: null,
          capsuleTargetMatched: null,
          reasonCodes: ["context_not_resolved"],
        });
        return resolution;
      }

      try {
        const supplied = await capsuleEvidenceProvider({ resolution, resolutionInput: input });
        const evidence = supplied && typeof supplied === "object" ? supplied : {};
        const capsuleResult = capsuleService.resolve({
          resolution,
          authorityPathRef: evidence.authorityPathRef,
          authorityRevision: evidence.authorityRevision,
          capabilityRevision: evidence.capabilityRevision,
          registryRevision: evidence.registryRevision,
          credentialReadinessRevision: evidence.credentialReadinessRevision,
          invalidationDependencies: Array.isArray(evidence.invalidationDependencies)
            ? evidence.invalidationDependencies
            : [],
          expiresAt: evidence.expiresAt ?? null,
        });
        assertShadowSecurityInvariants(capsuleResult);
        const matched = targetMatches(resolution, capsuleResult.capsule);
        await emitSafely(emitTelemetry, {
          ...common,
          capsuleAttempted: true,
          capsuleCreated: true,
          capsuleOutcome: matched ? "matched" : "mismatched",
          capsuleStatus: capsuleResult.status,
          capsuleTargetMatched: matched,
          reasonCodes: [],
        });
      } catch (error) {
        await emitSafely(emitTelemetry, {
          ...common,
          capsuleAttempted: true,
          capsuleCreated: false,
          capsuleOutcome: "build_failed",
          capsuleStatus: null,
          capsuleTargetMatched: null,
          reasonCodes: [safeReasonCode(error)],
        });
      }

      return resolution;
    },
  });
}

export const _testingExecutionCapsuleShadow = Object.freeze({
  safeReasonCode,
  targetMatches,
});
