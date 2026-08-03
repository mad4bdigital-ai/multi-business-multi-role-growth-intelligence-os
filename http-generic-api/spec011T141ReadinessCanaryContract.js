import { createHash } from "node:crypto";

export const SPEC011_T141_CANARY_CONTRACT_VERSION =
  "spec011-t141-readiness-canary-contract-v1";

export const SPEC011_T141_CANARY_MUTATIONS = Object.freeze([
  "primary_create",
  "primary_revoke",
  "expiry_create",
  "expiry_expire",
]);

export const SPEC011_T141_CANARY_STEPS = Object.freeze([
  "inspect_primary_absent",
  "primary_create",
  "inspect_primary_active",
  "primary_revoke",
  "inspect_primary_revoked",
  "expiry_create",
  "inspect_expiry_active",
  "expiry_expire",
  "inspect_expiry_expired",
  "inspect_mutation_receipts",
]);

const ENVIRONMENTS = new Set(["staging", "production"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SECRET_KEY_PATTERN = /(?:^|_)(?:password|passwd|secret(?!s_included$)|token|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session)(?:$|_)/i;
const SECRET_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\-/]+=*/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:ghp_|github_pat_|ya29\.)[A-Za-z0-9_.\-]+\b/,
];

function contractError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function compact(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(stable(value)))
    .digest("hex");
}

function assertSecretFree(value, path = "input", depth = 0) {
  if (depth > 16) {
    throw contractError("T141_CANARY_INPUT_DEPTH_EXCEEDED", "T141 canary input exceeds maximum depth.", { path });
  }
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw contractError("T141_CANARY_SECRET_VALUE_REJECTED", `Secret-like value is not allowed at ${path}.`, { path });
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
      throw contractError("T141_CANARY_SECRET_FIELD_REJECTED", `Secret-like field is not allowed at ${path}.${key}.`, {
        path: `${path}.${key}`,
      });
    }
    assertSecretFree(nested, `${path}.${key}`, depth + 1);
  }
}

function normalizeEnvironment(value) {
  const environment = compact(value, 32).toLowerCase();
  if (!ENVIRONMENTS.has(environment)) {
    throw contractError("T141_CANARY_ENVIRONMENT_INVALID", "environment must be staging or production.");
  }
  return environment;
}

function normalizeUuid(value, field) {
  const normalized = compact(value, 64).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw contractError("T141_CANARY_UUID_INVALID", `${field} must be a UUID.`, { field });
  }
  return normalized;
}

function normalizeHash(value, field) {
  const normalized = compact(value, 64).toLowerCase();
  if (!HASH_PATTERN.test(normalized)) {
    throw contractError("T141_CANARY_HASH_INVALID", `${field} must be a SHA-256 hash.`, { field });
  }
  return normalized;
}

function normalizeCommitSha(value, field) {
  const normalized = compact(value, 40).toLowerCase();
  if (!COMMIT_SHA_PATTERN.test(normalized)) {
    throw contractError("T141_CANARY_COMMIT_SHA_INVALID", `${field} must be a full commit SHA.`, { field });
  }
  return normalized;
}

function normalizeDate(value, field) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    throw contractError("T141_CANARY_DATE_INVALID", `${field} must be an ISO date-time.`, { field });
  }
  return new Date(timestamp).toISOString();
}

function readinessBlockers({ environment, migrationReadiness = {}, runtimeBindingStatus = {}, deploymentReadback = {}, target = {} }) {
  const blockers = [];
  if (migrationReadiness.status !== "verified_applied") blockers.push("T141_MIGRATION_NOT_VERIFIED_APPLIED");
  if (migrationReadiness.migration_applied !== true) blockers.push("T141_MIGRATION_NOT_APPLIED");
  if (migrationReadiness.readback_complete !== true) blockers.push("T141_MIGRATION_READBACK_INCOMPLETE");
  if (migrationReadiness.checksum_pin_match !== true) blockers.push("T141_MIGRATION_CHECKSUM_PIN_MISMATCH");
  if (!HASH_PATTERN.test(compact(migrationReadiness.migration_checksum_sha256, 64).toLowerCase())) {
    blockers.push("T141_MIGRATION_CHECKSUM_REQUIRED");
  }
  if (!HASH_PATTERN.test(compact(migrationReadiness.schema_readback_fingerprint, 64).toLowerCase())) {
    blockers.push("T141_SCHEMA_READBACK_FINGERPRINT_REQUIRED");
  }
  if (!Number.isInteger(Number(migrationReadiness.statement_count)) || Number(migrationReadiness.statement_count) < 1) {
    blockers.push("T141_MIGRATION_STATEMENT_COUNT_REQUIRED");
  }
  if (!compact(migrationReadiness.ledger_reference, 500)) blockers.push("T141_MIGRATION_LEDGER_REFERENCE_REQUIRED");
  if (migrationReadiness.environment_authorized !== true) blockers.push("T141_ENVIRONMENT_AUTHORIZATION_REQUIRED");
  if (environment === "production" && migrationReadiness.production_authorized !== true) {
    blockers.push("T141_PRODUCTION_MIGRATION_AUTHORIZATION_REQUIRED");
  }

  if (runtimeBindingStatus.runtime_enabled !== true) blockers.push("T141_RUNTIME_BINDING_DISABLED");
  if (runtimeBindingStatus.certified !== true) blockers.push("T141_RUNTIME_BINDING_NOT_CERTIFIED");
  if (runtimeBindingStatus.checksum_pin_present !== true) blockers.push("T141_RUNTIME_CHECKSUM_PIN_REQUIRED");
  const allowedActions = new Set(Array.isArray(runtimeBindingStatus.allowed_actions)
    ? runtimeBindingStatus.allowed_actions.map((entry) => compact(entry, 32).toLowerCase())
    : []);
  for (const action of ["create", "revoke", "expire"]) {
    if (!allowedActions.has(action)) blockers.push(`T141_RUNTIME_ACTION_${action.toUpperCase()}_NOT_ALLOWED`);
  }
  if (runtimeBindingStatus.public_route_added !== false) blockers.push("T141_PUBLIC_ROUTE_MUST_REMAIN_DISABLED");
  if (runtimeBindingStatus.runtime_policy_ready_promoted !== false) blockers.push("T141_RUNTIME_POLICY_READY_PROMOTION_FORBIDDEN");

  const expectedSha = compact(deploymentReadback.expected_deployed_sha, 40).toLowerCase();
  const observedSha = compact(deploymentReadback.runtime_deployed_sha, 40).toLowerCase();
  if (!COMMIT_SHA_PATTERN.test(expectedSha) || !COMMIT_SHA_PATTERN.test(observedSha)) {
    blockers.push("T141_DEPLOYED_SHA_READBACK_REQUIRED");
  } else if (expectedSha !== observedSha) {
    blockers.push("T141_DEPLOYED_SHA_MISMATCH");
  }
  if (deploymentReadback.same_cycle_readback !== true) blockers.push("T141_SAME_CYCLE_DEPLOYMENT_READBACK_REQUIRED");
  if (deploymentReadback.healthy !== true) blockers.push("T141_RUNTIME_HEALTH_REQUIRED");
  if (environment === "production" && deploymentReadback.production_parity_verified !== true) {
    blockers.push("T141_PRODUCTION_PARITY_REQUIRED");
  }

  const databaseName = compact(target.database_name, 191);
  if (!databaseName) blockers.push("T141_DATABASE_NAME_REQUIRED");
  if (/^(?:spec011_|test_|tmp_|ci_)/i.test(databaseName)) blockers.push("T141_DISPOSABLE_DATABASE_FORBIDDEN");
  if (compact(target.environment, 32).toLowerCase() !== environment) blockers.push("T141_TARGET_ENVIRONMENT_MISMATCH");
  if (!UUID_PATTERN.test(compact(target.tenant_id, 64).toLowerCase())) blockers.push("T141_TARGET_TENANT_ID_REQUIRED");
  return [...new Set(blockers)];
}

function normalizePlan(plan = {}, expectedAction, field) {
  if (plan.report_type !== "delegation_grant_lifecycle_shadow_plan" || plan.decision !== "eligible_shadow") {
    throw contractError("T141_CANARY_PLAN_NOT_ELIGIBLE", `${field} must be an eligible delegation lifecycle shadow plan.`, {
      field,
    });
  }
  if (plan.action !== expectedAction || plan.command_preview?.action !== expectedAction) {
    throw contractError("T141_CANARY_PLAN_ACTION_MISMATCH", `${field} action must be ${expectedAction}.`, { field });
  }
  const requestFingerprint = normalizeHash(plan.request_fingerprint, `${field}.request_fingerprint`);
  const receipt = plan.receipt || {};
  if (
    receipt.state !== "pending"
    || receipt.outcome_classification !== "pending"
    || receipt.retry_allowed !== false
    || receipt.readback_complete !== false
  ) {
    throw contractError("T141_CANARY_PENDING_RECEIPT_REQUIRED", `${field} must carry a fail-closed pending receipt.`, { field });
  }
  if (normalizeHash(receipt.request_fingerprint, `${field}.receipt.request_fingerprint`) !== requestFingerprint) {
    throw contractError("T141_CANARY_RECEIPT_FINGERPRINT_MISMATCH", `${field} receipt fingerprint does not match its plan.`, {
      field,
    });
  }
  if (plan.execution_performed !== false) {
    throw contractError("T141_CANARY_PLAN_ALREADY_EXECUTED", `${field} must not claim prior execution.`, { field });
  }
  return {
    action: expectedAction,
    request_fingerprint: requestFingerprint,
    grant_id: normalizeUuid(
      expectedAction === "create" ? plan.command_preview?.grant?.grant_id : plan.command_preview?.grant_id,
      `${field}.grant_id`,
    ),
    receipt_id: normalizeUuid(receipt.receipt_id, `${field}.receipt.receipt_id`),
    operation_id: normalizeUuid(receipt.operation_id, `${field}.receipt.operation_id`),
    step_id: normalizeUuid(receipt.step_id, `${field}.receipt.step_id`),
    idempotency_key: compact(receipt.idempotency_key, 191),
    expected_status: compact(plan.command_preview?.expected_status, 32).toLowerCase(),
    proposed_status: compact(plan.command_preview?.proposed_status, 32).toLowerCase(),
    raw_plan: structuredClone(plan),
  };
}

function normalizeAuthorization(binding = {}, plan, field, environment, now) {
  if (binding.approved !== true) {
    throw contractError("T141_CANARY_AUTHORIZATION_REQUIRED", `${field} must be approved.`, { field });
  }
  const expiresAt = normalizeDate(binding.expires_at, `${field}.expires_at`);
  if (new Date(expiresAt).getTime() <= new Date(now).getTime()) {
    throw contractError("T141_CANARY_AUTHORIZATION_EXPIRED", `${field} is expired.`, { field });
  }
  if (compact(binding.environment, 32).toLowerCase() !== environment) {
    throw contractError("T141_CANARY_AUTHORIZATION_ENVIRONMENT_MISMATCH", `${field} environment does not match.`, {
      field,
    });
  }
  const expectedFingerprint = normalizeHash(
    binding.expected_request_fingerprint,
    `${field}.expected_request_fingerprint`,
  );
  if (expectedFingerprint !== plan.request_fingerprint) {
    throw contractError("T141_CANARY_AUTHORIZATION_STALE", `${field} is not bound to the exact request fingerprint.`, {
      field,
    });
  }
  const resourceAuthorityRef = compact(binding.resource_authority_ref, 500);
  if (!resourceAuthorityRef) {
    throw contractError("T141_CANARY_RESOURCE_AUTHORITY_REQUIRED", `${field} requires resource_authority_ref.`, { field });
  }
  if (binding.secrets_included !== false) {
    throw contractError("T141_CANARY_AUTHORIZATION_SECRETS_FLAG_INVALID", `${field}.secrets_included must be false.`, {
      field,
    });
  }
  return {
    approved: true,
    capability_envelope_id: normalizeUuid(binding.capability_envelope_id, `${field}.capability_envelope_id`),
    approval_hold_id: normalizeUuid(binding.approval_hold_id, `${field}.approval_hold_id`),
    resource_authority_ref: resourceAuthorityRef,
    expected_request_fingerprint: expectedFingerprint,
    environment,
    expires_at: expiresAt,
    secrets_included: false,
  };
}

function ensureUnique(values, code, message) {
  if (new Set(values).size !== values.length) throw contractError(code, message);
}

export function evaluateT141CanaryReadiness({
  environment,
  target = {},
  migration_readiness = {},
  runtime_binding_status = {},
  deployment_readback = {},
} = {}) {
  assertSecretFree({ environment, target, migration_readiness, runtime_binding_status, deployment_readback });
  const normalizedEnvironment = normalizeEnvironment(environment);
  const blockers = readinessBlockers({
    environment: normalizedEnvironment,
    migrationReadiness: migration_readiness,
    runtimeBindingStatus: runtime_binding_status,
    deploymentReadback: deployment_readback,
    target,
  });
  return {
    ok: true,
    report_type: "spec011_t141_canary_readiness",
    version: SPEC011_T141_CANARY_CONTRACT_VERSION,
    environment: normalizedEnvironment,
    decision: blockers.length === 0 ? "ready_for_governed_canary" : "blocked",
    blockers,
    production_authorized: normalizedEnvironment === "production" && migration_readiness.production_authorized === true,
    execution_performed: false,
    migration_applied_by_this_evaluation: false,
    delegation_mutated: false,
    runtime_authority_changed: false,
    secrets_included: false,
  };
}

export function buildT141CanaryContract({
  environment,
  target = {},
  migration_readiness = {},
  runtime_binding_status = {},
  deployment_readback = {},
  plans = {},
  authorization_bindings = {},
  now = new Date().toISOString(),
} = {}) {
  assertSecretFree({ environment, target, migration_readiness, runtime_binding_status, deployment_readback, plans, authorization_bindings });
  const normalizedNow = normalizeDate(now, "now");
  const readiness = evaluateT141CanaryReadiness({
    environment,
    target,
    migration_readiness,
    runtime_binding_status,
    deployment_readback,
  });
  if (readiness.decision !== "ready_for_governed_canary") {
    return {
      ...readiness,
      report_type: "spec011_t141_canary_contract",
      contract_fingerprint_sha256: null,
      steps: [],
      next_action: {
        action: "resolve_t141_canary_readiness_blockers",
        reason_code: readiness.blockers[0] || "T141_CANARY_BLOCKED",
      },
    };
  }

  const normalizedPlans = {
    primary_create: normalizePlan(plans.primary_create, "create", "plans.primary_create"),
    primary_revoke: normalizePlan(plans.primary_revoke, "revoke", "plans.primary_revoke"),
    expiry_create: normalizePlan(plans.expiry_create, "create", "plans.expiry_create"),
    expiry_expire: normalizePlan(plans.expiry_expire, "expire", "plans.expiry_expire"),
  };
  if (normalizedPlans.primary_create.grant_id !== normalizedPlans.primary_revoke.grant_id) {
    throw contractError("T141_CANARY_PRIMARY_GRANT_MISMATCH", "Primary create and revoke plans must target the same grant.");
  }
  if (normalizedPlans.expiry_create.grant_id !== normalizedPlans.expiry_expire.grant_id) {
    throw contractError("T141_CANARY_EXPIRY_GRANT_MISMATCH", "Expiry create and expire plans must target the same grant.");
  }
  if (normalizedPlans.primary_create.grant_id === normalizedPlans.expiry_create.grant_id) {
    throw contractError("T141_CANARY_GRANT_IDS_MUST_DIFFER", "Primary and expiry canary grants must be distinct.");
  }
  ensureUnique(
    Object.values(normalizedPlans).map((plan) => plan.request_fingerprint),
    "T141_CANARY_REQUEST_FINGERPRINT_REUSE",
    "Every mutation must have a unique request fingerprint.",
  );
  ensureUnique(
    Object.values(normalizedPlans).map((plan) => plan.receipt_id),
    "T141_CANARY_RECEIPT_REUSE",
    "Every mutation must have a unique receipt_id.",
  );
  ensureUnique(
    Object.values(normalizedPlans).map((plan) => plan.idempotency_key),
    "T141_CANARY_IDEMPOTENCY_REUSE",
    "Every mutation must have a unique idempotency key.",
  );

  const authorizations = Object.fromEntries(SPEC011_T141_CANARY_MUTATIONS.map((key) => [
    key,
    normalizeAuthorization(
      authorization_bindings[key],
      normalizedPlans[key],
      `authorization_bindings.${key}`,
      readiness.environment,
      normalizedNow,
    ),
  ]));

  const targetDescriptor = {
    environment: readiness.environment,
    tenant_id: normalizeUuid(target.tenant_id, "target.tenant_id"),
    database_name: compact(target.database_name, 191),
    expected_deployed_sha: normalizeCommitSha(deployment_readback.expected_deployed_sha, "deployment_readback.expected_deployed_sha"),
    runtime_deployed_sha: normalizeCommitSha(deployment_readback.runtime_deployed_sha, "deployment_readback.runtime_deployed_sha"),
  };
  const planDescriptor = Object.fromEntries(Object.entries(normalizedPlans).map(([key, plan]) => [key, {
    action: plan.action,
    grant_id: plan.grant_id,
    request_fingerprint: plan.request_fingerprint,
    receipt_id: plan.receipt_id,
    operation_id: plan.operation_id,
    step_id: plan.step_id,
    idempotency_key: plan.idempotency_key,
    expected_status: plan.expected_status,
    proposed_status: plan.proposed_status,
  }]));
  const descriptor = {
    version: SPEC011_T141_CANARY_CONTRACT_VERSION,
    environment: readiness.environment,
    target: targetDescriptor,
    migration_checksum_sha256: normalizeHash(
      migration_readiness.migration_checksum_sha256,
      "migration_readiness.migration_checksum_sha256",
    ),
    migration_ledger_reference: compact(migration_readiness.ledger_reference, 500),
    schema_readback_fingerprint: normalizeHash(
      migration_readiness.schema_readback_fingerprint,
      "migration_readiness.schema_readback_fingerprint",
    ),
    plans: planDescriptor,
    authorization_bindings: authorizations,
    ordered_steps: [...SPEC011_T141_CANARY_STEPS],
    created_at: normalizedNow,
  };
  const contractFingerprint = sha256(descriptor);
  return {
    ok: true,
    report_type: "spec011_t141_canary_contract",
    version: SPEC011_T141_CANARY_CONTRACT_VERSION,
    environment: readiness.environment,
    decision: "ready_for_governed_canary",
    contract_fingerprint_sha256: contractFingerprint,
    target: targetDescriptor,
    migration: {
      checksum_sha256: descriptor.migration_checksum_sha256,
      ledger_reference: descriptor.migration_ledger_reference,
      schema_readback_fingerprint: descriptor.schema_readback_fingerprint,
      production_authorized: readiness.production_authorized,
    },
    plans: planDescriptor,
    authorization_bindings: authorizations,
    steps: SPEC011_T141_CANARY_STEPS.map((step, index) => ({
      sequence: index + 1,
      step,
      mutation: SPEC011_T141_CANARY_MUTATIONS.includes(step),
      retry_allowed_after_unknown_outcome: false,
      same_cycle_readback_required: true,
    })),
    next_action: {
      action: "request_separately_authorized_t141_canary_execution",
      reason_code: readiness.environment === "production"
        ? "T141_PRODUCTION_CANARY_READY"
        : "T141_STAGING_CANARY_READY",
    },
    execution_performed: false,
    migration_applied_by_this_contract: false,
    delegation_mutated: false,
    runtime_authority_changed: false,
    public_route_added: false,
    secrets_included: false,
  };
}

function verifyMutationObservation(key, plan, observation = {}) {
  if (["unknown", "ambiguous", "timeout_after_dispatch"].includes(compact(observation.outcome_classification, 64))) {
    return { unknown: true, blocker: `T141_${key.toUpperCase()}_RECONCILIATION_REQUIRED` };
  }
  const blockers = [];
  if (observation.status !== "verified_success") blockers.push(`T141_${key.toUpperCase()}_NOT_VERIFIED_SUCCESS`);
  if (observation.request_fingerprint !== plan.request_fingerprint) blockers.push(`T141_${key.toUpperCase()}_FINGERPRINT_MISMATCH`);
  if (observation.grant_id !== plan.grant_id) blockers.push(`T141_${key.toUpperCase()}_GRANT_MISMATCH`);
  if (observation.grant_status !== plan.proposed_status) blockers.push(`T141_${key.toUpperCase()}_STATUS_MISMATCH`);
  if (observation.receipt_id !== plan.receipt_id) blockers.push(`T141_${key.toUpperCase()}_RECEIPT_MISMATCH`);
  if (observation.receipt_state !== "reconciled") blockers.push(`T141_${key.toUpperCase()}_RECEIPT_NOT_RECONCILED`);
  if (observation.readback_complete !== true) blockers.push(`T141_${key.toUpperCase()}_READBACK_INCOMPLETE`);
  if (observation.retry_allowed !== false) blockers.push(`T141_${key.toUpperCase()}_RETRY_MUST_REMAIN_FALSE`);
  if (!HASH_PATTERN.test(compact(observation.readback_fingerprint, 64).toLowerCase())) {
    blockers.push(`T141_${key.toUpperCase()}_READBACK_FINGERPRINT_REQUIRED`);
  }
  if (observation.runtime_policy_ready_promoted !== false) blockers.push("T141_RUNTIME_POLICY_READY_PROMOTION_FORBIDDEN");
  if (observation.secrets_included !== false) blockers.push("T141_SECRETS_FLAG_INVALID");
  return { unknown: false, blockers };
}

export function evaluateT141CanaryOutcome({ contract = {}, observations = {}, now = new Date().toISOString() } = {}) {
  assertSecretFree({ contract, observations });
  normalizeDate(now, "now");
  if (contract.report_type !== "spec011_t141_canary_contract" || contract.decision !== "ready_for_governed_canary") {
    throw contractError("T141_CANARY_CONTRACT_NOT_READY", "A ready T141 canary contract is required.");
  }
  normalizeHash(contract.contract_fingerprint_sha256, "contract.contract_fingerprint_sha256");
  const blockers = [];
  const reconciliation = [];
  for (const key of SPEC011_T141_CANARY_MUTATIONS) {
    const result = verifyMutationObservation(key, contract.plans?.[key] || {}, observations.mutations?.[key] || {});
    if (result.unknown) reconciliation.push(result.blocker);
    else blockers.push(...result.blockers);
  }
  const inspections = observations.inspections || {};
  const expectedInspections = {
    primary_absent: "absent",
    primary_active: "active",
    primary_revoked: "revoked",
    expiry_active: "active",
    expiry_expired: "expired",
  };
  for (const [key, expected] of Object.entries(expectedInspections)) {
    if (inspections[key]?.status !== expected || inspections[key]?.readback_complete !== true) {
      blockers.push(`T141_INSPECTION_${key.toUpperCase()}_INVALID`);
    }
  }
  if (observations.receipts?.all_reconciled !== true || observations.receipts?.retry_allowed !== false) {
    blockers.push("T141_RECEIPT_SET_NOT_FULLY_RECONCILED");
  }
  if (!HASH_PATTERN.test(compact(observations.receipts?.set_fingerprint_sha256, 64).toLowerCase())) {
    blockers.push("T141_RECEIPT_SET_FINGERPRINT_REQUIRED");
  }
  if (observations.same_cycle === false) blockers.push("T141_CANARY_SAME_CYCLE_REQUIRED");
  if (observations.runtime_deployed_sha !== contract.target.runtime_deployed_sha) blockers.push("T141_CANARY_RUNTIME_SHA_DRIFT");
  if (observations.secrets_included !== false) blockers.push("T141_CANARY_OBSERVATION_SECRETS_FLAG_INVALID");

  if (reconciliation.length > 0) {
    return {
      ok: true,
      report_type: "spec011_t141_canary_outcome",
      version: SPEC011_T141_CANARY_CONTRACT_VERSION,
      environment: contract.environment,
      status: "reconciliation_required",
      blockers: [...new Set(reconciliation)],
      automatic_mutation_retry_allowed: false,
      t141_completion_eligible: false,
      t261_completion_eligible: false,
      t263_completion_eligible: false,
      execution_verified: false,
      secrets_included: false,
    };
  }

  const uniqueBlockers = [...new Set(blockers)];
  const passed = uniqueBlockers.length === 0;
  const productionEligible = passed
    && contract.environment === "production"
    && contract.migration?.production_authorized === true
    && observations.production_parity_verified === true
    && observations.production_runtime_readback_verified === true;
  return {
    ok: true,
    report_type: "spec011_t141_canary_outcome",
    version: SPEC011_T141_CANARY_CONTRACT_VERSION,
    environment: contract.environment,
    status: passed
      ? (contract.environment === "production" ? "production_canary_verified" : "staging_canary_verified")
      : "failed_closed",
    blockers: uniqueBlockers,
    automatic_mutation_retry_allowed: false,
    t141_completion_eligible: productionEligible,
    t261_completion_eligible: productionEligible,
    t263_completion_eligible: productionEligible,
    execution_verified: passed,
    runtime_policy_ready_promoted: false,
    public_route_added: false,
    secrets_included: false,
  };
}
