import { createHash } from "node:crypto";

export const DELEGATION_GRANT_LIFECYCLE_SHADOW_VERSION = "spec011-delegation-grant-lifecycle-shadow-v1";
export const DELEGATION_GRANT_SCHEMA_VERSION = "spec011-delegation-grant-v1";
export const MUTATION_RECEIPT_SCHEMA_VERSION = "spec011-mutation-receipt-v1";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const APPROVAL_MODES = new Set([
  "user_approval_only",
  "agent_recommend_only",
  "agent_queue_for_approval",
  "delegated_low_risk",
  "delegated_plan_bound",
  "human_on_exception",
  "multi_agent_approval",
  "break_glass",
]);
const CANONICAL_STATUSES = new Set([
  "preview",
  "active",
  "revoked",
  "expired",
  "exhausted",
  "completed",
  "denied",
]);
const PRINCIPAL_SCOPES = new Set(["tenant", "admin", "system"]);
const RISK_ORDER = Object.freeze({ read_only: 0, low: 1, medium: 2, high: 3, critical: 4 });

function lifecycleError(status, code, message, details = {}) {
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

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

function deterministicUuid(hash) {
  const source = String(hash || "").padEnd(32, "0").slice(0, 32).split("");
  source[12] = "4";
  source[16] = "8";
  const hex = source.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function normalizeUuid(value, field) {
  const normalized = lower(value, 64);
  if (!UUID_PATTERN.test(normalized)) {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_UUID_INVALID", `${field} must be a UUID.`, { field });
  }
  return normalized;
}

function normalizeHash(value, field) {
  const normalized = lower(value, 64);
  if (!HASH_PATTERN.test(normalized)) {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_HASH_INVALID", `${field} must be a lowercase SHA-256 hash.`, { field });
  }
  return normalized;
}

function parseDate(value, field, { required = true } = {}) {
  if ((value === null || value === undefined || value === "") && !required) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_DATE_INVALID", `${field} must be an ISO date-time.`, { field });
  }
  return new Date(timestamp).toISOString();
}

function normalizeStringSet(value, field, { required = false, maxItems = 100 } = {}) {
  if (!Array.isArray(value)) {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_LIST_INVALID", `${field} must be an array.`, { field });
  }
  const normalized = [...new Set(value.map((item) => compact(item, 191)).filter(Boolean))].sort();
  if (required && normalized.length === 0) {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_LIST_REQUIRED", `${field} must include at least one value.`, { field });
  }
  if (normalized.length > maxItems) {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_LIST_TOO_LARGE", `${field} exceeds the maximum item count.`, {
      field,
      maximum: maxItems,
    });
  }
  return normalized;
}

function normalizeResourceScope(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_RESOURCE_SCOPE_REQUIRED", "resource_scope must include at least one resource.");
  }
  if (value.length > 50) {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_RESOURCE_SCOPE_TOO_LARGE", "resource_scope exceeds the maximum item count.");
  }
  const seen = new Set();
  const normalized = value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw lifecycleError(400, "DELEGATION_LIFECYCLE_RESOURCE_SCOPE_INVALID", "Each resource_scope item must be an object.", { index });
    }
    const resourceUri = compact(entry.resource_uri, 500);
    if (!resourceUri) {
      throw lifecycleError(400, "DELEGATION_LIFECYCLE_RESOURCE_URI_REQUIRED", "resource_uri is required.", { index });
    }
    const snapshotHash = normalizeHash(entry.snapshot_hash, `resource_scope[${index}].snapshot_hash`);
    const key = `${resourceUri}\n${snapshotHash}`;
    if (seen.has(key)) {
      throw lifecycleError(409, "DELEGATION_LIFECYCLE_RESOURCE_SCOPE_DUPLICATE", "Duplicate resource scope binding.", {
        resource_uri: resourceUri,
      });
    }
    seen.add(key);
    return { resource_uri: resourceUri, snapshot_hash: snapshotHash };
  });
  return normalized.sort((left, right) => left.resource_uri.localeCompare(right.resource_uri)
    || left.snapshot_hash.localeCompare(right.snapshot_hash));
}

function normalizeLimits(input = {}) {
  const normalized = {
    max_mutations: Number(input.max_mutations),
    max_retries: Number(input.max_retries),
    max_pull_requests: Number(input.max_pull_requests),
  };
  const maximums = { max_mutations: 100, max_retries: 10, max_pull_requests: 10 };
  for (const [field, maximum] of Object.entries(maximums)) {
    if (!Number.isInteger(normalized[field]) || normalized[field] < 0 || normalized[field] > maximum) {
      throw lifecycleError(400, "DELEGATION_LIFECYCLE_LIMIT_INVALID", `${field} must be an integer from 0 to ${maximum}.`, {
        field,
        maximum,
      });
    }
  }
  return normalized;
}

function normalizeCanonicalGrant(input = {}) {
  if (input.schema_version !== DELEGATION_GRANT_SCHEMA_VERSION) {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_SCHEMA_VERSION_INVALID", "The canonical delegation grant schema version is required.");
  }
  const approvalMode = lower(input.approval_mode);
  if (!APPROVAL_MODES.has(approvalMode)) {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_APPROVAL_MODE_INVALID", "approval_mode is invalid.");
  }
  const maxRiskTier = lower(input.max_risk_tier);
  if (!Object.hasOwn(RISK_ORDER, maxRiskTier)) {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_RISK_TIER_INVALID", "max_risk_tier is invalid.");
  }
  const status = lower(input.status);
  if (!CANONICAL_STATUSES.has(status)) {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_STATUS_INVALID", "status is invalid.");
  }
  if (input.require_readback !== true || input.stop_on_drift !== true) {
    throw lifecycleError(409, "DELEGATION_LIFECYCLE_FAIL_CLOSED_POLICY_REQUIRED", "require_readback and stop_on_drift must both be true.");
  }
  if (input.secrets_included !== false) {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_SECRETS_FLAG_INVALID", "secrets_included must be false.");
  }
  const createdAt = parseDate(input.created_at, "created_at", { required: false });
  const expiresAt = parseDate(input.expires_at, "expires_at");
  if (createdAt && new Date(expiresAt).getTime() <= new Date(createdAt).getTime()) {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_EXPIRY_INVALID", "expires_at must be after created_at.");
  }
  const revokedAt = parseDate(input.revoked_at, "revoked_at", { required: false });
  const delegatedBy = compact(input.delegated_by, 191);
  const delegatedTo = compact(input.delegated_to, 191);
  if (!delegatedBy || !delegatedTo) {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_PRINCIPAL_REQUIRED", "delegated_by and delegated_to are required.");
  }
  const allowedIntents = normalizeStringSet(input.allowed_intents, "allowed_intents", { required: true });
  const deniedIntents = normalizeStringSet(input.denied_intents, "denied_intents");
  const overlap = allowedIntents.filter((intent) => deniedIntents.includes(intent));
  if (overlap.length > 0) {
    throw lifecycleError(409, "DELEGATION_LIFECYCLE_INTENT_CONFLICT", "An intent cannot be both allowed and denied.", {
      overlapping_intents: overlap,
    });
  }
  return {
    schema_version: DELEGATION_GRANT_SCHEMA_VERSION,
    grant_id: normalizeUuid(input.grant_id, "grant_id"),
    delegated_by: delegatedBy,
    delegated_to: delegatedTo,
    approval_mode: approvalMode,
    plan_id: normalizeUuid(input.plan_id, "plan_id"),
    plan_hash: normalizeHash(input.plan_hash, "plan_hash"),
    resource_scope: normalizeResourceScope(input.resource_scope),
    allowed_intents: allowedIntents,
    denied_intents: deniedIntents,
    max_risk_tier: maxRiskTier,
    limits: normalizeLimits(input.limits),
    require_readback: true,
    stop_on_drift: true,
    policy_version: compact(input.policy_version, 64) || null,
    status,
    created_at: createdAt,
    expires_at: expiresAt,
    revoked_at: revokedAt,
    secrets_included: false,
  };
}

function canonicalGrantFromPreview(preview = {}) {
  if (!preview.grant || typeof preview.grant !== "object") {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_PREVIEW_REQUIRED", "A delegation grant preview is required.");
  }
  return normalizeCanonicalGrant({
    ...preview.grant,
    schema_version: DELEGATION_GRANT_SCHEMA_VERSION,
    status: "preview",
    secrets_included: false,
  });
}

function canonicalGrantHash(grant) {
  return sha256(normalizeCanonicalGrant(grant));
}

function schemaReadinessBlockers(evidence = {}) {
  const blockers = [];
  if (evidence.status !== "verified_applied") blockers.push("DELEGATION_SCHEMA_NOT_VERIFIED_APPLIED");
  if (evidence.migration_applied !== true) blockers.push("DELEGATION_MIGRATION_NOT_APPLIED");
  if (evidence.readback_complete !== true) blockers.push("DELEGATION_SCHEMA_READBACK_INCOMPLETE");
  if (!HASH_PATTERN.test(lower(evidence.migration_checksum_sha256, 64))) blockers.push("DELEGATION_MIGRATION_CHECKSUM_REQUIRED");
  if (!Number.isInteger(Number(evidence.statement_count)) || Number(evidence.statement_count) < 1) {
    blockers.push("DELEGATION_MIGRATION_STATEMENT_COUNT_REQUIRED");
  }
  if (!HASH_PATTERN.test(lower(evidence.schema_readback_fingerprint, 64))) {
    blockers.push("DELEGATION_SCHEMA_READBACK_FINGERPRINT_REQUIRED");
  }
  return blockers;
}

function normalizeMutationContext(input = {}) {
  const idempotencyKey = compact(input.idempotency_key, 191);
  if (idempotencyKey.length < 8) {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_IDEMPOTENCY_KEY_INVALID", "idempotency_key must contain at least eight characters.");
  }
  const requestedBy = compact(input.requested_by, 191);
  if (!requestedBy) {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_REQUESTED_BY_REQUIRED", "requested_by is required.");
  }
  const principalScope = lower(input.principal_scope || "tenant", 32);
  if (!PRINCIPAL_SCOPES.has(principalScope)) {
    throw lifecycleError(400, "DELEGATION_LIFECYCLE_PRINCIPAL_SCOPE_INVALID", "principal_scope is invalid.");
  }
  const providerOrAdapter = compact(input.provider_or_adapter || "agent_delegation_repository_shadow", 191);
  return {
    operation_id: normalizeUuid(input.operation_id, "operation_id"),
    step_id: normalizeUuid(input.step_id, "step_id"),
    idempotency_key: idempotencyKey,
    requested_by: requestedBy,
    principal_scope: principalScope,
    provider_or_adapter: providerOrAdapter,
  };
}

function buildPendingMutationReceipt({ context, requestFingerprint, now }) {
  const receiptSeed = sha256({
    schema_version: MUTATION_RECEIPT_SCHEMA_VERSION,
    operation_id: context.operation_id,
    step_id: context.step_id,
    idempotency_key: context.idempotency_key,
    request_fingerprint: requestFingerprint,
    provider_or_adapter: context.provider_or_adapter,
  });
  return {
    schema_version: MUTATION_RECEIPT_SCHEMA_VERSION,
    receipt_id: deterministicUuid(receiptSeed),
    operation_id: context.operation_id,
    step_id: context.step_id,
    idempotency_key: context.idempotency_key,
    request_fingerprint: requestFingerprint,
    provider_or_adapter: context.provider_or_adapter,
    state: "pending",
    outcome_classification: "pending",
    external_reference: null,
    readback_fingerprint: null,
    retry_allowed: false,
    readback_complete: false,
    created_at: parseDate(now, "now"),
    dispatched_at: null,
    reconciled_at: null,
    secrets_included: false,
  };
}

function lifecyclePlan({ action, command, blockers, context, now }) {
  const uniqueBlockers = [...new Set(blockers)];
  const requestFingerprint = sha256(command);
  const eligible = uniqueBlockers.length === 0;
  return {
    ok: true,
    report_type: "delegation_grant_lifecycle_shadow_plan",
    lifecycle_version: DELEGATION_GRANT_LIFECYCLE_SHADOW_VERSION,
    action,
    decision: eligible ? "eligible_shadow" : "blocked",
    command_preview: command,
    request_fingerprint: requestFingerprint,
    receipt: eligible ? buildPendingMutationReceipt({ context, requestFingerprint, now }) : null,
    blockers: uniqueBlockers,
    next_action: eligible
      ? { action: `request_governed_${action}_approval`, reason_code: `DELEGATION_${action.toUpperCase()}_SHADOW_ELIGIBLE` }
      : { action: "resolve_delegation_lifecycle_blockers", reason_code: uniqueBlockers[0] || "DELEGATION_LIFECYCLE_BLOCKED" },
    execution_performed: false,
    guarantees: {
      repository_write_performed: false,
      database_write_performed: false,
      delegation_mutated: false,
      runtime_authority_changed: false,
      approval_mutation_performed: false,
      provider_call_performed: false,
      external_write_performed: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

function assertExpectedGrantHash(grant, expectedGrantHash) {
  const observed = canonicalGrantHash(grant);
  if (expectedGrantHash && normalizeHash(expectedGrantHash, "expected_grant_hash") !== observed) {
    throw lifecycleError(409, "DELEGATION_LIFECYCLE_GRANT_STALE", "The canonical grant does not match expected_grant_hash.", {
      expected_grant_hash: lower(expectedGrantHash, 64),
      observed_grant_hash: observed,
    });
  }
  return observed;
}

export function planDelegationGrantCreateShadow({
  preview,
  schemaReadiness = {},
  expectedPreviewGrantHash = null,
  operationId,
  stepId,
  idempotencyKey,
  requestedBy,
  principalScope = "tenant",
  providerOrAdapter,
  now = new Date().toISOString(),
} = {}) {
  const context = normalizeMutationContext({
    operation_id: operationId,
    step_id: stepId,
    idempotency_key: idempotencyKey,
    requested_by: requestedBy,
    principal_scope: principalScope,
    provider_or_adapter: providerOrAdapter,
  });
  const previewHash = normalizeHash(preview?.grant_hash, "preview.grant_hash");
  if (expectedPreviewGrantHash && normalizeHash(expectedPreviewGrantHash, "expected_preview_grant_hash") !== previewHash) {
    throw lifecycleError(409, "DELEGATION_LIFECYCLE_PREVIEW_STALE", "The preview does not match expected_preview_grant_hash.");
  }
  const grant = canonicalGrantFromPreview(preview);
  const blockers = schemaReadinessBlockers(schemaReadiness);
  if (preview?.decision !== "eligible_preview") blockers.push("DELEGATION_PREVIEW_NOT_ELIGIBLE");
  if (context.principal_scope === "tenant" && context.requested_by !== grant.delegated_by) {
    blockers.push("DELEGATION_CREATE_NOT_AUTHORIZED");
  }
  if (new Date(grant.expires_at).getTime() <= new Date(now).getTime()) blockers.push("DELEGATION_ALREADY_EXPIRED");
  const persistedGrant = normalizeCanonicalGrant({ ...grant, status: "active" });
  const grantHash = canonicalGrantHash(persistedGrant);
  const command = {
    action: "create",
    expected_status: "preview",
    proposed_status: "active",
    grant: persistedGrant,
    preview_grant_hash: previewHash,
    canonical_grant_hash: grantHash,
    requested_by: context.requested_by,
    principal_scope: context.principal_scope,
  };
  return lifecyclePlan({ action: "create", command, blockers, context, now });
}

export function planDelegationGrantRevokeShadow({
  grant: inputGrant,
  schemaReadiness = {},
  expectedGrantHash = null,
  operationId,
  stepId,
  idempotencyKey,
  requestedBy,
  principalScope = "tenant",
  providerOrAdapter,
  reason = null,
  now = new Date().toISOString(),
} = {}) {
  const context = normalizeMutationContext({
    operation_id: operationId,
    step_id: stepId,
    idempotency_key: idempotencyKey,
    requested_by: requestedBy,
    principal_scope: principalScope,
    provider_or_adapter: providerOrAdapter,
  });
  const grant = normalizeCanonicalGrant(inputGrant);
  const grantHash = assertExpectedGrantHash(grant, expectedGrantHash);
  const blockers = schemaReadinessBlockers(schemaReadiness);
  if (!["preview", "active"].includes(grant.status)) blockers.push("DELEGATION_NOT_REVOCABLE");
  if (context.principal_scope === "tenant" && context.requested_by !== grant.delegated_by) {
    blockers.push("DELEGATION_REVOKE_NOT_AUTHORIZED");
  }
  const command = {
    action: "revoke",
    grant_id: grant.grant_id,
    expected_grant_hash: grantHash,
    expected_status: grant.status,
    proposed_status: "revoked",
    revoked_at: parseDate(now, "now"),
    revocation_reason: compact(reason, 500) || null,
    requested_by: context.requested_by,
    principal_scope: context.principal_scope,
  };
  return lifecyclePlan({ action: "revoke", command, blockers, context, now });
}

export function planDelegationGrantExpireShadow({
  grant: inputGrant,
  schemaReadiness = {},
  expectedGrantHash = null,
  operationId,
  stepId,
  idempotencyKey,
  requestedBy,
  principalScope = "system",
  providerOrAdapter,
  now = new Date().toISOString(),
} = {}) {
  const context = normalizeMutationContext({
    operation_id: operationId,
    step_id: stepId,
    idempotency_key: idempotencyKey,
    requested_by: requestedBy,
    principal_scope: principalScope,
    provider_or_adapter: providerOrAdapter,
  });
  const grant = normalizeCanonicalGrant(inputGrant);
  const grantHash = assertExpectedGrantHash(grant, expectedGrantHash);
  const blockers = schemaReadinessBlockers(schemaReadiness);
  if (!["preview", "active"].includes(grant.status)) blockers.push("DELEGATION_NOT_EXPIRABLE");
  if (new Date(grant.expires_at).getTime() > new Date(now).getTime()) blockers.push("DELEGATION_NOT_YET_EXPIRED");
  const command = {
    action: "expire",
    grant_id: grant.grant_id,
    expected_grant_hash: grantHash,
    expected_status: grant.status,
    proposed_status: "expired",
    expired_at: parseDate(now, "now"),
    requested_by: context.requested_by,
    principal_scope: context.principal_scope,
  };
  return lifecyclePlan({ action: "expire", command, blockers, context, now });
}

function resourceScopeIsSubset(requested, current) {
  const currentBindings = new Set(current.map((entry) => `${entry.resource_uri}\n${entry.snapshot_hash}`));
  return requested.every((entry) => currentBindings.has(`${entry.resource_uri}\n${entry.snapshot_hash}`));
}

function setIsSubset(requested, current) {
  const currentSet = new Set(current);
  return requested.every((entry) => currentSet.has(entry));
}

export function evaluateDelegationRenewalNoWidening({ currentGrant, requestedGrant } = {}) {
  const current = normalizeCanonicalGrant(currentGrant);
  const requested = normalizeCanonicalGrant(requestedGrant);
  const blockers = [];
  for (const field of ["grant_id", "delegated_by", "delegated_to", "approval_mode", "plan_id", "plan_hash", "policy_version"]) {
    if (current[field] !== requested[field]) blockers.push(`DELEGATION_RENEWAL_${field.toUpperCase()}_CHANGED`);
  }
  if (!resourceScopeIsSubset(requested.resource_scope, current.resource_scope)) blockers.push("DELEGATION_RENEWAL_RESOURCE_SCOPE_WIDENED");
  if (!setIsSubset(requested.allowed_intents, current.allowed_intents)) blockers.push("DELEGATION_RENEWAL_ALLOWED_INTENTS_WIDENED");
  if (!setIsSubset(current.denied_intents, requested.denied_intents)) blockers.push("DELEGATION_RENEWAL_DENIED_INTENTS_NARROWED");
  if (RISK_ORDER[requested.max_risk_tier] > RISK_ORDER[current.max_risk_tier]) blockers.push("DELEGATION_RENEWAL_RISK_WIDENED");
  for (const field of ["max_mutations", "max_retries", "max_pull_requests"]) {
    if (requested.limits[field] > current.limits[field]) blockers.push(`DELEGATION_RENEWAL_${field.toUpperCase()}_WIDENED`);
  }
  if (new Date(requested.expires_at).getTime() > new Date(current.expires_at).getTime()) {
    blockers.push("DELEGATION_RENEWAL_EXPIRY_EXTENDED");
  }
  const uniqueBlockers = [...new Set(blockers)];
  return {
    ok: true,
    report_type: "delegation_grant_renewal_no_widening_shadow",
    lifecycle_version: DELEGATION_GRANT_LIFECYCLE_SHADOW_VERSION,
    decision: uniqueBlockers.length === 0 ? "eligible_preview" : "blocked",
    current_grant_hash: canonicalGrantHash(current),
    requested_grant_hash: canonicalGrantHash(requested),
    blockers: uniqueBlockers,
    new_approval_required: uniqueBlockers.length > 0,
    execution_performed: false,
    guarantees: {
      delegation_mutated: false,
      repository_write_performed: false,
      database_write_performed: false,
      provider_call_performed: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export function createDelegationLifecycleReadPort(repository = {}) {
  if (typeof repository.inspectGrant !== "function" || typeof repository.inspectReceipt !== "function") {
    throw lifecycleError(500, "DELEGATION_LIFECYCLE_REPOSITORY_PORT_INVALID", "The repository port must expose inspectGrant and inspectReceipt read methods.");
  }
  return Object.freeze({
    inspectGrant: repository.inspectGrant.bind(repository),
    inspectReceipt: repository.inspectReceipt.bind(repository),
  });
}

export async function inspectDelegationGrantLifecycleShadow({
  repository,
  grantId,
  tenantId,
  expectedGrantHash = null,
  now = new Date().toISOString(),
} = {}) {
  const port = createDelegationLifecycleReadPort(repository);
  const normalizedGrantId = normalizeUuid(grantId, "grant_id");
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id");
  const row = await port.inspectGrant({ grant_id: normalizedGrantId, tenant_id: normalizedTenantId });
  if (!row) throw lifecycleError(404, "DELEGATION_LIFECYCLE_GRANT_NOT_FOUND", "The canonical delegation grant was not found.");
  const grant = normalizeCanonicalGrant(row);
  if (grant.grant_id !== normalizedGrantId) {
    throw lifecycleError(409, "DELEGATION_LIFECYCLE_GRANT_ID_MISMATCH", "The repository returned a different grant_id.");
  }
  const grantHash = assertExpectedGrantHash(grant, expectedGrantHash);
  const observedExpired = new Date(grant.expires_at).getTime() <= new Date(now).getTime();
  const readbackFingerprint = sha256({
    tenant_id: normalizedTenantId,
    grant_id: grant.grant_id,
    grant_hash: grantHash,
    status: grant.status,
    expires_at: grant.expires_at,
    observed_expired: observedExpired,
  });
  return {
    ok: true,
    report_type: "delegation_grant_lifecycle_shadow_inspection",
    lifecycle_version: DELEGATION_GRANT_LIFECYCLE_SHADOW_VERSION,
    grant,
    grant_hash: grantHash,
    observed_expired: observedExpired,
    readback_fingerprint: readbackFingerprint,
    dispatch_eligible: false,
    execution_performed: false,
    guarantees: {
      repository_read_performed: true,
      repository_write_performed: false,
      database_write_performed: false,
      runtime_authority_changed: false,
      provider_call_performed: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export const _testingDelegationGrantLifecycleShadow = {
  stableJson,
  sha256,
  deterministicUuid,
  normalizeUuid,
  normalizeHash,
  normalizeStringSet,
  normalizeResourceScope,
  normalizeLimits,
  normalizeCanonicalGrant,
  canonicalGrantHash,
  schemaReadinessBlockers,
  normalizeMutationContext,
  buildPendingMutationReceipt,
  resourceScopeIsSubset,
  setIsSubset,
};
