#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHostingerStorageVerifiedSqlRuntimeComposition } from './hostingerStorageVerifiedSqlRuntimeComposition.js';
import {
  HOSTINGER_STORAGE_DURABLE_TENANT_RUNTIME_BRIDGE_READINESS_VERSION,
  buildHostingerStorageDurableTenantRuntimeBridgeReadiness,
  verifyHostingerStorageDurableTenantRuntimeBridgeReadiness,
} from './hostingerStorageDurableTenantRuntimeBridgeReadiness.js';
import { HOSTINGER_STORAGE_TENANT_RUNTIME_VERSION } from './hostingerStorageTenantRuntime.js';
import { HOSTINGER_STORAGE_TENANT_CANARY_VERSION } from './hostingerStorageTenantCanary.js';
import { HOSTINGER_STORAGE_SYNTHETIC_EXECUTOR_VERSION } from './hostingerStorageSyntheticExecutor.js';
import { HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION } from './hostingerStorageVerifiedSqlRuntimeComposition.js';

const h = (character) => character.repeat(64);
let connectionCalls = 0;
const pool = Object.freeze({
  getConnection() {
    connectionCalls += 1;
    throw new Error('Readiness evaluation must not connect to the database.');
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
      readback_cycle_id: 'durable-tenant-bridge-cycle-1',
      readback_digest: h('b'),
      migration_evidence_digest: h('c'),
      database_fingerprint: h('d'),
      verified_at: '2099-01-01T00:00:00.000Z',
      expires_at: '2099-01-01T00:30:00.000Z',
    },
    secrets_included: false,
  };
  return {
    ...base,
    ...overrides,
    evidence: { ...base.evidence, ...(overrides.evidence || {}) },
  };
}

const composition = createHostingerStorageVerifiedSqlRuntimeComposition({
  pool,
  schema_verification: schemaVerification(),
  lock_timeout_seconds: 5,
});
assert.equal(connectionCalls, 0);

const capabilityNames = [
  'canonical_repository_facade_ready',
  'plan_item_parent_registration_ready',
  'run_parent_creation_ready',
  'journal_translation_ready',
  'reconciliation_translation_ready',
  'durable_authority_store_ready',
  'durable_enablement_registry_ready',
  'tenant_safe_projection_ready',
  'worker_certification_ready',
  'fixed_dispatch_ready',
  'crash_safe_restart_reconciliation_ready',
];

function capabilities(value = true) {
  return Object.fromEntries(capabilityNames.map((key) => [key, value]));
}

function evidence(overrides = {}) {
  const base = {
    contract: 'spec014.hostinger-storage-durable-tenant-runtime-bridge-evidence.v1',
    source_commit: h('1'),
    deployed_runtime_sha: h('1'),
    database_fingerprint: h('d'),
    schema_verification_digest: h('a'),
    readback_cycle_id: 'durable-tenant-bridge-cycle-1',
    observed_at: '2099-01-01T00:05:00.000Z',
    expires_at: '2099-01-01T00:15:00.000Z',
    route: {
      path: '/tenant/storage-operations/apply-plan',
      dependency_key: 'tenantStorageRuntime',
      fail_closed_status: 503,
      default_unmounted: true,
      tenant_user_jwt_required: true,
      secrets_included: false,
    },
    versions: {
      composition: HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION,
      tenant_runtime: HOSTINGER_STORAGE_TENANT_RUNTIME_VERSION,
      tenant_canary: HOSTINGER_STORAGE_TENANT_CANARY_VERSION,
      synthetic_executor: HOSTINGER_STORAGE_SYNTHETIC_EXECUTOR_VERSION,
      secrets_included: false,
    },
    capabilities: capabilities(true),
    read_only: true,
    database_writes: 0,
    provider_calls: 0,
    route_mutations: 0,
    secrets_included: false,
  };
  return {
    ...base,
    ...overrides,
    route: { ...base.route, ...(overrides.route || {}) },
    versions: { ...base.versions, ...(overrides.versions || {}) },
    capabilities: { ...base.capabilities, ...(overrides.capabilities || {}) },
  };
}

const now = Date.parse('2099-01-01T00:10:00.000Z');
const ready = buildHostingerStorageDurableTenantRuntimeBridgeReadiness({
  composition,
  evidence: evidence(),
  now,
});
assert.equal(ready.version, HOSTINGER_STORAGE_DURABLE_TENANT_RUNTIME_BRIDGE_READINESS_VERSION);
assert.equal(ready.ready_for_separate_mount_authorization, true);
assert.deepEqual(ready.blockers, []);
assert.equal(ready.bridge_created, false);
assert.equal(ready.authorization_created, false);
assert.equal(ready.dependency_injected, false);
assert.equal(ready.runtime_mounted, false);
assert.equal(ready.route_mounted, false);
assert.equal(ready.worker_mounted, false);
assert.equal(ready.database_writes_performed_by_evaluator, 0);
assert.equal(ready.provider_dispatch_allowed, false);
assert.equal(ready.production_ready, false);
assert.equal(ready.secrets_included, false);
assert.equal(verifyHostingerStorageDurableTenantRuntimeBridgeReadiness({ packet: ready, expected_digest: ready.readiness_digest }).valid, true);
assert.equal(connectionCalls, 0);

const blocked = buildHostingerStorageDurableTenantRuntimeBridgeReadiness({
  composition,
  evidence: evidence({ capabilities: capabilities(false) }),
  now,
});
assert.equal(blocked.ready_for_separate_mount_authorization, false);
assert.equal(blocked.blockers.length, capabilityNames.length);
assert.deepEqual(blocked.blockers, [
  'CANONICAL_REPOSITORY_FACADE_MISSING',
  'CRASH_SAFE_RESTART_RECONCILIATION_MISSING',
  'DEDICATED_WORKER_CERTIFICATION_MISSING',
  'DURABLE_AUTHORITY_STORE_MISSING',
  'DURABLE_ENABLEMENT_REGISTRY_MISSING',
  'FIXED_DISPATCH_CERTIFICATION_MISSING',
  'PARENT_AWARE_JOURNAL_TRANSLATION_MISSING',
  'PARENT_AWARE_RECONCILIATION_TRANSLATION_MISSING',
  'PLAN_ITEM_PARENT_REGISTRATION_MISSING',
  'RUN_PARENT_CREATION_MISSING',
  'TENANT_SAFE_DURABLE_PROJECTION_MISSING',
]);
assert.equal(verifyHostingerStorageDurableTenantRuntimeBridgeReadiness({ packet: blocked }).ready_for_separate_mount_authorization, false);

assert.throws(() => buildHostingerStorageDurableTenantRuntimeBridgeReadiness({
  composition,
  evidence: evidence({ route: { path: '/tenant/storage-operations/unsafe' } }),
  now,
}), (error) => error.code === 'STORAGE_DURABLE_BRIDGE_ROUTE_CONTRACT_DRIFT');

assert.throws(() => buildHostingerStorageDurableTenantRuntimeBridgeReadiness({
  composition,
  evidence: evidence({ deployed_runtime_sha: h('2') }),
  now,
}), (error) => error.code === 'STORAGE_DURABLE_BRIDGE_PROVENANCE_MISMATCH');

assert.throws(() => buildHostingerStorageDurableTenantRuntimeBridgeReadiness({
  composition,
  evidence: evidence({ expires_at: '2099-01-01T00:09:00.000Z' }),
  now,
}), (error) => error.code === 'STORAGE_DURABLE_BRIDGE_EVIDENCE_FRESHNESS_INVALID');

assert.throws(() => buildHostingerStorageDurableTenantRuntimeBridgeReadiness({
  composition,
  evidence: { ...evidence(), private_key: 'forbidden' },
  now,
}), (error) => error.code === 'STORAGE_DURABLE_BRIDGE_SECRET_OR_UNSAFE_FIELD_REJECTED');

const semanticTamper = structuredClone(ready);
semanticTamper.evidence.capabilities.run_parent_creation_ready = false;
assert.throws(() => verifyHostingerStorageDurableTenantRuntimeBridgeReadiness({ packet: semanticTamper }), (error) => error.code === 'STORAGE_DURABLE_BRIDGE_PACKET_TAMPERED');

const digestTamper = structuredClone(ready);
digestTamper.readiness_digest = h('f');
assert.throws(() => verifyHostingerStorageDurableTenantRuntimeBridgeReadiness({ packet: digestTamper }), (error) => error.code === 'STORAGE_DURABLE_BRIDGE_PACKET_TAMPERED');

const routeSource = await readFile(new URL('./routes/hostingerStorageTenantRoutes.js', import.meta.url), 'utf8');
const tenantRuntimeSource = await readFile(new URL('./hostingerStorageTenantRuntime.js', import.meta.url), 'utf8');
const canarySource = await readFile(new URL('./hostingerStorageTenantCanaryBase.js', import.meta.url), 'utf8');
const executorSource = await readFile(new URL('./hostingerStorageSyntheticExecutor.js', import.meta.url), 'utf8');
const readinessSource = await readFile(new URL('./hostingerStorageDurableTenantRuntimeBridgeReadiness.js', import.meta.url), 'utf8');

assert.match(routeSource, /router\.post\('\/tenant\/storage-operations\/apply-plan'/u);
assert.match(routeSource, /storage_tenant_runtime_unavailable/u);
assert.match(routeSource, /throw fail\(503/u);
assert.match(routeSource, /tenantStorageRuntime = null/u);
assert.match(routeSource, /req\.auth\?\.mode !== 'user_jwt'/u);
assert.match(canarySource, /tenantCanaryRepositories\.has\(repository\)/u);
assert.match(canarySource, /CANONICAL_REPOSITORY_ADAPTER_KEY = 'hostinger_storage_memory_test_adapter_v1'/u);
assert.match(executorSource, /requireFactoryOwnedAdapter\(options\.adapter\);/u);
assert.match(executorSource, /return executeBaseSyntheticPlan\(options\);/u);
assert.match(executorSource, /return reconcileBaseSyntheticOutcome\(options\);/u);
assert.match(tenantRuntimeSource, /synthetic_only: true/u);
assert.equal(/from ['"](?:mysql2|node:child_process|node:net|node:tls)['"]/u.test(readinessSource), false);
assert.equal(/\b(?:exec|execFile|spawn|fork)\s*\(/u.test(readinessSource), false);
assert.equal(connectionCalls, 0);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_durable_tenant_runtime_bridge_readiness',
  readiness_version: HOSTINGER_STORAGE_DURABLE_TENANT_RUNTIME_BRIDGE_READINESS_VERSION,
  required_capabilities: capabilityNames.length,
  current_contract_blockers_proven: blocked.blockers.length,
  exact_route_path_bound: true,
  tenant_user_jwt_required: true,
  memory_only_canary_repository_detected: true,
  parent_aware_translation_blockers_detected: true,
  canonical_executor_wrapper_detected: true,
  semantic_packet_tamper_detection: true,
  digest_packet_tamper_detection: true,
  database_connections_during_evaluation: connectionCalls,
  bridge_created: false,
  authorization_created: false,
  dependency_injected: false,
  runtime_mounted: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}));
