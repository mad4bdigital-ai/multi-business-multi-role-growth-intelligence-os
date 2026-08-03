import { createHash } from 'node:crypto';
import {
  buildCanonicalHostingerStoragePlanEnvelope,
  verifyHostingerStorageExecutionAuthorizationBundle,
} from './hostingerStorageExecutionAuthorizationV2.js';

export const HOSTINGER_STORAGE_EXECUTOR_PROTOCOL_VERSION = 'spec014-hostinger-storage-executor-v1';

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function safeId(value, field) {
  const normalized = text(value, 256);
  if (!SAFE_ID_RE.test(normalized)) {
    throw fail(400, 'STORAGE_EXECUTOR_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return normalized;
}

function hash(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw fail(400, 'STORAGE_EXECUTOR_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  }
  return normalized;
}

function booleanBinding(value, field) {
  if (typeof value !== 'boolean') {
    throw fail(400, 'STORAGE_EXECUTOR_BOOLEAN_BINDING_INVALID', 'An explicit boolean binding is required.', { field });
  }
  return value;
}

function positiveInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw fail(400, 'STORAGE_EXECUTOR_INTEGER_BINDING_INVALID', 'A positive integer binding is required.', { field });
  }
  return normalized;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function assertSecretFree(value, at = 'value', depth = 0) {
  if (depth > 16 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${at}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (key !== 'secrets_included' && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|raw_authorization|cookie_header|session_cookie|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command)/i.test(key)) {
      throw fail(400, 'STORAGE_EXECUTOR_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Executor inputs must not contain secret-bearing or free-form execution fields.', { path: `${at}.${key}` });
    }
    assertSecretFree(entry, `${at}.${key}`, depth + 1);
  }
}

function normalizeCurrentBindings(current = {}) {
  return deepFreeze({
    ownership_revision: safeId(current.ownership_revision, 'current.ownership_revision'),
    policy_revision: safeId(current.policy_revision, 'current.policy_revision'),
    plan_hash: hash(current.plan_hash, 'current.plan_hash'),
    candidate_set_hash: hash(current.candidate_set_hash, 'current.candidate_set_hash'),
    impact_set_hash: hash(current.impact_set_hash, 'current.impact_set_hash'),
    authority_context_hash: hash(current.authority_context_hash, 'current.authority_context_hash'),
    approval_set_hash: hash(current.approval_set_hash, 'current.approval_set_hash'),
    toolchain_provenance_digest: hash(current.toolchain_provenance_digest, 'current.toolchain_provenance_digest'),
    governance_decision_digest: hash(current.governance_decision_digest, 'current.governance_decision_digest'),
    attestation_evidence_digest: hash(current.attestation_evidence_digest, 'current.attestation_evidence_digest'),
    recovery_required: booleanBinding(current.recovery_required, 'current.recovery_required'),
    recovery_proof_digest: hash(current.recovery_proof_digest, 'current.recovery_proof_digest'),
    recovery_requirement_binding_digest: hash(current.recovery_requirement_binding_digest, 'current.recovery_requirement_binding_digest'),
    attestation_toolchain_provenance_digest: hash(current.attestation_toolchain_provenance_digest, 'current.attestation_toolchain_provenance_digest'),
    attestation_toolchain_selected_tools_digest: hash(current.attestation_toolchain_selected_tools_digest, 'current.attestation_toolchain_selected_tools_digest'),
    lease_generation: Number(current.lease_generation),
    host_key_revision: safeId(current.host_key_revision, 'current.host_key_revision'),
    secrets_included: false,
  });
}

export function buildHostingerStorageSyntheticExecutionProtocol({
  authorization,
  expected_bundle_hash,
  current_bindings,
  plan,
  run_id,
} = {}) {
  assertSecretFree({ authorization, current_bindings, plan }, 'synthetic_execution');
  const current = normalizeCurrentBindings(current_bindings);
  if (!Number.isSafeInteger(current.lease_generation) || current.lease_generation < 1) {
    throw fail(400, 'STORAGE_EXECUTOR_LEASE_GENERATION_INVALID', 'A positive lease generation is required.');
  }
  const verification = verifyHostingerStorageExecutionAuthorizationBundle({
    authorization,
    expected_bundle_hash: hash(expected_bundle_hash, 'expected_bundle_hash'),
    current,
  });
  if (!verification.valid) {
    throw fail(409, 'STORAGE_EXECUTOR_AUTHORIZATION_INVALID', 'Execution authorization is stale, incomplete, or tampered.', {
      blockers: verification.blockers,
    });
  }
  if (authorization.dispatch_allowed !== false || authorization.provider_dispatch_default_off !== true) {
    throw fail(409, 'STORAGE_EXECUTOR_PROVIDER_DISPATCH_MUST_REMAIN_DISABLED', 'Synthetic execution requires provider dispatch to remain disabled.');
  }
  const canonical = buildCanonicalHostingerStoragePlanEnvelope(plan);
  const bundle = authorization.bundle;
  const mismatches = [];
  if (canonical.plan_hash !== bundle.plan_hash) mismatches.push('plan_hash');
  if (canonical.candidate_set_hash !== bundle.candidate_set_hash) mismatches.push('candidate_set_hash');
  if (canonical.envelope.operation_id !== bundle.operation_id) mismatches.push('operation_id');
  if (canonical.envelope.target_id !== bundle.target_id) mismatches.push('target_id');
  if (canonical.envelope.authority_context_hash !== bundle.authority_context_hash) mismatches.push('authority_context_hash');
  if (mismatches.length) {
    throw fail(409, 'STORAGE_EXECUTOR_PLAN_BINDING_MISMATCH', 'Canonical plan does not match the execution authorization bundle.', { mismatches });
  }
  const items = canonical.envelope.items.map((item) => deepFreeze({
    item_id: item.item_id,
    ordinal: item.ordinal,
    category: item.category,
    path_ref: item.path_ref,
    item_hash: item.item_hash,
    relative_path_digest: item.relative_path_digest,
    expected: deepFreeze({
      size_bytes: item.size_bytes,
      device: item.device,
      inode: item.inode,
      ctime_epoch: item.ctime_epoch,
      mtime_epoch: item.mtime_epoch,
      file_type: item.file_type,
    }),
    secrets_included: false,
  }));
  const core = {
    schema_version: 1,
    protocol_key: 'hostinger_storage_synthetic_execution_protocol_v1',
    protocol_version: HOSTINGER_STORAGE_EXECUTOR_PROTOCOL_VERSION,
    run_id: safeId(run_id, 'run_id'),
    operation_id: canonical.envelope.operation_id,
    target_id: canonical.envelope.target_id,
    plan_id: canonical.envelope.plan_id,
    plan_hash: canonical.plan_hash,
    candidate_set_hash: canonical.candidate_set_hash,
    plan_expires_at_epoch: positiveInteger(canonical.envelope.expires_at_epoch, 'plan.expires_at_epoch'),
    authorization_bundle_hash: hash(authorization.bundle_hash, 'authorization.bundle_hash'),
    lease_id: safeId(bundle.execution_lease?.lease_id, 'bundle.execution_lease.lease_id'),
    lease_generation: positiveInteger(bundle.execution_lease?.generation, 'bundle.execution_lease.generation'),
    lease_expires_at_epoch: positiveInteger(bundle.execution_lease?.expires_at_epoch, 'bundle.execution_lease.expires_at_epoch'),
    synthetic_only: true,
    production_ready: false,
    provider_dispatch_allowed: false,
    automatic_retry_allowed: false,
    items,
    secrets_included: false,
  };
  return deepFreeze({
    ok: true,
    protocol: core,
    protocol_digest: digest(core),
    dispatch_allowed: false,
    live_provider_allowed: false,
    secrets_included: false,
  });
}

export function verifyHostingerStorageSyntheticExecutionProtocol({ protocol, expected_digest } = {}) {
  assertSecretFree(protocol, 'protocol');
  if (protocol?.protocol_key !== 'hostinger_storage_synthetic_execution_protocol_v1'
    || protocol?.protocol_version !== HOSTINGER_STORAGE_EXECUTOR_PROTOCOL_VERSION
    || protocol?.synthetic_only !== true
    || protocol?.production_ready !== false
    || protocol?.provider_dispatch_allowed !== false
    || protocol?.automatic_retry_allowed !== false) {
    throw fail(409, 'STORAGE_EXECUTOR_PROTOCOL_IDENTITY_INVALID', 'Unexpected or unsafe synthetic execution protocol identity.');
  }
  positiveInteger(protocol.plan_expires_at_epoch, 'protocol.plan_expires_at_epoch');
  positiveInteger(protocol.lease_generation, 'protocol.lease_generation');
  positiveInteger(protocol.lease_expires_at_epoch, 'protocol.lease_expires_at_epoch');
  const observed = digest(protocol);
  if (observed !== hash(expected_digest, 'expected_digest')) {
    throw fail(409, 'STORAGE_EXECUTOR_PROTOCOL_TAMPERED', 'Synthetic execution protocol digest mismatch.');
  }
  return deepFreeze({
    ok: true,
    valid: true,
    observed_digest: observed,
    dispatch_allowed: false,
    secrets_included: false,
  });
}
