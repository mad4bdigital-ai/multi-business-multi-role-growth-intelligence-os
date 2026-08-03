import { createHash } from 'node:crypto';

export const HOSTINGER_STORAGE_DEDICATED_WORKER_CERTIFICATION_VERSION = 'spec014-hostinger-storage-dedicated-worker-certification-v1';

const EVIDENCE_CONTRACT = 'spec014.hostinger-storage-dedicated-worker-evidence.v1';
const PACKET_CONTRACT = 'spec014.hostinger-storage-dedicated-worker-certification.v1';
const HASH_RE = /^[0-9a-f]{64}$/u;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u;
const MAX_LIFETIME_MS = 86_400_000;

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

function id(value, field, max = 256) {
  const result = String(value ?? '').trim().slice(0, max);
  if (!ID_RE.test(result)) throw failure(400, 'STORAGE_WORKER_CERT_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  return result;
}

function hash(value, field) {
  const result = String(value ?? '').trim().toLowerCase();
  if (!HASH_RE.test(result)) throw failure(400, 'STORAGE_WORKER_CERT_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  return result;
}

function bool(value, field) {
  if (typeof value !== 'boolean') throw failure(400, 'STORAGE_WORKER_CERT_BOOLEAN_REQUIRED', 'An explicit boolean is required.', { field });
  return value;
}

function count(value, field) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw failure(400, 'STORAGE_WORKER_CERT_COUNT_INVALID', 'A non-negative safe integer is required.', { field });
  return result;
}

function instant(value, field) {
  const text = String(value ?? '').trim();
  const epoch = Date.parse(text);
  if (!Number.isFinite(epoch)) throw failure(400, 'STORAGE_WORKER_CERT_TIME_INVALID', 'A valid timestamp is required.', { field });
  return { text, epoch };
}

function secretFree(value, path = 'value', depth = 0) {
  if (depth > 20 || value === null || value === undefined) return;
  if (Array.isArray(value)) return value.forEach((entry, index) => secretFree(entry, `${path}[${index}]`, depth + 1));
  if (typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'secrets_included' && entry !== false) throw failure(400, 'STORAGE_WORKER_CERT_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
    const allowedNegative = ['secrets_included', 'credential_values_in_evidence', 'credential_values_resolved'];
    if (!allowedNegative.includes(key) && /(password|passwd|secret|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command|credential_value|credential_material)/i.test(key)) {
      throw failure(400, 'STORAGE_WORKER_CERT_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Secrets and free-form execution fields are forbidden.', { path: `${path}.${key}` });
    }
    secretFree(entry, `${path}.${key}`, depth + 1);
  }
}

function bindings(value = {}) {
  secretFree(value, 'expected');
  return freeze({
    target_id: id(value.target_id, 'expected.target_id'),
    source_commit: hash(value.source_commit, 'expected.source_commit'),
    worker_id: id(value.worker_id, 'expected.worker_id'),
    worker_principal_id: id(value.worker_principal_id, 'expected.worker_principal_id'),
    worker_release_id: id(value.worker_release_id, 'expected.worker_release_id'),
    worker_image_digest: hash(value.worker_image_digest, 'expected.worker_image_digest'),
    artifact_provenance_digest: hash(value.artifact_provenance_digest, 'expected.artifact_provenance_digest'),
    toolchain_resolution_fingerprint: hash(value.toolchain_resolution_fingerprint, 'expected.toolchain_resolution_fingerprint'),
    toolchain_policy_fingerprint: hash(value.toolchain_policy_fingerprint, 'expected.toolchain_policy_fingerprint'),
    selected_tools_digest: hash(value.selected_tools_digest, 'expected.selected_tools_digest'),
    reviewed_program_digest: hash(value.reviewed_program_digest, 'expected.reviewed_program_digest'),
    host_key_revision: id(value.host_key_revision, 'expected.host_key_revision'),
    host_key_algorithm: id(value.host_key_algorithm, 'expected.host_key_algorithm', 64),
    host_key_fingerprint_digest: hash(value.host_key_fingerprint_digest, 'expected.host_key_fingerprint_digest'),
    secrets_included: false,
  });
}

function evidence(value = {}, now) {
  secretFree(value, 'evidence');
  if (value.contract !== EVIDENCE_CONTRACT || value.secrets_included !== false) throw failure(409, 'STORAGE_WORKER_CERT_EVIDENCE_CONTRACT_INVALID', 'Unexpected worker evidence contract.');
  const observed = instant(value.observed_at, 'evidence.observed_at');
  const expires = instant(value.expires_at, 'evidence.expires_at');
  if (observed.epoch > now || expires.epoch <= now || expires.epoch <= observed.epoch) throw failure(409, 'STORAGE_WORKER_CERT_FRESHNESS_INVALID', 'Worker evidence freshness is invalid.');
  if (expires.epoch - observed.epoch > MAX_LIFETIME_MS) throw failure(409, 'STORAGE_WORKER_CERT_LIFETIME_EXCEEDED', 'Worker evidence lifetime exceeds 24 hours.');
  const w = value.worker || {}, a = value.adapter || {}, t = value.toolchain || {}, h = value.host_key || {}, i = value.isolation || {};
  return freeze({
    contract: EVIDENCE_CONTRACT,
    observed_at: observed.text,
    expires_at: expires.text,
    source_commit: hash(value.source_commit, 'evidence.source_commit'),
    target_id: id(value.target_id, 'evidence.target_id'),
    worker: {
      worker_id: id(w.worker_id, 'worker.worker_id'), worker_kind: id(w.worker_kind, 'worker.worker_kind'), execution_domain: id(w.execution_domain, 'worker.execution_domain'),
      principal_id: id(w.principal_id, 'worker.principal_id'), release_id: id(w.release_id, 'worker.release_id'), image_digest: hash(w.image_digest, 'worker.image_digest'),
      artifact_provenance_digest: hash(w.artifact_provenance_digest, 'worker.artifact_provenance_digest'), dedicated: bool(w.dedicated, 'worker.dedicated'),
      public_runtime: bool(w.public_runtime, 'worker.public_runtime'), ephemeral_execution: bool(w.ephemeral_execution, 'worker.ephemeral_execution'), secrets_included: false,
    },
    adapter: {
      adapter_key: id(a.adapter_key, 'adapter.adapter_key'), operation_key: id(a.operation_key, 'adapter.operation_key'), reviewed_program_key: id(a.reviewed_program_key, 'adapter.reviewed_program_key'),
      reviewed_program_digest: hash(a.reviewed_program_digest, 'adapter.reviewed_program_digest'), structured_arguments_only: bool(a.structured_arguments_only, 'adapter.structured_arguments_only'),
      free_form_command_allowed: bool(a.free_form_command_allowed, 'adapter.free_form_command_allowed'), free_form_root_allowed: bool(a.free_form_root_allowed, 'adapter.free_form_root_allowed'),
      wildcard_allowed: bool(a.wildcard_allowed, 'adapter.wildcard_allowed'), secrets_included: false,
    },
    toolchain: {
      resolution_fingerprint: hash(t.resolution_fingerprint, 'toolchain.resolution_fingerprint'), policy_fingerprint: hash(t.policy_fingerprint, 'toolchain.policy_fingerprint'),
      selected_tools_digest: hash(t.selected_tools_digest, 'toolchain.selected_tools_digest'), binaries_verified: bool(t.binaries_verified, 'toolchain.binaries_verified'),
      unapproved_binary_allowed: bool(t.unapproved_binary_allowed, 'toolchain.unapproved_binary_allowed'), secrets_included: false,
    },
    host_key: {
      revision: id(h.revision, 'host_key.revision'), algorithm: id(h.algorithm, 'host_key.algorithm', 64), fingerprint_digest: hash(h.fingerprint_digest, 'host_key.fingerprint_digest'),
      pinned: bool(h.pinned, 'host_key.pinned'), verification_required: bool(h.verification_required, 'host_key.verification_required'), mismatch_fails_closed: bool(h.mismatch_fails_closed, 'host_key.mismatch_fails_closed'), secrets_included: false,
    },
    isolation: {
      public_runtime_dispatch_allowed: bool(i.public_runtime_dispatch_allowed, 'isolation.public_runtime_dispatch_allowed'), direct_http_dispatch_allowed: bool(i.direct_http_dispatch_allowed, 'isolation.direct_http_dispatch_allowed'),
      authority_resolution_allowed: bool(i.authority_resolution_allowed, 'isolation.authority_resolution_allowed'), approval_resolution_allowed: bool(i.approval_resolution_allowed, 'isolation.approval_resolution_allowed'),
      plan_mutation_allowed: bool(i.plan_mutation_allowed, 'isolation.plan_mutation_allowed'), credential_reference_resolution: id(i.credential_reference_resolution, 'isolation.credential_reference_resolution', 64),
      credential_values_in_evidence: bool(i.credential_values_in_evidence, 'isolation.credential_values_in_evidence'), provider_egress_scope: id(i.provider_egress_scope, 'isolation.provider_egress_scope', 64),
      inbound_network_listener: bool(i.inbound_network_listener, 'isolation.inbound_network_listener'), shell_input_allowed: bool(i.shell_input_allowed, 'isolation.shell_input_allowed'),
      filesystem_input_from_request_allowed: bool(i.filesystem_input_from_request_allowed, 'isolation.filesystem_input_from_request_allowed'), secrets_included: false,
    },
    repository_only: bool(value.repository_only, 'evidence.repository_only'), worker_process_started: bool(value.worker_process_started, 'evidence.worker_process_started'),
    provider_calls: count(value.provider_calls, 'evidence.provider_calls'), credential_resolutions: count(value.credential_resolutions, 'evidence.credential_resolutions'),
    runtime_mounts: count(value.runtime_mounts, 'evidence.runtime_mounts'), secrets_included: false,
  });
}

function blockers(e, b) {
  const result = [];
  const check = (condition, code) => { if (condition) result.push(code); };
  check(e.source_commit !== b.source_commit, 'STORAGE_WORKER_SOURCE_COMMIT_MISMATCH');
  check(e.target_id !== b.target_id, 'STORAGE_WORKER_TARGET_MISMATCH');
  check(e.worker.worker_id !== b.worker_id, 'STORAGE_WORKER_ID_MISMATCH');
  check(e.worker.principal_id !== b.worker_principal_id, 'STORAGE_WORKER_PRINCIPAL_MISMATCH');
  check(e.worker.release_id !== b.worker_release_id, 'STORAGE_WORKER_RELEASE_MISMATCH');
  check(e.worker.image_digest !== b.worker_image_digest, 'STORAGE_WORKER_IMAGE_MISMATCH');
  check(e.worker.artifact_provenance_digest !== b.artifact_provenance_digest, 'STORAGE_WORKER_PROVENANCE_MISMATCH');
  check(e.worker.worker_kind !== 'dedicated_provider_worker' || !e.worker.dedicated, 'STORAGE_DEDICATED_WORKER_REQUIRED');
  check(e.worker.execution_domain !== 'hostinger_storage', 'STORAGE_WORKER_EXECUTION_DOMAIN_MISMATCH');
  check(e.worker.public_runtime, 'STORAGE_PUBLIC_RUNTIME_WORKER_FORBIDDEN');
  check(!e.worker.ephemeral_execution, 'STORAGE_WORKER_EPHEMERAL_EXECUTION_REQUIRED');
  check(e.adapter.adapter_key !== 'hostinger_ssh_storage_v1', 'STORAGE_FIXED_ADAPTER_REQUIRED');
  check(e.adapter.operation_key !== 'apply_exact_plan', 'STORAGE_FIXED_ADAPTER_OPERATION_REQUIRED');
  check(e.adapter.reviewed_program_key !== 'hostinger-storage-cleanup.sh' || e.adapter.reviewed_program_digest !== b.reviewed_program_digest, 'STORAGE_REVIEWED_PROGRAM_MISMATCH');
  check(!e.adapter.structured_arguments_only, 'STORAGE_STRUCTURED_ARGUMENTS_REQUIRED');
  check(e.adapter.free_form_command_allowed || e.adapter.free_form_root_allowed || e.adapter.wildcard_allowed, 'STORAGE_FREE_FORM_INPUT_FORBIDDEN');
  check(e.toolchain.resolution_fingerprint !== b.toolchain_resolution_fingerprint, 'STORAGE_WORKER_TOOLCHAIN_RESOLUTION_MISMATCH');
  check(e.toolchain.policy_fingerprint !== b.toolchain_policy_fingerprint, 'STORAGE_WORKER_TOOLCHAIN_POLICY_MISMATCH');
  check(e.toolchain.selected_tools_digest !== b.selected_tools_digest, 'STORAGE_WORKER_SELECTED_TOOLS_MISMATCH');
  check(!e.toolchain.binaries_verified || e.toolchain.unapproved_binary_allowed, 'STORAGE_WORKER_BINARY_POLICY_INVALID');
  check(e.host_key.revision !== b.host_key_revision || e.host_key.algorithm !== b.host_key_algorithm || e.host_key.fingerprint_digest !== b.host_key_fingerprint_digest, 'STORAGE_HOST_KEY_BINDING_MISMATCH');
  check(!e.host_key.pinned || !e.host_key.verification_required || !e.host_key.mismatch_fails_closed, 'STORAGE_SSH_HOST_KEY_POLICY_INVALID');
  check(e.isolation.public_runtime_dispatch_allowed, 'STORAGE_PUBLIC_RUNTIME_DISPATCH_FORBIDDEN');
  check(e.isolation.direct_http_dispatch_allowed, 'STORAGE_DIRECT_HTTP_DISPATCH_FORBIDDEN');
  check(e.isolation.authority_resolution_allowed || e.isolation.approval_resolution_allowed || e.isolation.plan_mutation_allowed, 'STORAGE_WORKER_CONTROL_PLANE_AUTHORITY_FORBIDDEN');
  check(e.isolation.credential_reference_resolution !== 'worker_only' || e.isolation.credential_values_in_evidence, 'STORAGE_WORKER_CREDENTIAL_BOUNDARY_INVALID');
  check(e.isolation.provider_egress_scope !== 'hostinger_target_only' || e.isolation.inbound_network_listener, 'STORAGE_WORKER_NETWORK_BOUNDARY_INVALID');
  check(e.isolation.shell_input_allowed || e.isolation.filesystem_input_from_request_allowed, 'STORAGE_WORKER_REQUEST_INPUT_FORBIDDEN');
  check(!e.repository_only || e.worker_process_started || e.provider_calls !== 0 || e.credential_resolutions !== 0 || e.runtime_mounts !== 0, 'STORAGE_WORKER_CERT_REPOSITORY_ONLY_BOUNDARY_INVALID');
  return [...new Set(result)].sort();
}

export function buildHostingerStorageDedicatedWorkerCertification({ evidence: rawEvidence, expected, now = Date.now() } = {}) {
  const nowEpoch = Number(now);
  if (!Number.isFinite(nowEpoch)) throw failure(400, 'STORAGE_WORKER_CERT_NOW_INVALID', 'A valid evaluation time is required.');
  const expectedBindings = bindings(expected);
  const normalizedEvidence = evidence(rawEvidence, nowEpoch);
  const derived = blockers(normalizedEvidence, expectedBindings);
  const core = {
    contract: PACKET_CONTRACT,
    version: HOSTINGER_STORAGE_DEDICATED_WORKER_CERTIFICATION_VERSION,
    bindings: expectedBindings,
    evidence: normalizedEvidence,
    blockers: derived,
    ready_for_fixed_dispatch_certification: derived.length === 0,
    worker_created: false,
    worker_process_started: false,
    worker_mounted: false,
    route_mounted: false,
    dependency_injected: false,
    credential_values_resolved: 0,
    provider_calls: 0,
    provider_dispatch_allowed: false,
    production_ready: false,
    secrets_included: false,
  };
  return freeze({ ...core, certification_digest: digest(core) });
}

export function verifyHostingerStorageDedicatedWorkerCertification({ packet, expected_digest } = {}) {
  secretFree(packet, 'packet');
  if (packet?.contract !== PACKET_CONTRACT || packet?.version !== HOSTINGER_STORAGE_DEDICATED_WORKER_CERTIFICATION_VERSION
    || packet.worker_created !== false || packet.worker_process_started !== false || packet.worker_mounted !== false || packet.route_mounted !== false
    || packet.dependency_injected !== false || packet.credential_values_resolved !== 0 || packet.provider_calls !== 0
    || packet.provider_dispatch_allowed !== false || packet.production_ready !== false || packet.secrets_included !== false) {
    throw failure(409, 'STORAGE_WORKER_CERT_PACKET_BOUNDARY_INVALID', 'Unexpected worker certification packet boundary.');
  }
  if (!Array.isArray(packet.blockers)) throw failure(409, 'STORAGE_WORKER_CERT_PACKET_TAMPERED', 'Worker certification blockers are invalid.');
  const derived = blockers(packet.evidence, packet.bindings);
  const supplied = [...new Set(packet.blockers.map(String))].sort();
  if (JSON.stringify(derived) !== JSON.stringify(supplied) || packet.ready_for_fixed_dispatch_certification !== (derived.length === 0)) {
    throw failure(409, 'STORAGE_WORKER_CERT_PACKET_TAMPERED', 'Worker evidence, blockers, and decision are inconsistent.');
  }
  const { certification_digest, ...core } = packet;
  const observed = digest(core);
  if (certification_digest !== observed || (expected_digest && hash(expected_digest, 'expected_digest') !== observed)) {
    throw failure(409, 'STORAGE_WORKER_CERT_PACKET_TAMPERED', 'Worker certification digest mismatch.');
  }
  return freeze({ ok: true, valid: derived.length === 0, ready_for_fixed_dispatch_certification: derived.length === 0, observed_digest: observed, worker_mounted: false, provider_dispatch_allowed: false, production_ready: false, secrets_included: false });
}
