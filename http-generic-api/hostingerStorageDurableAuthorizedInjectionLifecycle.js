import {
  createHostingerStorageAuthorizedDependencyInjectionCoordinator,
  isCanonicalHostingerStorageAuthorizedDependencyInjectionCoordinator,
} from './hostingerStorageAuthorizedDependencyInjection.js';
import { isCanonicalHostingerStorageAuthorizedMountBundle } from './hostingerStorageAuthorizedMountExecutor.js';
import { isCanonicalHostingerStorageDurableAuthorizedInjectionStateRegistry } from './hostingerStorageDurableAuthorizedInjectionState.js';

export const HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_LIFECYCLE_VERSION =
  'spec014-hostinger-storage-durable-authorized-injection-lifecycle-v1';

const BRAND = Symbol.for('mad4b.spec014.hostinger-storage-durable-authorized-injection-lifecycle');
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/+/-]{0,255}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const EMPTY_ROUTE_DEPENDENCIES = Object.freeze({});
const ALLOWED_OPTIONS = new Set(['durable_injection_registry']);

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = Object.freeze({ ...details, secrets_included: false });
  return error;
}

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function identifier(value, field, max = 256) {
  const normalized = text(value, max);
  if (!SAFE_ID_RE.test(normalized) || normalized.length > max) {
    throw fail(400, 'STORAGE_DURABLE_LIFECYCLE_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return normalized;
}

function hash(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw fail(400, 'STORAGE_DURABLE_LIFECYCLE_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  }
  return normalized;
}

function integer(value, field, minimum = 0) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    throw fail(400, 'STORAGE_DURABLE_LIFECYCLE_INTEGER_INVALID', 'A bounded integer is required.', { field, minimum });
  }
  return normalized;
}

function assertExactFields(value, allowed, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(400, 'STORAGE_DURABLE_LIFECYCLE_INPUT_INVALID', 'A plain lifecycle input object is required.', { path });
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const unsupported = Object.keys(descriptors).filter((key) => !allowed.has(key));
  if (unsupported.length) {
    throw fail(400, 'STORAGE_DURABLE_LIFECYCLE_FIELD_FORBIDDEN', 'Unsupported lifecycle fields are forbidden.', {
      path,
      unsupported_fields: unsupported.sort(),
    });
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
      throw fail(400, 'STORAGE_DURABLE_LIFECYCLE_ACCESSOR_REJECTED', 'Lifecycle inputs must use owned data fields.', { path: `${path}.${key}` });
    }
  }
}

function freeze(value) {
  return Object.freeze(value);
}

function activationSummary(active, mode) {
  return freeze({
    contract: 'spec014.hostinger-storage-durable-authorized-injection-lifecycle-activation.v1',
    version: HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_LIFECYCLE_VERSION,
    mode,
    injection_id: active.receipt.injection_id,
    injection_receipt_digest: active.receipt.injection_receipt_digest,
    mount_readback_digest: active.readback.mount_readback_digest,
    mount_bundle_digest: active.receipt.mount_bundle_digest,
    durable_state_digest: active.durableState.record_digest,
    durable_state_active: active.durableState.active === true,
    exact_readback_verified: active.readback.readback_verified === true,
    ready_for_route_resolution: true,
    runtime_material_persisted: false,
    live_server_modified: false,
    live_route_registration_performed: false,
    migration_apply_authorized: false,
    worker_mounted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    automatic_retry_allowed: false,
    secrets_included: false,
  });
}

export function createHostingerStorageDurableAuthorizedInjectionLifecycle(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw fail(500, 'STORAGE_DURABLE_LIFECYCLE_OPTIONS_INVALID', 'Lifecycle options must be an object.');
  }
  const unsupported = Object.keys(options).filter((key) => !ALLOWED_OPTIONS.has(key));
  if (unsupported.length) {
    throw fail(409, 'STORAGE_DURABLE_LIFECYCLE_OVERRIDE_FORBIDDEN', 'Only the canonical durable injection registry may be supplied.', {
      unsupported_options: unsupported.sort(),
    });
  }
  const registry = options.durable_injection_registry;
  if (!isCanonicalHostingerStorageDurableAuthorizedInjectionStateRegistry(registry)) {
    throw fail(500, 'STORAGE_DURABLE_LIFECYCLE_REGISTRY_INVALID', 'A canonical durable authorized injection-state registry is required.');
  }

  let active = null;
  let pendingRollback = null;
  let lastRollback = null;

  function createCoordinator() {
    const coordinator = createHostingerStorageAuthorizedDependencyInjectionCoordinator();
    if (!isCanonicalHostingerStorageAuthorizedDependencyInjectionCoordinator(coordinator)) {
      throw fail(500, 'STORAGE_DURABLE_LIFECYCLE_COORDINATOR_INVALID', 'Canonical injection coordinator construction failed.');
    }
    return coordinator;
  }

  async function activateAuthorizedInjection(input = {}) {
    assertExactFields(input, new Set(['bundle', 'injection_id', 'now_epoch']), 'activate');
    if (active || pendingRollback) {
      throw fail(409, 'STORAGE_DURABLE_LIFECYCLE_SLOT_OCCUPIED', 'Rollback and reconciliation must complete before another activation.');
    }
    if (!isCanonicalHostingerStorageAuthorizedMountBundle(input.bundle)) {
      throw fail(409, 'STORAGE_DURABLE_LIFECYCLE_BUNDLE_INVALID', 'A canonical authorized mount bundle is required.');
    }
    const injectionId = identifier(input.injection_id, 'injection_id', 191);
    const nowEpoch = integer(input.now_epoch, 'now_epoch', 1);
    const coordinator = createCoordinator();
    const receipt = coordinator.injectAuthorizedDependency({
      bundle: input.bundle,
      injection_id: injectionId,
      expected_mount_bundle_digest: input.bundle.mount_bundle_digest,
      expected_runtime_sha: input.bundle.expected_runtime_sha,
      expected_authorization_generation: input.bundle.authorization_generation,
      now_epoch: nowEpoch,
    });
    const readback = coordinator.readMountReadback({
      injection_id: injectionId,
      expected_injection_receipt_digest: receipt.injection_receipt_digest,
      expected_mount_bundle_digest: input.bundle.mount_bundle_digest,
    });
    let registered;
    try {
      registered = await registry.registerVerifiedInjection({
        injection_receipt: receipt,
        mount_readback: readback,
        now_epoch: nowEpoch,
      });
    } catch (error) {
      coordinator.rollbackAuthorizedInjection({
        injection_id: injectionId,
        expected_mount_readback_digest: readback.mount_readback_digest,
        rollback_reason_code: 'durable_registration_failed',
        now_epoch: nowEpoch,
      });
      throw fail(409, 'STORAGE_DURABLE_LIFECYCLE_REGISTRATION_FAILED', 'Durable registration failed and the route dependency was restored to fail-closed state.', {
        cause_code: error?.code || 'unknown',
        route_fail_closed: true,
        durable_state_created: false,
      });
    }
    if (!registered?.state || registered.state.active !== true
      || registered.state.injection_receipt_digest !== receipt.injection_receipt_digest
      || registered.state.mount_readback_digest !== readback.mount_readback_digest
      || registered.state.mount_bundle_digest !== input.bundle.mount_bundle_digest
      || registered.state.runtime_material_persisted !== false) {
      coordinator.rollbackAuthorizedInjection({
        injection_id: injectionId,
        expected_mount_readback_digest: readback.mount_readback_digest,
        rollback_reason_code: 'durable_registration_readback_mismatch',
        now_epoch: nowEpoch,
      });
      throw fail(409, 'STORAGE_DURABLE_LIFECYCLE_REGISTRATION_READBACK_MISMATCH', 'Durable registration readback did not preserve the exact authorized injection identity.', {
        route_fail_closed: true,
      });
    }
    active = freeze({
      bundle: input.bundle,
      coordinator,
      receipt,
      readback,
      durableState: registered.state,
    });
    return activationSummary(active, registered.replay === true ? 'durable_replay' : 'new_activation');
  }

  async function resumeAuthorizedInjection(input = {}) {
    assertExactFields(input, new Set(['bundle', 'injection_id']), 'resume');
    if (active || pendingRollback) {
      throw fail(409, 'STORAGE_DURABLE_LIFECYCLE_SLOT_OCCUPIED', 'Rollback and reconciliation must complete before restart reconstruction.');
    }
    if (!isCanonicalHostingerStorageAuthorizedMountBundle(input.bundle)) {
      throw fail(409, 'STORAGE_DURABLE_LIFECYCLE_BUNDLE_INVALID', 'A canonical reconstructed authorized mount bundle is required.');
    }
    const injectionId = identifier(input.injection_id, 'injection_id', 191);
    const persisted = await registry.readVerifiedInjection(injectionId);
    if (!persisted || persisted.active !== true) {
      throw fail(409, 'STORAGE_DURABLE_LIFECYCLE_ACTIVE_STATE_REQUIRED', 'An active durable authorized injection state is required for restart reconstruction.', { injection_id: injectionId });
    }
    const coordinator = createCoordinator();
    const readback = coordinator.resumeAuthorizedInjection({
      bundle: input.bundle,
      injection_receipt: persisted.injection_receipt,
      mount_readback: persisted.mount_readback,
    });
    if (readback.mount_readback_digest !== persisted.mount_readback_digest
      || persisted.mount_bundle_digest !== input.bundle.mount_bundle_digest
      || persisted.runtime_material_persisted !== false) {
      throw fail(409, 'STORAGE_DURABLE_LIFECYCLE_RESTART_MISMATCH', 'Restart reconstruction changed the exact durable authorized injection identity.');
    }
    active = freeze({
      bundle: input.bundle,
      coordinator,
      receipt: persisted.injection_receipt,
      readback,
      durableState: persisted,
    });
    return activationSummary(active, 'restart_reconstruction');
  }

  function resolveRouteDependencies(input = {}) {
    assertExactFields(input, new Set(['expected_mount_readback_digest']), 'resolve_route_dependencies');
    if (!active || pendingRollback) return EMPTY_ROUTE_DEPENDENCIES;
    let expectedDigest;
    try {
      expectedDigest = hash(input.expected_mount_readback_digest, 'expected_mount_readback_digest');
    } catch {
      return EMPTY_ROUTE_DEPENDENCIES;
    }
    if (expectedDigest !== active.readback.mount_readback_digest
      || active.durableState.active !== true) {
      return EMPTY_ROUTE_DEPENDENCIES;
    }
    return active.coordinator.resolveRouteDependencies({
      expected_mount_readback_digest: expectedDigest,
    });
  }

  async function rollbackAuthorizedInjection(input = {}) {
    assertExactFields(input, new Set(['injection_id', 'rollback_reason_code', 'now_epoch']), 'rollback');
    if (!active || pendingRollback) {
      throw fail(409, 'STORAGE_DURABLE_LIFECYCLE_ACTIVE_STATE_REQUIRED', 'An active durable lifecycle is required for rollback.');
    }
    const injectionId = identifier(input.injection_id, 'injection_id', 191);
    const reasonCode = identifier(input.rollback_reason_code, 'rollback_reason_code', 128);
    const nowEpoch = integer(input.now_epoch, 'now_epoch', 1);
    if (injectionId !== active.receipt.injection_id) {
      throw fail(409, 'STORAGE_DURABLE_LIFECYCLE_ROLLBACK_BINDING_MISMATCH', 'Rollback must target the exact active injection identity.');
    }
    const rollbackReceipt = active.coordinator.rollbackAuthorizedInjection({
      injection_id: injectionId,
      expected_mount_readback_digest: active.readback.mount_readback_digest,
      rollback_reason_code: reasonCode,
      now_epoch: nowEpoch,
    });
    const rollbackInput = freeze({
      rollback_receipt: rollbackReceipt,
      expected_mount_readback_digest: active.readback.mount_readback_digest,
      now_epoch: nowEpoch,
    });
    const prior = active;
    active = null;
    try {
      const durable = await registry.recordRollback(rollbackInput);
      pendingRollback = null;
      lastRollback = freeze({
        injection_id: injectionId,
        rollback_receipt_digest: rollbackReceipt.rollback_receipt_digest,
        mount_readback_digest: prior.readback.mount_readback_digest,
        durable_state_digest: durable.state.record_digest,
        durable_rollback_digest: durable.rollback.record_digest,
        durable_rollback_recorded: true,
        route_fail_closed: true,
      });
      return freeze({
        contract: 'spec014.hostinger-storage-durable-authorized-injection-lifecycle-rollback.v1',
        version: HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_LIFECYCLE_VERSION,
        ...lastRollback,
        runtime_material_persisted: false,
        live_server_modified: false,
        live_route_registration_performed: false,
        migration_apply_authorized: false,
        worker_mounted: false,
        provider_dispatch_allowed: false,
        production_ready: false,
        automatic_retry_allowed: false,
        secrets_included: false,
      });
    } catch (error) {
      pendingRollback = freeze({ rollbackInput, priorMountReadbackDigest: prior.readback.mount_readback_digest });
      throw fail(409, 'STORAGE_DURABLE_LIFECYCLE_DURABLE_ROLLBACK_PENDING', 'The route is fail-closed but durable rollback reconciliation remains required.', {
        cause_code: error?.code || 'unknown',
        route_fail_closed: true,
        durable_reconciliation_required: true,
        automatic_retry_allowed: false,
      });
    }
  }

  async function reconcilePendingRollback(input = {}) {
    assertExactFields(input, new Set([]), 'reconcile_pending_rollback');
    if (!pendingRollback) {
      throw fail(409, 'STORAGE_DURABLE_LIFECYCLE_PENDING_ROLLBACK_REQUIRED', 'No pending durable rollback reconciliation exists.');
    }
    const durable = await registry.recordRollback(pendingRollback.rollbackInput);
    const rollbackReceipt = pendingRollback.rollbackInput.rollback_receipt;
    lastRollback = freeze({
      injection_id: rollbackReceipt.injection_id,
      rollback_receipt_digest: rollbackReceipt.rollback_receipt_digest,
      mount_readback_digest: pendingRollback.priorMountReadbackDigest,
      durable_state_digest: durable.state.record_digest,
      durable_rollback_digest: durable.rollback.record_digest,
      durable_rollback_recorded: true,
      route_fail_closed: true,
    });
    pendingRollback = null;
    return freeze({ ...lastRollback, reconciled: true, automatic_retry_allowed: false, secrets_included: false });
  }

  function readState() {
    return freeze({
      active: Boolean(active),
      injection_id: active?.receipt.injection_id ?? pendingRollback?.rollbackInput.rollback_receipt.injection_id ?? null,
      mount_bundle_digest: active?.receipt.mount_bundle_digest ?? null,
      mount_readback_digest: active?.readback.mount_readback_digest ?? pendingRollback?.priorMountReadbackDigest ?? null,
      durable_state_digest: active?.durableState.record_digest ?? lastRollback?.durable_state_digest ?? null,
      route_dependencies_available: Boolean(active) && !pendingRollback,
      durable_reconciliation_required: Boolean(pendingRollback),
      last_rollback_receipt_digest: lastRollback?.rollback_receipt_digest ?? null,
      runtime_material_persisted: false,
      live_server_modified: false,
      live_route_registration_performed: false,
      migration_apply_authorized: false,
      worker_mounted: false,
      provider_dispatch_allowed: false,
      production_ready: false,
      automatic_retry_allowed: false,
      secrets_included: false,
    });
  }

  const lifecycle = {
    lifecycle_key: 'hostinger_storage_durable_authorized_injection_lifecycle_v1',
    lifecycle_version: HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_LIFECYCLE_VERSION,
    canonical_coordinator_owned_internally: true,
    canonical_durable_registry_required: true,
    route_available_only_after_durable_readback: true,
    restart_reconstruction_supported: true,
    rollback_route_fail_closed_before_durable_commit: true,
    runtime_material_persisted: false,
    live_server_modified: false,
    live_route_registration_performed: false,
    migration_apply_authorized: false,
    worker_mounted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    automatic_retry_allowed: false,
    activateAuthorizedInjection,
    resumeAuthorizedInjection,
    resolveRouteDependencies,
    rollbackAuthorizedInjection,
    reconcilePendingRollback,
    readState,
    secrets_included: false,
  };
  Object.defineProperty(lifecycle, BRAND, { value: true, enumerable: false });
  return Object.freeze(lifecycle);
}

export function isCanonicalHostingerStorageDurableAuthorizedInjectionLifecycle(value) {
  return Boolean(value?.[BRAND] === true
    && Object.isFrozen(value)
    && value.lifecycle_key === 'hostinger_storage_durable_authorized_injection_lifecycle_v1'
    && value.lifecycle_version === HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_LIFECYCLE_VERSION
    && value.canonical_coordinator_owned_internally === true
    && value.canonical_durable_registry_required === true
    && value.route_available_only_after_durable_readback === true
    && value.restart_reconstruction_supported === true
    && value.rollback_route_fail_closed_before_durable_commit === true
    && value.runtime_material_persisted === false
    && value.live_server_modified === false
    && value.live_route_registration_performed === false
    && value.migration_apply_authorized === false
    && value.worker_mounted === false
    && value.provider_dispatch_allowed === false
    && value.production_ready === false
    && value.automatic_retry_allowed === false
    && typeof value.activateAuthorizedInjection === 'function'
    && typeof value.resumeAuthorizedInjection === 'function'
    && typeof value.resolveRouteDependencies === 'function'
    && typeof value.rollbackAuthorizedInjection === 'function'
    && typeof value.reconcilePendingRollback === 'function'
    && typeof value.readState === 'function'
    && value.secrets_included === false);
}
