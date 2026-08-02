import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto';
import { assertHostingerStorageSecretFree } from './hostingerStorageAttestationSecretFree.js';

export const HOSTINGER_STORAGE_SCHEMA_VERIFICATION_VERSION = 'spec014-hostinger-storage-schema-verification-v1';
export const HOSTINGER_STORAGE_SCHEMA_PREDICATE_TYPE = 'https://mad4b.com/attestations/hostinger-storage-schema-verification/v1';
export const HOSTINGER_STORAGE_SCHEMA_SUBJECT_TYPE = 'application/vnd.in-toto+json';

const SUBJECT_KEY = 'hostinger_storage_schema_verification_v1';
const READBACK_CONTRACT_KEY = 'spec014_hostinger_storage_migration_readback_v4';
const SHA256_RE = /^[0-9a-f]{64}$/u;
const COMMIT_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/u;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;

export const HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS = Object.freeze({
  table_count: 17,
  view_count: 3,
  runtime_column_count: 68,
  runtime_index_column_count: 31,
  default_off_tool_count: 3,
  migrations: Object.freeze([
    Object.freeze({
      wave: 1,
      migration: '20260802_01_spec014_hostinger_storage_foundation.sql',
      checksum_sha256: '9eca6e585d12de633931c7d7e099f467a955aaf7b819ccb2660d34acf63d5053',
      statement_count: 4,
    }),
    Object.freeze({
      wave: 2,
      migration: '20260802_02_spec014_hostinger_storage_control_plane.sql',
      checksum_sha256: '80d0006012b48a022f19b70174ccaf5bf922cad87255c47e1eb08e23da3c4b33',
      statement_count: 6,
    }),
    Object.freeze({
      wave: 3,
      migration: '20260802_03_spec014_hostinger_storage_execution_evidence.sql',
      checksum_sha256: 'cf484d413399bbd3a0ea9ff36155ceb8b369e1bd43c63c300a93a179e0a57096',
      statement_count: 9,
    }),
    Object.freeze({
      wave: 4,
      migration: '20260802_04_spec014_hostinger_storage_authorized_injection_state.sql',
      checksum_sha256: 'fbc70636d07b2ae2e757ab20f48538746ea773bdba1c19e2604aeaa292b31981',
      statement_count: 2,
    }),
  ]),
});

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function stableHostingerStorageSchemaVerificationJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function digest(value) {
  return createHash('sha256').update(stableHostingerStorageSchemaVerificationJson(value), 'utf8').digest('hex');
}

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function safeId(value, field) {
  const result = text(value, 256);
  if (!SAFE_ID_RE.test(result)) {
    throw fail(400, 'STORAGE_SCHEMA_VERIFICATION_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return result;
}

function hash(value, field) {
  const result = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(result)) {
    throw fail(400, 'STORAGE_SCHEMA_VERIFICATION_HASH_INVALID', 'A SHA-256 binding is required.', { field });
  }
  return result;
}

function commit(value, field) {
  const result = text(value, 64).toLowerCase();
  if (!COMMIT_RE.test(result)) {
    throw fail(400, 'STORAGE_SCHEMA_VERIFICATION_COMMIT_INVALID', 'A full source commit binding is required.', { field });
  }
  return result;
}

function iso(value, field) {
  const result = text(value, 64);
  const millis = Date.parse(result);
  if (!result || !Number.isFinite(millis)) {
    throw fail(400, 'STORAGE_SCHEMA_VERIFICATION_TIME_INVALID', 'A valid ISO timestamp is required.', { field });
  }
  return new Date(millis).toISOString();
}

function integer(value, field, { minimum = 0 } = {}) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < minimum) {
    throw fail(400, 'STORAGE_SCHEMA_VERIFICATION_COUNT_INVALID', 'An exact non-negative integer count is required.', { field });
  }
  return result;
}

function assertSecretFree(value, at) {
  return assertHostingerStorageSecretFree(value, {
    at,
    allow_authorization_envelope: false,
    on_violation: ({ reason, path, key }) => fail(
      400,
      'STORAGE_SCHEMA_VERIFICATION_SECRET_FIELD_REJECTED',
      'Schema verification inputs must not contain sensitive fields.',
      { reason, path, key: key || null },
    ),
  });
}

function normalizeMigrations(rows) {
  if (!Array.isArray(rows) || rows.length !== HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.migrations.length) {
    throw fail(409, 'STORAGE_SCHEMA_VERIFICATION_MIGRATION_SEQUENCE_INVALID', 'All four governed migration waves are required.');
  }
  return HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.migrations.map((expected, index) => {
    const row = rows[index] || {};
    const normalized = {
      wave: integer(row.wave, `migrations[${index}].wave`, { minimum: 1 }),
      migration: safeId(row.migration, `migrations[${index}].migration`),
      checksum_sha256: hash(row.checksum_sha256, `migrations[${index}].checksum_sha256`),
      statement_count: integer(row.statement_count, `migrations[${index}].statement_count`, { minimum: 1 }),
      ledger_mode: text(row.ledger_mode, 16),
      ledger_status: text(row.ledger_status, 32),
      ledger_evidence_digest: hash(row.ledger_evidence_digest, `migrations[${index}].ledger_evidence_digest`),
    };
    const mismatches = [];
    if (normalized.wave !== expected.wave) mismatches.push('wave');
    if (normalized.migration !== expected.migration) mismatches.push('migration');
    if (normalized.checksum_sha256 !== expected.checksum_sha256) mismatches.push('checksum_sha256');
    if (normalized.statement_count !== expected.statement_count) mismatches.push('statement_count');
    if (normalized.ledger_mode !== 'apply') mismatches.push('ledger_mode');
    if (normalized.ledger_status !== 'success') mismatches.push('ledger_status');
    if (mismatches.length) {
      throw fail(409, 'STORAGE_SCHEMA_VERIFICATION_MIGRATION_EVIDENCE_MISMATCH', 'Migration ledger evidence does not match the governed sequence.', {
        wave: expected.wave,
        mismatches,
      });
    }
    return normalized;
  });
}

function normalizeReadback(value = {}) {
  const normalized = {
    contract_key: text(value.contract_key, 128),
    cycle_id: safeId(value.cycle_id, 'readback.cycle_id'),
    started_at: iso(value.started_at, 'readback.started_at'),
    completed_at: iso(value.completed_at, 'readback.completed_at'),
    database_fingerprint: hash(value.database_fingerprint, 'readback.database_fingerprint'),
    schema_identity_digest: hash(value.schema_identity_digest, 'readback.schema_identity_digest'),
    object_inventory_digest: hash(value.object_inventory_digest, 'readback.object_inventory_digest'),
    constraint_inventory_digest: hash(value.constraint_inventory_digest, 'readback.constraint_inventory_digest'),
    compatible_table_count: integer(value.compatible_table_count, 'readback.compatible_table_count'),
    present_view_count: integer(value.present_view_count, 'readback.present_view_count'),
    compatible_runtime_column_count: integer(value.compatible_runtime_column_count, 'readback.compatible_runtime_column_count'),
    compatible_runtime_index_column_count: integer(value.compatible_runtime_index_column_count, 'readback.compatible_runtime_index_column_count'),
    observed_tool_count: integer(value.observed_tool_count, 'readback.observed_tool_count'),
    disabled_tool_count: integer(value.disabled_tool_count, 'readback.disabled_tool_count'),
    enabled_tool_count: integer(value.enabled_tool_count, 'readback.enabled_tool_count'),
    object_readiness_status: text(value.object_readiness_status, 64),
    runtime_column_readback_status: text(value.runtime_column_readback_status, 64),
    runtime_index_readback_status: text(value.runtime_index_readback_status, 64),
    tool_seed_readback_status: text(value.tool_seed_readback_status, 64),
    provider_calls: integer(value.provider_calls, 'readback.provider_calls'),
    protected_payload_reads: integer(value.protected_payload_reads, 'readback.protected_payload_reads'),
    external_writes: integer(value.external_writes, 'readback.external_writes'),
    secrets_included: value.secrets_included === false ? false : true,
  };
  if (normalized.contract_key !== READBACK_CONTRACT_KEY) {
    throw fail(409, 'STORAGE_SCHEMA_VERIFICATION_READBACK_CONTRACT_MISMATCH', 'Unexpected migration readback contract.', {
      expected: READBACK_CONTRACT_KEY,
      actual: normalized.contract_key || null,
    });
  }
  if (Date.parse(normalized.completed_at) < Date.parse(normalized.started_at)) {
    throw fail(409, 'STORAGE_SCHEMA_VERIFICATION_READBACK_TIME_INVALID', 'Readback completion precedes its start.');
  }
  const mismatches = [];
  if (normalized.compatible_table_count !== HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.table_count) mismatches.push('compatible_table_count');
  if (normalized.present_view_count !== HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.view_count) mismatches.push('present_view_count');
  if (normalized.compatible_runtime_column_count !== HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.runtime_column_count) mismatches.push('compatible_runtime_column_count');
  if (normalized.compatible_runtime_index_column_count !== HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.runtime_index_column_count) mismatches.push('compatible_runtime_index_column_count');
  if (normalized.observed_tool_count !== HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.default_off_tool_count) mismatches.push('observed_tool_count');
  if (normalized.disabled_tool_count !== HOSTINGER_STORAGE_SCHEMA_EXPECTATIONS.default_off_tool_count) mismatches.push('disabled_tool_count');
  if (normalized.enabled_tool_count !== 0) mismatches.push('enabled_tool_count');
  if (normalized.object_readiness_status !== 'ready_for_column_index_constraint_readback') mismatches.push('object_readiness_status');
  if (normalized.runtime_column_readback_status !== 'ready') mismatches.push('runtime_column_readback_status');
  if (normalized.runtime_index_readback_status !== 'ready') mismatches.push('runtime_index_readback_status');
  if (normalized.tool_seed_readback_status !== 'ready_default_off') mismatches.push('tool_seed_readback_status');
  if (normalized.provider_calls !== 0) mismatches.push('provider_calls');
  if (normalized.protected_payload_reads !== 0) mismatches.push('protected_payload_reads');
  if (normalized.external_writes !== 0) mismatches.push('external_writes');
  if (normalized.secrets_included !== false) mismatches.push('secrets_included');
  if (mismatches.length) {
    throw fail(409, 'STORAGE_SCHEMA_VERIFICATION_READBACK_NOT_READY', 'Live readback does not prove the complete default-off schema contract.', { mismatches });
  }
  return normalized;
}

function normalizeSubjectPayload(payload = {}) {
  const normalized = {
    schema_version: integer(payload.schema_version, 'payload.schema_version', { minimum: 1 }),
    subject_key: text(payload.subject_key, 128),
    attestation_version: text(payload.attestation_version, 128),
    created_at: iso(payload.created_at, 'payload.created_at'),
    repository: text(payload.repository, 256),
    source_commit: commit(payload.source_commit, 'payload.source_commit'),
    deployed_runtime_sha: commit(payload.deployed_runtime_sha, 'payload.deployed_runtime_sha'),
    migrations: normalizeMigrations(payload.migrations),
    readback: normalizeReadback(payload.readback),
    readback_digest: hash(payload.readback_digest, 'payload.readback_digest'),
    migration_evidence_digest: hash(payload.migration_evidence_digest, 'payload.migration_evidence_digest'),
    secrets_included: payload.secrets_included === false ? false : true,
  };
  if (normalized.schema_version !== 1 || normalized.subject_key !== SUBJECT_KEY || normalized.attestation_version !== HOSTINGER_STORAGE_SCHEMA_VERIFICATION_VERSION) {
    throw fail(409, 'STORAGE_SCHEMA_VERIFICATION_SUBJECT_SCHEMA_INVALID', 'Unexpected schema verification subject identity.');
  }
  if (normalized.repository !== 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os') {
    throw fail(409, 'STORAGE_SCHEMA_VERIFICATION_REPOSITORY_INVALID', 'Schema evidence is bound to an unexpected repository.');
  }
  if (normalized.readback_digest !== digest(normalized.readback)) {
    throw fail(409, 'STORAGE_SCHEMA_VERIFICATION_READBACK_DIGEST_MISMATCH', 'Readback digest does not match the normalized readback evidence.');
  }
  if (normalized.migration_evidence_digest !== digest(normalized.migrations)) {
    throw fail(409, 'STORAGE_SCHEMA_VERIFICATION_MIGRATION_DIGEST_MISMATCH', 'Migration evidence digest does not match the governed migration sequence.');
  }
  if (normalized.secrets_included !== false) {
    throw fail(409, 'STORAGE_SCHEMA_VERIFICATION_SECRET_DECLARATION_INVALID', 'Schema verification evidence must declare that no secrets are included.');
  }
  return normalized;
}

export function buildHostingerStorageSchemaVerificationSubject({
  repository = 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os',
  source_commit,
  deployed_runtime_sha,
  migrations,
  readback,
  created_at,
} = {}) {
  assertSecretFree({ repository, source_commit, deployed_runtime_sha, migrations, readback, created_at, secrets_included: false }, 'schema_verification_subject');
  const normalizedMigrations = normalizeMigrations(migrations);
  const normalizedReadback = normalizeReadback(readback);
  const payload = Object.freeze({
    schema_version: 1,
    subject_key: SUBJECT_KEY,
    attestation_version: HOSTINGER_STORAGE_SCHEMA_VERIFICATION_VERSION,
    created_at: iso(created_at, 'created_at'),
    repository: text(repository, 256),
    source_commit: commit(source_commit, 'source_commit'),
    deployed_runtime_sha: commit(deployed_runtime_sha, 'deployed_runtime_sha'),
    migrations: normalizedMigrations,
    readback: normalizedReadback,
    readback_digest: digest(normalizedReadback),
    migration_evidence_digest: digest(normalizedMigrations),
    secrets_included: false,
  });
  const normalized = normalizeSubjectPayload(payload);
  const subjectDigest = digest(normalized);
  return Object.freeze({
    ok: true,
    subject_type: HOSTINGER_STORAGE_SCHEMA_SUBJECT_TYPE,
    predicate_type: HOSTINGER_STORAGE_SCHEMA_PREDICATE_TYPE,
    subject_name: `hostinger-storage-schema:${normalized.readback.cycle_id}`,
    subject_digest: subjectDigest,
    payload: Object.freeze(normalized),
    signing_allowed: false,
    schema_verified: false,
    production_ready: false,
    authority_granted: false,
    migration_apply_authorized: false,
    blockers: Object.freeze(['SIGNED_SCHEMA_VERIFICATION_REQUIRED']),
    secrets_included: false,
  });
}

function signerAllowed(identity, patterns = []) {
  return patterns.some((pattern) => {
    const normalized = text(pattern, 256);
    if (normalized.endsWith('*')) return identity.startsWith(normalized.slice(0, -1));
    return identity === normalized;
  });
}

function normalizePublicJwk(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(400, 'STORAGE_SCHEMA_VERIFICATION_PUBLIC_KEY_INVALID', 'An Ed25519 public JWK is required.');
  }
  if (Object.hasOwn(value, 'd')) {
    throw fail(400, 'STORAGE_SCHEMA_VERIFICATION_PRIVATE_KEY_REJECTED', 'Private key material must never be supplied to the verifier.');
  }
  const normalized = {
    kty: text(value.kty, 16),
    crv: text(value.crv, 32),
    x: text(value.x, 128),
  };
  if (normalized.kty !== 'OKP' || normalized.crv !== 'Ed25519' || !BASE64URL_RE.test(normalized.x)) {
    throw fail(400, 'STORAGE_SCHEMA_VERIFICATION_PUBLIC_KEY_INVALID', 'An Ed25519 public JWK is required.');
  }
  return normalized;
}

export function hostingerStorageSchemaVerificationSignaturePayload(attestation = {}) {
  return {
    attestation_version: HOSTINGER_STORAGE_SCHEMA_VERIFICATION_VERSION,
    subject_digest: hash(attestation.subject_digest, 'attestation.subject_digest'),
    key_id: safeId(attestation.key_id, 'attestation.key_id'),
    signer_identity: safeId(attestation.signer_identity, 'attestation.signer_identity'),
    issuer: safeId(attestation.issuer, 'attestation.issuer'),
    signed_at: iso(attestation.signed_at, 'attestation.signed_at'),
    expires_at: iso(attestation.expires_at, 'attestation.expires_at'),
  };
}

function base64UrlDecode(value) {
  const normalized = text(value, 4096);
  if (!BASE64URL_RE.test(normalized)) {
    throw fail(400, 'STORAGE_SCHEMA_VERIFICATION_SIGNATURE_INVALID', 'A base64url signature is required.');
  }
  return Buffer.from(normalized, 'base64url');
}

export function verifyHostingerStorageSchemaVerification({
  subject,
  attestation,
  public_key_jwk,
  policy,
  now,
} = {}) {
  assertSecretFree({ subject, attestation, public_key_jwk, policy, now, secrets_included: false }, 'schema_verification');
  if (subject?.subject_type !== HOSTINGER_STORAGE_SCHEMA_SUBJECT_TYPE || subject?.predicate_type !== HOSTINGER_STORAGE_SCHEMA_PREDICATE_TYPE) {
    throw fail(409, 'STORAGE_SCHEMA_VERIFICATION_SUBJECT_TYPE_INVALID', 'Unexpected schema verification subject type.');
  }
  const normalizedPayload = normalizeSubjectPayload(subject?.payload);
  if (subject.subject_name !== `hostinger-storage-schema:${normalizedPayload.readback.cycle_id}`) {
    throw fail(409, 'STORAGE_SCHEMA_VERIFICATION_SUBJECT_NAME_INVALID', 'Subject name is not bound to the readback cycle.');
  }
  const calculatedSubjectDigest = digest(normalizedPayload);
  if (subject.subject_digest !== calculatedSubjectDigest) {
    throw fail(409, 'STORAGE_SCHEMA_VERIFICATION_SUBJECT_TAMPERED', 'Subject digest does not match its normalized payload.');
  }

  const signedPayload = hostingerStorageSchemaVerificationSignaturePayload(attestation);
  const publicJwk = normalizePublicJwk(public_key_jwk);
  const publicKeyFingerprint = digest(publicJwk);
  const blockers = [];
  if (signedPayload.subject_digest !== calculatedSubjectDigest) blockers.push('STORAGE_SCHEMA_VERIFICATION_SIGNATURE_SUBJECT_MISMATCH');
  if (!(policy?.allowed_key_ids || []).includes(signedPayload.key_id)) blockers.push('STORAGE_SCHEMA_VERIFICATION_KEY_FORBIDDEN');
  if (policy?.expected_public_key_fingerprints?.[signedPayload.key_id] !== publicKeyFingerprint) blockers.push('STORAGE_SCHEMA_VERIFICATION_KEY_FINGERPRINT_MISMATCH');
  if (!signerAllowed(signedPayload.signer_identity, policy?.allowed_signer_patterns || [])) blockers.push('STORAGE_SCHEMA_VERIFICATION_SIGNER_FORBIDDEN');
  if (!(policy?.allowed_issuers || []).includes(signedPayload.issuer)) blockers.push('STORAGE_SCHEMA_VERIFICATION_ISSUER_FORBIDDEN');

  try {
    const publicKey = createPublicKey({ key: publicJwk, format: 'jwk' });
    const verified = verifySignature(
      null,
      Buffer.from(stableHostingerStorageSchemaVerificationJson(signedPayload), 'utf8'),
      publicKey,
      base64UrlDecode(attestation?.signature_b64url),
    );
    if (!verified) blockers.push('STORAGE_SCHEMA_VERIFICATION_SIGNATURE_INVALID');
  } catch {
    blockers.push('STORAGE_SCHEMA_VERIFICATION_SIGNATURE_INVALID');
  }

  const nowMs = Date.parse(iso(now, 'now'));
  const signedAtMs = Date.parse(signedPayload.signed_at);
  const expiresAtMs = Date.parse(signedPayload.expires_at);
  const readbackStartedMs = Date.parse(normalizedPayload.readback.started_at);
  const readbackCompletedMs = Date.parse(normalizedPayload.readback.completed_at);
  const createdAtMs = Date.parse(normalizedPayload.created_at);
  if (expiresAtMs <= signedAtMs) blockers.push('STORAGE_SCHEMA_VERIFICATION_EXPIRY_INVALID');
  if (nowMs >= expiresAtMs) blockers.push('STORAGE_SCHEMA_VERIFICATION_EXPIRED');
  if (signedAtMs > nowMs) blockers.push('STORAGE_SCHEMA_VERIFICATION_TIME_IN_FUTURE');
  if (createdAtMs < readbackCompletedMs || createdAtMs > signedAtMs) blockers.push('STORAGE_SCHEMA_VERIFICATION_SUBJECT_TIME_INVALID');
  if (signedAtMs < readbackCompletedMs) blockers.push('STORAGE_SCHEMA_VERIFICATION_SIGNED_BEFORE_READBACK');

  const ageMinutes = (nowMs - signedAtMs) / 60000;
  const signingDelayMinutes = (signedAtMs - readbackCompletedMs) / 60000;
  const readbackDurationMinutes = (readbackCompletedMs - readbackStartedMs) / 60000;
  if (ageMinutes > Number(policy?.max_age_minutes ?? 15)) blockers.push('STORAGE_SCHEMA_VERIFICATION_STALE');
  if (signingDelayMinutes > Number(policy?.max_signing_delay_minutes ?? 5)) blockers.push('STORAGE_SCHEMA_VERIFICATION_SIGNING_DELAY_EXCEEDED');
  if (readbackDurationMinutes > Number(policy?.max_readback_cycle_minutes ?? 10)) blockers.push('STORAGE_SCHEMA_VERIFICATION_READBACK_CYCLE_TOO_LONG');

  const expectedSource = policy?.expected_source_commit ? commit(policy.expected_source_commit, 'policy.expected_source_commit') : null;
  const expectedRuntime = policy?.expected_deployed_runtime_sha ? commit(policy.expected_deployed_runtime_sha, 'policy.expected_deployed_runtime_sha') : null;
  const expectedDatabaseFingerprint = policy?.expected_database_fingerprint ? hash(policy.expected_database_fingerprint, 'policy.expected_database_fingerprint') : null;
  if (expectedSource && normalizedPayload.source_commit !== expectedSource) blockers.push('STORAGE_SCHEMA_VERIFICATION_SOURCE_COMMIT_MISMATCH');
  if (expectedRuntime && normalizedPayload.deployed_runtime_sha !== expectedRuntime) blockers.push('STORAGE_SCHEMA_VERIFICATION_RUNTIME_SHA_MISMATCH');
  if (policy?.runtime_parity_required === true && normalizedPayload.source_commit !== normalizedPayload.deployed_runtime_sha) blockers.push('STORAGE_SCHEMA_VERIFICATION_RUNTIME_PARITY_REQUIRED');
  if (expectedDatabaseFingerprint && normalizedPayload.readback.database_fingerprint !== expectedDatabaseFingerprint) blockers.push('STORAGE_SCHEMA_VERIFICATION_DATABASE_FINGERPRINT_MISMATCH');

  const evidence = Object.freeze({
    schema_version: 1,
    evidence_key: 'hostinger_storage_signed_schema_verification_v1',
    subject_digest: calculatedSubjectDigest,
    source_commit: normalizedPayload.source_commit,
    deployed_runtime_sha: normalizedPayload.deployed_runtime_sha,
    runtime_parity: normalizedPayload.source_commit === normalizedPayload.deployed_runtime_sha,
    readback_cycle_id: normalizedPayload.readback.cycle_id,
    readback_digest: normalizedPayload.readback_digest,
    migration_evidence_digest: normalizedPayload.migration_evidence_digest,
    database_fingerprint: normalizedPayload.readback.database_fingerprint,
    key_id: signedPayload.key_id,
    public_key_fingerprint_sha256: publicKeyFingerprint,
    signer_identity: signedPayload.signer_identity,
    issuer: signedPayload.issuer,
    signed_at: signedPayload.signed_at,
    expires_at: signedPayload.expires_at,
    verified_at: new Date(nowMs).toISOString(),
    age_minutes: Number(ageMinutes.toFixed(3)),
    signing_delay_minutes: Number(signingDelayMinutes.toFixed(3)),
    readback_duration_minutes: Number(readbackDurationMinutes.toFixed(3)),
    blockers: Object.freeze([...new Set(blockers)].sort()),
    secrets_included: false,
  });
  const ready = evidence.blockers.length === 0;
  return Object.freeze({
    ok: true,
    ready,
    schema_verified: ready,
    production_ready: false,
    authority_granted: false,
    migration_apply_authorized: false,
    provider_dispatch_allowed: false,
    evidence,
    evidence_digest: digest(evidence),
    blockers: evidence.blockers,
    secrets_included: false,
  });
}
