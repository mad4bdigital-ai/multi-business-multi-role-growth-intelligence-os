import {
  completeTarget,
  deepFreeze,
  defaultParityComparator,
  durationMilliseconds,
  emitSafely,
  requireFunction,
  requireObject,
  revisionBoundCacheKey,
  safeClockMilliseconds,
  targetMismatchFields,
} from "./executionCapsuleRolloutSupport.js";
import {
  isTrustedExecutionCapsuleRolloutCertificate,
} from "./executionCapsuleRolloutEvaluator.js";

const MODE_SET = new Set(["disabled", "shadow", "canary", "retired"]);

export class ExecutionCapsuleRolloutError extends Error {
  constructor(code, reasonCodes = [code]) {
    super(code);
    this.name = "ExecutionCapsuleRolloutError";
    this.code = code;
    this.status = 409;
    this.reasonCodes = Object.freeze([...new Set(reasonCodes)]);
  }
}

function requireCertificate(certificate, retirement = false) {
  if (!isTrustedExecutionCapsuleRolloutCertificate(certificate)) {
    throw new ExecutionCapsuleRolloutError("execution_capsule_rollout_certificate_untrusted");
  }
  const allowed = retirement
    ? certificate.legacyRetirementAllowed === true
    : certificate.rolloutAllowed === true;
  if (!allowed) {
    throw new ExecutionCapsuleRolloutError(
      retirement ? "execution_capsule_legacy_retirement_not_certified" : "execution_capsule_rollout_not_certified",
      certificate.reasonCodes,
    );
  }
}

function requireService(service, fieldName) {
  const value = requireObject(service, fieldName);
  requireFunction(value.resolve, `${fieldName}.resolve`);
  return value;
}

function createFailClosedRollback(reasonCode) {
  return Object.freeze({
    enabled: false,
    mode: "fail_closed",
    legacyRetired: true,
    async resolve() {
      throw new ExecutionCapsuleRolloutError(reasonCode);
    },
    rollback() {
      return createFailClosedRollback(reasonCode);
    },
    invalidateRevisionVector() {
      return false;
    },
    clearRevisionCache() {
      return 0;
    },
    snapshot() {
      return deepFreeze({ mode: "fail_closed", legacyRetired: true, cacheEntries: 0, reasonCodes: [reasonCode], secretsIncluded: false });
    },
  });
}

export function createExecutionCapsuleRolloutCoordinator({
  mode = "disabled",
  legacyResolutionService = null,
  capsuleResolutionService = null,
  certification = null,
  canarySelector = () => false,
  parityComparator = defaultParityComparator,
  expectedTargetProvider = (input) => input?.expectedTarget,
  emitTelemetry = async () => {},
  rollbackIsolationGuard = null,
  clock = () => Date.now(),
} = {}) {
  if (!MODE_SET.has(mode)) throw new TypeError(`Unsupported rollout mode: ${mode}`);
  const legacy = requireService(legacyResolutionService, "legacyResolutionService");
  const capsule = mode === "disabled" ? capsuleResolutionService : requireService(capsuleResolutionService, "capsuleResolutionService");
  requireFunction(canarySelector, "canarySelector");
  requireFunction(parityComparator, "parityComparator");
  requireFunction(expectedTargetProvider, "expectedTargetProvider");
  requireFunction(emitTelemetry, "emitTelemetry");
  requireFunction(clock, "clock");
  if (rollbackIsolationGuard != null) requireFunction(rollbackIsolationGuard, "rollbackIsolationGuard");
  if (mode === "canary") requireCertificate(certification);
  if (mode === "retired") requireCertificate(certification, true);

  const cache = new Map();
  const counters = { legacyCalls: 0, capsuleCalls: 0, cacheHits: 0, shadowParityFailures: 0, targetRetentionFailures: 0 };

  async function resolveLegacy(input) {
    counters.legacyCalls += 1;
    return legacy.resolve(input);
  }

  async function resolveCapsule(input) {
    const key = revisionBoundCacheKey(input);
    if (cache.has(key)) {
      counters.cacheHits += 1;
      return { result: cache.get(key), cacheHit: true };
    }
    counters.capsuleCalls += 1;
    const result = await capsule.resolve(input);
    if (result?.status === "resolved") cache.set(key, result);
    return { result, cacheHit: false };
  }

  function assertTargetRetained(input, result) {
    const expected = completeTarget(expectedTargetProvider(input), "expectedTarget");
    const actual = completeTarget(result, "capsuleResult");
    if (targetMismatchFields(expected, actual).length) {
      counters.targetRetentionFailures += 1;
      throw new ExecutionCapsuleRolloutError(
        "context_re_resolution_required",
        ["execution_capsule_rollout_target_substitution_blocked"],
      );
    }
  }

  const coordinator = {
    enabled: mode !== "disabled",
    mode,
    legacyRetired: mode === "retired",
    async resolve(input) {
      const startedAt = safeClockMilliseconds(clock);
      if (mode === "disabled") return resolveLegacy(input);

      if (mode === "shadow") {
        const legacyResult = await resolveLegacy(input);
        let capsuleResult = null;
        let parityMatched = false;
        let exactTargetRetained = false;
        let cacheHit = false;
        let reasonCodes = [];
        try {
          const resolved = await resolveCapsule(input);
          cacheHit = resolved.cacheHit;
          capsuleResult = resolved.result;
          parityMatched = parityComparator(legacyResult, capsuleResult) === true;
          exactTargetRetained = targetMismatchFields(
            completeTarget(expectedTargetProvider(input), "expectedTarget"),
            completeTarget(capsuleResult, "capsuleResult"),
          ).length === 0;
          if (!parityMatched) {
            counters.shadowParityFailures += 1;
            reasonCodes.push("execution_capsule_rollout_shadow_parity_failed");
          }
          if (!exactTargetRetained) {
            counters.targetRetentionFailures += 1;
            reasonCodes.push("execution_capsule_rollout_target_substitution_blocked");
          }
        } catch (error) {
          reasonCodes = [error?.code === "context_re_resolution_required"
            ? "execution_capsule_rollout_target_substitution_blocked"
            : "execution_capsule_rollout_shadow_capsule_failed"];
        }
        await emitSafely(emitTelemetry, {
          eventType: "execution_capsule_rollout", mode, legacyAuthoritative: true,
          legacyRetired: false, canarySelected: false, parityMatched, exactTargetRetained,
          capsuleResolved: Boolean(capsuleResult), cacheHit,
          durationMs: durationMilliseconds(clock, startedAt), reasonCodes, secretsIncluded: false,
        });
        return legacyResult;
      }

      const canarySelected = mode === "retired" || canarySelector(input) === true;
      if (!canarySelected) return resolveLegacy(input);
      let cacheHit = false;
      try {
        const resolved = await resolveCapsule(input);
        cacheHit = resolved.cacheHit;
        assertTargetRetained(input, resolved.result);
        await emitSafely(emitTelemetry, {
          eventType: "execution_capsule_rollout", mode, legacyAuthoritative: false,
          legacyRetired: mode === "retired", canarySelected: true, parityMatched: true,
          exactTargetRetained: true, capsuleResolved: true, cacheHit,
          durationMs: durationMilliseconds(clock, startedAt), reasonCodes: [], secretsIncluded: false,
        });
        return resolved.result;
      } catch (error) {
        await emitSafely(emitTelemetry, {
          eventType: "execution_capsule_rollout", mode, legacyAuthoritative: false,
          legacyRetired: mode === "retired", canarySelected: true, parityMatched: false,
          exactTargetRetained: false, capsuleResolved: false, cacheHit,
          durationMs: durationMilliseconds(clock, startedAt),
          reasonCodes: [error?.code || "execution_capsule_rollout_capsule_failed"], secretsIncluded: false,
        });
        throw error;
      }
    },
    invalidateRevisionVector(input) {
      return cache.delete(revisionBoundCacheKey(input));
    },
    clearRevisionCache() {
      const count = cache.size;
      cache.clear();
      return count;
    },
    rollback(evidence = {}) {
      if (mode === "shadow") {
        return createExecutionCapsuleRolloutCoordinator({ mode: "disabled", legacyResolutionService: legacy, capsuleResolutionService: capsule, emitTelemetry, clock });
      }
      if (mode === "disabled") return coordinator;
      let safe = false;
      try {
        safe = rollbackIsolationGuard?.(deepFreeze({ ...evidence })) === true;
      } catch {
        safe = false;
      }
      if (!safe) return createFailClosedRollback("execution_capsule_rollout_rollback_isolation_unavailable");
      return createExecutionCapsuleRolloutCoordinator({
        mode: mode === "retired" ? "canary" : "disabled",
        legacyResolutionService: legacy,
        capsuleResolutionService: capsule,
        certification,
        canarySelector,
        parityComparator,
        expectedTargetProvider,
        emitTelemetry,
        rollbackIsolationGuard,
        clock,
      });
    },
    snapshot() {
      return deepFreeze({
        mode, legacyRetired: mode === "retired", cacheEntries: cache.size,
        legacyCalls: counters.legacyCalls, capsuleCalls: counters.capsuleCalls,
        cacheHits: counters.cacheHits, shadowParityFailures: counters.shadowParityFailures,
        targetRetentionFailures: counters.targetRetentionFailures,
        certificationStatus: certification?.status || null, secretsIncluded: false,
      });
    },
  };
  return Object.freeze(coordinator);
}

export const ExecutionCapsuleRolloutMode = Object.freeze({
  DISABLED: "disabled", SHADOW: "shadow", CANARY: "canary", RETIRED: "retired",
});
