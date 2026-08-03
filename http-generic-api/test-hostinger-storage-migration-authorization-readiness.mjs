import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const reportPath = process.env.SPEC014_MIGRATION_READINESS_REPORT || '';
const report = {
  contract: 'spec014.hostinger-storage-migration-authorization-readiness-test.v1',
  outcome: 'running',
  stage: 'initialize',
  error: null,
  assertions_completed: 0,
  authorization_created: false,
  authorization_registry_mutated: false,
  migration_sql_executed: false,
  live_database_access_performed: false,
  secrets_included: false,
};

async function persistReport() {
  if (!reportPath) return;
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function completed(stage) {
  report.stage = stage;
  report.assertions_completed += 1;
}

try {
  report.stage = 'import_readiness_module';
  const {
    buildHostingerStorageMigrationAuthorizationReadiness,
    HOSTINGER_STORAGE_MIGRATION_PROMOTION_MERGE_SHA,
    HOSTINGER_STORAGE_WAVE_4_PROMOTION_MERGE_SHA,
  } = await import('./hostingerStorageMigrationAuthorizationReadiness.js');

  report.stage = 'build_readiness_packet';
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
  assert.equal(result.wave_4_promotion_pull_request, 4879);
  assert.equal(
    result.wave_4_promotion_merge_sha,
    HOSTINGER_STORAGE_WAVE_4_PROMOTION_MERGE_SHA,
  );
  assert.equal(result.promotion_sources.length, 4);
  assert.deepEqual(
    result.promotion_sources.map(({ wave, pull_request, merge_sha }) => ({
      wave,
      pull_request,
      merge_sha,
    })),
    [
      { wave: 1, pull_request: 4564, merge_sha: HOSTINGER_STORAGE_MIGRATION_PROMOTION_MERGE_SHA },
      { wave: 2, pull_request: 4564, merge_sha: HOSTINGER_STORAGE_MIGRATION_PROMOTION_MERGE_SHA },
      { wave: 3, pull_request: 4564, merge_sha: HOSTINGER_STORAGE_MIGRATION_PROMOTION_MERGE_SHA },
      { wave: 4, pull_request: 4879, merge_sha: HOSTINGER_STORAGE_WAVE_4_PROMOTION_MERGE_SHA },
    ],
  );
  assert.equal(result.wave_count, 4);
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
  completed('top_level_safety_boundary');

  const [wave1, wave2, wave3, wave4] = result.waves;
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
  completed('wave_1_candidate_inspection');

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
  completed('wave_2_dependency_boundary');

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
  completed('wave_3_live_absence_boundary');

  assert.equal(wave4.candidate_inspection_passed, true);
  assert.equal(wave4.promotion_pull_request, 4879);
  assert.equal(
    wave4.promotion_merge_sha,
    HOSTINGER_STORAGE_WAVE_4_PROMOTION_MERGE_SHA,
  );
  assert.equal(
    wave4.readiness_state,
    'candidate_inspection_ready_dependency_and_live_schema_readback_required',
  );
  assert.equal(
    wave4.blockers.includes(
      'DEPENDENCY_APPLY_LEDGER_REQUIRED:20260802_03_spec014_hostinger_storage_execution_evidence.sql',
    ),
    true,
  );
  assert.equal(
    wave4.blockers.includes('LIVE_TABLE_ABSENCE_OR_EXACT_COMPATIBILITY_READBACK_REQUIRED'),
    true,
  );
  assert.equal(
    wave4.blockers.includes('SIGNED_SCHEMA_VERIFICATION_CONTRACT_REFRESH_REQUIRED'),
    true,
  );
  assert.equal(wave4.authorization_created, false);
  assert.equal(wave4.migration_sql_executed, false);
  assert.equal(wave4.live_database_access_performed, false);
  completed('wave_4_dependency_and_verification_refresh_boundary');

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
  completed('reject_apply_authority_tampering');

  await assert.rejects(
    buildHostingerStorageMigrationAuthorizationReadiness({
      runtime_contract: {
        ...runtimeContract,
        waves: runtimeContract.waves.map((wave) =>
          wave.wave === 4
            ? { ...wave, checksum_sha256: '0'.repeat(64) }
            : wave,
        ),
      },
    }),
    (error) => error.code === 'STORAGE_MIGRATION_READINESS_WAVE_DRIFT',
  );
  completed('reject_wave_4_checksum_drift');

  await assert.rejects(
    buildHostingerStorageMigrationAuthorizationReadiness({
      merge_sha: '0'.repeat(40),
    }),
    (error) =>
      error.code === 'STORAGE_MIGRATION_READINESS_PROMOTION_SHA_MISMATCH'
      && error.details?.wave === 1,
  );
  completed('reject_primary_promotion_sha_drift');

  await assert.rejects(
    buildHostingerStorageMigrationAuthorizationReadiness({
      wave_4_merge_sha: '0'.repeat(40),
    }),
    (error) =>
      error.code === 'STORAGE_MIGRATION_READINESS_PROMOTION_SHA_MISMATCH'
      && error.details?.wave === 4,
  );
  completed('reject_wave_4_promotion_sha_drift');

  report.outcome = 'passed';
  report.stage = 'completed';
  report.wave_1_candidate_inspection_ready = true;
  report.wave_2_dependency_apply_ledger_required = true;
  report.wave_3_live_absence_readback_required = true;
  report.wave_4_candidate_inspection_ready = true;
  report.wave_4_dependency_apply_ledger_required = true;
  report.wave_4_signed_schema_verification_refresh_required = true;
  await persistReport();
  console.log(JSON.stringify(report));
} catch (error) {
  report.outcome = 'failed';
  report.error = {
    name: String(error?.name || 'Error'),
    code: String(error?.code || 'SPEC014_MIGRATION_READINESS_TEST_FAILED'),
    message: String(error?.message || error).slice(0, 1500),
    details: error?.details && typeof error.details === 'object'
      ? structuredClone(error.details)
      : null,
    secrets_included: false,
  };
  await persistReport();
  console.error(JSON.stringify(report));
  process.exitCode = 1;
}
