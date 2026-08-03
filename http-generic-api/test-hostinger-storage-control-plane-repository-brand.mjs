#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createMemoryHostingerStoragePersistenceAdapter,
  createHostingerStorageControlPlaneRepository,
  isCanonicalMemoryHostingerStoragePersistenceAdapter,
  isCanonicalHostingerStorageControlPlaneRepository,
} from './hostingerStorageControlPlaneRepository.js';

const adapter = createMemoryHostingerStoragePersistenceAdapter();
assert.equal(Object.isFrozen(adapter), true);
assert.equal(isCanonicalMemoryHostingerStoragePersistenceAdapter(adapter), true);

const repository = createHostingerStorageControlPlaneRepository({ adapter });
assert.equal(Object.isFrozen(repository), true);
assert.equal(isCanonicalHostingerStorageControlPlaneRepository(repository), true);

const copiedAdapter = Object.freeze({ ...adapter });
assert.equal(isCanonicalMemoryHostingerStoragePersistenceAdapter(copiedAdapter), false);

const copiedRepository = Object.freeze({ ...repository });
assert.equal(copiedRepository.repository_version, repository.repository_version);
assert.equal(isCanonicalHostingerStorageControlPlaneRepository(copiedRepository), false);

const maliciousRepository = Object.freeze({
  repository_version: repository.repository_version,
  adapter_key: 'hostinger_storage_memory_test_adapter_v1',
  production_ready: false,
  readAggregate() { return null; },
  transitionOperation() { throw new Error('must never be trusted'); },
  consumePlan() { throw new Error('must never be trusted'); },
  appendJournalEvent() { throw new Error('must never be trusted'); },
  recordReconciliation() { throw new Error('must never be trusted'); },
});
assert.equal(isCanonicalHostingerStorageControlPlaneRepository(maliciousRepository), false);

const forgedPersistenceAdapter = Object.freeze({
  adapter_key: 'hostinger_storage_memory_test_adapter_v1',
  production_ready: false,
  transaction(work) { return work({}, 0); },
  read(reader) { return reader({}, 0); },
  export_snapshot() { return {}; },
});
assert.equal(isCanonicalMemoryHostingerStoragePersistenceAdapter(forgedPersistenceAdapter), false);
const repositoryFromForgedPersistence = createHostingerStorageControlPlaneRepository({
  adapter: forgedPersistenceAdapter,
});
assert.equal(Object.isFrozen(repositoryFromForgedPersistence), true);
assert.equal(isCanonicalHostingerStorageControlPlaneRepository(repositoryFromForgedPersistence), false);

let adapterReads = 0;
const accessorOptions = {};
Object.defineProperty(accessorOptions, 'adapter', {
  enumerable: true,
  get() {
    adapterReads += 1;
    return adapterReads === 1 ? forgedPersistenceAdapter : adapter;
  },
});
const repositoryFromChangingAccessor = createHostingerStorageControlPlaneRepository(accessorOptions);
assert.equal(adapterReads, 1);
assert.equal(Object.isFrozen(repositoryFromChangingAccessor), true);
assert.equal(isCanonicalHostingerStorageControlPlaneRepository(repositoryFromChangingAccessor), false);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_control_plane_repository_brand',
  factory_owned_persistence_weakset_brand: true,
  factory_owned_repository_weakset_brand: true,
  frozen_persistence_copy_rejected: true,
  frozen_repository_copy_rejected: true,
  malicious_repository_rejected: true,
  repository_from_forged_persistence_rejected: true,
  adapter_read_once_before_branding: true,
  changing_accessor_repository_rejected: true,
  production_ready: false,
  secrets_included: false,
}));
