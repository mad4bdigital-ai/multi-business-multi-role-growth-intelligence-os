import {
  extractCapabilityEnvelopeId,
  resolveCapabilityExecutionEnvelope,
  transitionCapabilityEnvelopeLifecycle,
} from "./capabilityResolutionEnvelopeGuard.js";
import { getOperationContract } from "./operationContractRegistry.js";
import { createCapabilityResolutionEnvelopeLedger } from "./scripts/capability-resolution-envelope-create.mjs";

const REPOSITORY_MUTATION_OPERATIONS = new Set([
  "repo.change.execute",
  "repo.branch.reconcile",
  "repo.pr.finalize",
  "operation.resume",
]);

function compact(value, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function lifecycleError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function operationRequiresCapability(operationKey) {
  if (REPOSITORY_MUTATION_OPERATIONS.has(operationKey)) return true;
  try {
    return getOperationContract(operationKey).execution_class === "mutation";
  } catch {
    return false;
  }
}

function repositoryResourceUri(input = {}) {
  const explicit = compact(input.resource_uri || input.resourceUri, 512);
  if (explicit) return explicit;
  const owner = compact(input.owner, 191);
  const repo = compact(input.repo, 191);
  return owner && repo ? `github://${owner}/${repo}` : "";
}

function renewalProfile(operationKey, input = {}) {
  if (REPOSITORY_MUTATION_OPERATIONS.has(operationKey)) {
    return {
      app_key: "platform_orchestration",
      capability_key: "repository_automation_run",
      operation_intent: "repository_automation_run",
      runtime_surface: "repository_automation_control_plane",
      requested_source_tier: "managed",
    };
  }
  return {
    app_key: compact(input.app_key || input.appKey, 128),
    capability_key: compact(input.capability_key || input.capabilityKey || operationKey, 191),
    operation_intent: compact(input.operation_intent || input.operationIntent || operationKey, 128),
    runtime_surface: compact(input.runtime_surface || input.runtimeSurface, 191),
    requested_source_tier: compact(input.requested_source_tier || input.requestedSourceTier || "managed", 96),
  };
}

function pushArg(args, key, value) {
  const text = compact(value, key === "--resource-uri" ? 512 : 191);
  if (text) args.push(key, text);
}

export function buildCapabilityRenewalRequest({
  auth = {},
  input = {},
  operationKey = "",
  requestedBy = "",
  ttlMinutes = 60,
} = {}) {
  const profile = renewalProfile(operationKey, input);
  const passthrough = [];
  pushArg(passthrough, "--tenant-id", auth.tenant_id);
  pushArg(passthrough, "--user-id", auth.user_id || auth.admin_id);
  pushArg(passthrough, "--workspace-id", input.workspace_id || input.workspaceId);
  pushArg(passthrough, "--workspace-key", input.workspace_key || input.workspaceKey);
  pushArg(passthrough, "--brand-key", input.brand_key || input.brandKey);
  pushArg(passthrough, "--business-activity-type", input.business_activity_type || input.businessActivityType);
  pushArg(passthrough, "--app-key", profile.app_key);
  pushArg(passthrough, "--capability-key", profile.capability_key);
  pushArg(passthrough, "--operation-intent", profile.operation_intent);
  pushArg(passthrough, "--runtime-surface", profile.runtime_surface);
  pushArg(passthrough, "--requested-source-tier", profile.requested_source_tier);
  pushArg(passthrough, "--resource-uri", repositoryResourceUri(input));
  pushArg(passthrough, "--recipe-key", input.recipe_key || input.recipeKey);
  pushArg(passthrough, "--expected-commit-sha", input.expected_commit_sha || input.expectedCommitSha);
  return {
    requestedBy: compact(requestedBy || auth.user_id || auth.admin_id || "operation_orchestrator", 191),
    ttlMinutes: Math.max(5, Math.min(Number(ttlMinutes || 60), 1440)),
    passthrough,
  };
}

function renewalAllowed(input = {}) {
  return input.automatic_capability_renewal !== false
    && input.automaticCapabilityRenewal !== false;
}

function protectedFinalizationRequiresExplicitEnvelope(operationKey, input = {}) {
  if (operationKey === "repo.pr.finalize") return true;
  if (operationKey === "operation.resume") return true;
  if (operationKey !== "repo.change.execute") return false;
  const automationKey = compact(
    input.automation_key || input.automationKey || input.recipe_key || input.recipeKey || "pr_delivery",
    64,
  ).toLowerCase();
  return ["pr_delivery", "full_workstream"].includes(automationKey);
}

function publicFailure(failure = {}) {
  return {
    status: failure.status || "capability_resolution_envelope_rejected",
    envelope_id: failure.envelope_id || null,
    envelope_status: failure.envelope_status || null,
    decision: failure.decision || null,
    blocking_gap_count: Number(failure.blocking_gap_count || 0),
    secrets_included: false,
  };
}

export async function prepareOperationCapabilityLifecycle({
  pool,
  auth = {},
  input = {},
  operationKey = "",
  resolveEnvelope = resolveCapabilityExecutionEnvelope,
  transitionEnvelope = transitionCapabilityEnvelopeLifecycle,
  createEnvelope = createCapabilityResolutionEnvelopeLedger,
} = {}) {
  if (!operationRequiresCapability(operationKey)) {
    return {
      required: false,
      status: "not_required",
      operation_key: operationKey || null,
      input,
      secrets_included: false,
    };
  }

  const existingEnvelopeId = extractCapabilityEnvelopeId(input);
  if (existingEnvelopeId) {
    const resolved = await resolveEnvelope({
      pool,
      envelopeId: existingEnvelopeId,
      source: input,
      expectedTenantId: compact(auth.tenant_id, 64),
      expectedUserId: compact(auth.user_id || auth.admin_id, 64),
      requireReadyForDispatch: true,
      requireDispatchAllowed: true,
      requireNoApprovalRequired: true,
      requireNoBlockingGaps: true,
      requireNoSecrets: true,
    });
    if (resolved.ok) {
      return {
        required: true,
        status: "ready",
        source: "existing",
        operation_key: operationKey,
        envelope_id: resolved.envelope_id,
        input,
        secrets_included: false,
      };
    }
    if (resolved.status === "capability_resolution_envelope_expired") {
      await transitionEnvelope({
        pool,
        envelopeId: existingEnvelopeId,
        action: "expire",
        reason: "expired_before_operation_dispatch",
      });
    } else if (![
      "capability_resolution_envelope_not_found",
      "capability_resolution_envelope_expired",
    ].includes(resolved.status)) {
      throw lifecycleError(
        403,
        "OPERATION_CAPABILITY_ENVELOPE_REJECTED",
        "The supplied capability envelope does not authorize this operation.",
        publicFailure(resolved),
      );
    }
  }

  if (protectedFinalizationRequiresExplicitEnvelope(operationKey, input)) {
    throw lifecycleError(
      409,
      "OPERATION_CAPABILITY_ENVELOPE_REQUIRED",
      "Protected pull-request finalization requires a separately issued capability envelope; automatic renewal is disabled.",
      {
        operation_key: operationKey,
        previous_envelope_id: existingEnvelopeId || null,
        automatic_renewal_enabled: false,
        next_action: "supply_explicit_approved_capability_envelope",
        secrets_included: false,
      },
    );
  }

  if (!renewalAllowed(input)) {
    throw lifecycleError(
      409,
      "OPERATION_CAPABILITY_RENEWAL_REQUIRED",
      "A fresh operation-scoped capability envelope is required.",
      {
        operation_key: operationKey,
        previous_envelope_id: existingEnvelopeId || null,
        automatic_renewal_enabled: false,
        next_action: "request_fresh_capability_envelope",
        secrets_included: false,
      },
    );
  }

  const renewalRequest = buildCapabilityRenewalRequest({
    auth,
    input,
    operationKey,
    ttlMinutes: input.capability_ttl_minutes || input.capabilityTtlMinutes || 60,
  });
  const renewed = await createEnvelope(renewalRequest);
  const renewalProjection = {
    envelope_id: renewed?.envelope_id || null,
    envelope_status: renewed?.envelope_status || null,
    decision: renewed?.decision || null,
    dispatch_allowed: renewed?.dispatch_allowed === true,
    approval_required: renewed?.approval_required === true,
    blocking_gap_count: Number(renewed?.blocking_gap_count || 0),
    expires_in_minutes: Number(renewed?.expires_in_minutes || renewalRequest.ttlMinutes),
    secrets_included: false,
  };

  if (
    renewed?.ok === true
    && renewed?.envelope_status === "ready_for_dispatch"
    && renewed?.dispatch_allowed === true
    && renewed?.approval_required !== true
    && Number(renewed?.blocking_gap_count || 0) === 0
  ) {
    return {
      required: true,
      status: "renewed_ready",
      source: existingEnvelopeId ? "expired_replacement" : "just_in_time",
      operation_key: operationKey,
      previous_envelope_id: existingEnvelopeId || null,
      envelope_id: renewed.envelope_id,
      input: { ...input, capability_envelope_id: renewed.envelope_id },
      renewal: renewalProjection,
      secrets_included: false,
    };
  }

  throw lifecycleError(
    409,
    renewed?.approval_required === true
      ? "OPERATION_CAPABILITY_RENEWAL_REQUIRES_APPROVAL"
      : "OPERATION_CAPABILITY_RENEWAL_NOT_READY",
    renewed?.approval_required === true
      ? "A fresh capability envelope was created and requires approval before execution."
      : "A fresh capability envelope could not reach dispatch-ready state.",
    {
      operation_key: operationKey,
      previous_envelope_id: existingEnvelopeId || null,
      renewal: renewalProjection,
      next_action: renewed?.approval_required === true
        ? "approve_fresh_capability_envelope"
        : "resolve_capability_blocking_gaps",
      secrets_included: false,
    },
  );
}

export async function finalizeOperationCapabilityLifecycle({
  pool,
  lifecycle = {},
  result = {},
  transitionEnvelope = transitionCapabilityEnvelopeLifecycle,
} = {}) {
  if (lifecycle?.required !== true || !lifecycle?.envelope_id) {
    return {
      required: lifecycle?.required === true,
      status: lifecycle?.status || "not_required",
      envelope_id: lifecycle?.envelope_id || null,
      secrets_included: false,
    };
  }

  if (
    result?.ok === false
    || result?.status === "awaiting_input"
    || result?.status === "blocked"
  ) {
    return {
      required: true,
      status: "retained_for_bounded_retry",
      envelope_id: lifecycle.envelope_id,
      source: lifecycle.source || null,
      secrets_included: false,
    };
  }

  const executionRef = compact(
    result?.run_id
      ? `operation_run:${result.run_id}`
      : result?.operation_id
        ? `operation:${result.operation_id}`
        : `operation:${lifecycle.operation_key || "mutation"}`,
    191,
  );
  const transition = await transitionEnvelope({
    pool,
    envelopeId: lifecycle.envelope_id,
    action: "consume",
    executionRef,
    reason: "operation_completed_successfully",
  });
  if (transition?.ok !== true) {
    throw lifecycleError(
      409,
      "OPERATION_CAPABILITY_CONSUME_FAILED",
      "The operation completed but its capability envelope could not be consumed.",
      {
        envelope_id: lifecycle.envelope_id,
        transition: publicFailure(transition),
        readback_required: true,
        secrets_included: false,
      },
    );
  }
  return {
    required: true,
    status: "consumed",
    envelope_id: lifecycle.envelope_id,
    source: lifecycle.source || null,
    transition_status: transition.status || null,
    secrets_included: false,
  };
}

export const _testingOperationCapabilityLifecycleService = {
  operationRequiresCapability,
  repositoryResourceUri,
  renewalProfile,
  renewalAllowed,
  protectedFinalizationRequiresExplicitEnvelope,
  publicFailure,
};
