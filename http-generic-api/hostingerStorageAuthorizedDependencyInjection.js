import { createHash } from 'node:crypto';
import {
  HOSTINGER_STORAGE_AUTHORIZED_MOUNT_EXECUTOR_VERSION,
  isCanonicalHostingerStorageAuthorizedMountBundle,
} from './hostingerStorageAuthorizedMountExecutor.js';

export const HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION =
  'spec014-hostinger-storage-authorized-dependency-injection-v1';

const COORDINATOR_BRAND = Symbol.for('mad4b.spec014.hostinger-storage-authorized-dependency-injection');
const ROUTE_PATH = '/tenant/storage-operations/apply-plan';
const DEPENDENCY_KEY = 'tenantStorageRuntime';
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/+/-]{0,255}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const EMPTY_ROUTE_DEPENDENCIES = Object.freeze({});

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
    throw fail(400, 'STORAGE_AUTHORIZED_INJECTION_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return normalized;
}

function hash(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw fail(400, 'STORAGE_AUTHORIZED_INJECTION_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  }
  return normalized;
}

function integer(value, field, minimum = 0) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    throw fail(400, 'STORAGE_AUTHORIZED_INJECTION_INTEGER_INVALID', 'A bounded integer is required.', { field, minimum });
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
  if (depth > 20) {
    throw fail(400, 'STORAGE_AUTHORIZED_INJECTION_DATA_TOO_DEEP', 'Injection data exceeded the supported depth.', { path });
  }
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') {
    throw fail(400, 'STORAGE_AUTHORIZED_INJECTION_DATA_INVALID', 'Injection inputs must contain data values only.', { path });
  }
  if (active.has(value)) {
    throw fail(400, 'STORAGE_AUTHORIZED_INJECTION_DATA_CYCLE', 'Injection inputs must not contain cycles.', { path });
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw fail(400, 'STORAGE_AUTHORIZED_INJECTION_DATA_INVALID', 'Injection inputs must use plain data objects.', { path });
  }
  active.add(value);
  try {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        throw fail(400, 'STORAGE_AUTHORIZED_INJECTION_ACCESSOR_REJECTED', 'Injection inputs must not contain accessor properties.', { path: `${path}.${key}` });
      }
      if (key === 'secrets_included' && descriptor.value !== false) {
        throw fail(400, 'STORAGE_AUTHORIZED_INJECTION_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
      }
      if (key !== 'secrets_included'
        && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command|credential_material)/i.test(key)) {
        throw fail(400, 'STORAGE_AUTHORIZED_INJECTION_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Injection inputs cannot contain secrets or free-form execution fields.', { path: `${path}.${key}` });
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

function assertExactFields(value, allowed, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(400, 'STORAGE_AUTHORIZED_INJECTION_INPUT_INVALID', 'A plain input object is required.', { path });
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const unsupported = Object.keys(descriptors).filter((key) => !allowed.has(key));
  if (unsupported.length) {
    throw fail(400, 'STORAGE_AUTHORIZED_INJECTION_FIELD_FORBIDDEN', 'Unsupported injection fields are forbidden.', {
      path,
      unsupported_fields: unsupported.sort(),
    });
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
      throw fail(400, 'STORAGE_AUTHORIZED_INJECTION_ACCESSOR_REJECTED', 'Injection inputs must use owned data fields.', { path: `${path}.${key}` });
    }
  }
}

function normalizeInjectionRequest(input = {}) {
  const allowed = new Set([
    'bundle',
    'injection_id',
    'expected_mount_bundle_digest',
    'expected_runtime_sha',
    'expected_authorization_generation',
    'now_epoch',
  ]);
  assertExactFields(input, allowed, 'inject');
  return Object.freeze({
    bundle: input.bundle,
    injection_id: identifier(input.injection_id, 'injection_id', 191),
    expected_mount_bundle_digest: hash(input.expected_mount_bundle_digest, 'expected_mount_bundle_digest'),
    expected_runtime_sha: hash(input.expected_runtime_sha, 'expected_runtime_sha'),
    expected_authorization_generation: integer(input.expected_authorization_generation, 'expected_authorization_generation', 1),
    now_epoch: integer(input.now_epoch, 'now_epoch', 1),
  });
}

function normalizeReadbackRequest(input = {}) {
  const allowed = new Set([
    'injection_id',
    'expected_injection_receipt_digest',
    'expected_mount_bundle_digest',
  ]);
  assertExactFields(input, allowed, 'readback');
  return Object.freeze({
    injection_id: identifier(input.injection_id, 'injection_id', 191),
    expected_injection_receipt_digest: hash(input.expected_injection_receipt_digest, 'expected_injection_receipt_digest'),
    expected_mount_bundle_digest: hash(input.expected_mount_bundle_digest, 'expected_mount_bundle_digest'),
  });
}

function normalizeRollbackRequest(input = {}) {
  const allowed = new Set([
    'injection_id',
    'expected_mount_readback_digest',
    'rollback_reason_code',
    'now_epoch',
  ]);
  assertExactFields(input, allowed, 'rollback');
  return Object.freeze({
    injection_id: identifier(input.injection_id, 'injection_id', 191),
    expected_mount_readback_digest: hash(input.expected_mount_readback_digest, 'expected_mount_readback_digest'),
    rollback_reason_code: identifier(input.rollback_reason_code, 'rollback_reason_code', 128),
    now_epoch: integer(input.now_epoch, 'now_epoch', 1),
  });
}

function assertBundle(bundle, expected = {}) {
  if (!isCanonicalHostingerStorageAuthorizedMountBundle(bundle)) {
    throw fail(409, 'STORAGE_AUTHORIZED_INJECTION_BUNDLE_INVALID', 'A canonical authorized mount bundle is required.');
  }
  const runtimeDescriptor = Object.getOwnPropertyDescriptor(bundle, DEPENDENCY_KEY);
  const mismatches = [];
  if (bundle.version !== HOSTINGER_STORAGE_AUTHORIZED_MOUNT_EXECUTOR_VERSION) mismatches.push('bundle.version');
  if (bundle.route_path !== ROUTE_PATH) mismatches.push('route_path');
  if (bundle.dependency_key !== DEPENDENCY_KEY) mismatches.push('dependency_key');
  if (expected.mount_bundle_digest && bundle.mount_bundle_digest !== expected.mount_bundle_digest) mismatches.push('mount_bundle_digest');
  if (expected.runtime_sha && bundle.expected_runtime_sha !== expected.runtime_sha) mismatches.push('expected_runtime_sha');
  if (expected.authorization_generation && bundle.authorization_generation !== expected.authorization_generation) mismatches.push('authorization_generation');
  if (bundle.ready_for_dependency_injection !== true) mismatches.push('ready_for_dependency_injection');
  if (bundle.authorization_consumed !== true) mismatches.push('authorization_consumed');
  if (bundle.dependency_injected !== false) mismatches.push('dependency_injected');
  if (bundle.mount_performed !== false) mismatches.push('mount_performed');
  if (bundle.runtime_mounted !== false) mismatches.push('runtime_mounted');
  if (bundle.route_mounted !== false) mismatches.push('route_mounted');
  if (bundle.worker_mounted !== false) mismatches.push('worker_mounted');
  if (bundle.provider_dispatch_allowed !== false) mismatches.push('provider_dispatch_allowed');
  if (bundle.production_ready !== false) mismatches.push('production_ready');
  if (bundle.automatic_retry_allowed !== false) mismatches.push('automatic_retry_allowed');
  if (bundle.secrets_included !== false) mismatches.push('secrets_included');
  if (!runtimeDescriptor || runtimeDescriptor.enumerable !== false || runtimeDescriptor.configurable !== false
    || runtimeDescriptor.writable !== false || typeof runtimeDescriptor.value?.execute !== 'function') {
    mismatches.push('tenantStorageRuntime.descriptor');
  }
  if (runtimeDescriptor?.value?.synthetic_only !== true
    || runtimeDescriptor?.value?.provider_dispatch_allowed !== false
    || runtimeDescriptor?.value?.production_ready !== false
    || !Object.isFrozen(runtimeDescriptor?.value)) {
    mismatches.push('tenantStorageRuntime.boundary');
  }
  if (mismatches.length) {
    throw fail(409, 'STORAGE_AUTHORIZED_INJECTION_BUNDLE_BINDING_MISMATCH', 'Authorized mount bundle does not satisfy the reviewed injection boundary.', {
      mismatches: [...new Set(mismatches)].sort(),
    });
  }
  return runtimeDescriptor.value;
}

function createRouteDependencies(runtime) {
  const dependencies = {};
  Object.defineProperty(dependencies, DEPENDENCY_KEY, {
    value: runtime,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(dependencies);
}

function routeDependencySnapshotCore(bundle) {
  return {
    contract: 'spec014.hostinger-storage-route-dependency-snapshot.v1',
    version: HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION,
    route_path: ROUTE_PATH,
    dependency_key: DEPENDENCY_KEY,
    mount_bundle_digest: bundle.mount_bundle_digest,
    authorization_id: bundle.authorization_id,
    authorization_generation: bundle.authorization_generation,
    dependency_manifest_digest: bundle.dependency_manifest_digest,
    expected_runtime_sha: bundle.expected_runtime_sha,
    source_commit: bundle.source_commit,
    database_fingerprint: bundle.database_fingerprint,
    schema_verification_digest: bundle.schema_verification_digest,
    readback_cycle_id: bundle.readback_cycle_id,
    tenant_runtime_version: bundle.tenant_runtime_version,
    synthetic_only: true,
    provider_dispatch_allowed: false,
    production_ready: false,
    secrets_included: false,
  };
}

function expectedReceiptBundleBindings(bundle) {
  return {
    mount_bundle_digest: bundle.mount_bundle_digest,
    authorization_id: bundle.authorization_id,
    authorization_generation: bundle.authorization_generation,
    authorization_consumption_digest: bundle.authorization_consumption_digest,
    dependency_manifest_digest: bundle.dependency_manifest_digest,
    expected_runtime_sha: bundle.expected_runtime_sha,
    source_commit: bundle.source_commit,
    database_fingerprint: bundle.database_fingerprint,
    schema_verification_digest: bundle.schema_verification_digest,
    readback_cycle_id: bundle.readback_cycle_id,
    rollback_plan_digest: bundle.rollback_plan_digest,
    route_dependency_snapshot_digest: digest(routeDependencySnapshotCore(bundle)),
  };
}

function createInjectionReceipt(bundle, request) {
  const dependencySnapshot = routeDependencySnapshotCore(bundle);
  const core = {
    contract: 'spec014.hostinger-storage-authorized-dependency-injection-receipt.v1',
    version: HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION,
    injection_id: request.injection_id,
    injection_generation: 1,
    injected_at_epoch: request.now_epoch,
    route_path: ROUTE_PATH,
    dependency_key: DEPENDENCY_KEY,
    mount_bundle_digest: bundle.mount_bundle_digest,
    authorization_id: bundle.authorization_id,
    authorization_generation: bundle.authorization_generation,
    authorization_consumption_digest: bundle.authorization_consumption_digest,
    dependency_manifest_digest: bundle.dependency_manifest_digest,
    expected_runtime_sha: bundle.expected_runtime_sha,
    source_commit: bundle.source_commit,
    database_fingerprint: bundle.database_fingerprint,
    schema_verification_digest: bundle.schema_verification_digest,
    readback_cycle_id: bundle.readback_cycle_id,
    rollback_plan_digest: bundle.rollback_plan_digest,
    route_dependency_snapshot_digest: digest(dependencySnapshot),
    dependency_snapshot_created: true,
    dependency_injected: true,
    mount_performed: true,
    runtime_mounted: true,
    route_mounted: true,
    worker_mounted: false,
    live_server_modified: false,
    live_route_registration_performed: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    automatic_retry_allowed: false,
    reconciliation_state: 'dependency_injected_pending_exact_readback',
    secrets_included: false,
  };
  return deepFreeze({ ...core, injection_receipt_digest: digest(core) });
}

function createMountReadback(active) {
  const descriptor = Object.getOwnPropertyDescriptor(active.routeDependencies, DEPENDENCY_KEY);
  const core = {
    contract: 'spec014.hostinger-storage-authorized-mount-readback.v1',
    version: HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION,
    injection_id: active.receipt.injection_id,
    injection_generation: active.receipt.injection_generation,
    injection_receipt_digest: active.receipt.injection_receipt_digest,
    mount_bundle_digest: active.receipt.mount_bundle_digest,
    route_dependency_snapshot_digest: active.receipt.route_dependency_snapshot_digest,
    route_path: ROUTE_PATH,
    dependency_key: DEPENDENCY_KEY,
    expected_runtime_sha: active.receipt.expected_runtime_sha,
    source_commit: active.receipt.source_commit,
    database_fingerprint: active.receipt.database_fingerprint,
    schema_verification_digest: active.receipt.schema_verification_digest,
    readback_cycle_id: active.receipt.readback_cycle_id,
    dependency_descriptor_verified: Boolean(descriptor
      && descriptor.enumerable === false
      && descriptor.configurable === false
      && descriptor.writable === false),
    exact_runtime_object_identity: descriptor?.value === active.bundle.tenantStorageRuntime,
    route_dependency_snapshot_frozen: Object.isFrozen(active.routeDependencies),
    runtime_identity_verified: descriptor?.value?.execute === active.bundle.tenantStorageRuntime.execute
      && descriptor?.value?.synthetic_only === true
      && descriptor?.value?.provider_dispatch_allowed === false
      && descriptor?.value?.production_ready === false,
    readback_verified: true,
    dependency_injected: true,
    mount_performed: true,
    runtime_mounted: true,
    route_mounted: true,
    worker_mounted: false,
    live_server_modified: false,
    live_route_registration_performed: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    automatic_retry_allowed: false,
    reconciliation_state: 'dependency_injection_readback_verified',
    secrets_included: false,
  };
  if (!core.dependency_descriptor_verified
    || !core.exact_runtime_object_identity
    || !core.route_dependency_snapshot_frozen
    || !core.runtime_identity_verified) {
    throw fail(409, 'STORAGE_AUTHORIZED_INJECTION_READBACK_MISMATCH', 'Injected dependency readback does not prove the exact authorized runtime identity.');
  }
  return deepFreeze({ ...core, mount_readback_digest: digest(core) });
}

function verifySerializedReceipt(value) {
  const receipt = snapshot(value, 'injection_receipt');
  const suppliedDigest = hash(receipt.injection_receipt_digest, 'injection_receipt.injection_receipt_digest');
  delete receipt.injection_receipt_digest;
  if (digest(receipt) !== suppliedDigest
    || receipt.contract !== 'spec014.hostinger-storage-authorized-dependency-injection-receipt.v1'
    || receipt.version !== HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION
    || receipt.route_path !== ROUTE_PATH
    || receipt.dependency_key !== DEPENDENCY_KEY
    || receipt.dependency_injected !== true
    || receipt.runtime_mounted !== true
    || receipt.route_mounted !== true
    || receipt.worker_mounted !== false
    || receipt.live_server_modified !== false
    || receipt.live_route_registration_performed !== false
    || receipt.provider_dispatch_allowed !== false
    || receipt.production_ready !== false
    || receipt.automatic_retry_allowed !== false
    || receipt.secrets_included !== false) {
    throw fail(409, 'STORAGE_AUTHORIZED_INJECTION_RECEIPT_INVALID', 'Persisted injection receipt failed exact contract verification.');
  }
  return deepFreeze({ ...receipt, injection_receipt_digest: suppliedDigest });
}

function verifySerializedReadback(value) {
  const readback = snapshot(value, 'mount_readback');
  const suppliedDigest = hash(readback.mount_readback_digest, 'mount_readback.mount_readback_digest');
  delete readback.mount_readback_digest;
  if (digest(readback) !== suppliedDigest
    || readback.contract !== 'spec014.hostinger-storage-authorized-mount-readback.v1'
    || readback.version !== HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION
    || readback.route_path !== ROUTE_PATH
    || readback.dependency_key !== DEPENDENCY_KEY
    || readback.readback_verified !== true
    || readback.dependency_descriptor_verified !== true
    || readback.exact_runtime_object_identity !== true
    || readback.route_dependency_snapshot_frozen !== true
    || readback.runtime_identity_verified !== true
    || readback.dependency_injected !== true
    || readback.runtime_mounted !== true
    || readback.route_mounted !== true
    || readback.worker_mounted !== false
    || readback.live_server_modified !== false
    || readback.live_route_registration_performed !== false
    || readback.provider_dispatch_allowed !== false
    || readback.production_ready !== false
    || readback.automatic_retry_allowed !== false
    || readback.secrets_included !== false) {
    throw fail(409, 'STORAGE_AUTHORIZED_INJECTION_READBACK_INVALID', 'Persisted mount readback failed exact contract verification.');
  }
  return deepFreeze({ ...readback, mount_readback_digest: suppliedDigest });
}

export function createHostingerStorageAuthorizedDependencyInjectionCoordinator(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).length !== 0) {
    throw fail(409, 'STORAGE_AUTHORIZED_INJECTION_OVERRIDE_FORBIDDEN', 'The injection coordinator does not accept dependency or policy overrides.');
  }
  let active = null;
  let lastRollback = null;

  function injectAuthorizedDependency(input = {}) {
    if (active) {
      throw fail(409, 'STORAGE_AUTHORIZED_INJECTION_ACTIVE_SLOT_OCCUPIED', 'An authorized dependency is already active; rollback is required before another injection.');
    }
    const request = normalizeInjectionRequest(input);
    const runtime = assertBundle(request.bundle, {
      mount_bundle_digest: request.expected_mount_bundle_digest,
      runtime_sha: request.expected_runtime_sha,
      authorization_generation: request.expected_authorization_generation,
    });
    const routeDependencies = createRouteDependencies(runtime);
    const receipt = createInjectionReceipt(request.bundle, request);
    active = {
      bundle: request.bundle,
      routeDependencies,
      receipt,
      readback: null,
    };
    return receipt;
  }

  function readMountReadback(input = {}) {
    const request = normalizeReadbackRequest(input);
    if (!active
      || active.receipt.injection_id !== request.injection_id
      || active.receipt.injection_receipt_digest !== request.expected_injection_receipt_digest
      || active.receipt.mount_bundle_digest !== request.expected_mount_bundle_digest) {
      throw fail(409, 'STORAGE_AUTHORIZED_INJECTION_READBACK_BINDING_MISMATCH', 'Active injection does not match the requested readback identity.');
    }
    const readback = createMountReadback(active);
    active.readback = readback;
    return readback;
  }

  function resolveRouteDependencies(input = {}) {
    const allowed = new Set(['expected_mount_readback_digest']);
    assertExactFields(input, allowed, 'resolve_route_dependencies');
    if (!active?.readback) return EMPTY_ROUTE_DEPENDENCIES;
    let expectedDigest;
    try {
      expectedDigest = hash(input.expected_mount_readback_digest, 'expected_mount_readback_digest');
    } catch {
      return EMPTY_ROUTE_DEPENDENCIES;
    }
    if (active.readback.mount_readback_digest !== expectedDigest) return EMPTY_ROUTE_DEPENDENCIES;
    try {
      const current = createMountReadback(active);
      if (current.mount_readback_digest !== active.readback.mount_readback_digest) return EMPTY_ROUTE_DEPENDENCIES;
    } catch {
      return EMPTY_ROUTE_DEPENDENCIES;
    }
    return active.routeDependencies;
  }

  function resumeAuthorizedInjection(input = {}) {
    const allowed = new Set(['bundle', 'injection_receipt', 'mount_readback']);
    assertExactFields(input, allowed, 'resume');
    if (active) {
      throw fail(409, 'STORAGE_AUTHORIZED_INJECTION_ACTIVE_SLOT_OCCUPIED', 'Cannot resume while an active injection exists.');
    }
    const bundle = input.bundle;
    assertBundle(bundle);
    const receipt = verifySerializedReceipt(input.injection_receipt);
    const readback = verifySerializedReadback(input.mount_readback);
    const mismatches = [];
    for (const [field, expectedValue] of Object.entries(expectedReceiptBundleBindings(bundle))) {
      if (receipt[field] !== expectedValue) mismatches.push(`receipt.${field}`);
    }
    const expectedReadbackBindings = {
      injection_id: receipt.injection_id,
      injection_generation: receipt.injection_generation,
      injection_receipt_digest: receipt.injection_receipt_digest,
      mount_bundle_digest: receipt.mount_bundle_digest,
      route_dependency_snapshot_digest: receipt.route_dependency_snapshot_digest,
      expected_runtime_sha: receipt.expected_runtime_sha,
      source_commit: receipt.source_commit,
      database_fingerprint: receipt.database_fingerprint,
      schema_verification_digest: receipt.schema_verification_digest,
      readback_cycle_id: receipt.readback_cycle_id,
    };
    for (const [field, expectedValue] of Object.entries(expectedReadbackBindings)) {
      if (readback[field] !== expectedValue) mismatches.push(`readback.${field}`);
    }
    if (mismatches.length) {
      throw fail(409, 'STORAGE_AUTHORIZED_INJECTION_RESUME_BINDING_MISMATCH', 'Persisted injection evidence does not match the reconstructed authorized mount bundle.', {
        mismatches: [...new Set(mismatches)].sort(),
      });
    }
    const runtime = bundle.tenantStorageRuntime;
    const routeDependencies = createRouteDependencies(runtime);
    active = { bundle, routeDependencies, receipt, readback: null };
    const reconstructed = createMountReadback(active);
    if (reconstructed.mount_readback_digest !== readback.mount_readback_digest) {
      active = null;
      throw fail(409, 'STORAGE_AUTHORIZED_INJECTION_RESUME_READBACK_MISMATCH', 'Restart reconstruction changed the exact mount readback digest.');
    }
    active.readback = readback;
    return readback;
  }

  function rollbackAuthorizedInjection(input = {}) {
    const request = normalizeRollbackRequest(input);
    if (!active?.readback
      || active.receipt.injection_id !== request.injection_id
      || active.readback.mount_readback_digest !== request.expected_mount_readback_digest) {
      throw fail(409, 'STORAGE_AUTHORIZED_INJECTION_ROLLBACK_BINDING_MISMATCH', 'Rollback requires the exact active verified readback.');
    }
    const core = {
      contract: 'spec014.hostinger-storage-authorized-dependency-injection-rollback.v1',
      version: HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION,
      injection_id: active.receipt.injection_id,
      injection_generation: active.receipt.injection_generation,
      injection_receipt_digest: active.receipt.injection_receipt_digest,
      mount_readback_digest: active.readback.mount_readback_digest,
      mount_bundle_digest: active.receipt.mount_bundle_digest,
      rollback_plan_digest: active.receipt.rollback_plan_digest,
      rollback_reason_code: request.rollback_reason_code,
      rolled_back_at_epoch: request.now_epoch,
      dependency_injected: false,
      mount_performed: false,
      runtime_mounted: false,
      route_mounted: false,
      worker_mounted: false,
      live_server_modified: false,
      live_route_registration_performed: false,
      provider_dispatch_allowed: false,
      production_ready: false,
      automatic_retry_allowed: false,
      fail_closed_route_restored: true,
      reconciliation_state: 'dependency_injection_rolled_back',
      secrets_included: false,
    };
    const rollback = deepFreeze({ ...core, rollback_receipt_digest: digest(core) });
    active = null;
    lastRollback = rollback;
    return rollback;
  }

  function readState() {
    return deepFreeze({
      active: Boolean(active),
      injection_id: active?.receipt.injection_id ?? null,
      injection_receipt_digest: active?.receipt.injection_receipt_digest ?? null,
      mount_readback_digest: active?.readback?.mount_readback_digest ?? null,
      readback_verified: active?.readback?.readback_verified === true,
      route_dependencies_available: Boolean(active?.readback),
      rollback_receipt_digest: lastRollback?.rollback_receipt_digest ?? null,
      dependency_injected: Boolean(active),
      runtime_mounted: Boolean(active),
      route_mounted: Boolean(active),
      worker_mounted: false,
      live_server_modified: false,
      live_route_registration_performed: false,
      provider_dispatch_allowed: false,
      production_ready: false,
      automatic_retry_allowed: false,
      secrets_included: false,
    });
  }

  const coordinator = {
    coordinator_key: 'hostinger_storage_authorized_dependency_injection_v1',
    coordinator_version: HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION,
    route_path: ROUTE_PATH,
    dependency_key: DEPENDENCY_KEY,
    requires_canonical_authorized_mount_bundle: true,
    requires_exact_readback_before_route_resolution: true,
    rollback_restores_fail_closed_route: true,
    live_server_modified: false,
    live_route_registration_performed: false,
    worker_mounted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    automatic_retry_allowed: false,
    injectAuthorizedDependency,
    readMountReadback,
    resolveRouteDependencies,
    resumeAuthorizedInjection,
    rollbackAuthorizedInjection,
    readState,
    secrets_included: false,
  };
  Object.defineProperty(coordinator, COORDINATOR_BRAND, { value: true, enumerable: false });
  return Object.freeze(coordinator);
}

export function isCanonicalHostingerStorageAuthorizedDependencyInjectionCoordinator(value) {
  return Boolean(value?.[COORDINATOR_BRAND] === true
    && Object.isFrozen(value)
    && value.coordinator_key === 'hostinger_storage_authorized_dependency_injection_v1'
    && value.coordinator_version === HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION
    && value.route_path === ROUTE_PATH
    && value.dependency_key === DEPENDENCY_KEY
    && value.requires_canonical_authorized_mount_bundle === true
    && value.requires_exact_readback_before_route_resolution === true
    && value.rollback_restores_fail_closed_route === true
    && value.live_server_modified === false
    && value.live_route_registration_performed === false
    && value.worker_mounted === false
    && value.provider_dispatch_allowed === false
    && value.production_ready === false
    && value.automatic_retry_allowed === false
    && typeof value.injectAuthorizedDependency === 'function'
    && typeof value.readMountReadback === 'function'
    && typeof value.resolveRouteDependencies === 'function'
    && typeof value.resumeAuthorizedInjection === 'function'
    && typeof value.rollbackAuthorizedInjection === 'function'
    && typeof value.readState === 'function'
    && value.secrets_included === false);
}
