#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildHostingerStorageDedicatedWorkerCertification } from './hostingerStorageDedicatedWorkerCertification.js';
import { buildHostingerStorageFixedDispatchCertification } from './hostingerStorageFixedDispatchCertification.js';
import { buildHostingerStorageSeparateMountAuthorization } from './hostingerStorageSeparateMountAuthorization.js';
import {
  HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_SCHEMA_CONTRACT,
  HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_SCHEMA_DIGEST,
  createHostingerStorageDurableMountAuthorizationRegistry,
  isCanonicalHostingerStorageDurableMountAuthorizationRegistry,
} from './hostingerStorageDurableMountAuthorizationRegistry.js';

const h = (character) => character.repeat(64);
const clone = (value) => structuredClone(value);
const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : (!value || typeof value !== 'object'
      ? value
      : Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])));
const digest = (value) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const NOW_MS = Date.parse('2026-08-02T06:30:00.000Z');
const NOW_EPOCH = Math.floor(NOW_MS / 1000);
const D = Object.freeze({
  source: h('1'), image: h('2'), provenance: h('3'), resolution: h('4'),
  policy: h('5'), tools: h('6'), program: h('7'), host: h('8'),
  dispatcher: h('9'), auth: h('a'), args: h('b'), root: h('c'),
  confirm: h('d'), credential: h('e'), plan: h('f'), database: h('0'),
  schema: 'a1'.repeat(32), approval: 'b1'.repeat(32), capability: 'c1'.repeat(32),
  mountPolicy: 'd1'.repeat(32), rollback: 'e1'.repeat(32),
});

function workerPacket() {
  const evidence = {
    contract: 'spec014.hostinger-storage-dedicated-worker-evidence.v1',
    observed_at: '2026-08-02T06:00:00.000Z',
    expires_at: '2026-08-02T07:00:00.000Z',
    source_commit: D.source,
    target_id: 'target-hostinger-primary',
    worker: {
      worker_id: 'worker-hostinger-storage-01',
      worker_kind: 'dedicated_provider_worker',
      execution_domain: 'hostinger_storage',
      principal_id: 'principal-provider-worker-01',
      release_id: 'worker-release-2026.08.02.1',
      image_digest: D.image,
      artifact_provenance_digest: D.provenance,
      dedicated: true,
      public_runtime: false,
      ephemeral_execution: true,
      secrets_included: false,
    },
    adapter: {
      adapter_key: 'hostinger_ssh_storage_v1',
      operation_key: 'apply_exact_plan',
      reviewed_program_key: 'hostinger-storage-cleanup.sh',
      reviewed_program_digest: D.program,
      structured_arguments_only: true,
      free_form_command_allowed: false,
      free_form_root_allowed: false,
      wildcard_allowed: false,
      secrets_included: false,
    },
    toolchain: {
      resolution_fingerprint: D.resolution,
      policy_fingerprint: D.policy,
      selected_tools_digest: D.tools,
      binaries_verified: true,
      unapproved_binary_allowed: false,
      secrets_included: false,
    },
    host_key: {
      revision: 'host-key-revision-17',
      algorithm: 'ssh-ed25519',
      fingerprint_digest: D.host,
      pinned: true,
      verification_required: true,
      mismatch_fails_closed: true,
      secrets_included: false,
    },
    isolation: {
      public_runtime_dispatch_allowed: false,
      direct_http_dispatch_allowed: false,
      authority_resolution_allowed: false,
      approval_resolution_allowed: false,
      plan_mutation_allowed: false,
      credential_reference_resolution: 'worker_only',
      credential_values_in_evidence: false,
      provider_egress_scope: 'hostinger_target_only',
      inbound_network_listener: false,
      shell_input_allowed: false,
      filesystem_input_from_request_allowed: false,
      secrets_included: false,
    },
    repository_only: true,
    worker_process_started: false,
    provider_calls: 0,
    credential_resolutions: 0,
    runtime_mounts: 0,
    secrets_included: false,
  };
  const expected = {
    target_id: 'target-hostinger-primary',
    source_commit: D.source,
    worker_id: 'worker-hostinger-storage-01',
    worker_principal_id: 'principal-provider-worker-01',
    worker_release_id: 'worker-release-2026.08.02.1',
    worker_image_digest: D.image,
    artifact_provenance_digest: D.provenance,
    toolchain_resolution_fingerprint: D.resolution,
    toolchain_policy_fingerprint: D.policy,
    selected_tools_digest: D.tools,
    reviewed_program_digest: D.program,
    host_key_revision: 'host-key-revision-17',
    host_key_algorithm: 'ssh-ed25519',
    host_key_fingerprint_digest: D.host,
  };
  return buildHostingerStorageDedicatedWorkerCertification({ evidence, expected, now: NOW_MS });
}

function dispatchPacket() {
  const worker = workerPacket();
  const expected = {
    source_commit: D.source,
    dispatcher_id: 'dispatcher-hostinger-storage-01',
    dispatcher_release_id: 'dispatcher-release-2026.08.02.1',
    dispatcher_artifact_digest: D.dispatcher,
    worker_certification_digest: worker.certification_digest,
    operation_id: 'operation-001',
    target_id: 'target-hostinger-primary',
    plan_id: 'plan-001',
    plan_hash: D.plan,
    execution_lease_id: 'lease-001',
    lease_generation: 3,
    authorization_bundle_hash: D.auth,
    arguments_schema_digest: D.args,
    storage_root_ref_digest: D.root,
    typed_confirmation_digest: D.confirm,
    credential_binding_digest: D.credential,
    host_key_revision: 'host-key-revision-17',
    host_key_fingerprint_digest: D.host,
    reviewed_program_digest: D.program,
  };
  const evidence = {
    contract: 'spec014.hostinger-storage-fixed-dispatch-evidence.v1',
    observed_at: '2026-08-02T06:05:00.000Z',
    expires_at: '2026-08-02T07:00:00.000Z',
    source_commit: D.source,
    dispatcher: {
      dispatcher_id: 'dispatcher-hostinger-storage-01',
      dispatcher_kind: 'fixed_internal_dispatcher',
      release_id: 'dispatcher-release-2026.08.02.1',
      artifact_digest: D.dispatcher,
      internal_only: true,
      public_http: false,
      public_runtime: false,
      default_off: true,
      queue_key: 'hostinger_storage_dispatch_v1',
      single_operation: true,
      secrets_included: false,
    },
    invocation: {
      adapter_key: 'hostinger_ssh_storage_v1',
      operation_key: 'apply_exact_plan',
      provider_action: 'apply',
      fixed_script_ref: 'repo:http-generic-api/scripts/hostinger-storage-cleanup.sh',
      reviewed_program_digest: D.program,
      operation_id: 'operation-001',
      target_id: 'target-hostinger-primary',
      plan_id: 'plan-001',
      expected_plan_hash: D.plan,
      execution_lease_id: 'lease-001',
      lease_generation: 3,
      authorization_bundle_hash: D.auth,
      arguments_schema_digest: D.args,
      storage_root_ref_digest: D.root,
      typed_confirmation_digest: D.confirm,
      credential_binding_digest: D.credential,
      host_key_revision: 'host-key-revision-17',
      host_key_fingerprint_digest: D.host,
      structured_arguments_only: true,
      credential_reference_only: true,
      shell_command_present: false,
      wildcard_allowed: false,
      arbitrary_root_allowed: false,
      output_policy: 'bounded_redacted_json',
      secrets_included: false,
    },
    boundary: {
      repository_only: true,
      dispatcher_created: false,
      dispatch_job_enqueued: false,
      worker_invoked: false,
      provider_calls: 0,
      credential_resolutions: 0,
      runtime_mounts: 0,
      secrets_included: false,
    },
    secrets_included: false,
  };
  return buildHostingerStorageFixedDispatchCertification({
    worker_certification: worker,
    evidence,
    expected,
    now: NOW_MS,
  });
}

function bridgePacket() {
  const capabilities = {
    canonical_repository_facade_ready: true,
    plan_item_parent_registration_ready: true,
    run_parent_creation_ready: true,
    journal_translation_ready: true,
    reconciliation_translation_ready: true,
    durable_authority_store_ready: true,
    durable_enablement_registry_ready: true,
    tenant_safe_projection_ready: true,
    worker_certification_ready: true,
    fixed_dispatch_ready: true,
    crash_safe_restart_reconciliation_ready: true,
  };
  const core = {
    contract: 'spec014.hostinger-storage-durable-tenant-runtime-bridge-readiness.v1',
    version: 'spec014-hostinger-storage-durable-tenant-runtime-bridge-readiness-v1',
    composition: {
      composition_key: 'hostinger_storage_verified_sql_runtime_composition_v1',
      composition_version: 'v1',
      schema_verification_digest: D.schema,
      database_fingerprint: D.database,
      source_commit: D.source,
      deployed_runtime_sha: D.source,
      readback_cycle_id: 'readback-cycle-001',
      secrets_included: false,
    },
    evidence: {
      contract: 'spec014.hostinger-storage-durable-tenant-runtime-bridge-evidence.v1',
      observed_at: '2026-08-02T05:50:00.000Z',
      expires_at: '2026-08-02T07:00:00.000Z',
      capabilities,
      secrets_included: false,
    },
    blockers: [],
    ready_for_separate_mount_authorization: true,
    bridge_created: false,
    authorization_created: false,
    dependency_injected: false,
    runtime_mounted: false,
    route_mounted: false,
    worker_mounted: false,
    database_writes_performed_by_evaluator: 0,
    provider_dispatch_allowed: false,
    production_ready: false,
    secrets_included: false,
  };
  return { ...core, readiness_digest: digest(core) };
}

function authorizationPacket() {
  const bridge = bridgePacket();
  const dispatch = dispatchPacket();
  const expected = {
    authorization_id: 'mount-auth-001',
    authorization_revision: 'mount-auth-rev-001',
    mount_generation: 1,
    issuer_principal_id: 'platform-release-authority',
    source_commit: D.source,
    deployed_runtime_sha: D.source,
    database_fingerprint: D.database,
    schema_verification_digest: D.schema,
    readback_cycle_id: 'readback-cycle-001',
    bridge_readiness_digest: bridge.readiness_digest,
    fixed_dispatch_certification_digest: dispatch.certification_digest,
    worker_certification_digest: dispatch.worker_certification.certification_digest,
    authorization_bundle_hash: D.auth,
    target_id: 'target-hostinger-primary',
    operation_id: 'operation-001',
    plan_id: 'plan-001',
    plan_hash: D.plan,
    execution_lease_id: 'lease-001',
    lease_generation: 3,
    approval_set_hash: D.approval,
    capability_envelope_digest: D.capability,
    mount_policy_fingerprint: D.mountPolicy,
    rollback_plan_digest: D.rollback,
  };
  const evidence = {
    contract: 'spec014.hostinger-storage-separate-mount-authorization-evidence.v1',
    observed_at: '2026-08-02T06:20:00.000Z',
    expires_at: '2026-08-02T07:00:00.000Z',
    authorization: {
      ...expected,
      status: 'approved',
      mode: 'single_use_mount',
      one_shot: true,
      consumed: false,
      default_off: true,
      secrets_included: false,
    },
    route: {
      path: '/tenant/storage-operations/apply-plan',
      dependency_key: 'tenantStorageRuntime',
      fail_closed_status: 503,
      currently_unmounted: true,
      tenant_user_jwt_required: true,
      secrets_included: false,
    },
    boundary: {
      repository_only: true,
      authorization_persisted: false,
      mount_performed: false,
      dependency_injected: false,
      runtime_mounted: false,
      route_mounted: false,
      worker_mounted: false,
      dispatch_job_enqueued: false,
      credential_resolutions: 0,
      database_writes: 0,
      provider_calls: 0,
      secrets_included: false,
    },
    secrets_included: false,
  };
  return buildHostingerStorageSeparateMountAuthorization({
    bridge_readiness: bridge,
    fixed_dispatch_certification: dispatch,
    evidence,
    expected,
    now: NOW_MS,
  });
}

class FakeMountAuthorizationDatabase {
  constructor() {
    this.tables = { records: new Map(), consumptions: new Map() };
    this.connections = 0;
    this.commits = 0;
    this.rollbacks = 0;
    this.lockAcquisitions = 0;
    this.lockReleases = 0;
    this.forceNextCasMiss = false;
  }
}

class FakeMountAuthorizationConnection {
  constructor(database) {
    this.database = database;
    this.working = null;
  }
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
    if (sql.includes('spec014:mount-auth:insert-record')) {
      const id = params[0];
      if (this.table('records').has(id)) {
        const error = new Error('duplicate record');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      this.table('records').set(id, {
        id,
        authorization_digest: params[1],
        authorization_revision: params[2],
        issuer_principal_id: params[3],
        source_commit: params[4],
        deployed_runtime_sha: params[5],
        database_fingerprint: params[6],
        schema_verification_digest: params[7],
        readback_cycle_id: params[8],
        authorization_bundle_hash: params[9],
        target_id: params[10],
        operation_id: params[11],
        plan_id: params[12],
        plan_hash: params[13],
        execution_lease_id: params[14],
        lease_generation: Number(params[15]),
        generation: Number(params[16]),
        expires_at_epoch: Number(params[17]),
        consumed: 0,
        consumed_by_executor_id: null,
        mount_attempt_id: null,
        consumed_at_epoch: null,
        record_digest: params[18],
        record_json: params[19],
        row_version: 1,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('spec014:mount-auth:update-consumed')) {
      const id = params[6];
      const expectedGeneration = Number(params[7]);
      const expectedVersion = Number(params[8]);
      const current = this.table('records').get(id);
      if (this.database.forceNextCasMiss) {
        this.database.forceNextCasMiss = false;
        return [{ affectedRows: 0 }, []];
      }
      if (!current || Number(current.generation) !== expectedGeneration
        || Number(current.consumed) !== 0 || Number(current.row_version) !== expectedVersion) {
        return [{ affectedRows: 0 }, []];
      }
      this.table('records').set(id, {
        ...current,
        generation: Number(params[0]),
        consumed: 1,
        consumed_by_executor_id: params[1],
        mount_attempt_id: params[2],
        consumed_at_epoch: Number(params[3]),
        record_digest: params[4],
        record_json: params[5],
        row_version: expectedVersion + 1,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('spec014:mount-auth:insert-consumption')) {
      const authorizationId = params[1];
      if (this.table('consumptions').has(authorizationId)) {
        const error = new Error('duplicate consumption');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      this.table('consumptions').set(authorizationId, {
        id: params[0],
        authorization_id: authorizationId,
        authorization_digest: params[2],
        executor_id: params[3],
        mount_attempt_id: params[4],
        operation_id: params[5],
        plan_id: params[6],
        registered_generation: Number(params[7]),
        consumed_generation: Number(params[8]),
        consumed_at_epoch: Number(params[9]),
        record_digest: params[10],
        record_json: params[11],
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('spec014:mount-auth:export-records')) {
      return [[...this.table('records').values()].sort((a, b) => a.id.localeCompare(b.id)).map(clone), []];
    }
    if (sql.includes('spec014:mount-auth:export-consumptions')) {
      return [[...this.table('consumptions').values()].sort((a, b) => a.authorization_id.localeCompare(b.authorization_id)).map(clone), []];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

class FakeMountAuthorizationPool {
  constructor(database) { this.database = database; }
  async getConnection() {
    this.database.connections += 1;
    return new FakeMountAuthorizationConnection(this.database);
  }
}

const schemaVerification = {
  ready: true,
  schema_verified: true,
  production_ready: false,
  authority_granted: false,
  migration_apply_authorized: false,
  provider_dispatch_allowed: false,
  evidence_digest: h('e'),
  blockers: [],
  evidence: {
    source_commit: D.source,
    deployed_runtime_sha: D.source,
    runtime_parity: true,
    database_fingerprint: D.database,
    readback_cycle_id: 'mount-auth-schema-readback-cycle-1',
    expires_at: '2099-08-02T00:15:00.000Z',
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

assert.throws(
  () => createHostingerStorageDurableMountAuthorizationRegistry({
    pool: new FakeMountAuthorizationPool(new FakeMountAuthorizationDatabase()),
    schema_verification: {
      ...schemaVerification,
      evidence: {
        ...schemaVerification.evidence,
        mount_authorization_registry_schema: {
          ...schemaVerification.evidence.mount_authorization_registry_schema,
          contract_digest: h('0'),
        },
      },
    },
  }),
  (error) => error.code === 'STORAGE_DURABLE_MOUNT_AUTH_SCHEMA_CONTRACT_MISMATCH',
);

const database = new FakeMountAuthorizationDatabase();
const registry = createHostingerStorageDurableMountAuthorizationRegistry({
  pool: new FakeMountAuthorizationPool(database),
  schema_verification: schemaVerification,
});

assert.equal(database.connections, 0, 'factory creation must not connect to the database');
assert.equal(isCanonicalHostingerStorageDurableMountAuthorizationRegistry(registry), true);
assert.equal(registry.mount_execution_allowed, false);
assert.equal(registry.automatic_retry_allowed, false);
assert.equal(registry.runtime_mounted, false);
assert.equal('pool' in registry, false);

const packet = authorizationPacket();
const registered = await registry.register({
  authorization_packet: packet,
  expected_digest: packet.authorization_digest,
  now_epoch: NOW_EPOCH,
});
assert.equal(registered.created, true);
assert.equal(registered.authorization.generation, 1);
assert.equal(registered.authorization.consumed, false);
assert.equal(registered.row_version, 1);
assert.equal(await registry.readConsumption('mount-auth-001'), null);

const replay = await registry.register({
  authorization_packet: packet,
  expected_digest: packet.authorization_digest,
  now_epoch: NOW_EPOCH,
});
assert.equal(replay.replay, true);
assert.equal(database.tables.records.size, 1);

const tamperedPacket = structuredClone(packet);
tamperedPacket.authorization_digest = h('2');
await assert.rejects(
  registry.register({
    authorization_packet: tamperedPacket,
    expected_digest: tamperedPacket.authorization_digest,
    now_epoch: NOW_EPOCH,
  }),
  (error) => error.code === 'STORAGE_DURABLE_MOUNT_AUTH_PACKET_INVALID',
);

await assert.rejects(
  registry.consume({
    authorization_id: 'mount-auth-001',
    authorization_digest: h('2'),
    executor_id: 'mount-executor-01',
    mount_attempt_id: 'mount-attempt-001',
    operation_id: 'operation-001',
    plan_id: 'plan-001',
    expected_runtime_sha: D.source,
    expected_generation: 1,
    now_epoch: NOW_EPOCH + 60,
  }),
  (error) => error.code === 'STORAGE_DURABLE_MOUNT_AUTH_BINDING_MISMATCH',
);

await assert.rejects(
  registry.consume({
    authorization_id: 'mount-auth-001',
    authorization_digest: packet.authorization_digest,
    executor_id: 'mount-executor-01',
    mount_attempt_id: 'mount-attempt-001',
    operation_id: 'operation-001',
    plan_id: 'plan-001',
    expected_runtime_sha: D.source,
    expected_generation: 2,
    now_epoch: NOW_EPOCH + 60,
  }),
  (error) => error.code === 'STORAGE_DURABLE_MOUNT_AUTH_GENERATION_MISMATCH',
);

const consumed = await registry.consume({
  authorization_id: 'mount-auth-001',
  authorization_digest: packet.authorization_digest,
  executor_id: 'mount-executor-01',
  mount_attempt_id: 'mount-attempt-001',
  operation_id: 'operation-001',
  plan_id: 'plan-001',
  expected_runtime_sha: D.source,
  expected_generation: 1,
  now_epoch: NOW_EPOCH + 60,
});
assert.equal(consumed.consumed, true);
assert.equal(consumed.previous_generation, 1);
assert.equal(consumed.current_generation, 2);
assert.equal(consumed.row_version, 2);
assert.equal(consumed.authorization.consumed_by_executor_id, 'mount-executor-01');
assert.equal(consumed.authorization.mount_attempt_id, 'mount-attempt-001');
assert.equal(consumed.consumption.registered_generation, 1);
assert.equal(consumed.consumption.consumed_generation, 2);
assert.equal(consumed.authorized_mount_execution_may_begin, true);
assert.equal(consumed.mount_performed, false);
assert.equal(database.tables.consumptions.size, 1);

await assert.rejects(
  registry.consume({
    authorization_id: 'mount-auth-001',
    authorization_digest: packet.authorization_digest,
    executor_id: 'mount-executor-01',
    mount_attempt_id: 'mount-attempt-002',
    operation_id: 'operation-001',
    plan_id: 'plan-001',
    expected_runtime_sha: D.source,
    expected_generation: 2,
    now_epoch: NOW_EPOCH + 61,
  }),
  (error) => error.code === 'STORAGE_DURABLE_MOUNT_AUTH_ALREADY_CONSUMED',
);

await assert.rejects(
  registry.register({
    authorization_packet: packet,
    expected_digest: packet.authorization_digest,
    now_epoch: NOW_EPOCH,
  }),
  (error) => error.code === 'STORAGE_DURABLE_MOUNT_AUTH_ID_CONFLICT',
);

const casDatabase = new FakeMountAuthorizationDatabase();
const casRegistry = createHostingerStorageDurableMountAuthorizationRegistry({
  pool: new FakeMountAuthorizationPool(casDatabase),
  schema_verification: schemaVerification,
});
await casRegistry.register({
  authorization_packet: packet,
  expected_digest: packet.authorization_digest,
  now_epoch: NOW_EPOCH,
});
casDatabase.forceNextCasMiss = true;
await assert.rejects(
  casRegistry.consume({
    authorization_id: 'mount-auth-001',
    authorization_digest: packet.authorization_digest,
    executor_id: 'mount-executor-01',
    mount_attempt_id: 'mount-attempt-cas',
    operation_id: 'operation-001',
    plan_id: 'plan-001',
    expected_runtime_sha: D.source,
    expected_generation: 1,
    now_epoch: NOW_EPOCH + 60,
  }),
  (error) => error.code === 'STORAGE_DURABLE_MOUNT_AUTH_CAS_CONFLICT',
);
assert.equal((await casRegistry.read('mount-auth-001')).consumed, false);
assert.equal(await casRegistry.readConsumption('mount-auth-001'), null);

await assert.rejects(
  registry.consume({
    authorization_id: 'mount-auth-001',
    authorization_digest: packet.authorization_digest,
    executor_id: 'mount-executor-01',
    mount_attempt_id: 'mount-attempt-unsafe',
    operation_id: 'operation-001',
    plan_id: 'plan-001',
    expected_runtime_sha: D.source,
    expected_generation: 2,
    now_epoch: NOW_EPOCH + 62,
    api_key: 'forbidden',
  }),
  (error) => error.code === 'STORAGE_DURABLE_MOUNT_AUTH_SECRET_OR_UNSAFE_FIELD_REJECTED',
);

const snapshot = await registry.exportState();
assert.equal(snapshot.authorizations.length, 1);
assert.equal(snapshot.consumptions.length, 1);
assert.equal(snapshot.automatic_retry_allowed, false);
assert.equal(snapshot.runtime_mounted, false);
assert.equal(snapshot.provider_dispatch_allowed, false);
assert.match(snapshot.snapshot_digest, /^[0-9a-f]{64}$/u);

assert.ok(database.commits >= 3);
assert.ok(database.rollbacks >= 5);
assert.equal(database.lockAcquisitions, database.lockReleases);

console.log(JSON.stringify({
  ok: true,
  contract: 'hostinger_storage_durable_mount_authorization_registry_v1',
  registered_generation: consumed.previous_generation,
  consumed_generation: consumed.current_generation,
  immutable_consumption_count: database.tables.consumptions.size,
  automatic_retry_allowed: false,
  mount_execution_allowed: false,
  mount_performed: false,
  runtime_mounted: false,
  route_mounted: false,
  worker_mounted: false,
  provider_dispatch_allowed: false,
  migration_apply_authorized: false,
  production_ready: false,
  secrets_included: false,
}, null, 2));
