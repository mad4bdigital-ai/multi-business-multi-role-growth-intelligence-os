import { createHash } from 'node:crypto';

export const HOSTINGER_STORAGE_SYNTHETIC_ADAPTER_VERSION = 'spec014-hostinger-storage-synthetic-adapter-v1';

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function safeId(value, field) {
  const normalized = text(value, 256);
  if (!SAFE_ID_RE.test(normalized)) throw fail(400, 'STORAGE_SYNTHETIC_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  return normalized;
}

function hash(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) throw fail(400, 'STORAGE_SYNTHETIC_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  return normalized;
}

function integer(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw fail(400, 'STORAGE_SYNTHETIC_INTEGER_INVALID', 'A non-negative safe integer is required.', { field });
  return normalized;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function assertOpaquePathRef(value, field) {
  const ref = safeId(value, field);
  if (ref.startsWith('/') || ref.includes('..') || ref.includes('\\')) {
    throw fail(400, 'STORAGE_SYNTHETIC_PATH_REF_INVALID', 'Synthetic adapter accepts opaque path references only.', { field });
  }
  return ref;
}

function normalizeMetadata(input = {}, at = 'metadata') {
  return deepFreeze({
    size_bytes: integer(input.size_bytes, `${at}.size_bytes`),
    device: integer(input.device, `${at}.device`),
    inode: integer(input.inode, `${at}.inode`),
    ctime_epoch: integer(input.ctime_epoch, `${at}.ctime_epoch`),
    mtime_epoch: integer(input.mtime_epoch, `${at}.mtime_epoch`),
    file_type: text(input.file_type, 32) || 'regular',
  });
}

function metadataMatches(left, right) {
  return ['size_bytes', 'device', 'inode', 'ctime_epoch', 'mtime_epoch', 'file_type']
    .every((field) => left?.[field] === right?.[field]);
}

function normalizeInitialItem(item, index) {
  const normalized = {
    item_id: safeId(item.item_id, `items[${index}].item_id`),
    path_ref: assertOpaquePathRef(item.path_ref, `items[${index}].path_ref`),
    item_hash: hash(item.item_hash, `items[${index}].item_hash`),
    metadata: normalizeMetadata(item.metadata || item.expected, `items[${index}].metadata`),
    exists: item.exists !== false,
    protected: item.protected === true,
    secrets_included: false,
  };
  if (normalized.protected) throw fail(409, 'STORAGE_SYNTHETIC_PROTECTED_ITEM_FORBIDDEN', 'Protected item cannot enter the synthetic adapter.');
  normalized.state_digest = digest(normalized);
  return deepFreeze(normalized);
}

export function createHostingerStorageSyntheticAdapter({ items = [] } = {}) {
  const state = new Map();
  const receipts = new Map();
  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    const normalized = normalizeInitialItem(item, index);
    if (state.has(normalized.item_id)) throw fail(409, 'STORAGE_SYNTHETIC_ITEM_DUPLICATE', 'Duplicate synthetic item ID.', { item_id: normalized.item_id });
    state.set(normalized.item_id, clone(normalized));
  }

  function readbackItem({ item_id, expected_item_hash, expected } = {}) {
    const itemId = safeId(item_id, 'item_id');
    const expectedHash = hash(expected_item_hash, 'expected_item_hash');
    const row = state.get(itemId);
    const expectedMetadata = expected ? normalizeMetadata(expected, 'expected') : null;
    const observed = row ? clone(row) : null;
    const evidence = {
      item_id: itemId,
      exists: observed?.exists === true,
      item_hash_matches: observed ? observed.item_hash === expectedHash : false,
      metadata_matches: observed && expectedMetadata ? metadataMatches(observed.metadata, expectedMetadata) : false,
      observed_state_digest: observed?.state_digest || null,
      secrets_included: false,
    };
    evidence.matches_plan = evidence.exists && evidence.item_hash_matches && evidence.metadata_matches;
    evidence.evidence_digest = digest(evidence);
    return deepFreeze(evidence);
  }

  function mutateExact({ operation_id, run_id, item } = {}) {
    const operationId = safeId(operation_id, 'operation_id');
    const runId = safeId(run_id, 'run_id');
    const itemId = safeId(item?.item_id, 'item.item_id');
    const itemHash = hash(item?.item_hash, 'item.item_hash');
    const pathRef = assertOpaquePathRef(item?.path_ref, 'item.path_ref');
    const expected = normalizeMetadata(item?.expected, 'item.expected');
    const receiptKey = `${operationId}:${runId}:${itemId}`;
    if (receipts.has(receiptKey)) return deepFreeze(clone(receipts.get(receiptKey)));
    const row = state.get(itemId);
    let outcome = 'skipped_missing';
    if (row?.exists === true) {
      if (row.path_ref !== pathRef || row.item_hash !== itemHash || !metadataMatches(row.metadata, expected)) {
        outcome = 'skipped_changed';
      } else {
        row.exists = false;
        row.deleted_by_operation_id = operationId;
        row.deleted_by_run_id = runId;
        row.state_digest = digest(row);
        state.set(itemId, row);
        outcome = 'deleted';
      }
    }
    const receipt = {
      receipt_key: receiptKey,
      operation_id: operationId,
      run_id: runId,
      item_id: itemId,
      item_hash: itemHash,
      outcome,
      synthetic_only: true,
      live_provider_mutated: false,
      secrets_included: false,
    };
    receipt.receipt_digest = digest(receipt);
    receipts.set(receiptKey, receipt);
    return deepFreeze(clone(receipt));
  }

  return Object.freeze({
    adapter_key: 'hostinger_storage_synthetic_memory_adapter_v1',
    adapter_version: HOSTINGER_STORAGE_SYNTHETIC_ADAPTER_VERSION,
    synthetic_only: true,
    production_ready: false,
    live_provider: false,
    filesystem_access: false,
    shell_access: false,
    mutateExact,
    readbackItem,
    readMutationReceipt({ operation_id, run_id, item_id } = {}) {
      const key = `${safeId(operation_id, 'operation_id')}:${safeId(run_id, 'run_id')}:${safeId(item_id, 'item_id')}`;
      return receipts.has(key) ? deepFreeze(clone(receipts.get(key))) : null;
    },
    replaceItemMetadata({ item_id, metadata } = {}) {
      const itemId = safeId(item_id, 'item_id');
      const row = state.get(itemId);
      if (!row) throw fail(404, 'STORAGE_SYNTHETIC_ITEM_NOT_FOUND', 'Synthetic item not found.', { item_id: itemId });
      row.metadata = clone(normalizeMetadata(metadata, 'metadata'));
      row.state_digest = digest(row);
      state.set(itemId, row);
      return deepFreeze(clone(row));
    },
    exportState() {
      const rows = [...state.values()].map(clone).sort((left, right) => left.item_id.localeCompare(right.item_id));
      const receiptRows = [...receipts.values()].map(clone).sort((left, right) => left.receipt_key.localeCompare(right.receipt_key));
      const snapshot = {
        schema_version: 1,
        snapshot_key: 'hostinger_storage_synthetic_adapter_snapshot_v1',
        items: rows,
        receipts: receiptRows,
        production_ready: false,
        secrets_included: false,
      };
      return deepFreeze({ ...snapshot, snapshot_digest: digest(snapshot) });
    },
  });
}
