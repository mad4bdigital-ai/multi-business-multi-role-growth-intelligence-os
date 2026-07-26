import { randomUUID } from "node:crypto";
import { GrowthControlPlaneError } from "../../domain/growthControlPlane/growthControlPlane.js";
import {
  evaluateActivityBindingReadiness,
  planActivityBindingTransition
} from "../../domain/growthControlPlane/activityBindingLifecycle.js";

function requiredText(value, field, maxLength = 191) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maxLength) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_ACTIVITY_BINDING_VALIDATION_ERROR",
      `${field} is required and must be at most ${maxLength} characters.`,
      400,
      [{ field, issue: "required_or_too_long" }]
    );
  }
  return normalized;
}

function nonNegativeRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_ACTIVITY_BINDING_REVISION_INVALID",
      "expectedRevision must be a non-negative integer.",
      422,
      [{ field: "expectedRevision", issue: "invalid" }]
    );
  }
  return revision;
}

function actorId(value) {
  return String(value || "platform_admin").trim().slice(0, 128) || "platform_admin";
}

function ensureScope(binding, context = {}) {
  const checks = [
    ["tenantId", binding.tenantId ?? binding.tenant_id],
    ["workspaceId", binding.workspaceId ?? binding.workspace_id],
    ["brandKey", binding.brandKey ?? binding.brand_key]
  ];
  const mismatch = checks.find(([field, actual]) => context[field] != null && String(context[field]) !== String(actual));
  if (mismatch) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_ACTIVITY_BINDING_SCOPE_FORBIDDEN",
      "Activity binding is outside the authorized scope.",
      403,
      [{ field: mismatch[0], issue: "scope_mismatch" }]
    );
  }
}

function safeEnvelope(overrides = {}) {
  return Object.freeze({
    providerCalls: false,
    externalWrites: false,
    secretsIncluded: false,
    ...overrides
  });
}

export function createActivityBindingLifecycleService({
  repository,
  uuid = randomUUID,
  now = () => new Date()
} = {}) {
  if (!repository) throw new TypeError("Activity binding lifecycle repository is required.");
  for (const method of [
    "getActivityBindingReadinessContext",
    "recordActivityBindingReadiness",
    "getLatestActivityBindingReadiness",
    "applyActivityBindingTransition"
  ]) {
    if (typeof repository[method] !== "function") {
      throw new TypeError(`Activity binding lifecycle repository must implement ${method}().`);
    }
  }

  async function assessReadiness(activityBindingIdValue, input = {}, context = {}) {
    const activityBindingId = requiredText(activityBindingIdValue, "activityBindingId", 36);
    const expectedRevision = nonNegativeRevision(input.expectedRevision);
    const readinessContext = await repository.getActivityBindingReadinessContext({ activityBindingId });
    if (!readinessContext?.binding) {
      throw new GrowthControlPlaneError(
        "GROWTH_CONTROL_ACTIVITY_BINDING_NOT_FOUND",
        "Activity binding was not found.",
        404
      );
    }
    ensureScope(readinessContext.binding, context);
    const actualRevision = Number(readinessContext.binding.revision ?? 0);
    if (actualRevision !== expectedRevision) {
      throw new GrowthControlPlaneError(
        "GROWTH_CONTROL_ACTIVITY_BINDING_REVISION_CONFLICT",
        "Activity binding revision changed before readiness evaluation.",
        409,
        [{ field: "expectedRevision", issue: "conflict", expected: expectedRevision, actual: actualRevision }]
      );
    }
    const evaluation = evaluateActivityBindingReadiness({
      ...readinessContext,
      now: now()
    });
    const evidence = await repository.recordActivityBindingReadiness({
      evidenceId: uuid(),
      activityBindingId,
      expectedRevision,
      targetStatus: evaluation.targetStatus,
      evidenceSha256: evaluation.evidenceSha256,
      checks: evaluation.checks,
      assessedBy: actorId(context.actorId),
      requestId: context.requestId || null,
      correlationId: context.correlationId || null,
      assessedAt: now()
    });
    return safeEnvelope({
      activityBindingId,
      bindingRevision: evidence?.revision ?? expectedRevision + 1,
      status: evaluation.targetStatus,
      ready: evaluation.ready,
      evidenceId: evidence?.evidenceId || null,
      evidenceSha256: evaluation.evidenceSha256,
      checks: evaluation.checks
    });
  }

  async function transitionActivityBinding(activityBindingIdValue, input = {}, context = {}) {
    const activityBindingId = requiredText(activityBindingIdValue, "activityBindingId", 36);
    const expectedRevision = nonNegativeRevision(input.expectedRevision);
    const targetStatus = requiredText(input.targetStatus, "targetStatus", 32).toLowerCase();
    const readinessContext = await repository.getActivityBindingReadinessContext({ activityBindingId });
    if (!readinessContext?.binding) {
      throw new GrowthControlPlaneError(
        "GROWTH_CONTROL_ACTIVITY_BINDING_NOT_FOUND",
        "Activity binding was not found.",
        404
      );
    }
    ensureScope(readinessContext.binding, context);
    const readiness = targetStatus === "active"
      ? await repository.getLatestActivityBindingReadiness({ activityBindingId })
      : null;
    const plan = planActivityBindingTransition({
      binding: readinessContext.binding,
      targetStatus,
      expectedRevision,
      readiness,
      actorId: actorId(context.actorId),
      now: now()
    });
    const result = await repository.applyActivityBindingTransition({
      ...plan,
      actorId: actorId(context.actorId),
      requestId: context.requestId || null,
      correlationId: context.correlationId || null,
      reason: input.reason == null ? null : String(input.reason).trim().slice(0, 1000)
    });
    return safeEnvelope({
      activityBindingId,
      fromStatus: plan.fromStatus,
      status: plan.targetStatus,
      revision: result?.revision ?? plan.update.revision,
      approvedBy: result?.approvedBy ?? plan.update.approvedBy,
      effectiveFrom: result?.effectiveFrom ?? plan.update.effectiveFrom,
      effectiveTo: result?.effectiveTo ?? plan.update.effectiveTo
    });
  }

  return Object.freeze({ assessReadiness, transitionActivityBinding });
}

export const _testingActivityBindingLifecycleService = Object.freeze({
  requiredText,
  nonNegativeRevision,
  actorId,
  ensureScope,
  safeEnvelope
});
