import { createHash } from 'node:crypto';
import { verifyHostingerStorageDedicatedWorkerCertification } from './hostingerStorageDedicatedWorkerCertification.js';

export const HOSTINGER_STORAGE_FIXED_DISPATCH_CERTIFICATION_VERSION = 'spec014-hostinger-storage-fixed-dispatch-certification-v1';

const EVIDENCE_CONTRACT = 'spec014.hostinger-storage-fixed-dispatch-evidence.v1';
const PACKET_CONTRACT = 'spec014.hostinger-storage-fixed-dispatch-certification.v1';
const HASH_RE = /^[0-9a-f]{64}$/u;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u;
const MAX_LIFETIME_MS = 86_400_000;
const FIXED_SCRIPT_REF = 'repo:http-generic-api/scripts/hostinger-storage-cleanup.sh';

function failure(status, code, message, details = {}) {
  const error = new Error(message);
  Object.assign(error, { status, code, details: { ...details, secrets_included: false } });
  return error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function text(value, field, max = 256) {
  const result = String(value ?? '').trim().slice(0, max);
  if (!ID_RE.test(result)) throw failure(400, 'STORAGE_FIXED_DISPATCH_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  return result;
}

function hash(value, field) {
  const result = String(value ?? '').trim().toLowerCase();
  if (!HASH_RE.test(result)) throw failure(400, 'STORAGE_FIXED_DISPATCH_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  return result;
}

function bool(value, field) {
  if (typeof value !== 'boolean') throw failure(400, 'STORAGE_FIXED_DISPATCH_BOOLEAN_REQUIRED', 'An explicit boolean is required.', { field });
  return value;
}

function count(value, field) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw failure(400, 'STORAGE_FIXED_DISPATCH_COUNT_INVALID', 'A non-negative safe integer is required.', { field });
  return result;
}

function instant(value, field) {
  const result = String(value ?? '').trim();
  const epoch = Date.parse(result);
  if (!Number.isFinite(epoch)) throw failure(400, 'STORAGE_FIXED_DISPATCH_TIME_INVALID', 'A valid timestamp is required.', { field });
  return { result, epoch };
}

function secretFree(value, path = 'value', depth = 0) {
  if (depth > 24 || value === null || value === undefined) return;
  if (Array.isArray(value)) return value.forEach((entry, index) => secretFree(entry, `${path}[${index}]`, depth + 1));
  if (typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'secrets_included' && entry !== false) throw failure(400, 'STORAGE_FIXED_DISPATCH_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
    const allowed = ['secrets_included', 'credential_values_in_evidence', 'credential_values_resolved', 'shell_command_present'];
    if (!allowed.includes(key) && /(password|passwd|secret|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command|credential_value|credential_material)/i.test(key)) {
      throw failure(400, 'STORAGE_FIXED_DISPATCH_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Secrets, paths, and free-form execution fields are forbidden.', { path: `${path}.${key}` });
    }
    secretFree(entry, `${path}.${key}`, depth + 1);
  }
}

function normalizeExpected(value = {}) {
  secretFree(value, 'expected');
  return freeze({
    source_commit: hash(value.source_commit, 'expected.source_commit'),
    dispatcher_id: text(value.dispatcher_id, 'expected.dispatcher_id'),
    dispatcher_release_id: text(value.dispatcher_release_id, 'expected.dispatcher_release_id'),
    dispatcher_artifact_digest: hash(value.dispatcher_artifact_digest, 'expected.dispatcher_artifact_digest'),
    worker_certification_digest: hash(value.worker_certification_digest, 'expected.worker_certification_digest'),
    operation_id: text(value.operation_id, 'expected.operation_id'),
    target_id: text(value.target_id, 'expected.target_id'),
    plan_id: text(value.plan_id, 'expected.plan_id'),
    plan_hash: hash(value.plan_hash, 'expected.plan_hash'),
    execution_lease_id: text(value.execution_lease_id, 'expected.execution_lease_id'),
    lease_generation: count(value.lease_generation, 'expected.lease_generation'),
    authorization_bundle_hash: hash(value.authorization_bundle_hash, 'expected.authorization_bundle_hash'),
    arguments_schema_digest: hash(value.arguments_schema_digest, 'expected.arguments_schema_digest'),
    storage_root_ref_digest: hash(value.storage_root_ref_digest, 'expected.storage_root_ref_digest'),
    typed_confirmation_digest: hash(value.typed_confirmation_digest, 'expected.typed_confirmation_digest'),
    credential_binding_digest: hash(value.credential_binding_digest, 'expected.credential_binding_digest'),
    host_key_revision: text(value.host_key_revision, 'expected.host_key_revision'),
    host_key_fingerprint_digest: hash(value.host_key_fingerprint_digest, 'expected.host_key_fingerprint_digest'),
    reviewed_program_digest: hash(value.reviewed_program_digest, 'expected.reviewed_program_digest'),
    secrets_included: false,
  });
}

function normalizeEvidence(value = {}, now) {
  secretFree(value, 'evidence');
  if (value.contract !== EVIDENCE_CONTRACT || value.secrets_included !== false) throw failure(409, 'STORAGE_FIXED_DISPATCH_EVIDENCE_CONTRACT_INVALID', 'Unexpected fixed-dispatch evidence contract.');
  const observed = instant(value.observed_at, 'evidence.observed_at');
  const expires = instant(value.expires_at, 'evidence.expires_at');
  if (observed.epoch > now || expires.epoch <= now || expires.epoch <= observed.epoch) throw failure(409, 'STORAGE_FIXED_DISPATCH_FRESHNESS_INVALID', 'Fixed-dispatch evidence freshness is invalid.');
  if (expires.epoch - observed.epoch > MAX_LIFETIME_MS) throw failure(409, 'STORAGE_FIXED_DISPATCH_LIFETIME_EXCEEDED', 'Fixed-dispatch evidence lifetime exceeds 24 hours.');
  const d = value.dispatcher || {}, i = value.invocation || {}, b = value.boundary || {};
  return freeze({
    contract: EVIDENCE_CONTRACT,
    observed_at: observed.result,
    expires_at: expires.result,
    source_commit: hash(value.source_commit, 'evidence.source_commit'),
    dispatcher: {
      dispatcher_id: text(d.dispatcher_id, 'dispatcher.dispatcher_id'),
      dispatcher_kind: text(d.dispatcher_kind, 'dispatcher.dispatcher_kind'),
      release_id: text(d.release_id, 'dispatcher.release_id'),
      artifact_digest: hash(d.artifact_digest, 'dispatcher.artifact_digest'),
      internal_only: bool(d.internal_only, 'dispatcher.internal_only'),
      public_http: bool(d.public_http, 'dispatcher.public_http'),
      public_runtime: bool(d.public_runtime, 'dispatcher.public_runtime'),
      default_off: bool(d.default_off, 'dispatcher.default_off'),
      queue_key: text(d.queue_key, 'dispatcher.queue_key'),
      single_operation: bool(d.single_operation, 'dispatcher.single_operation'),
      secrets_included: false,
    },
    invocation: {
      adapter_key: text(i.adapter_key, 'invocation.adapter_key'),
      operation_key: text(i.operation_key, 'invocation.operation_key'),
      provider_action: text(i.provider_action, 'invocation.provider_action', 64),
      fixed_script_ref: text(i.fixed_script_ref, 'invocation.fixed_script_ref'),
      reviewed_program_digest: hash(i.reviewed_program_digest, 'invocation.reviewed_program_digest'),
      operation_id: text(i.operation_id, 'invocation.operation_id'),
      target_id: text(i.target_id, 'invocation.target_id'),
      plan_id: text(i.plan_id, 'invocation.plan_id'),
      expected_plan_hash: hash(i.expected_plan_hash, 'invocation.expected_plan_hash'),
      execution_lease_id: text(i.execution_lease_id, 'invocation.execution_lease_id'),
      lease_generation: count(i.lease_generation, 'invocation.lease_generation'),
      authorization_bundle_hash: hash(i.authorization_bundle_hash, 'invocation.authorization_bundle_hash'),
      arguments_schema_digest: hash(i.arguments_schema_digest, 'invocation.arguments_schema_digest'),
      storage_root_ref_digest: hash(i.storage_root_ref_digest, 'invocation.storage_root_ref_digest'),
      typed_confirmation_digest: hash(i.typed_confirmation_digest, 'invocation.typed_confirmation_digest'),
      credential_binding_digest: hash(i.credential_binding_digest, 'invocation.credential_binding_digest'),
      host_key_revision: text(i.host_key_revision, 'invocation.host_key_revision'),
      host_key_fingerprint_digest: hash(i.host_key_fingerprint_digest, 'invocation.host_key_fingerprint_digest'),
      structured_arguments_only: bool(i.structured_arguments_only, 'invocation.structured_arguments_only'),
      credential_reference_only: bool(i.credential_reference_only, 'invocation.credential_reference_only'),
      shell_command_present: bool(i.shell_command_present, 'invocation.shell_command_present'),
      wildcard_allowed: bool(i.wildcard_allowed, 'invocation.wildcard_allowed'),
      arbitrary_root_allowed: bool(i.arbitrary_root_allowed, 'invocation.arbitrary_root_allowed'),
      output_policy: text(i.output_policy, 'invocation.output_policy', 64),
      secrets_included: false,
    },
    boundary: {
      repository_only: bool(b.repository_only, 'boundary.repository_only'),
      dispatcher_created: bool(b.dispatcher_created, 'boundary.dispatcher_created'),
      dispatch_job_enqueued: bool(b.dispatch_job_enqueued, 'boundary.dispatch_job_enqueued'),
      worker_invoked: bool(b.worker_invoked, 'boundary.worker_invoked'),
      provider_calls: count(b.provider_calls, 'boundary.provider_calls'),
      credential_resolutions: count(b.credential_resolutions, 'boundary.credential_resolutions'),
      runtime_mounts: count(b.runtime_mounts, 'boundary.runtime_mounts'),
      secrets_included: false,
    },
    secrets_included: false,
  });
}

function deriveBlockers(e, x, workerPacket, workerVerification) {
  const out = [];
  const add = (condition, code) => { if (condition) out.push(code); };
  add(workerVerification.valid !== true || workerVerification.ready_for_fixed_dispatch_certification !== true, 'STORAGE_FIXED_DISPATCH_WORKER_CERTIFICATION_NOT_READY');
  add(workerPacket.certification_digest !== x.worker_certification_digest, 'STORAGE_FIXED_DISPATCH_WORKER_CERTIFICATION_DIGEST_MISMATCH');
  add(e.source_commit !== x.source_commit, 'STORAGE_FIXED_DISPATCH_SOURCE_COMMIT_MISMATCH');
  add(e.dispatcher.dispatcher_id !== x.dispatcher_id || e.dispatcher.release_id !== x.dispatcher_release_id || e.dispatcher.artifact_digest !== x.dispatcher_artifact_digest, 'STORAGE_FIXED_DISPATCH_DISPATCHER_BINDING_MISMATCH');
  add(e.dispatcher.dispatcher_kind !== 'fixed_internal_dispatcher' || !e.dispatcher.internal_only || e.dispatcher.public_http || e.dispatcher.public_runtime, 'STORAGE_FIXED_DISPATCH_ISOLATION_INVALID');
  add(!e.dispatcher.default_off || e.dispatcher.queue_key !== 'hostinger_storage_dispatch_v1' || !e.dispatcher.single_operation, 'STORAGE_FIXED_DISPATCH_POLICY_INVALID');
  add(e.invocation.adapter_key !== 'hostinger_ssh_storage_v1' || e.invocation.operation_key !== 'apply_exact_plan' || e.invocation.provider_action !== 'apply', 'STORAGE_FIXED_DISPATCH_OPERATION_INVALID');
  add(e.invocation.fixed_script_ref !== FIXED_SCRIPT_REF || e.invocation.reviewed_program_digest !== x.reviewed_program_digest, 'STORAGE_FIXED_DISPATCH_PROGRAM_BINDING_MISMATCH');
  add(e.invocation.operation_id !== x.operation_id || e.invocation.target_id !== x.target_id || e.invocation.plan_id !== x.plan_id || e.invocation.expected_plan_hash !== x.plan_hash, 'STORAGE_FIXED_DISPATCH_OPERATION_BINDING_MISMATCH');
  add(e.invocation.execution_lease_id !== x.execution_lease_id || e.invocation.lease_generation !== x.lease_generation, 'STORAGE_FIXED_DISPATCH_LEASE_BINDING_MISMATCH');
  add(e.invocation.authorization_bundle_hash !== x.authorization_bundle_hash, 'STORAGE_FIXED_DISPATCH_AUTHORIZATION_BINDING_MISMATCH');
  add(e.invocation.arguments_schema_digest !== x.arguments_schema_digest || e.invocation.storage_root_ref_digest !== x.storage_root_ref_digest || e.invocation.typed_confirmation_digest !== x.typed_confirmation_digest, 'STORAGE_FIXED_DISPATCH_ARGUMENT_BINDING_MISMATCH');
  add(e.invocation.credential_binding_digest !== x.credential_binding_digest || !e.invocation.credential_reference_only, 'STORAGE_FIXED_DISPATCH_CREDENTIAL_BOUNDARY_INVALID');
  add(e.invocation.host_key_revision !== x.host_key_revision || e.invocation.host_key_fingerprint_digest !== x.host_key_fingerprint_digest, 'STORAGE_FIXED_DISPATCH_HOST_KEY_BINDING_MISMATCH');
  add(!e.invocation.structured_arguments_only || e.invocation.shell_command_present || e.invocation.wildcard_allowed || e.invocation.arbitrary_root_allowed, 'STORAGE_FIXED_DISPATCH_FREE_FORM_INPUT_FORBIDDEN');
  add(e.invocation.output_policy !== 'bounded_redacted_json', 'STORAGE_FIXED_DISPATCH_OUTPUT_POLICY_INVALID');
  add(!e.boundary.repository_only || e.boundary.dispatcher_created || e.boundary.dispatch_job_enqueued || e.boundary.worker_invoked || e.boundary.provider_calls !== 0 || e.boundary.credential_resolutions !== 0 || e.boundary.runtime_mounts !== 0, 'STORAGE_FIXED_DISPATCH_REPOSITORY_ONLY_BOUNDARY_INVALID');
  add(workerPacket.bindings?.source_commit !== x.source_commit || workerPacket.bindings?.target_id !== x.target_id || workerPacket.bindings?.reviewed_program_digest !== x.reviewed_program_digest || workerPacket.bindings?.host_key_revision !== x.host_key_revision || workerPacket.bindings?.host_key_fingerprint_digest !== x.host_key_fingerprint_digest, 'STORAGE_FIXED_DISPATCH_WORKER_BINDING_MISMATCH');
  return [...new Set(out)].sort();
}

function verifyWorker(packet) {
  try {
    return verifyHostingerStorageDedicatedWorkerCertification({ packet, expected_digest: packet?.certification_digest });
  } catch (error) {
    throw failure(409, 'STORAGE_FIXED_DISPATCH_WORKER_CERTIFICATION_TAMPERED', 'Dedicated worker certification is invalid.', { cause_code: error?.code || 'unknown' });
  }
}

export function buildHostingerStorageFixedDispatchCertification({ worker_certification, evidence, expected, now = Date.now() } = {}) {
  const nowEpoch = Number(now);
  if (!Number.isFinite(nowEpoch)) throw failure(400, 'STORAGE_FIXED_DISPATCH_NOW_INVALID', 'A valid evaluation time is required.');
  secretFree(worker_certification, 'worker_certification');
  const workerVerification = verifyWorker(worker_certification);
  const normalizedExpected = normalizeExpected(expected);
  const normalizedEvidence = normalizeEvidence(evidence, nowEpoch);
  const derived = deriveBlockers(normalizedEvidence, normalizedExpected, worker_certification, workerVerification);
  const core = {
    contract: PACKET_CONTRACT,
    version: HOSTINGER_STORAGE_FIXED_DISPATCH_CERTIFICATION_VERSION,
    worker_certification,
    expected: normalizedExpected,
    evidence: normalizedEvidence,
    blockers: derived,
    ready_for_separate_mount_authorization: derived.length === 0,
    dispatcher_created: false,
    dispatch_job_enqueued: false,
    worker_invoked: false,
    runtime_mounted: false,
    route_mounted: false,
    credential_values_resolved: 0,
    provider_calls: 0,
    provider_dispatch_allowed: false,
    production_ready: false,
    secrets_included: false,
  };
  return freeze({ ...core, certification_digest: digest(core) });
}

export function verifyHostingerStorageFixedDispatchCertification({ packet, expected_digest } = {}) {
  secretFree(packet, 'packet');
  if (packet?.contract !== PACKET_CONTRACT || packet?.version !== HOSTINGER_STORAGE_FIXED_DISPATCH_CERTIFICATION_VERSION
    || packet.dispatcher_created !== false || packet.dispatch_job_enqueued !== false || packet.worker_invoked !== false
    || packet.runtime_mounted !== false || packet.route_mounted !== false || packet.credential_values_resolved !== 0
    || packet.provider_calls !== 0 || packet.provider_dispatch_allowed !== false || packet.production_ready !== false || packet.secrets_included !== false) {
    throw failure(409, 'STORAGE_FIXED_DISPATCH_PACKET_BOUNDARY_INVALID', 'Unexpected fixed-dispatch certification boundary.');
  }
  const workerVerification = verifyWorker(packet.worker_certification);
  const derived = deriveBlockers(packet.evidence, packet.expected, packet.worker_certification, workerVerification);
  if (!Array.isArray(packet.blockers) || JSON.stringify(derived) !== JSON.stringify([...new Set(packet.blockers.map(String))].sort())
    || packet.ready_for_separate_mount_authorization !== (derived.length === 0)) {
    throw failure(409, 'STORAGE_FIXED_DISPATCH_PACKET_TAMPERED', 'Fixed-dispatch evidence, blockers, and decision are inconsistent.');
  }
  const { certification_digest, ...core } = packet;
  const observed = digest(core);
  if (certification_digest !== observed || (expected_digest && hash(expected_digest, 'expected_digest') !== observed)) throw failure(409, 'STORAGE_FIXED_DISPATCH_PACKET_TAMPERED', 'Fixed-dispatch certification digest mismatch.');
  return freeze({ ok: true, valid: derived.length === 0, ready_for_separate_mount_authorization: derived.length === 0, observed_digest: observed, provider_dispatch_allowed: false, production_ready: false, secrets_included: false });
}
