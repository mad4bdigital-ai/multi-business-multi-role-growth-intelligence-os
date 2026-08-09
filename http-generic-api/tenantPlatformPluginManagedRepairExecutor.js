import { createHash } from "node:crypto";
import {
  buildTenantPlatformPluginEligibility,
  TenantPlatformPluginManagedRepairContract,
} from "./tenantPlatformPluginEligibility.js";

const DRY_RUN_REPAIR_OPERATIONS = new Set([
  "certify_platform_plugin_operation",
]);

function executorError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function requiredContextValue(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw executorError(
      403,
      `tenant_managed_repair_${field}_context_required`,
      `${field} must come from the authenticated execution context.`,
    );
  }
  return normalized;
}

function requiredInputValue(value, field, max = 191) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw executorError(400, `tenant_managed_repair_${field}_required`, `${field} is required.`);
  }
  if (normalized.length > max) {
    throw executorError(400, `tenant_managed_repair_${field}_too_long`, `${field} exceeds ${max} characters.`);
  }
  return normalized;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(stableObject(value))).digest("hex");
}

function resolveAuthenticatedPrincipal(authContext = {}) {
  if (String(authContext.mode || "").trim() !== "user_jwt" || authContext.is_admin === true) {
    throw executorError(
      403,
      "tenant_managed_repair_user_jwt_required",
      "Tenant managed repair dry-run requires an authenticated User-JWT principal.",
    );
  }

  return Object.freeze({
    tenant_id: requiredContextValue(authContext.tenant_id, "tenant_id"),
    user_id: requiredContextValue(authContext.user_id, "user_id"),
    workspace_id: requiredContextValue(authContext.workspace_id, "workspace_id"),
    tenant_role: String(authContext.tenant_role || "").trim() || null,
    source: String(authContext.source || "authenticated_user_jwt_context").trim(),
  });
}

function canonicalAffectedOperation(eligibility = {}) {
  const candidate = eligibility.managed_repair?.affected_operation || null;
  const pluginKey = String(candidate?.plugin_key || "").trim();
  const selectorType = String(candidate?.selector?.type || "").trim();
  const selectorValue = String(candidate?.selector?.value || "").trim();
  const identitySha256 = String(candidate?.identity_sha256 || "").trim();
  if (!pluginKey || !["action_key", "tool_key"].includes(selectorType) || !selectorValue || !/^[0-9a-f]{64}$/.test(identitySha256)) {
    throw executorError(
      409,
      "tenant_managed_repair_canonical_identity_required",
      "Managed repair dry-run requires a resolver-bound canonical plugin operation identity.",
    );
  }
  return Object.freeze({
    plugin_key: pluginKey,
    selector: Object.freeze({ type: selectorType, value: selectorValue }),
    identity_sha256: identitySha256,
    blocker_codes: Object.freeze([...(candidate.blocker_codes || [])]),
  });
}

function assertDryRunRepairOperations(eligibility = {}) {
  const operations = Array.isArray(eligibility.managed_repair?.repair_operations)
    ? eligibility.managed_repair.repair_operations
    : [];
  if (!operations.length || operations.some((operation) => !DRY_RUN_REPAIR_OPERATIONS.has(String(operation)))) {
    throw executorError(
      409,
      "tenant_managed_repair_operation_not_dry_run_allowlisted",
      "The current blocker set is not eligible for the tenant managed repair dry-run executor.",
      { repair_operations: operations },
    );
  }
  return Object.freeze([...new Set(operations.map((operation) => String(operation)))].sort());
}

function buildPreviewFingerprint({ principal, affectedOperation, repairOperations }) {
  return createHash("sha256").update(JSON.stringify({
    tenant_id: principal.tenant_id,
    user_id: principal.user_id,
    workspace_id: principal.workspace_id,
    operation_identity_sha256: affectedOperation.identity_sha256,
    repair_operations: repairOperations,
    execution_mode: "dry_run",
  })).digest("hex");
}

function buildManagedExecutionBinding({
  principal,
  affectedOperation,
  repairOperations,
  previewFingerprintSha256,
  parentTicketId,
  requestId = null,
  correlationId = null,
}) {
  const parentTicket = requiredInputValue(parentTicketId, "parent_ticket_id", 64);
  const resourceRef = `platform_plugin_operation:${affectedOperation.identity_sha256}`;
  const idempotencyPayload = {
    contract: TenantPlatformPluginManagedRepairContract.schema_version,
    tenant_id: principal.tenant_id,
    user_id: principal.user_id,
    workspace_id: principal.workspace_id,
    parent_ticket_id: parentTicket,
    operation_identity_sha256: affectedOperation.identity_sha256,
    repair_operations: repairOperations,
    execution_mode: "dry_run",
  };
  const idempotencyKey = `tenant-platform-plugin-managed-repair:${sha256Json(idempotencyPayload)}`;
  const managedExecutionInput = {
    tenant_id: principal.tenant_id,
    user_id: principal.user_id,
    parent_ticket_id: parentTicket,
    workflow_key: TenantPlatformPluginManagedRepairContract.workflow_key,
    capability_key: TenantPlatformPluginManagedRepairContract.capability_key,
    resource_type: TenantPlatformPluginManagedRepairContract.resource_type,
    resource_ref: resourceRef,
    effect_class: TenantPlatformPluginManagedRepairContract.effect_class,
    idempotency_key: idempotencyKey,
    workspace_id: principal.workspace_id,
    request_id: String(requestId || "").trim() || idempotencyKey,
    correlation_id: String(correlationId || requestId || "").trim() || idempotencyKey,
    service_mode: "managed",
    task_title: `Managed dry-run repair: ${affectedOperation.plugin_key}/${affectedOperation.selector.value}`,
    input_json: {
      execution_mode: "dry_run",
      apply_allowed: false,
      affected_operation: {
        plugin_key: affectedOperation.plugin_key,
        selector: {
          type: affectedOperation.selector.type,
          value: affectedOperation.selector.value,
        },
        identity_sha256: affectedOperation.identity_sha256,
      },
      repair_operations: [...repairOperations],
      preview_fingerprint_sha256: previewFingerprintSha256,
      readback_route: TenantPlatformPluginManagedRepairContract.readback_route,
      workspace_id: principal.workspace_id,
      secrets_included: false,
    },
  };
  return Object.freeze({
    schema_version: "tenant_platform_plugin_managed_repair_managed_execution_binding.v1",
    internal_service: "createManagedExecutionRun",
    direct_http_route_allowed: false,
    execution_mode: "dry_run",
    run_creation_allowed: false,
    activation_status: "source_bound_activation_not_certified",
    activation_requirements: Object.freeze([
      "migration_1052_applied_and_read_back",
      "dedicated_executor_registered",
      "capability_runtime_certified",
      "capability_dispatch_allowed",
      "capability_specific_dry_run_enforcement",
      "managed_execution_dry_run_authority_contract_certified",
    ]),
    managed_execution_input: Object.freeze(managedExecutionInput),
    managed_execution_input_hash: sha256Json(managedExecutionInput),
    idempotency_key_sha256: sha256Json(idempotencyKey),
    resource_identity: Object.freeze({
      resource_type: TenantPlatformPluginManagedRepairContract.resource_type,
      resource_ref: resourceRef,
      operation_identity_sha256: affectedOperation.identity_sha256,
      authority_or_grant_created: false,
    }),
    run_created: false,
    mutation_executed: false,
    secrets_included: false,
  });
}

export function previewTenantPlatformPluginManagedRepair({
  authContext = {},
  resolverResult = {},
  requestId = null,
  correlationId = null,
} = {}) {
  const principal = resolveAuthenticatedPrincipal(authContext);
  const eligibility = buildTenantPlatformPluginEligibility(resolverResult);
  const affectedOperation = canonicalAffectedOperation(eligibility);
  const repairOperations = assertDryRunRepairOperations(eligibility);
  const previewFingerprintSha256 = buildPreviewFingerprint({
    principal,
    affectedOperation,
    repairOperations,
  });

  return Object.freeze({
    ok: true,
    schema_version: "tenant_platform_plugin_managed_repair_dry_run.v1",
    workflow_key: TenantPlatformPluginManagedRepairContract.workflow_key,
    capability_key: TenantPlatformPluginManagedRepairContract.capability_key,
    execution_mode: "dry_run",
    source_executor_implemented: true,
    executor_registered: false,
    activation_status: "source_only_unregistered",
    apply_allowed: false,
    dispatch_apply_allowed: false,
    principal,
    affected_operation: affectedOperation,
    repair_operations: repairOperations,
    preview_fingerprint_sha256: previewFingerprintSha256,
    request_id: String(requestId || "").trim() || null,
    correlation_id: String(correlationId || requestId || "").trim() || null,
    managed_execution: Object.freeze({
      internal_service: "createManagedExecutionRun",
      run_created: false,
      reason: "migration_1052_application_and_capability_certification_required",
    }),
    readback: Object.freeze({
      route: TenantPlatformPluginManagedRepairContract.readback_route,
      workspace_id: principal.workspace_id,
      operation_identity_sha256: affectedOperation.identity_sha256,
      required: true,
      executed: false,
    }),
    safety: Object.freeze({
      authority_or_credential_created: false,
      migration_applied: false,
      provider_call_executed: false,
      external_write_executed: false,
      production_mutation_executed: false,
      managed_execution_run_created: false,
      secrets_included: false,
    }),
    mutation_executed: false,
    secrets_included: false,
  });
}

export function bindTenantPlatformPluginManagedRepairToManagedExecution({
  authContext = {},
  resolverResult = {},
  parentTicketId,
  requestId = null,
  correlationId = null,
} = {}) {
  const preview = previewTenantPlatformPluginManagedRepair({
    authContext,
    resolverResult,
    requestId,
    correlationId,
  });
  return Object.freeze({
    ...preview,
    managed_execution: buildManagedExecutionBinding({
      principal: preview.principal,
      affectedOperation: preview.affected_operation,
      repairOperations: preview.repair_operations,
      previewFingerprintSha256: preview.preview_fingerprint_sha256,
      parentTicketId,
      requestId,
      correlationId,
    }),
    safety: Object.freeze({
      ...preview.safety,
      managed_execution_run_created: false,
    }),
    mutation_executed: false,
    secrets_included: false,
  });
}

export const _testingTenantPlatformPluginManagedRepairExecutor = {
  resolveAuthenticatedPrincipal,
  canonicalAffectedOperation,
  assertDryRunRepairOperations,
  buildPreviewFingerprint,
  buildManagedExecutionBinding,
  sha256Json,
};
