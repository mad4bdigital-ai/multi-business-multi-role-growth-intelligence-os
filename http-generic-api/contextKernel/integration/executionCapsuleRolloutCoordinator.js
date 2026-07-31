import {
  certificationContextMismatchFields,
  completeTarget,
  deepFreeze,
  defaultParityComparator,
  durationMilliseconds,
  emitSafely,
  normalizeCertificationContext,
  requireFunction,
  requireObject,
  revisionBoundCacheKey,
  safeClockMilliseconds,
  safeReasonCode,
  targetMismatchFields,
} from "./executionCapsuleRolloutSupport.js";
import {
  isTrustedExecutionCapsuleRolloutCertificate,
} from "./executionCapsuleRolloutEvaluator.js";

const MODE_SET = new Set(["disabled", "shadow", "canary", "retired"]);
const DEFAULT_MAX_CACHE_ENTRIES = 256;
const MAX_CACHE_ENTRIES_LIMIT = 4096;

export class ExecutionCapsuleRolloutError extends Error {
  constructor(code, reasonCodes = [code]) {
    super(code);
    this.name = "ExecutionCapsuleRolloutError";
    this.code = code;
    this.status = 409;
    this.reasonCodes = Object.freeze([...new Set(reasonCodes.map((reason) =>
      safeReasonCode(reason, code)
    ))]);
  }
}

function requireCertificate(certificate, expectedContext, retirement = false) {
  if (!isTrustedExecutionCapsuleRolloutCertificate(certificate)) {
    throw new ExecutionCapsuleRolloutError("execution_capsule_rollout_certificate_untrusted");
  }
  const mismatches = certificationContextMismatchFields(
    certificate.certificationContext,
    expectedContext,
  );
  if (mismatches.length) {
    throw new ExecutionCapsuleRolloutError(
      "execution_capsule_rollout_certificate_revision_mismatch",
      mismatches.map((field) => `execution_capsule_rollout_${field}_mismatch`),
    );
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
      return deepFreeze({
        mode: "fail_closed",
        legacyRetired: true,
        cacheEntries: 0,
        maxCacheEntries: 0,
        reasonCodes: [reasonCode],
        secretsIncluded: false,
      });
    },
  });
}

export function createExecutionCapsuleRolloutCoordinator({
  mode = "disabled",
  legacyResolutionService = null,
  capsuleResolutionService = null,
  certification = null,
  expectedCertificationContext = null,
  canarySelector = () => false,
  parityComparator = defaultParityComparator,
  expectedTargetProvider = (input) => input?.expectedTarget,
  emitTelemetry = async () => {},
  rollbackIsolationGuard = null,
  maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES,
  clock = () => Date.now(),
} = {}) {
  if (!MODE_SET.has(mode)) throw new TypeError(`Unsupported rollout mode: ${mode}`);
  const legacy = requireService(legacyResolutionService, "legacyResolutionService");
  const capsule = mode === "disabled"
    ? capsuleResolutionService
    : requireService(capsuleResolutionService, "capsuleResolutionService");
  requireFunction(canarySelector, "canarySelector");
  requireFunction(parityComparator, "parityComparator");
  requireFunction(expectedTargetProvider, "expectedTargetProvider");
  requireFunction(emitTelemetry, "emitTelemetry");
  requireFunction(clock, "clock");
  if (rollbackIsolationGuard != null) requireFunction(rollbackIsolationGuard, "rollbackIsolationGuard");
  if (!Number.isInteger(maxCacheEntries) || maxCacheEntries < 1 || maxCacheEntries > MAX_CACHE_ENTRIES_LIMIT) {
    throw new TypeError(`maxCacheEntries must be an integer between 1 and ${MAX_CACHE_ENTRIES_LIMIT}.`);
  }
  const certificationContext = ["canary", "retired"].includes(mode)
    ? normalizeCertificationContext(expectedCertificationContext, "expectedCertificationContext")
    : null;
  if (mode === "canary") requireCertificate(certification, certificationContext);
  if (mode === "retired") requireCertificate(certification, certificationContext, true);

  const cache = new Map();
  const counters = {
    legacyCalls: 0,
    capsuleCalls: 0,
    cacheHits: 0,
    cacheEvictions: 0,
    shadowParityFailures: 0,
    targetRetentionFailures: 0,
  };

  async function resolveLegacy(input) {
    counters.legacyCalls += 1;
    return legacy.resolve(input);
  }

  function setCache(key, result) {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, result);
    while (cache.size > maxCacheEntries) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
      counters.cacheEvictions += 1;
    }
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

  async function resolveCapsule(input) {
    const key = revisionBoundCacheKey(input);
    if (cache.has(key)) {
      const result = cache.get(key);
      cache.delete(key);
      cache.set(key, result);
      counters.cacheHits += 1;
      assertTargetRetained(input, result);
      return { result, cacheHit: true };
    }
    counters.capsuleCalls += 1;
    const result = await capsule.resolve(input);
    assertTargetRetained(input, result);
    if (result?.status === "resolved") setCache(key, result);
    return { result, cacheHit: false };
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
          exactTargetRetained = true;
          if (!parityMatched) {
            counters.shadowParityFailures += 1;
            reasonCodes.push("execution_capsule_rollout_shadow_parity_failed");
          }
        } catch (error) {
          exactTargetRetained = error?.code !== "context_re_resolution_required";
          reasonCodes = [error?.code === "context_re_resolution_required"
            ? "execution_capsule_rollout_target_substitution_blocked"
            : "execution_capsule_rollout_shadow_capsule_failed"];
        }
        await emitSafely(emitTelemetry, {
          eventType: "execution_capsule_rollout",
          mode,
          legacyAuthoritative: true,
          legacyRetired: false,
          canarySelected: false,
          parityMatched,
          exactTargetRetained,
          capsuleResolved: Boolean(capsuleResult),
          cacheHit,
          durationMs: durationMilliseconds(clock, startedAt),
          reasonCodes,
          secretsIncluded: false,
        });
        return legacyResult;
      }

      const canarySelected = mode === "retired" || canarySelector(input) === true;
      if (!canarySelected) return resolveLegacy(input);
      let cacheHit = false;
      try {
        const resolved = await resolveCapsule(input);
        cacheHit = resolved.cacheHit;
        await emitSafely(emitTelemetry, {
          eventType: "execution_capsule_rollout",
          mode,
          legacyAuthoritative: false,
          legacyRetired: mode === "retired",
          canarySelected: true,
          parityMatched: true,
          exactTargetRetained: true,
          capsuleResolved: true,
          cacheHit,
          durationMs: durationMilliseconds(clock, startedAt),
          reasonCodes: [],
          secretsIncluded: false,
        });
        return resolved.result;
      } catch (error) {
        await emitSafely(emitTelemetry, {
          eventType: "execution_capsule_rollout",
          mode,
          legacyAuthoritative: false,
          legacyRetired: mode === "retired",
          canarySelected: true,
          parityMatched: false,
          exactTargetRetained: error?.code !== "context_re_resolution_required",
          capsuleResolved: false,
          cacheHit,
          durationMs: durationMilliseconds(clock, startedAt),
          reasonCodes: [safeReasonCode(error?.code)],
          secretsIncluded: false,
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
        return createExecutionCapsuleRolloutCoordinator({
          mode: "disabled",
          legacyResolutionService: legacy,
          capsuleResolutionService: capsule,
          emitTelemetry,
          maxCacheEntries,
          clock,
        });
      }
      if (mode === "disabled") return coordinator;
      let safe = false;
      try {
        safe = rollbackIsolationGuard?.(deepFreeze({ ...evidence })) === true;
      } catch {
        safe = false;
      }
      if (!safe) {
        return createFailClosedRollback("execution_capsule_rollout_rollback_isolation_unavailable");
      }
      return createExecutionCapsuleRolloutCoordinator({
        mode: mode === "retired" ? "canary" : "disabled",
        legacyResolutionService: legacy,
        capsuleResolutionService: capsule,
        certification,
        expectedCertificationContext: certificationContext,
        canarySelector,
        parityComparator,
        expectedTargetProvider,
        emitTelemetry,
        rollbackIsolationGuard,
        maxCacheEntries,
        clock,
      });
    },
    snapshot() {
      return deepFreeze({
        mode,
        legacyRetired: mode === "retired",
        cacheEntries: cache.size,
        maxCacheEntries,
        legacyCalls: counters.legacyCalls,
        capsuleCalls: counters.capsuleCalls,
        cacheHits: counters.cacheHits,
        cacheEvictions: counters.cacheEvictions,
        shadowParityFailures: counters.shadowParityFailures,
        targetRetentionFailures: counters.targetRetentionFailures,
        certificationStatus: certification?.status || null,
        certificationContext,
        secretsIncluded: false,
      });
    },
  };
  return Object.freeze(coordinator);
}

export const ExecutionCapsuleRolloutMode = Object.freeze({
  DISABLED: "disabled",
  SHADOW: "shadow",
  CANARY: "canary",
  RETIRED: "retired",
});
