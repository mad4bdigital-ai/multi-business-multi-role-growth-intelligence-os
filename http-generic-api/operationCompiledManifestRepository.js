import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { canonicalizeOperationValue, stableOperationHash } from "./operationRegistryContracts.js";

const VALIDATION_STATUSES = new Set(["valid", "invalid", "blocked", "superseded", "revoked"]);
const ROLLOUT_MODES = new Set(["disabled", "shadow", "canary", "active", "fallback"]);
const CERTIFICATION_STATUSES = new Set(["uncertified", "certified", "expired", "revoked"]);
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,190}$/;
const FORBIDDEN_EXACT_KEYS = new Set([
  "scope_ref",
  "resource_ref",
  "workspace_id",
  "tenant_id",
  "credential_ready",
  "credential_payload",
  "provider_url",
  "endpoint_url",
  "base_url",
  "request_headers",
  "auth_header"
]);
const SECRET_KEY_PATTERN = /(?:password|passphrase|access[_-]?token|refresh[_-]?token|private[_-]?key|secret_value|authorization|cookie)/i;

export class OperationCompiledManifestRepositoryError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "OperationCompiledManifestRepositoryError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(code, message, status = 400, details = {}) {
  throw new OperationCompiledManifestRepositoryError(code, message, status, details);
}

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredObject(value, field) {
  if (!isObject(value)) fail("operation_manifest_invalid_object", `${field} must be an object.`, 400, { field });
  return value;
}

function requiredString(value, field, { max = 191, pattern = null } = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || (pattern && !pattern.test(normalized))) {
    fail("operation_manifest_invalid_string", `${field} is invalid.`, 400, { field });
  }
  return normalized;
}

function requiredHash(value, field) {
  const normalized = requiredString(value, field, { max: 64 }).toLowerCase();
  if (!HASH_PATTERN.test(normalized)) fail("operation_manifest_invalid_hash", `${field} must be a SHA-256 hash.`, 400, { field });
  return normalized;
}

function optionalTimestamp(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) fail("operation_manifest_invalid_timestamp", `${field} is invalid.`, 400, { field });
  return new Date(timestamp).toISOString();
}

function enumValue(value, field, allowed, defaultValue) {
  const normalized = requiredString(value ?? defaultValue, field, { max: 32 }).toLowerCase();
  if (!allowed.has(normalized)) fail("operation_manifest_invalid_lifecycle", `${field} is unsupported.`, 400, { field, value: normalized });
  return normalized;
}

function validateSafeManifestValue(value, field = "manifest", depth = 0) {
  if (depth > 30) fail("operation_manifest_depth_exceeded", `${field} exceeds the maximum depth.`, 400, { field });
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) validateSafeManifestValue(value[index], `${field}[${index}]`, depth + 1);
    return;
  }
  if (!isObject(value)) fail("operation_manifest_non_json_value", `${field} is not JSON-safe.`, 400, { field });
  for (const [key, child] of Object.entries(value)) {
    const childField = `${field}.${key}`;
    if (key === "secrets_included" || key === "credential_payloads_read") {
      if (child !== false) fail("operation_manifest_safety_marker_invalid", `${childField} must be false.`, 400, { field: childField });
      continue;
    }
    if (FORBIDDEN_EXACT_KEYS.has(key) || SECRET_KEY_PATTERN.test(key)) {
      fail("operation_manifest_sensitive_field_forbidden", `${childField} is not allowed in persisted manifests.`, 400, { field: childField });
    }
    validateSafeManifestValue(child, childField, depth + 1);
  }
}

function normalizeManifestInput(input = {}) {
  const root = requiredObject(input, "input");
  const allowed = new Set([
    "manifest",
    "validation_status",
    "rollout_mode",
    "certification_status",
    "expires_at",
    "make_current",
    "created_by"
  ]);
  for (const key of Object.keys(root)) {
    if (!allowed.has(key)) fail("operation_manifest_unknown_field", `input.${key} is not supported.`, 400, { field: `input.${key}` });
  }
  const manifest = requiredObject(root.manifest, "input.manifest");
  validateSafeManifestValue(manifest);
  const operation = requiredObject(manifest.operation, "input.manifest.operation");
  const operationKey = requiredString(operation.operation_key, "input.manifest.operation.operation_key", { pattern: KEY_PATTERN });
  const operationVersion = Number(operation.version);
  if (!Number.isInteger(operationVersion) || operationVersion < 1) {
    fail("operation_manifest_operation_version_invalid", "input.manifest.operation.version must be positive.", 400);
  }
  const operationRevisionHash = requiredHash(operation.revision_hash, "input.manifest.operation.revision_hash");
  const scopeFingerprint = requiredHash(manifest.scope_fingerprint, "input.manifest.scope_fingerprint");
  const sourceRevisionHash = requiredHash(manifest.source_revision_hash, "input.manifest.source_revision_hash");
  const manifestHash = requiredHash(manifest.manifest_hash, "input.manifest.manifest_hash");
  const compilerVersion = requiredString(manifest.compiler_version, "input.manifest.compiler_version", { max: 64, pattern: KEY_PATTERN });
  optionalTimestamp(manifest.compiled_at, "input.manifest.compiled_at");
  const { manifest_hash: _manifestHash, ...manifestCore } = manifest;
  const observedManifestHash = stableOperationHash(manifestCore);
  if (observedManifestHash !== manifestHash) {
    fail("operation_manifest_hash_mismatch", "The manifest hash does not match its canonical content.", 409, {
      expected_manifest_hash: manifestHash,
      observed_manifest_hash: observedManifestHash
    });
  }
  if (root.make_current !== undefined && typeof root.make_current !== "boolean") {
    fail("operation_manifest_make_current_invalid", "input.make_current must be boolean.", 400);
  }
  return {
    manifest: canonicalizeOperationValue(manifest),
    canonical_manifest_json: JSON.stringify(canonicalizeOperationValue(manifest)),
    operation_key: operationKey,
    operation_version: operationVersion,
    operation_revision_hash: operationRevisionHash,
    scope_fingerprint: scopeFingerprint,
    source_revision_hash: sourceRevisionHash,
    manifest_hash: manifestHash,
    compiler_version: compilerVersion,
    validation_status: enumValue(root.validation_status, "input.validation_status", VALIDATION_STATUSES, "valid"),
    rollout_mode: enumValue(root.rollout_mode, "input.rollout_mode", ROLLOUT_MODES, "shadow"),
    certification_status: enumValue(root.certification_status, "input.certification_status", CERTIFICATION_STATUSES, "uncertified"),
    expires_at: optionalTimestamp(root.expires_at, "input.expires_at"),
    make_current: root.make_current === true,
    created_by: requiredString(root.created_by, "input.created_by")
  };
}

function parseJson(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    fail("operation_manifest_persisted_json_invalid", `${field} contains invalid JSON.`, 500, { field });
  }
}

async function readManifestById(connection, manifestId) {
  const [rows] = await connection.query(
    `SELECT m.id,m.manifest_id,m.operation_registry_id,o.operation_id,o.operation_key,o.version AS operation_version,
            m.manifest_version,m.scope_fingerprint,m.source_revision_hash,m.manifest_hash,m.compiler_version,
            m.validation_status,m.rollout_mode,m.certification_status,m.manifest_json,m.expires_at,m.revoked_at,
            m.created_by,m.created_at,p.pointer_revision,
            CASE WHEN p.manifest_id=m.manifest_id THEN 1 ELSE 0 END AS is_current
       FROM operation_compiled_manifests m
       JOIN operation_registry o ON o.id=m.operation_registry_id
       LEFT JOIN operation_compiled_manifest_current p
         ON p.operation_registry_id=m.operation_registry_id AND p.scope_fingerprint=m.scope_fingerprint
      WHERE m.manifest_id=?
      LIMIT 1`,
    [manifestId]
  );
  const row = rows?.[0];
  if (!row) return null;
  return {
    manifest_id: row.manifest_id,
    operation_registry_id: Number(row.operation_registry_id),
    operation_id: row.operation_id,
    operation_key: row.operation_key,
    operation_version: Number(row.operation_version),
    manifest_version: Number(row.manifest_version),
    scope_fingerprint: row.scope_fingerprint,
    source_revision_hash: row.source_revision_hash,
    manifest_hash: row.manifest_hash,
    compiler_version: row.compiler_version,
    validation_status: row.validation_status,
    rollout_mode: row.rollout_mode,
    certification_status: row.certification_status,
    manifest: parseJson(row.manifest_json, "manifest_json"),
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    created_by: row.created_by,
    created_at: row.created_at,
    pointer_revision: row.pointer_revision === null || row.pointer_revision === undefined ? null : Number(row.pointer_revision),
    is_current: Boolean(row.is_current)
  };
}

function verifyReadback(readback, normalized) {
  if (!readback) fail("operation_manifest_readback_missing", "Manifest persistence completed without readback.", 500);
  if (readback.manifest_hash !== normalized.manifest_hash || readback.source_revision_hash !== normalized.source_revision_hash) {
    fail("operation_manifest_readback_hash_mismatch", "Manifest readback hashes do not match the persisted input.", 500);
  }
  if (JSON.stringify(canonicalizeOperationValue(readback.manifest)) !== normalized.canonical_manifest_json) {
    fail("operation_manifest_readback_content_mismatch", "Manifest readback content does not match the persisted input.", 500);
  }
  if (normalized.make_current && !readback.is_current) {
    fail("operation_manifest_current_pointer_missing", "The requested current pointer was not observed during readback.", 500);
  }
}

function dependencies(input = {}) {
  return { pool: input.pool || getPool(), uuid: input.uuid || randomUUID };
}

export async function persistOperationCompiledManifest(input, dependencyOverrides = {}) {
  const normalized = normalizeManifestInput(input);
  const resolved = dependencies(dependencyOverrides);
  const connection = await resolved.pool.getConnection();
  try {
    await connection.beginTransaction();
    const [operationRows] = await connection.query(
      `SELECT id,operation_id,operation_key,version,revision_hash,status
         FROM operation_registry
        WHERE operation_key=? AND version=?
        LIMIT 1 FOR UPDATE`,
      [normalized.operation_key, normalized.operation_version]
    );
    const operation = operationRows?.[0];
    if (!operation) {
      fail("operation_manifest_operation_not_found", "The operation version does not exist.", 404, {
        operation_key: normalized.operation_key,
        operation_version: normalized.operation_version
      });
    }
    if (operation.revision_hash !== normalized.operation_revision_hash) {
      fail("operation_manifest_operation_revision_conflict", "The operation revision changed after compilation.", 409, {
        expected_revision_hash: normalized.operation_revision_hash,
        current_revision_hash: operation.revision_hash
      });
    }
    if (["degraded", "disabled", "archived"].includes(String(operation.status))) {
      fail("operation_manifest_operation_lifecycle_blocked", "The operation lifecycle does not permit manifest persistence.", 409, {
        status: operation.status
      });
    }

    const [existingRows] = await connection.query(
      `SELECT manifest_id,manifest_version,manifest_json,validation_status,rollout_mode,certification_status,expires_at
         FROM operation_compiled_manifests
        WHERE operation_registry_id=? AND scope_fingerprint=? AND manifest_hash=?
        LIMIT 1 FOR UPDATE`,
      [operation.id, normalized.scope_fingerprint, normalized.manifest_hash]
    );
    let manifestId;
    let manifestVersion;
    let inserted = false;
    const existing = existingRows?.[0];
    if (existing) {
      const existingCanonical = JSON.stringify(canonicalizeOperationValue(parseJson(existing.manifest_json, "existing.manifest_json")));
      if (existingCanonical !== normalized.canonical_manifest_json) {
        fail("operation_manifest_immutable_content_conflict", "An existing manifest hash maps to different content.", 409);
      }
      if (
        existing.validation_status !== normalized.validation_status ||
        existing.rollout_mode !== normalized.rollout_mode ||
        existing.certification_status !== normalized.certification_status
      ) {
        fail("operation_manifest_lifecycle_conflict", "Existing manifest lifecycle dimensions cannot be changed during idempotent persistence.", 409);
      }
      manifestId = existing.manifest_id;
      manifestVersion = Number(existing.manifest_version);
    } else {
      const [versionRows] = await connection.query(
        `SELECT COALESCE(MAX(manifest_version),0) AS max_manifest_version
           FROM operation_compiled_manifests
          WHERE operation_registry_id=? AND scope_fingerprint=?`,
        [operation.id, normalized.scope_fingerprint]
      );
      manifestVersion = Number(versionRows?.[0]?.max_manifest_version || 0) + 1;
      manifestId = resolved.uuid();
      await connection.query(
        `INSERT INTO operation_compiled_manifests
          (manifest_id,operation_registry_id,manifest_version,scope_fingerprint,source_revision_hash,manifest_hash,
           compiler_version,validation_status,rollout_mode,certification_status,manifest_json,expires_at,created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          manifestId,
          operation.id,
          manifestVersion,
          normalized.scope_fingerprint,
          normalized.source_revision_hash,
          normalized.manifest_hash,
          normalized.compiler_version,
          normalized.validation_status,
          normalized.rollout_mode,
          normalized.certification_status,
          normalized.canonical_manifest_json,
          normalized.expires_at,
          normalized.created_by
        ]
      );
      inserted = true;
    }

    let currentPointerChanged = false;
    if (normalized.make_current) {
      const [pointerRows] = await connection.query(
        `SELECT id,manifest_id,pointer_revision
           FROM operation_compiled_manifest_current
          WHERE operation_registry_id=? AND scope_fingerprint=?
          LIMIT 1 FOR UPDATE`,
        [operation.id, normalized.scope_fingerprint]
      );
      const pointer = pointerRows?.[0];
      if (!pointer) {
        await connection.query(
          `INSERT INTO operation_compiled_manifest_current
            (operation_registry_id,scope_fingerprint,manifest_id,pointer_revision,updated_by)
           VALUES (?,?,?,?,?)`,
          [operation.id, normalized.scope_fingerprint, manifestId, 1, normalized.created_by]
        );
        currentPointerChanged = true;
      } else if (pointer.manifest_id !== manifestId) {
        await connection.query(
          `UPDATE operation_compiled_manifest_current
              SET manifest_id=?,pointer_revision=?,updated_by=?
            WHERE id=?`,
          [manifestId, Number(pointer.pointer_revision) + 1, normalized.created_by, pointer.id]
        );
        currentPointerChanged = true;
      }
    }

    const readback = await readManifestById(connection, manifestId);
    verifyReadback(readback, normalized);
    await connection.commit();
    return {
      ok: true,
      report_type: "operation_compiled_manifest_persist",
      manifest_id: manifestId,
      manifest_version: manifestVersion,
      manifest_hash: normalized.manifest_hash,
      inserted,
      current_pointer_changed: currentPointerChanged,
      readback_complete: true,
      record: readback,
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

export async function getCurrentOperationCompiledManifest(operationKey, operationVersion, scopeFingerprint, dependencyOverrides = {}) {
  const normalizedKey = requiredString(operationKey, "operation_key", { pattern: KEY_PATTERN });
  const normalizedVersion = Number(operationVersion);
  if (!Number.isInteger(normalizedVersion) || normalizedVersion < 1) {
    fail("operation_manifest_operation_version_invalid", "operation_version must be positive.", 400);
  }
  const normalizedScope = requiredHash(scopeFingerprint, "scope_fingerprint");
  const resolved = dependencies(dependencyOverrides);
  const connection = await resolved.pool.getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT p.manifest_id
         FROM operation_compiled_manifest_current p
         JOIN operation_registry o ON o.id=p.operation_registry_id
        WHERE o.operation_key=? AND o.version=? AND p.scope_fingerprint=?
        LIMIT 1`,
      [normalizedKey, normalizedVersion, normalizedScope]
    );
    const manifestId = rows?.[0]?.manifest_id;
    if (!manifestId) {
      fail("operation_manifest_current_not_found", "No current compiled manifest exists for the requested operation and scope.", 404, {
        operation_key: normalizedKey,
        operation_version: normalizedVersion,
        scope_fingerprint: normalizedScope
      });
    }
    const record = await readManifestById(connection, manifestId);
    if (!record || !record.is_current) fail("operation_manifest_current_readback_invalid", "Current manifest pointer did not resolve to a current record.", 500);
    return {
      ok: true,
      report_type: "operation_compiled_manifest_current_get",
      record,
      read_only: true,
      credential_payloads_read: false,
      secrets_included: false
    };
  } finally {
    connection.release();
  }
}

export function createOperationCompiledManifestRepository(dependencyOverrides = {}) {
  return Object.freeze({
    persist: (input) => persistOperationCompiledManifest(input, dependencyOverrides),
    getCurrent: (operationKey, operationVersion, scopeFingerprint) =>
      getCurrentOperationCompiledManifest(operationKey, operationVersion, scopeFingerprint, dependencyOverrides)
  });
}
