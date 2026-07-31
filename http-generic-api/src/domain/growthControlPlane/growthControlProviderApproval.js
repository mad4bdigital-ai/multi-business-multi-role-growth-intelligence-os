import { GrowthControlPlaneError, stableSha256 } from "./growthControlPlane.js";

const SHA256_RE = /^[a-f0-9]{64}$/;
const CANONICAL_KEY_RE = /^[a-z][a-z0-9_.-]{2,191}$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/;
const INTERNAL_EFFECT_CLASSES = new Set([
  "internal",
  "internal_draft",
  "analysis",
  "checkpoint",
  "readback",
  "verification",
  "projection",
  "no_effect",
]);
const FORBIDDEN_FIELD_RE = /(secret|token|password|passwd|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session)/i;
const SAFE_SECRET_FLAGS = new Set(["secretsIncluded", "secrets_included"]);

function fail(code, message, field, issue, extra = {}) {
  throw new GrowthControlPlaneError(code, message, 422, [{ field, issue, ...extra }]);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((nested) => deepFreeze(nested, seen));
  return Object.freeze(value);
}

function canonical(value, field) {
  const normalized = String(value ?? "").trim();
  if (!CANONICAL_KEY_RE.test(normalized)) {
    fail("GROWTH_CONTROL_APPROVAL_PLAN_INVALID", `${field} must be a canonical key.`, field, "invalid_canonical_key");
  }
  return normalized;
}

function identifier(value, field) {
  const normalized = String(value ?? "").trim();
  if (!OPAQUE_ID_RE.test(normalized)) {
    fail("GROWTH_CONTROL_APPROVAL_PLAN_INVALID", `${field} must be a bounded opaque identifier.`, field, "invalid_identifier");
  }
  return normalized;
}

function sha(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    fail("GROWTH_CONTROL_APPROVAL_PLAN_INVALID", `${field} must be SHA-256.`, field, "invalid_sha256");
  }
  return normalized;
}

function positiveInteger(value, field, minimum, maximum, fallback) {
  const normalized = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    fail("GROWTH_CONTROL_APPROVAL_PLAN_INVALID", `${field} is outside the supported bounds.`, field, "out_of_range", { minimum, maximum });
  }
  return normalized;
}

function sortedUnique(values, field, { required = false, normalize = canonical } = {}) {
  if (values == null) values = [];
  if (!Array.isArray(values)) {
    fail("GROWTH_CONTROL_APPROVAL_PLAN_INVALID", `${field} must be an array.`, field, "invalid_type");
  }
  const result = [...new Set(values.map((value, index) => normalize(value, `${field}[${index}]`)))].sort();
  if (required && result.length === 0) {
    fail("GROWTH_CONTROL_PROVIDER_RESOURCE_REQUIRED", `${field} must contain at least one identifier.`, field, "required");
  }
  return result;
}

function assertSecretFree(value, field = "value", depth = 0) {
  if (depth > 12 || value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretFree(item, `${field}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_FIELD_RE.test(key) && !(SAFE_SECRET_FLAGS.has(key) && nested === false)) {
      fail("GROWTH_CONTROL_APPROVAL_SENSITIVE_INPUT", "Approval composition contains a forbidden sensitive field.", `${field}.${key}`, "forbidden_sensitive_field");
    }
    assertSecretFree(nested, `${field}.${key}`, depth + 1);
  }
}

function validateCompiledPlan(compiledPlan) {
  if (!compiledPlan || typeof compiledPlan !== "object" || Array.isArray(compiledPlan)) {
    fail("GROWTH_CONTROL_APPROVAL_PLAN_INVALID", "compiledPlan is required.", "compiledPlan", "required");
  }
  if (compiledPlan.contractVersion !== "spec-006-workflow-compiled-plan-v1" || compiledPlan.immutable !== true) {
    fail("GROWTH_CONTROL_APPROVAL_PLAN_INVALID", "Approval composition requires an immutable Spec 006 compiled plan.", "compiledPlan", "contract_mismatch");
  }
  sha(compiledPlan.canonicalHashSha256, "compiledPlan.canonicalHashSha256");
  if (
    compiledPlan.providerCalls !== false ||
    compiledPlan.providerDispatchAllowed !== false ||
    compiledPlan.providerApplyAllowed !== false ||
    compiledPlan.externalWrites !== false ||
    compiledPlan.secretsIncluded !== false
  ) {
    fail("GROWTH_CONTROL_APPROVAL_PLAN_EFFECTFUL_INPUT", "Compiled plan must remain no-effect and no-secret before approval composition.", "compiledPlan", "effects_or_secrets_present");
  }
  if (!Array.isArray(compiledPlan.normalizedDag?.nodes) || !Array.isArray(compiledPlan.normalizedDag?.topologicalOrder)) {
    fail("GROWTH_CONTROL_APPROVAL_PLAN_INVALID", "compiledPlan.normalizedDag is incomplete.", "compiledPlan.normalizedDag", "required");
  }
  assertSecretFree(compiledPlan, "compiledPlan");
}

function checkpointByNode(compiledPlan) {
  return new Map((compiledPlan.approvalCheckpoints || []).map((checkpoint) => [checkpoint.nodeId, checkpoint]));
}

function isProviderEffect(node) {
  return !INTERNAL_EFFECT_CLASSES.has(String(node.executionClass || "internal").trim().toLowerCase());
}

function internalStepType(node) {
  const effectClass = String(node.executionClass || "internal").trim().toLowerCase();
  if (["checkpoint", "readback", "verification"].includes(effectClass) || node.verificationCheckpoint?.required) return "checkpoint";
  return "analysis";
}

function requestBinding({ planHash, node, environment, resourceIds, actionIds, expiresInSeconds }) {
  const withoutHash = {
    contract_version: "growth-control-provider-approval-v1",
    plan_hash_sha256: planHash,
    node_id: node.nodeId,
    capability_key: node.capabilityKey,
    action_ids: actionIds,
    resource_ids: resourceIds,
    environment,
    effect_class: node.executionClass,
    expires_in_seconds: expiresInSeconds,
  };
  return { ...withoutHash, request_hash_sha256: stableSha256(withoutHash) };
}

export function composeGrowthControlProviderApprovalPlan({
  compiledPlan,
  planId,
  tenantId,
  environment = "development",
  resourceIdsByNode = {},
  actionIdsByNode = {},
  approvalProfile = {},
} = {}) {
  validateCompiledPlan(compiledPlan);
  const normalizedPlanId = identifier(planId, "planId");
  const normalizedTenantId = identifier(tenantId, "tenantId");
  const normalizedEnvironment = canonical(environment, "environment");
  assertSecretFree({ resourceIdsByNode, actionIdsByNode, approvalProfile }, "approvalInput");

  const requiredRole = canonical(approvalProfile.requiredRole ?? approvalProfile.required_role ?? "supervisor", "approvalProfile.requiredRole");
  const expiresInSeconds = positiveInteger(
    approvalProfile.expiresInSeconds ?? approvalProfile.expires_in_seconds,
    "approvalProfile.expiresInSeconds",
    300,
    604800,
    3600,
  );
  const planHash = sha(compiledPlan.canonicalHashSha256, "compiledPlan.canonicalHashSha256");
  const checkpoints = checkpointByNode(compiledPlan);
  const nodes = new Map(compiledPlan.normalizedDag.nodes.map((node) => [node.nodeId, node]));
  const sequentialSteps = [];
  const approvalBindings = [];

  for (const nodeId of compiledPlan.normalizedDag.topologicalOrder) {
    const node = nodes.get(nodeId);
    if (!node) {
      fail("GROWTH_CONTROL_APPROVAL_PLAN_INVALID", "Topological order references an unknown node.", "compiledPlan.normalizedDag.topologicalOrder", "unknown_node", { value: nodeId });
    }
    const providerEffect = isProviderEffect(node);
    const checkpoint = checkpoints.get(node.nodeId) || node.approvalCheckpoint || null;
    if (providerEffect && checkpoint?.required !== true) {
      fail("GROWTH_CONTROL_PROVIDER_APPROVAL_REQUIRED", "Every provider-effect node requires an explicit approval checkpoint.", `nodes.${node.nodeId}.approvalCheckpoint`, "required");
    }

    const resourceIds = sortedUnique(
      resourceIdsByNode[node.nodeId],
      `resourceIdsByNode.${node.nodeId}`,
      { required: providerEffect, normalize: identifier },
    );
    const actionIds = sortedUnique(
      actionIdsByNode[node.nodeId] ?? [node.nodeId],
      `actionIdsByNode.${node.nodeId}`,
      { required: providerEffect, normalize: canonical },
    );
    const binding = providerEffect
      ? requestBinding({ planHash, node, environment: normalizedEnvironment, resourceIds, actionIds, expiresInSeconds })
      : null;
    const approvalPolicy = providerEffect
      ? {
          ...binding,
          required: true,
          approved: false,
          required_role: requiredRole,
          checkpoint_key: canonical(checkpoint.checkpointKey ?? checkpoint.checkpoint_key, `nodes.${node.nodeId}.checkpointKey`),
          policy_key: checkpoint.policyKey ?? checkpoint.policy_key
            ? canonical(checkpoint.policyKey ?? checkpoint.policy_key, `nodes.${node.nodeId}.policyKey`)
            : null,
        }
      : { required: false, approved: true };

    sequentialSteps.push({
      step_key: node.nodeId,
      step_type: providerEffect ? "workflow" : internalStepType(node),
      workflow_key: providerEffect ? canonical(`growth_control.${node.capabilityKey}`, `nodes.${node.nodeId}.workflowKey`) : null,
      depends_on: [...(node.dependsOn || [])],
      input: {
        source: "growth_control_provider_approval",
        plan_hash_sha256: planHash,
        node_id: node.nodeId,
        capability_key: node.capabilityKey,
        effect_class: node.executionClass,
        environment: normalizedEnvironment,
        resource_ids: resourceIds,
        action_ids: actionIds,
        request_hash_sha256: binding?.request_hash_sha256 || null,
        provider_dispatch_allowed: false,
        external_writes: false,
        secrets_included: false,
      },
      approval_policy: approvalPolicy,
      success_criteria: providerEffect
        ? { result_ok: true, required_output_fields: ["readback.evidence_ref"] }
        : { result_ok: true },
      max_attempts: providerEffect ? 1 : 2,
      idempotency_key: stableSha256({
        plan_id: normalizedPlanId,
        tenant_id: normalizedTenantId,
        node_id: node.nodeId,
        request_hash_sha256: binding?.request_hash_sha256 || planHash,
      }),
    });
    if (providerEffect) approvalBindings.push({ node_id: node.nodeId, ...approvalPolicy });
  }

  const withoutHash = {
    contractVersion: "growth-control-provider-approval-plan-v1",
    planId: normalizedPlanId,
    tenantId: normalizedTenantId,
    environment: normalizedEnvironment,
    compiledPlanHashSha256: planHash,
    workflowIdentity: compiledPlan.workflowIdentity,
    sequentialSteps,
    approvalBindings,
    providerEffectNodeCount: approvalBindings.length,
    immutable: true,
    providerCalls: false,
    providerDispatchAllowed: false,
    providerApplyAllowed: false,
    externalWrites: false,
    secretsIncluded: false,
  };
  return deepFreeze({ ...withoutHash, canonicalHashSha256: stableSha256(withoutHash) });
}

export const growthControlProviderApprovalContract = Object.freeze({
  version: "growth-control-provider-approval-plan-v1",
  internal_effect_classes: [...INTERNAL_EFFECT_CLASSES].sort(),
  provider_effect_requires_explicit_checkpoint: true,
  approval_binding_fields: [
    "plan_hash_sha256",
    "request_hash_sha256",
    "node_id",
    "capability_key",
    "action_ids",
    "resource_ids",
    "environment",
    "effect_class",
    "expires_in_seconds",
  ],
  provider_dispatch_allowed_before_approval: false,
  secrets_included: false,
});

export const _testingGrowthControlProviderApproval = Object.freeze({
  INTERNAL_EFFECT_CLASSES,
  assertSecretFree,
  validateCompiledPlan,
  isProviderEffect,
  requestBinding,
  identifier,
  deepFreeze,
});
