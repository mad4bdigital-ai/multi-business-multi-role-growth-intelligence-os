#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildHostingerStorageReserveReleaseIntent,
  executeHostingerStorageSyntheticReserveRelease,
  createHostingerStorageSyntheticReserveAdapter,
} from './hostingerStorageReserveReleaseProtocol.js';

const digestText = (value) => createHash('sha256').update(value).digest('hex');
const fingerprint = {
  size_bytes: 64 * 1024 * 1024,
  device: 7,
  inode: 1001,
  ctime_epoch: 900,
  mtime_epoch: 900,
  file_type: 'regular',
};
const built = buildHostingerStorageReserveReleaseIntent({
  operation_id: 'reserve-operation-1',
  target_id: 'target-1',
  reserve_ref: 'reserves/emergency-1',
  reserve_fingerprint: fingerprint,
  active_incident_id: 'incident-1',
  authority_context_hash: 'a'.repeat(64),
  capability_envelope_id: 'capability-envelope-1',
  execution_lease_id: 'lease-1',
  typed_confirmation_digest: digestText('RELEASE EXACT RESERVE'),
});
assert.equal(built.intent.no_allocation_before_unlink, true);
assert.equal(built.intent.no_lock_creation_before_unlink, true);
assert.equal(built.intent.no_journal_creation_before_unlink, true);
assert.equal(built.intent.no_temp_file_before_unlink, true);
assert.equal(built.intent.exact_unlink_only, true);
assert.equal(built.dispatch_allowed, false);

const adapter = createHostingerStorageSyntheticReserveAdapter({
  reserve: {
    reserve_ref: 'reserves/emergency-1',
    fingerprint,
    exists: true,
  },
});
const released = executeHostingerStorageSyntheticReserveRelease({
  intent: built.intent,
  expected_intent_digest: built.intent_digest,
  adapter,
});
assert.equal(released.released, true);
assert.equal(released.evidence.released_bytes, fingerprint.size_bytes);
assert.equal(released.evidence.allocation_operations_before_unlink, 0);
assert.equal(released.evidence.first_adapter_operation, 'exact_unlink_reserve');
assert.equal(released.persistence_after_unlink_required, true);
assert.equal(released.dispatch_allowed, false);
const state = adapter.exportState();
assert.equal(state.current.exists, false);
assert.deepEqual(state.calls, ['exact_unlink_reserve']);
assert.equal(state.allocation_operations, 0);

const tamperedIntent = structuredClone(built.intent);
tamperedIntent.reserve_fingerprint.inode = 2002;
assert.throws(
  () => executeHostingerStorageSyntheticReserveRelease({
    intent: tamperedIntent,
    expected_intent_digest: built.intent_digest,
    adapter: createHostingerStorageSyntheticReserveAdapter({ reserve: { reserve_ref: 'reserves/emergency-1', fingerprint, exists: true } }),
  }),
  (error) => error.code === 'STORAGE_RESERVE_INTENT_TAMPERED',
);

const allocatingAdapter = {
  synthetic_only: true,
  production_ready: false,
  allocation_operations: 1,
  exactUnlinkReserve() {
    return { released: true, released_bytes: fingerprint.size_bytes, allocation_operations_before_unlink: 1, first_adapter_operation: 'mkdir_lock' };
  },
};
assert.throws(
  () => executeHostingerStorageSyntheticReserveRelease({
    intent: built.intent,
    expected_intent_digest: built.intent_digest,
    adapter: allocatingAdapter,
  }),
  (error) => error.code === 'STORAGE_RESERVE_ADAPTER_INVALID',
);

const wrongFingerprintAdapter = createHostingerStorageSyntheticReserveAdapter({
  reserve: {
    reserve_ref: 'reserves/emergency-1',
    fingerprint: { ...fingerprint, inode: 9999 },
    exists: true,
  },
});
assert.throws(
  () => executeHostingerStorageSyntheticReserveRelease({
    intent: built.intent,
    expected_intent_digest: built.intent_digest,
    adapter: wrongFingerprintAdapter,
  }),
  (error) => error.code === 'STORAGE_RESERVE_FINGERPRINT_MISMATCH',
);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_reserve_release',
  exact_unlink_first: true,
  pre_unlink_allocation_count: 0,
  lock_creation_before_unlink: false,
  journal_creation_before_unlink: false,
  temp_file_before_unlink: false,
  live_provider_mutated: false,
  dispatch_allowed: false,
  secrets_included: false,
}));
