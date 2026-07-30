import { createHash } from "node:crypto";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const ADMIN_CALLER_TYPES = new Set(["admin", "service"]);

export const REPOSITORY_RECONCILIATION_LEASE_ACTIONS = Object.freeze([
  "acquire",
  "renew",
  "release",
]);

export const REPOSITORY_RECONCILIATION_LEASE_CONFIRMATIONS = Object.freeze({
  acquire: "ACQUIRE_REPOSITORY_RECONCILIATION_LEASE",
  renew: "RENEW_REPOSITORY_RECONCILIATION_LEASE",
  release: "RELEASE_REPOSITORY_RECONCILIATION_LEASE",
});

function controlError(code, message, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

function requiredString(value, field, { max = 255, pattern = null } = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || (pattern && !pattern.test(normalized))) {
    throw controlError(
      "repository_reconciliation_lease_control_invalid_input",
      `${field} is invalid.`,
      400,
      { field },
    );
  }
  return normalized;
}

function normalizedAction(value) {
  const action = requiredString(value, "action", { max: 16 }).toLowerCase();
  if (!REPOSITORY_RECONCILIATION_LEASE_ACTIONS.includes(action)) {
    throw controlError(
      "repository_reconciliation_lease_control_invalid_action",
      "action must be acquire, renew, or release.",
      400,
      { action },
    );
  }
  return action;
}

function assertAdminCaller(auth = {}) {
  const callerType = String(auth?.caller_type || "").trim().toLowerCase();
  if (!ADMIN_CALLER_TYPES.has(callerType)) {
    throw controlError(
      "repository_reconciliation_lease_control_admin_required",
      "Repository reconciliation lease control requires an Admin or service principal.",
      403,
      { caller_type: callerType || null },
    );
  }
}

function assertTypedConfirmation(action, confirmation) {
  const expected = REPOSITORY_RECONCILIATION_LEASE_CONFIRMATIONS[action];
  const actual = String(confirmation || "").trim();
  if (actual !== expected) {
    throw controlError(
      "repository_reconciliation_lease_control_confirmation_required",
      `Typed confirmation must equal ${expected}.`,
      409,
      { action, expected_confirmation: expected },
    );
  }
}

function assertNoForceFlags(args = {}) {
  const forbidden = [
    "force",
    "force_update",
    "force_push",
    "allow_protected_branch",
    "allow_stale_branch_patch",
  ].filter((key) => args?.[key] === true || String(args?.[key] || "").toLowerCase() === "true");
  if (forbidden.length > 0) {
    throw controlError(
      "repository_reconciliation_lease_control_force_forbidden",
      "Force, protected-branch, and stale-branch bypass flags are not accepted by lease control.",
      403,
      { forbidden_fields: forbidden },
    );
  }
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function canonicalOperationFingerprint(input) {
  return sha256(JSON.stringify({
    contract: "repository_reconciliation_lease_control_v1",
    repository_owner: input.repository_owner,
    repository_name: input.repository_name,
    branch_name: input.branch_name,
    default_branch: input.default_branch,
    operation_key: input.operation_key,
    holder_run_id: input.holder_run_id,
    holder_actor_type: input.holder_actor_type,
    holder_actor_id: input.holder_actor_id,
    expected_base_sha: input.expected_base_sha,
    expected_branch_sha: input.expected_branch_sha,
  }));
}

export function buildRepositoryReconciliationLeaseAcquireInput(args = {}) {
  assertNoForceFlags(args);
  const repository_owner = requiredString(args.repository_owner ?? args.owner, "repository_owner", {
    max: 100,
    pattern: /^[A-Za-z0-9_.-]+$/,
  });
  const repository_name = requiredString(args.repository_name ?? args.repo, "repository_name", {
    max: 100,
    pattern: /^[A-Za-z0-9_.-]+$/,
  });
  const branch_name = requiredString(args.branch_name ?? args.branch, "branch_name", { max: 255 });
  const default_branch = requiredString(args.default_branch || "main", "default_branch", { max: 255 });
  if (branch_name.toLowerCase() === default_branch.toLowerCase()) {
    throw controlError(
      "repository_reconciliation_lease_control_protected_branch",
      "Lease control cannot target the default branch.",
      403,
      { branch_name, default_branch },
    );
  }
  const expected_base_sha = requiredString(
    String(args.expected_base_sha || "").trim().toLowerCase(),
    "expected_base_sha",
    { max: 40, pattern: SHA_PATTERN },
  );
  const expected_branch_sha = requiredString(
    String(args.expected_branch_sha || "").trim().toLowerCase(),
    "expected_branch_sha",
    { max: 40, pattern: SHA_PATTERN },
  );
  const operation_key = requiredString(
    args.operation_key || "repo.pr.reconcile_and_finalize",
    "operation_key",
    { max: 128, pattern: /^[A-Za-z0-9._:-]+$/ },
  );
  const holder_run_id = requiredString(args.holder_run_id, "holder_run_id", {
    max: 64,
    pattern: /^[A-Za-z0-9._:-]+$/,
  });
  const holder_actor_type = requiredString(
    args.holder_actor_type || "platform_orchestrator",
    "holder_actor_type",
    { max: 64, pattern: /^[A-Za-z0-9._:-]+$/ },
  );
  const holder_actor_id = String(args.holder_actor_id || "").trim() || null;
  if (holder_actor_id && (holder_actor_id.length > 64 || !/^[A-Za-z0-9._:-]+$/.test(holder_actor_id))) {
    throw controlError(
      "repository_reconciliation_lease_control_invalid_input",
      "holder_actor_id is invalid.",
      400,
      { field: "holder_actor_id" },
    );
  }
  const binding = {
    repository_owner,
    repository_name,
    branch_name,
    default_branch,
    operation_key,
    holder_run_id,
    holder_actor_type,
    holder_actor_id,
    expected_base_sha,
    expected_branch_sha,
  };
  const operation_fingerprint = canonicalOperationFingerprint(binding);
  const suppliedFingerprint = String(args.operation_fingerprint || "").trim().toLowerCase();
  if (suppliedFingerprint && suppliedFingerprint !== operation_fingerprint) {
    throw controlError(
      "repository_reconciliation_lease_control_operation_fingerprint_mismatch",
      "operation_fingerprint does not match the canonical reconciliation binding.",
      409,
      { expected_operation_fingerprint: operation_fingerprint },
    );
  }
  return {
    ...binding,
    operation_fingerprint,
    ttl_seconds: args.ttl_seconds,
  };
}

function buildLifecycleInput(args = {}, action) {
  assertNoForceFlags(args);
  const resource_fingerprint = requiredString(
    String(args.resource_fingerprint || "").trim().toLowerCase(),
    "resource_fingerprint",
    { max: 64, pattern: FINGERPRINT_PATTERN },
  );
  const input = {
    lease_id: requiredString(args.lease_id, "lease_id", { max: 64 }),
    holder_run_id: requiredString(args.holder_run_id, "holder_run_id", {
      max: 64,
      pattern: /^[A-Za-z0-9._:-]+$/,
    }),
    resource_fingerprint,
  };
  if (action === "renew") input.ttl_seconds = args.ttl_seconds;
  if (action === "release") input.release_reason = String(args.release_reason || "operation_complete").trim().slice(0, 500);
  return input;
}

async function capabilityDependencies(deps = {}) {
  if (
    deps.resolveCapabilityExecutionEnvelope
    && deps.markCapabilityEnvelopeReferenced
    && deps.capabilityEnvelopeError
  ) {
    return deps;
  }
  const guard = await import("./capabilityResolutionEnvelopeGuard.js");
  return { ...guard, ...deps };
}

async function leaseDependencies(deps = {}) {
  if (
    deps.acquireRepositoryOperationLease
    && deps.renewRepositoryOperationLease
    && deps.releaseRepositoryOperationLease
  ) {
    return deps;
  }
  const service = await import("./repositoryOperationLeaseService.js");
  return { ...service, ...deps };
}

async function requireCapabilityEnvelope(action, args, auth, deps) {
  const capability = await capabilityDependencies(deps);
  const resolved = await capability.resolveCapabilityExecutionEnvelope({
    pool: deps.pool,
    source: args,
    acceptedAppKeys: ["github"],
    acceptedIntents: [
      "repository_reconciliation_lease_control",
      `repository_reconciliation_lease_${action}`,
      "repository_operation_lease_control",
      "repo_mutation",
    ],
    expectedTenantId: auth?.tenant_id || PLATFORM_TENANT_ID,
    expectedUserId: auth?.user_id || "",
  });
  if (!resolved?.ok) {
    throw capability.capabilityEnvelopeError(
      resolved,
      "Repository reconciliation lease control requires a ready capability resolution envelope.",
    );
  }
  const executionSubject = action === "acquire"
    ? String(args.branch_name ?? args.branch ?? "unknown")
    : String(args.lease_id || "unknown");
  await capability.markCapabilityEnvelopeReferenced({
    pool: deps.pool,
    envelopeId: resolved.envelope_id,
    executionRef: `repository_reconciliation_lease_control:${action}:${executionSubject}`,
  });
  return resolved;
}

export async function runRepositoryReconciliationLeaseControl(args = {}, deps = {}) {
  const action = normalizedAction(args.action);
  assertAdminCaller(deps.auth);
  assertTypedConfirmation(action, args.confirm);

  const input = action === "acquire"
    ? buildRepositoryReconciliationLeaseAcquireInput(args)
    : buildLifecycleInput(args, action);

  const envelope = await requireCapabilityEnvelope(action, args, deps.auth || {}, deps);
  const service = await leaseDependencies(deps);
  let result;
  if (action === "acquire") {
    result = await service.acquireRepositoryOperationLease(input, { pool: deps.pool });
  } else if (action === "renew") {
    result = await service.renewRepositoryOperationLease(input, { pool: deps.pool });
  } else {
    result = await service.releaseRepositoryOperationLease(input, { pool: deps.pool });
  }

  return {
    ...result,
    action,
    capability_envelope_id: envelope.envelope_id,
    operation_binding: action === "acquire" ? {
      repository_owner: input.repository_owner,
      repository_name: input.repository_name,
      branch_name: input.branch_name,
      default_branch: input.default_branch,
      expected_base_sha: input.expected_base_sha,
      expected_branch_sha: input.expected_branch_sha,
      operation_key: input.operation_key,
      operation_fingerprint: input.operation_fingerprint,
    } : undefined,
    secrets_included: false,
  };
}
