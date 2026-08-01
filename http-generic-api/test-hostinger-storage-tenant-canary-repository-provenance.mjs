#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createHostingerStorageTenantCanaryControlPlaneRepository,
  executeHostingerStorageTenantCanary,
} from './hostingerStorageTenantCanary.js';
import {
  createHostingerStorageControlPlaneRepository,
  createMemoryHostingerStoragePersistenceAdapter,
  isCanonicalHostingerStorageControlPlaneRepository,
} from './hostingerStorageControlPlaneRepository.js';

const directPersistence = createMemoryHostingerStoragePersistenceAdapter();
const directRepository = createHostingerStorageControlPlaneRepository({ adapter: directPersistence });
assert.equal(isCanonicalHostingerStorageControlPlaneRepository(directRepository), true);
assert.throws(
  () => executeHostingerStorageTenantCanary({ repository: directRepository }),
  (error) => error?.code === 'STORAGE_TENANT_CANARY_CONTROL_PLANE_INVALID'
    && error?.details?.repository_provenance === 'tenant_and_control_plane_factory_owned_required',
);

const tenantRepository = createHostingerStorageTenantCanaryControlPlaneRepository();
assert.equal(Object.isFrozen(tenantRepository), true);
assert.equal(isCanonicalHostingerStorageControlPlaneRepository(tenantRepository), true);
assert.throws(
  () => executeHostingerStorageTenantCanary({ repository: tenantRepository }),
  (error) => error?.code === 'STORAGE_TENANT_CANARY_EXECUTOR_ADAPTER_INVALID',
);

const copiedTenantRepository = Object.freeze({ ...tenantRepository });
assert.equal(isCanonicalHostingerStorageControlPlaneRepository(copiedTenantRepository), false);
assert.throws(
  () => executeHostingerStorageTenantCanary({ repository: copiedTenantRepository }),
  (error) => error?.code === 'STORAGE_TENANT_CANARY_CONTROL_PLANE_INVALID',
);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_tenant_canary_repository_provenance',
  direct_control_plane_repository_rejected: true,
  tenant_factory_repository_control_plane_canonical: true,
  copied_tenant_repository_rejected: true,
  validation_before_one_shot_consumption: true,
  production_ready: false,
  secrets_included: false,
}));
