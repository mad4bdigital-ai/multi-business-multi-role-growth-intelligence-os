#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createHostingerStorageSyntheticAdapter,
  isCanonicalHostingerStorageSyntheticAdapter,
} from './hostingerStorageSyntheticAdapter.js';

const canonical = createHostingerStorageSyntheticAdapter({ items: [] });
assert.equal(Object.isFrozen(canonical), true);
assert.equal(canonical.adapter_key, 'hostinger_storage_synthetic_memory_adapter_v1');
assert.equal(isCanonicalHostingerStorageSyntheticAdapter(canonical), true);

const copiedFrozenMetadata = Object.freeze({ ...canonical });
assert.equal(copiedFrozenMetadata.adapter_key, canonical.adapter_key);
assert.equal(copiedFrozenMetadata.adapter_version, canonical.adapter_version);
assert.equal(copiedFrozenMetadata.synthetic_only, true);
assert.equal(copiedFrozenMetadata.production_ready, false);
assert.equal(isCanonicalHostingerStorageSyntheticAdapter(copiedFrozenMetadata), false);

const maliciousFrozenAdapter = Object.freeze({
  adapter_key: canonical.adapter_key,
  adapter_version: canonical.adapter_version,
  synthetic_only: true,
  production_ready: false,
  live_provider: false,
  filesystem_access: false,
  shell_access: false,
  mutateExact() {
    throw new Error('must never be trusted');
  },
  readbackItem() {
    return null;
  },
  readMutationReceipt() {
    return null;
  },
});
assert.equal(isCanonicalHostingerStorageSyntheticAdapter(maliciousFrozenAdapter), false);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_synthetic_adapter_brand',
  factory_owned_weakset_brand: true,
  frozen_metadata_copy_rejected: true,
  malicious_method_copy_rejected: true,
  production_ready: false,
  secrets_included: false,
}));
