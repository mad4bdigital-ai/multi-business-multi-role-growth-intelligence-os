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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SECRET_KEY_PATTERN = /(?:^|_)(?:password|passwd|secret(?!s_included$)|token|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session)(?:$|_)/i;
const SECRET_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\-/]+=*/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:ghp_|github_pat_|ya29\.)[A-Za-z0-9_.\-]+\b/,
];
const ALLOWED_SECURITY_DESCRIPTOR_KEYS = new Set(["authorization_bindings"]);

function fail(code, message, details = {}) {
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
  if (depth > 16) throw fail("T141_CANARY_INPUT_DEPTH_EXCEEDED", "T141 input exceeds maximum depth.", { path });
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw fail("T141_CANARY_SECRET_VALUE_REJECTED", `Secret-like value is not allowed at ${path}.`, { path });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (
      SECRET_KEY_PATTERN.test(key)
      && key !== "secrets_included"
      && !ALLOWED_SECURITY_DESCRIPTOR_KEYS.has(key)
    ) {
      throw fail("T141_CANARY_SECRET_FIELD_REJECTED", `Secret-like field is not allowed at ${path}.${key}.`, {
        path: `${path}.${key}`,
      });
    }
    assertSecretFree(nested, `${path}.${key}`, depth + 1);
  }
}

function environment(value) {
  const normalized = compact(value, 32).toLowerCase();
  if (!ENVIRONMENTS.has(normalized)) throw fail("T141_CANARY_ENVIRONMENT_INVALID", "environment must be staging or production.");
  return normalized;
}

function uuid(value, field) {
  const normalized = compact(value, 64).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw fail("T141_CANARY_UUID_INVALID", `${field} must be a UUID.`, { field });
  return normalized;
}

function hash(value, field) {
  const normalized = compact(value, 64).toLowerCase();
  if (!HASH_PATTERN.test(normalized)) throw fail("T141_CANARY_HASH_INVALID", `${field} must be a SHA-256 hash.`, { field });
  return normalized;
}

function commitSha(value, field) {
  const normalized = compact(value, 40).toLowerCase();
  if (!COMMIT_SHA_PATTERN.test(normalized)) throw fail("T141_CANARY_COMMIT_SHA_INVALID", `${field} must be a full commit SHA.`, { field });
  return normalized;
}

function isoDate(value, field) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw fail("T141_CANARY_DATE_INVALID", `${field} must be an ISO date-time.`, { field });
  return new Date(timestamp).toISOString();
}

function unique(values, code, message) {
  if (new Set(values).size !== values.length) throw fail(code, message);
}

function readinessBlockers({ env, target, migration, runtime, deployment }) {
  const blockers = [];
  if (migration.status !== "verified_applied") blockers.push("T141_MIGRATION_NOT_VERIFIED_APPLIED");
  if (migration.migration_applied !== true) blockers.push("T141_MIGRATION_NOT_APPLIED");
  if (migration.readback_complete !== true) blockers.push("T141_MIGRATION_READBACK_INCOMPLETE");
  if (migration.checksum_pin_match !== true) blockers.push("T141_MIGRATION_CHECKSUM_PIN_MISMATCH");
  if (!HASH_PATTERN.test(compact(migration.migration_checksum_sha256, 64).toLowerCase())) blockers.push("T141_MIGRATION_CHECKSUM_REQUIRED");
  if (!HASH_PATTERN.test(compact(migration.schema_readback_fingerprint, 64).toLowerCase())) blockers.push("T141_SCHEMA_READBACK_FINGERPRINT_REQUIRED");
  if (!Number.isInteger(Number(migration.statement_count)) || Number(migration.statement_count) < 1) blockers.push("T141_MIGRATION_STATEMENT_COUNT_REQUIRED");
  if (!compact(migration.ledger_reference, 500)) blockers.push("T141_MIGRATION_LEDGER_REFERENCE_REQUIRED");
  if (migration.environment_authorized !== true) blockers.push("T141_ENVIRONMENT_AUTHORIZATION_REQUIRED");
  if (env === "production" && migration.production_authorized !== true) blockers.push("T141_PRODUCTION_MIGRATION_AUTHORIZATION_REQUIRED");

  if (runtime.runtime_enabled !== true) blockers.push("T141_RUNTIME_BINDING_DISABLED");
  if (runtime.certified !== true) blockers.push("T141_RUNTIME_BINDING_NOT_CERTIFIED");
  if (runtime.checksum_pin_present !== true) blockers.push("T141_RUNTIME_CHECKSUM_PIN_REQUIRED");
  const allowed = new Set(Array.isArray(runtime.allowed_actions)
    ? runtime.allowed_actions.map((entry) => compact(entry, 32).toLowerCase())
    : []);
  for (const action of ["create", "revoke", "expire"]) {
    if (!allowed.has(action)) blockers.push(`T141_RUNTIME_ACTION_${action.toUpperCase()}_NOT_ALLOWED`);
  }
  if (runtime.public_route_added !== false) blockers.push("T141_PUBLIC_ROUTE_MUST_REMAIN_DISABLED");
  if (runtime.runtime_policy_ready_promoted !== false) blockers.push("T141_RUNTIME_POLICY_READY_PROMOTION_FORBIDDEN");

  const expectedSha = compact(deployment.expected_deployed_sha, 40).toLowerCase();
  const observedSha = compact(deployment.runtime_deployed_sha, 40).toLowerCase();
  if (!COMMIT_SHA_PATTERN.test(expectedSha) || !COMMIT_SHA_PATTERN.test(observedSha)) blockers.push("T141_DEPLOYED_SHA_READBACK_REQUIRED");
  else if (expectedSha !== observedSha) blockers.push("T141_DEPLOYED_SHA_MISMATCH");
  if (deployment.same_cycle_readback !== true) blockers.push("T141_SAME_CYCLE_DEPLOYMENT_READBACK_REQUIRED");
  if (deployment.healthy !== true) blockers.push("T141_RUNTIME_HEALTH_REQUIRED");
  if (env === "production" && deployment.production_parity_verified !== true) blockers.push("T141_PRODUCTION_PARITY_REQUIRED");

  const databaseName = compact(target.database_name, 191);
  if (!databaseName) blockers.push("T141_DATABASE_NAME_REQUIRED");
  if (/^(?:spec011_|test_|tmp_|ci_)/i.test(databaseName)) blockers.push("T141_DISPOSABLE_DATABASE_FORBIDDEN");
  if (compact(target.environment, 32).toLowerCase() !== env) blockers.push("T141_TARGET_ENVIRONMENT_MISMATCH");
  if (!UUID_PATTERN.test(compact(target.tenant_id, 64).toLowerCase())) blockers.push("T141_TARGET_TENANT_ID_REQUIRED");
  return [...new Set(blockers)];
}

function plan(input = {}, expectedAction, field) {
  if (input.report_type !== "delegation_grant_lifecycle_shadow_plan" || input.decision !== "eligible_shadow") {
    throw fail("T141_CANARY_PLAN_NOT_ELIGIBLE", `${field} must be an eligible delegation lifecycle shadow plan.`, { field });
  }
  if (input.action !== expectedAction || input.command_preview?.action !== expectedAction) {
    throw fail("T141_CANARY_PLAN_ACTION_MISMATCH", `${field} action must be ${expectedAction}.`, { field });
  }
  const requestFingerprint = hash(input.request_fingerprint, `${field}.request_fingerprint`);
  const receipt = input.receipt || {};
  if (
    receipt.state !== "pending"
    || receipt.outcome_classification !== "pending"
    || receipt.retry_allowed !== false
    || receipt.readback_complete !== false
  ) {
    throw fail("T141_CANARY_PENDING_RECEIPT_REQUIRED", `${field} must carry a fail-closed pending receipt.`, { field });
  }
  if (hash(receipt.request_fingerprint, `${field}.receipt.request_fingerprint`) !== requestFingerprint) {
    throw fail("T141_CANARY_RECEIPT_FINGERPRINT_MISMATCH", `${field} receipt fingerprint does not match its plan.`, { field });
  }
  if (input.execution_performed !== false) throw fail("T141_CANARY_PLAN_ALREADY_EXECUTED", `${field} must not claim prior execution.`, { field });
  return {
    action: expectedAction,
    request_fingerprint: requestFingerprint,
    grant_id: uuid(
      expectedAction === "create" ? input.command_preview?.grant?.grant_id : input.command_preview?.grant_id,
      `${field}.grant_id`,
    ),
    receipt_id: uuid(receipt.receipt_id, `${field}.receipt.receipt_id`),
    operation_id: uuid(receipt.operation_id, `${field}.receipt.operation_id`),
    step_id: uuid(receipt.step_id, `${field}.receipt.step_id`),
    idempotency_key: compact(receipt.idempotency_key, 191),
    expected_status: compact(input.command_preview?.expected_status, 32).toLowerCase(),
    proposed_status: compact(input.command_preview?.proposed_status, 32).toLowerCase(),
  };
}

function authorization(input = {}, boundPlan, field, env, now) {
  if (input.approved !== true) throw fail("T141_CANARY_AUTHORIZATION_REQUIRED", `${field} must be approved.`, { field });
  const expiresAt = isoDate(input.expires_at, `${field}.expires_at`);
  if (new Date(expiresAt).getTime() <= new Date(now).getTime()) throw fail("T141_CANARY_AUTHORIZATION_EXPIRED", `${field} is expired.`, { field });
  if (compact(input.environment, 32).toLowerCase() !== env) throw fail("T141_CANARY_AUTHORIZATION_ENVIRONMENT_MISMATCH", `${field} environment does not match.`, { field });
  const fingerprint = hash(input.expected_request_fingerprint, `${field}.expected_request_fingerprint`);
  if (fingerprint !== boundPlan.request_fingerprint) throw fail("T141_CANARY_AUTHORIZATION_STALE", `${field} is not bound to the exact request fingerprint.`, { field });
  const resourceAuthorityRef = compact(input.resource_authority_ref, 500);
  if (!resourceAuthorityRef) throw fail("T141_CANARY_RESOURCE_AUTHORITY_REQUIRED", `${field} requires resource_authority_ref.`, { field });
  if (input.secrets_included !== false) throw fail("T141_CANARY_AUTHORIZATION_SECRETS_FLAG_INVALID", `${field}.secrets_included must be false.`, { field });
  return {
    approved: true,
    capability_envelope_id: uuid(input.capability_envelope_id, `${field}.capability_envelope_id`),
    approval_hold_id: uuid(input.approval_hold_id, `${field}.approval_hold_id`),
    resource_authority_ref: resourceAuthorityRef,
    expected_request_fingerprint: fingerprint,
    environment: env,
    expires_at: expiresAt,
    secrets_included: false,
  };
}

export function evaluateT141CanaryReadiness({
  environment: environmentInput,
  target = {},
  migration_readiness = {},
  runtime_binding_status = {},
  deployment_readback = {},
} = {}) {
  assertSecretFree({ environment: environmentInput, target, migration_readiness, runtime_binding_status, deployment_readback });
  const env = environment(environmentInput);
  const blockers = readinessBlockers({
    env,
    target,
    migration: migration_readiness,
    runtime: runtime_binding_status,
    deployment: deployment_readback,
  });
  return {
    ok: true,
    report_type: "spec011_t141_canary_readiness",
    version: SPEC011_T141_CANARY_CONTRACT_VERSION,
    environment: env,
    decision: blockers.length === 0 ? "ready_for_governed_canary" : "blocked",
    blockers,
    production_authorized: env === "production" && migration_readiness.production_authorized === true,
    execution_performed: false,
    migration_applied_by_this_evaluation: false,
    delegation_mutated: false,
    runtime_authority_changed: false,
    secrets_included: false,
  };
}

export function buildT141CanaryContract({
  environment: environmentInput,
  target = {},
  migration_readiness = {},
  runtime_binding_status = {},
  deployment_readback = {},
  plans = {},
  authorization_bindings = {},
  now = new Date().toISOString(),
} = {}) {
  assertSecretFree({
    environment: environmentInput,
    target,
    migration_readiness,
    runtime_binding_status,
    deployment_readback,
    plans,
    authorization_bindings,
  });
  const normalizedNow = isoDate(now, "now");
  const readiness = evaluateT141CanaryReadiness({
    environment: environmentInput,
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
    primary_create: plan(plans.primary_create, "create", "plans.primary_create"),
    primary_revoke: plan(plans.primary_revoke, "revoke", "plans.primary_revoke"),
    expiry_create: plan(plans.expiry_create, "create", "plans.expiry_create"),
    expiry_expire: plan(plans.expiry_expire, "expire", "plans.expiry_expire"),
  };
  if (normalizedPlans.primary_create.grant_id !== normalizedPlans.primary_revoke.grant_id) {
    throw fail("T141_CANARY_PRIMARY_GRANT_MISMATCH", "Primary create and revoke plans must target the same grant.");
  }
  if (normalizedPlans.expiry_create.grant_id !== normalizedPlans.expiry_expire.grant_id) {
    throw fail("T141_CANARY_EXPIRY_GRANT_MISMATCH", "Expiry create and expire plans must target the same grant.");
  }
  if (normalizedPlans.primary_create.grant_id === normalizedPlans.expiry_create.grant_id) {
    throw fail("T141_CANARY_GRANT_IDS_MUST_DIFFER", "Primary and expiry grants must be distinct.");
  }
  unique(Object.values(normalizedPlans).map((entry) => entry.request_fingerprint), "T141_CANARY_REQUEST_FINGERPRINT_REUSE", "Every mutation must have a unique request fingerprint.");
  unique(Object.values(normalizedPlans).map((entry) => entry.receipt_id), "T141_CANARY_RECEIPT_REUSE", "Every mutation must have a unique receipt_id.");
  unique(Object.values(normalizedPlans).map((entry) => entry.idempotency_key), "T141_CANARY_IDEMPOTENCY_REUSE", "Every mutation must have a unique idempotency key.");

  const authorizations = Object.fromEntries(SPEC011_T141_CANARY_MUTATIONS.map((key) => [
    key,
    authorization(
      authorization_bindings[key],
      normalizedPlans[key],
      `authorization_bindings.${key}`,
      readiness.environment,
      normalizedNow,
    ),
  ]));
  const targetDescriptor = {
    environment: readiness.environment,
    tenant_id: uuid(target.tenant_id, "target.tenant_id"),
    database_name: compact(target.database_name, 191),
    expected_deployed_sha: commitSha(deployment_readback.expected_deployed_sha, "deployment_readback.expected_deployed_sha"),
    runtime_deployed_sha: commitSha(deployment_readback.runtime_deployed_sha, "deployment_readback.runtime_deployed_sha"),
  };
  const descriptor = {
    version: SPEC011_T141_CANARY_CONTRACT_VERSION,
    environment: readiness.environment,
    target: targetDescriptor,
    migration_checksum_sha256: hash(migration_readiness.migration_checksum_sha256, "migration_readiness.migration_checksum_sha256"),
    migration_ledger_reference: compact(migration_readiness.ledger_reference, 500),
    schema_readback_fingerprint: hash(migration_readiness.schema_readback_fingerprint, "migration_readiness.schema_readback_fingerprint"),
    plans: normalizedPlans,
    authorization_bindings: authorizations,
    ordered_steps: [...SPEC011_T141_CANARY_STEPS],
    created_at: normalizedNow,
  };
  return {
    ok: true,
    report_type: "spec011_t141_canary_contract",
    version: SPEC011_T141_CANARY_CONTRACT_VERSION,
    environment: readiness.environment,
    decision: "ready_for_governed_canary",
    contract_fingerprint_sha256: sha256(descriptor),
    target: targetDescriptor,
    migration: {
      checksum_sha256: descriptor.migration_checksum_sha256,
      ledger_reference: descriptor.migration_ledger_reference,
      schema_readback_fingerprint: descriptor.schema_readback_fingerprint,
      production_authorized: readiness.production_authorized,
    },
    plans: normalizedPlans,
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

function verifyMutation(key, expected, observed = {}) {
  if (["unknown", "ambiguous", "timeout_after_dispatch"].includes(compact(observed.outcome_classification, 64))) {
    return { reconciliation: `T141_${key.toUpperCase()}_RECONCILIATION_REQUIRED`, blockers: [] };
  }
  const blockers = [];
  if (observed.status !== "verified_success") blockers.push(`T141_${key.toUpperCase()}_NOT_VERIFIED_SUCCESS`);
  if (observed.request_fingerprint !== expected.request_fingerprint) blockers.push(`T141_${key.toUpperCase()}_FINGERPRINT_MISMATCH`);
  if (observed.grant_id !== expected.grant_id) blockers.push(`T141_${key.toUpperCase()}_GRANT_MISMATCH`);
  if (observed.grant_status !== expected.proposed_status) blockers.push(`T141_${key.toUpperCase()}_STATUS_MISMATCH`);
  if (observed.receipt_id !== expected.receipt_id) blockers.push(`T141_${key.toUpperCase()}_RECEIPT_MISMATCH`);
  if (observed.receipt_state !== "reconciled") blockers.push(`T141_${key.toUpperCase()}_RECEIPT_NOT_RECONCILED`);
  if (observed.readback_complete !== true) blockers.push(`T141_${key.toUpperCase()}_READBACK_INCOMPLETE`);
  if (observed.retry_allowed !== false) blockers.push(`T141_${key.toUpperCase()}_RETRY_MUST_REMAIN_FALSE`);
  if (!HASH_PATTERN.test(compact(observed.readback_fingerprint, 64).toLowerCase())) blockers.push(`T141_${key.toUpperCase()}_READBACK_FINGERPRINT_REQUIRED`);
  if (observed.runtime_policy_ready_promoted !== false) blockers.push("T141_RUNTIME_POLICY_READY_PROMOTION_FORBIDDEN");
  if (observed.secrets_included !== false) blockers.push("T141_SECRETS_FLAG_INVALID");
  return { reconciliation: null, blockers };
}

export function evaluateT141CanaryOutcome({ contract = {}, observations = {}, now = new Date().toISOString() } = {}) {
  assertSecretFree({ contract, observations });
  isoDate(now, "now");
  if (contract.report_type !== "spec011_t141_canary_contract" || contract.decision !== "ready_for_governed_canary") {
    throw fail("T141_CANARY_CONTRACT_NOT_READY", "A ready T141 canary contract is required.");
  }
  hash(contract.contract_fingerprint_sha256, "contract.contract_fingerprint_sha256");
  const blockers = [];
  const reconciliation = [];
  for (const key of SPEC011_T141_CANARY_MUTATIONS) {
    const result = verifyMutation(key, contract.plans?.[key] || {}, observations.mutations?.[key] || {});
    if (result.reconciliation) reconciliation.push(result.reconciliation);
    blockers.push(...result.blockers);
  }
  for (const [key, expectedStatus] of Object.entries({
    primary_absent: "absent",
    primary_active: "active",
    primary_revoked: "revoked",
    expiry_active: "active",
    expiry_expired: "expired",
  })) {
    if (observations.inspections?.[key]?.status !== expectedStatus || observations.inspections?.[key]?.readback_complete !== true) {
      blockers.push(`T141_INSPECTION_${key.toUpperCase()}_INVALID`);
    }
  }
  if (observations.receipts?.all_reconciled !== true || observations.receipts?.retry_allowed !== false) blockers.push("T141_RECEIPT_SET_NOT_FULLY_RECONCILED");
  if (!HASH_PATTERN.test(compact(observations.receipts?.set_fingerprint_sha256, 64).toLowerCase())) blockers.push("T141_RECEIPT_SET_FINGERPRINT_REQUIRED");
  if (observations.same_cycle !== true) blockers.push("T141_CANARY_SAME_CYCLE_REQUIRED");
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
