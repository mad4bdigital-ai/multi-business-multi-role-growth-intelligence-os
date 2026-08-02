#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import {
  HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS,
  HOSTINGER_STORAGE_SCHEMA_PREDICATE_TYPE,
  HOSTINGER_STORAGE_SCHEMA_VERIFICATION_VERSION,
  buildHostingerStorageSchemaVerificationSubject,
  hostingerStorageSchemaVerificationSignaturePayload,
  stableHostingerStorageSchemaVerificationJson,
  verifyHostingerStorageSchemaVerification,
} from './hostingerStorageSchemaVerification.js';

const contract = JSON.parse(fs.readFileSync(
  new URL('../.github/contracts/spec014/hostinger-storage-schema-verification.json', import.meta.url),
  'utf8',
));
const attestationSchema = JSON.parse(fs.readFileSync(
  new URL('../.github/contracts/spec014/hostinger-storage-schema-verification-attestation.schema.json', import.meta.url),
  'utf8',
));
const readbackSql = fs.readFileSync(
  new URL('../.github/contracts/spec014/hostinger-storage-schema-verification-readback-v4.sql', import.meta.url),
  'utf8',
);
const refreshContract = JSON.parse(fs.readFileSync(
  new URL('../.github/contracts/spec014/hostinger-storage-wave4-signed-schema-verification-refresh.json', import.meta.url),
  'utf8',
));

const sourceCommit = '6242c43b43eba3cb9e999b0daff36f24f0c63588';
const databaseFingerprint = 'a'.repeat(64);
const schemaContractDigest = '652b2d50774944c4f21d92fd8a461c0e0cd18316e5875696223337eb2df5555a';
const schemaTables = [
  'storage_authorized_injection_states',
  'storage_authorized_injection_rollbacks',
];

assert.equal(HOSTINGER_STORAGE_SCHEMA_VERIFICATION_VERSION, 'spec014-hostinger-storage-schema-verification-v2');
assert.equal(HOSTINGER_STORAGE_SCHEMA_PREDICATE_TYPE, 'https://mad4b.com/attestations/hostinger-storage-schema-verification/v2');
assert.equal(contract.contract, 'spec014.hostinger-storage-signed-schema-verification.v2');
assert.equal(contract.attestation_version, HOSTINGER_STORAGE_SCHEMA_VERIFICATION_VERSION);
assert.equal(contract.v1_attestation_replay_rejected, true);
assert.equal(contract.expected_readback_contract_key, 'spec014_hostinger_storage_migration_readback_v4');
assert.equal(contract.readback_contract_path, '.github/contracts/spec014/hostinger-storage-schema-verification-readback-v4.sql');
assert.equal(contract.authorized_injection_state_schema.contract_digest, schemaContractDigest);
assert.equal(contract.expected_counts.compatible_tables, 17);
assert.equal(contract.expected_counts.compatible_runtime_columns, 71);
assert.equal(contract.expected_counts.compatible_runtime_index_columns, 31);
assert.equal(contract.expected_counts.authorized_injection_state_constraints, 13);
assert.equal(contract.live_database_access_performed, false);
assert.equal(contract.signature_created, false);
assert.equal(contract.schema_verified, false);
assert.equal(contract.production_ready, false);
assert.equal(contract.secrets_included, false);
assert.equal(attestationSchema.additionalProperties, false);
assert.equal(attestationSchema.properties.attestation_version.const, HOSTINGER_STORAGE_SCHEMA_VERIFICATION_VERSION);
assert.equal(attestationSchema.properties.secrets_included.const, false);
assert.equal(Object.hasOwn(attestationSchema.properties, 'private_key'), false);
assert.equal(refreshContract.live_database_access_performed, false);
assert.equal(refreshContract.signature_created, false);
assert.equal(refreshContract.schema_verified, false);
assert.equal(refreshContract.production_ready, false);
assert.equal(refreshContract.secrets_included, false);

assert.match(readbackSql, /not runnable by governed-migration-runner or owned by T027/u);
assert.match(readbackSql, /17 AS expected_table_count/u);
assert.match(readbackSql, /storage_authorized_injection_states/u);
assert.match(readbackSql, /storage_authorized_injection_rollbacks/u);
assert.match(readbackSql, /"created_at","d":"datetime"/u);
assert.match(readbackSql, /"updated_at","d":"datetime"/u);
assert.match(readbackSql, /expected_authorized_injection_state_constraint_count/u);
assert.match(readbackSql, /fk_storage_authorized_injection_rollback_state/u);
assert.match(readbackSql, new RegExp(schemaContractDigest, 'u'));
assert.match(readbackSql, /spec014_hostinger_storage_migration_readback_v4/u);
assert.doesNotMatch(readbackSql, /spec014_hostinger_storage_migration_readback_v3/u);

assert.equal(HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.table_count, 17);
assert.equal(HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.view_count, 3);
assert.equal(HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.runtime_column_count, 71);
assert.equal(HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.runtime_index_column_count, 31);
assert.equal(HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.authorized_injection_state_constraint_count, 13);
assert.deepEqual(HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.authorized_injection_state_schema.tables, schemaTables);
assert.equal(HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.authorized_injection_state_schema.contract_digest, schemaContractDigest);
assert.equal(HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.migrations.length, 4);

const migrations = HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.migrations.map((migration, index) => ({
  ...migration,
  ledger_mode: 'apply',
  ledger_status: 'success',
  ledger_evidence_digest: String(index + 1).repeat(64),
}));

const readback = {
  contract_key: 'spec014_hostinger_storage_migration_readback_v4',
  cycle_id: 'schema-readback-v2-cycle-1',
  started_at: '2026-08-02T13:35:00.000Z',
  completed_at: '2026-08-02T13:38:00.000Z',
  database_fingerprint: databaseFingerprint,
  schema_identity_digest: 'b'.repeat(64),
  object_inventory_digest: 'c'.repeat(64),
  constraint_inventory_digest: 'd'.repeat(64),
  compatible_table_count: 17,
  present_view_count: 3,
  compatible_runtime_column_count: 71,
  compatible_runtime_index_column_count: 31,
  authorized_injection_state_schema_contract_key: 'hostinger_storage_durable_authorized_injection_state_schema_v1',
  authorized_injection_state_schema_contract_digest: schemaContractDigest,
  authorized_injection_state_tables: schemaTables,
  authorized_injection_state_table_count: 2,
  authorized_injection_state_constraint_count: 13,
  authorized_injection_state_schema_status: 'ready_exact_contract',
  observed_tool_count: 3,
  disabled_tool_count: 3,
  enabled_tool_count: 0,
  object_readiness_status: 'ready_for_column_index_constraint_readback',
  runtime_column_readback_status: 'ready',
  runtime_index_readback_status: 'ready',
  tool_seed_readback_status: 'ready_default_off',
  provider_calls: 0,
  protected_payload_reads: 0,
  external_writes: 0,
  secrets_included: false,
};

const subject = buildHostingerStorageSchemaVerificationSubject({
  source_commit: sourceCommit,
  deployed_runtime_sha: sourceCommit,
  migrations,
  readback,
  created_at: '2026-08-02T13:39:00.000Z',
});
assert.equal(subject.ok, true);
assert.equal(subject.predicate_type, HOSTINGER_STORAGE_SCHEMA_PREDICATE_TYPE);
assert.equal(subject.payload.schema_version, 2);
assert.equal(subject.payload.attestation_version, HOSTINGER_STORAGE_SCHEMA_VERIFICATION_VERSION);
assert.equal(subject.payload.migrations.length, 4);
assert.equal(subject.payload.readback.compatible_runtime_column_count, 71);
assert.equal(subject.payload.readback.authorized_injection_state_constraint_count, 13);
assert.equal(subject.schema_verified, false);
assert.equal(subject.production_ready, false);
assert.equal(subject.authority_granted, false);
assert.equal(subject.migration_apply_authorized, false);
assert.deepEqual(subject.blockers, ['SIGNED_SCHEMA_VERIFICATION_REQUIRED']);

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicJwk = publicKey.export({ format: 'jwk' });
const publicKeyFingerprint = createHash('sha256')
  .update(stableHostingerStorageSchemaVerificationJson({
    crv: publicJwk.crv,
    kty: publicJwk.kty,
    x: publicJwk.x,
  }), 'utf8')
  .digest('hex');

const unsignedAttestation = {
  attestation_version: HOSTINGER_STORAGE_SCHEMA_VERIFICATION_VERSION,
  subject_digest: subject.subject_digest,
  key_id: 'spec014-schema-verifier-v2-test',
  signer_identity: 'github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/actions/schema-verifier',
  issuer: 'github.com/actions',
  signed_at: '2026-08-02T13:40:00.000Z',
  expires_at: '2026-08-02T13:55:00.000Z',
  secrets_included: false,
};
const signaturePayload = hostingerStorageSchemaVerificationSignaturePayload(unsignedAttestation);
const attestation = {
  ...unsignedAttestation,
  signature_b64url: sign(
    null,
    Buffer.from(stableHostingerStorageSchemaVerificationJson(signaturePayload), 'utf8'),
    privateKey,
  ).toString('base64url'),
};
const policy = {
  allowed_key_ids: ['spec014-schema-verifier-v2-test'],
  expected_public_key_fingerprints: {
    'spec014-schema-verifier-v2-test': publicKeyFingerprint,
  },
  allowed_signer_patterns: ['github.com/mad4bdigital-ai/*'],
  allowed_issuers: ['github.com/actions'],
  expected_source_commit: sourceCommit,
  expected_deployed_runtime_sha: sourceCommit,
  expected_database_fingerprint: databaseFingerprint,
  runtime_parity_required: true,
  max_age_minutes: 15,
  max_signing_delay_minutes: 5,
  max_readback_cycle_minutes: 10,
  secrets_included: false,
};

const verified = verifyHostingerStorageSchemaVerification({
  subject,
  attestation,
  public_key_jwk: publicJwk,
  policy,
  now: '2026-08-02T13:45:00.000Z',
});
assert.equal(verified.ok, true);
assert.equal(verified.ready, true);
assert.equal(verified.schema_verified, true);
assert.equal(verified.production_ready, false);
assert.equal(verified.authority_granted, false);
assert.equal(verified.migration_apply_authorized, false);
assert.equal(verified.provider_dispatch_allowed, false);
assert.deepEqual(verified.blockers, []);
assert.equal(verified.evidence.schema_version, 2);
assert.equal(verified.evidence.evidence_key, 'hostinger_storage_signed_schema_verification_v2');
assert.equal(verified.evidence.authorized_injection_state_schema.contract_digest, schemaContractDigest);
assert.deepEqual(verified.evidence.authorized_injection_state_schema.tables, schemaTables);
assert.equal(verified.evidence.authorized_injection_state_schema.constraint_count, 13);
assert.equal(verified.evidence.runtime_parity, true);
assert.equal(verified.evidence.database_fingerprint, databaseFingerprint);
assert.equal(verified.evidence.public_key_fingerprint_sha256, publicKeyFingerprint);
assert.equal(verified.secrets_included, false);

assert.throws(
  () => hostingerStorageSchemaVerificationSignaturePayload({
    ...unsignedAttestation,
    attestation_version: 'spec014-hostinger-storage-schema-verification-v1',
  }),
  (error) => error.code === 'STORAGE_SCHEMA_VERIFICATION_ATTESTATION_VERSION_INVALID',
);

assert.throws(
  () => buildHostingerStorageSchemaVerificationSubject({
    source_commit: sourceCommit,
    deployed_runtime_sha: sourceCommit,
    migrations: migrations.slice(0, 3),
    readback,
    created_at: '2026-08-02T13:39:00.000Z',
  }),
  (error) => error.code === 'STORAGE_SCHEMA_VERIFICATION_MIGRATION_SEQUENCE_INVALID',
);

assert.throws(
  () => buildHostingerStorageSchemaVerificationSubject({
    source_commit: sourceCommit,
    deployed_runtime_sha: sourceCommit,
    migrations,
    readback: { ...readback, contract_key: 'spec014_hostinger_storage_migration_readback_v3' },
    created_at: '2026-08-02T13:39:00.000Z',
  }),
  (error) => error.code === 'STORAGE_SCHEMA_VERIFICATION_READBACK_CONTRACT_MISMATCH',
);

assert.throws(
  () => buildHostingerStorageSchemaVerificationSubject({
    source_commit: sourceCommit,
    deployed_runtime_sha: sourceCommit,
    migrations,
    readback: { ...readback, authorized_injection_state_schema_contract_digest: 'e'.repeat(64) },
    created_at: '2026-08-02T13:39:00.000Z',
  }),
  (error) => error.code === 'STORAGE_SCHEMA_VERIFICATION_READBACK_NOT_READY'
    && error.details?.mismatches?.includes('authorized_injection_state_schema_contract_digest'),
);

assert.throws(
  () => buildHostingerStorageSchemaVerificationSubject({
    source_commit: sourceCommit,
    deployed_runtime_sha: sourceCommit,
    migrations,
    readback: { ...readback, authorized_injection_state_tables: [...schemaTables].reverse() },
    created_at: '2026-08-02T13:39:00.000Z',
  }),
  (error) => error.code === 'STORAGE_SCHEMA_VERIFICATION_SCHEMA_TABLES_MISMATCH',
);

assert.throws(
  () => buildHostingerStorageSchemaVerificationSubject({
    source_commit: sourceCommit,
    deployed_runtime_sha: sourceCommit,
    migrations,
    readback: { ...readback, authorized_injection_state_constraint_count: 12 },
    created_at: '2026-08-02T13:39:00.000Z',
  }),
  (error) => error.code === 'STORAGE_SCHEMA_VERIFICATION_READBACK_NOT_READY'
    && error.details?.mismatches?.includes('authorized_injection_state_constraint_count'),
);

assert.throws(
  () => buildHostingerStorageSchemaVerificationSubject({
    source_commit: sourceCommit,
    deployed_runtime_sha: sourceCommit,
    migrations: migrations.map((entry, index) => index === 3 ? { ...entry, ledger_mode: 'dry_run' } : entry),
    readback,
    created_at: '2026-08-02T13:39:00.000Z',
  }),
  (error) => error.code === 'STORAGE_SCHEMA_VERIFICATION_MIGRATION_EVIDENCE_MISMATCH'
    && error.details?.wave === 4,
);

console.log(JSON.stringify({
  ok: true,
  contract: contract.contract,
  attestation_version: HOSTINGER_STORAGE_SCHEMA_VERIFICATION_VERSION,
  predicate_type: HOSTINGER_STORAGE_SCHEMA_PREDICATE_TYPE,
  readback_contract_key: readback.contract_key,
  migration_wave_count: migrations.length,
  compatible_table_count: readback.compatible_table_count,
  compatible_runtime_column_count: readback.compatible_runtime_column_count,
  compatible_runtime_index_column_count: readback.compatible_runtime_index_column_count,
  authorized_injection_state_constraint_count: readback.authorized_injection_state_constraint_count,
  authorized_injection_state_schema_contract_digest: schemaContractDigest,
  synthetic_signature_verified: true,
  v1_attestation_replay_rejected: true,
  private_key_committed: false,
  live_database_access_performed: false,
  migration_apply_performed: false,
  provider_dispatch_performed: false,
  schema_verified_in_live_environment: false,
  production_ready: false,
  secrets_included: false,
}, null, 2));
