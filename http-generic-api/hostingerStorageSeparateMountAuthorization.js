import { createHash } from 'node:crypto';
import { verifyHostingerStorageDurableTenantRuntimeBridgeReadiness } from './hostingerStorageDurableTenantRuntimeBridgeReadiness.js';
import { verifyHostingerStorageFixedDispatchCertification } from './hostingerStorageFixedDispatchCertification.js';

export const HOSTINGER_STORAGE_SEPARATE_MOUNT_AUTHORIZATION_VERSION = 'spec014-hostinger-storage-separate-mount-authorization-v1';

const EVIDENCE_CONTRACT = 'spec014.hostinger-storage-separate-mount-authorization-evidence.v1';
const PACKET_CONTRACT = 'spec014.hostinger-storage-separate-mount-authorization.v1';
const HASH_RE = /^[0-9a-f]{64}$/u;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u;
const MAX_LIFETIME_MS = 3_600_000;
const ROUTE_PATH = '/tenant/storage-operations/apply-plan';
const DEPENDENCY_KEY = 'tenantStorageRuntime';

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

function digest(value) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function freeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); Object.values(value).forEach(freeze); return value; }

function id(value, field, max = 256) {
  const result = String(value ?? '').trim().slice(0, max);
  if (!ID_RE.test(result)) throw failure(400, 'STORAGE_MOUNT_AUTH_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  return result;
}
function hash(value, field) {
  const result = String(value ?? '').trim().toLowerCase();
  if (!HASH_RE.test(result)) throw failure(400, 'STORAGE_MOUNT_AUTH_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  return result;
}
function bool(value, field) { if (typeof value !== 'boolean') throw failure(400, 'STORAGE_MOUNT_AUTH_BOOLEAN_REQUIRED', 'An explicit boolean is required.', { field }); return value; }
function count(value, field) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 0) throw failure(400, 'STORAGE_MOUNT_AUTH_COUNT_INVALID', 'A non-negative safe integer is required.', { field }); return result; }
function instant(value, field) { const result = String(value ?? '').trim(); const epoch = Date.parse(result); if (!Number.isFinite(epoch)) throw failure(400, 'STORAGE_MOUNT_AUTH_TIME_INVALID', 'A valid timestamp is required.', { field }); return { result, epoch }; }

function secretFree(value, path = 'value', depth = 0) {
  if (depth > 28 || value === null || value === undefined) return;
  if (Array.isArray(value)) return value.forEach((entry, index) => secretFree(entry, `${path}[${index}]`, depth + 1));
  if (typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'secrets_included' && entry !== false) throw failure(400, 'STORAGE_MOUNT_AUTH_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
    const allowed = ['secrets_included', 'credential_values_resolved', 'credential_values_in_evidence', 'shell_command_present'];
    if (!allowed.includes(key) && /(password|passwd|secret|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command|credential_value|credential_material)/i.test(key)) {
      throw failure(400, 'STORAGE_MOUNT_AUTH_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Secrets and execution payloads are forbidden.', { path: `${path}.${key}` });
    }
    secretFree(entry, `${path}.${key}`, depth + 1);
  }
}

function normalizeExpected(value = {}) {
  secretFree(value, 'expected');
  return freeze({
    authorization_id: id(value.authorization_id, 'expected.authorization_id'),
    authorization_revision: id(value.authorization_revision, 'expected.authorization_revision'),
    mount_generation: count(value.mount_generation, 'expected.mount_generation'),
    issuer_principal_id: id(value.issuer_principal_id, 'expected.issuer_principal_id'),
    source_commit: hash(value.source_commit, 'expected.source_commit'),
    deployed_runtime_sha: hash(value.deployed_runtime_sha, 'expected.deployed_runtime_sha'),
    database_fingerprint: hash(value.database_fingerprint, 'expected.database_fingerprint'),
    schema_verification_digest: hash(value.schema_verification_digest, 'expected.schema_verification_digest'),
    readback_cycle_id: id(value.readback_cycle_id, 'expected.readback_cycle_id'),
    bridge_readiness_digest: hash(value.bridge_readiness_digest, 'expected.bridge_readiness_digest'),
    fixed_dispatch_certification_digest: hash(value.fixed_dispatch_certification_digest, 'expected.fixed_dispatch_certification_digest'),
    worker_certification_digest: hash(value.worker_certification_digest, 'expected.worker_certification_digest'),
    authorization_bundle_hash: hash(value.authorization_bundle_hash, 'expected.authorization_bundle_hash'),
    target_id: id(value.target_id, 'expected.target_id'),
    operation_id: id(value.operation_id, 'expected.operation_id'),
    plan_id: id(value.plan_id, 'expected.plan_id'),
    plan_hash: hash(value.plan_hash, 'expected.plan_hash'),
    execution_lease_id: id(value.execution_lease_id, 'expected.execution_lease_id'),
    lease_generation: count(value.lease_generation, 'expected.lease_generation'),
    approval_set_hash: hash(value.approval_set_hash, 'expected.approval_set_hash'),
    capability_envelope_digest: hash(value.capability_envelope_digest, 'expected.capability_envelope_digest'),
    mount_policy_fingerprint: hash(value.mount_policy_fingerprint, 'expected.mount_policy_fingerprint'),
    rollback_plan_digest: hash(value.rollback_plan_digest, 'expected.rollback_plan_digest'),
    secrets_included: false,
  });
}

function normalizeEvidence(value = {}, now) {
  secretFree(value, 'evidence');
  if (value.contract !== EVIDENCE_CONTRACT || value.secrets_included !== false) throw failure(409, 'STORAGE_MOUNT_AUTH_EVIDENCE_CONTRACT_INVALID', 'Unexpected mount-authorization evidence contract.');
  const observed = instant(value.observed_at, 'evidence.observed_at');
  const expires = instant(value.expires_at, 'evidence.expires_at');
  if (observed.epoch > now || expires.epoch <= now || expires.epoch <= observed.epoch) throw failure(409, 'STORAGE_MOUNT_AUTH_FRESHNESS_INVALID', 'Mount-authorization freshness is invalid.');
  if (expires.epoch - observed.epoch > MAX_LIFETIME_MS) throw failure(409, 'STORAGE_MOUNT_AUTH_LIFETIME_EXCEEDED', 'Mount authorization exceeds one hour.');
  const a = value.authorization || {}, r = value.route || {}, b = value.boundary || {};
  return freeze({
    contract: EVIDENCE_CONTRACT,
    observed_at: observed.result,
    expires_at: expires.result,
    authorization: {
      authorization_id: id(a.authorization_id, 'authorization.authorization_id'),
      authorization_revision: id(a.authorization_revision, 'authorization.authorization_revision'),
      mount_generation: count(a.mount_generation, 'authorization.mount_generation'),
      issuer_principal_id: id(a.issuer_principal_id, 'authorization.issuer_principal_id'),
      status: id(a.status, 'authorization.status', 32),
      mode: id(a.mode, 'authorization.mode', 64),
      one_shot: bool(a.one_shot, 'authorization.one_shot'),
      consumed: bool(a.consumed, 'authorization.consumed'),
      default_off: bool(a.default_off, 'authorization.default_off'),
      source_commit: hash(a.source_commit, 'authorization.source_commit'),
      deployed_runtime_sha: hash(a.deployed_runtime_sha, 'authorization.deployed_runtime_sha'),
      database_fingerprint: hash(a.database_fingerprint, 'authorization.database_fingerprint'),
      schema_verification_digest: hash(a.schema_verification_digest, 'authorization.schema_verification_digest'),
      readback_cycle_id: id(a.readback_cycle_id, 'authorization.readback_cycle_id'),
      bridge_readiness_digest: hash(a.bridge_readiness_digest, 'authorization.bridge_readiness_digest'),
      fixed_dispatch_certification_digest: hash(a.fixed_dispatch_certification_digest, 'authorization.fixed_dispatch_certification_digest'),
      worker_certification_digest: hash(a.worker_certification_digest, 'authorization.worker_certification_digest'),
      authorization_bundle_hash: hash(a.authorization_bundle_hash, 'authorization.authorization_bundle_hash'),
      target_id: id(a.target_id, 'authorization.target_id'),
      operation_id: id(a.operation_id, 'authorization.operation_id'),
      plan_id: id(a.plan_id, 'authorization.plan_id'),
      plan_hash: hash(a.plan_hash, 'authorization.plan_hash'),
      execution_lease_id: id(a.execution_lease_id, 'authorization.execution_lease_id'),
      lease_generation: count(a.lease_generation, 'authorization.lease_generation'),
      approval_set_hash: hash(a.approval_set_hash, 'authorization.approval_set_hash'),
      capability_envelope_digest: hash(a.capability_envelope_digest, 'authorization.capability_envelope_digest'),
      mount_policy_fingerprint: hash(a.mount_policy_fingerprint, 'authorization.mount_policy_fingerprint'),
      rollback_plan_digest: hash(a.rollback_plan_digest, 'authorization.rollback_plan_digest'),
      secrets_included: false,
    },
    route: {
      path: String(r.path ?? '').trim().slice(0, 128),
      dependency_key: id(r.dependency_key, 'route.dependency_key'),
      fail_closed_status: count(r.fail_closed_status, 'route.fail_closed_status'),
      currently_unmounted: bool(r.currently_unmounted, 'route.currently_unmounted'),
      tenant_user_jwt_required: bool(r.tenant_user_jwt_required, 'route.tenant_user_jwt_required'),
      secrets_included: false,
    },
    boundary: {
      repository_only: bool(b.repository_only, 'boundary.repository_only'),
      authorization_persisted: bool(b.authorization_persisted, 'boundary.authorization_persisted'),
      mount_performed: bool(b.mount_performed, 'boundary.mount_performed'),
      dependency_injected: bool(b.dependency_injected, 'boundary.dependency_injected'),
      runtime_mounted: bool(b.runtime_mounted, 'boundary.runtime_mounted'),
      route_mounted: bool(b.route_mounted, 'boundary.route_mounted'),
      worker_mounted: bool(b.worker_mounted, 'boundary.worker_mounted'),
      dispatch_job_enqueued: bool(b.dispatch_job_enqueued, 'boundary.dispatch_job_enqueued'),
      credential_resolutions: count(b.credential_resolutions, 'boundary.credential_resolutions'),
      database_writes: count(b.database_writes, 'boundary.database_writes'),
      provider_calls: count(b.provider_calls, 'boundary.provider_calls'),
      secrets_included: false,
    },
    secrets_included: false,
  });
}

function evidenceWindow(packet, field) {
  const observed = instant(packet?.evidence?.observed_at, `${field}.observed_at`);
  const expires = instant(packet?.evidence?.expires_at, `${field}.expires_at`);
  if (expires.epoch <= observed.epoch) throw failure(409, 'STORAGE_MOUNT_AUTH_PREREQUISITE_WINDOW_INVALID', 'A prerequisite evidence window is invalid.', { field });
  return { observed: observed.epoch, expires: expires.epoch };
}

function verifyBridge(packet) {
  try { return verifyHostingerStorageDurableTenantRuntimeBridgeReadiness({ packet, expected_digest: packet?.readiness_digest }); }
  catch (error) { throw failure(409, 'STORAGE_MOUNT_AUTH_BRIDGE_READINESS_TAMPERED', 'Durable bridge readiness is invalid.', { cause_code: error?.code || 'unknown' }); }
}
function verifyDispatch(packet) {
  try { return verifyHostingerStorageFixedDispatchCertification({ packet, expected_digest: packet?.certification_digest }); }
  catch (error) { throw failure(409, 'STORAGE_MOUNT_AUTH_FIXED_DISPATCH_TAMPERED', 'Fixed dispatch certification is invalid.', { cause_code: error?.code || 'unknown' }); }
}

function deriveBlockers(e, x, bridgePacket, bridgeVerification, dispatchPacket, dispatchVerification, nowEpoch) {
  const out = [];
  const bridgeWindow = evidenceWindow(bridgePacket, 'bridge_readiness.evidence');
  const dispatchWindow = evidenceWindow(dispatchPacket, 'fixed_dispatch_certification.evidence');
  const workerWindow = evidenceWindow(dispatchPacket?.worker_certification, 'worker_certification.evidence');
  const authorizationObserved = Date.parse(e.observed_at);
  const authorizationExpires = Date.parse(e.expires_at);
  const add = (condition, code) => { if (condition) out.push(code); };
  add(bridgeVerification.valid !== true || bridgeVerification.ready_for_separate_mount_authorization !== true, 'STORAGE_MOUNT_AUTH_BRIDGE_NOT_READY');
  add(dispatchVerification.valid !== true || dispatchVerification.ready_for_separate_mount_authorization !== true, 'STORAGE_MOUNT_AUTH_FIXED_DISPATCH_NOT_READY');
  add(bridgePacket.readiness_digest !== x.bridge_readiness_digest, 'STORAGE_MOUNT_AUTH_BRIDGE_DIGEST_MISMATCH');
  add(dispatchPacket.certification_digest !== x.fixed_dispatch_certification_digest, 'STORAGE_MOUNT_AUTH_DISPATCH_DIGEST_MISMATCH');
  add(dispatchPacket.worker_certification?.certification_digest !== x.worker_certification_digest, 'STORAGE_MOUNT_AUTH_WORKER_DIGEST_MISMATCH');
  add(bridgeWindow.expires <= nowEpoch || dispatchWindow.expires <= nowEpoch || workerWindow.expires <= nowEpoch, 'STORAGE_MOUNT_AUTH_PREREQUISITE_EXPIRED');
  add(authorizationExpires > bridgeWindow.expires || authorizationExpires > dispatchWindow.expires || authorizationExpires > workerWindow.expires, 'STORAGE_MOUNT_AUTH_OUTLIVES_PREREQUISITE');
  add(authorizationObserved < bridgeWindow.observed || authorizationObserved < dispatchWindow.observed || authorizationObserved < workerWindow.observed, 'STORAGE_MOUNT_AUTH_PREREQUISITE_OBSERVATION_ORDER_INVALID');
  const a = e.authorization;
  for (const key of ['authorization_id','authorization_revision','mount_generation','issuer_principal_id','source_commit','deployed_runtime_sha','database_fingerprint','schema_verification_digest','readback_cycle_id','bridge_readiness_digest','fixed_dispatch_certification_digest','worker_certification_digest','authorization_bundle_hash','target_id','operation_id','plan_id','plan_hash','execution_lease_id','lease_generation','approval_set_hash','capability_envelope_digest','mount_policy_fingerprint','rollback_plan_digest']) add(a[key] !== x[key], `STORAGE_MOUNT_AUTH_${key.toUpperCase()}_MISMATCH`);
  add(a.status !== 'approved' || a.mode !== 'single_use_mount' || !a.one_shot || a.consumed || !a.default_off, 'STORAGE_MOUNT_AUTH_POLICY_INVALID');
  add(a.source_commit !== a.deployed_runtime_sha, 'STORAGE_MOUNT_AUTH_RUNTIME_PARITY_REQUIRED');
  add(e.route.path !== ROUTE_PATH || e.route.dependency_key !== DEPENDENCY_KEY || e.route.fail_closed_status !== 503 || !e.route.currently_unmounted || !e.route.tenant_user_jwt_required, 'STORAGE_MOUNT_AUTH_ROUTE_BOUNDARY_INVALID');
  add(bridgePacket.composition?.source_commit !== x.source_commit || bridgePacket.composition?.deployed_runtime_sha !== x.deployed_runtime_sha || bridgePacket.composition?.database_fingerprint !== x.database_fingerprint || bridgePacket.composition?.schema_verification_digest !== x.schema_verification_digest || bridgePacket.composition?.readback_cycle_id !== x.readback_cycle_id, 'STORAGE_MOUNT_AUTH_BRIDGE_PROVENANCE_MISMATCH');
  const dx = dispatchPacket.expected || {};
  add(dx.source_commit !== x.source_commit || dx.authorization_bundle_hash !== x.authorization_bundle_hash || dx.target_id !== x.target_id || dx.operation_id !== x.operation_id || dx.plan_id !== x.plan_id || dx.plan_hash !== x.plan_hash || dx.execution_lease_id !== x.execution_lease_id || dx.lease_generation !== x.lease_generation, 'STORAGE_MOUNT_AUTH_DISPATCH_BINDING_MISMATCH');
  const b = e.boundary;
  add(!b.repository_only || b.authorization_persisted || b.mount_performed || b.dependency_injected || b.runtime_mounted || b.route_mounted || b.worker_mounted || b.dispatch_job_enqueued || b.credential_resolutions !== 0 || b.database_writes !== 0 || b.provider_calls !== 0, 'STORAGE_MOUNT_AUTH_REPOSITORY_ONLY_BOUNDARY_INVALID');
  return [...new Set(out)].sort();
}

export function buildHostingerStorageSeparateMountAuthorization({ bridge_readiness, fixed_dispatch_certification, evidence, expected, now = Date.now() } = {}) {
  const nowEpoch = Number(now);
  if (!Number.isFinite(nowEpoch)) throw failure(400, 'STORAGE_MOUNT_AUTH_NOW_INVALID', 'A valid evaluation time is required.');
  secretFree(bridge_readiness, 'bridge_readiness');
  secretFree(fixed_dispatch_certification, 'fixed_dispatch_certification');
  const bridgeVerification = verifyBridge(bridge_readiness);
  const dispatchVerification = verifyDispatch(fixed_dispatch_certification);
  const normalizedExpected = normalizeExpected(expected);
  const normalizedEvidence = normalizeEvidence(evidence, nowEpoch);
  const blockers = deriveBlockers(normalizedEvidence, normalizedExpected, bridge_readiness, bridgeVerification, fixed_dispatch_certification, dispatchVerification, nowEpoch);
  const core = {
    contract: PACKET_CONTRACT,
    version: HOSTINGER_STORAGE_SEPARATE_MOUNT_AUTHORIZATION_VERSION,
    bridge_readiness,
    fixed_dispatch_certification,
    expected: normalizedExpected,
    evidence: normalizedEvidence,
    blockers,
    ready_for_authorized_mount_execution: blockers.length === 0,
    authorization_packet_created: true,
    authorization_persisted: false,
    mount_performed: false,
    dependency_injected: false,
    runtime_mounted: false,
    route_mounted: false,
    worker_mounted: false,
    dispatch_job_enqueued: false,
    credential_values_resolved: 0,
    database_writes: 0,
    provider_calls: 0,
    provider_dispatch_allowed: false,
    production_ready: false,
    secrets_included: false,
  };
  return freeze({ ...core, authorization_digest: digest(core) });
}

export function verifyHostingerStorageSeparateMountAuthorization({ packet, expected_digest, now = Date.now() } = {}) {
  const nowEpoch = Number(now);
  if (!Number.isFinite(nowEpoch)) throw failure(400, 'STORAGE_MOUNT_AUTH_NOW_INVALID', 'A valid verification time is required.');
  secretFree(packet, 'packet');
  if (packet?.contract !== PACKET_CONTRACT || packet?.version !== HOSTINGER_STORAGE_SEPARATE_MOUNT_AUTHORIZATION_VERSION
    || packet.authorization_packet_created !== true || packet.authorization_persisted !== false || packet.mount_performed !== false
    || packet.dependency_injected !== false || packet.runtime_mounted !== false || packet.route_mounted !== false || packet.worker_mounted !== false
    || packet.dispatch_job_enqueued !== false || packet.credential_values_resolved !== 0 || packet.database_writes !== 0 || packet.provider_calls !== 0
    || packet.provider_dispatch_allowed !== false || packet.production_ready !== false || packet.secrets_included !== false) throw failure(409, 'STORAGE_MOUNT_AUTH_PACKET_BOUNDARY_INVALID', 'Unexpected mount-authorization packet boundary.');
  const bridgeVerification = verifyBridge(packet.bridge_readiness);
  const dispatchVerification = verifyDispatch(packet.fixed_dispatch_certification);
  const blockers = deriveBlockers(packet.evidence, packet.expected, packet.bridge_readiness, bridgeVerification, packet.fixed_dispatch_certification, dispatchVerification, nowEpoch);
  if (!Array.isArray(packet.blockers) || JSON.stringify(blockers) !== JSON.stringify([...new Set(packet.blockers.map(String))].sort()) || packet.ready_for_authorized_mount_execution !== (blockers.length === 0)) throw failure(409, 'STORAGE_MOUNT_AUTH_PACKET_TAMPERED', 'Mount authorization evidence, blockers, and decision are inconsistent.');
  const { authorization_digest, ...core } = packet;
  const observed = digest(core);
  if (authorization_digest !== observed || (expected_digest && hash(expected_digest, 'expected_digest') !== observed)) throw failure(409, 'STORAGE_MOUNT_AUTH_PACKET_TAMPERED', 'Mount authorization digest mismatch.');
  return freeze({ ok: true, valid: blockers.length === 0, ready_for_authorized_mount_execution: blockers.length === 0, observed_digest: observed, mount_performed: false, provider_dispatch_allowed: false, production_ready: false, secrets_included: false });
}
