import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildHostingerStorageMigrationAuthorizationReadiness,
  HOSTINGER_STORAGE_MIGRATION_PROMOTION_MERGE_SHA,
} from './hostingerStorageMigrationAuthorizationReadiness.js';

const result = await buildHostingerStorageMigrationAuthorizationReadiness();

assert.equal(result.ok, true);
assert.equal(
  result.contract,
  'spec014.hostinger-storage-migration-authorization-readiness.v1',
);
assert.equal(result.status, 'repository_inspection_complete_live_authorization_blocked');
assert.equal(result.promotion_pull_request, 4564);
assert.equal(
  result.promotion_merge_sha,
  HOSTINGER_STORAGE_MIGRATION_PROMOTION_MERGE_SHA,
);
assert.equal(result.wave_count, 3);
assert.equal(result.next_authorizable_wave, 1);
assert.equal(result.authorization_created, false);
assert.equal(result.authorization_registry_mutated, false);
assert.equal(result.capability_envelope_resolved, false);
assert.equal(result.dry_run_performed, false);
assert.equal(result.migration_sql_executed, false);
assert.equal(result.live_database_access_performed, false);
assert.equal(result.schema_verified, false);
assert.equal(result.production_ready, false);
assert.equal(result.provider_dispatch_allowed, false);
assert.equal(result.secrets_included, false);

const [wave1, wave2, wave3] = result.waves;
assert.equal(wave1.candidate_inspection_passed, true);
assert.equal(
  wave1.readiness_state,
  'candidate_inspection_ready_authorization_not_created',
);
assert.equal(
  wave1.blockers.includes('AUTHORIZATION_REGISTRY_WRITE_NOT_PERFORMED'),
  true,
);
assert.equal(
  wave1.blockers.includes('FRESH_CAPABILITY_ENVELOPE_REQUIRED'),
  true,
);

assert.equal(wave2.candidate_inspection_passed, true);
assert.equal(
  wave2.readiness_state,
  'candidate_inspection_ready_dependency_apply_ledger_required',
);
assert.equal(
  wave2.blockers.includes(
    'DEPENDENCY_APPLY_LEDGER_REQUIRED:20260802_01_spec014_hostinger_storage_foundation.sql',
  ),
  true,
);

assert.equal(wave3.candidate_inspection_passed, false);
assert.equal(
  wave3.candidate_inspection_error.code,
  'governed_migration_authorization_preflight_failed',
);
assert.equal(
  wave3.readiness_state,
  'candidate_inspection_blocked_live_absence_readback_required',
);
assert.equal(
  wave3.blockers.includes('LIVE_VIEW_ABSENCE_READBACK_REQUIRED'),
  true,
);
assert.equal(
  wave3.blockers.includes('LIVE_TOOL_KEY_ABSENCE_READBACK_REQUIRED'),
  true,
);

const runtimeContract = JSON.parse(
  await readFile(
    new URL(
      '../.github/contracts/spec014/hostinger-storage-runtime-migrations.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

await assert.rejects(
  buildHostingerStorageMigrationAuthorizationReadiness({
    runtime_contract: {
      ...runtimeContract,
      migration_apply_authorized: true,
    },
  }),
  (error) =>
    error.code === 'STORAGE_MIGRATION_READINESS_SAFETY_BOUNDARY_INVALID',
);

await assert.rejects(
  buildHostingerStorageMigrationAuthorizationReadiness({
    runtime_contract: {
      ...runtimeContract,
      waves: runtimeContract.waves.map((wave) =>
        wave.wave === 1
          ? { ...wave, checksum_sha256: '0'.repeat(64) }
          : wave,
      ),
    },
  }),
  (error) => error.code === 'STORAGE_MIGRATION_READINESS_WAVE_DRIFT',
);

await assert.rejects(
  buildHostingerStorageMigrationAuthorizationReadiness({
    merge_sha: '0'.repeat(40),
  }),
  (error) =>
    error.code === 'STORAGE_MIGRATION_READINESS_PROMOTION_SHA_MISMATCH',
);

console.log(
  JSON.stringify({
    ok: true,
    test: 'spec014_hostinger_storage_migration_authorization_readiness',
    wave_1_candidate_inspection_ready: true,
    wave_2_dependency_apply_ledger_required: true,
    wave_3_live_absence_readback_required: true,
    authorization_created: false,
    authorization_registry_mutated: false,
    migration_sql_executed: false,
    live_database_access_performed: false,
    secrets_included: false,
  }),
);
