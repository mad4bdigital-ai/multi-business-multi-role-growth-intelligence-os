import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  governedMigrationAuthorizationConfirmation,
  inspectGovernedMigrationAuthorizationCandidate,
} from './governedMigrationAuthorizationBootstrap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RUNTIME_CONTRACT_PATH = path.join(
  __dirname,
  '..',
  '.github',
  'contracts',
  'spec014',
  'hostinger-storage-runtime-migrations.json',
);
const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, 'migrations');

export const HOSTINGER_STORAGE_MIGRATION_PROMOTION_PR = 4564;
export const HOSTINGER_STORAGE_MIGRATION_PROMOTION_MERGE_SHA =
  '7a96920eff2579321707d193a1d030e6454891b1';

const EXPECTED_WAVES = Object.freeze([
  Object.freeze({
    wave: 1,
    migration: '20260802_01_spec014_hostinger_storage_foundation.sql',
    checksum_sha256: '9eca6e585d12de633931c7d7e099f467a955aaf7b819ccb2660d34acf63d5053',
    statement_count: 4,
    dependency: null,
  }),
  Object.freeze({
    wave: 2,
    migration: '20260802_02_spec014_hostinger_storage_control_plane.sql',
    checksum_sha256: '80d0006012b48a022f19b70174ccaf5bf922cad87255c47e1eb08e23da3c4b33',
    statement_count: 6,
    dependency: '20260802_01_spec014_hostinger_storage_foundation.sql',
  }),
  Object.freeze({
    wave: 3,
    migration: '20260802_03_spec014_hostinger_storage_execution_evidence.sql',
    checksum_sha256: 'cf484d413399bbd3a0ea9ff36155ceb8b369e1bd43c63c300a93a179e0a57096',
    statement_count: 9,
    dependency: '20260802_02_spec014_hostinger_storage_control_plane.sql',
  }),
]);

function readinessError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function exactWave(actual = {}, expected = {}) {
  return (
    Number(actual.wave) === expected.wave &&
    actual.migration === expected.migration &&
    actual.checksum_sha256 === expected.checksum_sha256 &&
    Number(actual.statement_count) === expected.statement_count &&
    (actual.dependency || null) === expected.dependency
  );
}

function assertRuntimeContract(contract = {}) {
  if (contract.contract !== 'spec014.hostinger-storage-runtime-migrations.v1') {
    throw readinessError(
      'STORAGE_MIGRATION_READINESS_CONTRACT_INVALID',
      'Unexpected Spec 014 runtime migration contract.',
    );
  }
  if (
    contract.migration_apply_authorized !== false ||
    contract.live_database_access_performed !== false ||
    contract.schema_verified !== false ||
    contract.production_ready !== false ||
    contract.secrets_included !== false
  ) {
    throw readinessError(
      'STORAGE_MIGRATION_READINESS_SAFETY_BOUNDARY_INVALID',
      'Runtime migration contract must remain unapplied, unverified, and secret-free.',
    );
  }
  if (!Array.isArray(contract.waves) || contract.waves.length !== EXPECTED_WAVES.length) {
    throw readinessError(
      'STORAGE_MIGRATION_READINESS_WAVE_SEQUENCE_INVALID',
      'Exactly three governed migration waves are required.',
    );
  }
  for (let index = 0; index < EXPECTED_WAVES.length; index += 1) {
    if (!exactWave(contract.waves[index], EXPECTED_WAVES[index])) {
      throw readinessError(
        'STORAGE_MIGRATION_READINESS_WAVE_DRIFT',
        'Governed migration identity, checksum, statement count, or dependency drifted.',
        { wave: EXPECTED_WAVES[index].wave },
      );
    }
  }
}

function commonBlockers() {
  return [
    'FRESH_CAPABILITY_ENVELOPE_REQUIRED',
    'AUTHORIZATION_REGISTRY_WRITE_NOT_PERFORMED',
    'SAME_CYCLE_DRY_RUN_NOT_PERFORMED',
    'LIVE_SCHEMA_READBACK_NOT_PERFORMED',
  ];
}

function uniqueSorted(values = []) {
  return [...new Set(values.filter(Boolean))].sort();
}

export async function buildHostingerStorageMigrationAuthorizationReadiness(
  input = {},
  deps = {},
) {
  const readFile = deps.readFile || fs.readFile.bind(fs);
  const runtimeContractPath =
    deps.runtimeContractPath || input.runtime_contract_path || DEFAULT_RUNTIME_CONTRACT_PATH;
  const migrationsDir = deps.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const inspectCandidate =
    deps.inspectCandidate || inspectGovernedMigrationAuthorizationCandidate;

  const pullRequest = Number(
    input.pull_request ?? HOSTINGER_STORAGE_MIGRATION_PROMOTION_PR,
  );
  const mergeSha = String(
    input.merge_sha ?? HOSTINGER_STORAGE_MIGRATION_PROMOTION_MERGE_SHA,
  ).trim().toLowerCase();

  if (pullRequest !== HOSTINGER_STORAGE_MIGRATION_PROMOTION_PR) {
    throw readinessError(
      'STORAGE_MIGRATION_READINESS_PROMOTION_PR_MISMATCH',
      'Readiness is bound to the governed runtime migration promotion PR.',
      { expected: HOSTINGER_STORAGE_MIGRATION_PROMOTION_PR, actual: pullRequest },
    );
  }
  if (mergeSha !== HOSTINGER_STORAGE_MIGRATION_PROMOTION_MERGE_SHA) {
    throw readinessError(
      'STORAGE_MIGRATION_READINESS_PROMOTION_SHA_MISMATCH',
      'Readiness is bound to the exact governed migration promotion merge SHA.',
      { expected: HOSTINGER_STORAGE_MIGRATION_PROMOTION_MERGE_SHA, actual: mergeSha },
    );
  }

  const contract = input.runtime_contract
    ? structuredClone(input.runtime_contract)
    : JSON.parse(await readFile(runtimeContractPath, 'utf8'));
  assertRuntimeContract(contract);

  const waves = [];
  for (const wave of contract.waves) {
    const confirmation = governedMigrationAuthorizationConfirmation(wave.migration);
    let candidate = null;
    let inspectionError = null;

    try {
      candidate = await inspectCandidate(
        {
          migration: wave.migration,
          expected_checksum_sha256: wave.checksum_sha256,
          expected_statement_count: wave.statement_count,
          pull_request: pullRequest,
          merge_sha: mergeSha,
          confirm: confirmation,
        },
        { readFile, migrationsDir },
      );
    } catch (error) {
      inspectionError = {
        code: String(error?.code || 'STORAGE_MIGRATION_READINESS_INSPECTION_FAILED'),
        status: Number(error?.status || 500),
        message: String(error?.message || 'Migration authorization inspection failed.').slice(
          0,
          500,
        ),
        secrets_included: false,
      };
    }

    const blockers = commonBlockers();
    if (wave.dependency) {
      blockers.push(`DEPENDENCY_APPLY_LEDGER_REQUIRED:${wave.dependency}`);
    }
    if (wave.wave === 3) {
      blockers.push(
        'LIVE_VIEW_ABSENCE_READBACK_REQUIRED',
        'LIVE_TOOL_KEY_ABSENCE_READBACK_REQUIRED',
      );
    }
    if (inspectionError) blockers.push(inspectionError.code);

    let readinessState = 'candidate_inspection_ready_authorization_not_created';
    if (wave.wave === 2) {
      readinessState = 'candidate_inspection_ready_dependency_apply_ledger_required';
    }
    if (wave.wave === 3) {
      readinessState = 'candidate_inspection_blocked_live_absence_readback_required';
    }

    waves.push(
      Object.freeze({
        wave: wave.wave,
        migration: wave.migration,
        checksum_sha256: wave.checksum_sha256,
        statement_count: wave.statement_count,
        dependency: wave.dependency || null,
        required_confirmation: confirmation,
        repository_preflight_status: wave.preflight_status,
        repository_preflight_risk_count: Number(wave.preflight_risk_count || 0),
        candidate_inspection_passed: Boolean(candidate),
        candidate_inspection_error: inspectionError,
        readiness_state: readinessState,
        blockers: Object.freeze(uniqueSorted(blockers)),
        authorization_created: false,
        authorization_updated: false,
        dry_run_performed: false,
        migration_sql_executed: false,
        live_database_access_performed: false,
        secrets_included: false,
      }),
    );
  }

  const byWave = new Map(waves.map((wave) => [wave.wave, wave]));
  if (!byWave.get(1)?.candidate_inspection_passed) {
    throw readinessError(
      'STORAGE_MIGRATION_READINESS_WAVE_1_INSPECTION_FAILED',
      'Wave 1 must pass repository-only authorization candidate inspection.',
      { inspection_error: byWave.get(1)?.candidate_inspection_error || null },
    );
  }
  if (!byWave.get(2)?.candidate_inspection_passed) {
    throw readinessError(
      'STORAGE_MIGRATION_READINESS_WAVE_2_INSPECTION_FAILED',
      'Wave 2 must pass repository-only authorization candidate inspection.',
      { inspection_error: byWave.get(2)?.candidate_inspection_error || null },
    );
  }
  if (
    byWave.get(3)?.candidate_inspection_error?.code !==
    'governed_migration_authorization_preflight_failed'
  ) {
    throw readinessError(
      'STORAGE_MIGRATION_READINESS_WAVE_3_FAIL_CLOSED_EVIDENCE_MISSING',
      'Wave 3 must remain blocked by the canonical zero-risk authorization preflight.',
      { inspection_error: byWave.get(3)?.candidate_inspection_error || null },
    );
  }

  return Object.freeze({
    ok: true,
    contract: 'spec014.hostinger-storage-migration-authorization-readiness.v1',
    status: 'repository_inspection_complete_live_authorization_blocked',
    source_contract: '.github/contracts/spec014/hostinger-storage-runtime-migrations.json',
    promotion_pull_request: pullRequest,
    promotion_merge_sha: mergeSha,
    wave_count: waves.length,
    next_authorizable_wave: 1,
    waves: Object.freeze(waves),
    authorization_created: false,
    authorization_registry_mutated: false,
    capability_envelope_resolved: false,
    dry_run_performed: false,
    migration_sql_executed: false,
    live_database_access_performed: false,
    schema_verified: false,
    production_ready: false,
    provider_dispatch_allowed: false,
    secrets_included: false,
  });
}
