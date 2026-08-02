import { createHash } from 'node:crypto';
import { isCanonicalHostingerStorageAuthorizedMountBundle } from './hostingerStorageAuthorizedMountExecutor.js';

export const HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION =
  'spec014-hostinger-storage-authorized-dependency-injection-v1';

const CONTROLLER_BRAND = Symbol.for('mad4b.spec014.hostinger-storage-authorized-dependency-injection');
const mountedRuntimeResolutions = new WeakSet();
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/+/-]{0,255}$/u;
const SAFE_REASON_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const ROUTE_PATH = '/tenant/storage-operations/apply-plan';
const DEPENDENCY_KEY = 'tenantStorageRuntime';

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

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function identifier(value, field, max = 256) {
  const normalized = text(value, max);
  if (!SAFE_ID_RE.test(normalized) || normalized.length > max) {
    throw fail(400, 'STORAGE_AUTHORIZED_DEPENDENCY_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return normalized;
}

function reason(value, field) {
  const normalized = text(value, 191);
  if (!SAFE_REASON_RE.test(normalized)) {
    throw fail(400, 'STORAGE_AUTHORIZED_DEPENDENCY_REASON_INVALID', 'A safe bounded reason code is required.', { field });
  }
  return normalized;
}

function hash(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw fail(400, 'STORAGE_AUTHORIZED_DEPENDENCY_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  }
  return normalized;
}

function integer(value, field, minimum = 0) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    throw fail(400, 'STORAGE_AUTHORIZED_DEPENDENCY_INTEGER_INVALID', 'A bounded integer is required.', { field, minimum });
  }
  return normalized;
}

function assertDataOnly(value, path = 'value', active = new WeakSet(), depth = 0) {
  if (depth > 20) {
    throw fail(400, 'STORAGE_AUTHORIZED_DEPENDENCY_DATA_TOO_DEEP', 'Dependency injection data exceeded the supported depth.', { path });
  }
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') {
    throw fail(400, 'STORAGE_AUTHORIZED_DEPENDENCY_DATA_INVALID', 'Dependency injection inputs must contain data values only.', { path });
  }
  if (active.has(value)) {
    throw fail(400, 'STORAGE_AUTHORIZED_DEPENDENCY_DATA_CYCLE', 'Dependency injection inputs must not contain cycles.', { path });
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw fail(400, 'STORAGE_AUTHORIZED_DEPENDENCY_DATA_INVALID', 'Dependency injection inputs must use plain data objects.', { path });
  }
  active.add(value);
  try {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        throw fail(400, 'STORAGE_AUTHORIZED_DEPENDENCY_ACCESSOR_REJECTED', 'Dependency injection inputs must not contain accessors.', { path: `${path}.${key}` });
      }
      if (key === 'secrets_included' && descriptor.value !== false) {
        throw fail(400, 'STORAGE_AUTHORIZED_DEPENDENCY_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
      }
      if (key !== 'secrets_included'
        && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command|credential_material)/i.test(key)) {
        throw fail(400, 'STORAGE_AUTHORIZED_DEPENDENCY_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Dependency injection inputs cannot contain secrets or free-form execution fields.', { path: `${path}.${key}` });
      }
      assertDataOnly(descriptor.value, `${path}.${key}`, active, depth + 1);
    }
  } finally {
    active.delete(value);
  }
}

function plainSnapshot(value, path) {
  assertDataOnly(value, path);
  return clone(value);
}

function assertExactFields(input, allowed, path) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) {
    throw fail(400, 'STORAGE_AUTHORIZED_DEPENDENCY_INPUT_INVALID', 'A plain dependency injection input object is required.', { path });
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowed.has(key)) {
      throw fail(400, 'STORAGE_AUTHORIZED_DEPENDENCY_FIELD_FORBIDDEN', 'An unsupported dependency injection field was supplied.', { path: `${path}.${key}` });
    }
    if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
      throw fail(400, 'STORAGE_AUTHORIZED_DEPENDENCY_ACCESSOR_REJECTED', 'Dependency injection inputs must not contain accessors.', { path: `${path}.${key}` });
    }
  }
}

function assertBundleBoundary(bundle) {
  if (!isCanonicalHostingerStorageAuthorizedMountBundle(bundle)
    || bundle.route_path !== ROUTE_PATH
    || bundle.dependency_key !== DEPENDENCY_KEY
    || bundle.ready_for_dependency_injection !== true
    || bundle.authorization_consumed !== true
    || bundle.mount_bundle_created !== true
    || bundle.dependency_injected !== false
    || bundle.mount_performed !== false
    || bundle.runtime_mounted !== false
    || bundle.route_mounted !== false
    || bundle.worker_mounted !== false
    || bundle.provider_dispatch_allowed !== false
    || bundle.production_ready !== false
    || bundle.secrets_included !== false
    || typeof bundle.tenantStorageRuntime?.execute !== 'function'
    || bundle.tenantStorageRuntime?.synthetic_only !== true
    || bundle.tenantStorageRuntime?.provider_dispatch_allowed !== false
    || bundle.tenantStorageRuntime?.production_ready !== false) {
    throw fail(409, 'STORAGE_AUTHORIZED_DEPENDENCY_BUNDLE_INVALID', 'A canonical consumed, uninjected, synthetic-only mount bundle is required.');
  }
}

function readbackCore(bundle, input) {
  const runtimeIdentity = {
    mount_bundle_digest: bundle.mount_bundle_digest,
    expected_runtime_sha: bundle.expected_runtime_sha,
    tenant_runtime_version: bundle.tenant_runtime_version,
    repository_facade_version: bundle.repository_facade_version,
    composition_version: bundle.composition_version,
    dependency_manifest_digest: bundle.dependency_manifest_digest,
  };
  return {
    contract: 'spec014.hostinger-storage-authorized-dependency-injection-readback.v1',
    version: HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION,
    injection_id: input.injection_id,
    route_path: ROUTE_PATH,
    dependency_key: DEPENDENCY_KEY,
    mount_bundle_digest: bundle.mount_bundle_digest,
    authorization_id: bundle.authorization_id,
    authorization_digest: bundle.authorization_digest,
    authorization_generation: bundle.authorization_generation,
    operation_id: bundle.operation_id,
    plan_id: bundle.plan_id,
    expected_runtime_sha: bundle.expected_runtime_sha,
    source_commit: bundle.source_commit,
    database_fingerprint: bundle.database_fingerprint,
    schema_verification_digest: bundle.schema_verification_digest,
    readback_cycle_id: bundle.readback_cycle_id,
    dependency_manifest_digest: bundle.dependency_manifest_digest,
    runtime_identity_digest: digest(runtimeIdentity),
    injected_at_epoch: input.now_epoch,
    injection_generation: 1,
    status: 'mounted',
    authorization_consumed: true,
    dependency_injected: true,
    mount_performed: true,
    runtime_mounted: true,
    route_mounted: true,
    worker_mounted: false,
    synthetic_only: true,
    rollback_available: true,
    read_before_retry_required: true,
    automatic_retry_allowed: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    secrets_included: false,
  };
}

function normalizeInjection(input) {
  const allowed = new Set([
    'bundle',
    'injection_id',
    'expected_mount_bundle_digest',
    'expected_authorization_id',
    'expected_authorization_digest',
    'expected_authorization_generation',
    'expected_runtime_sha',
    'expected_dependency_manifest_digest',
    'now_epoch',
  ]);
  assertExactFields(input, allowed, 'inject');
  const bundle = input.bundle;
  assertBundleBoundary(bundle);
  const normalized = {
    bundle,
    injection_id: identifier(input.injection_id, 'injection_id', 191),
    expected_mount_bundle_digest: hash(input.expected_mount_bundle_digest, 'expected_mount_bundle_digest'),
    expected_authorization_id: identifier(input.expected_authorization_id, 'expected_authorization_id', 64),
    expected_authorization_digest: hash(input.expected_authorization_digest, 'expected_authorization_digest'),
    expected_authorization_generation: integer(input.expected_authorization_generation, 'expected_authorization_generation', 1),
    expected_runtime_sha: hash(input.expected_runtime_sha, 'expected_runtime_sha'),
    expected_dependency_manifest_digest: hash(input.expected_dependency_manifest_digest, 'expected_dependency_manifest_digest'),
    now_epoch: integer(input.now_epoch, 'now_epoch', 1),
  };
  const mismatches = [];
  if (bundle.mount_bundle_digest !== normalized.expected_mount_bundle_digest) mismatches.push('mount_bundle_digest');
  if (bundle.authorization_id !== normalized.expected_authorization_id) mismatches.push('authorization_id');
  if (bundle.authorization_digest !== normalized.expected_authorization_digest) mismatches.push('authorization_digest');
  if (bundle.authorization_generation !== normalized.expected_authorization_generation) mismatches.push('authorization_generation');
  if (bundle.expected_runtime_sha !== normalized.expected_runtime_sha) mismatches.push('expected_runtime_sha');
  if (bundle.dependency_manifest_digest !== normalized.expected_dependency_manifest_digest) mismatches.push('dependency_manifest_digest');
  if (mismatches.length) {
    throw fail(409, 'STORAGE_AUTHORIZED_DEPENDENCY_BINDING_MISMATCH', 'Authorized mount bundle no longer matches the requested dependency injection.', { mismatches: [...new Set(mismatches)].sort() });
  }
  return normalized;
}

function normalizeReadback(value) {
  const copy = plainSnapshot(value, 'mount_readback');
  if (copy?.contract !== 'spec014.hostinger-storage-authorized-dependency-injection-readback.v1'
    || copy?.version !== HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION
    || copy?.route_path !== ROUTE_PATH
    || copy?.dependency_key !== DEPENDENCY_KEY
    || copy?.status !== 'mounted'
    || copy?.authorization_consumed !== true
    || copy?.dependency_injected !== true
    || copy?.mount_performed !== true
    || copy?.runtime_mounted !== true
    || copy?.route_mounted !== true
    || copy?.worker_mounted !== false
    || copy?.synthetic_only !== true
    || copy?.rollback_available !== true
    || copy?.read_before_retry_required !== true
    || copy?.automatic_retry_allowed !== false
    || copy?.provider_dispatch_allowed !== false
    || copy?.production_ready !== false
    || copy?.secrets_included !== false) {
    throw fail(409, 'STORAGE_AUTHORIZED_DEPENDENCY_READBACK_INVALID', 'A canonical mounted dependency readback is required.');
  }
  const observedDigest = hash(copy.mount_readback_digest, 'mount_readback.mount_readback_digest');
  delete copy.mount_readback_digest;
  const expectedDigest = digest(copy);
  if (observedDigest !== expectedDigest) {
    throw fail(409, 'STORAGE_AUTHORIZED_DEPENDENCY_READBACK_DIGEST_MISMATCH', 'Mounted dependency readback digest does not match its content.');
  }
  return deepFreeze({ ...copy, mount_readback_digest: observedDigest });
}

function assertReadbackBundleParity(readback, bundle) {
  assertBundleBoundary(bundle);
  const mismatches = [];
  for (const field of [
    'mount_bundle_digest',
    'authorization_id',
    'authorization_digest',
    'authorization_generation',
    'operation_id',
    'plan_id',
    'expected_runtime_sha',
    'source_commit',
    'database_fingerprint',
    'schema_verification_digest',
    'readback_cycle_id',
    'dependency_manifest_digest',
  ]) {
    if (readback[field] !== bundle[field]) mismatches.push(field);
  }
  if (mismatches.length) {
    throw fail(409, 'STORAGE_AUTHORIZED_DEPENDENCY_RESUME_BINDING_MISMATCH', 'Mounted dependency readback cannot reconstruct this authorized bundle.', { mismatches: [...new Set(mismatches)].sort() });
  }
}

export function createHostingerStorageAuthorizedDependencyInjectionController(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).length !== 0) {
    throw fail(409, 'STORAGE_AUTHORIZED_DEPENDENCY_OVERRIDE_FORBIDDEN', 'Authorized dependency injection controller accepts no component overrides.');
  }

  let active = null;
  let lastRollback = null;

  function injectAuthorizedMount(input = {}) {
    const normalized = normalizeInjection(input);
    if (active) {
      if (active.readback.injection_id === normalized.injection_id
        && active.readback.mount_bundle_digest === normalized.bundle.mount_bundle_digest) {
        return active.readback;
      }
      throw fail(409, 'STORAGE_AUTHORIZED_DEPENDENCY_ALREADY_MOUNTED', 'A different authorized runtime is already mounted.', {
        active_injection_id: active.readback.injection_id,
        active_mount_readback_digest: active.readback.mount_readback_digest,
      });
    }
    const core = readbackCore(normalized.bundle, normalized);
    const readback = deepFreeze({ ...core, mount_readback_digest: digest(core) });
    active = Object.freeze({
      bundle: normalized.bundle,
      runtime: normalized.bundle.tenantStorageRuntime,
      readback,
    });
    return readback;
  }

  function readMount() {
    return active ? deepFreeze(clone(active.readback)) : null;
  }

  function resolveMountedRuntime(input = {}) {
    const allowed = new Set(['route_path', 'dependency_key', 'expected_mount_readback_digest']);
    assertExactFields(input, allowed, 'resolve');
    const routePath = text(input.route_path, 128);
    const dependencyKey = identifier(input.dependency_key, 'dependency_key', 128);
    if (routePath !== ROUTE_PATH || dependencyKey !== DEPENDENCY_KEY) {
      throw fail(409, 'STORAGE_AUTHORIZED_DEPENDENCY_ROUTE_BINDING_MISMATCH', 'Mounted runtime resolution is bound to the reviewed Tenant route dependency.');
    }
    if (!active) {
      throw fail(503, 'STORAGE_AUTHORIZED_DEPENDENCY_NOT_MOUNTED', 'Authorized Tenant storage runtime is not mounted.');
    }
    if (input.expected_mount_readback_digest !== undefined
      && hash(input.expected_mount_readback_digest, 'expected_mount_readback_digest') !== active.readback.mount_readback_digest) {
      throw fail(409, 'STORAGE_AUTHORIZED_DEPENDENCY_READBACK_CHANGED', 'Mounted dependency readback changed before runtime resolution.');
    }
    const resolution = {
      contract: 'spec014.hostinger-storage-mounted-runtime-resolution.v1',
      version: HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION,
      route_path: ROUTE_PATH,
      dependency_key: DEPENDENCY_KEY,
      injection_id: active.readback.injection_id,
      mount_bundle_digest: active.readback.mount_bundle_digest,
      mount_readback_digest: active.readback.mount_readback_digest,
      runtime_identity_digest: active.readback.runtime_identity_digest,
      dependency_injected: true,
      runtime_mounted: true,
      route_mounted: true,
      synthetic_only: true,
      provider_dispatch_allowed: false,
      production_ready: false,
      secrets_included: false,
    };
    Object.defineProperty(resolution, 'tenantStorageRuntime', {
      value: active.runtime,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    mountedRuntimeResolutions.add(resolution);
    return Object.freeze(resolution);
  }

  function rollbackAuthorizedMount(input = {}) {
    const allowed = new Set(['injection_id', 'expected_mount_readback_digest', 'rollback_id', 'reason_code', 'now_epoch']);
    assertExactFields(input, allowed, 'rollback');
    if (!active) {
      throw fail(409, 'STORAGE_AUTHORIZED_DEPENDENCY_NOT_MOUNTED', 'No authorized dependency mount exists to roll back.');
    }
    const injectionId = identifier(input.injection_id, 'injection_id', 191);
    const expectedDigest = hash(input.expected_mount_readback_digest, 'expected_mount_readback_digest');
    if (injectionId !== active.readback.injection_id || expectedDigest !== active.readback.mount_readback_digest) {
      throw fail(409, 'STORAGE_AUTHORIZED_DEPENDENCY_ROLLBACK_BINDING_MISMATCH', 'Rollback request does not match the active dependency mount.');
    }
    const core = {
      contract: 'spec014.hostinger-storage-authorized-dependency-rollback-receipt.v1',
      version: HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION,
      rollback_id: identifier(input.rollback_id, 'rollback_id', 191),
      reason_code: reason(input.reason_code, 'reason_code'),
      injection_id: active.readback.injection_id,
      previous_mount_readback_digest: active.readback.mount_readback_digest,
      mount_bundle_digest: active.readback.mount_bundle_digest,
      rolled_back_at_epoch: integer(input.now_epoch, 'now_epoch', 1),
      dependency_injected: false,
      mount_performed: false,
      runtime_mounted: false,
      route_mounted: false,
      worker_mounted: false,
      provider_dispatch_allowed: false,
      production_ready: false,
      secrets_included: false,
    };
    lastRollback = deepFreeze({ ...core, rollback_receipt_digest: digest(core) });
    active = null;
    return lastRollback;
  }

  function resumeAuthorizedMountInjection(input = {}) {
    const allowed = new Set(['bundle', 'mount_readback']);
    assertExactFields(input, allowed, 'resume');
    const bundle = input.bundle;
    const readback = normalizeReadback(input.mount_readback);
    assertReadbackBundleParity(readback, bundle);
    if (active) {
      if (active.readback.mount_readback_digest === readback.mount_readback_digest
        && active.readback.mount_bundle_digest === bundle.mount_bundle_digest) {
        return active.readback;
      }
      throw fail(409, 'STORAGE_AUTHORIZED_DEPENDENCY_RESUME_CONFLICT', 'A different authorized runtime is already mounted in this controller.');
    }
    active = Object.freeze({ bundle, runtime: bundle.tenantStorageRuntime, readback });
    return readback;
  }

  function exportState() {
    const core = {
      contract: 'spec014.hostinger-storage-authorized-dependency-injection-snapshot.v1',
      version: HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION,
      active_mount: active ? clone(active.readback) : null,
      last_rollback: lastRollback ? clone(lastRollback) : null,
      runtime_material_included: false,
      provider_dispatch_allowed: false,
      production_ready: false,
      secrets_included: false,
    };
    return deepFreeze({ ...core, snapshot_digest: digest(core) });
  }

  const controller = {
    controller_key: 'hostinger_storage_authorized_dependency_injection_v1',
    controller_version: HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION,
    route_path: ROUTE_PATH,
    dependency_key: DEPENDENCY_KEY,
    authorized_bundle_required: true,
    exact_mount_readback_required: true,
    rollback_supported: true,
    restart_reconciliation_supported: true,
    automatic_retry_allowed: false,
    raw_runtime_exposed: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    injectAuthorizedMount,
    readMount,
    resolveMountedRuntime,
    rollbackAuthorizedMount,
    resumeAuthorizedMountInjection,
    exportState,
    secrets_included: false,
  };
  Object.defineProperty(controller, CONTROLLER_BRAND, { value: true, enumerable: false });
  return Object.freeze(controller);
}

export function isCanonicalHostingerStorageAuthorizedDependencyInjectionController(value) {
  return Boolean(value?.[CONTROLLER_BRAND] === true
    && Object.isFrozen(value)
    && value.controller_key === 'hostinger_storage_authorized_dependency_injection_v1'
    && value.controller_version === HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION
    && value.route_path === ROUTE_PATH
    && value.dependency_key === DEPENDENCY_KEY
    && value.authorized_bundle_required === true
    && value.exact_mount_readback_required === true
    && value.rollback_supported === true
    && value.restart_reconciliation_supported === true
    && value.automatic_retry_allowed === false
    && value.raw_runtime_exposed === false
    && value.provider_dispatch_allowed === false
    && value.production_ready === false
    && typeof value.injectAuthorizedMount === 'function'
    && typeof value.readMount === 'function'
    && typeof value.resolveMountedRuntime === 'function'
    && typeof value.rollbackAuthorizedMount === 'function'
    && typeof value.resumeAuthorizedMountInjection === 'function');
}

export function isCanonicalHostingerStorageMountedRuntimeResolution(value) {
  return Boolean(value
    && mountedRuntimeResolutions.has(value)
    && Object.isFrozen(value)
    && value.contract === 'spec014.hostinger-storage-mounted-runtime-resolution.v1'
    && value.version === HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION
    && value.route_path === ROUTE_PATH
    && value.dependency_key === DEPENDENCY_KEY
    && value.dependency_injected === true
    && value.runtime_mounted === true
    && value.route_mounted === true
    && value.synthetic_only === true
    && value.provider_dispatch_allowed === false
    && value.production_ready === false
    && value.secrets_included === false
    && typeof value.tenantStorageRuntime?.execute === 'function');
}
