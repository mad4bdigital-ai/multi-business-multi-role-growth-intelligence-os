#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import {
  HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS,
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
const bindingContract = JSON.parse(fs.readFileSync(
  new URL('../.github/contracts/spec014/hostinger-storage-schema-verification-v2-registry-binding.json', import.meta.url),
  'utf8',
));
const attestationSchema = JSON.parse(fs.readFileSync(
  new URL('../.github/contracts/spec014/hostinger-storage-schema-verification-attestation.schema.json', import.meta.url),
  'utf8',
));
const readbackContract = fs.readFileSync(
  new URL('../.github/contracts/spec014/hostinger-storage-schema-verification-readback-v4.sql', import.meta.url),
  'utf8',
);

assert.equal(contract.contract, 'spec014.hostinger-storage-signed-schema-verification.v2');
assert.equal(contract.attestation_version, HOSTINGER_STORAGE_SCHEMA_VERIFICATION_VERSION);
assert.equal(contract.predicate_type, 'https://mad4b.com/attestations/hostinger-storage-schema-verification/v2');
assert.equal(contract.status, 'verification_contract_ready_unsigned');
assert.equal(contract.signature_algorithm, 'Ed25519');
assert.equal(contract.public_key_only_verification, true);
assert.equal(contract.private_key_material_forbidden, true);
assert.equal(contract.v1_signature_replay_allowed, false);
assert.equal(contract.expected_readback_contract_key, 'spec014_hostinger_storage_migration_readback_v4');
assert.equal(contract.readback_contract_path, '.github/contracts/spec014/hostinger-storage-schema-verification-readback-v4.sql');
assert.equal(contract.expected_counts.compatible_tables, 17);
assert.equal(contract.expected_counts.compatible_runtime_columns, 68);
assert.equal(contract.expected_counts.compatible_runtime_index_columns, 31);
assert.equal(contract.expected_counts.authorized_injection_state_constraints, 13);
assert.equal(contract.live_database_access_performed, false);
assert.equal(contract.signature_created, false);
assert.equal(contract.schema_verified, false);
assert.equal(contract.production_ready, false);
assert.equal(contract.secrets_included, false);
assert.equal(bindingContract.terminal_boundary.schema_verification_v2_ready, true);
assert.equal(bindingContract.terminal_boundary.durable_registry_binding_ready, true);
assert.equal(bindingContract.terminal_boundary.live_database_access_performed, false);
assert.equal(bindingContract.terminal_boundary.signature_created, false);
assert.equal(bindingContract.secrets_included, false);
assert.equal(attestationSchema.additionalProperties, false);
assert.equal(attestationSchema.properties.attestation_version.const, HOSTINGER_STORAGE_SCHEMA_VERIFICATION_VERSION);
assert.equal(attestationSchema.properties.secrets_included.const, false);
assert.equal(Object.hasOwn(attestationSchema.properties, 'private_key'), false);

assert.match(readbackContract, /17 AS expected_table_count/u);
assert.match(readbackContract, /storage_authorized_injection_states/u);
assert.match(readbackContract, /storage_authorized_injection_rollbacks/u);
assert.match(readbackContract, /expected_authorized_injection_state_constraint_count/u);
assert.match(readbackContract, /fk_storage_authorized_injection_rollback_state/u);
assert.match(readbackContract, /652b2d50774944c4f21d92fd8a461c0e0cd18316e5875696223337eb2df5555a/u);
assert.match(readbackContract, /spec014_hostinger_storage_migration_readback_v4/u);
assert.match(readbackContract, /candidate_only_unsigned_v2/u);
assert.doesNotMatch(readbackContract, /spec014_hostinger_storage_migration_readback_v3/u);

const sourceCommit = '6242c43b43eba3cb9e999b0daff36f24f0c63588';
const databaseFingerprint = 'a'.repeat(64);
const schemaExpectation = HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.authorized_injection_state_schema;
const migrations = HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.migrations.map((row, index) => ({
  ...row,
  ledger_mode: 'apply',
  ledger_status: 'success',
  ledger_evidence_digest: String(index + 1).repeat(64),
}));
const readback = {
  contract_key: 'spec014_hostinger_storage_migration_readback_v4',
  cycle_id: 'schema-readback-cycle-v2-1',
  started_at: '2026-08-02T13:35:00.000Z',
  completed_at: '2026-08-02T13:38:00.000Z',
  database_fingerprint: databaseFingerprint,
  schema_identity_digest: 'b'.repeat(64),
  object_inventory_digest: 'c'.repeat(64),
  constraint_inventory_digest: 'd'.repeat(64),
  compatible_table_count: 17,
  present_view_count: 3,
  compatible_runtime_column_count: 68,
  compatible_runtime_index_column_count: 31,
  authorized_injection_state_schema_contract_key: schemaExpectation.contract_key,
  authorized_injection_state_schema_contract_digest: schemaExpectation.contract_digest,
  authorized_injection_state_tables: [...schemaExpectation.tables],
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
assert.equal(subject.payload.schema_version, 2);
assert.equal(subject.payload.attestation_version, HOSTINGER_STORAGE_SCHEMA_VERIFICATION_VERSION);
assert.equal(subject.payload.migrations.length, 4);
assert.equal(subject.payload.readback.compatible_runtime_column_count, 68);
assert.equal(subject.payload.readback.authorized_injection_state_constraint_count, 13);
assert.deepEqual(subject.payload.readback.authorized_injection_state_tables, schemaExpectation.tables);
assert.equal(subject.signing_allowed, false);
assert.equal(subject.schema_verified, false);
assert.equal(subject.production_ready, false);
assert.equal(subject.authority_granted, false);
assert.equal(subject.migration_apply_authorized, false);
assert.deepEqual(subject.blockers, ['SIGNED_SCHEMA_VERIFICATION_REQUIRED']);

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicJwk = publicKey.export({ format: 'jwk' });
const privateJwk = privateKey.export({ format: 'jwk' });
const publicKeyFingerprint = createHash('sha256')
  .update(stableHostingerStorageSchemaVerificationJson({
    kty: publicJwk.kty,
    crv: publicJwk.crv,
    x: publicJwk.x,
  }), 'utf8')
  .digest('hex');
const unsignedAttestation = {
  attestation_version: HOSTINGER_STORAGE_SCHEMA_VERIFICATION_VERSION,
  subject_digest: subject.subject_digest,
  key_id: 'spec014-schema-verifier-v2-test',
  signer_identity: 'github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/actions/schema-verifier-v2',
  issuer: 'github.com/actions',
  signed_at: '2026-08-02T13:40:00.000Z',
  expires_at: '2026-08-02T13:55:00.000Z',
  secrets_included: false,
};
const signaturePayload = hostingerStorageSchemaVerificationSignaturePayload(unsignedAttestation);
const signatureB64Url = sign(
  null,
  Buffer.from(stableHostingerStorageSchemaVerificationJson(signaturePayload), 'utf8'),
  privateKey,
).toString('base64url');
const attestation = { ...unsignedAttestation, signature_b64url: signatureB64Url };
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
assert.equal(verified.evidence.runtime_parity, true);
assert.equal(verified.evidence.database_fingerprint, databaseFingerprint);
assert.equal(verified.evidence.public_key_fingerprint_sha256, publicKeyFingerprint);
assert.deepEqual(verified.evidence.authorized_injection_state_schema, {
  contract_key: schemaExpectation.contract_key,
  contract_digest: schemaExpectation.contract_digest,
  tables: schemaExpectation.tables,
  table_count: 2,
  constraint_count: 13,
  schema_status: 'ready_exact_contract',
  secrets_included: false,
});

assert.throws(
  () => hostingerStorageSchemaVerificationSignaturePayload({
    ...unsignedAttestation,
    attestation_version: 'spec014-hostinger-storage-schema-verification-v1',
  }),
  (error) => error.code === 'STORAGE_SCHEMA_VERIFICATION_ATTESTATION_VERSION_INVALID',
);
assert.throws(
  () => verifyHostingerStorageSchemaVerification({
    subject,
    attestation,
    public_key_jwk: privateJwk,
    policy,
    now: '2026-08-02T13:45:00.000Z',
  }),
  (error) => error.code === 'STORAGE_SCHEMA_VERIFICATION_PRIVATE_KEY_REJECTED',
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
    migrations,
    readback: {
      ...readback,
      authorized_injection_state_schema_contract_digest: '0'.repeat(64),
    },
    created_at: '2026-08-02T13:39:00.000Z',
  }),
  (error) => error.code === 'STORAGE_SCHEMA_VERIFICATION_READBACK_NOT_READY'
    && error.details?.mismatches?.includes('authorized_injection_state_schema_contract_digest'),
);
assert.throws(
  () => buildHostingerStorageSchemaVerificationSubject({
    source_commit: sourceCommit,
    deployed_runtime_sha: sourceCommit,
    migrations: migrations.map((row, index) => (
      index === 3 ? { ...row, ledger_mode: 'dry_run' } : row
    )),
    readback,
    created_at: '2026-08-02T13:39:00.000Z',
  }),
  (error) => error.code === 'STORAGE_SCHEMA_VERIFICATION_MIGRATION_EVIDENCE_MISMATCH'
    && error.details?.wave === 4,
);
assert.throws(
  () => buildHostingerStorageSchemaVerificationSubject({
    source_commit: sourceCommit,
    deployed_runtime_sha: sourceCommit,
    migrations,
    readback: { ...readback, password: 'forbidden' },
    created_at: '2026-08-02T13:39:00.000Z',
  }),
  (error) => error.code === 'STORAGE_SCHEMA_VERIFICATION_SECRET_FIELD_REJECTED',
);

const corrupted = `${signatureB64Url.startsWith('A') ? 'B' : 'A'}${signatureB64Url.slice(1)}`;
const invalidSignature = verifyHostingerStorageSchemaVerification({
  subject,
  attestation: { ...attestation, signature_b64url: corrupted },
  public_key_jwk: publicJwk,
  policy,
  now: '2026-08-02T13:45:00.000Z',
});
assert.equal(invalidSignature.ready, false);
assert(invalidSignature.blockers.includes('STORAGE_SCHEMA_VERIFICATION_SIGNATURE_INVALID'));

console.log(JSON.stringify({
  ok: true,
  contract: contract.contract,
  attestation_version: HOSTINGER_STORAGE_SCHEMA_VERIFICATION_VERSION,
  readback_contract: readback.contract_key,
  migration_wave_count: migrations.length,
  compatible_runtime_column_count: 68,
  compatible_runtime_index_column_count: 31,
  authorized_injection_state_constraint_count: 13,
  authorized_injection_schema_digest: schemaExpectation.contract_digest,
  synthetic_signature_verified: true,
  v1_signature_replay_rejected: true,
  durable_registry_binding_ready: true,
  private_key_committed: false,
  live_database_access_performed: false,
  signature_created_in_live_environment: false,
  migration_apply_performed: false,
  provider_dispatch_performed: false,
  schema_verified_in_live_environment: false,
  production_ready: false,
  secrets_included: false,
}, null, 2));
