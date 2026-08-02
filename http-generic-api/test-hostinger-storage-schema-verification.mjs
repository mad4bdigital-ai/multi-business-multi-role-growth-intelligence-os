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

const contract = JSON.parse(fs.readFileSync(new URL('../.github/contracts/spec014/hostinger-storage-schema-verification.json', import.meta.url), 'utf8'));
const attestationSchema = JSON.parse(fs.readFileSync(new URL('../.github/contracts/spec014/hostinger-storage-schema-verification-attestation.schema.json', import.meta.url), 'utf8'));
const readbackContract = fs.readFileSync(new URL('../.github/contracts/spec014/hostinger-storage-schema-verification-readback-v4.sql', import.meta.url), 'utf8');

assert.equal(contract.status, 'verification_contract_ready_unsigned');
assert.equal(contract.signature_algorithm, 'Ed25519');
assert.equal(contract.private_key_material_forbidden, true);
assert.equal(contract.expected_readback_contract_key, 'spec014_hostinger_storage_migration_readback_v4');
assert.equal(contract.readback_contract_path, '.github/contracts/spec014/hostinger-storage-schema-verification-readback-v4.sql');
assert.equal(contract.live_database_access_performed, false);
assert.equal(contract.signature_created, false);
assert.equal(contract.schema_verified, false);
assert.equal(contract.production_ready, false);
assert.equal(contract.secrets_included, false);
assert.equal(attestationSchema.additionalProperties, false);
assert.equal(attestationSchema.properties.secrets_included.const, false);
assert.equal(Object.hasOwn(attestationSchema.properties, 'private_key'), false);

assert.match(readbackContract, /17 AS expected_table_count/u);
assert.match(readbackContract, /storage_authorized_injection_states/u);
assert.match(readbackContract, /storage_authorized_injection_rollbacks/u);
assert.match(readbackContract, /uq_storage_authorized_injection_rollback_once/u);
assert.match(readbackContract, /spec014_hostinger_storage_migration_readback_v4/u);
assert.doesNotMatch(readbackContract, /spec014_hostinger_storage_migration_readback_v3/u);

const sourceCommit = 'be93b1f98ec4e70655198df20d2d978f2565eb57';
const databaseFingerprint = 'a'.repeat(64);
const schemaIdentityDigest = 'b'.repeat(64);
const objectInventoryDigest = 'c'.repeat(64);
const constraintInventoryDigest = 'd'.repeat(64);

const migrations = HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.migrations.map((row, index) => ({
  ...row,
  ledger_mode: 'apply',
  ledger_status: 'success',
  ledger_evidence_digest: String(index + 1).repeat(64),
}));

const readback = {
  contract_key: 'spec014_hostinger_storage_migration_readback_v4',
  cycle_id: 'schema-readback-cycle-1',
  started_at: '2026-08-02T13:35:00.000Z',
  completed_at: '2026-08-02T13:38:00.000Z',
  database_fingerprint: databaseFingerprint,
  schema_identity_digest: schemaIdentityDigest,
  object_inventory_digest: objectInventoryDigest,
  constraint_inventory_digest: constraintInventoryDigest,
  compatible_table_count: 17,
  present_view_count: 3,
  compatible_runtime_column_count: 68,
  compatible_runtime_index_column_count: 31,
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
assert.equal(subject.payload.source_commit, sourceCommit);
assert.equal(subject.payload.deployed_runtime_sha, sourceCommit);
assert.equal(subject.payload.migrations.length, 4);
assert.equal(subject.payload.migrations[3].wave, 4);
assert.equal(subject.payload.migrations[3].migration, '20260802_04_spec014_hostinger_storage_authorized_injection_state.sql');
assert.equal(subject.payload.readback.compatible_table_count, 17);
assert.equal(subject.payload.readback.present_view_count, 3);
assert.equal(subject.payload.readback.compatible_runtime_column_count, 68);
assert.equal(subject.payload.readback.compatible_runtime_index_column_count, 31);
assert.equal(subject.payload.readback.disabled_tool_count, 3);
assert.equal(subject.payload.readback.protected_payload_reads, 0);
assert.equal(subject.signing_allowed, false);
assert.equal(subject.schema_verified, false);
assert.equal(subject.production_ready, false);
assert.equal(subject.authority_granted, false);
assert.equal(subject.migration_apply_authorized, false);
assert.deepEqual(subject.blockers, ['SIGNED_SCHEMA_VERIFICATION_REQUIRED']);
assert.match(subject.subject_digest, /^[0-9a-f]{64}$/u);
assert.match(subject.payload.readback_digest, /^[0-9a-f]{64}$/u);
assert.match(subject.payload.migration_evidence_digest, /^[0-9a-f]{64}$/u);

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicJwk = publicKey.export({ format: 'jwk' });
const privateJwk = privateKey.export({ format: 'jwk' });
const publicKeyFingerprint = createHash('sha256')
  .update(stableHostingerStorageSchemaVerificationJson({ kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x }), 'utf8')
  .digest('hex');

const unsignedAttestation = {
  attestation_version: HOSTINGER_STORAGE_SCHEMA_VERIFICATION_VERSION,
  subject_digest: subject.subject_digest,
  key_id: 'spec014-schema-verifier-test',
  signer_identity: 'github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/actions/schema-verifier',
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
  allowed_key_ids: ['spec014-schema-verifier-test'],
  expected_public_key_fingerprints: {
    'spec014-schema-verifier-test': publicKeyFingerprint,
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
assert.equal(verified.evidence.runtime_parity, true);
assert.equal(verified.evidence.database_fingerprint, databaseFingerprint);
assert.equal(verified.evidence.public_key_fingerprint_sha256, publicKeyFingerprint);
assert.equal(verified.evidence.readback_cycle_id, readback.cycle_id);
assert.equal(verified.evidence.age_minutes, 5);
assert.equal(verified.evidence.signing_delay_minutes, 2);
assert.equal(verified.evidence.readback_duration_minutes, 3);
assert.equal(verified.secrets_included, false);

const corruptedSignatureB64Url = `${signatureB64Url.startsWith('A') ? 'B' : 'A'}${signatureB64Url.slice(1)}`;
const invalidSignature = verifyHostingerStorageSchemaVerification({
  subject,
  attestation: { ...attestation, signature_b64url: corruptedSignatureB64Url },
  public_key_jwk: publicJwk,
  policy,
  now: '2026-08-02T13:45:00.000Z',
});
assert.equal(invalidSignature.ready, false);
assert(invalidSignature.blockers.includes('STORAGE_SCHEMA_VERIFICATION_SIGNATURE_INVALID'));

const wrongSubjectUnsigned = { ...unsignedAttestation, subject_digest: 'e'.repeat(64) };
const wrongSubjectAttestation = {
  ...wrongSubjectUnsigned,
  signature_b64url: sign(
    null,
    Buffer.from(stableHostingerStorageSchemaVerificationJson(hostingerStorageSchemaVerificationSignaturePayload(wrongSubjectUnsigned)), 'utf8'),
    privateKey,
  ).toString('base64url'),
};
const wrongSubject = verifyHostingerStorageSchemaVerification({
  subject,
  attestation: wrongSubjectAttestation,
  public_key_jwk: publicJwk,
  policy,
  now: '2026-08-02T13:45:00.000Z',
});
assert.equal(wrongSubject.ready, false);
assert(wrongSubject.blockers.includes('STORAGE_SCHEMA_VERIFICATION_SIGNATURE_SUBJECT_MISMATCH'));

const paritySubject = buildHostingerStorageSchemaVerificationSubject({
  source_commit: sourceCommit,
  deployed_runtime_sha: 'f'.repeat(40),
  migrations,
  readback,
  created_at: '2026-08-02T13:39:00.000Z',
});
const parityUnsigned = { ...unsignedAttestation, subject_digest: paritySubject.subject_digest };
const parityAttestation = {
  ...parityUnsigned,
  signature_b64url: sign(
    null,
    Buffer.from(stableHostingerStorageSchemaVerificationJson(hostingerStorageSchemaVerificationSignaturePayload(parityUnsigned)), 'utf8'),
    privateKey,
  ).toString('base64url'),
};
const parityFailure = verifyHostingerStorageSchemaVerification({
  subject: paritySubject,
  attestation: parityAttestation,
  public_key_jwk: publicJwk,
  policy: { ...policy, expected_deployed_runtime_sha: null },
  now: '2026-08-02T13:45:00.000Z',
});
assert.equal(parityFailure.ready, false);
assert(parityFailure.blockers.includes('STORAGE_SCHEMA_VERIFICATION_RUNTIME_PARITY_REQUIRED'));

const databaseFailure = verifyHostingerStorageSchemaVerification({
  subject,
  attestation,
  public_key_jwk: publicJwk,
  policy: { ...policy, expected_database_fingerprint: '9'.repeat(64) },
  now: '2026-08-02T13:45:00.000Z',
});
assert.equal(databaseFailure.ready, false);
assert(databaseFailure.blockers.includes('STORAGE_SCHEMA_VERIFICATION_DATABASE_FINGERPRINT_MISMATCH'));

const stale = verifyHostingerStorageSchemaVerification({
  subject,
  attestation,
  public_key_jwk: publicJwk,
  policy,
  now: '2026-08-02T14:00:00.000Z',
});
assert.equal(stale.ready, false);
assert(stale.blockers.includes('STORAGE_SCHEMA_VERIFICATION_EXPIRED'));
assert(stale.blockers.includes('STORAGE_SCHEMA_VERIFICATION_STALE'));

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
    readback: { ...readback, enabled_tool_count: 1, disabled_tool_count: 2 },
    created_at: '2026-08-02T13:39:00.000Z',
  }),
  (error) => error.code === 'STORAGE_SCHEMA_VERIFICATION_READBACK_NOT_READY'
    && error.details?.mismatches?.includes('enabled_tool_count'),
);

assert.throws(
  () => buildHostingerStorageSchemaVerificationSubject({
    source_commit: sourceCommit,
    deployed_runtime_sha: sourceCommit,
    migrations,
    readback: { ...readback, contract_key: 'spec014_hostinger_storage_migration_readback_v3' },
    created_at: '2026-08-02T13:39:00.000Z',
  }),
  (error) => error.code === 'STORAGE_SCHEMA_VERIFICATION_READBACK_CONTRACT_MISMATCH'
    && error.details?.expected === 'spec014_hostinger_storage_migration_readback_v4',
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
    migrations: migrations.map((row, index) => index === 3 ? { ...row, ledger_mode: 'dry_run' } : row),
    readback,
    created_at: '2026-08-02T13:39:00.000Z',
  }),
  (error) => error.code === 'STORAGE_SCHEMA_VERIFICATION_MIGRATION_EVIDENCE_MISMATCH'
    && error.details?.wave === 4
    && error.details?.mismatches?.includes('ledger_mode'),
);

assert.throws(
  () => buildHostingerStorageSchemaVerificationSubject({
    source_commit: sourceCommit,
    deployed_runtime_sha: sourceCommit,
    migrations: migrations.map((row, index) => index === 1 ? { ...row, ledger_mode: 'dry_run' } : row),
    readback,
    created_at: '2026-08-02T13:39:00.000Z',
  }),
  (error) => error.code === 'STORAGE_SCHEMA_VERIFICATION_MIGRATION_EVIDENCE_MISMATCH'
    && error.details?.wave === 2,
);

assert.throws(
  () => buildHostingerStorageSchemaVerificationSubject({
    source_commit: sourceCommit,
    deployed_runtime_sha: sourceCommit,
    migrations,
    readback: { ...readback, password: 'forbidden' },
    created_at: '2026-08-02T13:39:00.000Z',
  }),
  (error) => error.code === 'STORAGE_SCHEMA_VERIFICATION_SECRET_FIELD_REJECTED'
    && error.details?.path === 'schema_verification_subject.readback.password',
);

const tamperedSubject = structuredClone(subject);
tamperedSubject.payload.readback.object_inventory_digest = '8'.repeat(64);
assert.throws(
  () => verifyHostingerStorageSchemaVerification({
    subject: tamperedSubject,
    attestation,
    public_key_jwk: publicJwk,
    policy,
    now: '2026-08-02T13:45:00.000Z',
  }),
  (error) => ['STORAGE_SCHEMA_VERIFICATION_READBACK_DIGEST_MISMATCH', 'STORAGE_SCHEMA_VERIFICATION_SUBJECT_TAMPERED'].includes(error.code),
);

assert.deepEqual(
  contract.migration_sequence.map(({ wave, migration, checksum_sha256, statement_count }) => ({ wave, migration, checksum_sha256, statement_count })),
  HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.migrations,
);
assert.deepEqual(contract.expected_counts, {
  compatible_tables: 17,
  present_views: 3,
  compatible_runtime_columns: 68,
  compatible_runtime_index_columns: 31,
  observed_tools: 3,
  disabled_tools: 3,
  enabled_tools: 0,
});
assert.deepEqual(contract.required_zero_activity, {
  provider_calls: 0,
  protected_payload_reads: 0,
  external_writes: 0,
  secrets_included: false,
});

console.log(JSON.stringify({
  ok: true,
  contract: contract.contract,
  readback_contract_key: readback.contract_key,
  migration_wave_count: migrations.length,
  compatible_table_count: readback.compatible_table_count,
  compatible_runtime_column_count: readback.compatible_runtime_column_count,
  compatible_runtime_index_column_count: readback.compatible_runtime_index_column_count,
  subject_digest: subject.subject_digest,
  evidence_digest: verified.evidence_digest,
  synthetic_signature_verified: true,
  private_key_committed: false,
  live_database_access_performed: false,
  migration_apply_performed: false,
  provider_dispatch_performed: false,
  schema_verified_in_live_environment: false,
  production_ready: false,
  secrets_included: false,
}, null, 2));
