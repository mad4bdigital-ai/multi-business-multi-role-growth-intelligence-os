#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_CONTRACT,
  HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_DIGEST,
  createHostingerStorageDurableAuthorizedInjectionStateRegistry,
  isCanonicalHostingerStorageDurableAuthorizedInjectionStateRegistry,
} from './hostingerStorageDurableAuthorizedInjectionState.js';

let databaseConnectionsOpened = 0;
const pool = Object.freeze({
  async getConnection() {
    databaseConnectionsOpened += 1;
    throw new Error('database connection must not be opened by constructor-only inspection');
  },
});

function schemaVerification(sourceCommit, deployedRuntimeSha = sourceCommit, overrides = {}) {
  const evidenceOverrides = overrides.evidence || {};
  return {
    ready: true,
    schema_verified: true,
    blockers: [],
    production_ready: false,
    authority_granted: false,
    migration_apply_authorized: false,
    provider_dispatch_allowed: false,
    evidence_digest: 'a'.repeat(64),
    ...overrides,
    evidence: {
      source_commit: sourceCommit,
      deployed_runtime_sha: deployedRuntimeSha,
      runtime_parity: true,
      database_fingerprint: 'b'.repeat(64),
      readback_cycle_id: 'schema-readback-cycle-v2-registry-repair',
      expires_at: '2099-01-01T00:00:00.000Z',
      authorized_injection_state_schema: {
        contract_key: HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_CONTRACT.contract_key,
        contract_digest: HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_DIGEST,
        tables: [...HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_CONTRACT.tables],
        table_count: 2,
        constraint_count: 13,
        schema_status: 'ready_exact_contract',
        secrets_included: false,
      },
      secrets_included: false,
      ...evidenceOverrides,
    },
    secrets_included: false,
  };
}

function createRegistry(sourceCommit, deployedRuntimeSha = sourceCommit, overrides = {}) {
  return createHostingerStorageDurableAuthorizedInjectionStateRegistry({
    pool,
    schema_verification: schemaVerification(sourceCommit, deployedRuntimeSha, overrides),
  });
}

const gitSha1 = 'be84a5bcdbfa933ab2ee3dc11dce3c1576730b2c';
assert.equal(gitSha1.length, 40);
const sha256ObjectIdentity = 'c'.repeat(64);

for (const identity of [gitSha1, sha256ObjectIdentity]) {
  const registry = createRegistry(identity);
  assert.equal(isCanonicalHostingerStorageDurableAuthorizedInjectionStateRegistry(registry), true);
  assert.equal(registry.source_commit, identity);
  assert.equal(registry.deployed_runtime_sha, identity);
  assert.equal(registry.live_database_access_performed_by_factory, false);
  assert.equal(registry.migration_apply_authorized, false);
  assert.equal(registry.provider_dispatch_allowed, false);
  assert.equal(registry.production_ready, false);
  assert.equal(registry.secrets_included, false);
}

const invalidSourceIdentities = [
  'a'.repeat(39),
  'a'.repeat(41),
  'a'.repeat(63),
  'a'.repeat(65),
  'A'.repeat(40),
  'g'.repeat(40),
];
for (const identity of invalidSourceIdentities) {
  assert.throws(
    () => createRegistry(identity),
    (error) => error.code === 'STORAGE_DURABLE_INJECTION_COMMIT_INVALID'
      && error.details?.field === 'schema_verification.source_commit'
      && error.details?.secrets_included === false,
    `source identity should be rejected: length=${identity.length}`,
  );
}

assert.throws(
  () => createRegistry(gitSha1, 'A'.repeat(40)),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_COMMIT_INVALID'
    && error.details?.field === 'schema_verification.deployed_runtime_sha',
);

const differentGitSha1 = 'd'.repeat(40);
assert.throws(
  () => createRegistry(gitSha1, differentGitSha1),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_RUNTIME_PARITY_REQUIRED',
);

assert.throws(
  () => createRegistry(gitSha1, gitSha1, { evidence_digest: 'a'.repeat(40) }),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_HASH_INVALID'
    && error.details?.field === 'schema_verification.evidence_digest',
);

assert.throws(
  () => createRegistry(gitSha1, gitSha1, {
    evidence: { database_fingerprint: 'b'.repeat(40) },
  }),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_HASH_INVALID'
    && error.details?.field === 'schema_verification.database_fingerprint',
);

assert.equal(databaseConnectionsOpened, 0);

console.log(JSON.stringify({
  ok: true,
  contract: 'spec014.hostinger-storage-durable-registry-commit-identity-repair.v1',
  forty_character_git_commit_accepted: true,
  sixty_four_character_git_commit_accepted: true,
  uppercase_commit_rejected: true,
  unsupported_commit_lengths_rejected: [39, 41, 63, 65],
  non_hex_commit_rejected: true,
  invalid_commit_code: 'STORAGE_DURABLE_INJECTION_COMMIT_INVALID',
  source_runtime_parity_preserved: true,
  sha256_evidence_digest_validation_preserved: true,
  sha256_database_fingerprint_validation_preserved: true,
  database_connections_opened: databaseConnectionsOpened,
  live_database_access_performed: false,
  runtime_repair_performed: true,
  durable_registry_runtime_acceptance_ready: true,
  migration_apply_performed: false,
  provider_dispatch_performed: false,
  production_ready: false,
  secrets_included: false,
}, null, 2));
