import { createHash } from "node:crypto";
import { projectDelegationGrantPreview } from "./delegationGrantShadowService.js";
import {
  inspectDelegationGrantLifecycleShadow,
  planDelegationGrantCreateShadow,
  planDelegationGrantExpireShadow,
  planDelegationGrantRevokeShadow,
} from "./delegationGrantLifecycleShadowService.js";

export const SPEC011_DELEGATION_LIVE_CANARY_VERSION =
  "spec011-delegation-live-lifecycle-canary-v1";
export const SPEC011_DELEGATION_MIGRATION_CHECKSUM =
  "27de4ec34d92ef4d6c5440847890ffc9c05a91546aa16af3e03aac89496d1774";

export const DELEGATION_LIFECYCLE_CANARY_CONFIRMATIONS = Object.freeze({
  staging: "EXECUTE_SPEC011_STAGING_DELEGATION_LIFECYCLE_CANARY",
  production: "EXECUTE_SPEC011_PRODUCTION_DELEGATION_LIFECYCLE_CANARY",
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const TARGETS = new Set(["staging", "production"]);
const EXECUTION_DECISIONS = new Set(["verified_success", "idempotent_replay"]);
const SECRET_KEY_PATTERN = /(?:^|_)(?:password|passwd|secret(?!s_included$)|token|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization_header|cookie|session)(?:$|_)/i;
const SECRET_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\-/]+=*/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:ghp_|github_pat_|ya29\.)[A-Za-z0-9_.\-]+\b/,
];

function canaryError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function compact(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(stable(value));
  return createHash("sha256").update(serialized).digest("hex");
}

function deterministicUuid(seed) {
  const source = sha256(seed).slice(0, 32).split("");
  source[12] = "4";
  source[16] = "8";
  const hex = source.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function assertSecretFree(value, path = "input", depth = 0) {
  if (depth > 14) throw canaryError("DELEGATION_CANARY_INPUT_DEPTH_EXCEEDED", "Canary input exceeds maximum depth.", { path });
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw canaryError("DELEGATION_CANARY_SECRET_VALUE_REJECTED", `Secret-like value is not allowed at ${path}.`, { path });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key) && key !== "secrets_included") {
      throw canaryError("DELEGATION_CANARY_SECRET_FIELD_REJECTED", `Secret-like field is not allowed at ${path}.${key}.`, {
        path: `${path}.${key}`,
      });
    }
    assertSecretFree(nested, `${path}.${key}`, depth + 1);
  }
}

function normalizeUuid(value, field) {
  const normalized = compact(value, 64).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw canaryError("DELEGATION_CANARY_UUID_INVALID", `${field} must be a UUID.`, { field });
  return normalized;
}

function normalizeHash(value, field) {
  const normalized = compact(value, 64).toLowerCase();
  if (!HASH_PATTERN.test(normalized)) throw canaryError("DELEGATION_CANARY_HASH_INVALID", `${field} must be a SHA-256 digest.`, { field });
  return normalized;
}

function normalizeIso(value, field) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw canaryError("DELEGATION_CANARY_TIME_INVALID", `${field} must be a valid timestamp.`, { field });
  return date.toISOString();
}

function normalizeTarget(value) {
  const target = compact(value, 32).toLowerCase();
  if (!TARGETS.has(target)) throw canaryError("DELEGATION_CANARY_TARGET_INVALID", "target_environment must be staging or production.");
  return target;
}

function exactActionSet(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((entry) => compact(entry, 32).toLowerCase()).filter(Boolean))].sort();
}

function readinessBlockers({ target, expectedChecksum, runtimeStatus = {}, migrationReadiness = {}, deploymentParity = {}, migrationAuthorization = {} }) {
  const blockers = [];
  if (runtimeStatus.runtime_enabled !== true) blockers.push("DELEGATION_RUNTIME_BINDING_DISABLED");
  if (runtimeStatus.certified !== true) blockers.push("DELEGATION_RUNTIME_BINDING_NOT_CERTIFIED");
  if (runtimeStatus.checksum_pin_present !== true) blockers.push("DELEGATION_RUNTIME_CHECKSUM_PIN_MISSING");
  const actions = exactActionSet(runtimeStatus.allowed_actions);
  for (const action of ["create", "expire", "revoke"]) {
    if (!actions.includes(action)) blockers.push(`DELEGATION_RUNTIME_ACTION_${action.toUpperCase()}_MISSING`);
  }
  if (runtimeStatus.public_route_added === true) blockers.push("DELEGATION_PUBLIC_ROUTE_FORBIDDEN");
  if (runtimeStatus.runtime_policy_ready_promoted === true) blockers.push("DELEGATION_RUNTIME_POLICY_PROMOTION_FORBIDDEN");
  if (migrationReadiness.status !== "verified_applied") blockers.push("DELEGATION_MIGRATION_NOT_VERIFIED_APPLIED");
  if (migrationReadiness.migration_applied !== true) blockers.push("DELEGATION_MIGRATION_NOT_APPLIED");
  if (migrationReadiness.readback_complete !== true) blockers.push("DELEGATION_MIGRATION_READBACK_INCOMPLETE");
  if (migrationReadiness.checksum_pin_match !== true) blockers.push("DELEGATION_MIGRATION_CHECKSUM_PIN_MISMATCH");
  if (compact(migrationReadiness.migration_checksum_sha256, 64).toLowerCase() !== expectedChecksum) {
    blockers.push("DELEGATION_MIGRATION_CHECKSUM_MISMATCH");
  }
  if (!HASH_PATTERN.test(compact(migrationReadiness.schema_readback_fingerprint, 64).toLowerCase())) {
    blockers.push("DELEGATION_SCHEMA_READBACK_FINGERPRINT_REQUIRED");
  }
  if (migrationAuthorization.target_environment !== target) blockers.push("DELEGATION_MIGRATION_AUTHORIZATION_TARGET_MISMATCH");
  if (migrationAuthorization.authorized !== true) blockers.push("DELEGATION_MIGRATION_AUTHORIZATION_REQUIRED");
  if (migrationAuthorization.ledger_readback_complete !== true) blockers.push("DELEGATION_MIGRATION_LEDGER_READBACK_REQUIRED");
  if (migrationAuthorization.schema_readback_complete !== true) blockers.push("DELEGATION_MIGRATION_SCHEMA_READBACK_REQUIRED");
  if (compact(migrationAuthorization.expected_checksum_sha256, 64).toLowerCase() !== expectedChecksum) {
    blockers.push("DELEGATION_MIGRATION_AUTHORIZATION_CHECKSUM_MISMATCH");
  }
  if (target === "production") {
    if (deploymentParity.parity !== "verified") blockers.push("DELEGATION_PRODUCTION_DEPLOYMENT_PARITY_REQUIRED");
    if (!/^[0-9a-f]{40}$/.test(compact(deploymentParity.deployed_sha, 40).toLowerCase())) {
      blockers.push("DELEGATION_PRODUCTION_DEPLOYED_SHA_REQUIRED");
    }
    if (deploymentParity.same_cycle_readback_complete !== true) blockers.push("DELEGATION_PRODUCTION_SAME_CYCLE_READBACK_REQUIRED");
  }
  return [...new Set(blockers)];
}

export function assessDelegationLiveLifecycleReadiness({
  target_environment,
  expected_migration_checksum_sha256 = SPEC011_DELEGATION_MIGRATION_CHECKSUM,
  runtime_status = {},
  migration_readiness = {},
  migration_authorization = {},
  deployment_parity = {},
} = {}) {
  assertSecretFree({ runtime_status, migration_readiness, migration_authorization, deployment_parity }, "readiness");
  const target = normalizeTarget(target_environment);
  const expectedChecksum = normalizeHash(expected_migration_checksum_sha256, "expected_migration_checksum_sha256");
  if (expectedChecksum !== SPEC011_DELEGATION_MIGRATION_CHECKSUM) {
    throw canaryError("DELEGATION_CANARY_MIGRATION_CHECKSUM_UNRECOGNIZED", "The live canary must use the certified Spec 011 migration checksum.");
  }
  const blockers = readinessBlockers({
    target,
    expectedChecksum,
    runtimeStatus: runtime_status,
    migrationReadiness: migration_readiness,
    migrationAuthorization: migration_authorization,
    deploymentParity: deployment_parity,
  });
  const report = {
    schema_version: 1,
    report_type: "spec011_delegation_live_lifecycle_readiness",
    version: SPEC011_DELEGATION_LIVE_CANARY_VERSION,
    target_environment: target,
    expected_migration_checksum_sha256: expectedChecksum,
    ready: blockers.length === 0,
    blockers,
    runtime_status: stable(runtime_status),
    migration_readiness: stable(migration_readiness),
    migration_authorization: stable(migration_authorization),
    deployment_parity: stable(deployment_parity),
    live_mutation_executed: false,
    runtime_policy_ready_promoted: false,
    public_route_added: false,
    provider_call_performed: false,
    secrets_included: false,
  };
  return Object.freeze({ ...report, readiness_fingerprint_sha256: sha256(report) });
}

function lifecycleIdentifiers(canaryId, suffix) {
  return {
    operationId: deterministicUuid(`${canaryId}:${suffix}:operation`),
    stepId: deterministicUuid(`${canaryId}:${suffix}:step`),
    idempotencyKey: `${canaryId}:${suffix}`.slice(0, 191),
  };
}

function ensurePlanEligible(plan, stage) {
  if (plan?.decision !== "eligible_shadow" || plan?.execution_performed !== false || !HASH_PATTERN.test(compact(plan?.request_fingerprint, 64))) {
    throw canaryError("DELEGATION_CANARY_PLAN_NOT_ELIGIBLE", "Lifecycle plan is not eligible for governed execution.", { stage });
  }
  return plan;
}

function buildAuthorization({ capabilityEnvelopeId, approvalHoldId, resourceAuthorityRef, plan }) {
  return {
    approved: true,
    capability_envelope_id: capabilityEnvelopeId,
    approval_hold_id: approvalHoldId,
    resource_authority_ref: resourceAuthorityRef,
    expected_request_fingerprint: plan.request_fingerprint,
  };
}

function validateExecutionResult(result, stage) {
  const decision = compact(result?.decision, 64);
  if (!EXECUTION_DECISIONS.has(decision)) {
    return {
      ok: false,
      status: "reconciliation_required",
      stage,
      decision: decision || null,
      automatic_retry_allowed: false,
      receipt: stable(result?.receipt || null),
      secrets_included: false,
    };
  }
  if (!result?.grant || !result?.receipt || result?.retry_allowed !== false
      || result?.guarantees?.same_cycle_grant_readback !== true
      || result?.guarantees?.same_cycle_receipt_readback !== true
      || result?.guarantees?.provider_call_performed === true
      || result?.runtime_policy_ready_promoted === true
      || result?.public_route_added === true
      || result?.secrets_included !== false) {
    throw canaryError("DELEGATION_CANARY_EXECUTION_RECEIPT_INVALID", "Lifecycle execution did not return a complete fail-closed receipt.", { stage });
  }
  return { ok: true, status: "verified", stage, result };
}

function makePreview({ input, planBoundSession, agent, existingDelegations, now, projectPreview }) {
  const preview = projectPreview({
    input,
    planBoundSession,
    agent,
    existingDelegations,
    now,
  });
  if (preview?.decision !== "eligible_preview" || preview?.execution_performed !== false || !HASH_PATTERN.test(compact(preview?.grant_hash, 64))) {
    throw canaryError("DELEGATION_CANARY_PREVIEW_NOT_ELIGIBLE", "Delegation grant preview is not eligible.", {
      blockers: preview?.blockers || [],
    });
  }
  return preview;
}

export function buildDelegationLiveLifecycleCanaryPlan({
  canary_id,
  target_environment,
  tenant_id,
  requested_by,
  principal_scope = "admin",
  resource_authority_ref,
  capability_envelope_id,
  approval_hold_id,
  plan_bound_session,
  agent,
  existing_delegations = [],
  revoke_preview_input,
  expire_preview_input,
  create_at,
  revoke_at,
  expire_at,
  readiness,
} = {}, deps = {}) {
  assertSecretFree({
    canary_id,
    target_environment,
    tenant_id,
    requested_by,
    principal_scope,
    resource_authority_ref,
    plan_bound_session,
    agent,
    existing_delegations,
    revoke_preview_input,
    expire_preview_input,
    readiness,
  }, "canary_plan");
  const canaryId = compact(canary_id, 120);
  if (!canaryId || !/^[A-Za-z0-9._:-]+$/.test(canaryId)) throw canaryError("DELEGATION_CANARY_ID_INVALID", "canary_id is required and must be stable.");
  const target = normalizeTarget(target_environment);
  const tenantId = normalizeUuid(tenant_id, "tenant_id");
  const capabilityEnvelopeId = normalizeUuid(capability_envelope_id, "capability_envelope_id");
  const approvalHoldId = normalizeUuid(approval_hold_id, "approval_hold_id");
  const requestedBy = compact(requested_by, 191);
  const principalScope = compact(principal_scope, 32).toLowerCase();
  const resourceAuthorityRef = compact(resource_authority_ref, 500);
  if (!requestedBy || !resourceAuthorityRef) throw canaryError("DELEGATION_CANARY_AUTHORITY_CONTEXT_REQUIRED", "requested_by and resource_authority_ref are required.");
  if (!readiness?.ready) throw canaryError("DELEGATION_CANARY_READINESS_REQUIRED", "A passing live-readiness report is required.", { blockers: readiness?.blockers || [] });
  if (readiness.target_environment !== target || readiness.expected_migration_checksum_sha256 !== SPEC011_DELEGATION_MIGRATION_CHECKSUM) {
    throw canaryError("DELEGATION_CANARY_READINESS_MISMATCH", "Readiness report does not match the canary target or migration checksum.");
  }
  const createAt = normalizeIso(create_at, "create_at");
  const revokeAt = normalizeIso(revoke_at, "revoke_at");
  const expireAt = normalizeIso(expire_at, "expire_at");
  if (new Date(revokeAt) <= new Date(createAt) || new Date(expireAt) <= new Date(createAt)) {
    throw canaryError("DELEGATION_CANARY_SEQUENCE_TIME_INVALID", "revoke_at and expire_at must be after create_at.");
  }
  const projectPreview = deps.projectPreview || projectDelegationGrantPreview;
  const planCreate = deps.planCreate || planDelegationGrantCreateShadow;
  const planRevoke = deps.planRevoke || planDelegationGrantRevokeShadow;
  const planExpire = deps.planExpire || planDelegationGrantExpireShadow;

  const revokePreview = makePreview({
    input: revoke_preview_input,
    planBoundSession: plan_bound_session,
    agent,
    existingDelegations: existing_delegations,
    now: createAt,
    projectPreview,
  });
  const revokeCreateIds = lifecycleIdentifiers(canaryId, "revoke-create");
  const revokeCreate = ensurePlanEligible(planCreate({
    preview: revokePreview,
    schemaReadiness: readiness.migration_readiness,
    expectedPreviewGrantHash: revokePreview.grant_hash,
    ...revokeCreateIds,
    requestedBy,
    principalScope,
    providerOrAdapter: "mariadb",
    now: createAt,
  }), "revoke_create");
  const revokeGrant = revokeCreate.command_preview.grant;
  const revokeIds = lifecycleIdentifiers(canaryId, "revoke");
  const revoke = ensurePlanEligible(planRevoke({
    grant: revokeGrant,
    schemaReadiness: readiness.migration_readiness,
    expectedGrantHash: revokeCreate.command_preview.canonical_grant_hash,
    ...revokeIds,
    requestedBy,
    principalScope,
    providerOrAdapter: "mariadb",
    reason: `Spec 011 ${target} lifecycle canary revoke`,
    now: revokeAt,
  }), "revoke");

  const expirePreview = makePreview({
    input: expire_preview_input,
    planBoundSession: plan_bound_session,
    agent,
    existingDelegations: existing_delegations,
    now: createAt,
    projectPreview,
  });
  if (expirePreview.grant.grant_id === revokePreview.grant.grant_id) {
    throw canaryError("DELEGATION_CANARY_GRANTS_NOT_DISTINCT", "Revoke and expire canary grants must be distinct.");
  }
  const expireCreateIds = lifecycleIdentifiers(canaryId, "expire-create");
  const expireCreate = ensurePlanEligible(planCreate({
    preview: expirePreview,
    schemaReadiness: readiness.migration_readiness,
    expectedPreviewGrantHash: expirePreview.grant_hash,
    ...expireCreateIds,
    requestedBy,
    principalScope,
    providerOrAdapter: "mariadb",
    now: createAt,
  }), "expire_create");
  const expireGrant = expireCreate.command_preview.grant;
  if (new Date(expireGrant.expires_at) > new Date(expireAt)) {
    throw canaryError("DELEGATION_CANARY_EXPIRE_TIME_TOO_EARLY", "expire_at must be at or after the grant expiry.", {
      grant_expires_at: expireGrant.expires_at,
      expire_at: expireAt,
    });
  }
  const expireIds = lifecycleIdentifiers(canaryId, "expire");
  const expire = ensurePlanEligible(planExpire({
    grant: expireGrant,
    schemaReadiness: readiness.migration_readiness,
    expectedGrantHash: expireCreate.command_preview.canonical_grant_hash,
    ...expireIds,
    requestedBy,
    principalScope: "system",
    providerOrAdapter: "mariadb",
    now: expireAt,
  }), "expire");

  const report = {
    schema_version: 1,
    report_type: "spec011_delegation_live_lifecycle_canary_plan",
    version: SPEC011_DELEGATION_LIVE_CANARY_VERSION,
    canary_id: canaryId,
    target_environment: target,
    tenant_id: tenantId,
    capability_envelope_id: capabilityEnvelopeId,
    approval_hold_id: approvalHoldId,
    resource_authority_ref: resourceAuthorityRef,
    readiness_fingerprint_sha256: readiness.readiness_fingerprint_sha256,
    plans: { revoke_create: revokeCreate, revoke, expire_create: expireCreate, expire },
    expected_mutation_count: 4,
    expected_terminal_statuses: { revoke_grant: "revoked", expire_grant: "expired" },
    execution_performed: false,
    automatic_retry_allowed: false,
    runtime_policy_ready_promoted: false,
    public_route_added: false,
    provider_call_performed: false,
    secrets_included: false,
  };
  return Object.freeze({ ...report, canary_plan_fingerprint_sha256: sha256(report) });
}

export async function executeDelegationLiveLifecycleCanary({
  plan,
  confirmation,
  authorization_context = {},
} = {}, deps = {}) {
  assertSecretFree({ plan, confirmation, authorization_context }, "canary_execute");
  if (!plan || plan.version !== SPEC011_DELEGATION_LIVE_CANARY_VERSION || plan.execution_performed !== false) {
    throw canaryError("DELEGATION_CANARY_PLAN_REQUIRED", "A valid unexecuted canary plan is required.");
  }
  const expectedConfirmation = DELEGATION_LIFECYCLE_CANARY_CONFIRMATIONS[plan.target_environment];
  if (confirmation !== expectedConfirmation) {
    return {
      ok: true,
      status: "awaiting_approval",
      required_confirmation: expectedConfirmation,
      target_environment: plan.target_environment,
      live_mutation_executed: false,
      secrets_included: false,
    };
  }
  const runtimeBinding = deps.runtimeBinding;
  const repository = deps.repository;
  if (!runtimeBinding || typeof runtimeBinding.execute !== "function" || typeof runtimeBinding.status !== "function" || typeof runtimeBinding.readiness !== "function") {
    throw canaryError("DELEGATION_CANARY_RUNTIME_BINDING_REQUIRED", "Certified MariaDB runtime binding is required.");
  }
  if (!repository || typeof repository.inspectGrant !== "function" || typeof repository.inspectReceipt !== "function") {
    throw canaryError("DELEGATION_CANARY_READ_REPOSITORY_REQUIRED", "Delegation read repository is required.");
  }
  const currentStatus = runtimeBinding.status();
  const currentReadiness = await runtimeBinding.readiness({ force: true, now: plan.plans.revoke_create.generated_at });
  const revalidated = assessDelegationLiveLifecycleReadiness({
    target_environment: plan.target_environment,
    expected_migration_checksum_sha256: SPEC011_DELEGATION_MIGRATION_CHECKSUM,
    runtime_status: currentStatus,
    migration_readiness: currentReadiness,
    migration_authorization: authorization_context.migration_authorization,
    deployment_parity: authorization_context.deployment_parity,
  });
  if (!revalidated.ready || revalidated.readiness_fingerprint_sha256 !== plan.readiness_fingerprint_sha256) {
    return {
      ok: false,
      status: "blocked",
      blocker: "delegation_live_readiness_drift",
      original_readiness_fingerprint_sha256: plan.readiness_fingerprint_sha256,
      current_readiness: revalidated,
      live_mutation_executed: false,
      secrets_included: false,
    };
  }
  const authBase = {
    capabilityEnvelopeId: normalizeUuid(plan.capability_envelope_id, "plan.capability_envelope_id"),
    approvalHoldId: normalizeUuid(plan.approval_hold_id, "plan.approval_hold_id"),
    resourceAuthorityRef: compact(plan.resource_authority_ref, 500),
  };
  const inspect = deps.inspect || inspectDelegationGrantLifecycleShadow;
  const steps = [];

  const executeStep = async (name, lifecyclePlan, now) => {
    const result = await runtimeBinding.execute({
      plan: lifecyclePlan,
      tenantId: plan.tenant_id,
      authorization: buildAuthorization({ ...authBase, plan: lifecyclePlan }),
      now,
    });
    const validated = validateExecutionResult(result, name);
    steps.push(validated);
    return validated;
  };
  const stopIfUncertain = (validated) => validated.ok === false;

  const revokeCreate = await executeStep("revoke_create", plan.plans.revoke_create, plan.plans.revoke_create.generated_at);
  if (stopIfUncertain(revokeCreate)) return { ok: false, status: "reconciliation_required", steps, automatic_retry_allowed: false, secrets_included: false };
  const revokeCreateReadback = await inspect({
    repository,
    grantId: revokeCreate.result.grant.grant_id,
    tenantId: plan.tenant_id,
    now: plan.plans.revoke_create.generated_at,
  });
  if (revokeCreateReadback.grant.status !== "active") throw canaryError("DELEGATION_CANARY_CREATE_READBACK_INVALID", "Revoke canary grant was not active after create.");

  const revoke = await executeStep("revoke", plan.plans.revoke, plan.plans.revoke.generated_at);
  if (stopIfUncertain(revoke)) return { ok: false, status: "reconciliation_required", steps, automatic_retry_allowed: false, secrets_included: false };
  const revokeReadback = await inspect({
    repository,
    grantId: revoke.result.grant.grant_id,
    tenantId: plan.tenant_id,
    now: plan.plans.revoke.generated_at,
  });
  if (revokeReadback.grant.status !== "revoked") throw canaryError("DELEGATION_CANARY_REVOKE_READBACK_INVALID", "Revoke canary did not reach revoked status.");

  const expireCreate = await executeStep("expire_create", plan.plans.expire_create, plan.plans.expire_create.generated_at);
  if (stopIfUncertain(expireCreate)) return { ok: false, status: "reconciliation_required", steps, automatic_retry_allowed: false, secrets_included: false };
  const expireCreateReadback = await inspect({
    repository,
    grantId: expireCreate.result.grant.grant_id,
    tenantId: plan.tenant_id,
    now: plan.plans.expire_create.generated_at,
  });
  if (expireCreateReadback.grant.status !== "active") throw canaryError("DELEGATION_CANARY_CREATE_READBACK_INVALID", "Expire canary grant was not active after create.");

  const expire = await executeStep("expire", plan.plans.expire, plan.plans.expire.generated_at);
  if (stopIfUncertain(expire)) return { ok: false, status: "reconciliation_required", steps, automatic_retry_allowed: false, secrets_included: false };
  const expireReadback = await inspect({
    repository,
    grantId: expire.result.grant.grant_id,
    tenantId: plan.tenant_id,
    now: plan.plans.expire.generated_at,
  });
  if (expireReadback.grant.status !== "expired" || expireReadback.observed_expired !== true) {
    throw canaryError("DELEGATION_CANARY_EXPIRE_READBACK_INVALID", "Expire canary did not reach verified expired status.");
  }

  const report = {
    schema_version: 1,
    report_type: "spec011_delegation_live_lifecycle_canary_result",
    version: SPEC011_DELEGATION_LIVE_CANARY_VERSION,
    canary_id: plan.canary_id,
    target_environment: plan.target_environment,
    tenant_id: plan.tenant_id,
    status: "verified_complete",
    mutation_count: 4,
    steps,
    terminal_readback: {
      revoke_grant_id: revokeReadback.grant.grant_id,
      revoke_status: revokeReadback.grant.status,
      revoke_readback_fingerprint: revokeReadback.readback_fingerprint,
      expire_grant_id: expireReadback.grant.grant_id,
      expire_status: expireReadback.grant.status,
      expire_readback_fingerprint: expireReadback.readback_fingerprint,
    },
    automatic_retry_allowed: false,
    runtime_policy_ready_promoted: false,
    public_route_added: false,
    provider_call_performed: false,
    secrets_included: false,
  };
  return Object.freeze({ ...report, canary_result_fingerprint_sha256: sha256(report) });
}

export const _testingSpec011DelegationLiveLifecycleCanary = {
  stable,
  sha256,
  deterministicUuid,
  assertSecretFree,
  readinessBlockers,
  lifecycleIdentifiers,
  buildAuthorization,
  validateExecutionResult,
};
