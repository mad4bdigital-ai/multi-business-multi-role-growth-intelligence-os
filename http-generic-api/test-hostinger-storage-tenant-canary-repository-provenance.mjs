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
  (error) => error?.status === 409
    && error?.code === 'STORAGE_TENANT_CANARY_CONTROL_PLANE_INVALID'
    && error?.details?.repository_provenance === 'tenant_and_control_plane_factory_owned_required'
    && error?.details?.expected_repository_version === 'spec014-storage-control-plane-repository-v1'
    && error?.details?.expected_adapter_key === 'hostinger_storage_memory_test_adapter_v1',
);

const tenantRepository = createHostingerStorageTenantCanaryControlPlaneRepository();
assert.notEqual(tenantRepository, directRepository);
assert.equal(Object.isFrozen(tenantRepository), true);
assert.equal(tenantRepository.repository_version, 'spec014-storage-control-plane-repository-v1');
assert.equal(tenantRepository.adapter_key, 'hostinger_storage_memory_test_adapter_v1');
assert.equal(tenantRepository.production_ready, false);
assert.equal(isCanonicalHostingerStorageControlPlaneRepository(tenantRepository), true);
assert.throws(
  () => executeHostingerStorageTenantCanary({ repository: tenantRepository }),
  (error) => error?.status === 409
    && error?.code === 'STORAGE_TENANT_CANARY_EXECUTOR_ADAPTER_INVALID',
);

const copiedTenantRepository = Object.freeze({ ...tenantRepository });
assert.equal(isCanonicalHostingerStorageControlPlaneRepository(copiedTenantRepository), false);
assert.throws(
  () => executeHostingerStorageTenantCanary({ repository: copiedTenantRepository }),
  (error) => error?.status === 409
    && error?.code === 'STORAGE_TENANT_CANARY_CONTROL_PLANE_INVALID'
    && error?.details?.repository_provenance === 'tenant_and_control_plane_factory_owned_required',
);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_tenant_canary_repository_provenance',
  direct_control_plane_repository_rejected: true,
  tenant_factory_repository_control_plane_canonical: true,
  repository_identity_metadata_pinned: true,
  copied_tenant_repository_rejected: true,
  validation_before_one_shot_consumption: true,
  production_ready: false,
  secrets_included: false,
}));
