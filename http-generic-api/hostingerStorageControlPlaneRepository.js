import {
  HOSTINGER_STORAGE_CONTROL_PLANE_REPOSITORY_VERSION,
  createMemoryHostingerStoragePersistenceAdapter,
  createHostingerStorageControlPlaneRepository as createBaseHostingerStorageControlPlaneRepository,
} from './hostingerStorageControlPlaneRepositoryBase.js';

const canonicalRepositories = new WeakSet();

export {
  HOSTINGER_STORAGE_CONTROL_PLANE_REPOSITORY_VERSION,
  createMemoryHostingerStoragePersistenceAdapter,
};

export function createHostingerStorageControlPlaneRepository(options = {}) {
  const repository = createBaseHostingerStorageControlPlaneRepository(options);
  canonicalRepositories.add(repository);
  return repository;
}

export function isCanonicalHostingerStorageControlPlaneRepository(repository) {
  return Boolean(
    repository
    && canonicalRepositories.has(repository)
    && Object.isFrozen(repository)
    && repository.repository_version === HOSTINGER_STORAGE_CONTROL_PLANE_REPOSITORY_VERSION
    && repository.production_ready === false
    && typeof repository.readAggregate === 'function'
    && typeof repository.transitionOperation === 'function'
    && typeof repository.consumePlan === 'function'
    && typeof repository.appendJournalEvent === 'function'
    && typeof repository.recordReconciliation === 'function'
  );
}
