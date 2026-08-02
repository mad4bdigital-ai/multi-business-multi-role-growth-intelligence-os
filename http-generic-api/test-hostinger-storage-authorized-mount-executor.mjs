#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_REGISTRY_VERSION,
  HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_SCHEMA_CONTRACT,
  HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_SCHEMA_DIGEST,
  createHostingerStorageDurableMountAuthorizationRegistry,
} from './hostingerStorageDurableMountAuthorizationRegistry.js';
import {
  HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION,
  createHostingerStorageVerifiedSqlRuntimeComposition,
} from './hostingerStorageVerifiedSqlRuntimeComposition.js';
import { HOSTINGER_STORAGE_DURABLE_TENANT_REPOSITORY_FACADE_VERSION } from './hostingerStorageDurableTenantRepositoryFacade.js';
import { HOSTINGER_STORAGE_TENANT_RUNTIME_VERSION } from './hostingerStorageTenantRuntime.js';
import {
  computeHostingerStorageAuthorizedMountDependencyManifestDigest,
  createHostingerStorageAuthorizedMountExecutor,
  isCanonicalHostingerStorageAuthorizedMountBundle,
  isCanonicalHostingerStorageAuthorizedMountExecutor,
} from './hostingerStorageAuthorizedMountExecutor.js';

const h = (character) => character.repeat(64);
const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : (!value || typeof value !== 'object'
      ? value
      : Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])));
const digest = (value) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const clone = (value) => structuredClone(value);
const NOW = 1_786_000_000;
const SOURCE = h('1');
const DATABASE = h('d');
const SCHEMA = h('a');
const AUTHORIZATION_DIGEST = h('2');

function dependencyManifest(overrides = {}) {
  return {
    manifest_key: 'hostinger_storage_authorized_mount_dependencies_v1',
    manifest_revision: 'mount-dependencies-rev-001',
    context_resolver_key: 'context-kernel-tenant-storage-resolver-v1',
    context_resolver_version: '1.0.0',
    execution_package_loader_key: 'durable-tenant-storage-package-loader-v1',
    execution_package_loader_version: '1.0.0',
    telemetry_sink_key: 'tenant-storage-audit-telemetry-v1',
    telemetry_sink_version: '1.0.0',
    route_path: '/tenant/storage-operations/apply-plan',
    dependency_key: 'tenantStorageRuntime',
    tenant_runtime_version: HOSTINGER_STORAGE_TENANT_RUNTIME_VERSION,
    repository_facade_version: HOSTINGER_STORAGE_DURABLE_TENANT_REPOSITORY_FACADE_VERSION,
    composition_version: HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION,
    authorization_registry_version: HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_REGISTRY_VERSION,
    synthetic_only: true,
    direct_provider_dispatch_allowed: false,
    duplicate_write_paths_allowed: false,
    secrets_included: false,
    ...overrides,
  };
}

function compositionVerification() {
  return {
    ready: true,
    schema_verified: true,
    blockers: [],
    production_ready: false,
    authority_granted: false,
    migration_apply_authorized: false,
    provider_dispatch_allowed: false,
    evidence_digest: SCHEMA,
    evidence: {
      source_commit: SOURCE,
      deployed_runtime_sha: SOURCE,
      runtime_parity: true,
      readback_cycle_id: 'mount-runtime-readback-cycle-001',
      readback_digest: h('c'),
      migration_evidence_digest: h('f'),
      database_fingerprint: DATABASE,
      verified_at: '2026-08-02T07:00:00.000Z',
      expires_at: '2099-01-01T00:15:00.000Z',
    },
    secrets_included: false,
  };
}

function registryVerification() {
  return {
    ready: true,
    schema_verified: true,
    blockers: [],
    production_ready: false,
    authority_granted: false,
    migration_apply_authorized: false,
    provider_dispatch_allowed: false,
    evidence_digest: h('e'),
    evidence: {
      source_commit: SOURCE,
      deployed_runtime_sha: SOURCE,
      runtime_parity: true,
      database_fingerprint: DATABASE,
      readback_cycle_id: 'mount-registry-readback-cycle-001',
      expires_at: '2099-01-01T00:15:00.000Z',
      mount_authorization_registry_schema: {
        contract_key: HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_SCHEMA_CONTRACT.contract_key,
        contract_digest: HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_SCHEMA_DIGEST,
        tables: [...HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_SCHEMA_CONTRACT.tables],
        secrets_included: false,
      },
      secrets_included: false,
    },
    secrets_included: false,
  };
}

function authorizationRecord(manifestDigest, overrides = {}) {
  const record = {
    authorization_id: 'mount-auth-001',
    authorization_digest: AUTHORIZATION_DIGEST,
    authorization_revision: 'mount-auth-rev-001',
    issuer_principal_id: 'platform-release-authority',
    source_commit: SOURCE,
    deployed_runtime_sha: SOURCE,
    database_fingerprint: DATABASE,
    schema_verification_digest: SCHEMA,
    readback_cycle_id: 'mount-runtime-readback-cycle-001',
    bridge_readiness_digest: h('3'),
    fixed_dispatch_certification_digest: h('4'),
    worker_certification_digest: h('5'),
    authorization_bundle_hash: h('6'),
    target_id: 'target-hostinger-primary',
    operation_id: 'operation-001',
    plan_id: 'plan-001',
    plan_hash: h('7'),
    execution_lease_id: 'lease-001',
    lease_generation: 3,
    approval_set_hash: h('8'),
    capability_envelope_digest: h('9'),
    mount_policy_fingerprint: manifestDigest,
    rollback_plan_digest: h('b'),
    route_path: '/tenant/storage-operations/apply-plan',
    dependency_key: 'tenantStorageRuntime',
    authorization_status: 'approved',
    authorization_mode: 'single_use_mount',
    generation: 1,
    expires_at_epoch: NOW + 3600,
    consumed: false,
    consumed_by_executor_id: null,
    mount_attempt_id: null,
    consumed_at_epoch: null,
    secrets_included: false,
    ...overrides,
  };
  const unsigned = { ...record };
  delete unsigned.record_digest;
  record.record_digest = digest(unsigned);
  return Object.freeze(record);
}

class FakeDatabase {
  constructor(record) {
    this.tables = { records: new Map(), consumptions: new Map() };
    this.connections = 0;
    this.commits = 0;
    this.rollbacks = 0;
    this.lockAcquisitions = 0;
    this.lockReleases = 0;
    if (record) {
      this.tables.records.set(record.authorization_id, {
        record_digest: record.record_digest,
        record_json: JSON.stringify(record),
        row_version: 1,
      });
    }
  }
}

class FakeConnection {
  constructor(database) { this.database = database; this.working = null; }
  async beginTransaction() { this.working = clone(this.database.tables); }
  async commit() { this.database.tables = this.working; this.working = null; this.database.commits += 1; }
  async rollback() { this.working = null; this.database.rollbacks += 1; }
  release() {}
  table(name) { return (this.working || this.database.tables)[name]; }

  async execute(sql, params = []) {
    if (sql.includes('spec014:mount-auth:lock:acquire')) {
      this.database.lockAcquisitions += 1;
      return [[{ acquired: 1 }], []];
    }
    if (sql.includes('spec014:mount-auth:lock:release')) {
      this.database.lockReleases += 1;
      return [[{ released: 1 }], []];
    }
    if (sql.includes('spec014:mount-auth:load-record')) {
      const row = this.table('records').get(params[0]);
      return [row ? [clone(row)] : [], []];
    }
    if (sql.includes('spec014:mount-auth:load-consumption')) {
      const row = this.table('consumptions').get(params[0]);
      return [row ? [clone(row)] : [], []];
    }
    if (sql.includes('spec014:mount-auth:update-consumed')) {
      const id = params[6];
      const expectedGeneration = Number(params[7]);
      const expectedVersion = Number(params[8]);
      const current = this.table('records').get(id);
      const currentRecord = current ? JSON.parse(current.record_json) : null;
      if (!current || currentRecord.generation !== expectedGeneration
        || currentRecord.consumed !== false || Number(current.row_version) !== expectedVersion) {
        return [{ affectedRows: 0 }, []];
      }
      this.table('records').set(id, {
        record_digest: params[4],
        record_json: params[5],
        row_version: expectedVersion + 1,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('spec014:mount-auth:insert-consumption')) {
      const authorizationId = params[1];
      if (this.table('consumptions').has(authorizationId)) {
        const error = new Error('duplicate receipt');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      this.table('consumptions').set(authorizationId, {
        record_digest: params[10],
        record_json: params[11],
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('spec014:mount-auth:export-records')) {
      return [[...this.table('records').values()].map(clone), []];
    }
    if (sql.includes('spec014:mount-auth:export-consumptions')) {
      return [[...this.table('consumptions').values()].map(clone), []];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

class FakePool {
  constructor(database) { this.database = database; }
  async getConnection() {
    this.database.connections += 1;
    return new FakeConnection(this.database);
  }
}

function createHarness(recordOverrides = {}) {
  const manifest = dependencyManifest();
  const manifestDigest = computeHostingerStorageAuthorizedMountDependencyManifestDigest(manifest);
  const record = authorizationRecord(manifestDigest, recordOverrides);
  const database = new FakeDatabase(record);
  const registry = createHostingerStorageDurableMountAuthorizationRegistry({
    pool: new FakePool(database),
    schema_verification: registryVerification(),
  });
  let compositionConnections = 0;
  const composition = createHostingerStorageVerifiedSqlRuntimeComposition({
    pool: Object.freeze({
      getConnection() {
        compositionConnections += 1;
        throw new Error('Executor construction must not access the runtime database.');
      },
    }),
    schema_verification: compositionVerification(),
  });
  let runtimeDependencyCalls = 0;
  const executor = createHostingerStorageAuthorizedMountExecutor({
    authorization_registry: registry,
    composition,
    dependency_manifest: manifest,
    resolve_execution_context: async () => {
      runtimeDependencyCalls += 1;
      throw new Error('Mount bundle creation must not execute the Tenant runtime.');
    },
    load_execution_package: async () => {
      runtimeDependencyCalls += 1;
      throw new Error('Mount bundle creation must not load an execution package.');
    },
    emit_telemetry: async () => {
      runtimeDependencyCalls += 1;
    },
  });
  return {
    database, registry, composition, executor, manifest, manifestDigest,
    record, compositionConnections: () => compositionConnections,
    runtimeDependencyCalls: () => runtimeDependencyCalls,
  };
}

const harness = createHarness();
assert.equal(harness.database.connections, 0, 'executor factory must not access registry SQL');
assert.equal(harness.compositionConnections(), 0, 'executor factory must not access runtime SQL');
assert.equal(harness.runtimeDependencyCalls(), 0, 'executor factory must not execute runtime dependencies');
assert.equal(isCanonicalHostingerStorageAuthorizedMountExecutor(harness.executor), true);
assert.equal(harness.executor.dependency_injection_allowed, false);
assert.equal(harness.executor.mount_performed, false);
assert.equal(harness.executor.provider_dispatch_allowed, false);
assert.equal('authorization_registry' in harness.executor, false);
assert.equal('composition' in harness.executor, false);
assert.equal('repository' in harness.executor, false);

const execution = {
  authorization_id: 'mount-auth-001',
  authorization_digest: AUTHORIZATION_DIGEST,
  executor_id: 'mount-executor-01',
  mount_attempt_id: 'mount-attempt-001',
  operation_id: 'operation-001',
  plan_id: 'plan-001',
  expected_runtime_sha: SOURCE,
  expected_generation: 1,
  now_epoch: NOW,
};

const bundle = await harness.executor.executeAuthorizedMount(execution);
assert.equal(isCanonicalHostingerStorageAuthorizedMountBundle(bundle), true);
assert.equal(bundle.ready_for_dependency_injection, true);
assert.equal(bundle.authorization_generation, 2);
assert.equal(bundle.dependency_injected, false);
assert.equal(bundle.mount_performed, false);
assert.equal(bundle.runtime_mounted, false);
assert.equal(bundle.route_mounted, false);
assert.equal(bundle.worker_mounted, false);
assert.equal(bundle.provider_dispatch_allowed, false);
assert.equal(bundle.production_ready, false);
assert.equal(typeof bundle.tenantStorageRuntime.execute, 'function');
assert.equal(bundle.tenantStorageRuntime.synthetic_only, true);
assert.equal(Object.getOwnPropertyDescriptor(bundle, 'tenantStorageRuntime').enumerable, false);
assert.equal(Object.keys(bundle).includes('tenantStorageRuntime'), false);
assert.equal(harness.database.tables.consumptions.size, 1);
assert.equal(harness.runtimeDependencyCalls(), 0);
assert.equal(harness.compositionConnections(), 0);

await assert.rejects(
  harness.executor.executeAuthorizedMount(execution),
  (error) => error.code === 'STORAGE_AUTHORIZED_MOUNT_BINDING_MISMATCH',
);
assert.equal(harness.database.tables.consumptions.size, 1);

const resumed = await harness.executor.resumeAuthorizedMount(execution);
assert.equal(isCanonicalHostingerStorageAuthorizedMountBundle(resumed), true);
assert.equal(resumed.mount_bundle_digest, bundle.mount_bundle_digest);
assert.equal(harness.database.tables.consumptions.size, 1);
assert.equal(harness.runtimeDependencyCalls(), 0);

await assert.rejects(
  harness.executor.resumeAuthorizedMount({ ...execution, expected_generation: 2 }),
  (error) => error.code === 'STORAGE_AUTHORIZED_MOUNT_RESUME_BINDING_MISMATCH'
    && error.details.mismatches.includes('receipt.registered_generation'),
);

const manifestDrift = createHarness({ mount_policy_fingerprint: h('f') });
await assert.rejects(
  manifestDrift.executor.executeAuthorizedMount(execution),
  (error) => error.code === 'STORAGE_AUTHORIZED_MOUNT_BINDING_MISMATCH'
    && error.details.mismatches.includes('mount_policy_fingerprint'),
);
assert.equal(manifestDrift.database.tables.consumptions.size, 0);

const provenanceDrift = createHarness({ database_fingerprint: h('c') });
await assert.rejects(
  provenanceDrift.executor.executeAuthorizedMount(execution),
  (error) => error.code === 'STORAGE_AUTHORIZED_MOUNT_BINDING_MISMATCH'
    && error.details.mismatches.includes('database_fingerprint'),
);
assert.equal(provenanceDrift.database.tables.consumptions.size, 0);

await assert.rejects(
  harness.executor.resumeAuthorizedMount({ ...execution, api_key: 'forbidden' }),
  (error) => error.code === 'STORAGE_AUTHORIZED_MOUNT_SECRET_OR_UNSAFE_FIELD_REJECTED',
);

assert.throws(
  () => createHostingerStorageAuthorizedMountExecutor({
    authorization_registry: harness.registry,
    composition: harness.composition,
    dependency_manifest: dependencyManifest({ direct_provider_dispatch_allowed: true }),
    resolve_execution_context: async () => ({}),
    load_execution_package: async () => ({}),
  }),
  (error) => error.code === 'STORAGE_AUTHORIZED_MOUNT_DEPENDENCY_MANIFEST_INVALID',
);

assert.equal(harness.database.lockAcquisitions, harness.database.lockReleases);
assert.equal(harness.database.commits, 1);
assert.equal(harness.database.rollbacks, 0);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_authorized_mount_executor',
  mount_bundle_digest: bundle.mount_bundle_digest,
  authorization_generation: bundle.authorization_generation,
  immutable_consumption_count: harness.database.tables.consumptions.size,
  runtime_dependency_calls: harness.runtimeDependencyCalls(),
  runtime_database_connections: harness.compositionConnections(),
  ready_for_dependency_injection: true,
  automatic_retry_allowed: false,
  dependency_injected: false,
  mount_performed: false,
  runtime_mounted: false,
  route_mounted: false,
  worker_mounted: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}, null, 2));
