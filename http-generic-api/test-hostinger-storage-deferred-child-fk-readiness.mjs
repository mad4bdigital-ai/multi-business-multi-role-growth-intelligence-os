#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  HOSTINGER_STORAGE_DEFERRED_CHILD_FK_CANDIDATE,
  HOSTINGER_STORAGE_DEFERRED_CHILD_FK_READBACK,
  buildHostingerStorageDeferredChildFkReadiness,
  verifyHostingerStorageDeferredChildFkReadiness,
} from './hostingerStorageDeferredChildFkReadiness.js';

const h = (character) => character.repeat(64);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const candidatePath = new URL('../.github/contracts/spec014/migrations/deferred-child-parent-foreign-keys.sql', import.meta.url);
const readbackPath = new URL('../.github/contracts/spec014/migrations/deferred-child-parent-fk-readback.sql', import.meta.url);
const candidateSql = await readFile(candidatePath, 'utf8');
const readbackSql = await readFile(readbackPath, 'utf8');

assert.equal(sha256(candidateSql), HOSTINGER_STORAGE_DEFERRED_CHILD_FK_CANDIDATE.checksum_sha256);
assert.equal(sha256(readbackSql), HOSTINGER_STORAGE_DEFERRED_CHILD_FK_READBACK.checksum_sha256);
assert.equal((candidateSql.match(/\bALTER\s+TABLE\b/giu) || []).length, 3);
assert.equal((candidateSql.match(/\bADD\s+CONSTRAINT\b/giu) || []).length, 3);
assert.equal(/\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|REPLACE|CASCADE)\b/iu.test(candidateSql), false);
assert.equal(/\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|TRUNCATE|CREATE)\b/iu.test(readbackSql.replace(/^--.*$/gmu, '')), false);
const normalizedCandidateSql = candidateSql.replace(/\s+/gu, ' ').trim();
for (const constraint of HOSTINGER_STORAGE_DEFERRED_CHILD_FK_CANDIDATE.constraints) {
  assert.equal(normalizedCandidateSql.includes(`ADD CONSTRAINT ${constraint.name}`), true);
  assert.equal(normalizedCandidateSql.includes(`FOREIGN KEY (${constraint.child_column}) REFERENCES ${constraint.parent_table}(${constraint.parent_column})`), true);
}

function schema(overrides = {}) {
  return {
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
      database_fingerprint: h('2'),
      readback_cycle_id: 'fk-readback-cycle-1',
      expires_at: '2030-01-01T00:10:00.000Z',
    },
    secrets_included: false,
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    filename: HOSTINGER_STORAGE_DEFERRED_CHILD_FK_CANDIDATE.filename,
    checksum_sha256: HOSTINGER_STORAGE_DEFERRED_CHILD_FK_CANDIDATE.checksum_sha256,
    statement_count: HOSTINGER_STORAGE_DEFERRED_CHILD_FK_CANDIDATE.statement_count,
    constraints: HOSTINGER_STORAGE_DEFERRED_CHILD_FK_CANDIDATE.constraints.map((row) => ({ ...row })),
    secrets_included: false,
    ...overrides,
  };
}

const zeroMetrics = {
  plan_items_total: 2,
  runs_total: 1,
  journal_rows_total: 6,
  reconciliation_rows_total: 1,
  journal_null_plan_item_id_count: 0,
  journal_orphan_run_count: 0,
  journal_orphan_plan_item_count: 0,
  journal_operation_mismatch_count: 0,
  journal_plan_mismatch_count: 0,
  journal_duplicate_runtime_sequence_count: 0,
  journal_duplicate_parent_sequence_count: 0,
  journal_row_version_violation_count: 0,
  reconciliation_orphan_run_count: 0,
  reconciliation_operation_mismatch_count: 0,
  reconciliation_row_version_violation_count: 0,
};

function readback(overrides = {}) {
  return {
    contract: 'spec014.hostinger-storage-deferred-child-fk-readback.v1',
    source_commit: h('1'),
    deployed_runtime_sha: h('1'),
    database_fingerprint: h('2'),
    readback_cycle_id: 'fk-readback-cycle-1',
    readback_sql_checksum_sha256: HOSTINGER_STORAGE_DEFERRED_CHILD_FK_READBACK.checksum_sha256,
    observed_at: '2030-01-01T00:00:00.000Z',
    expires_at: '2030-01-01T00:05:00.000Z',
    metrics: { ...zeroMetrics },
    read_only: true,
    external_writes: 0,
    provider_calls: 0,
    secrets_included: false,
    ...overrides,
  };
}

const now = Date.parse('2030-01-01T00:01:00.000Z');
const packet = buildHostingerStorageDeferredChildFkReadiness({
  schema_verification: schema(),
  candidate: candidate(),
  readback: readback(),
  now,
});
assert.equal(packet.ready_for_separate_authorization, true);
assert.deepEqual(packet.blockers, []);
assert.equal(packet.authorization_created, false);
assert.equal(packet.migration_apply_authorized, false);
assert.equal(packet.foreign_keys_enabled, false);
assert.equal(packet.live_database_access_performed_by_evaluator, false);
assert.equal(packet.runtime_mounted, false);
assert.equal(packet.provider_dispatch_allowed, false);
assert.equal(packet.production_ready, false);
assert.equal(packet.secrets_included, false);
assert.equal(verifyHostingerStorageDeferredChildFkReadiness({ packet, expected_digest: packet.readiness_digest }).valid, true);

const blocked = buildHostingerStorageDeferredChildFkReadiness({
  schema_verification: schema(),
  candidate: candidate(),
  readback: readback({ metrics: {
    ...zeroMetrics,
    journal_null_plan_item_id_count: 2,
    journal_orphan_run_count: 1,
    reconciliation_operation_mismatch_count: 1,
  } }),
  now,
});
assert.equal(blocked.ready_for_separate_authorization, false);
assert.deepEqual(blocked.blockers, [
  'JOURNAL_RUN_ORPHAN_PRESENT',
  'LEGACY_NULL_PLAN_ITEM_ID_PRESENT',
  'RECONCILIATION_OPERATION_PARENT_MISMATCH',
]);
assert.equal(verifyHostingerStorageDeferredChildFkReadiness({ packet: blocked }).ready_for_separate_authorization, false);

assert.throws(() => buildHostingerStorageDeferredChildFkReadiness({
  schema_verification: schema(),
  candidate: candidate({ checksum_sha256: h('f') }),
  readback: readback(),
  now,
}), (error) => error.code === 'STORAGE_DEFERRED_FK_CANDIDATE_DRIFT');

assert.throws(() => buildHostingerStorageDeferredChildFkReadiness({
  schema_verification: schema(),
  candidate: candidate(),
  readback: readback({ database_fingerprint: h('3') }),
  now,
}), (error) => error.code === 'STORAGE_DEFERRED_FK_READBACK_BINDING_MISMATCH');

assert.throws(() => buildHostingerStorageDeferredChildFkReadiness({
  schema_verification: schema(),
  candidate: candidate(),
  readback: readback({ readback_sql_checksum_sha256: h('4') }),
  now,
}), (error) => error.code === 'STORAGE_DEFERRED_FK_READBACK_SQL_DRIFT');

assert.throws(() => buildHostingerStorageDeferredChildFkReadiness({
  schema_verification: schema(),
  candidate: candidate(),
  readback: readback({ expires_at: '2029-12-31T23:59:00.000Z' }),
  now,
}), (error) => error.code === 'STORAGE_DEFERRED_FK_READBACK_FRESHNESS_INVALID');

assert.throws(() => buildHostingerStorageDeferredChildFkReadiness({
  schema_verification: { ...schema(), private_key: 'forbidden' },
  candidate: candidate(),
  readback: readback(),
  now,
}), (error) => error.code === 'STORAGE_DEFERRED_FK_SECRET_OR_UNSAFE_FIELD_REJECTED');

const tampered = structuredClone(packet);
tampered.readback.metrics.journal_orphan_run_count = 1;
assert.throws(() => verifyHostingerStorageDeferredChildFkReadiness({ packet: tampered }), (error) => error.code === 'STORAGE_DEFERRED_FK_PACKET_TAMPERED');

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_deferred_child_fk_readiness',
  candidate_checksum: HOSTINGER_STORAGE_DEFERRED_CHILD_FK_CANDIDATE.checksum_sha256,
  readback_checksum: HOSTINGER_STORAGE_DEFERRED_CHILD_FK_READBACK.checksum_sha256,
  constraint_count: HOSTINGER_STORAGE_DEFERRED_CHILD_FK_CANDIDATE.constraints.length,
  zero_legacy_null_required: true,
  zero_orphans_required: true,
  zero_parent_mismatch_required: true,
  exact_runtime_database_cycle_binding: true,
  authorization_created: false,
  migration_apply_authorized: false,
  foreign_keys_enabled: false,
  live_database_access_performed: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}));
