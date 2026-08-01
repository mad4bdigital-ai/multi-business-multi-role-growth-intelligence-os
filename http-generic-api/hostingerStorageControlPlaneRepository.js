import {
  HOSTINGER_STORAGE_CONTROL_PLANE_REPOSITORY_VERSION,
  createMemoryHostingerStoragePersistenceAdapter as createBaseMemoryHostingerStoragePersistenceAdapter,
  createHostingerStorageControlPlaneRepository as createBaseHostingerStorageControlPlaneRepository,
} from './hostingerStorageControlPlaneRepositoryBase.js';
import {
  HOSTINGER_STORAGE_SQL_PERSISTENCE_ADAPTER_VERSION,
  createMySqlHostingerStoragePersistenceAdapter as createBaseMySqlHostingerStoragePersistenceAdapter,
} from './hostingerStorageSqlPersistenceAdapter.js';

const canonicalPersistenceAdapters = new WeakSet();
const canonicalSqlPersistenceAdapters = new WeakSet();
const canonicalRepositories = new WeakSet();

export {
  HOSTINGER_STORAGE_CONTROL_PLANE_REPOSITORY_VERSION,
  HOSTINGER_STORAGE_SQL_PERSISTENCE_ADAPTER_VERSION,
};

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

export function createMySqlHostingerStoragePersistenceAdapter(options = {}) {
  const adapter = createBaseMySqlHostingerStoragePersistenceAdapter(options);
  canonicalSqlPersistenceAdapters.add(adapter);
  return adapter;
}

export function isCanonicalMySqlHostingerStoragePersistenceAdapter(adapter) {
  return Boolean(
    adapter
    && canonicalSqlPersistenceAdapters.has(adapter)
    && Object.isFrozen(adapter)
    && adapter.adapter_version === HOSTINGER_STORAGE_SQL_PERSISTENCE_ADAPTER_VERSION
    && adapter.adapter_key === 'hostinger_storage_mysql_control_plane_v1'
    && adapter.durable_sql === true
    && typeof adapter.schema_verified === 'boolean'
    && adapter.production_ready === adapter.schema_verified
    && typeof adapter.transaction === 'function'
    && typeof adapter.read === 'function'
    && typeof adapter.export_snapshot === 'function'
  );
}

export function createHostingerStorageControlPlaneRepository(options = {}) {
  const adapter = options?.adapter;
  const repository = createBaseHostingerStorageControlPlaneRepository({ adapter });
  if (
    isCanonicalMemoryHostingerStoragePersistenceAdapter(adapter)
    || isCanonicalMySqlHostingerStoragePersistenceAdapter(adapter)
  ) {
    canonicalRepositories.add(repository);
  }
  return repository;
}

export function isCanonicalHostingerStorageControlPlaneRepository(repository) {
  const adapterKeyAllowed = [
    'hostinger_storage_memory_test_adapter_v1',
    'hostinger_storage_mysql_control_plane_v1',
  ].includes(repository?.adapter_key);
  return Boolean(
    repository
    && canonicalRepositories.has(repository)
    && Object.isFrozen(repository)
    && repository.repository_version === HOSTINGER_STORAGE_CONTROL_PLANE_REPOSITORY_VERSION
    && adapterKeyAllowed
    && typeof repository.production_ready === 'boolean'
    && typeof repository.readAggregate === 'function'
    && typeof repository.transitionOperation === 'function'
    && typeof repository.consumePlan === 'function'
    && typeof repository.appendJournalEvent === 'function'
    && typeof repository.recordReconciliation === 'function'
  );
}
