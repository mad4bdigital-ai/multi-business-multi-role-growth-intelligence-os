#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  HOSTINGER_STORAGE_PRODUCTION_PREFLIGHT_VERSION,
  buildHostingerStorageProductionPreflight,
  verifyHostingerStorageProductionPreflight,
} from './hostingerStorageProductionPreflight.js';

const h = (value) => String(value).repeat(64).slice(0, 64);
const candidateSha = '1'.repeat(40);
const productionSha = '2'.repeat(40);
const sharedHead = '3'.repeat(40);
const sharedMerge = '4'.repeat(40);

function endpoint(name, overrides = {}) {
  return {
    endpoint: name,
    ok: true,
    environment: 'production',
    commit_sha: productionSha,
    observed_at_epoch: 990,
    evidence_digest: h(name.length),
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    preflight_id: 'production-preflight-1',
    now_epoch: 1000,
    max_evidence_age_seconds: 120,
    candidate: {
      release_id: 'release-1',
      environment: 'production',
      candidate_sha: candidateSha,
      source_main_sha: candidateSha,
      production_branch_sha: productionSha,
      ...(overrides.candidate || {}),
    },
    runtime_readback: {
      status: endpoint('status', overrides.runtime_readback?.status),
      health: endpoint('health', overrides.runtime_readback?.health),
      version: endpoint('version', overrides.runtime_readback?.version),
      deployment_info: endpoint('deployment-info', overrides.runtime_readback?.deployment_info),
    },
    storage_pressure: {
      source: 'read_only',
      status: 'healthy',
      bytes_used: 500,
      bytes_limit: 1000,
      inodes_used: 200,
      inodes_limit: 1000,
      observed_at_epoch: 990,
      evidence_digest: h('5'),
      ...(overrides.storage_pressure || {}),
    },
    deployment_layout: {
      layout_proof_id: 'layout-proof-1',
      status: 'verified',
      active_production_sha: productionSha,
      candidate_sha: candidateSha,
      active_root_excluded: true,
      rollback_set_retained: true,
      rollback_set_count: 2,
      candidate_roots_certified: true,
      observed_at_epoch: 990,
      evidence_digest: h('6'),
      ...(overrides.deployment_layout || {}),
    },
    canary_evidence: {
      feature_key: '014-governed-hostinger-storage-orchestration',
      workstream_id: 'shared-canary',
      status: 'passed',
      candidate_kind: 'head',
      workstream_head_sha: sharedHead,
      integration_merge_sha: sharedMerge,
      e2e_run_id: 30716646375,
      integrity_findings: 0,
      observed_at_epoch: 990,
      evidence_digest: h('7'),
      ...(overrides.canary_evidence || {}),
    },
    governance: {
      read_only: true,
      auto_cleanup_allowed: false,
      mutation_allowed: false,
      provider_dispatch_allowed: false,
      migration_apply_allowed: false,
      deployment_requires_separate_authority: true,
      production_promotion_requires_separate_authority: true,
      ...(overrides.governance || {}),
    },
  };
}

const passed = buildHostingerStorageProductionPreflight(input());
assert.equal(passed.contract, HOSTINGER_STORAGE_PRODUCTION_PREFLIGHT_VERSION);
assert.equal(passed.preflight_passed, true);
assert.equal(passed.promotion_preflight_ready, true);
assert.equal(passed.deployment_allowed, false);
assert.equal(passed.production_promotion_allowed, false);
assert.equal(passed.auto_cleanup_allowed, false);
assert.equal(passed.provider_dispatch_allowed, false);
assert.equal(passed.separate_release_authority_required, true);
assert.equal(Object.isFrozen(passed), true);
assert.equal(verifyHostingerStorageProductionPreflight({ preflight: passed, expected_digest: passed.evidence_digest, now_epoch: 1000 }).valid, true);

const warning = buildHostingerStorageProductionPreflight(input({ storage_pressure: { status: 'warning' } }));
assert.equal(warning.preflight_passed, true);
assert(warning.warnings.includes('STORAGE_PRODUCTION_PREFLIGHT_PRESSURE_WARNING'));

for (const [name, overrides, blocker] of [
  ['source-sha', { candidate: { source_main_sha: '8'.repeat(40) } }, 'STORAGE_PRODUCTION_PREFLIGHT_SOURCE_SHA_MISMATCH'],
  ['runtime-sha', { runtime_readback: { health: { commit_sha: candidateSha } } }, 'STORAGE_PRODUCTION_PREFLIGHT_HEALTH_SHA_MISMATCH'],
  ['runtime-failed', { runtime_readback: { status: { ok: false } } }, 'STORAGE_PRODUCTION_PREFLIGHT_STATUS_READBACK_FAILED'],
  ['pressure', { storage_pressure: { status: 'critical' } }, 'STORAGE_PRODUCTION_PREFLIGHT_PRESSURE_BLOCKING'],
  ['stale', { storage_pressure: { observed_at_epoch: 700 } }, 'STORAGE_PRODUCTION_PREFLIGHT_PRESSURE_STALE'],
  ['future', { deployment_layout: { observed_at_epoch: 1001 } }, 'STORAGE_PRODUCTION_PREFLIGHT_LAYOUT_FUTURE'],
  ['active-sha', { deployment_layout: { active_production_sha: candidateSha } }, 'STORAGE_PRODUCTION_PREFLIGHT_ACTIVE_SHA_MISMATCH'],
  ['candidate-layout', { deployment_layout: { candidate_sha: productionSha } }, 'STORAGE_PRODUCTION_PREFLIGHT_CANDIDATE_SHA_MISMATCH'],
  ['rollback', { deployment_layout: { rollback_set_retained: false } }, 'STORAGE_PRODUCTION_PREFLIGHT_ROLLBACK_SET_REQUIRED'],
  ['roots', { deployment_layout: { candidate_roots_certified: false } }, 'STORAGE_PRODUCTION_PREFLIGHT_CANDIDATE_ROOTS_NOT_CERTIFIED'],
  ['canary', { canary_evidence: { integrity_findings: 1 } }, 'STORAGE_PRODUCTION_PREFLIGHT_SHARED_CANARY_INVALID'],
  ['mutation', { governance: { mutation_allowed: true } }, 'STORAGE_PRODUCTION_PREFLIGHT_READ_ONLY_BOUNDARY_VIOLATED'],
  ['auto-cleanup', { governance: { auto_cleanup_allowed: true } }, 'STORAGE_PRODUCTION_PREFLIGHT_READ_ONLY_BOUNDARY_VIOLATED'],
  ['authority', { governance: { deployment_requires_separate_authority: false } }, 'STORAGE_PRODUCTION_PREFLIGHT_SEPARATE_AUTHORITY_REQUIRED'],
]) {
  const result = buildHostingerStorageProductionPreflight(input(overrides));
  assert.equal(result.preflight_passed, false, name);
  assert(result.blockers.includes(blocker), `${name}: ${JSON.stringify(result.blockers)}`);
  assert.equal(result.deployment_allowed, false);
  assert.equal(result.production_promotion_allowed, false);
}

assert.throws(
  () => buildHostingerStorageProductionPreflight({ ...input(), api_token: 'forbidden' }),
  (error) => error.code === 'STORAGE_PRODUCTION_PREFLIGHT_SECRET_EVIDENCE_REJECTED',
);
assert.throws(
  () => buildHostingerStorageProductionPreflight({ ...input(), secrets_included: true }),
  (error) => error.code === 'STORAGE_PRODUCTION_PREFLIGHT_SECRET_EVIDENCE_REJECTED',
);

const tampered = structuredClone(passed);
tampered.storage_pressure.status = 'emergency';
const tamperVerification = verifyHostingerStorageProductionPreflight({ preflight: tampered, expected_digest: passed.evidence_digest, now_epoch: 1000 });
assert.equal(tamperVerification.valid, false);
assert(tamperVerification.blockers.includes('STORAGE_PRODUCTION_PREFLIGHT_EVIDENCE_TAMPERED'));

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_production_preflight',
  exact_production_sha_required: true,
  runtime_status_health_version_deployment_readback_required: true,
  read_only_pressure_gate_required: true,
  rollback_and_candidate_layout_required: true,
  shared_canary_evidence_required: true,
  warning_pressure_non_blocking: true,
  critical_and_emergency_pressure_blocking: true,
  auto_cleanup_allowed: false,
  provider_dispatch_allowed: false,
  deployment_allowed: false,
  production_promotion_allowed: false,
  separate_release_authority_required: true,
  secrets_included: false,
}));
