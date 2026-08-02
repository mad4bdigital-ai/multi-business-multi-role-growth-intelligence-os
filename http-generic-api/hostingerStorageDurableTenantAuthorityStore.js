import { createHash } from 'node:crypto';

export const HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_STORE_VERSION = 'spec014-hostinger-storage-durable-tenant-authority-store-v1';

const BRAND = Symbol.for('mad4b.spec014.hostinger-storage-durable-tenant-authority-store');
const LOCK_NAME = 'spec014:hostinger-storage-tenant-authority';
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const ALLOWED_OPTIONS = new Set(['pool', 'schema_verification', 'lock_timeout_seconds']);
const ALLOWLIST_STATUSES = new Set(['active', 'blocked', 'revoked', 'expired']);
const APPROVAL_STATUSES = new Set(['approved', 'denied', 'revoked', 'expired']);

export const HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_SCHEMA_CONTRACT = Object.freeze({
  contract_key: 'hostinger_storage_durable_tenant_authority_store_schema_v1',
  tables: Object.freeze([
    'storage_tenant_authority_allowlists',
    'storage_tenant_authority_approvals',
    'storage_tenant_authority_token_history',
  ]),
  current_row_cas: true,
  immutable_token_history: true,
  tenant_exclusive: true,
  secrets_included: false,
});

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = Object.freeze({ ...details, secrets_included: false });
  return error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export const HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_SCHEMA_DIGEST = digest(
  HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_SCHEMA_CONTRACT,
);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function identifier(value, field, max = 256) {
  const normalized = text(value, max);
  if (!SAFE_ID_RE.test(normalized) || normalized.length > max) {
    throw fail(400, 'STORAGE_DURABLE_AUTHORITY_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return normalized;
}

function hash(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw fail(400, 'STORAGE_DURABLE_AUTHORITY_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  }
  return normalized;
}

function integer(value, field, minimum = 0) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    throw fail(400, 'STORAGE_DURABLE_AUTHORITY_INTEGER_INVALID', 'A bounded integer is required.', { field, minimum });
  }
  return normalized;
}

function opaqueRef(value, field, max = 512) {
  const normalized = identifier(value, field, max);
  if (normalized.startsWith('/') || normalized.includes('..') || /[\\\0\r\n]/u.test(normalized)) {
    throw fail(400, 'STORAGE_DURABLE_AUTHORITY_REFERENCE_INVALID', 'An opaque bounded reference is required.', { field });
  }
  return normalized;
}

function assertDataOnly(value, path = 'value', active = new WeakSet(), depth = 0) {
  if (depth > 20) throw fail(400, 'STORAGE_DURABLE_AUTHORITY_DATA_TOO_DEEP', 'Authority input exceeded the supported depth.', { path });
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') throw fail(400, 'STORAGE_DURABLE_AUTHORITY_DATA_INVALID', 'Authority inputs must contain data values only.', { path });
  if (active.has(value)) throw fail(400, 'STORAGE_DURABLE_AUTHORITY_DATA_CYCLE', 'Authority inputs must not contain cycles.', { path });
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw fail(400, 'STORAGE_DURABLE_AUTHORITY_DATA_INVALID', 'Authority inputs must use plain data objects.', { path });
  }
  active.add(value);
  try {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        throw fail(400, 'STORAGE_DURABLE_AUTHORITY_ACCESSOR_REJECTED', 'Authority inputs must not contain accessor properties.', { path: `${path}.${key}` });
      }
      if (key === 'secrets_included' && descriptor.value !== false) {
        throw fail(400, 'STORAGE_DURABLE_AUTHORITY_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
      }
      if (key !== 'secrets_included' && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command)/i.test(key)) {
        throw fail(400, 'STORAGE_DURABLE_AUTHORITY_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Authority inputs cannot contain secrets or free-form execution fields.', { path: `${path}.${key}` });
      }
      assertDataOnly(descriptor.value, `${path}.${key}`, active, depth + 1);
    }
  } finally {
    active.delete(value);
  }
}

function snapshot(value, path) {
  assertDataOnly(value, path);
  return clone(value);
}

function normalizeAllowlist(input = {}) {
  const record = snapshot(input, 'allowlist');
  const status = identifier(record.status, 'allowlist.status', 32).toLowerCase();
  if (!ALLOWLIST_STATUSES.has(status)) {
    throw fail(400, 'STORAGE_DURABLE_AUTHORITY_ALLOWLIST_STATUS_INVALID', 'Unsupported allowlist status.', { status });
  }
  const targetScope = identifier(record.target_scope, 'allowlist.target_scope', 32).toLowerCase();
  if (targetScope !== 'tenant' || record.shared_target !== false || record.platform_target !== false) {
    throw fail(409, 'STORAGE_DURABLE_AUTHORITY_TENANT_EXCLUSIVE_SCOPE_REQUIRED', 'Durable Tenant authority records must remain Tenant-exclusive.');
  }
  const normalized = {
    allowlist_id: identifier(record.allowlist_id, 'allowlist.allowlist_id', 36),
    revision: identifier(record.revision, 'allowlist.revision', 191),
    status,
    environment: identifier(record.environment, 'allowlist.environment', 32),
    target_scope: targetScope,
    tenant_id: identifier(record.tenant_id, 'allowlist.tenant_id', 36),
    workspace_id: identifier(record.workspace_id, 'allowlist.workspace_id', 36),
    resource_id: identifier(record.resource_id, 'allowlist.resource_id', 36),
    target_id: identifier(record.target_id, 'allowlist.target_id', 36),
    root_ref: opaqueRef(record.root_ref, 'allowlist.root_ref'),
    path_ref_prefix: opaqueRef(record.path_ref_prefix, 'allowlist.path_ref_prefix'),
    shared_target: false,
    platform_target: false,
    valid_from_epoch: integer(record.valid_from_epoch, 'allowlist.valid_from_epoch'),
    expires_at_epoch: integer(record.expires_at_epoch, 'allowlist.expires_at_epoch', 1),
    max_items: integer(record.max_items, 'allowlist.max_items', 1),
    max_bytes: integer(record.max_bytes, 'allowlist.max_bytes'),
    evidence_digest: hash(record.evidence_digest, 'allowlist.evidence_digest'),
    secrets_included: false,
  };
  if (normalized.valid_from_epoch >= normalized.expires_at_epoch) {
    throw fail(409, 'STORAGE_DURABLE_AUTHORITY_ALLOWLIST_TIME_WINDOW_INVALID', 'Allowlist validity must end after it begins.');
  }
  normalized.record_digest = digest(normalized);
  return deepFreeze(normalized);
}

function normalizeApproval(input = {}) {
  const record = snapshot(input, 'approval');
  const status = identifier(record.status, 'approval.status', 32).toLowerCase();
  if (!APPROVAL_STATUSES.has(status)) {
    throw fail(400, 'STORAGE_DURABLE_AUTHORITY_APPROVAL_STATUS_INVALID', 'Unsupported approval status.', { status });
  }
  const approverRole = identifier(record.approver_role, 'approval.approver_role', 64).toLowerCase();
  if (approverRole !== 'workspace_owner') {
    throw fail(409, 'STORAGE_DURABLE_AUTHORITY_WORKSPACE_OWNER_REQUIRED', 'Tenant authority approval must be owned by a Workspace Owner.');
  }
  const normalized = {
    approval_id: identifier(record.approval_id, 'approval.approval_id', 36),
    slot: identifier(record.slot, 'approval.slot', 64),
    status,
    tenant_id: identifier(record.tenant_id, 'approval.tenant_id', 36),
    workspace_id: identifier(record.workspace_id, 'approval.workspace_id', 36),
    operation_id: identifier(record.operation_id, 'approval.operation_id', 36),
    target_id: identifier(record.target_id, 'approval.target_id', 36),
    plan_hash: hash(record.plan_hash, 'approval.plan_hash'),
    authority_context_hash: hash(record.authority_context_hash, 'approval.authority_context_hash'),
    approver_role: approverRole,
    approved_at_epoch: integer(record.approved_at_epoch, 'approval.approved_at_epoch'),
    expires_at_epoch: integer(record.expires_at_epoch, 'approval.expires_at_epoch', 1),
    evidence_digest: hash(record.evidence_digest, 'approval.evidence_digest'),
    secrets_included: false,
  };
  if (normalized.approved_at_epoch >= normalized.expires_at_epoch) {
    throw fail(409, 'STORAGE_DURABLE_AUTHORITY_APPROVAL_TIME_WINDOW_INVALID', 'Approval expiry must be after its decision time.');
  }
  normalized.record_digest = digest(normalized);
  return deepFreeze(normalized);
}

function parseRecord(row, table) {
  let value = row?.record_json;
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch {
      throw fail(409, 'STORAGE_DURABLE_AUTHORITY_RECORD_JSON_INVALID', 'Durable authority record JSON is invalid.', { table });
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(409, 'STORAGE_DURABLE_AUTHORITY_RECORD_JSON_INVALID', 'Durable authority record JSON is invalid.', { table });
  }
  assertDataOnly(value, `${table}.record_json`);
  if (value.record_digest !== row.record_digest) {
    throw fail(409, 'STORAGE_DURABLE_AUTHORITY_RECORD_DIGEST_MISMATCH', 'Durable authority record digest mismatch.', { table });
  }
  return deepFreeze(clone(value));
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function historyId(authorityType, authorityId, tokenKind, tokenValue) {
  const hex = createHash('sha256')
    .update(`${authorityType}\0${authorityId}\0${tokenKind}\0${tokenValue}`)
    .digest('hex')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-b${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function assertSchemaVerification(value) {
  assertDataOnly(value, 'schema_verification');
  if (value?.ready !== true || value?.schema_verified !== true || (value?.blockers || []).length !== 0) {
    throw fail(409, 'STORAGE_DURABLE_AUTHORITY_SCHEMA_VERIFICATION_REQUIRED', 'Successful signed authority-store schema verification is required.');
  }
  if (value.production_ready !== false || value.authority_granted !== false
    || value.migration_apply_authorized !== false || value.provider_dispatch_allowed !== false) {
    throw fail(409, 'STORAGE_DURABLE_AUTHORITY_SCHEMA_BOUNDARY_INVALID', 'Schema verification cannot grant production, migration, authority, or provider capability.');
  }
  const evidence = value.evidence || {};
  const schema = evidence.authority_store_schema || {};
  const expectedTables = [...HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_SCHEMA_CONTRACT.tables];
  const observedTables = Array.isArray(schema.tables) ? [...schema.tables].sort() : [];
  if (schema.contract_key !== HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_SCHEMA_CONTRACT.contract_key
    || schema.contract_digest !== HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_SCHEMA_DIGEST
    || JSON.stringify(observedTables) !== JSON.stringify(expectedTables.sort())) {
    throw fail(409, 'STORAGE_DURABLE_AUTHORITY_SCHEMA_CONTRACT_MISMATCH', 'Signed schema verification does not bind the exact authority-store schema contract.');
  }
  const verified = {
    evidence_digest: hash(value.evidence_digest, 'schema_verification.evidence_digest'),
    source_commit: identifier(evidence.source_commit, 'schema_verification.source_commit', 64),
    deployed_runtime_sha: identifier(evidence.deployed_runtime_sha, 'schema_verification.deployed_runtime_sha', 64),
    runtime_parity: evidence.runtime_parity === true,
    database_fingerprint: hash(evidence.database_fingerprint, 'schema_verification.database_fingerprint'),
    readback_cycle_id: identifier(evidence.readback_cycle_id, 'schema_verification.readback_cycle_id', 191),
    expires_at: identifier(evidence.expires_at, 'schema_verification.expires_at', 64),
    schema_contract_digest: schema.contract_digest,
    secrets_included: false,
  };
  if (!verified.runtime_parity || verified.source_commit !== verified.deployed_runtime_sha) {
    throw fail(409, 'STORAGE_DURABLE_AUTHORITY_RUNTIME_PARITY_REQUIRED', 'Exact deployed runtime parity is required.');
  }
  if (Date.parse(verified.expires_at) <= Date.now()) {
    throw fail(409, 'STORAGE_DURABLE_AUTHORITY_SCHEMA_VERIFICATION_EXPIRED', 'Authority-store schema verification expired.');
  }
  return deepFreeze(verified);
}

async function execute(connection, statement, params = []) {
  const method = typeof connection?.execute === 'function' ? 'execute' : 'query';
  if (typeof connection?.[method] !== 'function') {
    throw fail(500, 'STORAGE_DURABLE_AUTHORITY_CONNECTION_INVALID', 'SQL connection must expose execute() or query().');
  }
  return connection[method](statement, params);
}

function normalizeDriverError(error) {
  if (error?.code?.startsWith?.('STORAGE_')) return error;
  if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error?.code)) {
    return fail(503, 'STORAGE_DURABLE_AUTHORITY_SCHEMA_UNAVAILABLE', 'Durable Tenant authority schema is unavailable.', { mysql_code: error.code });
  }
  if (['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)) {
    return fail(409, 'STORAGE_DURABLE_AUTHORITY_CONFLICT', 'Durable Tenant authority state changed concurrently.', { mysql_code: error.code });
  }
  return error;
}

async function transaction(pool, timeoutSeconds, work) {
  const connection = await pool.getConnection();
  let began = false;
  let locked = false;
  try {
    await connection.beginTransaction();
    began = true;
    const [rows] = await execute(connection, '/* spec014:authority:lock:acquire */ SELECT GET_LOCK(?, ?) AS acquired', [LOCK_NAME, timeoutSeconds]);
    if (Number(rows?.[0]?.acquired) !== 1) {
      throw fail(409, 'STORAGE_DURABLE_AUTHORITY_LOCK_UNAVAILABLE', 'Durable Tenant authority lock is unavailable.');
    }
    locked = true;
    const result = await work(connection);
    await connection.commit();
    began = false;
    return result;
  } catch (error) {
    if (began) {
      try { await connection.rollback(); } catch { /* Preserve the primary error. */ }
    }
    throw normalizeDriverError(error);
  } finally {
    if (locked) {
      try { await execute(connection, '/* spec014:authority:lock:release */ SELECT RELEASE_LOCK(?) AS released', [LOCK_NAME]); } catch { /* Connection release also releases the lock. */ }
    }
    connection.release?.();
  }
}

async function withConnection(pool, work) {
  const connection = await pool.getConnection();
  try {
    return await work(connection);
  } catch (error) {
    throw normalizeDriverError(error);
  } finally {
    connection.release?.();
  }
}

async function loadCurrent(connection, authorityType, id, { forUpdate = false } = {}) {
  const table = authorityType === 'allowlist'
    ? 'storage_tenant_authority_allowlists'
    : 'storage_tenant_authority_approvals';
  const marker = authorityType === 'allowlist' ? 'load-allowlist' : 'load-approval';
  const [rows] = await execute(connection, `/* spec014:authority:${marker} */ SELECT record_digest, record_json, row_version FROM ${table} WHERE id=?${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
  const boundedRows = Array.isArray(rows) ? rows : [];
  if (boundedRows.length > 1) {
    throw fail(409, 'STORAGE_DURABLE_AUTHORITY_ROW_AMBIGUOUS', 'Authority identity resolved to multiple durable rows.', { authority_type: authorityType, authority_id: id });
  }
  if (boundedRows.length === 0) return null;
  const [row] = boundedRows;
  return { record: parseRecord(row, table), row_version: Number(row.row_version) };
}

async function loadToken(connection, authorityType, authorityId, tokenKind, tokenValue) {
  const [rows] = await execute(connection, '/* spec014:authority:load-token */ SELECT id, record_digest FROM storage_tenant_authority_token_history WHERE authority_type=? AND authority_id=? AND token_kind=? AND token_value=? FOR UPDATE', [authorityType, authorityId, tokenKind, tokenValue]);
  return rows?.[0] || null;
}

async function insertToken(connection, authorityType, authorityId, tokenKind, tokenValue, recordDigest) {
  return execute(connection, '/* spec014:authority:insert-token */ INSERT INTO storage_tenant_authority_token_history (id, authority_type, authority_id, token_kind, token_value, record_digest) VALUES (?, ?, ?, ?, ?, ?)', [
    historyId(authorityType, authorityId, tokenKind, tokenValue), authorityType, authorityId, tokenKind, tokenValue, recordDigest,
  ]);
}

async function insertAllowlist(connection, record) {
  return execute(connection, `/* spec014:authority:insert-allowlist */ INSERT INTO storage_tenant_authority_allowlists (
    id, revision, status, environment, target_scope, tenant_id, workspace_id, resource_id, target_id,
    root_ref, path_ref_prefix, shared_target, platform_target, valid_from_epoch, expires_at_epoch,
    max_items, max_bytes, evidence_digest, record_digest, record_json, row_version, secrets_included
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), 1, 0)`, [
    record.allowlist_id, record.revision, record.status, record.environment, record.target_scope,
    record.tenant_id, record.workspace_id, record.resource_id, record.target_id,
    record.root_ref, record.path_ref_prefix, record.valid_from_epoch, record.expires_at_epoch,
    record.max_items, record.max_bytes, record.evidence_digest, record.record_digest, JSON.stringify(record),
  ]);
}

async function updateAllowlist(connection, record, expectedRevision, expectedVersion) {
  const [result] = await execute(connection, `/* spec014:authority:update-allowlist */ UPDATE storage_tenant_authority_allowlists SET
    revision=?, status=?, environment=?, target_scope=?, tenant_id=?, workspace_id=?, resource_id=?, target_id=?,
    root_ref=?, path_ref_prefix=?, shared_target=0, platform_target=0, valid_from_epoch=?, expires_at_epoch=?,
    max_items=?, max_bytes=?, evidence_digest=?, record_digest=?, record_json=CAST(? AS JSON), row_version=row_version+1
    WHERE id=? AND revision=? AND row_version=?`, [
    record.revision, record.status, record.environment, record.target_scope, record.tenant_id, record.workspace_id,
    record.resource_id, record.target_id, record.root_ref, record.path_ref_prefix, record.valid_from_epoch,
    record.expires_at_epoch, record.max_items, record.max_bytes, record.evidence_digest, record.record_digest,
    JSON.stringify(record), record.allowlist_id, expectedRevision, expectedVersion,
  ]);
  if (Number(result?.affectedRows) !== 1) {
    throw fail(409, 'STORAGE_DURABLE_AUTHORITY_ALLOWLIST_CAS_CONFLICT', 'Allowlist revision or row version changed concurrently.', { allowlist_id: record.allowlist_id });
  }
}

async function insertApproval(connection, record) {
  return execute(connection, `/* spec014:authority:insert-approval */ INSERT INTO storage_tenant_authority_approvals (
    id, approval_slot, status, tenant_id, workspace_id, operation_id, target_id, plan_hash,
    authority_context_hash, approver_role, approved_at_epoch, expires_at_epoch, evidence_digest,
    record_digest, record_json, row_version, secrets_included
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), 1, 0)`, [
    record.approval_id, record.slot, record.status, record.tenant_id, record.workspace_id,
    record.operation_id, record.target_id, record.plan_hash, record.authority_context_hash,
    record.approver_role, record.approved_at_epoch, record.expires_at_epoch,
    record.evidence_digest, record.record_digest, JSON.stringify(record),
  ]);
}

async function updateApproval(connection, record, expectedEvidenceDigest, expectedVersion) {
  const [result] = await execute(connection, `/* spec014:authority:update-approval */ UPDATE storage_tenant_authority_approvals SET
    approval_slot=?, status=?, tenant_id=?, workspace_id=?, operation_id=?, target_id=?, plan_hash=?,
    authority_context_hash=?, approver_role=?, approved_at_epoch=?, expires_at_epoch=?, evidence_digest=?,
    record_digest=?, record_json=CAST(? AS JSON), row_version=row_version+1
    WHERE id=? AND evidence_digest=? AND row_version=?`, [
    record.slot, record.status, record.tenant_id, record.workspace_id, record.operation_id, record.target_id,
    record.plan_hash, record.authority_context_hash, record.approver_role, record.approved_at_epoch,
    record.expires_at_epoch, record.evidence_digest, record.record_digest, JSON.stringify(record),
    record.approval_id, expectedEvidenceDigest, expectedVersion,
  ]);
  if (Number(result?.affectedRows) !== 1) {
    throw fail(409, 'STORAGE_DURABLE_AUTHORITY_APPROVAL_CAS_CONFLICT', 'Approval evidence or row version changed concurrently.', { approval_id: record.approval_id });
  }
}

export function createHostingerStorageDurableTenantAuthorityStore(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw fail(500, 'STORAGE_DURABLE_AUTHORITY_OPTIONS_INVALID', 'Authority-store options must be an object.');
  }
  const unsupported = Object.keys(options).filter((key) => !ALLOWED_OPTIONS.has(key));
  if (unsupported.length) {
    throw fail(409, 'STORAGE_DURABLE_AUTHORITY_OVERRIDE_FORBIDDEN', 'Only pool, signed schema verification, and bounded lock timeout may be supplied.', { unsupported_options: unsupported.sort() });
  }
  const { pool, schema_verification, lock_timeout_seconds = 5 } = options;
  if (!pool || typeof pool.getConnection !== 'function') {
    throw fail(500, 'STORAGE_DURABLE_AUTHORITY_POOL_INVALID', 'A MySQL-compatible pool is required.');
  }
  const timeout = integer(lock_timeout_seconds, 'lock_timeout_seconds', 1);
  if (timeout > 30) throw fail(500, 'STORAGE_DURABLE_AUTHORITY_LOCK_TIMEOUT_INVALID', 'Lock timeout must not exceed 30 seconds.');
  const verification = assertSchemaVerification(schema_verification);

  async function registerAuthority(authorityType, input) {
    const record = authorityType === 'allowlist' ? normalizeAllowlist(input) : normalizeApproval(input);
    const id = authorityType === 'allowlist' ? record.allowlist_id : record.approval_id;
    const tokenKind = authorityType === 'allowlist' ? 'revision' : 'evidence_digest';
    const tokenValue = authorityType === 'allowlist' ? record.revision : record.evidence_digest;
    return transaction(pool, timeout, async (connection) => {
      const current = await loadCurrent(connection, authorityType, id, { forUpdate: true });
      if (current) {
        if (!same(current.record, record)) {
          throw fail(409, authorityType === 'allowlist' ? 'STORAGE_DURABLE_AUTHORITY_ALLOWLIST_ID_CONFLICT' : 'STORAGE_DURABLE_AUTHORITY_APPROVAL_ID_CONFLICT', 'Authority ID is already bound to different evidence.', { authority_type: authorityType, authority_id: id });
        }
        const token = await loadToken(connection, authorityType, id, tokenKind, tokenValue);
        if (!token || token.record_digest !== record.record_digest) {
          throw fail(409, 'STORAGE_DURABLE_AUTHORITY_TOKEN_HISTORY_MISSING', 'Existing authority row is missing its immutable token-history proof.', { authority_type: authorityType, authority_id: id });
        }
        return deepFreeze({ created: false, replay: true, [authorityType]: current.record, schema_verification_digest: verification.evidence_digest, secrets_included: false });
      }
      if (await loadToken(connection, authorityType, id, tokenKind, tokenValue)) {
        throw fail(409, 'STORAGE_DURABLE_AUTHORITY_TOKEN_REUSED', 'Authority token may never be reused.', { authority_type: authorityType, authority_id: id, token_kind: tokenKind });
      }
      if (authorityType === 'allowlist') await insertAllowlist(connection, record);
      else await insertApproval(connection, record);
      await insertToken(connection, authorityType, id, tokenKind, tokenValue, record.record_digest);
      const readback = await loadCurrent(connection, authorityType, id);
      if (!readback || !same(readback.record, record) || readback.row_version !== 1) {
        throw fail(409, 'STORAGE_DURABLE_AUTHORITY_READBACK_MISMATCH', 'Inserted authority row failed exact readback.', { authority_type: authorityType, authority_id: id });
      }
      return deepFreeze({ created: true, replay: false, [authorityType]: readback.record, schema_verification_digest: verification.evidence_digest, secrets_included: false });
    });
  }

  async function updateAuthority(authorityType, input = {}) {
    const copy = snapshot(input, `${authorityType}_update`);
    const idField = authorityType === 'allowlist' ? 'allowlist_id' : 'approval_id';
    const expectedField = authorityType === 'allowlist' ? 'expected_revision' : 'expected_evidence_digest';
    const id = identifier(copy[idField], idField, 36);
    const expectedToken = authorityType === 'allowlist'
      ? identifier(copy[expectedField], expectedField, 191)
      : hash(copy[expectedField], expectedField);
    const record = authorityType === 'allowlist'
      ? normalizeAllowlist({ ...copy.record, allowlist_id: id })
      : normalizeApproval({ ...copy.record, approval_id: id });
    const nextToken = authorityType === 'allowlist' ? record.revision : record.evidence_digest;
    const tokenKind = authorityType === 'allowlist' ? 'revision' : 'evidence_digest';
    if (nextToken === expectedToken) {
      throw fail(409, authorityType === 'allowlist' ? 'STORAGE_DURABLE_AUTHORITY_ALLOWLIST_TOKEN_NOT_ADVANCED' : 'STORAGE_DURABLE_AUTHORITY_APPROVAL_TOKEN_NOT_ADVANCED', 'Authority update must advance its immutable token.');
    }
    return transaction(pool, timeout, async (connection) => {
      const current = await loadCurrent(connection, authorityType, id, { forUpdate: true });
      if (!current) throw fail(404, 'STORAGE_DURABLE_AUTHORITY_NOT_FOUND', 'Durable authority record was not found.', { authority_type: authorityType, authority_id: id });
      const currentToken = authorityType === 'allowlist' ? current.record.revision : current.record.evidence_digest;
      if (currentToken !== expectedToken) {
        throw fail(409, authorityType === 'allowlist' ? 'STORAGE_DURABLE_AUTHORITY_ALLOWLIST_TOKEN_CONFLICT' : 'STORAGE_DURABLE_AUTHORITY_APPROVAL_TOKEN_CONFLICT', 'Authority token changed before update.', { authority_type: authorityType, authority_id: id, current_token: currentToken });
      }
      if (await loadToken(connection, authorityType, id, tokenKind, nextToken)) {
        throw fail(409, 'STORAGE_DURABLE_AUTHORITY_TOKEN_REUSED', 'Authority tokens are immutable and may never be reused.', { authority_type: authorityType, authority_id: id, token_kind: tokenKind, rejected_token: nextToken });
      }
      if (authorityType === 'allowlist') await updateAllowlist(connection, record, expectedToken, current.row_version);
      else await updateApproval(connection, record, expectedToken, current.row_version);
      await insertToken(connection, authorityType, id, tokenKind, nextToken, record.record_digest);
      const readback = await loadCurrent(connection, authorityType, id);
      if (!readback || !same(readback.record, record) || readback.row_version !== current.row_version + 1) {
        throw fail(409, 'STORAGE_DURABLE_AUTHORITY_READBACK_MISMATCH', 'Updated authority row failed exact readback.', { authority_type: authorityType, authority_id: id });
      }
      return deepFreeze({ updated: true, [authorityType]: readback.record, previous_token: expectedToken, current_token: nextToken, row_version: readback.row_version, schema_verification_digest: verification.evidence_digest, secrets_included: false });
    });
  }

  async function readAuthority(authorityType, rawId) {
    const id = identifier(rawId, `${authorityType}_id`, 36);
    return withConnection(pool, async (connection) => {
      const current = await loadCurrent(connection, authorityType, id);
      return current ? deepFreeze(clone(current.record)) : null;
    });
  }

  async function exportState() {
    return withConnection(pool, async (connection) => {
      const [allowlistRows] = await execute(connection, '/* spec014:authority:export-allowlists */ SELECT record_digest, record_json, row_version FROM storage_tenant_authority_allowlists ORDER BY id');
      const [approvalRows] = await execute(connection, '/* spec014:authority:export-approvals */ SELECT record_digest, record_json, row_version FROM storage_tenant_authority_approvals ORDER BY id');
      const state = {
        schema_version: 1,
        snapshot_key: 'hostinger_storage_durable_tenant_authority_snapshot_v1',
        allowlists: (allowlistRows || []).map((row) => parseRecord(row, 'storage_tenant_authority_allowlists')),
        approvals: (approvalRows || []).map((row) => parseRecord(row, 'storage_tenant_authority_approvals')),
        schema_contract_digest: verification.schema_contract_digest,
        database_fingerprint: verification.database_fingerprint,
        production_ready: false,
        runtime_mounted: false,
        secrets_included: false,
      };
      return deepFreeze({ ...state, snapshot_digest: digest(state) });
    });
  }

  const store = {
    adapter_key: 'hostinger_storage_mysql_tenant_authority_v1',
    store_version: HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_STORE_VERSION,
    durable_sql: true,
    async_only: true,
    tenant_exclusive: true,
    schema_verified: true,
    schema_verification_digest: verification.evidence_digest,
    schema_contract_digest: verification.schema_contract_digest,
    database_fingerprint: verification.database_fingerprint,
    legacy_tenant_canary_compatible: false,
    runtime_mounted: false,
    route_mounted: false,
    worker_mounted: false,
    provider_dispatch_allowed: false,
    migration_apply_authorized: false,
    production_ready: false,
    registerAllowlist: (record) => registerAuthority('allowlist', record),
    updateAllowlist: (input) => updateAuthority('allowlist', input),
    readAllowlist: (id) => readAuthority('allowlist', id),
    registerApproval: (record) => registerAuthority('approval', record),
    updateApproval: (input) => updateAuthority('approval', input),
    readApproval: (id) => readAuthority('approval', id),
    exportState,
    secrets_included: false,
  };
  Object.defineProperty(store, BRAND, { value: true, enumerable: false });
  return Object.freeze(store);
}

export function isCanonicalHostingerStorageDurableTenantAuthorityStore(value) {
  return Boolean(value?.[BRAND] === true
    && value?.adapter_key === 'hostinger_storage_mysql_tenant_authority_v1'
    && value?.store_version === HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_STORE_VERSION
    && value?.durable_sql === true
    && value?.async_only === true
    && value?.tenant_exclusive === true
    && value?.schema_verified === true
    && value?.legacy_tenant_canary_compatible === false
    && value?.runtime_mounted === false
    && value?.route_mounted === false
    && value?.worker_mounted === false
    && value?.provider_dispatch_allowed === false
    && value?.production_ready === false
    && Object.isFrozen(value));
}
