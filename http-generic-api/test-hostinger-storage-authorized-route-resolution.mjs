#!/usr/bin/env node
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';

import { bundle } from './test-hostinger-storage-authorized-mount-executor.mjs';
import {
  createHostingerStorageAuthorizedDependencyInjectionCoordinator,
} from './hostingerStorageAuthorizedDependencyInjection.js';
import { buildHostingerStorageTenantRoutes } from './routes/hostingerStorageTenantRoutes.js';

const INJECTION_ID = 'authorized-route-resolution-001';
const NOW = 1_786_000_300;

async function startApp(routeOptions) {
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
  app.use(buildHostingerStorageTenantRoutes(routeOptions));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

async function probe(routeOptions) {
  const app = await startApp(routeOptions);
  try {
    const response = await fetch(`${app.url}/tenant/storage-operations/apply-plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation_id: bundle.operation_id,
        expected_sha: bundle.expected_runtime_sha,
        capsule: { forbidden: true },
      }),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    app.server.close();
    await once(app.server, 'close');
  }
}

const unavailable = await probe({});
assert.equal(unavailable.status, 503);
assert.equal(unavailable.body.error.code, 'storage_tenant_runtime_unavailable');

const invalidCoordinator = await probe({
  tenantStorageRuntimeInjectionCoordinator: Object.freeze({}),
  expectedTenantStorageMountReadbackDigest: '0'.repeat(64),
});
assert.equal(invalidCoordinator.status, 503);
assert.equal(invalidCoordinator.body.error.code, 'storage_tenant_runtime_unavailable');

const coordinator = createHostingerStorageAuthorizedDependencyInjectionCoordinator();
const beforeInjection = await probe({
  tenantStorageRuntimeInjectionCoordinator: coordinator,
  expectedTenantStorageMountReadbackDigest: '0'.repeat(64),
});
assert.equal(beforeInjection.status, 503);
assert.equal(beforeInjection.body.error.code, 'storage_tenant_runtime_unavailable');

const receipt = coordinator.injectAuthorizedDependency({
  bundle,
  injection_id: INJECTION_ID,
  expected_mount_bundle_digest: bundle.mount_bundle_digest,
  expected_runtime_sha: bundle.expected_runtime_sha,
  expected_authorization_generation: bundle.authorization_generation,
  now_epoch: NOW,
});

const beforeReadback = await probe({
  tenantStorageRuntimeInjectionCoordinator: coordinator,
  expectedTenantStorageMountReadbackDigest: '0'.repeat(64),
});
assert.equal(beforeReadback.status, 503);
assert.equal(beforeReadback.body.error.code, 'storage_tenant_runtime_unavailable');

const readback = coordinator.readMountReadback({
  injection_id: INJECTION_ID,
  expected_injection_receipt_digest: receipt.injection_receipt_digest,
  expected_mount_bundle_digest: bundle.mount_bundle_digest,
});

const missingDigest = await probe({
  tenantStorageRuntimeInjectionCoordinator: coordinator,
});
assert.equal(missingDigest.status, 503);
assert.equal(missingDigest.body.error.code, 'storage_tenant_runtime_unavailable');

const wrongDigest = await probe({
  tenantStorageRuntimeInjectionCoordinator: coordinator,
  expectedTenantStorageMountReadbackDigest: 'f'.repeat(64),
});
assert.equal(wrongDigest.status, 503);
assert.equal(wrongDigest.body.error.code, 'storage_tenant_runtime_unavailable');

const verifiedRouteOptions = {
  tenantStorageRuntimeInjectionCoordinator: coordinator,
  expectedTenantStorageMountReadbackDigest: readback.mount_readback_digest,
};
const verified = await probe(verifiedRouteOptions);
assert.equal(verified.status, 400);
assert.equal(verified.body.error.code, 'storage_tenant_request_field_forbidden');

const directRuntimeFallback = await probe({
  tenantStorageRuntime: bundle.tenantStorageRuntime,
});
assert.equal(directRuntimeFallback.status, 400);
assert.equal(directRuntimeFallback.body.error.code, 'storage_tenant_request_field_forbidden');

const rollback = coordinator.rollbackAuthorizedInjection({
  injection_id: INJECTION_ID,
  expected_mount_readback_digest: readback.mount_readback_digest,
  rollback_reason_code: 'route_resolution_test_complete',
  now_epoch: NOW + 1,
});
assert.equal(rollback.fail_closed_route_restored, true);

const afterRollback = await probe(verifiedRouteOptions);
assert.equal(afterRollback.status, 503);
assert.equal(afterRollback.body.error.code, 'storage_tenant_runtime_unavailable');
assert.equal(coordinator.readState().active, false);
assert.equal(coordinator.readState().route_dependencies_available, false);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_authorized_route_resolution',
  exact_mount_readback_digest: readback.mount_readback_digest,
  canonical_coordinator_required: true,
  route_fail_closed_before_injection: true,
  route_fail_closed_before_readback: true,
  missing_or_wrong_digest_fail_closed: true,
  exact_readback_reaches_bounded_request_validator: true,
  direct_runtime_fallback_preserved: true,
  rollback_restores_http_503: true,
  server_bootstrap_modified: false,
  route_registry_modified: false,
  worker_mounted: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}, null, 2));
