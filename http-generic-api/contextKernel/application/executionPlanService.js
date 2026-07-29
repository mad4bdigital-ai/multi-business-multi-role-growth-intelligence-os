import { randomUUID } from "node:crypto";

import { createContextHash, validateContextRevision } from "../domain/index.js";
import {
  ContextApplicationError,
  freezeApplicationValue,
  requireApplicationFunction,
  requireApplicationObject,
  requireApplicationString,
} from "./applicationSupport.js";

const PLAN_RISK_CLASSES = new Set(["read", "low", "medium", "high", "critical"]);
const PLAN_OPERATION_KINDS = new Set(["read", "mutation"]);

function normalizePlanStep(step, index) {
  const value = requireApplicationObject(step, `steps[${index}]`);
  const operationKind = value.operationKind || "read";
  const riskClass = value.riskClass || "read";
  if (!PLAN_OPERATION_KINDS.has(operationKind)) {
    throw new TypeError(`Unsupported step operationKind: ${operationKind}`);
  }
  if (!PLAN_RISK_CLASSES.has(riskClass)) {
    throw new TypeError(`Unsupported step riskClass: ${riskClass}`);
  }
  return freezeApplicationValue({
    stepRef: requireApplicationString(value.stepRef || `step-${index + 1}`, "stepRef"),
    actionKey: requireApplicationString(value.actionKey, "actionKey"),
    resourceRef: value.resourceRef || null,
    capabilityKey: value.capabilityKey || null,
    operationKind,
    riskClass,
  });
}

export function createExecutionPlanService({
  idFactory = () => randomUUID(),
  clock = () => new Date(),
  defaultTtlMs = 15 * 60 * 1000,
} = {}) {
  requireApplicationFunction(idFactory, "idFactory");
  requireApplicationFunction(clock, "clock");

  function compile({
    resolution,
    operationIntent,
    operationKind = "read",
    riskClass = "read",
    capabilityKey = null,
    idempotencyKey = null,
    approvalRef = null,
    steps = [],
    expiresAt = null,
  }) {
    const resolved = requireApplicationObject(resolution, "resolution");
    if (resolved.status !== "resolved" || !resolved.context || !resolved.selectedCandidate) {
      throw new ContextApplicationError(
        "execution_plan_requires_resolved_context",
        "An execution plan can only be compiled from a resolved context.",
        409,
      );
    }
    if (!PLAN_OPERATION_KINDS.has(operationKind)) {
      throw new TypeError(`Unsupported operationKind: ${operationKind}`);
    }
    if (!PLAN_RISK_CLASSES.has(riskClass)) {
      throw new TypeError(`Unsupported riskClass: ${riskClass}`);
    }

    const readiness = resolved.capabilityReadiness || null;
    if (readiness && readiness.dispatchAllowed !== true) {
      throw new ContextApplicationError(
        "capability_dispatch_not_allowed",
        "The selected capability is not dispatchable.",
        409,
        { capability_key: readiness.capabilityKey || capabilityKey },
      );
    }
    if (operationKind === "mutation" && !readiness) {
      throw new ContextApplicationError(
        "capability_readiness_required",
        "Mutation plans require capability readiness evidence.",
        409,
      );
    }

    const compiledAt = clock();
    const normalizedExpiry = expiresAt == null
      ? new Date(compiledAt.getTime() + defaultTtlMs)
      : new Date(expiresAt);
    if (Number.isNaN(normalizedExpiry.getTime()) || normalizedExpiry.getTime() <= compiledAt.getTime()) {
      throw new ContextApplicationError(
        "execution_plan_expiry_invalid",
        "Execution plan expiry must be a valid future timestamp.",
        422,
      );
    }

    const normalizedSteps = steps.map(normalizePlanStep);
    const requiresApproval =
      operationKind === "mutation" ||
      riskClass === "high" ||
      riskClass === "critical";
    const descriptor = freezeApplicationValue({
      planRef: requireApplicationString(idFactory(), "planRef"),
      operationIntent: requireApplicationString(operationIntent, "operationIntent"),
      operationKind,
      riskClass,
      capabilityKey: capabilityKey || readiness?.capabilityKey || null,
      idempotencyKey: idempotencyKey || null,
      approvalRef: approvalRef || null,
      requiresApproval,
      contextRevision: resolved.context.contextRevision,
      contextHash: resolved.context.contextHash,
      selectedCandidateRef: resolved.selectedCandidate.stableRef,
      tenantRef: resolved.context.tenantRef,
      workspaceRef: resolved.context.workspaceRef,
      connectionRef: resolved.context.connectionRef,
      capabilityDispatchAllowed: readiness?.dispatchAllowed === true,
      capabilityApplyAllowed: readiness?.applyAllowed === true,
      steps: normalizedSteps,
      compiledAt: compiledAt.toISOString(),
      expiresAt: normalizedExpiry.toISOString(),
      status: "compiled",
      executionAllowed: false,
      automaticWritePerformed: false,
      secretsIncluded: false,
    });

    return freezeApplicationValue({
      ...descriptor,
      planHash: createContextHash(descriptor),
    });
  }

  function validate({ plan, currentContext, approvalRef = null, now = clock() }) {
    const compiledPlan = requireApplicationObject(plan, "plan");
    const context = requireApplicationObject(currentContext, "currentContext");
    const revision = validateContextRevision({
      expectedRevision: compiledPlan.contextRevision,
      actualRevision: context.contextRevision,
      expiresAt: compiledPlan.expiresAt,
      now,
    });
    const reasonCodes = [...revision.reasonCodes];

    if (compiledPlan.contextHash !== context.contextHash) reasonCodes.push("context_hash_mismatch");
    if (compiledPlan.selectedCandidateRef !== context.selectedCandidate?.stableRef) {
      reasonCodes.push("context_candidate_mismatch");
    }
    if (compiledPlan.capabilityDispatchAllowed !== true && compiledPlan.capabilityKey) {
      reasonCodes.push("capability_dispatch_not_allowed");
    }
    if (compiledPlan.operationKind === "mutation" && compiledPlan.capabilityApplyAllowed !== true) {
      reasonCodes.push("capability_apply_not_allowed");
    }
    if (compiledPlan.requiresApproval && !(approvalRef || compiledPlan.approvalRef)) {
      reasonCodes.push("approval_required");
    }

    const uniqueReasons = [...new Set(reasonCodes)];
    return freezeApplicationValue({
      valid: uniqueReasons.length === 0,
      executionAllowed: uniqueReasons.length === 0,
      reasonCodes: uniqueReasons,
      planRef: compiledPlan.planRef,
      contextRevision: context.contextRevision,
      validatedAt: now.toISOString(),
      automaticWritePerformed: false,
      secretsIncluded: false,
    });
  }

  return Object.freeze({ compile, validate });
}

export const _testingExecutionPlanService = Object.freeze({
  normalizePlanStep,
});
