import { randomUUID } from "node:crypto";
import {
  buildModeChoicePlan,
  persistModeChoiceSelection,
} from "./modeChoiceGovernanceService.js";
import {
  HOSTINGER_SSH_PROBE_RUNNER_MODES,
  describeHostingerSshProbeRunnerMode,
  normalizeHostingerSshProbeRunnerMode,
} from "./hostingerSshProbeRunnerModes.js";

export const HOSTINGER_SSH_PROBE_JOB_TYPE = "hostinger_ssh_target_probe";
export const HOSTINGER_SSH_PROBE_MODE_CHOICE_SURFACE = "remote_runtime_hostinger_ssh_probe_runner";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function compact(value, max = 191) {
  const text = String(value ?? "").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function boundaryError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function nestedRequestPayload(body = {}) {
  const nested = asObject(body.request_payload);
  return Object.keys(nested).length ? nested : body;
}

function explicitRunnerMode(payload = {}) {
  const raw = compact(
    payload.runner_mode
      || payload.runnerMode
      || payload.execution_mode
      || payload.executionMode,
    64,
  );
  return raw ? normalizeHostingerSshProbeRunnerMode(raw) : null;
}

function trustedMandatedRunnerMode(context = {}) {
  const raw = compact(
    context.policy_mandated_runner_mode
      || context.policyMandatedRunnerMode
      || context.mandated_runner_mode
      || context.mandatedRunnerMode,
    64,
  );
  return raw ? normalizeHostingerSshProbeRunnerMode(raw) : null;
}

function explicitFallbackMode(payload = {}) {
  const raw = compact(
    payload.fallback_from_mode
      || payload.fallbackFromMode
      || payload.failed_runner_mode
      || payload.failedRunnerMode,
    64,
  );
  return raw ? normalizeHostingerSshProbeRunnerMode(raw) : null;
}

function modeOption(modeKey) {
  const description = describeHostingerSshProbeRunnerMode(modeKey);
  const contracts = {
    [HOSTINGER_SSH_PROBE_RUNNER_MODES.QUEUE_WORKER]: {
      label: "Queue worker",
      risk_class: "low",
      side_effect_class: "bullmq_queue_dispatch",
      expected_evidence: [
        "durable_job_record",
        "bullmq_enqueue_result",
        "terminal_job_result",
      ],
      recommended: true,
    },
    [HOSTINGER_SSH_PROBE_RUNNER_MODES.DETACHED_PROCESS]: {
      label: "Detached local process",
      risk_class: "medium",
      side_effect_class: "local_process_spawn",
      expected_evidence: [
        "durable_job_record",
        "detached_process_pid",
        "terminal_job_result",
      ],
      recommended: false,
    },
    [HOSTINGER_SSH_PROBE_RUNNER_MODES.CRON_WORKER]: {
      label: "Cron worker",
      risk_class: "medium",
      side_effect_class: "scheduled_worker_claim",
      expected_evidence: [
        "durable_job_record",
        "cron_worker_claim",
        "terminal_job_result",
      ],
      recommended: false,
    },
    [HOSTINGER_SSH_PROBE_RUNNER_MODES.EXTERNAL_RUNNER]: {
      label: "External dedicated runner",
      risk_class: "high",
      side_effect_class: "external_runner_claim",
      expected_evidence: [
        "durable_job_record",
        "external_runner_claim",
        "terminal_job_result",
      ],
      recommended: false,
    },
  };
  const contract = contracts[modeKey];
  return {
    mode_key: modeKey,
    label: contract.label,
    description: description.behavior,
    risk_class: contract.risk_class,
    side_effect_class: contract.side_effect_class,
    expected_evidence: contract.expected_evidence,
    scope: {
      scope_type: "execution_surface",
      scope_ref: description.execution_surface,
    },
    recommended: contract.recommended,
  };
}

export function hostingerSshProbeRunnerModeOptions() {
  return Object.values(HOSTINGER_SSH_PROBE_RUNNER_MODES).map(modeOption);
}

export function buildHostingerSshProbeModeChoice(body = {}, { mandatedMode = null } = {}) {
  const requestBody = asObject(body);
  const jobType = compact(requestBody.job_type || requestBody.jobType || "http_execute", 128);
  if (jobType !== HOSTINGER_SSH_PROBE_JOB_TYPE) {
    return {
      applies: false,
      request_body: requestBody,
      request_payload: nestedRequestPayload(requestBody),
      plan: null,
      secrets_included: false,
    };
  }

  const payload = nestedRequestPayload(requestBody);
  const targetId = compact(payload.target_id || payload.targetId, 191);
  if (!targetId) {
    throw boundaryError(
      400,
      "mode_choice_target_required",
      "target_id is required before Hostinger SSH probe runner modes can be selected.",
    );
  }

  const plan = buildModeChoicePlan({
    surfaceKey: HOSTINGER_SSH_PROBE_MODE_CHOICE_SURFACE,
    targetScope: {
      scope_type: "remote_runtime_target",
      scope_ref: targetId,
      tenant_id: compact(payload.tenant_id || payload.tenantId, 64) || null,
      resource_type: "hostinger_ssh_target_probe",
      resource_id: targetId,
    },
    modes: hostingerSshProbeRunnerModeOptions(),
    recommendedMode: HOSTINGER_SSH_PROBE_RUNNER_MODES.QUEUE_WORKER,
    selectedMode: explicitRunnerMode(payload),
    mandatedMode,
    fallbackFromMode: explicitFallbackMode(payload),
  });

  return {
    applies: true,
    request_body: requestBody,
    request_payload: payload,
    plan,
    secrets_included: false,
  };
}

function requestBodyWithTraceAndMode(body, plan) {
  const requestBody = { ...asObject(body) };
  const hasNestedPayload = Object.keys(asObject(requestBody.request_payload)).length > 0;
  const currentPayload = { ...nestedRequestPayload(requestBody) };
  const traceId = compact(
    currentPayload.execution_trace_id
      || requestBody.execution_trace_id
      || `hostinger_ssh_probe_${randomUUID()}`,
    191,
  );
  const nextPayload = {
    ...currentPayload,
    execution_trace_id: traceId,
    runner_mode: plan.selected_mode,
    runner_mode_selection_source: plan.selection_source,
    runner_mode_choice_id: plan.choice_id,
    runner_mode_policy_key: plan.policy_key,
    secrets_included: false,
  };

  if (hasNestedPayload) {
    return {
      request_body: {
        ...requestBody,
        execution_trace_id: traceId,
        request_payload: nextPayload,
      },
      request_payload: nextPayload,
      trace_id: traceId,
    };
  }

  return {
    request_body: {
      ...requestBody,
      ...nextPayload,
      execution_trace_id: traceId,
    },
    request_payload: nextPayload,
    trace_id: traceId,
  };
}

function structuredFailure(error, fallbackCode, fallbackStatus) {
  return {
    proceed: false,
    status: Number(error?.status) || fallbackStatus,
    body: {
      ok: false,
      error: {
        code: error?.code || fallbackCode,
        message: error?.message || "Mode-choice governance failed.",
        details: error?.details || null,
      },
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export async function governHostingerSshProbeJobSubmission({
  body = {},
  requestedBy = null,
  idempotencyKey = null,
  requestContext = {},
  persistSelection = persistModeChoiceSelection,
  skipSurfaceAuthority = false,
} = {}) {
  const context = asObject(requestContext);
  let decision;
  try {
    decision = buildHostingerSshProbeModeChoice(body, {
      mandatedMode: trustedMandatedRunnerMode(context),
    });
  } catch (error) {
    return structuredFailure(error, "mode_choice_plan_failed", 400);
  }

  if (!decision.applies) {
    return {
      proceed: true,
      request_body: decision.request_body,
      mode_choice: null,
      evidence: null,
      secrets_included: false,
    };
  }

  const { plan } = decision;
  if (plan.mode_choice_required || !plan.execution_allowed) {
    return {
      proceed: false,
      status: 409,
      body: {
        ok: false,
        error: {
          code: "mode_choice_required",
          message: "Choose a Hostinger SSH probe runner mode before job creation or dispatch.",
          details: {
            surface_key: plan.surface_key,
            target_scope: plan.target_scope,
            valid_modes: plan.mode_choices_presented,
            recommended_mode: plan.recommended_mode,
            fallback_from_mode: plan.fallback_from_mode,
          },
        },
        mode_choice: plan,
        job_created: false,
        dispatch_attempted: false,
        secrets_included: false,
      },
      mode_choice: plan,
      evidence: null,
      secrets_included: false,
    };
  }

  const traced = requestBodyWithTraceAndMode(decision.request_body, plan);
  let evidence;
  try {
    evidence = await persistSelection({
      plan,
      traceId: traced.trace_id,
      tenantId: compact(
        context.tenant_id
          || context.tenantId
          || traced.request_payload.tenant_id
          || traced.request_payload.tenantId,
        64,
      ) || null,
      workspaceId: compact(context.workspace_id || context.workspaceId, 64) || null,
      userId: compact(
        context.user_id
          || context.userId
          || traced.request_payload.user_id
          || traced.request_payload.userId,
        64,
      ) || null,
      actorId: compact(context.actor_id || context.actorId || requestedBy, 64) || null,
      actorType: compact(context.actor_type || context.actorType || "backend_api", 64),
      brandKey: compact(context.brand_key || context.brandKey, 128) || null,
      requestId: compact(context.request_id || context.requestId, 128) || null,
      sessionId: compact(context.session_id || context.sessionId, 128) || null,
      conversationId: compact(context.conversation_id || context.conversationId, 128) || null,
      correlationId: compact(context.correlation_id || context.correlationId || traced.trace_id, 191),
      idempotencyKey: compact(idempotencyKey, 191) || `mode-choice:${plan.choice_id}`,
      skipSurfaceAuthority,
    });
  } catch (error) {
    return structuredFailure(error, "mode_choice_evidence_write_failed", 503);
  }

  return {
    proceed: true,
    request_body: traced.request_body,
    request_payload: traced.request_payload,
    mode_choice: plan,
    evidence,
    trace_id: traced.trace_id,
    secrets_included: false,
  };
}

export function attachModeChoiceSubmissionEvidence(responseBody, governance) {
  const body = asObject(responseBody);
  if (!governance?.mode_choice || !governance?.evidence) return body;
  return {
    ...body,
    execution_trace_id: body.execution_trace_id || governance.trace_id || null,
    mode_choice: {
      choice_id: governance.mode_choice.choice_id,
      policy_key: governance.mode_choice.policy_key,
      surface_key: governance.mode_choice.surface_key,
      selected_mode: governance.mode_choice.selected_mode,
      selection_source: governance.mode_choice.selection_source,
      recommended_mode: governance.mode_choice.recommended_mode,
      mode_default_used: false,
      evidence_recorded: governance.evidence.evidence_recorded === true,
      execution_log_id: governance.evidence.execution_log_id || null,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export const _testingHostingerSshProbeModeChoiceBoundary = Object.freeze({
  nestedRequestPayload,
  explicitRunnerMode,
  trustedMandatedRunnerMode,
  explicitFallbackMode,
  requestBodyWithTraceAndMode,
});
