import { createHash } from 'node:crypto';
import {
  HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION,
  isCanonicalHostingerStorageVerifiedSqlRuntimeComposition,
} from './hostingerStorageVerifiedSqlRuntimeComposition.js';
import { HOSTINGER_STORAGE_TENANT_RUNTIME_VERSION } from './hostingerStorageTenantRuntime.js';
import { HOSTINGER_STORAGE_TENANT_CANARY_VERSION } from './hostingerStorageTenantCanary.js';
import { HOSTINGER_STORAGE_SYNTHETIC_EXECUTOR_VERSION } from './hostingerStorageSyntheticExecutor.js';

export const HOSTINGER_STORAGE_DURABLE_TENANT_RUNTIME_BRIDGE_READINESS_VERSION = 'spec014-hostinger-storage-durable-tenant-runtime-bridge-readiness-v1';

const SHA256_RE = /^[0-9a-f]{64}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const EVIDENCE_CONTRACT = 'spec014.hostinger-storage-durable-tenant-runtime-bridge-evidence.v1';
const READINESS_CONTRACT = 'spec014.hostinger-storage-durable-tenant-runtime-bridge-readiness.v1';
const ROUTE_PATH = '/tenant/storage-operations/apply-plan';
const DEPENDENCY_KEY = 'tenantStorageRuntime';
const REQUIRED_CAPABILITIES = Object.freeze({
  canonical_repository_facade_ready: 'CANONICAL_REPOSITORY_FACADE_MISSING',
  plan_item_parent_registration_ready: 'PLAN_ITEM_PARENT_REGISTRATION_MISSING',
  run_parent_creation_ready: 'RUN_PARENT_CREATION_MISSING',
  journal_translation_ready: 'PARENT_AWARE_JOURNAL_TRANSLATION_MISSING',
  reconciliation_translation_ready: 'PARENT_AWARE_RECONCILIATION_TRANSLATION_MISSING',
  durable_authority_store_ready: 'DURABLE_AUTHORITY_STORE_MISSING',
  durable_enablement_registry_ready: 'DURABLE_ENABLEMENT_REGISTRY_MISSING',
  tenant_safe_projection_ready: 'TENANT_SAFE_DURABLE_PROJECTION_MISSING',
  worker_certification_ready: 'DEDICATED_WORKER_CERTIFICATION_MISSING',
  fixed_dispatch_ready: 'FIXED_DISPATCH_CERTIFICATION_MISSING',
  crash_safe_restart_reconciliation_ready: 'CRASH_SAFE_RESTART_RECONCILIATION_MISSING',
});

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
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

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function hash(value, field) {
  const result = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(result)) throw fail(400, 'STORAGE_DURABLE_BRIDGE_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  return result;
}

function identifier(value, field, max = 256) {
  const result = text(value, max);
  if (!SAFE_ID_RE.test(result) || result.length > max) {
    throw fail(400, 'STORAGE_DURABLE_BRIDGE_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return result;
}

function timestamp(value, field) {
  const result = text(value, 64);
  const epoch = Date.parse(result);
  if (!Number.isFinite(epoch)) throw fail(400, 'STORAGE_DURABLE_BRIDGE_TIME_INVALID', 'A valid timestamp is required.', { field });
  return { value: result, epoch };
}

function assertSecretFree(value, path = 'value', depth = 0) {
  if (depth > 20 || value === null || value === undefined) return;
  if (Array.isArray(value)) return value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1));
  if (typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'secrets_included' && entry !== false) {
      throw fail(400, 'STORAGE_DURABLE_BRIDGE_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
    }
    if (key !== 'secrets_included' && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command)/i.test(key)) {
      throw fail(400, 'STORAGE_DURABLE_BRIDGE_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Bridge readiness evidence cannot contain secrets or free-form execution fields.', { path: `${path}.${key}` });
    }
    assertSecretFree(entry, `${path}.${key}`, depth + 1);
  }
}

function deriveBlockers(capabilities, { packet = false } = {}) {
  const blockers = [];
  for (const [key, code] of Object.entries(REQUIRED_CAPABILITIES)) {
    if (typeof capabilities?.[key] !== 'boolean') {
      if (packet) throw fail(409, 'STORAGE_DURABLE_BRIDGE_PACKET_TAMPERED', 'Readiness packet contains invalid capability values.', { capability: key });
      throw fail(400, 'STORAGE_DURABLE_BRIDGE_CAPABILITY_INVALID', 'Every bridge capability must be an explicit boolean.', { capability: key });
    }
    if (capabilities[key] !== true) blockers.push(code);
  }
  return blockers.sort();
}

function normalizeEvidence(value, composition, nowEpoch) {
  assertSecretFree(value, 'evidence');
  if (value?.contract !== EVIDENCE_CONTRACT
    || value?.read_only !== true
    || value?.database_writes !== 0
    || value?.provider_calls !== 0
    || value?.route_mutations !== 0
    || value?.secrets_included !== false) {
    throw fail(409, 'STORAGE_DURABLE_BRIDGE_EVIDENCE_CONTRACT_INVALID', 'Unexpected or unsafe bridge-readiness evidence contract.');
  }
  const observed = timestamp(value.observed_at, 'evidence.observed_at');
  const expires = timestamp(value.expires_at, 'evidence.expires_at');
  const route = value.route || {};
  const versions = value.versions || {};
  const normalized = {
    contract: EVIDENCE_CONTRACT,
    source_commit: hash(value.source_commit, 'evidence.source_commit'),
    deployed_runtime_sha: hash(value.deployed_runtime_sha, 'evidence.deployed_runtime_sha'),
    database_fingerprint: hash(value.database_fingerprint, 'evidence.database_fingerprint'),
    schema_verification_digest: hash(value.schema_verification_digest, 'evidence.schema_verification_digest'),
    readback_cycle_id: identifier(value.readback_cycle_id, 'evidence.readback_cycle_id'),
    observed_at: observed.value,
    expires_at: expires.value,
    route: Object.freeze({
      path: text(route.path, 128),
      dependency_key: identifier(route.dependency_key, 'evidence.route.dependency_key'),
      fail_closed_status: Number(route.fail_closed_status),
      default_unmounted: route.default_unmounted === true,
      tenant_user_jwt_required: route.tenant_user_jwt_required === true,
      secrets_included: false,
    }),
    versions: Object.freeze({
      composition: text(versions.composition, 128),
      tenant_runtime: text(versions.tenant_runtime, 128),
      tenant_canary: text(versions.tenant_canary, 128),
      synthetic_executor: text(versions.synthetic_executor, 128),
      secrets_included: false,
    }),
    capabilities: Object.freeze(Object.fromEntries(Object.keys(REQUIRED_CAPABILITIES).map((key) => [key, value.capabilities?.[key]]))),
    read_only: true,
    database_writes: 0,
    provider_calls: 0,
    route_mutations: 0,
    secrets_included: false,
  };

  const provenance = composition.schema_provenance;
  if (normalized.source_commit !== provenance.source_commit
    || normalized.deployed_runtime_sha !== provenance.deployed_runtime_sha
    || normalized.database_fingerprint !== provenance.database_fingerprint
    || normalized.schema_verification_digest !== provenance.evidence_digest
    || normalized.readback_cycle_id !== provenance.readback_cycle_id) {
    throw fail(409, 'STORAGE_DURABLE_BRIDGE_PROVENANCE_MISMATCH', 'Bridge readiness belongs to a different runtime, database, schema verification, or readback cycle.');
  }
  if (normalized.source_commit !== normalized.deployed_runtime_sha) {
    throw fail(409, 'STORAGE_DURABLE_BRIDGE_RUNTIME_PARITY_REQUIRED', 'Exact deployed-runtime parity is required.');
  }
  if (observed.epoch > nowEpoch || expires.epoch <= nowEpoch || expires.epoch <= observed.epoch) {
    throw fail(409, 'STORAGE_DURABLE_BRIDGE_EVIDENCE_FRESHNESS_INVALID', 'Bridge-readiness evidence freshness window is invalid.');
  }
  if (normalized.route.path !== ROUTE_PATH
    || normalized.route.dependency_key !== DEPENDENCY_KEY
    || normalized.route.fail_closed_status !== 503
    || normalized.route.default_unmounted !== true
    || normalized.route.tenant_user_jwt_required !== true) {
    throw fail(409, 'STORAGE_DURABLE_BRIDGE_ROUTE_CONTRACT_DRIFT', 'Tenant route contract differs from the reviewed fail-closed mount seam.');
  }
  if (normalized.versions.composition !== HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION
    || normalized.versions.tenant_runtime !== HOSTINGER_STORAGE_TENANT_RUNTIME_VERSION
    || normalized.versions.tenant_canary !== HOSTINGER_STORAGE_TENANT_CANARY_VERSION
    || normalized.versions.synthetic_executor !== HOSTINGER_STORAGE_SYNTHETIC_EXECUTOR_VERSION) {
    throw fail(409, 'STORAGE_DURABLE_BRIDGE_VERSION_DRIFT', 'Bridge evidence targets different runtime component versions.');
  }
  deriveBlockers(normalized.capabilities);
  return Object.freeze(normalized);
}

export function buildHostingerStorageDurableTenantRuntimeBridgeReadiness({ composition, evidence, now = Date.now() } = {}) {
  const nowEpoch = Number(now);
  if (!Number.isFinite(nowEpoch)) throw fail(400, 'STORAGE_DURABLE_BRIDGE_NOW_INVALID', 'A valid evaluation time is required.');
  if (!isCanonicalHostingerStorageVerifiedSqlRuntimeComposition(composition)) {
    throw fail(409, 'STORAGE_DURABLE_BRIDGE_COMPOSITION_REQUIRED', 'The canonical verified SQL runtime composition is required.');
  }
  if (composition.runtime_mounted !== false
    || composition.route_mounted !== false
    || composition.worker_mounted !== false
    || composition.provider_dispatch_allowed !== false
    || composition.production_ready !== false) {
    throw fail(409, 'STORAGE_DURABLE_BRIDGE_COMPOSITION_BOUNDARY_INVALID', 'Bridge readiness accepts only an unmounted, non-dispatching composition.');
  }
  const normalizedEvidence = normalizeEvidence(evidence, composition, nowEpoch);
  const blockers = deriveBlockers(normalizedEvidence.capabilities);
  const core = {
    contract: READINESS_CONTRACT,
    version: HOSTINGER_STORAGE_DURABLE_TENANT_RUNTIME_BRIDGE_READINESS_VERSION,
    composition: Object.freeze({
      composition_key: composition.composition_key,
      composition_version: composition.composition_version,
      schema_verification_digest: composition.schema_provenance.evidence_digest,
      database_fingerprint: composition.schema_provenance.database_fingerprint,
      source_commit: composition.schema_provenance.source_commit,
      deployed_runtime_sha: composition.schema_provenance.deployed_runtime_sha,
      readback_cycle_id: composition.schema_provenance.readback_cycle_id,
      secrets_included: false,
    }),
    evidence: normalizedEvidence,
    blockers,
    ready_for_separate_mount_authorization: blockers.length === 0,
    bridge_created: false,
    authorization_created: false,
    dependency_injected: false,
    runtime_mounted: false,
    route_mounted: false,
    worker_mounted: false,
    database_writes_performed_by_evaluator: 0,
    provider_dispatch_allowed: false,
    production_ready: false,
    secrets_included: false,
  };
  return Object.freeze({ ...core, readiness_digest: digest(core) });
}

export function verifyHostingerStorageDurableTenantRuntimeBridgeReadiness({ packet, expected_digest } = {}) {
  assertSecretFree(packet, 'packet');
  if (packet?.contract !== READINESS_CONTRACT
    || packet?.version !== HOSTINGER_STORAGE_DURABLE_TENANT_RUNTIME_BRIDGE_READINESS_VERSION
    || packet?.bridge_created !== false
    || packet?.authorization_created !== false
    || packet?.dependency_injected !== false
    || packet?.runtime_mounted !== false
    || packet?.route_mounted !== false
    || packet?.worker_mounted !== false
    || packet?.database_writes_performed_by_evaluator !== 0
    || packet?.provider_dispatch_allowed !== false
    || packet?.production_ready !== false
    || packet?.secrets_included !== false) {
    throw fail(409, 'STORAGE_DURABLE_BRIDGE_PACKET_BOUNDARY_INVALID', 'Unexpected or unsafe bridge-readiness packet.');
  }
  if (!Array.isArray(packet.blockers)) throw fail(409, 'STORAGE_DURABLE_BRIDGE_PACKET_TAMPERED', 'Bridge-readiness blockers are invalid.');
  const derived = deriveBlockers(packet.evidence?.capabilities, { packet: true });
  const supplied = [...new Set(packet.blockers.map((value) => text(value, 128)))].sort();
  if (JSON.stringify(derived) !== JSON.stringify(supplied)
    || packet.ready_for_separate_mount_authorization !== (derived.length === 0)) {
    throw fail(409, 'STORAGE_DURABLE_BRIDGE_PACKET_TAMPERED', 'Capability evidence, blockers, and readiness decision are inconsistent.');
  }
  const { readiness_digest: suppliedDigest, ...core } = packet;
  const observed = digest(core);
  if (suppliedDigest !== observed || (expected_digest && hash(expected_digest, 'expected_digest') !== observed)) {
    throw fail(409, 'STORAGE_DURABLE_BRIDGE_PACKET_TAMPERED', 'Bridge-readiness packet digest mismatch.');
  }
  return Object.freeze({
    ok: true,
    valid: true,
    ready_for_separate_mount_authorization: packet.ready_for_separate_mount_authorization === true && derived.length === 0,
    observed_digest: observed,
    bridge_created: false,
    authorization_created: false,
    dependency_injected: false,
    runtime_mounted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    secrets_included: false,
  });
}
