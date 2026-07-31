import { stableSha256 } from "../../domain/growthControlPlane/growthControlPlane.js";
import { composeGrowthControlProviderApprovalPlan } from "../../domain/growthControlPlane/growthControlProviderApproval.js";
import {
  persistGrowthControlProviderApprovalPlan,
  runGrowthControlProviderApprovalPlan,
} from "./growthControlProviderApprovalService.js";

const INTERNAL_STEP_TYPES = new Set(["analysis", "checkpoint"]);
const SENSITIVE_KEY_RE = /(secret|token|password|passwd|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session)/i;
const SENSITIVE_VALUE_RE = /(Bearer\s+[A-Za-z0-9._~+\-/]+=*|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const MAX_ARTIFACT_BYTES = 32768;
const MAX_EVIDENCE_REF_LENGTH = 512;
const REFERENCE_STEP_COUNT = 3;

function workflowError(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((nested) => deepFreeze(nested, seen));
  return Object.freeze(value);
}

function resolveUnique(rows, code, message) {
  const candidates = Array.isArray(rows) ? rows : [];
  if (candidates.length === 0) return null;
  if (candidates.length > 1) throw workflowError(code, message, 409);
  const [candidate] = candidates;
  return candidate;
}

function assertSafeArtifact(value, path = "artifact", depth = 0) {
  if (depth > 10) {
    throw workflowError("growth_control_internal_artifact_too_deep", "Internal artifact nesting exceeds the supported bound.", 422, { path });
  }
  if (value == null || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    if (value.length > 8192 || SENSITIVE_VALUE_RE.test(value)) {
      throw workflowError("growth_control_internal_artifact_sensitive", "Internal artifact contains an unsafe or oversized string.", 422, { path });
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) {
      throw workflowError("growth_control_internal_artifact_oversized", "Internal artifact array exceeds the supported bound.", 422, { path });
    }
    value.forEach((item, index) => assertSafeArtifact(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") {
    throw workflowError("growth_control_internal_artifact_invalid", "Internal artifact contains an unsupported value.", 422, { path });
  }
  const entries = Object.entries(value);
  if (entries.length > 100) {
    throw workflowError("growth_control_internal_artifact_oversized", "Internal artifact object exceeds the supported bound.", 422, { path });
  }
  for (const [key, nested] of entries) {
    if (SENSITIVE_KEY_RE.test(key)) {
      throw workflowError("growth_control_internal_artifact_sensitive", "Internal artifact contains a forbidden sensitive field.", 422, { path: `${path}.${key}` });
    }
    assertSafeArtifact(nested, `${path}.${key}`, depth + 1);
  }
}

function boundedArtifact(value, path = "artifact") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw workflowError("growth_control_internal_artifact_required", "Internal execution must return an artifact object.", 422, { path });
  }
  assertSafeArtifact(value, path);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_ARTIFACT_BYTES) {
    throw workflowError("growth_control_internal_artifact_oversized", "Internal artifact exceeds the supported byte bound.", 422, { path });
  }
  return JSON.parse(serialized);
}

function evidenceReference(value, field = "readback.evidence_ref") {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > MAX_EVIDENCE_REF_LENGTH || SENSITIVE_VALUE_RE.test(normalized)) {
    throw workflowError("growth_control_internal_readback_invalid", "Internal readback evidence reference is missing or unsafe.", 422, { field });
  }
  return normalized;
}

export function composeGrowthControlInternalReferenceWorkflow(input = {}) {
  const approvalPlan = composeGrowthControlProviderApprovalPlan(input);
  if (approvalPlan.providerEffectNodeCount !== 0 || approvalPlan.approvalBindings.length !== 0) {
    throw workflowError(
      "growth_control_internal_reference_provider_effect_forbidden",
      "The internal reference workflow cannot contain provider-effect nodes.",
      422,
    );
  }
  if (approvalPlan.sequentialSteps.length !== REFERENCE_STEP_COUNT) {
    throw workflowError(
      "growth_control_internal_reference_step_count_invalid",
      `The internal reference workflow requires exactly ${REFERENCE_STEP_COUNT} steps.`,
      422,
      { observed_step_count: approvalPlan.sequentialSteps.length },
    );
  }
  for (const step of approvalPlan.sequentialSteps) {
    if (!INTERNAL_STEP_TYPES.has(step.step_type)) {
      throw workflowError(
        "growth_control_internal_reference_step_type_forbidden",
        "The internal reference workflow contains a non-internal step type.",
        422,
        { step_key: step.step_key, step_type: step.step_type },
      );
    }
    if (step.approval_policy?.required !== false || step.approval_policy?.approved !== true) {
      throw workflowError(
        "growth_control_internal_reference_approval_mismatch",
        "Internal reference steps must not require execution approval.",
        422,
        { step_key: step.step_key },
      );
    }
  }
  return deepFreeze({
    contractVersion: "growth-control-internal-reference-workflow-v1",
    planId: approvalPlan.planId,
    tenantId: approvalPlan.tenantId,
    compiledPlanHashSha256: approvalPlan.compiledPlanHashSha256,
    approvalPlanHashSha256: approvalPlan.canonicalHashSha256,
    sequentialSteps: approvalPlan.sequentialSteps,
    stepCount: approvalPlan.sequentialSteps.length,
    providerEffectNodeCount: 0,
    immutable: true,
    providerCalls: false,
    providerDispatchAllowed: false,
    providerApplyAllowed: false,
    externalWrites: false,
    secretsIncluded: false,
    canonicalHashSha256: stableSha256({
      plan_id: approvalPlan.planId,
      tenant_id: approvalPlan.tenantId,
      compiled_plan_hash_sha256: approvalPlan.compiledPlanHashSha256,
      approval_plan_hash_sha256: approvalPlan.canonicalHashSha256,
      step_keys: approvalPlan.sequentialSteps.map((step) => step.step_key),
    }),
  });
}

export async function persistGrowthControlInternalReferenceWorkflow({ pool, actorId = null, ...input } = {}) {
  if (!pool) throw workflowError("growth_control_internal_reference_pool_required", "pool is required.", 400);
  const referenceWorkflow = composeGrowthControlInternalReferenceWorkflow(input);
  const persisted = await persistGrowthControlProviderApprovalPlan({ pool, actorId, ...input });
  return {
    ok: true,
    reference_workflow_hash_sha256: referenceWorkflow.canonicalHashSha256,
    compiled_plan_hash_sha256: referenceWorkflow.compiledPlanHashSha256,
    step_count: referenceWorkflow.stepCount,
    durable_plan: persisted.durable_plan,
    provider_calls: false,
    provider_dispatch_allowed: false,
    external_writes: false,
    secrets_included: false,
  };
}

function defaultInternalExecutor(step) {
  const input = parseJson(step.input_json, {});
  const artifact = {
    artifact_key: `${input.node_id}.artifact`,
    artifact_type: "growth_control_internal_reference",
    node_id: input.node_id,
    capability_key: input.capability_key,
    source_plan_hash_sha256: input.plan_hash_sha256,
    content_sha256: stableSha256({
      node_id: input.node_id,
      capability_key: input.capability_key,
      source_plan_hash_sha256: input.plan_hash_sha256,
    }),
  };
  return {
    ok: true,
    output: artifact,
    readback: {
      evidence_ref: `growth-control://internal-reference/${artifact.artifact_key}`,
      output_sha256: stableSha256(artifact),
    },
    execution_mode: "internal",
  };
}

function internalExecutor(executeInternalStep) {
  const executor = typeof executeInternalStep === "function" ? executeInternalStep : defaultInternalExecutor;
  return async (step, context) => {
    if (!INTERNAL_STEP_TYPES.has(step?.step_type)) {
      throw workflowError(
        "growth_control_internal_reference_dispatch_forbidden",
        "Provider or workflow dispatch is forbidden in the internal reference slice.",
        409,
        { step_key: step?.step_key || null, step_type: step?.step_type || null },
      );
    }
    const result = await executor(step, context);
    if (result?.ok !== true) {
      throw workflowError(
        "growth_control_internal_reference_execution_failed",
        "Internal reference execution did not return an explicit successful result.",
        422,
        { step_key: step.step_key },
      );
    }
    const output = boundedArtifact(result.output, `steps.${step.step_key}.output`);
    const outputSha256 = stableSha256(output);
    const reference = evidenceReference(result.readback?.evidence_ref ?? output.evidence_ref);
    if (result.readback?.output_sha256 && String(result.readback.output_sha256) !== outputSha256) {
      throw workflowError(
        "growth_control_internal_readback_hash_mismatch",
        "Internal execution readback hash does not match the returned artifact.",
        422,
        { step_key: step.step_key },
      );
    }
    return {
      ok: true,
      output,
      readback: { evidence_ref: reference, output_sha256: outputSha256 },
      execution_mode: "internal",
    };
  };
}

export async function readGrowthControlInternalReferenceWorkflow({
  pool,
  planId,
  tenantId = null,
  expectedPlanHashSha256 = null,
} = {}) {
  if (!pool || !planId) {
    throw workflowError("growth_control_internal_reference_read_scope_required", "pool and planId are required.", 400);
  }
  const [planRows] = await pool.query(
    "SELECT plan_id, tenant_id, plan_status, runtime_status FROM execution_plans WHERE plan_id = ? LIMIT 2",
    [planId],
  );
  const plan = resolveUnique(
    planRows,
    "growth_control_internal_reference_plan_ambiguous",
    "Internal reference plan identity resolved to multiple rows.",
  );
  if (!plan || (tenantId && String(plan.tenant_id) !== String(tenantId))) {
    throw workflowError("growth_control_internal_reference_not_found", "Internal reference plan was not found for the tenant.", 404);
  }
  const [stepRows] = await pool.query(
    `SELECT plan_step_id, plan_id, tenant_id, step_order, step_key, step_type, depends_on_json,
            input_json, output_json, error_json, status
       FROM execution_plan_steps WHERE plan_id = ? ORDER BY step_order LIMIT 4`,
    [planId],
  );
  if (stepRows.length !== REFERENCE_STEP_COUNT) {
    throw workflowError(
      "growth_control_internal_reference_readback_incomplete",
      "Internal reference readback does not contain the exact reference step set.",
      409,
      { observed_step_count: stepRows.length },
    );
  }

  const artifacts = [];
  const lineage = [];
  for (const step of stepRows) {
    if (!INTERNAL_STEP_TYPES.has(step.step_type) || step.status !== "completed") {
      throw workflowError(
        "growth_control_internal_reference_readback_incomplete",
        "Internal reference readback contains a non-internal or incomplete step.",
        409,
        { step_key: step.step_key, step_type: step.step_type, status: step.status },
      );
    }
    const input = parseJson(step.input_json, {});
    const result = parseJson(step.output_json, null);
    const output = boundedArtifact(result?.output, `steps.${step.step_key}.output`);
    const outputSha256 = stableSha256(output);
    const reference = evidenceReference(result?.readback?.evidence_ref);
    if (result?.readback?.output_sha256 !== outputSha256) {
      throw workflowError(
        "growth_control_internal_readback_hash_mismatch",
        "Persisted internal readback hash does not match the artifact.",
        500,
        { step_key: step.step_key },
      );
    }
    if (expectedPlanHashSha256 && String(input.plan_hash_sha256) !== String(expectedPlanHashSha256)) {
      throw workflowError(
        "growth_control_internal_readback_plan_hash_mismatch",
        "Persisted internal step lineage does not match the expected compiled plan hash.",
        409,
        { step_key: step.step_key },
      );
    }
    artifacts.push({
      step_key: step.step_key,
      artifact: output,
      output_sha256: outputSha256,
      evidence_ref: reference,
    });
    lineage.push({
      plan_step_id: step.plan_step_id,
      step_key: step.step_key,
      node_id: input.node_id,
      capability_key: input.capability_key,
      depends_on: parseJson(step.depends_on_json, []),
      source_plan_hash_sha256: input.plan_hash_sha256,
      output_sha256: outputSha256,
      evidence_ref: reference,
    });
  }

  const withoutHash = {
    contract_version: "growth-control-internal-reference-readback-v1",
    plan_id: String(plan.plan_id),
    tenant_id: String(plan.tenant_id),
    plan_status: String(plan.runtime_status || plan.plan_status),
    artifacts,
    lineage,
    artifact_count: artifacts.length,
    provider_calls: false,
    provider_dispatch_allowed: false,
    external_writes: false,
    secrets_included: false,
  };
  return deepFreeze({ ...withoutHash, readback_sha256: stableSha256(withoutHash) });
}

export async function runGrowthControlInternalReferenceWorkflow({
  pool,
  planId,
  tenantId = null,
  compiledPlan,
  actorId = null,
  environment = "development",
  resourceIdsByNode = {},
  actionIdsByNode = {},
  approvalProfile = {},
  executeInternalStep = null,
  maxTicks = 10,
} = {}) {
  const referenceWorkflow = composeGrowthControlInternalReferenceWorkflow({
    compiledPlan,
    planId,
    tenantId,
    environment,
    resourceIdsByNode,
    actionIdsByNode,
    approvalProfile,
  });
  const execution = await runGrowthControlProviderApprovalPlan({
    pool,
    planId,
    actorId,
    executeStep: internalExecutor(executeInternalStep),
    maxTicks,
  });
  if (execution.execution?.last_tick?.reason !== "completed") {
    throw workflowError(
      "growth_control_internal_reference_not_completed",
      "Internal reference workflow did not reach a completed durable readback state.",
      409,
      { reason: execution.execution?.last_tick?.reason || null },
    );
  }
  const readback = await readGrowthControlInternalReferenceWorkflow({
    pool,
    planId,
    tenantId,
    expectedPlanHashSha256: referenceWorkflow.compiledPlanHashSha256,
  });
  return {
    ok: true,
    plan_id: planId,
    execution: execution.execution,
    readback,
    provider_calls: false,
    provider_dispatch_allowed: false,
    external_writes: false,
    secrets_included: false,
  };
}

export const growthControlInternalReferenceWorkflowContract = Object.freeze({
  version: "growth-control-internal-reference-workflow-v1",
  reference_step_count: REFERENCE_STEP_COUNT,
  internal_step_types: [...INTERNAL_STEP_TYPES].sort(),
  durable_execution_authority: "durableExecutionControlService",
  durable_output_authority: "execution_plan_steps.output_json",
  provider_effect_nodes_allowed: false,
  provider_dispatch_allowed: false,
  readback_hash_required: true,
  lineage_required: true,
  secrets_included: false,
});

export const _testingGrowthControlInternalReferenceWorkflow = Object.freeze({
  assertSafeArtifact,
  boundedArtifact,
  evidenceReference,
  internalExecutor,
  defaultInternalExecutor,
  resolveUnique,
});
