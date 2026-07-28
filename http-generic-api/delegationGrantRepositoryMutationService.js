import { createHash } from "node:crypto";
import {
  DELEGATION_GRANT_SCHEMA_VERSION,
  MUTATION_RECEIPT_SCHEMA_VERSION,
} from "./delegationGrantLifecycleShadowService.js";

export const DELEGATION_GRANT_REPOSITORY_MUTATION_CONTRACT_VERSION =
  "spec011-delegation-grant-repository-mutation-v1";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ACTIONS = new Set(["create", "revoke", "expire"]);
const TRANSACTION_METHODS = [
  "findReceiptByIdempotencyKey",
  "insertPendingReceipt",
  "applyCreateGrant",
  "applyGrantTransition",
  "inspectGrant",
  "finalizeReceipt",
  "inspectReceipt",
  "commit",
  "rollback",
];

function repositoryMutationError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function compact(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function lower(value, max = 191) {
  return compact(value, max).toLowerCase();
}

function normalizeUuid(value, field) {
  const normalized = lower(value, 64);
  if (!UUID_PATTERN.test(normalized)) {
    throw repositoryMutationError(400, "DELEGATION_REPOSITORY_UUID_INVALID", `${field} must be a UUID.`, { field });
  }
  return normalized;
}

function normalizeHash(value, field) {
  const normalized = lower(value, 64);
  if (!HASH_PATTERN.test(normalized)) {
    throw repositoryMutationError(400, "DELEGATION_REPOSITORY_HASH_INVALID", `${field} must be a SHA-256 hash.`, { field });
  }
  return normalized;
}

function normalizeDate(value, field) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    throw repositoryMutationError(400, "DELEGATION_REPOSITORY_DATE_INVALID", `${field} must be an ISO date-time.`, { field });
  }
  return new Date(timestamp).toISOString();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : stableJson(value))
    .digest("hex");
}

function schemaReadinessBlockers(evidence = {}) {
  const blockers = [];
  if (evidence.status !== "verified_applied") blockers.push("DELEGATION_SCHEMA_NOT_VERIFIED_APPLIED");
  if (evidence.migration_applied !== true) blockers.push("DELEGATION_MIGRATION_NOT_APPLIED");
  if (evidence.readback_complete !== true) blockers.push("DELEGATION_SCHEMA_READBACK_INCOMPLETE");
  if (!HASH_PATTERN.test(lower(evidence.migration_checksum_sha256, 64))) {
    blockers.push("DELEGATION_MIGRATION_CHECKSUM_REQUIRED");
  }
  if (!Number.isInteger(Number(evidence.statement_count)) || Number(evidence.statement_count) < 1) {
    blockers.push("DELEGATION_MIGRATION_STATEMENT_COUNT_REQUIRED");
  }
  if (!HASH_PATTERN.test(lower(evidence.schema_readback_fingerprint, 64))) {
    blockers.push("DELEGATION_SCHEMA_READBACK_FINGERPRINT_REQUIRED");
  }
  return blockers;
}

function normalizeAuthorization(input = {}, requestFingerprint) {
  if (input.approved !== true) {
    throw repositoryMutationError(403, "DELEGATION_REPOSITORY_AUTHORIZATION_REQUIRED", "A typed governed authorization is required.");
  }
  const authorization = {
    capability_envelope_id: normalizeUuid(input.capability_envelope_id, "authorization.capability_envelope_id"),
    approval_hold_id: normalizeUuid(input.approval_hold_id, "authorization.approval_hold_id"),
    resource_authority_ref: compact(input.resource_authority_ref, 500),
    expected_request_fingerprint: normalizeHash(
      input.expected_request_fingerprint,
      "authorization.expected_request_fingerprint",
    ),
  };
  if (!authorization.resource_authority_ref) {
    throw repositoryMutationError(403, "DELEGATION_REPOSITORY_RESOURCE_AUTHORITY_REQUIRED", "resource_authority_ref is required.");
  }
  if (authorization.expected_request_fingerprint !== requestFingerprint) {
    throw repositoryMutationError(409, "DELEGATION_REPOSITORY_AUTHORIZATION_STALE", "Authorization does not match the lifecycle request fingerprint.", {
      expected_request_fingerprint: authorization.expected_request_fingerprint,
      observed_request_fingerprint: requestFingerprint,
    });
  }
  return authorization;
}

function normalizePlan(plan = {}) {
  if (plan.report_type !== "delegation_grant_lifecycle_shadow_plan" || plan.decision !== "eligible_shadow") {
    throw repositoryMutationError(409, "DELEGATION_REPOSITORY_PLAN_NOT_ELIGIBLE", "An eligible lifecycle shadow plan is required.");
  }
  const action = lower(plan.action, 32);
  if (!ACTIONS.has(action) || plan.command_preview?.action !== action) {
    throw repositoryMutationError(400, "DELEGATION_REPOSITORY_ACTION_INVALID", "Lifecycle action is invalid or inconsistent.");
  }
  const requestFingerprint = normalizeHash(plan.request_fingerprint, "plan.request_fingerprint");
  const receipt = plan.receipt;
  if (!receipt || receipt.schema_version !== MUTATION_RECEIPT_SCHEMA_VERSION) {
    throw repositoryMutationError(400, "DELEGATION_REPOSITORY_RECEIPT_INVALID", "A canonical pending mutation receipt is required.");
  }
  if (
    receipt.state !== "pending"
    || receipt.outcome_classification !== "pending"
    || receipt.retry_allowed !== false
    || receipt.readback_complete !== false
  ) {
    throw repositoryMutationError(409, "DELEGATION_REPOSITORY_RECEIPT_NOT_PENDING", "The lifecycle receipt must be pending and fail closed.");
  }
  if (normalizeHash(receipt.request_fingerprint, "plan.receipt.request_fingerprint") !== requestFingerprint) {
    throw repositoryMutationError(409, "DELEGATION_REPOSITORY_RECEIPT_FINGERPRINT_MISMATCH", "Receipt and plan fingerprints differ.");
  }
  if (plan.execution_performed !== false) {
    throw repositoryMutationError(409, "DELEGATION_REPOSITORY_PLAN_ALREADY_EXECUTED", "The lifecycle plan must not claim prior execution.");
  }
  const command = structuredClone(plan.command_preview);
  const grantId = normalizeUuid(
    action === "create" ? command.grant?.grant_id : command.grant_id,
    "command.grant_id",
  );
  if (action === "create" && command.grant?.schema_version !== DELEGATION_GRANT_SCHEMA_VERSION) {
    throw repositoryMutationError(400, "DELEGATION_REPOSITORY_GRANT_SCHEMA_INVALID", "Create command grant schema is invalid.");
  }
  return {
    action,
    command,
    grant_id: grantId,
    request_fingerprint: requestFingerprint,
    receipt: {
      ...structuredClone(receipt),
      receipt_id: normalizeUuid(receipt.receipt_id, "plan.receipt.receipt_id"),
      operation_id: normalizeUuid(receipt.operation_id, "plan.receipt.operation_id"),
      step_id: normalizeUuid(receipt.step_id, "plan.receipt.step_id"),
      idempotency_key: compact(receipt.idempotency_key, 191),
    },
  };
}

function validateRepository(repository) {
  if (!repository || typeof repository.beginTransaction !== "function") {
    throw repositoryMutationError(500, "DELEGATION_REPOSITORY_PORT_INVALID", "Repository must expose beginTransaction.");
  }
}

function validateTransaction(transaction) {
  for (const method of TRANSACTION_METHODS) {
    if (typeof transaction?.[method] !== "function") {
      throw repositoryMutationError(500, "DELEGATION_REPOSITORY_TRANSACTION_PORT_INVALID", `Transaction must expose ${method}.`, {
        missing_method: method,
      });
    }
  }
}

function verifyGrantReadback({ action, command, grantId, grant }) {
  if (!grant || normalizeUuid(grant.grant_id, "readback.grant_id") !== grantId) {
    throw repositoryMutationError(409, "DELEGATION_REPOSITORY_GRANT_READBACK_MISSING", "Grant readback is missing or has the wrong grant_id.");
  }
  const expectedStatus = command.proposed_status;
  if (grant.status !== expectedStatus) {
    throw repositoryMutationError(409, "DELEGATION_REPOSITORY_GRANT_READBACK_MISMATCH", "Grant status readback does not match the command.", {
      expected_status: expectedStatus,
      observed_status: grant.status,
    });
  }
  if (action === "create") {
    for (const field of ["delegated_by", "delegated_to", "approval_mode", "plan_id", "plan_hash"]) {
      if (grant[field] !== command.grant[field]) {
        throw repositoryMutationError(409, "DELEGATION_REPOSITORY_GRANT_READBACK_MISMATCH", `Grant readback differs for ${field}.`, {
          field,
        });
      }
    }
  }
}

function verifyReceiptReadback({ expected, receipt, readbackFingerprint }) {
  if (!receipt || receipt.receipt_id !== expected.receipt_id) {
    throw repositoryMutationError(409, "DELEGATION_REPOSITORY_RECEIPT_READBACK_MISSING", "Receipt readback is missing or has the wrong receipt_id.");
  }
  if (
    receipt.request_fingerprint !== expected.request_fingerprint
    || receipt.state !== "reconciled"
    || receipt.outcome_classification !== "verified_success"
    || receipt.readback_complete !== true
    || receipt.retry_allowed !== false
    || receipt.readback_fingerprint !== readbackFingerprint
  ) {
    throw repositoryMutationError(409, "DELEGATION_REPOSITORY_RECEIPT_READBACK_MISMATCH", "Receipt readback does not prove verified success.");
  }
}

async function rollbackQuietly(transaction) {
  try {
    await transaction?.rollback?.();
  } catch {
    // The original failure remains authoritative.
  }
}

function resultEnvelope({ decision, action, tenantId, requestFingerprint, grant, receipt, readbackFingerprint, mutationApplied, replayed }) {
  return {
    ok: true,
    report_type: "delegation_grant_repository_mutation_result",
    repository_contract_version: DELEGATION_GRANT_REPOSITORY_MUTATION_CONTRACT_VERSION,
    decision,
    action,
    tenant_id: tenantId,
    request_fingerprint: requestFingerprint,
    mutation_applied: mutationApplied,
    idempotent_replay: replayed,
    grant,
    receipt,
    readback_fingerprint: readbackFingerprint,
    retry_allowed: false,
    guarantees: {
      transaction_required: true,
      pending_receipt_written_before_mutation: mutationApplied,
      same_cycle_grant_readback: Boolean(grant),
      same_cycle_receipt_readback: Boolean(receipt),
      runtime_authority_changed: false,
      public_route_added: false,
      provider_call_performed: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export async function executeDelegationGrantRepositoryMutation({
  repository,
  plan,
  tenantId,
  schemaReadiness = {},
  authorization = {},
  now = new Date().toISOString(),
} = {}) {
  validateRepository(repository);
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id");
  const normalizedNow = normalizeDate(now, "now");
  const normalizedPlan = normalizePlan(plan);
  const blockers = schemaReadinessBlockers(schemaReadiness);
  if (blockers.length > 0) {
    throw repositoryMutationError(409, "DELEGATION_REPOSITORY_SCHEMA_NOT_READY", "Canonical delegation persistence is not verified as applied.", {
      blockers,
    });
  }
  normalizeAuthorization(authorization, normalizedPlan.request_fingerprint);

  const transaction = await repository.beginTransaction({
    tenant_id: normalizedTenantId,
    action: normalizedPlan.action,
    request_fingerprint: normalizedPlan.request_fingerprint,
  });
  validateTransaction(transaction);
  let mutationAttempted = false;
  let commitAttempted = false;
  let commitCompleted = false;

  try {
    const existingReceipt = await transaction.findReceiptByIdempotencyKey({
      tenant_id: normalizedTenantId,
      idempotency_key: normalizedPlan.receipt.idempotency_key,
    });

    if (existingReceipt) {
      if (existingReceipt.request_fingerprint !== normalizedPlan.request_fingerprint) {
        throw repositoryMutationError(409, "DELEGATION_REPOSITORY_IDEMPOTENCY_CONFLICT", "The idempotency key is already bound to a different request fingerprint.");
      }
      if (
        existingReceipt.state !== "reconciled"
        || existingReceipt.outcome_classification !== "verified_success"
        || existingReceipt.readback_complete !== true
      ) {
        await rollbackQuietly(transaction);
        return resultEnvelope({
          decision: "blocked_existing_receipt_requires_reconciliation",
          action: normalizedPlan.action,
          tenantId: normalizedTenantId,
          requestFingerprint: normalizedPlan.request_fingerprint,
          grant: null,
          receipt: structuredClone(existingReceipt),
          readbackFingerprint: existingReceipt.readback_fingerprint || null,
          mutationApplied: false,
          replayed: false,
        });
      }
      const replayGrant = await transaction.inspectGrant({
        tenant_id: normalizedTenantId,
        grant_id: normalizedPlan.grant_id,
      });
      const replayReceipt = await transaction.inspectReceipt({
        tenant_id: normalizedTenantId,
        receipt_id: existingReceipt.receipt_id,
      });
      verifyGrantReadback({
        action: normalizedPlan.action,
        command: normalizedPlan.command,
        grantId: normalizedPlan.grant_id,
        grant: replayGrant,
      });
      verifyReceiptReadback({
        expected: normalizedPlan.receipt,
        receipt: replayReceipt,
        readbackFingerprint: existingReceipt.readback_fingerprint,
      });
      await rollbackQuietly(transaction);
      return resultEnvelope({
        decision: "idempotent_replay",
        action: normalizedPlan.action,
        tenantId: normalizedTenantId,
        requestFingerprint: normalizedPlan.request_fingerprint,
        grant: structuredClone(replayGrant),
        receipt: structuredClone(replayReceipt),
        readbackFingerprint: existingReceipt.readback_fingerprint,
        mutationApplied: false,
        replayed: true,
      });
    }

    await transaction.insertPendingReceipt({
      tenant_id: normalizedTenantId,
      receipt: structuredClone(normalizedPlan.receipt),
    });
    mutationAttempted = true;

    if (normalizedPlan.action === "create") {
      await transaction.applyCreateGrant({
        tenant_id: normalizedTenantId,
        command: structuredClone(normalizedPlan.command),
        receipt_id: normalizedPlan.receipt.receipt_id,
      });
    } else {
      await transaction.applyGrantTransition({
        tenant_id: normalizedTenantId,
        action: normalizedPlan.action,
        command: structuredClone(normalizedPlan.command),
        receipt_id: normalizedPlan.receipt.receipt_id,
      });
    }

    const grantReadback = await transaction.inspectGrant({
      tenant_id: normalizedTenantId,
      grant_id: normalizedPlan.grant_id,
    });
    verifyGrantReadback({
      action: normalizedPlan.action,
      command: normalizedPlan.command,
      grantId: normalizedPlan.grant_id,
      grant: grantReadback,
    });

    const readbackFingerprint = sha256({
      tenant_id: normalizedTenantId,
      action: normalizedPlan.action,
      request_fingerprint: normalizedPlan.request_fingerprint,
      grant: grantReadback,
    });
    await transaction.finalizeReceipt({
      tenant_id: normalizedTenantId,
      receipt_id: normalizedPlan.receipt.receipt_id,
      state: "reconciled",
      outcome_classification: "verified_success",
      readback_fingerprint: readbackFingerprint,
      retry_allowed: false,
      readback_complete: true,
      dispatched_at: normalizedNow,
      reconciled_at: normalizedNow,
    });
    const receiptReadback = await transaction.inspectReceipt({
      tenant_id: normalizedTenantId,
      receipt_id: normalizedPlan.receipt.receipt_id,
    });
    verifyReceiptReadback({
      expected: normalizedPlan.receipt,
      receipt: receiptReadback,
      readbackFingerprint,
    });

    commitAttempted = true;
    await transaction.commit();
    commitCompleted = true;

    return resultEnvelope({
      decision: "verified_success",
      action: normalizedPlan.action,
      tenantId: normalizedTenantId,
      requestFingerprint: normalizedPlan.request_fingerprint,
      grant: structuredClone(grantReadback),
      receipt: structuredClone(receiptReadback),
      readbackFingerprint,
      mutationApplied: true,
      replayed: false,
    });
  } catch (error) {
    if (commitAttempted && !commitCompleted) {
      throw repositoryMutationError(503, "DELEGATION_REPOSITORY_COMMIT_OUTCOME_UNKNOWN", "Transaction commit outcome is unknown; automatic retry is forbidden.", {
        action: normalizedPlan.action,
        grant_id: normalizedPlan.grant_id,
        request_fingerprint: normalizedPlan.request_fingerprint,
        mutation_attempted: mutationAttempted,
        retry_allowed: false,
        cause_code: error?.code || null,
      });
    }
    await rollbackQuietly(transaction);
    throw error;
  }
}

export const _testingDelegationGrantRepositoryMutation = {
  stableJson,
  sha256,
  normalizeUuid,
  normalizeHash,
  schemaReadinessBlockers,
  normalizePlan,
  verifyGrantReadback,
  verifyReceiptReadback,
};
