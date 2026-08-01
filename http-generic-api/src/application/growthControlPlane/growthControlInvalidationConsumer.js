import {
  buildGrowthControlInvalidationPlan,
  validateGrowthControlLifecycleEvent,
} from "../../domain/growthControlPlane/growthControlLifecycleEvents.js";

function safeError(error) {
  return Object.freeze({
    code: String(error?.code || "GROWTH_CONTROL_INVALIDATION_FAILED").slice(0, 120),
    message: String(error?.message || "Growth Control invalidation failed.").slice(0, 500),
    status: Number(error?.status || 500),
  });
}

function assessEvent(event) {
  try {
    const typedEvent = validateGrowthControlLifecycleEvent(event);
    const plan = buildGrowthControlInvalidationPlan(typedEvent);
    return Object.freeze({
      ok: true,
      eventId: typedEvent.eventId,
      eventType: typedEvent.eventType,
      plan,
      error: null,
      secretsIncluded: false,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      eventId: event?.eventId || null,
      eventType: event?.eventType || null,
      plan: null,
      error: safeError(error),
      secretsIncluded: false,
    });
  }
}

export function createGrowthControlInvalidationConsumer({ repository } = {}) {
  if (!repository) throw new TypeError("Growth Control invalidation repository is required.");
  for (const method of ["previewEvents", "claimEvents", "applyInvalidationPlan", "markDeliveryFailed"]) {
    if (typeof repository[method] !== "function") {
      throw new TypeError(`Growth Control invalidation repository must implement ${method}().`);
    }
  }

  async function preview({ limit = 25 } = {}) {
    const events = await repository.previewEvents({ limit });
    const assessments = Object.freeze(events.map(assessEvent));
    const blockedCount = assessments.filter((item) => !item.ok).length;
    return Object.freeze({
      ok: blockedCount === 0,
      mode: "dry_run",
      consumerKey: "growth_control_invalidation_v1",
      eligibleCount: events.length,
      validCount: assessments.length - blockedCount,
      blockedCount,
      assessments,
      appliesInvalidation: false,
      providerCalls: false,
      externalWrites: false,
      secretsIncluded: false,
    });
  }

  async function apply({ limit = 25 } = {}) {
    const claim = await repository.claimEvents({ limit });
    if (!claim.events.length) {
      return Object.freeze({
        ok: true,
        mode: "apply",
        consumerKey: claim.consumer?.consumerKey || "growth_control_invalidation_v1",
        claimedCount: 0,
        appliedCount: 0,
        failedCount: 0,
        results: Object.freeze([]),
        providerCalls: false,
        externalWrites: false,
        secretsIncluded: false,
      });
    }

    const results = [];
    for (const event of claim.events) {
      const assessment = assessEvent(event);
      if (!assessment.ok) {
        const failure = await repository.markDeliveryFailed({
          eventId: event.eventId,
          claimToken: claim.claimToken,
          error: assessment.error,
          retryable: false,
        });
        results.push(Object.freeze({
          eventId: event.eventId,
          applied: false,
          deadLetter: Boolean(failure.deadLetter),
          error: assessment.error,
          secretsIncluded: false,
        }));
        continue;
      }
      try {
        const readback = await repository.applyInvalidationPlan({
          eventId: event.eventId,
          claimToken: claim.claimToken,
          plan: assessment.plan,
        });
        results.push(Object.freeze({
          eventId: event.eventId,
          applied: Boolean(readback.applied),
          idempotentReadback: Boolean(readback.idempotentReadback),
          planSha256: assessment.plan.planSha256,
          invalidationCount: assessment.plan.invalidationCount,
          revisionCount: readback.revisions.length,
          error: null,
          secretsIncluded: false,
        }));
      } catch (error) {
        const normalizedError = safeError(error);
        const retryable = normalizedError.status >= 500;
        const failure = await repository.markDeliveryFailed({
          eventId: event.eventId,
          claimToken: claim.claimToken,
          error: normalizedError,
          retryable,
        });
        results.push(Object.freeze({
          eventId: event.eventId,
          applied: false,
          deadLetter: Boolean(failure.deadLetter),
          error: normalizedError,
          secretsIncluded: false,
        }));
      }
    }

    const appliedCount = results.filter((item) => item.applied || item.idempotentReadback).length;
    const failedCount = results.length - appliedCount;
    return Object.freeze({
      ok: failedCount === 0,
      mode: "apply",
      consumerKey: claim.consumer?.consumerKey || "growth_control_invalidation_v1",
      claimToken: claim.claimToken,
      claimedCount: claim.events.length,
      appliedCount,
      failedCount,
      results: Object.freeze(results),
      providerCalls: false,
      externalWrites: false,
      secretsIncluded: false,
    });
  }

  return Object.freeze({ preview, apply });
}

export const _testingGrowthControlInvalidationConsumer = Object.freeze({
  safeError,
  assessEvent,
});
