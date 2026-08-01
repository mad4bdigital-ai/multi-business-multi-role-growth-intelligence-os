#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createMemoryHostingerStoragePersistenceAdapter,
  createHostingerStorageControlPlaneRepository,
  isCanonicalHostingerStorageControlPlaneRepository,
} from './hostingerStorageControlPlaneRepository.js';

const adapter = createMemoryHostingerStoragePersistenceAdapter();
const repository = createHostingerStorageControlPlaneRepository({ adapter });
assert.equal(Object.isFrozen(repository), true);
assert.equal(isCanonicalHostingerStorageControlPlaneRepository(repository), true);

const copiedRepository = Object.freeze({ ...repository });
assert.equal(copiedRepository.repository_version, repository.repository_version);
assert.equal(isCanonicalHostingerStorageControlPlaneRepository(copiedRepository), false);

const maliciousRepository = Object.freeze({
  repository_version: repository.repository_version,
  production_ready: false,
  readAggregate() { return null; },
  transitionOperation() { throw new Error('must never be trusted'); },
  consumePlan() { throw new Error('must never be trusted'); },
  appendJournalEvent() { throw new Error('must never be trusted'); },
  recordReconciliation() { throw new Error('must never be trusted'); },
});
assert.equal(isCanonicalHostingerStorageControlPlaneRepository(maliciousRepository), false);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_control_plane_repository_brand',
  factory_owned_weakset_brand: true,
  frozen_repository_copy_rejected: true,
  malicious_repository_rejected: true,
  production_ready: false,
  secrets_included: false,
}));
