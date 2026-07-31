import {
  runDurableExecution,
  tickDurableExecution,
} from "../../../durableExecutionControlService.js";
import { persistCompiledSequentialPlan } from "../../../sequentialPlanOrchestrator.js";
import { stableSha256 } from "../../domain/growthControlPlane/growthControlPlane.js";
import { composeGrowthControlProviderApprovalPlan } from "../../domain/growthControlPlane/growthControlProviderApproval.js";

function serviceError(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function parseJson(value, fallback = {}) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function resolveUnique(rows, code, message) {
  const candidates = Array.isArray(rows) ? rows : [];
  if (candidates.length === 0) return null;
  if (candidates.length > 1) throw serviceError(code, message, 409);
  return candidates[0];
}

async function withTransaction(pool, operation) {
  if (typeof pool?.getConnection !== "function") return operation(pool);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function approvalBindingFromPolicy(policy, { planId, planStepId }) {
  const requiredFields = [
    "plan_hash_sha256",
    "request_hash_sha256",
    "node_id",
    "capability_key",
    "action_ids",
    "resource_ids",
    "environment",
    "effect_class",
    "expires_in_seconds",
  ];
  if (policy?.contract_version !== "growth-control-provider-approval-v1" || policy.required !== true) {
    throw serviceError(
      "growth_control_approval_policy_mismatch",
      "The durable step does not contain a Growth Control provider-approval policy.",
      409,
      { plan_id: planId, plan_step_id: planStepId },
    );
  }
  const missing = requiredFields.filter((field) => policy[field] == null);
  if (missing.length > 0) {
    throw serviceError(
      "growth_control_approval_binding_incomplete",
      "The provider approval binding is incomplete.",
      409,
      { plan_id: planId, plan_step_id: planStepId, missing_fields: missing },
    );
  }
  const expiresInSeconds = Number(policy.expires_in_seconds);
  if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 300 || expiresInSeconds > 604800) {
    throw serviceError(
      "growth_control_approval_expiry_invalid",
      "The provider approval expiry is outside the supported bounds.",
      409,
      { plan_id: planId, plan_step_id: planStepId },
    );
  }
  const binding = {
    contract_version: policy.contract_version,
    plan_id: planId,
    plan_step_id: planStepId,
    plan_hash_sha256: policy.plan_hash_sha256,
    request_hash_sha256: policy.request_hash_sha256,
    node_id: policy.node_id,
    capability_key: policy.capability_key,
    action_ids: [...policy.action_ids].sort(),
    resource_ids: [...policy.resource_ids].sort(),
    environment: policy.environment,
    effect_class: policy.effect_class,
    checkpoint_key: policy.checkpoint_key,
    policy_key: policy.policy_key || null,
    required_role: policy.required_role,
    expires_in_seconds: expiresInSeconds,
    provider_dispatch_allowed: false,
    external_writes: false,
    secrets_included: false,
  };
  return { ...binding, binding_sha256: stableSha256(binding) };
}

function locateHold(result) {
  if (!result || typeof result !== "object") return null;
  if (result.hold_id && result.step?.plan_step_id) {
    return { holdId: result.hold_id, planStepId: result.step.plan_step_id };
  }
  const tick = result.last_tick;
  if (tick?.hold_id && tick?.step?.plan_step_id) {
    return { holdId: tick.hold_id, planStepId: tick.step.plan_step_id };
  }
  return null;
}

export async function bindGrowthControlProviderApprovalHold({
  pool,
  holdId,
  planId,
  planStepId,
  actorId = null,
} = {}) {
  if (!pool || !holdId || !planId || !planStepId) {
    throw serviceError(
      "growth_control_approval_bind_scope_required",
      "pool, holdId, planId, and planStepId are required.",
      400,
    );
  }
  return withTransaction(pool, async (connection) => {
    const [holdRows] = await connection.query(
      "SELECT * FROM approval_holds WHERE hold_id = ? LIMIT 2 FOR UPDATE",
      [holdId],
    );
    const hold = resolveUnique(
      holdRows,
      "growth_control_approval_hold_ambiguous",
      "Approval hold identity resolved to multiple rows.",
    );
    if (!hold) throw serviceError("growth_control_approval_hold_not_found", "Approval hold not found.", 404);
    if (!["open", "approved"].includes(String(hold.status))) {
      throw serviceError(
        "growth_control_approval_hold_closed",
        `Approval hold is already '${hold.status}'.`,
        409,
      );
    }

    const [stepRows] = await connection.query(
      `SELECT plan_step_id, plan_id, tenant_id, status, step_key, approval_policy_json
         FROM execution_plan_steps
        WHERE plan_step_id = ? AND plan_id = ? LIMIT 2 FOR UPDATE`,
      [planStepId, planId],
    );
    const step = resolveUnique(
      stepRows,
      "growth_control_approval_step_ambiguous",
      "Approval step identity resolved to multiple rows.",
    );
    if (!step || step.status !== "awaiting_approval") {
      throw serviceError(
        "growth_control_approval_step_mismatch",
        "The durable step is not awaiting this approval hold.",
        409,
      );
    }
    if (String(hold.run_id) !== String(planId) || String(hold.tenant_id) !== String(step.tenant_id)) {
      throw serviceError(
        "growth_control_approval_scope_mismatch",
        "Approval hold scope does not match the durable plan step.",
        409,
      );
    }

    const policy = parseJson(step.approval_policy_json, {});
    const binding = approvalBindingFromPolicy(policy, { planId, planStepId });
    const currentContext = parseJson(hold.execution_context_json, {});
    if (currentContext.source === "growth_control_provider_effect") {
      if (currentContext.binding_sha256 !== binding.binding_sha256) {
        throw serviceError(
          "growth_control_approval_binding_mismatch",
          "An existing approval hold binding does not match the current durable step policy.",
          409,
          { expected: currentContext.binding_sha256, observed: binding.binding_sha256 },
        );
      }
      return {
        ok: true,
        hold_id: holdId,
        plan_id: planId,
        plan_step_id: planStepId,
        binding_sha256: binding.binding_sha256,
        expires_at: hold.expires_at || null,
        approval_status: hold.status,
        idempotent_replay: true,
        provider_dispatch_allowed: false,
        secrets_included: false,
      };
    }
    if (
      currentContext.source !== "sequential_plan_orchestrator" ||
      String(currentContext.plan_id) !== String(planId) ||
      String(currentContext.plan_step_id) !== String(planStepId)
    ) {
      throw serviceError(
        "growth_control_approval_hold_owner_mismatch",
        "Approval hold is not owned by the expected durable execution step.",
        409,
      );
    }

    const expiresAt = new Date(Date.now() + binding.expires_in_seconds * 1000);
    const context = {
      source: "growth_control_provider_effect",
      ...binding,
      requested_actor_id: actorId || hold.requested_by || null,
    };
    const [updateResult] = await connection.query(
      `UPDATE approval_holds
          SET step_run_id = ?, requested_by = COALESCE(requested_by, ?),
              required_role = ?, expires_at = ?, execution_context_json = ?
        WHERE hold_id = ? AND status = 'open'`,
      [
        planStepId,
        actorId,
        binding.required_role,
        expiresAt,
        JSON.stringify(context),
        holdId,
      ],
    );
    if (Number(updateResult?.affectedRows || 0) !== 1) {
      throw serviceError(
        "growth_control_approval_bind_race",
        "Approval hold changed before its binding could be persisted.",
        409,
      );
    }

    const [readbackRows] = await connection.query(
      `SELECT hold_id, run_id, step_run_id, tenant_id, status, required_role,
              expires_at, execution_context_json
         FROM approval_holds WHERE hold_id = ? LIMIT 2`,
      [holdId],
    );
    const readback = resolveUnique(
      readbackRows,
      "growth_control_approval_readback_ambiguous",
      "Approval hold readback resolved to multiple rows.",
    );
    const readbackContext = parseJson(readback?.execution_context_json, {});
    if (
      !readback ||
      String(readback.step_run_id) !== String(planStepId) ||
      readbackContext.binding_sha256 !== binding.binding_sha256
    ) {
      throw serviceError(
        "growth_control_approval_readback_failed",
        "Approval hold binding readback failed.",
        500,
      );
    }
    return {
      ok: true,
      hold_id: holdId,
      plan_id: planId,
      plan_step_id: planStepId,
      binding_sha256: binding.binding_sha256,
      request_hash_sha256: binding.request_hash_sha256,
      plan_hash_sha256: binding.plan_hash_sha256,
      action_ids: binding.action_ids,
      resource_ids: binding.resource_ids,
      environment: binding.environment,
      effect_class: binding.effect_class,
      expires_at: readback.expires_at,
      approval_status: readback.status,
      idempotent_replay: false,
      provider_dispatch_allowed: false,
      secrets_included: false,
    };
  });
}

export async function persistGrowthControlProviderApprovalPlan({
  pool,
  planId,
  tenantId,
  compiledPlan,
  actorId = null,
  environment = "development",
  resourceIdsByNode = {},
  actionIdsByNode = {},
  approvalProfile = {},
} = {}) {
  const approvalPlan = composeGrowthControlProviderApprovalPlan({
    compiledPlan,
    planId,
    tenantId,
    environment,
    resourceIdsByNode,
    actionIdsByNode,
    approvalProfile,
  });
  const persisted = await persistCompiledSequentialPlan({
    pool,
    planId: approvalPlan.planId,
    tenantId: approvalPlan.tenantId,
    steps: approvalPlan.sequentialSteps,
    actorId,
  });
  return {
    ok: true,
    approval_plan_hash_sha256: approvalPlan.canonicalHashSha256,
    compiled_plan_hash_sha256: approvalPlan.compiledPlanHashSha256,
    provider_effect_node_count: approvalPlan.providerEffectNodeCount,
    approval_bindings: approvalPlan.approvalBindings,
    durable_plan: persisted,
    provider_calls: false,
    provider_dispatch_allowed: false,
    external_writes: false,
    secrets_included: false,
  };
}

async function bindExecutionResult({ pool, planId, actorId, execution }) {
  const located = locateHold(execution);
  if (!located) return { execution, approval_hold: null };
  const approvalHold = await bindGrowthControlProviderApprovalHold({
    pool,
    holdId: located.holdId,
    planId,
    planStepId: located.planStepId,
    actorId,
  });
  return { execution, approval_hold: approvalHold };
}

export async function tickGrowthControlProviderApprovalPlan({
  pool,
  planId,
  actorId = null,
  executeStep = null,
  ...options
} = {}) {
  const execution = await tickDurableExecution({ pool, planId, actorId, executeStep, ...options });
  const result = await bindExecutionResult({ pool, planId, actorId, execution });
  return {
    ok: execution.ok !== false,
    plan_id: planId,
    ...result,
    provider_dispatch_before_approval: false,
    secrets_included: false,
  };
}

export async function runGrowthControlProviderApprovalPlan({
  pool,
  planId,
  actorId = null,
  executeStep = null,
  ...options
} = {}) {
  const execution = await runDurableExecution({ pool, planId, actorId, executeStep, ...options });
  const result = await bindExecutionResult({ pool, planId, actorId, execution });
  return {
    ok: execution.ok !== false,
    plan_id: planId,
    ...result,
    provider_dispatch_before_approval: false,
    secrets_included: false,
  };
}

export const growthControlProviderApprovalServiceContract = Object.freeze({
  version: "growth-control-provider-approval-service-v1",
  durable_execution_authority: "durableExecutionControlService",
  approval_hold_authority: "approval_holds",
  approval_decision_authority: "decideSequentialPlanApproval",
  binding_readback_required: true,
  mismatch_fails_closed: true,
  provider_dispatch_before_approval: false,
  secrets_included: false,
});

export const _testingGrowthControlProviderApprovalService = Object.freeze({
  parseJson,
  stableStringify,
  resolveUnique,
  approvalBindingFromPolicy,
  locateHold,
});
