import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { canonicalizeOperationValue, stableOperationHash } from "./operationRegistryContracts.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,190}$/;
const REVISION_TYPES = new Set(["contract", "step", "binding", "policy", "schema"]);
const TYPE_ORDER = Object.freeze({ contract: 1, step: 2, binding: 3, policy: 4, schema: 5 });
const FORBIDDEN_EXACT_KEYS = new Set([
  "credential_payload",
  "credential_value",
  "provider_url",
  "endpoint_url",
  "base_url",
  "resource_ref",
  "scope_ref",
  "request_headers",
  "auth_header",
  "raw_secret"
]);
const SECRET_KEY_PATTERN = /(?:password|passphrase|access[_-]?token|refresh[_-]?token|private[_-]?key|authorization|cookie|secret_value)/i;

export class OperationRunRevisionRepositoryError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "OperationRunRevisionRepositoryError";
    this.code = code;
    this.status = status;
    this.details = { ...details, secrets_included: false };
  }
}

function fail(code, message, status = 400, details = {}) {
  throw new OperationRunRevisionRepositoryError(code, message, status, details);
}

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredObject(value, field) {
  if (!isObject(value)) fail("operation_run_revision_invalid_object", `${field} must be an object.`, 400, { field });
  return value;
}

function requiredString(value, field, { max = 191, pattern = null } = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || (pattern && !pattern.test(normalized))) {
    fail("operation_run_revision_invalid_string", `${field} is invalid.`, 400, { field });
  }
  return normalized;
}

function requiredHash(value, field) {
  const normalized = requiredString(value, field, { max: 64 }).toLowerCase();
  if (!HASH_PATTERN.test(normalized)) fail("operation_run_revision_invalid_hash", `${field} must be a SHA-256 hash.`, 400, { field });
  return normalized;
}

function requiredUuid(value, field) {
  const normalized = requiredString(value, field, { max: 36 }).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) fail("operation_run_revision_invalid_uuid", `${field} must be a UUID.`, 400, { field });
  return normalized;
}

function validateSafeSnapshot(value, field = "snapshot", depth = 0) {
  if (depth > 30) fail("operation_run_revision_snapshot_depth_exceeded", `${field} exceeds the maximum depth.`, 400, { field });
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) validateSafeSnapshot(value[index], `${field}[${index}]`, depth + 1);
    return;
  }
  if (!isObject(value)) fail("operation_run_revision_snapshot_not_json", `${field} must be JSON-safe.`, 400, { field });
  for (const [key, child] of Object.entries(value)) {
    const childField = `${field}.${key}`;
    if (key === "secrets_included" || key === "credential_payloads_read") {
      if (child !== false) fail("operation_run_revision_safety_marker_invalid", `${childField} must be false.`, 400, { field: childField });
      continue;
    }
    if (FORBIDDEN_EXACT_KEYS.has(key) || SECRET_KEY_PATTERN.test(key)) {
      fail("operation_run_revision_sensitive_field_forbidden", `${childField} is not allowed in revision snapshots.`, 400, { field: childField });
    }
    validateSafeSnapshot(child, childField, depth + 1);
  }
}

function normalizeRevisionItem(item, index) {
  const root = requiredObject(item, `input.revisions[${index}]`);
  const allowed = new Set(["revision_type", "revision_key", "revision_order", "revision_hash", "snapshot"]);
  for (const key of Object.keys(root)) {
    if (!allowed.has(key)) fail("operation_run_revision_unknown_item_field", `input.revisions[${index}].${key} is not supported.`, 400, { field: `input.revisions[${index}].${key}` });
  }
  const revisionType = requiredString(root.revision_type, `input.revisions[${index}].revision_type`, { max: 32 }).toLowerCase();
  if (!REVISION_TYPES.has(revisionType)) fail("operation_run_revision_type_invalid", `input.revisions[${index}].revision_type is unsupported.`, 400, { revision_type: revisionType });
  const revisionKey = requiredString(root.revision_key, `input.revisions[${index}].revision_key`, { pattern: KEY_PATTERN }).toLowerCase();
  const revisionOrder = Number(root.revision_order ?? 0);
  if (!Number.isInteger(revisionOrder) || revisionOrder < 0 || revisionOrder > 100000) {
    fail("operation_run_revision_order_invalid", `input.revisions[${index}].revision_order is invalid.`, 400, { field: `input.revisions[${index}].revision_order` });
  }
  const snapshot = requiredObject(root.snapshot, `input.revisions[${index}].snapshot`);
  validateSafeSnapshot(snapshot, `input.revisions[${index}].snapshot`);
  const canonicalSnapshot = canonicalizeOperationValue(snapshot);
  const revisionHash = requiredHash(root.revision_hash, `input.revisions[${index}].revision_hash`);
  const observedHash = stableOperationHash(canonicalSnapshot);
  if (observedHash !== revisionHash) {
    fail("operation_run_revision_hash_mismatch", "A revision snapshot does not match its declared hash.", 409, {
      revision_type: revisionType,
      revision_key: revisionKey,
      expected_revision_hash: revisionHash,
      observed_revision_hash: observedHash
    });
  }
  return {
    revision_type: revisionType,
    revision_key: revisionKey,
    revision_order: revisionOrder,
    revision_hash: revisionHash,
    snapshot: canonicalSnapshot,
    canonical_snapshot_json: JSON.stringify(canonicalSnapshot)
  };
}

function normalizeInput(input = {}) {
  const root = requiredObject(input, "input");
  const allowed = new Set([
    "run_id",
    "operation_key",
    "operation_version",
    "manifest_id",
    "manifest_hash",
    "source_revision_hash",
    "scope_fingerprint",
    "resource_fingerprint",
    "input_sha256",
    "idempotency_key_sha256",
    "requested_by",
    "revisions"
  ]);
  for (const key of Object.keys(root)) {
    if (!allowed.has(key)) fail("operation_run_revision_unknown_field", `input.${key} is not supported.`, 400, { field: `input.${key}` });
  }
  const operationVersion = Number(root.operation_version);
  if (!Number.isInteger(operationVersion) || operationVersion < 1) {
    fail("operation_run_revision_operation_version_invalid", "input.operation_version must be positive.", 400);
  }
  if (!Array.isArray(root.revisions) || root.revisions.length < 5 || root.revisions.length > 500) {
    fail("operation_run_revision_items_invalid", "input.revisions must contain 5-500 revision items.", 400);
  }
  const revisions = root.revisions.map(normalizeRevisionItem).sort((left, right) =>
    TYPE_ORDER[left.revision_type] - TYPE_ORDER[right.revision_type]
      || left.revision_order - right.revision_order
      || left.revision_key.localeCompare(right.revision_key)
  );
  const identities = new Set();
  const counts = Object.fromEntries([...REVISION_TYPES].map((type) => [type, 0]));
  for (const revision of revisions) {
    const identity = `${revision.revision_type}:${revision.revision_key}`;
    if (identities.has(identity)) fail("operation_run_revision_duplicate_item", "Revision identities must be unique per run.", 409, { revision_identity: identity });
    identities.add(identity);
    counts[revision.revision_type] += 1;
  }
  if (counts.contract !== 1 || counts.step < 1 || counts.binding < 1 || counts.policy < 1 || counts.schema < 1) {
    fail("operation_run_revision_required_types_missing", "The revision bundle must include one contract and at least one step, binding, policy, and schema revision.", 400, { counts });
  }

  const normalized = {
    run_id: requiredUuid(root.run_id, "input.run_id"),
    operation_key: requiredString(root.operation_key, "input.operation_key", { pattern: KEY_PATTERN }).toLowerCase(),
    operation_version: operationVersion,
    manifest_id: requiredUuid(root.manifest_id, "input.manifest_id"),
    manifest_hash: requiredHash(root.manifest_hash, "input.manifest_hash"),
    source_revision_hash: requiredHash(root.source_revision_hash, "input.source_revision_hash"),
    scope_fingerprint: requiredHash(root.scope_fingerprint, "input.scope_fingerprint"),
    resource_fingerprint: requiredHash(root.resource_fingerprint, "input.resource_fingerprint"),
    input_sha256: requiredHash(root.input_sha256, "input.input_sha256"),
    idempotency_key_sha256: requiredHash(root.idempotency_key_sha256, "input.idempotency_key_sha256"),
    requested_by: requiredString(root.requested_by, "input.requested_by"),
    revisions
  };
  normalized.revision_bundle_hash = stableOperationHash({
    schema_version: "operation-run-revision-bundle-v1",
    run_id: normalized.run_id,
    operation_key: normalized.operation_key,
    operation_version: normalized.operation_version,
    manifest_id: normalized.manifest_id,
    manifest_hash: normalized.manifest_hash,
    source_revision_hash: normalized.source_revision_hash,
    scope_fingerprint: normalized.scope_fingerprint,
    resource_fingerprint: normalized.resource_fingerprint,
    input_sha256: normalized.input_sha256,
    idempotency_key_sha256: normalized.idempotency_key_sha256,
    revisions: revisions.map(({ revision_type, revision_key, revision_order, revision_hash }) => ({
      revision_type,
      revision_key,
      revision_order,
      revision_hash
    }))
  });
  return normalized;
}

function parseJson(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    fail("operation_run_revision_persisted_json_invalid", `${field} contains invalid JSON.`, 500, { field });
  }
}

async function readPin(connection, runId) {
  const [pinRows] = await connection.query(
    `SELECT p.pin_id,p.run_id,p.operation_registry_id,o.operation_id,p.manifest_id,p.operation_key,p.operation_version,
            p.scope_fingerprint,p.manifest_hash,p.source_revision_hash,p.resource_fingerprint,p.input_sha256,
            p.idempotency_key_sha256,p.requested_by,p.revision_bundle_hash,p.created_at
       FROM operation_run_revision_pins p
       JOIN operation_registry o ON o.id=p.operation_registry_id
      WHERE p.run_id=?
      LIMIT 1`,
    [runId]
  );
  const pin = pinRows?.[0];
  if (!pin) return null;
  const [itemRows] = await connection.query(
    `SELECT revision_type,revision_key,revision_order,revision_hash,snapshot_json,created_at
       FROM operation_run_revision_items
      WHERE run_id=?
      ORDER BY FIELD(revision_type,'contract','step','binding','policy','schema'),revision_order,revision_key`,
    [runId]
  );
  return {
    pin_id: pin.pin_id,
    run_id: pin.run_id,
    operation_registry_id: Number(pin.operation_registry_id),
    operation_id: pin.operation_id,
    manifest_id: pin.manifest_id,
    operation_key: pin.operation_key,
    operation_version: Number(pin.operation_version),
    scope_fingerprint: pin.scope_fingerprint,
    manifest_hash: pin.manifest_hash,
    source_revision_hash: pin.source_revision_hash,
    resource_fingerprint: pin.resource_fingerprint,
    input_sha256: pin.input_sha256,
    idempotency_key_sha256: pin.idempotency_key_sha256,
    requested_by: pin.requested_by,
    revision_bundle_hash: pin.revision_bundle_hash,
    created_at: pin.created_at,
    revisions: (itemRows || []).map((row) => ({
      revision_type: row.revision_type,
      revision_key: row.revision_key,
      revision_order: Number(row.revision_order),
      revision_hash: row.revision_hash,
      snapshot: parseJson(row.snapshot_json, "snapshot_json"),
      created_at: row.created_at
    }))
  };
}

function verifyReadback(record, normalized) {
  if (!record) fail("operation_run_revision_readback_missing", "Run revision pin persistence completed without readback.", 500);
  for (const field of [
    "run_id",
    "manifest_id",
    "operation_key",
    "scope_fingerprint",
    "manifest_hash",
    "source_revision_hash",
    "resource_fingerprint",
    "input_sha256",
    "idempotency_key_sha256",
    "revision_bundle_hash"
  ]) {
    if (record[field] !== normalized[field]) fail("operation_run_revision_readback_mismatch", `Run revision readback mismatched ${field}.`, 500, { field });
  }
  if (record.operation_version !== normalized.operation_version || record.revisions.length !== normalized.revisions.length) {
    fail("operation_run_revision_readback_count_mismatch", "Run revision readback item count or operation version mismatched.", 500);
  }
  for (let index = 0; index < normalized.revisions.length; index += 1) {
    const expected = normalized.revisions[index];
    const observed = record.revisions[index];
    if (!observed
      || observed.revision_type !== expected.revision_type
      || observed.revision_key !== expected.revision_key
      || observed.revision_order !== expected.revision_order
      || observed.revision_hash !== expected.revision_hash
      || JSON.stringify(canonicalizeOperationValue(observed.snapshot)) !== expected.canonical_snapshot_json) {
      fail("operation_run_revision_item_readback_mismatch", "A persisted revision item failed same-cycle readback.", 500, { index });
    }
  }
}

function dependencies(overrides = {}) {
  return { pool: overrides.pool || getPool(), uuid: overrides.uuid || randomUUID };
}

export async function persistOperationRunRevisionPin(input, dependencyOverrides = {}) {
  const normalized = normalizeInput(input);
  const resolved = dependencies(dependencyOverrides);
  const connection = await resolved.pool.getConnection();
  try {
    await connection.beginTransaction();
    const [ownershipRows] = await connection.query(
      `SELECT run_id,operation_key
         FROM operation_run_ownership
        WHERE run_id=?
        LIMIT 1 FOR UPDATE`,
      [normalized.run_id]
    );
    const ownership = ownershipRows?.[0];
    if (!ownership) fail("operation_run_revision_run_not_found", "The governed operation run ownership record does not exist.", 404, { run_id: normalized.run_id });
    if (ownership.operation_key && ownership.operation_key !== normalized.operation_key) {
      fail("operation_run_revision_ownership_mismatch", "The run ownership operation key does not match the requested pin.", 409);
    }

    const [operationRows] = await connection.query(
      `SELECT id,operation_id,operation_key,version,revision_hash,status
         FROM operation_registry
        WHERE operation_key=? AND version=?
        LIMIT 1 FOR UPDATE`,
      [normalized.operation_key, normalized.operation_version]
    );
    const operation = operationRows?.[0];
    if (!operation) fail("operation_run_revision_operation_not_found", "The operation version does not exist.", 404);
    if (["degraded", "disabled", "archived"].includes(String(operation.status))) {
      fail("operation_run_revision_operation_lifecycle_blocked", "The operation lifecycle does not permit run pinning.", 409, { status: operation.status });
    }
    const contractRevision = normalized.revisions.find((item) => item.revision_type === "contract");
    if (contractRevision.revision_hash !== operation.revision_hash) {
      fail("operation_run_revision_contract_revision_conflict", "The contract revision changed before run pinning.", 409, {
        expected_revision_hash: contractRevision.revision_hash,
        current_revision_hash: operation.revision_hash
      });
    }

    const [manifestRows] = await connection.query(
      `SELECT m.manifest_id,m.operation_registry_id,m.manifest_hash,m.source_revision_hash,m.scope_fingerprint,
              m.validation_status,m.rollout_mode,m.certification_status,m.expires_at,m.revoked_at,
              CASE WHEN p.manifest_id=m.manifest_id THEN 1 ELSE 0 END AS is_current
         FROM operation_compiled_manifests m
         LEFT JOIN operation_compiled_manifest_current p
           ON p.operation_registry_id=m.operation_registry_id AND p.scope_fingerprint=m.scope_fingerprint
        WHERE m.manifest_id=?
        LIMIT 1 FOR UPDATE`,
      [normalized.manifest_id]
    );
    const manifest = manifestRows?.[0];
    if (!manifest) fail("operation_run_revision_manifest_not_found", "The compiled manifest does not exist.", 404);
    if (Number(manifest.operation_registry_id) !== Number(operation.id)
      || manifest.manifest_hash !== normalized.manifest_hash
      || manifest.source_revision_hash !== normalized.source_revision_hash
      || manifest.scope_fingerprint !== normalized.scope_fingerprint) {
      fail("operation_run_revision_manifest_identity_conflict", "The compiled manifest identity or hashes do not match the run pin.", 409);
    }
    if (!manifest.is_current
      || manifest.validation_status !== "valid"
      || manifest.certification_status !== "certified"
      || manifest.rollout_mode === "disabled"
      || manifest.revoked_at
      || (manifest.expires_at && Date.parse(manifest.expires_at) <= Date.now())) {
      fail("operation_run_revision_manifest_lifecycle_blocked", "The compiled manifest is not eligible for run pinning.", 409, {
        validation_status: manifest.validation_status,
        rollout_mode: manifest.rollout_mode,
        certification_status: manifest.certification_status,
        is_current: Boolean(manifest.is_current)
      });
    }

    const [existingRows] = await connection.query(
      `SELECT pin_id,revision_bundle_hash
         FROM operation_run_revision_pins
        WHERE run_id=?
        LIMIT 1 FOR UPDATE`,
      [normalized.run_id]
    );
    const existing = existingRows?.[0];
    if (existing) {
      if (existing.revision_bundle_hash !== normalized.revision_bundle_hash) {
        fail("operation_run_revision_immutable_conflict", "The run is already pinned to a different revision bundle.", 409, {
          existing_revision_bundle_hash: existing.revision_bundle_hash,
          requested_revision_bundle_hash: normalized.revision_bundle_hash
        });
      }
      const readback = await readPin(connection, normalized.run_id);
      verifyReadback(readback, normalized);
      await connection.commit();
      return {
        ok: true,
        report_type: "operation_run_revision_pin_persist",
        inserted: false,
        idempotent_replay: true,
        readback_complete: true,
        record: readback,
        database_writes_performed: false,
        internal_persistence_only: true,
        provider_calls_performed: false,
        external_writes_performed: false,
        runtime_activation_changed: false,
        credential_payloads_read: false,
        secrets_included: false
      };
    }

    const pinId = resolved.uuid();
    await connection.query(
      `INSERT INTO operation_run_revision_pins
        (pin_id,run_id,operation_registry_id,manifest_id,operation_key,operation_version,scope_fingerprint,
         manifest_hash,source_revision_hash,resource_fingerprint,input_sha256,idempotency_key_sha256,
         requested_by,revision_bundle_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        pinId,
        normalized.run_id,
        operation.id,
        normalized.manifest_id,
        normalized.operation_key,
        normalized.operation_version,
        normalized.scope_fingerprint,
        normalized.manifest_hash,
        normalized.source_revision_hash,
        normalized.resource_fingerprint,
        normalized.input_sha256,
        normalized.idempotency_key_sha256,
        normalized.requested_by,
        normalized.revision_bundle_hash
      ]
    );
    for (const revision of normalized.revisions) {
      await connection.query(
        `INSERT INTO operation_run_revision_items
          (run_id,revision_type,revision_key,revision_order,revision_hash,snapshot_json)
         VALUES (?,?,?,?,?,?)`,
        [
          normalized.run_id,
          revision.revision_type,
          revision.revision_key,
          revision.revision_order,
          revision.revision_hash,
          revision.canonical_snapshot_json
        ]
      );
    }
    const readback = await readPin(connection, normalized.run_id);
    verifyReadback(readback, normalized);
    await connection.commit();
    return {
      ok: true,
      report_type: "operation_run_revision_pin_persist",
      inserted: true,
      idempotent_replay: false,
      readback_complete: true,
      record: readback,
      database_writes_performed: true,
      internal_persistence_only: true,
      provider_calls_performed: false,
      external_writes_performed: false,
      runtime_activation_changed: false,
      credential_payloads_read: false,
      secrets_included: false
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function getOperationRunRevisionPin(runId, dependencyOverrides = {}) {
  const normalizedRunId = requiredUuid(runId, "run_id");
  const resolved = dependencies(dependencyOverrides);
  const connection = await resolved.pool.getConnection();
  try {
    const record = await readPin(connection, normalizedRunId);
    if (!record) fail("operation_run_revision_pin_not_found", "No immutable revision pin exists for the run.", 404, { run_id: normalizedRunId });
    return {
      ok: true,
      report_type: "operation_run_revision_pin_get",
      record,
      read_only: true,
      credential_payloads_read: false,
      secrets_included: false
    };
  } finally {
    connection.release();
  }
}

export function createOperationRunRevisionRepository(dependencyOverrides = {}) {
  return Object.freeze({
    persist: (input) => persistOperationRunRevisionPin(input, dependencyOverrides),
    get: (runId) => getOperationRunRevisionPin(runId, dependencyOverrides)
  });
}
