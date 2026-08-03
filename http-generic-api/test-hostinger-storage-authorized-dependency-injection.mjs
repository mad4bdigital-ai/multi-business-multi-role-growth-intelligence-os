#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';

import { bundle } from './test-hostinger-storage-authorized-mount-executor.mjs';
import {
  createHostingerStorageAuthorizedDependencyInjectionCoordinator,
  isCanonicalHostingerStorageAuthorizedDependencyInjectionCoordinator,
} from './hostingerStorageAuthorizedDependencyInjection.js';
import { buildHostingerStorageTenantRoutes } from './routes/hostingerStorageTenantRoutes.js';

const INJECTION_ID = 'authorized-injection-001';
const NOW = 1_786_000_100;
const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : (!value || typeof value !== 'object'
      ? value
      : Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])));
const digest = (value) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const rehash = (value, digestField) => {
  const copy = structuredClone(value);
  delete copy[digestField];
  copy[digestField] = digest(copy);
  return copy;
};

async function startApp(routeDependencies) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      mode: 'user_jwt',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      is_admin: false,
    };
    next();
  });
  app.use(buildHostingerStorageTenantRoutes(routeDependencies));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function postProbe(url) {
  const response = await fetch(`${url}/tenant/storage-operations/apply-plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation_id: bundle.operation_id,
      expected_sha: bundle.expected_runtime_sha,
      capsule: { forbidden: true },
    }),
  });
  return { status: response.status, body: await response.json() };
}

async function probeRoute(routeDependencies) {
  const app = await startApp(routeDependencies);
  try {
    return await postProbe(app.url);
  } finally {
    app.server.close();
    await once(app.server, 'close');
  }
}

const coordinator = createHostingerStorageAuthorizedDependencyInjectionCoordinator();
assert.equal(isCanonicalHostingerStorageAuthorizedDependencyInjectionCoordinator(coordinator), true);
assert.equal(coordinator.requires_canonical_authorized_mount_bundle, true);
assert.equal(coordinator.requires_exact_readback_before_route_resolution, true);
assert.equal(coordinator.rollback_restores_fail_closed_route, true);
assert.equal(coordinator.live_server_modified, false);
assert.equal(coordinator.live_route_registration_performed, false);
assert.equal(coordinator.provider_dispatch_allowed, false);
assert.equal(coordinator.production_ready, false);

assert.throws(
  () => createHostingerStorageAuthorizedDependencyInjectionCoordinator({ override: true }),
  (error) => error.code === 'STORAGE_AUTHORIZED_INJECTION_OVERRIDE_FORBIDDEN',
);

const preInjectionDependencies = coordinator.resolveRouteDependencies({
  expected_mount_readback_digest: '0'.repeat(64),
});
assert.equal(Object.isFrozen(preInjectionDependencies), true);
assert.equal('tenantStorageRuntime' in preInjectionDependencies, false);
const preInjectionRoute = await probeRoute(preInjectionDependencies);
assert.equal(preInjectionRoute.status, 503);
assert.equal(preInjectionRoute.body.error.code, 'storage_tenant_runtime_unavailable');

const invalidDigestDependencies = coordinator.resolveRouteDependencies({
  expected_mount_readback_digest: 'not-a-sha256-digest',
});
assert.equal(Object.isFrozen(invalidDigestDependencies), true);
assert.equal('tenantStorageRuntime' in invalidDigestDependencies, false);

const missingDigestDependencies = coordinator.resolveRouteDependencies({});
assert.equal(Object.isFrozen(missingDigestDependencies), true);
assert.equal('tenantStorageRuntime' in missingDigestDependencies, false);

const unsafeCoordinator = createHostingerStorageAuthorizedDependencyInjectionCoordinator();
assert.throws(
  () => unsafeCoordinator.injectAuthorizedDependency({
    bundle,
    injection_id: 'unsafe-injection',
    expected_mount_bundle_digest: bundle.mount_bundle_digest,
    expected_runtime_sha: bundle.expected_runtime_sha,
    expected_authorization_generation: bundle.authorization_generation,
    now_epoch: NOW,
    api_key: 'forbidden',
  }),
  (error) => error.code === 'STORAGE_AUTHORIZED_INJECTION_FIELD_FORBIDDEN',
);
assert.throws(
  () => unsafeCoordinator.injectAuthorizedDependency({
    bundle: Object.freeze({ ...bundle }),
    injection_id: 'fake-bundle-injection',
    expected_mount_bundle_digest: bundle.mount_bundle_digest,
    expected_runtime_sha: bundle.expected_runtime_sha,
    expected_authorization_generation: bundle.authorization_generation,
    now_epoch: NOW,
  }),
  (error) => error.code === 'STORAGE_AUTHORIZED_INJECTION_BUNDLE_INVALID',
);

const receipt = coordinator.injectAuthorizedDependency({
  bundle,
  injection_id: INJECTION_ID,
  expected_mount_bundle_digest: bundle.mount_bundle_digest,
  expected_runtime_sha: bundle.expected_runtime_sha,
  expected_authorization_generation: bundle.authorization_generation,
  now_epoch: NOW,
});
assert.equal(receipt.dependency_injected, true);
assert.equal(receipt.mount_performed, true);
assert.equal(receipt.runtime_mounted, true);
assert.equal(receipt.route_mounted, true);
assert.equal(receipt.worker_mounted, false);
assert.equal(receipt.live_server_modified, false);
assert.equal(receipt.live_route_registration_performed, false);
assert.equal(receipt.provider_dispatch_allowed, false);
assert.equal(receipt.production_ready, false);
assert.equal(receipt.automatic_retry_allowed, false);
assert.equal(receipt.reconciliation_state, 'dependency_injected_pending_exact_readback');

const beforeReadbackDependencies = coordinator.resolveRouteDependencies({
  expected_mount_readback_digest: '0'.repeat(64),
});
assert.equal('tenantStorageRuntime' in beforeReadbackDependencies, false);
const beforeReadbackRoute = await probeRoute(beforeReadbackDependencies);
assert.equal(beforeReadbackRoute.status, 503);

assert.throws(
  () => coordinator.injectAuthorizedDependency({
    bundle,
    injection_id: 'replay-injection',
    expected_mount_bundle_digest: bundle.mount_bundle_digest,
    expected_runtime_sha: bundle.expected_runtime_sha,
    expected_authorization_generation: bundle.authorization_generation,
    now_epoch: NOW + 1,
  }),
  (error) => error.code === 'STORAGE_AUTHORIZED_INJECTION_ACTIVE_SLOT_OCCUPIED',
);

const readback = coordinator.readMountReadback({
  injection_id: INJECTION_ID,
  expected_injection_receipt_digest: receipt.injection_receipt_digest,
  expected_mount_bundle_digest: bundle.mount_bundle_digest,
});
assert.equal(readback.readback_verified, true);
assert.equal(readback.dependency_descriptor_verified, true);
assert.equal(readback.exact_runtime_object_identity, true);
assert.equal(readback.route_dependency_snapshot_frozen, true);
assert.equal(readback.runtime_identity_verified, true);
assert.equal(readback.dependency_injected, true);
assert.equal(readback.runtime_mounted, true);
assert.equal(readback.route_mounted, true);
assert.equal(readback.live_server_modified, false);
assert.equal(readback.live_route_registration_performed, false);
assert.equal(readback.provider_dispatch_allowed, false);
assert.equal(readback.production_ready, false);

const mismatchedDependencies = coordinator.resolveRouteDependencies({
  expected_mount_readback_digest: 'f'.repeat(64),
});
assert.equal('tenantStorageRuntime' in mismatchedDependencies, false);

const routeDependencies = coordinator.resolveRouteDependencies({
  expected_mount_readback_digest: readback.mount_readback_digest,
});
const descriptor = Object.getOwnPropertyDescriptor(routeDependencies, 'tenantStorageRuntime');
assert.equal(Object.isFrozen(routeDependencies), true);
assert.equal(descriptor.enumerable, false);
assert.equal(descriptor.configurable, false);
assert.equal(descriptor.writable, false);
assert.equal(descriptor.value, bundle.tenantStorageRuntime);
const mountedRoute = await probeRoute(routeDependencies);
assert.equal(mountedRoute.status, 400);
assert.equal(mountedRoute.body.error.code, 'storage_tenant_request_field_forbidden');

const persistedReceipt = JSON.parse(JSON.stringify(receipt));
const persistedReadback = JSON.parse(JSON.stringify(readback));
const tamperedSnapshotDigest = 'e'.repeat(64);
const tamperedReceipt = rehash({
  ...persistedReceipt,
  route_dependency_snapshot_digest: tamperedSnapshotDigest,
}, 'injection_receipt_digest');
const tamperedReadback = rehash({
  ...persistedReadback,
  injection_receipt_digest: tamperedReceipt.injection_receipt_digest,
  route_dependency_snapshot_digest: tamperedSnapshotDigest,
}, 'mount_readback_digest');
const tamperedCoordinator = createHostingerStorageAuthorizedDependencyInjectionCoordinator();
assert.throws(
  () => tamperedCoordinator.resumeAuthorizedInjection({
    bundle,
    injection_receipt: tamperedReceipt,
    mount_readback: tamperedReadback,
  }),
  (error) => error.code === 'STORAGE_AUTHORIZED_INJECTION_RESUME_BINDING_MISMATCH'
    && error.details.mismatches.includes('receipt.route_dependency_snapshot_digest'),
);
assert.equal(tamperedCoordinator.readState().active, false);

const resumedCoordinator = createHostingerStorageAuthorizedDependencyInjectionCoordinator();
const resumed = resumedCoordinator.resumeAuthorizedInjection({
  bundle,
  injection_receipt: persistedReceipt,
  mount_readback: persistedReadback,
});
assert.equal(resumed.mount_readback_digest, readback.mount_readback_digest);
assert.equal(resumedCoordinator.readState().readback_verified, true);
const resumedDependencies = resumedCoordinator.resolveRouteDependencies({
  expected_mount_readback_digest: resumed.mount_readback_digest,
});
assert.equal(Object.getOwnPropertyDescriptor(resumedDependencies, 'tenantStorageRuntime').value, bundle.tenantStorageRuntime);
const resumedRoute = await probeRoute(resumedDependencies);
assert.equal(resumedRoute.status, 400);
assert.equal(resumedRoute.body.error.code, 'storage_tenant_request_field_forbidden');

const rollback = coordinator.rollbackAuthorizedInjection({
  injection_id: INJECTION_ID,
  expected_mount_readback_digest: readback.mount_readback_digest,
  rollback_reason_code: 'verification_window_closed',
  now_epoch: NOW + 10,
});
assert.equal(rollback.dependency_injected, false);
assert.equal(rollback.mount_performed, false);
assert.equal(rollback.runtime_mounted, false);
assert.equal(rollback.route_mounted, false);
assert.equal(rollback.worker_mounted, false);
assert.equal(rollback.fail_closed_route_restored, true);
assert.equal(rollback.live_server_modified, false);
assert.equal(rollback.provider_dispatch_allowed, false);
assert.equal(rollback.production_ready, false);
assert.equal(rollback.automatic_retry_allowed, false);

const rolledBackDependencies = coordinator.resolveRouteDependencies({
  expected_mount_readback_digest: readback.mount_readback_digest,
});
assert.equal('tenantStorageRuntime' in rolledBackDependencies, false);
const rolledBackRoute = await probeRoute(rolledBackDependencies);
assert.equal(rolledBackRoute.status, 503);
assert.equal(rolledBackRoute.body.error.code, 'storage_tenant_runtime_unavailable');
assert.equal(coordinator.readState().active, false);
assert.equal(coordinator.readState().route_dependencies_available, false);
assert.equal(coordinator.readState().rollback_receipt_digest, rollback.rollback_receipt_digest);

assert.throws(
  () => coordinator.rollbackAuthorizedInjection({
    injection_id: INJECTION_ID,
    expected_mount_readback_digest: readback.mount_readback_digest,
    rollback_reason_code: 'rollback_replay',
    now_epoch: NOW + 11,
  }),
  (error) => error.code === 'STORAGE_AUTHORIZED_INJECTION_ROLLBACK_BINDING_MISMATCH',
);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_authorized_dependency_injection_readback',
  mount_bundle_digest: bundle.mount_bundle_digest,
  injection_receipt_digest: receipt.injection_receipt_digest,
  mount_readback_digest: readback.mount_readback_digest,
  rollback_receipt_digest: rollback.rollback_receipt_digest,
  exact_runtime_object_identity: true,
  route_fail_closed_before_readback: true,
  route_available_after_exact_readback: true,
  restart_reconstruction_without_second_consumption: true,
  rehashed_persisted_snapshot_tampering_rejected: true,
  rollback_restores_http_503: true,
  invalid_or_missing_readback_digest_fail_closed: true,
  live_server_modified: false,
  live_route_registration_performed: false,
  worker_mounted: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  automatic_retry_allowed: false,
  secrets_included: false,
}, null, 2));
