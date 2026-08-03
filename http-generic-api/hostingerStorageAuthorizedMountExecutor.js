import { createHash } from 'node:crypto';
import {
  HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_REGISTRY_VERSION,
  isCanonicalHostingerStorageDurableMountAuthorizationRegistry,
} from './hostingerStorageDurableMountAuthorizationRegistry.js';
import {
  HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION,
  isCanonicalHostingerStorageVerifiedSqlRuntimeComposition,
} from './hostingerStorageVerifiedSqlRuntimeComposition.js';
import {
  HOSTINGER_STORAGE_DURABLE_TENANT_REPOSITORY_FACADE_VERSION,
  createHostingerStorageDurableTenantRepositoryFacade,
  isCanonicalHostingerStorageDurableTenantRepositoryFacade,
} from './hostingerStorageDurableTenantRepositoryFacade.js';
import {
  HOSTINGER_STORAGE_TENANT_RUNTIME_VERSION,
  createHostingerStorageTenantRuntime,
} from './hostingerStorageTenantRuntime.js';
import { isCanonicalHostingerStorageSyntheticAdapter } from './hostingerStorageSyntheticAdapter.js';
import { isCanonicalHostingerStorageDurableTenantAuthorityStore } from './hostingerStorageDurableTenantAuthorityStore.js';
import { isCanonicalHostingerStorageDurableTenantEnablementRegistry } from './hostingerStorageDurableTenantEnablementRegistry.js';

export const HOSTINGER_STORAGE_AUTHORIZED_MOUNT_EXECUTOR_VERSION =
  'spec014-hostinger-storage-authorized-mount-executor-v1';

const EXECUTOR_BRAND = Symbol.for('mad4b.spec014.hostinger-storage-authorized-mount-executor');
const mountedBundles = new WeakSet();
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/+/-]{0,255}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const ROUTE_PATH = '/tenant/storage-operations/apply-plan';
const DEPENDENCY_KEY = 'tenantStorageRuntime';
const ALLOWED_OPTIONS = new Set([
  'authorization_registry',
  'composition',
  'dependency_manifest',
  'resolve_execution_context',
  'load_execution_package',
  'emit_telemetry',
]);

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = Object.freeze({ ...details, secrets_included: false });
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

function identifier(value, field, max = 256) {
  const normalized = text(value, max);
  if (!SAFE_ID_RE.test(normalized) || normalized.length > max) {
    throw fail(400, 'STORAGE_AUTHORIZED_MOUNT_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return normalized;
}

function hash(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw fail(400, 'STORAGE_AUTHORIZED_MOUNT_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  }
  return normalized;
}

function integer(value, field, minimum = 0) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    throw fail(400, 'STORAGE_AUTHORIZED_MOUNT_INTEGER_INVALID', 'A bounded integer is required.', { field, minimum });
  }
  return normalized;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function assertDataOnly(value, path = 'value', active = new WeakSet(), depth = 0) {
  if (depth > 20) throw fail(400, 'STORAGE_AUTHORIZED_MOUNT_DATA_TOO_DEEP', 'Mount data exceeded the supported depth.', { path });
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') throw fail(400, 'STORAGE_AUTHORIZED_MOUNT_DATA_INVALID', 'Mount inputs must contain data values only.', { path });
  if (active.has(value)) throw fail(400, 'STORAGE_AUTHORIZED_MOUNT_DATA_CYCLE', 'Mount inputs must not contain cycles.', { path });
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw fail(400, 'STORAGE_AUTHORIZED_MOUNT_DATA_INVALID', 'Mount inputs must use plain data objects.', { path });
  }
  active.add(value);
  try {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        throw fail(400, 'STORAGE_AUTHORIZED_MOUNT_ACCESSOR_REJECTED', 'Mount inputs must not contain accessor properties.', { path: `${path}.${key}` });
      }
      if (key === 'secrets_included' && descriptor.value !== false) {
        throw fail(400, 'STORAGE_AUTHORIZED_MOUNT_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
      }
      if (key !== 'secrets_included'
        && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command|credential_material)/i.test(key)) {
        throw fail(400, 'STORAGE_AUTHORIZED_MOUNT_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Mount inputs cannot contain secrets or free-form execution fields.', { path: `${path}.${key}` });
      }
      assertDataOnly(descriptor.value, `${path}.${key}`, active, depth + 1);
    }
  } finally {
    active.delete(value);
  }
}

function snapshot(value, path) {
  assertDataOnly(value, path);
  return structuredClone(value);
}

function ownFields(value, fields, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(503, 'STORAGE_AUTHORIZED_MOUNT_PACKAGE_INVALID', 'Execution package loader returned an invalid object.', { path });
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const captured = {};
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
      throw fail(503, 'STORAGE_AUTHORIZED_MOUNT_PACKAGE_INVALID', 'Execution package loader must return owned data or dependency fields.', { path: `${path}.${field}` });
    }
    captured[field] = descriptor.value;
  }
  return captured;
}

function normalizeManifest(value = {}) {
  const copy = snapshot(value, 'dependency_manifest');
  const normalized = {
    manifest_key: identifier(copy.manifest_key, 'dependency_manifest.manifest_key', 128),
    manifest_revision: identifier(copy.manifest_revision, 'dependency_manifest.manifest_revision', 128),
    context_resolver_key: identifier(copy.context_resolver_key, 'dependency_manifest.context_resolver_key', 128),
    context_resolver_version: identifier(copy.context_resolver_version, 'dependency_manifest.context_resolver_version', 128),
    execution_package_loader_key: identifier(copy.execution_package_loader_key, 'dependency_manifest.execution_package_loader_key', 128),
    execution_package_loader_version: identifier(copy.execution_package_loader_version, 'dependency_manifest.execution_package_loader_version', 128),
    telemetry_sink_key: identifier(copy.telemetry_sink_key, 'dependency_manifest.telemetry_sink_key', 128),
    telemetry_sink_version: identifier(copy.telemetry_sink_version, 'dependency_manifest.telemetry_sink_version', 128),
    route_path: text(copy.route_path, 128),
    dependency_key: identifier(copy.dependency_key, 'dependency_manifest.dependency_key', 128),
    tenant_runtime_version: identifier(copy.tenant_runtime_version, 'dependency_manifest.tenant_runtime_version', 128),
    repository_facade_version: identifier(copy.repository_facade_version, 'dependency_manifest.repository_facade_version', 128),
    composition_version: identifier(copy.composition_version, 'dependency_manifest.composition_version', 128),
    authorization_registry_version: identifier(copy.authorization_registry_version, 'dependency_manifest.authorization_registry_version', 128),
    synthetic_only: copy.synthetic_only === true,
    direct_provider_dispatch_allowed: copy.direct_provider_dispatch_allowed === true,
    duplicate_write_paths_allowed: copy.duplicate_write_paths_allowed === true,
    secrets_included: false,
  };
  if (normalized.manifest_key !== 'hostinger_storage_authorized_mount_dependencies_v1'
    || normalized.route_path !== ROUTE_PATH
    || normalized.dependency_key !== DEPENDENCY_KEY
    || normalized.tenant_runtime_version !== HOSTINGER_STORAGE_TENANT_RUNTIME_VERSION
    || normalized.repository_facade_version !== HOSTINGER_STORAGE_DURABLE_TENANT_REPOSITORY_FACADE_VERSION
    || normalized.composition_version !== HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION
    || normalized.authorization_registry_version !== HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_REGISTRY_VERSION
    || normalized.synthetic_only !== true
    || normalized.direct_provider_dispatch_allowed !== false
    || normalized.duplicate_write_paths_allowed !== false) {
    throw fail(409, 'STORAGE_AUTHORIZED_MOUNT_DEPENDENCY_MANIFEST_INVALID', 'Dependency manifest differs from the reviewed synthetic-only mount contract.');
  }
  return deepFreeze(normalized);
}

export function computeHostingerStorageAuthorizedMountDependencyManifestDigest(value) {
  return digest(normalizeManifest(value));
}

function assertComposition(composition) {
  if (!isCanonicalHostingerStorageVerifiedSqlRuntimeComposition(composition)
    || composition.runtime_mounted !== false
    || composition.route_mounted !== false
    || composition.worker_mounted !== false
    || composition.duplicate_write_paths_allowed !== false
    || composition.provider_dispatch_allowed !== false
    || composition.production_ready !== false) {
    throw fail(409, 'STORAGE_AUTHORIZED_MOUNT_COMPOSITION_INVALID', 'An unmounted canonical verified SQL runtime composition is required.');
  }
}

function assertRegistry(registry, composition) {
  if (!isCanonicalHostingerStorageDurableMountAuthorizationRegistry(registry)
    || registry.runtime_mounted !== false
    || registry.route_mounted !== false
    || registry.worker_mounted !== false
    || registry.mount_execution_allowed !== false
    || registry.automatic_retry_allowed !== false
    || registry.provider_dispatch_allowed !== false
    || registry.production_ready !== false) {
    throw fail(409, 'STORAGE_AUTHORIZED_MOUNT_REGISTRY_INVALID', 'The canonical durable one-shot mount authorization registry is required.');
  }
  if (registry.database_fingerprint !== composition.schema_provenance.database_fingerprint) {
    throw fail(409, 'STORAGE_AUTHORIZED_MOUNT_DATABASE_FINGERPRINT_MISMATCH', 'Registry and runtime composition must bind the same database fingerprint.');
  }
}

function normalizeExecution(input = {}) {
  const copy = snapshot(input, 'execute_mount');
  return deepFreeze({
    authorization_id: identifier(copy.authorization_id, 'authorization_id', 64),
    authorization_digest: hash(copy.authorization_digest, 'authorization_digest'),
    executor_id: identifier(copy.executor_id, 'executor_id', 191),
    mount_attempt_id: identifier(copy.mount_attempt_id, 'mount_attempt_id', 191),
    operation_id: identifier(copy.operation_id, 'operation_id', 36),
    plan_id: identifier(copy.plan_id, 'plan_id', 36),
    expected_runtime_sha: hash(copy.expected_runtime_sha, 'expected_runtime_sha'),
    expected_generation: integer(copy.expected_generation, 'expected_generation', 1),
    now_epoch: integer(copy.now_epoch, 'now_epoch', 1),
    secrets_included: false,
  });
}

function assertAuthorizationBindings(record, execution, composition, manifestDigest) {
  if (!record || typeof record !== 'object') {
    throw fail(404, 'STORAGE_AUTHORIZED_MOUNT_AUTHORIZATION_NOT_FOUND', 'Durable mount authorization was not found.', { authorization_id: execution.authorization_id });
  }
  const mismatches = [];
  if (record.authorization_id !== execution.authorization_id) mismatches.push('authorization_id');
  if (record.authorization_digest !== execution.authorization_digest) mismatches.push('authorization_digest');
  if (record.operation_id !== execution.operation_id) mismatches.push('operation_id');
  if (record.plan_id !== execution.plan_id) mismatches.push('plan_id');
  if (record.deployed_runtime_sha !== execution.expected_runtime_sha) mismatches.push('expected_runtime_sha');
  if (record.generation !== execution.expected_generation) mismatches.push('generation');
  if (record.consumed !== false) mismatches.push('consumed');
  if (record.source_commit !== composition.schema_provenance.source_commit) mismatches.push('source_commit');
  if (record.deployed_runtime_sha !== composition.schema_provenance.deployed_runtime_sha) mismatches.push('deployed_runtime_sha');
  if (record.database_fingerprint !== composition.schema_provenance.database_fingerprint) mismatches.push('database_fingerprint');
  if (record.schema_verification_digest !== composition.schema_provenance.evidence_digest) mismatches.push('schema_verification_digest');
  if (record.readback_cycle_id !== composition.schema_provenance.readback_cycle_id) mismatches.push('readback_cycle_id');
  if (record.mount_policy_fingerprint !== manifestDigest) mismatches.push('mount_policy_fingerprint');
  if (record.expires_at_epoch <= execution.now_epoch) mismatches.push('expired');
  if (mismatches.length) {
    throw fail(409, 'STORAGE_AUTHORIZED_MOUNT_BINDING_MISMATCH', 'Mount authorization no longer matches the runtime composition, dependency manifest, or requested execution.', { mismatches: [...new Set(mismatches)].sort() });
  }
}

function assertConsumption(result, before, execution) {
  const authorization = result?.authorization;
  const receipt = result?.consumption;
  const mismatches = [];
  if (result?.consumed !== true) mismatches.push('consumed');
  if (result?.authorized_mount_execution_may_begin !== true) mismatches.push('authorized_mount_execution_may_begin');
  if (result?.mount_performed !== false) mismatches.push('mount_performed');
  if (result?.automatic_retry_allowed !== false) mismatches.push('automatic_retry_allowed');
  if (authorization?.authorization_id !== before.authorization_id) mismatches.push('authorization_id');
  if (authorization?.authorization_digest !== before.authorization_digest) mismatches.push('authorization_digest');
  if (authorization?.operation_id !== execution.operation_id) mismatches.push('operation_id');
  if (authorization?.plan_id !== execution.plan_id) mismatches.push('plan_id');
  if (authorization?.generation !== before.generation + 1) mismatches.push('generation');
  if (authorization?.consumed !== true) mismatches.push('authorization_consumed');
  if (authorization?.mount_attempt_id !== execution.mount_attempt_id) mismatches.push('mount_attempt_id');
  if (receipt?.authorization_id !== before.authorization_id) mismatches.push('receipt.authorization_id');
  if (receipt?.authorization_digest !== before.authorization_digest) mismatches.push('receipt.authorization_digest');
  if (receipt?.executor_id !== execution.executor_id) mismatches.push('receipt.executor_id');
  if (receipt?.mount_attempt_id !== execution.mount_attempt_id) mismatches.push('receipt.mount_attempt_id');
  if (receipt?.expected_runtime_sha !== execution.expected_runtime_sha) mismatches.push('receipt.expected_runtime_sha');
  if (receipt?.registered_generation !== before.generation) mismatches.push('receipt.registered_generation');
  if (receipt?.consumed_generation !== before.generation + 1) mismatches.push('receipt.consumed_generation');
  if (mismatches.length) {
    throw fail(409, 'STORAGE_AUTHORIZED_MOUNT_CONSUMPTION_READBACK_MISMATCH', 'Durable authorization consumption readback is inconsistent.', { mismatches: [...new Set(mismatches)].sort() });
  }
  return { authorization, receipt };
}

function assertConsumedState(record, receipt, execution, composition, manifestDigest) {
  const mismatches = [];
  if (!record || !receipt) mismatches.push('durable_consumption_missing');
  if (record?.authorization_id !== execution.authorization_id) mismatches.push('authorization_id');
  if (record?.authorization_digest !== execution.authorization_digest) mismatches.push('authorization_digest');
  if (record?.operation_id !== execution.operation_id) mismatches.push('operation_id');
  if (record?.plan_id !== execution.plan_id) mismatches.push('plan_id');
  if (record?.deployed_runtime_sha !== execution.expected_runtime_sha) mismatches.push('expected_runtime_sha');
  if (record?.consumed !== true) mismatches.push('consumed');
  if (record?.mount_attempt_id !== execution.mount_attempt_id) mismatches.push('mount_attempt_id');
  if (record?.consumed_by_executor_id !== execution.executor_id) mismatches.push('executor_id');
  if (record?.source_commit !== composition.schema_provenance.source_commit) mismatches.push('source_commit');
  if (record?.database_fingerprint !== composition.schema_provenance.database_fingerprint) mismatches.push('database_fingerprint');
  if (record?.schema_verification_digest !== composition.schema_provenance.evidence_digest) mismatches.push('schema_verification_digest');
  if (record?.readback_cycle_id !== composition.schema_provenance.readback_cycle_id) mismatches.push('readback_cycle_id');
  if (record?.mount_policy_fingerprint !== manifestDigest) mismatches.push('mount_policy_fingerprint');
  if (receipt?.authorization_id !== execution.authorization_id) mismatches.push('receipt.authorization_id');
  if (receipt?.authorization_digest !== execution.authorization_digest) mismatches.push('receipt.authorization_digest');
  if (receipt?.executor_id !== execution.executor_id) mismatches.push('receipt.executor_id');
  if (receipt?.mount_attempt_id !== execution.mount_attempt_id) mismatches.push('receipt.mount_attempt_id');
  if (receipt?.expected_runtime_sha !== execution.expected_runtime_sha) mismatches.push('receipt.expected_runtime_sha');
  if (receipt?.registered_generation !== execution.expected_generation) mismatches.push('receipt.registered_generation');
  if (record?.generation !== execution.expected_generation + 1) mismatches.push('generation');
  if (receipt?.consumed_generation !== execution.expected_generation + 1
    || receipt?.consumed_generation !== record?.generation) mismatches.push('receipt.consumed_generation');
  if (mismatches.length) {
    throw fail(409, 'STORAGE_AUTHORIZED_MOUNT_RESUME_BINDING_MISMATCH', 'Durable consumed authorization cannot reconstruct this mount bundle.', { mismatches: [...new Set(mismatches)].sort() });
  }
  return { authorization: record, receipt };
}

function bundleCore({ authorization, receipt, execution, manifest, manifestDigest, composition }) {
  return {
    contract: 'spec014.hostinger-storage-authorized-mount-bundle.v1',
    version: HOSTINGER_STORAGE_AUTHORIZED_MOUNT_EXECUTOR_VERSION,
    route_path: ROUTE_PATH,
    dependency_key: DEPENDENCY_KEY,
    executor_id: execution.executor_id,
    mount_attempt_id: execution.mount_attempt_id,
    authorization_id: authorization.authorization_id,
    authorization_digest: authorization.authorization_digest,
    authorization_generation: authorization.generation,
    authorization_consumption_digest: hash(receipt.record_digest, 'consumption.record_digest'),
    operation_id: authorization.operation_id,
    plan_id: authorization.plan_id,
    plan_hash: authorization.plan_hash,
    target_id: authorization.target_id,
    expected_runtime_sha: authorization.deployed_runtime_sha,
    source_commit: authorization.source_commit,
    database_fingerprint: authorization.database_fingerprint,
    schema_verification_digest: authorization.schema_verification_digest,
    readback_cycle_id: authorization.readback_cycle_id,
    bridge_readiness_digest: authorization.bridge_readiness_digest,
    fixed_dispatch_certification_digest: authorization.fixed_dispatch_certification_digest,
    worker_certification_digest: authorization.worker_certification_digest,
    authorization_bundle_hash: authorization.authorization_bundle_hash,
    rollback_plan_digest: authorization.rollback_plan_digest,
    dependency_manifest: manifest,
    dependency_manifest_digest: manifestDigest,
    composition_version: composition.composition_version,
    tenant_runtime_version: HOSTINGER_STORAGE_TENANT_RUNTIME_VERSION,
    repository_facade_version: HOSTINGER_STORAGE_DURABLE_TENANT_REPOSITORY_FACADE_VERSION,
    authorization_consumed: true,
    mount_bundle_created: true,
    ready_for_dependency_injection: true,
    reconciliation_state: 'authorization_consumed_pending_dependency_injection',
    automatic_retry_allowed: false,
    read_before_retry_required: true,
    dependency_injected: false,
    mount_performed: false,
    runtime_mounted: false,
    route_mounted: false,
    worker_mounted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    secrets_included: false,
  };
}

function createBundle(args, runtime) {
  const core = bundleCore(args);
  const bundle = { ...core, mount_bundle_digest: digest(core) };
  Object.defineProperty(bundle, 'tenantStorageRuntime', {
    value: runtime,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  mountedBundles.add(bundle);
  return Object.freeze(bundle);
}

export function isCanonicalHostingerStorageAuthorizedMountBundle(value) {
  return Boolean(value
    && mountedBundles.has(value)
    && Object.isFrozen(value)
    && value.contract === 'spec014.hostinger-storage-authorized-mount-bundle.v1'
    && value.version === HOSTINGER_STORAGE_AUTHORIZED_MOUNT_EXECUTOR_VERSION
    && value.route_path === ROUTE_PATH
    && value.dependency_key === DEPENDENCY_KEY
    && value.authorization_consumed === true
    && value.mount_bundle_created === true
    && value.ready_for_dependency_injection === true
    && value.automatic_retry_allowed === false
    && value.dependency_injected === false
    && value.mount_performed === false
    && value.runtime_mounted === false
    && value.route_mounted === false
    && value.worker_mounted === false
    && value.provider_dispatch_allowed === false
    && value.production_ready === false
    && value.secrets_included === false
    && typeof value.tenantStorageRuntime?.execute === 'function'
    && value.tenantStorageRuntime?.synthetic_only === true
    && value.tenantStorageRuntime?.provider_dispatch_allowed === false
    && value.tenantStorageRuntime?.production_ready === false);
}

export function createHostingerStorageAuthorizedMountExecutor(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw fail(500, 'STORAGE_AUTHORIZED_MOUNT_OPTIONS_INVALID', 'Authorized mount executor options must be an object.');
  }
  const unsupported = Object.keys(options).filter((key) => !ALLOWED_OPTIONS.has(key));
  if (unsupported.length) {
    throw fail(409, 'STORAGE_AUTHORIZED_MOUNT_OVERRIDE_FORBIDDEN', 'Only canonical mount dependencies may be supplied.', { unsupported_options: unsupported.sort() });
  }
  const {
    authorization_registry: registry,
    composition,
    dependency_manifest,
    resolve_execution_context: resolveExecutionContext,
    load_execution_package: loadExecutionPackage,
    emit_telemetry: emitTelemetry = async () => {},
  } = options;
  assertComposition(composition);
  assertRegistry(registry, composition);
  if (typeof resolveExecutionContext !== 'function'
    || typeof loadExecutionPackage !== 'function'
    || typeof emitTelemetry !== 'function') {
    throw fail(500, 'STORAGE_AUTHORIZED_MOUNT_RUNTIME_DEPENDENCY_INVALID', 'Context resolution, package loading, and telemetry dependencies must be functions.');
  }
  const manifest = normalizeManifest(dependency_manifest);
  const manifestDigest = digest(manifest);
  const repository = createHostingerStorageDurableTenantRepositoryFacade({ composition });
  if (!isCanonicalHostingerStorageDurableTenantRepositoryFacade(repository)) {
    throw fail(500, 'STORAGE_AUTHORIZED_MOUNT_REPOSITORY_FACADE_INVALID', 'Canonical durable Tenant repository facade construction failed.');
  }

  const runtime = createHostingerStorageTenantRuntime({
    resolveExecutionContext,
    emitTelemetry,
    loadExecutionPackage: async (input) => {
      const loaded = await loadExecutionPackage(input);
      const fields = ownFields(loaded, [
        'operationContract', 'canaryAuthorization', 'protocol', 'protocolDigest',
        'adapter', 'authorityStore', 'enablementRegistry', 'nowEpoch',
      ], 'executionPackage');
      if (!isCanonicalHostingerStorageSyntheticAdapter(fields.adapter)
        || !isCanonicalHostingerStorageDurableTenantAuthorityStore(fields.authorityStore)
        || !isCanonicalHostingerStorageDurableTenantEnablementRegistry(fields.enablementRegistry)) {
        throw fail(503, 'STORAGE_AUTHORIZED_MOUNT_EXECUTION_PACKAGE_COMPONENT_INVALID', 'Execution package must use canonical synthetic adapter and durable Tenant authority components.');
      }
      if (fields.authorityStore.database_fingerprint !== composition.schema_provenance.database_fingerprint
        || fields.enablementRegistry.database_fingerprint !== composition.schema_provenance.database_fingerprint) {
        throw fail(409, 'STORAGE_AUTHORIZED_MOUNT_EXECUTION_PACKAGE_DATABASE_MISMATCH', 'Execution package components must bind the mounted database fingerprint.');
      }
      return Object.freeze({
        operationContract: fields.operationContract,
        canaryAuthorization: fields.canaryAuthorization,
        protocol: fields.protocol,
        protocolDigest: fields.protocolDigest,
        repository,
        adapter: fields.adapter,
        authorityStore: fields.authorityStore,
        enablementRegistry: fields.enablementRegistry,
        nowEpoch: fields.nowEpoch,
      });
    },
  });
  if (runtime.synthetic_only !== true
    || runtime.provider_dispatch_allowed !== false
    || runtime.production_ready !== false
    || typeof runtime.execute !== 'function'
    || !Object.isFrozen(runtime)) {
    throw fail(500, 'STORAGE_AUTHORIZED_MOUNT_TENANT_RUNTIME_INVALID', 'Mounted Tenant runtime must remain frozen, synthetic-only, and non-dispatching.');
  }

  async function executeAuthorizedMount(input = {}) {
    const execution = normalizeExecution(input);
    const before = await registry.read(execution.authorization_id);
    assertAuthorizationBindings(before, execution, composition, manifestDigest);
    const consumed = await registry.consume({
      authorization_id: execution.authorization_id,
      authorization_digest: execution.authorization_digest,
      executor_id: execution.executor_id,
      mount_attempt_id: execution.mount_attempt_id,
      operation_id: execution.operation_id,
      plan_id: execution.plan_id,
      expected_runtime_sha: execution.expected_runtime_sha,
      expected_generation: execution.expected_generation,
      now_epoch: execution.now_epoch,
    });
    const { authorization, receipt } = assertConsumption(consumed, before, execution);
    return createBundle({ authorization, receipt, execution, manifest, manifestDigest, composition }, runtime);
  }

  async function resumeAuthorizedMount(input = {}) {
    const execution = normalizeExecution(input);
    const [authorization, receipt] = await Promise.all([
      registry.read(execution.authorization_id),
      registry.readConsumption(execution.authorization_id),
    ]);
    const state = assertConsumedState(authorization, receipt, execution, composition, manifestDigest);
    return createBundle({ ...state, execution, manifest, manifestDigest, composition }, runtime);
  }

  const executor = {
    executor_key: 'hostinger_storage_authorized_mount_executor_v1',
    executor_version: HOSTINGER_STORAGE_AUTHORIZED_MOUNT_EXECUTOR_VERSION,
    dependency_manifest: manifest,
    dependency_manifest_digest: manifestDigest,
    composition_version: composition.composition_version,
    database_fingerprint: composition.schema_provenance.database_fingerprint,
    source_commit: composition.schema_provenance.source_commit,
    deployed_runtime_sha: composition.schema_provenance.deployed_runtime_sha,
    schema_verification_digest: composition.schema_provenance.evidence_digest,
    readback_cycle_id: composition.schema_provenance.readback_cycle_id,
    runtime_dependency_created: true,
    raw_composition_exposed: false,
    raw_registry_exposed: false,
    raw_repository_exposed: false,
    automatic_retry_allowed: false,
    dependency_injection_allowed: false,
    mount_performed: false,
    runtime_mounted: false,
    route_mounted: false,
    worker_mounted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    executeAuthorizedMount,
    resumeAuthorizedMount,
    secrets_included: false,
  };
  Object.defineProperty(executor, EXECUTOR_BRAND, { value: true, enumerable: false });
  return Object.freeze(executor);
}

export function isCanonicalHostingerStorageAuthorizedMountExecutor(value) {
  return Boolean(value?.[EXECUTOR_BRAND] === true
    && Object.isFrozen(value)
    && value.executor_key === 'hostinger_storage_authorized_mount_executor_v1'
    && value.executor_version === HOSTINGER_STORAGE_AUTHORIZED_MOUNT_EXECUTOR_VERSION
    && value.runtime_dependency_created === true
    && value.raw_composition_exposed === false
    && value.raw_registry_exposed === false
    && value.raw_repository_exposed === false
    && value.automatic_retry_allowed === false
    && value.dependency_injection_allowed === false
    && value.mount_performed === false
    && value.runtime_mounted === false
    && value.route_mounted === false
    && value.worker_mounted === false
    && value.provider_dispatch_allowed === false
    && value.production_ready === false
    && typeof value.executeAuthorizedMount === 'function'
    && typeof value.resumeAuthorizedMount === 'function');
}
