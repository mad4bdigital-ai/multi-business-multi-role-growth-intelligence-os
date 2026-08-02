#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_SCHEMA_CONTRACT,
  HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_SCHEMA_DIGEST,
  createHostingerStorageDurableTenantAuthorityStore,
  isCanonicalHostingerStorageDurableTenantAuthorityStore,
} from './hostingerStorageDurableTenantAuthorityStore.js';

const h = (character) => character.repeat(64);
const clone = (value) => structuredClone(value);

class FakeAuthorityDatabase {
  constructor() {
    this.tables = {
      allowlists: new Map(),
      approvals: new Map(),
      tokens: new Map(),
    };
    this.commits = 0;
    this.rollbacks = 0;
    this.lockAcquisitions = 0;
    this.lockReleases = 0;
    this.connections = 0;
    this.forceNextCasMiss = false;
  }
}

class FakeAuthorityConnection {
  constructor(database) {
    this.database = database;
    this.working = null;
  }

  async beginTransaction() {
    this.working = clone(this.database.tables);
  }

  async commit() {
    this.database.tables = this.working;
    this.working = null;
    this.database.commits += 1;
  }

  async rollback() {
    this.working = null;
    this.database.rollbacks += 1;
  }

  release() {}

  table(name) {
    return (this.working || this.database.tables)[name];
  }

  async execute(sql, params = []) {
    if (sql.includes('spec014:authority:lock:acquire')) {
      this.database.lockAcquisitions += 1;
      return [[{ acquired: 1 }], []];
    }
    if (sql.includes('spec014:authority:lock:release')) {
      this.database.lockReleases += 1;
      return [[{ released: 1 }], []];
    }
    if (sql.includes('spec014:authority:load-allowlist')) {
      const row = this.table('allowlists').get(params[0]);
      return [row ? [clone(row)] : [], []];
    }
    if (sql.includes('spec014:authority:load-approval')) {
      const row = this.table('approvals').get(params[0]);
      return [row ? [clone(row)] : [], []];
    }
    if (sql.includes('spec014:authority:load-token')) {
      const key = params.join(':');
      const row = this.table('tokens').get(key);
      return [row ? [clone(row)] : [], []];
    }
    if (sql.includes('spec014:authority:insert-token')) {
      const key = [params[1], params[2], params[3], params[4]].join(':');
      if (this.table('tokens').has(key)) {
        const error = new Error('duplicate token');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      this.table('tokens').set(key, {
        id: params[0],
        authority_type: params[1],
        authority_id: params[2],
        token_kind: params[3],
        token_value: params[4],
        record_digest: params[5],
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('spec014:authority:insert-allowlist')) {
      const id = params[0];
      if (this.table('allowlists').has(id)) {
        const error = new Error('duplicate allowlist');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      this.table('allowlists').set(id, {
        id,
        revision: params[1],
        record_digest: params[16],
        record_json: params[17],
        row_version: 1,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('spec014:authority:update-allowlist')) {
      const id = params[17];
      const expectedRevision = params[18];
      const expectedVersion = Number(params[19]);
      const current = this.table('allowlists').get(id);
      if (this.database.forceNextCasMiss) {
        this.database.forceNextCasMiss = false;
        return [{ affectedRows: 0 }, []];
      }
      if (!current || current.revision !== expectedRevision || Number(current.row_version) !== expectedVersion) {
        return [{ affectedRows: 0 }, []];
      }
      this.table('allowlists').set(id, {
        id,
        revision: params[0],
        record_digest: params[15],
        record_json: params[16],
        row_version: expectedVersion + 1,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('spec014:authority:insert-approval')) {
      const id = params[0];
      if (this.table('approvals').has(id)) {
        const error = new Error('duplicate approval');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      this.table('approvals').set(id, {
        id,
        evidence_digest: params[12],
        record_digest: params[13],
        record_json: params[14],
        row_version: 1,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('spec014:authority:update-approval')) {
      const id = params[14];
      const expectedEvidence = params[15];
      const expectedVersion = Number(params[16]);
      const current = this.table('approvals').get(id);
      if (this.database.forceNextCasMiss) {
        this.database.forceNextCasMiss = false;
        return [{ affectedRows: 0 }, []];
      }
      if (!current || current.evidence_digest !== expectedEvidence || Number(current.row_version) !== expectedVersion) {
        return [{ affectedRows: 0 }, []];
      }
      this.table('approvals').set(id, {
        id,
        evidence_digest: params[11],
        record_digest: params[12],
        record_json: params[13],
        row_version: expectedVersion + 1,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('spec014:authority:export-allowlists')) {
      return [[...this.table('allowlists').values()].sort((a, b) => a.id.localeCompare(b.id)).map(clone), []];
    }
    if (sql.includes('spec014:authority:export-approvals')) {
      return [[...this.table('approvals').values()].sort((a, b) => a.id.localeCompare(b.id)).map(clone), []];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

class FakeAuthorityPool {
  constructor(database) {
    this.database = database;
  }

  async getConnection() {
    this.database.connections += 1;
    return new FakeAuthorityConnection(this.database);
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
    source_commit: 'd54a8972c199f3c0c02edb8ade4d1ebfd4e67f97',
    deployed_runtime_sha: 'd54a8972c199f3c0c02edb8ade4d1ebfd4e67f97',
    runtime_parity: true,
    database_fingerprint: h('f'),
    readback_cycle_id: 'authority-schema-readback-cycle-1',
    expires_at: '2099-08-02T00:15:00.000Z',
    authority_store_schema: {
      contract_key: HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_SCHEMA_CONTRACT.contract_key,
      contract_digest: HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_SCHEMA_DIGEST,
      tables: [...HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_SCHEMA_CONTRACT.tables],
      secrets_included: false,
    },
    secrets_included: false,
  },
  secrets_included: false,
};

assert.throws(
  () => createHostingerStorageDurableTenantAuthorityStore({
    pool: new FakeAuthorityPool(new FakeAuthorityDatabase()),
    schema_verification: {
      ...schemaVerification,
      evidence: {
        ...schemaVerification.evidence,
        authority_store_schema: {
          ...schemaVerification.evidence.authority_store_schema,
          contract_digest: h('0'),
        },
      },
    },
  }),
  (error) => error.code === 'STORAGE_DURABLE_AUTHORITY_SCHEMA_CONTRACT_MISMATCH',
);

const database = new FakeAuthorityDatabase();
const pool = new FakeAuthorityPool(database);
const store = createHostingerStorageDurableTenantAuthorityStore({
  pool,
  schema_verification: schemaVerification,
});

assert.equal(database.connections, 0, 'factory creation must not connect to the database');
assert.equal(isCanonicalHostingerStorageDurableTenantAuthorityStore(store), true);
assert.equal(store.legacy_tenant_canary_compatible, false);
assert.equal(store.runtime_mounted, false);
assert.equal(store.provider_dispatch_allowed, false);
assert.equal('pool' in store, false);

const allowlistV1 = {
  allowlist_id: 'allowlist-1',
  revision: 'revision-1',
  status: 'active',
  environment: 'production',
  target_scope: 'tenant',
  tenant_id: 'tenant-1',
  workspace_id: 'workspace-1',
  resource_id: 'resource-1',
  target_id: 'target-1',
  root_ref: 'tenant-root/site-1',
  path_ref_prefix: 'cache/site-1',
  shared_target: false,
  platform_target: false,
  valid_from_epoch: 100,
  expires_at_epoch: 1000,
  max_items: 5,
  max_bytes: 5000,
  evidence_digest: h('1'),
  secrets_included: false,
};

const registeredAllowlist = await store.registerAllowlist(allowlistV1);
assert.equal(registeredAllowlist.created, true);
assert.equal(registeredAllowlist.allowlist.revision, 'revision-1');
assert.equal(database.tables.tokens.size, 1);

const replayAllowlist = await store.registerAllowlist(allowlistV1);
assert.equal(replayAllowlist.replay, true);
assert.equal(database.tables.tokens.size, 1);

await assert.rejects(
  store.registerAllowlist({ ...allowlistV1, max_items: 6 }),
  (error) => error.code === 'STORAGE_DURABLE_AUTHORITY_ALLOWLIST_ID_CONFLICT',
);

const allowlistV2Result = await store.updateAllowlist({
  allowlist_id: 'allowlist-1',
  expected_revision: 'revision-1',
  record: { ...allowlistV1, revision: 'revision-2', max_items: 6, evidence_digest: h('2') },
});
assert.equal(allowlistV2Result.current_token, 'revision-2');
assert.equal(allowlistV2Result.row_version, 2);

const allowlistV3Result = await store.updateAllowlist({
  allowlist_id: 'allowlist-1',
  expected_revision: 'revision-2',
  record: { ...allowlistV1, revision: 'revision-3', max_items: 7, evidence_digest: h('3') },
});
assert.equal(allowlistV3Result.current_token, 'revision-3');
assert.equal(allowlistV3Result.row_version, 3);

const rollbackCountBeforeReuse = database.rollbacks;
await assert.rejects(
  store.updateAllowlist({
    allowlist_id: 'allowlist-1',
    expected_revision: 'revision-3',
    record: { ...allowlistV1, revision: 'revision-2', max_items: 8, evidence_digest: h('4') },
  }),
  (error) => error.code === 'STORAGE_DURABLE_AUTHORITY_TOKEN_REUSED',
);
assert.equal(database.rollbacks, rollbackCountBeforeReuse + 1);
assert.equal((await store.readAllowlist('allowlist-1')).revision, 'revision-3');

await assert.rejects(
  store.updateAllowlist({
    allowlist_id: 'allowlist-1',
    expected_revision: 'revision-stale',
    record: { ...allowlistV1, revision: 'revision-4', evidence_digest: h('5') },
  }),
  (error) => error.code === 'STORAGE_DURABLE_AUTHORITY_ALLOWLIST_TOKEN_CONFLICT',
);

await assert.rejects(
  store.registerAllowlist({ ...allowlistV1, allowlist_id: 'allowlist-shared', shared_target: true }),
  (error) => error.code === 'STORAGE_DURABLE_AUTHORITY_TENANT_EXCLUSIVE_SCOPE_REQUIRED',
);

const approvalV1 = {
  approval_id: 'approval-1',
  slot: 'workspace_owner',
  status: 'approved',
  tenant_id: 'tenant-1',
  workspace_id: 'workspace-1',
  operation_id: 'operation-1',
  target_id: 'target-1',
  plan_hash: h('a'),
  authority_context_hash: h('b'),
  approver_role: 'workspace_owner',
  approved_at_epoch: 200,
  expires_at_epoch: 900,
  evidence_digest: h('c'),
  secrets_included: false,
};

const registeredApproval = await store.registerApproval(approvalV1);
assert.equal(registeredApproval.created, true);
assert.equal(registeredApproval.approval.status, 'approved');

const replayApproval = await store.registerApproval(approvalV1);
assert.equal(replayApproval.replay, true);

const approvalV2 = await store.updateApproval({
  approval_id: 'approval-1',
  expected_evidence_digest: h('c'),
  record: { ...approvalV1, status: 'revoked', evidence_digest: h('d') },
});
assert.equal(approvalV2.approval.status, 'revoked');
assert.equal(approvalV2.row_version, 2);

await assert.rejects(
  store.updateApproval({
    approval_id: 'approval-1',
    expected_evidence_digest: h('d'),
    record: { ...approvalV1, evidence_digest: h('c') },
  }),
  (error) => error.code === 'STORAGE_DURABLE_AUTHORITY_TOKEN_REUSED',
);

await assert.rejects(
  store.registerApproval({ ...approvalV1, approval_id: 'approval-invalid-role', approver_role: 'tenant_operator' }),
  (error) => error.code === 'STORAGE_DURABLE_AUTHORITY_WORKSPACE_OWNER_REQUIRED',
);

const currentApproval = await store.readApproval('approval-1');
assert.equal(currentApproval.status, 'revoked');

const snapshot = await store.exportState();
assert.equal(snapshot.allowlists.length, 1);
assert.equal(snapshot.approvals.length, 1);
assert.equal(snapshot.runtime_mounted, false);
assert.equal(snapshot.production_ready, false);
assert.match(snapshot.snapshot_digest, /^[0-9a-f]{64}$/u);

const beforeCasRevision = (await store.readAllowlist('allowlist-1')).revision;
database.forceNextCasMiss = true;
await assert.rejects(
  store.updateAllowlist({
    allowlist_id: 'allowlist-1',
    expected_revision: beforeCasRevision,
    record: { ...allowlistV1, revision: 'revision-4', evidence_digest: h('6') },
  }),
  (error) => error.code === 'STORAGE_DURABLE_AUTHORITY_ALLOWLIST_CAS_CONFLICT',
);
assert.equal((await store.readAllowlist('allowlist-1')).revision, beforeCasRevision);

const unsafe = { ...allowlistV1, allowlist_id: 'allowlist-unsafe', api_key: 'forbidden' };
await assert.rejects(
  store.registerAllowlist(unsafe),
  (error) => error.code === 'STORAGE_DURABLE_AUTHORITY_SECRET_OR_UNSAFE_FIELD_REJECTED',
);

assert.ok(database.commits >= 7);
assert.ok(database.rollbacks >= 4);
assert.equal(database.lockAcquisitions, database.lockReleases);

console.log(JSON.stringify({
  ok: true,
  contract: 'hostinger_storage_durable_tenant_authority_store_v1',
  allowlist_revision: (await store.readAllowlist('allowlist-1')).revision,
  approval_status: (await store.readApproval('approval-1')).status,
  immutable_token_count: database.tables.tokens.size,
  commits: database.commits,
  rollbacks: database.rollbacks,
  runtime_mounted: false,
  route_mounted: false,
  worker_mounted: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}));
