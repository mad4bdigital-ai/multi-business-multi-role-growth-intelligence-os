#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_CONTRACT,
  HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_DIGEST,
  createHostingerStorageDurableAuthorizedInjectionStateRegistry,
  isCanonicalHostingerStorageDurableAuthorizedInjectionStateRegistry,
} from './hostingerStorageDurableAuthorizedInjectionState.js';

const pool = Object.freeze({
  async getConnection() {
    throw new Error('database connection must not be opened by constructor-only inspection');
  },
});

function schemaVerification(identity) {
  return {
    ready: true,
    schema_verified: true,
    blockers: [],
    production_ready: false,
    authority_granted: false,
    migration_apply_authorized: false,
    provider_dispatch_allowed: false,
    evidence_digest: 'a'.repeat(64),
    evidence: {
      source_commit: identity,
      deployed_runtime_sha: identity,
      runtime_parity: true,
      database_fingerprint: 'b'.repeat(64),
      readback_cycle_id: 'schema-readback-cycle-v2-registry-blocker',
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
    },
    secrets_included: false,
  };
}

const gitSha1 = '2f6e910a2afd1a5b413327bdb7f62ff5eb5b73cb';
assert.equal(gitSha1.length, 40);

assert.throws(
  () => createHostingerStorageDurableAuthorizedInjectionStateRegistry({
    pool,
    schema_verification: schemaVerification(gitSha1),
  }),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_HASH_INVALID'
    && error.details?.field === 'schema_verification.source_commit'
    && error.details?.secrets_included === false,
);

const sha256LengthIdentity = 'c'.repeat(64);
const registry = createHostingerStorageDurableAuthorizedInjectionStateRegistry({
  pool,
  schema_verification: schemaVerification(sha256LengthIdentity),
});
assert.equal(isCanonicalHostingerStorageDurableAuthorizedInjectionStateRegistry(registry), true);
assert.equal(registry.source_commit, sha256LengthIdentity);
assert.equal(registry.deployed_runtime_sha, sha256LengthIdentity);
assert.equal(registry.live_database_access_performed_by_factory, false);
assert.equal(registry.migration_apply_authorized, false);
assert.equal(registry.provider_dispatch_allowed, false);
assert.equal(registry.production_ready, false);
assert.equal(registry.secrets_included, false);

console.log(JSON.stringify({
  ok: true,
  contract: 'spec014.hostinger-storage-durable-registry-commit-identity-blocker.v1',
  forty_character_git_commit_rejected: true,
  sixty_four_character_identity_accepted: true,
  failure_code: 'STORAGE_DURABLE_INJECTION_HASH_INVALID',
  failure_field: 'schema_verification.source_commit',
  required_repair: 'commit-specific validator accepting 40 or 64 lowercase hex characters',
  database_connection_opened: false,
  live_database_access_performed: false,
  runtime_repair_performed: false,
  durable_registry_runtime_acceptance_ready: false,
  migration_apply_performed: false,
  provider_dispatch_performed: false,
  production_ready: false,
  secrets_included: false,
}, null, 2));
