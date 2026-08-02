#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';

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
} from './hostingerStorageAuthorizedMountExecutor.js';
import {
  createHostingerStorageAuthorizedDependencyInjectionController,
  isCanonicalHostingerStorageAuthorizedDependencyInjectionController,
  isCanonicalHostingerStorageMountedRuntimeResolution,
} from './hostingerStorageAuthorizedDependencyInjection.js';
import { buildHostingerStorageTenantRoutes } from './routes/hostingerStorageTenantRoutes.js';

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
const EXPECTED_SHA = 'abcdef1';

function dependencyManifest() {
  return {
    manifest_key: 'hostinger_storage_authorized_mount_dependencies_v1',
    manifest_revision: 'mount-dependencies-rev-001',
    context_resolver_key: 'durable-tenant-storage-context-resolver-v1',
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

function authorizationRecord(manifestDigest) {
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
  };
  record.record_digest = digest(record);
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
    this.tables.records.set(record.authorization_id, {
      record_digest: record.record_digest,
      record_json: JSON.stringify(record),
      row_version: 1,
    });
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

function createMountHarness() {
  const manifest = dependencyManifest();
  const manifestDigest = computeHostingerStorageAuthorizedMountDependencyManifestDigest(manifest);
  const record = authorizationRecord(manifestDigest);
  const database = new FakeDatabase(record);
  const registry = createHostingerStorageDurableMountAuthorizationRegistry({
    pool: new FakePool(database),
    schema_verification: registryVerification(),
  });
  const composition = createHostingerStorageVerifiedSqlRuntimeComposition({
    pool: Object.freeze({
      getConnection() {
        throw new Error('Mount composition SQL must not be reached by this test runtime.');
      },
    }),
    schema_verification: compositionVerification(),
  });
  let runtimeCalls = 0;
  const executor = createHostingerStorageAuthorizedMountExecutor({
    authorization_registry: registry,
    composition,
    dependency_manifest: manifest,
    resolve_execution_context: async () => {
      runtimeCalls += 1;
      const error = new Error('The dynamically mounted Tenant runtime was reached.');
      error.status = 409;
      error.code = 'storage_mounted_runtime_reached';
      throw error;
    },
    load_execution_package: async () => {
      throw new Error('Execution package loading must not occur after the bounded resolver failure.');
    },
    emit_telemetry: async () => {},
  });
  const execution = {
    authorization_id: record.authorization_id,
    authorization_digest: record.authorization_digest,
    executor_id: 'mount-executor-01',
    mount_attempt_id: 'mount-attempt-001',
    operation_id: record.operation_id,
    plan_id: record.plan_id,
    expected_runtime_sha: SOURCE,
    expected_generation: 1,
    now_epoch: NOW,
  };
  return { database, executor, execution, runtimeCalls: () => runtimeCalls };
}

async function startApp(controller) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      mode: 'user_jwt',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      is_admin: false,
    };
    next();
  });
  app.use(buildHostingerStorageTenantRoutes({ tenantStorageRuntimeMount: controller }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function post(app) {
  const response = await fetch(`${app.url}/tenant/storage-operations/apply-plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operation_id: 'operation-001', expected_sha: EXPECTED_SHA }),
  });
  return { status: response.status, body: await response.json() };
}

const harness = createMountHarness();
const bundle = await harness.executor.executeAuthorizedMount(harness.execution);
assert.equal(harness.database.tables.consumptions.size, 1);
assert.equal(harness.database.commits, 1);

const controller = createHostingerStorageAuthorizedDependencyInjectionController();
assert.equal(isCanonicalHostingerStorageAuthorizedDependencyInjectionController(controller), true);
assert.equal(controller.readMount(), null);
assert.equal(controller.exportState().active_mount, null);

const app = await startApp(controller);
try {
  const before = await post(app);
  assert.equal(before.status, 503);
  assert.equal(before.body.error.code, 'storage_tenant_runtime_unavailable');
  assert.equal(harness.runtimeCalls(), 0);

  const readback = controller.injectAuthorizedMount({
    bundle,
    injection_id: 'tenant-route-injection-001',
    expected_mount_bundle_digest: bundle.mount_bundle_digest,
    expected_authorization_id: bundle.authorization_id,
    expected_authorization_digest: bundle.authorization_digest,
    expected_authorization_generation: bundle.authorization_generation,
    expected_runtime_sha: bundle.expected_runtime_sha,
    expected_dependency_manifest_digest: bundle.dependency_manifest_digest,
    now_epoch: NOW + 10,
  });
  assert.equal(readback.dependency_injected, true);
  assert.equal(readback.mount_performed, true);
  assert.equal(readback.runtime_mounted, true);
  assert.equal(readback.route_mounted, true);
  assert.equal(readback.worker_mounted, false);
  assert.equal(readback.provider_dispatch_allowed, false);
  assert.equal(readback.production_ready, false);
  assert.equal(JSON.stringify(readback).includes('tenantStorageRuntime'), false);

  const resolution = controller.resolveMountedRuntime({
    route_path: '/tenant/storage-operations/apply-plan',
    dependency_key: 'tenantStorageRuntime',
    expected_mount_readback_digest: readback.mount_readback_digest,
  });
  assert.equal(isCanonicalHostingerStorageMountedRuntimeResolution(resolution), true);
  assert.equal(Object.keys(resolution).includes('tenantStorageRuntime'), false);

  const mounted = await post(app);
  assert.equal(mounted.status, 409);
  assert.equal(mounted.body.error.code, 'storage_mounted_runtime_reached');
  assert.equal(harness.runtimeCalls(), 1);

  const rollback = controller.rollbackAuthorizedMount({
    injection_id: readback.injection_id,
    expected_mount_readback_digest: readback.mount_readback_digest,
    rollback_id: 'tenant-route-rollback-001',
    reason_code: 'synthetic_readback_complete',
    now_epoch: NOW + 20,
  });
  assert.equal(rollback.runtime_mounted, false);
  assert.equal(rollback.route_mounted, false);
  assert.equal(controller.readMount(), null);

  const afterRollback = await post(app);
  assert.equal(afterRollback.status, 503);
  assert.equal(afterRollback.body.error.code, 'storage_tenant_runtime_unavailable');
  assert.equal(harness.runtimeCalls(), 1);

  const resumedController = createHostingerStorageAuthorizedDependencyInjectionController();
  const resumed = resumedController.resumeAuthorizedMountInjection({ bundle, mount_readback: readback });
  assert.equal(resumed.mount_readback_digest, readback.mount_readback_digest);
  assert.equal(resumedController.readMount().mount_readback_digest, readback.mount_readback_digest);
  assert.equal(harness.database.tables.consumptions.size, 1, 'restart must not consume authorization again');
  assert.equal(harness.database.commits, 1, 'restart must not write registry state again');

  const resumedApp = await startApp(resumedController);
  try {
    const afterRestart = await post(resumedApp);
    assert.equal(afterRestart.status, 409);
    assert.equal(afterRestart.body.error.code, 'storage_mounted_runtime_reached');
    assert.equal(harness.runtimeCalls(), 2);
  } finally {
    resumedApp.server.close();
    await once(resumedApp.server, 'close');
  }

  const driftedReadback = clone(readback);
  driftedReadback.expected_runtime_sha = h('f');
  assert.throws(
    () => createHostingerStorageAuthorizedDependencyInjectionController()
      .resumeAuthorizedMountInjection({ bundle, mount_readback: driftedReadback }),
    (error) => error.code === 'STORAGE_AUTHORIZED_DEPENDENCY_READBACK_DIGEST_MISMATCH',
  );

  assert.throws(
    () => createHostingerStorageAuthorizedDependencyInjectionController().injectAuthorizedMount({
      bundle,
      injection_id: 'tenant-route-injection-drift',
      expected_mount_bundle_digest: h('f'),
      expected_authorization_id: bundle.authorization_id,
      expected_authorization_digest: bundle.authorization_digest,
      expected_authorization_generation: bundle.authorization_generation,
      expected_runtime_sha: bundle.expected_runtime_sha,
      expected_dependency_manifest_digest: bundle.dependency_manifest_digest,
      now_epoch: NOW + 30,
    }),
    (error) => error.code === 'STORAGE_AUTHORIZED_DEPENDENCY_BINDING_MISMATCH'
      && error.details.mismatches.includes('mount_bundle_digest'),
  );
} finally {
  app.server.close();
  await once(app.server, 'close');
}

assert.equal(harness.database.lockAcquisitions, harness.database.lockReleases);
assert.equal(harness.database.rollbacks, 0);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_authorized_dependency_injection',
  mount_bundle_digest: bundle.mount_bundle_digest,
  durable_authorization_consumptions: harness.database.tables.consumptions.size,
  registry_commits: harness.database.commits,
  route_fail_closed_before_injection: true,
  exact_mount_readback: true,
  route_resolves_only_mounted_runtime: true,
  rollback_restores_fail_closed_route: true,
  restart_reconstructs_without_second_consumption: true,
  runtime_mounted_after_rollback: false,
  worker_mounted: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}, null, 2));
