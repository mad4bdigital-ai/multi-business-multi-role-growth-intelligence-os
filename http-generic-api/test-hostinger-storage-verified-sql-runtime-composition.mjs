#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION,
  createHostingerStorageVerifiedSqlRuntimeComposition,
  isCanonicalHostingerStorageVerifiedSqlRuntimeComposition,
} from './hostingerStorageVerifiedSqlRuntimeComposition.js';

const h = (character) => character.repeat(64);
let connectionCalls = 0;
const pool = Object.freeze({
  getConnection() {
    connectionCalls += 1;
    throw new Error('Factory construction must not access the database.');
  },
});

function schemaVerification(overrides = {}) {
  const base = {
    ready: true,
    schema_verified: true,
    blockers: [],
    production_ready: false,
    authority_granted: false,
    migration_apply_authorized: false,
    provider_dispatch_allowed: false,
    evidence_digest: h('a'),
    evidence: {
      source_commit: h('1'),
      deployed_runtime_sha: h('1'),
      runtime_parity: true,
      readback_cycle_id: 'verified-sql-composition-cycle-1',
      readback_digest: h('b'),
      migration_evidence_digest: h('c'),
      database_fingerprint: h('d'),
      verified_at: '2099-01-01T00:00:00.000Z',
      expires_at: '2099-01-01T00:15:00.000Z',
    },
    secrets_included: false,
  };
  return {
    ...base,
    ...overrides,
    evidence: {
      ...base.evidence,
      ...(overrides.evidence || {}),
    },
  };
}

const composition = createHostingerStorageVerifiedSqlRuntimeComposition({
  pool,
  schema_verification: schemaVerification(),
  lock_timeout_seconds: 5,
});

assert.equal(connectionCalls, 0);
assert.equal(composition.composition_version, HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION);
assert.equal(isCanonicalHostingerStorageVerifiedSqlRuntimeComposition(composition), true);
assert.equal(Object.isFrozen(composition), true);
assert.equal(Object.isFrozen(composition.schema_provenance), true);
assert.equal(Object.isFrozen(composition.component_versions), true);
assert.equal(Object.isFrozen(composition.control_plane), true);
assert.equal(Object.isFrozen(composition.execution_parents), true);
assert.equal(Object.isFrozen(composition.child_evidence), true);
assert.equal(composition.schema_verified, true);
assert.equal(composition.schema_provenance.evidence_digest, h('a'));
assert.equal(composition.schema_provenance.database_fingerprint, h('d'));
assert.equal(composition.schema_provenance.source_commit, h('1'));
assert.equal(composition.schema_provenance.deployed_runtime_sha, h('1'));
assert.equal(composition.component_versions.run_reader, 'spec014-hostinger-storage-sql-run-reader-v1');

assert.deepEqual(Object.keys(composition.control_plane).sort(), [
  'acquireLease',
  'appendApproval',
  'consumePlan',
  'createOperation',
  'exportSnapshot',
  'invalidateApprovals',
  'persistImmutablePlan',
  'readAggregate',
  'releaseLease',
  'renewLease',
  'transitionOperation',
]);
assert.deepEqual(Object.keys(composition.execution_parents).sort(), [
  'finalizeRun',
  'readRun',
  'registerPlanItems',
  'startRun',
]);
assert.deepEqual(Object.keys(composition.child_evidence).sort(), [
  'appendJournalEvent',
  'appendReconciliation',
]);

assert.equal(composition.control_plane.appendJournalEvent, undefined);
assert.equal(composition.control_plane.recordReconciliation, undefined);
assert.equal(composition.execution_parents.appendJournalEvent, undefined);
assert.equal(composition.child_evidence.recordReconciliation, undefined);
assert.equal('pool' in composition, false);
assert.equal('adapter' in composition, false);
assert.equal('repository' in composition, false);
assert.equal('parent_writer' in composition, false);
assert.equal('child_writer' in composition, false);
assert.equal('run_reader' in composition, false);
assert.equal('schema_verification' in composition, false);

for (const [field, expected] of Object.entries({
  raw_components_exposed: false,
  legacy_child_write_paths_exposed: false,
  duplicate_write_paths_allowed: false,
  runtime_mounted: false,
  route_mounted: false,
  worker_mounted: false,
  live_database_access_performed_by_factory: false,
  foreign_keys_enabled: false,
  migration_apply_authorized: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
})) assert.equal(composition[field], expected, field);

assert.throws(() => createHostingerStorageVerifiedSqlRuntimeComposition({
  pool,
  schema_verification: schemaVerification(),
  repository: {},
}), (error) => error.code === 'STORAGE_VERIFIED_SQL_COMPOSITION_COMPONENT_OVERRIDE_FORBIDDEN');

assert.throws(() => createHostingerStorageVerifiedSqlRuntimeComposition({
  pool,
  schema_verification: schemaVerification({ ready: false }),
}), (error) => error.code === 'STORAGE_VERIFIED_SQL_COMPOSITION_SCHEMA_VERIFICATION_REQUIRED');

assert.throws(() => createHostingerStorageVerifiedSqlRuntimeComposition({
  pool,
  schema_verification: schemaVerification({ evidence: { deployed_runtime_sha: h('2') } }),
}), (error) => error.code === 'STORAGE_VERIFIED_SQL_COMPOSITION_RUNTIME_PARITY_REQUIRED');

assert.throws(() => createHostingerStorageVerifiedSqlRuntimeComposition({
  pool,
  schema_verification: schemaVerification({ evidence: { expires_at: '2000-01-01T00:00:00.000Z' } }),
}), (error) => error.code === 'STORAGE_VERIFIED_SQL_COMPOSITION_SCHEMA_VERIFICATION_EXPIRED');

assert.throws(() => createHostingerStorageVerifiedSqlRuntimeComposition({
  pool,
  schema_verification: { ...schemaVerification(), private_key: 'forbidden' },
}), (error) => error.code === 'STORAGE_VERIFIED_SQL_COMPOSITION_SECRET_OR_UNSAFE_FIELD_REJECTED');

assert.throws(() => createHostingerStorageVerifiedSqlRuntimeComposition({
  pool,
  schema_verification: schemaVerification(),
  lock_timeout_seconds: 0,
}), (error) => error.code === 'STORAGE_VERIFIED_SQL_COMPOSITION_LOCK_TIMEOUT_INVALID');

assert.equal(connectionCalls, 0);

const source = await readFile(new URL('./hostingerStorageVerifiedSqlRuntimeComposition.js', import.meta.url), 'utf8');
assert.equal(/from ['"](?:mysql2|node:child_process|node:net|node:tls)['"]/u.test(source), false);
assert.equal(/\b(?:exec|execFile|spawn|fork)\s*\(/u.test(source), false);
assert.equal(/server\.js|routes\/|providerDispatch|dispatchProvider/u.test(source), false);
assert.match(source, /legacy_child_write_paths_exposed: false/u);
assert.match(source, /duplicate_write_paths_allowed: false/u);
assert.match(source, /runtime_mounted: false/u);
assert.match(source, /production_ready: false/u);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_verified_sql_runtime_composition',
  composition_version: HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION,
  canonical_components: 5,
  control_plane_methods: Object.keys(composition.control_plane).length,
  parent_writer_methods: Object.keys(composition.execution_parents).length,
  child_writer_methods: Object.keys(composition.child_evidence).length,
  legacy_child_write_paths_exposed: false,
  duplicate_write_paths_allowed: false,
  raw_components_exposed: false,
  database_connections_during_factory_creation: connectionCalls,
  runtime_mounted: false,
  foreign_keys_enabled: false,
  migration_apply_authorized: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}));
