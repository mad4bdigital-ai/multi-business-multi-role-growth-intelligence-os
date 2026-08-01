import {
  HOSTINGER_STORAGE_CONTROL_PLANE_REPOSITORY_VERSION,
  createMemoryHostingerStoragePersistenceAdapter as createBaseMemoryHostingerStoragePersistenceAdapter,
  createHostingerStorageControlPlaneRepository as createBaseHostingerStorageControlPlaneRepository,
} from './hostingerStorageControlPlaneRepositoryBase.js';

const canonicalPersistenceAdapters = new WeakSet();
const canonicalRepositories = new WeakSet();

export { HOSTINGER_STORAGE_CONTROL_PLANE_REPOSITORY_VERSION };

export function createMemoryHostingerStoragePersistenceAdapter(options = {}) {
  const adapter = createBaseMemoryHostingerStoragePersistenceAdapter(options);
  canonicalPersistenceAdapters.add(adapter);
  return adapter;
}

export function isCanonicalMemoryHostingerStoragePersistenceAdapter(adapter) {
  return Boolean(
    adapter
    && canonicalPersistenceAdapters.has(adapter)
    && Object.isFrozen(adapter)
    && adapter.adapter_key === 'hostinger_storage_memory_test_adapter_v1'
    && adapter.production_ready === false
    && typeof adapter.transaction === 'function'
    && typeof adapter.read === 'function'
    && typeof adapter.export_snapshot === 'function'
  );
}

export function createHostingerStorageControlPlaneRepository(options = {}) {
  const adapter = options?.adapter;
  const repository = createBaseHostingerStorageControlPlaneRepository({ adapter });
  if (isCanonicalMemoryHostingerStoragePersistenceAdapter(adapter)) {
    canonicalRepositories.add(repository);
  }
  return repository;
}

export function isCanonicalHostingerStorageControlPlaneRepository(repository) {
  return Boolean(
    repository
    && canonicalRepositories.has(repository)
    && Object.isFrozen(repository)
    && repository.repository_version === HOSTINGER_STORAGE_CONTROL_PLANE_REPOSITORY_VERSION
    && repository.adapter_key === 'hostinger_storage_memory_test_adapter_v1'
    && repository.production_ready === false
    && typeof repository.readAggregate === 'function'
    && typeof repository.transitionOperation === 'function'
    && typeof repository.consumePlan === 'function'
    && typeof repository.appendJournalEvent === 'function'
    && typeof repository.recordReconciliation === 'function'
  );
}
