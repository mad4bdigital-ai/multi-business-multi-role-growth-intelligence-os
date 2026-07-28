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

function normalizedText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseApprovalTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function evaluateApprovalBinding({ plan, approval, approvalRef, now }) {
  if (plan.requiresApproval !== true) {
    return {
      reasonCodes: [],
      approvalRef: null,
      approvalBindingVerified: false,
    };
  }

  if (!approval) {
    return {
      reasonCodes: [approvalRef || plan.approvalRef ? "approval_binding_required" : "approval_required"],
      approvalRef: normalizedText(approvalRef || plan.approvalRef),
      approvalBindingVerified: false,
    };
  }
  if (typeof approval !== "object" || Array.isArray(approval)) {
    return {
      reasonCodes: ["approval_evidence_invalid"],
      approvalRef: null,
      approvalBindingVerified: false,
    };
  }

  const reasonCodes = [];
  const boundApprovalRef = normalizedText(approval.approvalRef);
  const expectedApprovalRef = normalizedText(approvalRef || plan.approvalRef);
  if (!boundApprovalRef) reasonCodes.push("approval_evidence_invalid");
  if (expectedApprovalRef && boundApprovalRef !== expectedApprovalRef) {
    reasonCodes.push("approval_ref_mismatch");
  }

  const status = normalizedText(approval.status)?.toLowerCase() || null;
  if (status === "consumed" || approval.consumedAt) {
    reasonCodes.push("approval_consumed");
  } else if (status === "revoked" || approval.revokedAt) {
    reasonCodes.push("approval_revoked");
  } else if (status !== "approved") {
    reasonCodes.push("approval_status_not_approved");
  }

  const approvalExpiry = parseApprovalTimestamp(approval.expiresAt);
  if (!approval.expiresAt) {
    reasonCodes.push("approval_expiry_required");
  } else if (!approvalExpiry) {
    reasonCodes.push("approval_expiry_invalid");
  } else if (approvalExpiry.getTime() <= now.getTime()) {
    reasonCodes.push("approval_expired");
  }

  const bindings = [
    ["planRef", plan.planRef, "approval_plan_ref_mismatch"],
    ["planHash", plan.planHash, "approval_plan_hash_mismatch"],
    ["contextRevision", plan.contextRevision, "approval_context_revision_mismatch"],
    ["manifestHash", plan.manifestHash, "approval_manifest_hash_mismatch"],
  ];
  for (const [field, expected, code] of bindings) {
    if (approval[field] !== expected) reasonCodes.push(code);
  }
  if (String(approval.manifestVersion ?? "") !== String(plan.manifestVersion ?? "")) {
    reasonCodes.push("approval_manifest_version_mismatch");
  }
  if (!plan.manifestHash || plan.manifestVersion === null || plan.manifestVersion === undefined) {
    reasonCodes.push("approval_manifest_binding_unavailable");
  }

  const uniqueReasons = [...new Set(reasonCodes)];
  return {
    reasonCodes: uniqueReasons,
    approvalRef: boundApprovalRef,
    approvalBindingVerified: uniqueReasons.length === 0,
  };
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
    const manifestHash =
      readiness?.manifestHash ?? readiness?.currentManifest?.manifestHash ?? null;
    const manifestVersion =
      readiness?.manifestVersion ?? readiness?.currentManifest?.manifestVersion ?? null;
    if (
      requiresApproval &&
      (!manifestHash || manifestVersion === null || manifestVersion === undefined)
    ) {
      throw new ContextApplicationError(
        "capability_manifest_required",
        "Approval-bound plans require current capability manifest evidence.",
        409,
      );
    }

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
      manifestHash,
      manifestVersion,
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

  function validate({
    plan,
    currentContext,
    approval = null,
    approvalRef = null,
    now = clock(),
  }) {
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

    const approvalValidation = evaluateApprovalBinding({
      plan: compiledPlan,
      approval,
      approvalRef,
      now,
    });
    reasonCodes.push(...approvalValidation.reasonCodes);

    const uniqueReasons = [...new Set(reasonCodes)];
    return freezeApplicationValue({
      valid: uniqueReasons.length === 0,
      executionAllowed: uniqueReasons.length === 0,
      reasonCodes: uniqueReasons,
      planRef: compiledPlan.planRef,
      contextRevision: context.contextRevision,
      approvalRef: approvalValidation.approvalRef,
      approvalBindingVerified: approvalValidation.approvalBindingVerified,
      validatedAt: now.toISOString(),
      automaticWritePerformed: false,
      secretsIncluded: false,
    });
  }

  return Object.freeze({ compile, validate });
}

export const _testingExecutionPlanService = Object.freeze({
  normalizePlanStep,
  evaluateApprovalBinding,
});
