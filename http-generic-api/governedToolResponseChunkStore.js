import crypto from "node:crypto";
import { getPool } from "./db.js";
import {
  canAccessGovernedResponseChunk,
  governedResponseChunkOwnerFields,
  resolveGovernedResponseChunkPrincipal,
} from "./governedToolResponseChunkOwnership.js";

export const GOVERNED_RESPONSE_CHUNK_CURSOR_POLICY = "utf16_code_unit_cursor_v1";
const GOVERNED_RESPONSE_CHUNK_TABLE = "governed_tool_response_chunks";
export const GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS = Object.freeze([
  "chunk_id", "source_tool_key", "response_sha256", "response_bytes", "response_json",
  "cursor_policy", "redaction_status", "secrets_included", "owner_tenant_id",
  "owner_user_id", "owner_workspace_id", "owner_principal_type", "owner_principal_id",
  "source_surface", "created_at", "expires_at",
]);

function text(value = "") {
  return String(value ?? "").trim();
}

function positiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function nowMs(deps = {}) {
  const value = typeof deps.now === "function" ? deps.now() : (deps.now ?? Date.now());
  return value instanceof Date ? value.getTime() : Number(value);
}

function responseChunkError(code, message, status = 500, details = undefined) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details) err.details = details;
  return err;
}

function responseChunkNotFound() {
  return responseChunkError("response_chunk_not_found", "The response chunk was not found.", 404);
}

export function sha256ResponseChunk(serialized = "") {
  return crypto.createHash("sha256").update(String(serialized), "utf8").digest("hex");
}

function assertChunkId(chunkId) {
  const value = text(chunkId);
  if (!value) throw responseChunkError("missing_chunk_id", "chunk_id is required.", 400);
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(value)) {
    throw responseChunkError("invalid_chunk_id", "chunk_id has an invalid format.", 400);
  }
  return value;
}

function executor(deps = {}) {
  return deps.pool || deps.connection || getPool();
}

export async function inspectGovernedResponseChunkSchema(deps = {}) {
  const operation = text(deps.operation || "response_chunk_schema_check") || "response_chunk_schema_check";
  try {
    const [rows] = await executor(deps).query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?`,
      [GOVERNED_RESPONSE_CHUNK_TABLE]
    );
    const present = new Set((rows || []).map((row) => text(row.column_name)).filter(Boolean));
    const missing = GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS.filter((column) => !present.has(column));
    return {
      ready: missing.length === 0,
      operation,
      table_name: GOVERNED_RESPONSE_CHUNK_TABLE,
      required_column_count: GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS.length,
      present_column_count: present.size,
      missing_columns: missing,
      migration_file: "1041_sprint69_tenant_request_inbox_and_chunk_store_hardening.sql",
      secrets_included: false,
    };
  } catch (cause) {
    return {
      ready: false,
      operation,
      table_name: GOVERNED_RESPONSE_CHUNK_TABLE,
      required_column_count: GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS.length,
      present_column_count: 0,
      missing_columns: [...GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS],
      cause_code: cause?.code || null,
      migration_file: "1041_sprint69_tenant_request_inbox_and_chunk_store_hardening.sql",
      secrets_included: false,
    };
  }
}

async function assertGovernedResponseChunkSchema(deps = {}, operation = "response_chunk_store") {
  const schema = await inspectGovernedResponseChunkSchema({ ...deps, operation });
  if (schema.ready) return schema;
  throw responseChunkError(
    "response_chunk_persistence_unavailable",
    "The durable response chunk store schema is incomplete.",
    503,
    {
      cause_code: schema.cause_code || "response_chunk_schema_incomplete",
      operation,
      missing_columns: schema.missing_columns,
      migration_file: schema.migration_file,
      secrets_included: false,
    }
  );
}

function principalFor(input = {}) {
  return resolveGovernedResponseChunkPrincipal(input);
}

async function readChunkVerificationRow(chunkId, deps = {}) {
  await assertGovernedResponseChunkSchema(deps, "read_verification");
  try {
    const [rows] = await executor(deps).query(
      `SELECT chunk_id, response_sha256, owner_tenant_id, owner_user_id, owner_workspace_id,
              owner_principal_type, owner_principal_id, source_surface
         FROM ${GOVERNED_RESPONSE_CHUNK_TABLE} WHERE chunk_id = ? LIMIT 1`,
      [chunkId]
    );
    return rows?.[0] || null;
  } catch (cause) {
    throw responseChunkError("response_chunk_persistence_unavailable", "The durable response chunk store is unavailable.", 503, { cause_code: cause?.code || null });
  }
}

export async function persistGovernedToolResponseChunk(input = {}, deps = {}) {
  await assertGovernedResponseChunkSchema(deps, "persist");
  const chunkId = assertChunkId(input.chunkId || input.chunk_id);
  const serialized = typeof input.serialized === "string" ? input.serialized : "";
  const ttlMs = positiveInteger(input.ttlMs || input.ttl_ms);
  if (!serialized) throw responseChunkError("response_chunk_empty_payload", "A non-empty serialized response is required.", 400);
  if (!ttlMs) throw responseChunkError("response_chunk_invalid_ttl", "A positive chunk TTL is required.", 400);
  if (input.secretsIncluded === true || input.secrets_included === true) {
    throw responseChunkError("response_chunk_secret_policy_failed", "Secret-bearing responses cannot be persisted in the governed chunk store.", 403);
  }

  const principal = principalFor(input);
  if (!principal) {
    throw responseChunkError("response_chunk_owner_required", "A governed response chunk owner is required.", 403);
  }
  const owner = governedResponseChunkOwnerFields(principal);
  const createdAtMs = nowMs(deps);
  const expiresAt = new Date(createdAtMs + ttlMs);
  const responseSha256 = sha256ResponseChunk(serialized);
  const responseBytes = Buffer.byteLength(serialized, "utf8");
  const sourceToolKey = text(input.sourceToolKey || input.source_tool_key).slice(0, 191) || null;
  const cursorPolicy = text(input.cursorPolicy || input.cursor_policy) || GOVERNED_RESPONSE_CHUNK_CURSOR_POLICY;
  const redactionStatus = text(input.redactionStatus || input.redaction_status) || "redacted_or_non_secret";
  const existingOwnerless = `(owner_tenant_id IS NULL
    AND owner_user_id IS NULL
    AND owner_workspace_id IS NULL
    AND owner_principal_type IS NULL
    AND owner_principal_id IS NULL)`;
  const incomingPrivileged = `(VALUES(owner_principal_type) IN ('admin','backend_service','trusted_internal'))`;
  const sameOwner = `(owner_tenant_id <=> VALUES(owner_tenant_id)
    AND owner_user_id <=> VALUES(owner_user_id)
    AND owner_workspace_id <=> VALUES(owner_workspace_id)
    AND owner_principal_type <=> VALUES(owner_principal_type)
    AND owner_principal_id <=> VALUES(owner_principal_id))`;
  const writeAllowed = `(${sameOwner} OR (${existingOwnerless} AND ${incomingPrivileged}))`;

  try {
    await executor(deps).query(
      `INSERT INTO ${GOVERNED_RESPONSE_CHUNK_TABLE} (
         chunk_id, source_tool_key, response_sha256, response_bytes, response_json,
         cursor_policy, redaction_status, secrets_included,
         owner_tenant_id, owner_user_id, owner_workspace_id, owner_principal_type,
         owner_principal_id, source_surface, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, FROM_UNIXTIME(? / 1000), ?)
       ON DUPLICATE KEY UPDATE
         source_tool_key = IF(${writeAllowed}, VALUES(source_tool_key), source_tool_key),
         response_sha256 = IF(${writeAllowed}, VALUES(response_sha256), response_sha256),
         response_bytes = IF(${writeAllowed}, VALUES(response_bytes), response_bytes),
         response_json = IF(${writeAllowed}, VALUES(response_json), response_json),
         cursor_policy = IF(${writeAllowed}, VALUES(cursor_policy), cursor_policy),
         redaction_status = IF(${writeAllowed}, VALUES(redaction_status), redaction_status),
         secrets_included = 0,
         source_surface = IF(${writeAllowed}, VALUES(source_surface), source_surface),
         expires_at = IF(${writeAllowed}, VALUES(expires_at), expires_at)`,
      [
        chunkId,
        sourceToolKey,
        responseSha256,
        responseBytes,
        serialized,
        cursorPolicy,
        redactionStatus,
        owner.owner_tenant_id,
        owner.owner_user_id,
        owner.owner_workspace_id,
        owner.owner_principal_type,
        owner.owner_principal_id,
        owner.source_surface,
        createdAtMs,
        expiresAt,
      ]
    );
  } catch (cause) {
    throw responseChunkError("response_chunk_persistence_unavailable", "The durable response chunk store is unavailable.", 503, { cause_code: cause?.code || null });
  }

  const verification = await readChunkVerificationRow(chunkId, deps);
  if (!verification || !canAccessGovernedResponseChunk(principal, verification) || verification.response_sha256 !== responseSha256) {
    throw responseChunkNotFound();
  }

  return {
    chunk_id: chunkId,
    response_sha256: responseSha256,
    response_bytes: responseBytes,
    cursor_policy: cursorPolicy,
    expires_at: expiresAt.toISOString(),
    secrets_included: false,
  };
}

export async function loadGovernedToolResponseChunk(input = {}, deps = {}) {
  await assertGovernedResponseChunkSchema(deps, "load");
  const chunkId = assertChunkId(input.chunkId || input.chunk_id);
  const principal = principalFor(input);
  if (!principal) return null;

  let rows;
  try {
    [rows] = await executor(deps).query(
      `SELECT chunk_id, source_tool_key, response_sha256, response_bytes, response_json,
              cursor_policy, redaction_status, secrets_included,
              owner_tenant_id, owner_user_id, owner_workspace_id, owner_principal_type,
              owner_principal_id, source_surface, created_at, expires_at
         FROM ${GOVERNED_RESPONSE_CHUNK_TABLE} WHERE chunk_id = ? LIMIT 1`,
      [chunkId]
    );
  } catch (cause) {
    throw responseChunkError("response_chunk_persistence_unavailable", "The durable response chunk store is unavailable.", 503, { cause_code: cause?.code || null });
  }

  const row = rows?.[0];
  if (!row || !canAccessGovernedResponseChunk(principal, row)) return null;
  if (Number(row.secrets_included || 0) !== 0) {
    throw responseChunkError("response_chunk_secret_policy_failed", "The durable response chunk failed the no-secret policy.", 500, { chunk_id: chunkId });
  }
  const expiresAtMs = new Date(row.expires_at).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs(deps)) {
    throw responseChunkError("response_chunk_expired", "The response chunk has expired.", 410, { chunk_id: chunkId, expires_at: row.expires_at || null });
  }

  const serialized = String(row.response_json ?? "");
  const actualSha256 = sha256ResponseChunk(serialized);
  const actualBytes = Buffer.byteLength(serialized, "utf8");
  if (actualSha256 !== String(row.response_sha256 || "") || actualBytes !== Number(row.response_bytes || 0)) {
    throw responseChunkError("response_chunk_integrity_failed", "The durable response chunk failed integrity verification.", 500, {
      chunk_id: chunkId,
      expected_sha256: row.response_sha256 || null,
      actual_sha256: actualSha256,
      expected_bytes: Number(row.response_bytes || 0),
      actual_bytes: actualBytes,
    });
  }

  return {
    chunk_id: chunkId,
    serialized,
    source_tool_key: row.source_tool_key || null,
    response_sha256: actualSha256,
    response_bytes: actualBytes,
    cursor_policy: row.cursor_policy || GOVERNED_RESPONSE_CHUNK_CURSOR_POLICY,
    redaction_status: row.redaction_status || "redacted_or_non_secret",
    owner_tenant_id: row.owner_tenant_id || null,
    owner_user_id: row.owner_user_id || null,
    owner_workspace_id: row.owner_workspace_id || null,
    owner_principal_type: row.owner_principal_type || null,
    owner_principal_id: row.owner_principal_id || null,
    source_surface: row.source_surface || null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    expires_at: new Date(row.expires_at).toISOString(),
    secrets_included: false,
  };
}

export async function extendGovernedToolResponseChunkExpiry(input = {}, deps = {}) {
  await assertGovernedResponseChunkSchema(deps, "extend_expiry");
  const chunkId = assertChunkId(input.chunkId || input.chunk_id);
  const ttlMs = positiveInteger(input.ttlMs || input.ttl_ms);
  if (!ttlMs) throw responseChunkError("response_chunk_invalid_ttl", "A positive chunk TTL is required.", 400);
  const principal = principalFor(input);
  if (!principal) {
    return { chunk_id: chunkId, extended: false, requested_expires_at: null, secrets_included: false };
  }
  const owner = governedResponseChunkOwnerFields(principal);
  const expiresAt = new Date(nowMs(deps) + ttlMs);
  try {
    const [result] = await executor(deps).query(
      `UPDATE ${GOVERNED_RESPONSE_CHUNK_TABLE}
          SET expires_at = CASE WHEN expires_at < ? THEN ? ELSE expires_at END
        WHERE chunk_id = ?
          AND secrets_included = 0
          AND expires_at > CURRENT_TIMESTAMP
          AND (? = 1 OR (
            owner_tenant_id <=> ?
            AND owner_user_id <=> ?
            AND owner_workspace_id <=> ?
            AND owner_principal_type <=> ?
            AND owner_principal_id <=> ?
          ))`,
      [
        expiresAt,
        expiresAt,
        chunkId,
        principal.privileged === true ? 1 : 0,
        owner.owner_tenant_id,
        owner.owner_user_id,
        owner.owner_workspace_id,
        owner.owner_principal_type,
        owner.owner_principal_id,
      ]
    );
    return {
      chunk_id: chunkId,
      extended: Number(result?.affectedRows || 0) > 0,
      requested_expires_at: expiresAt.toISOString(),
      secrets_included: false,
    };
  } catch (cause) {
    throw responseChunkError("response_chunk_persistence_unavailable", "The durable response chunk store is unavailable.", 503, { cause_code: cause?.code || null });
  }
}

export async function deleteExpiredGovernedToolResponseChunks(input = {}, deps = {}) {
  const limit = Math.min(Math.max(positiveInteger(input.limit, 500), 1), 5000);
  try {
    const [result] = await executor(deps).query(
      `DELETE FROM ${GOVERNED_RESPONSE_CHUNK_TABLE}
        WHERE expires_at <= CURRENT_TIMESTAMP
        ORDER BY expires_at ASC
        LIMIT ${limit}`
    );
    return { deleted_count: Number(result?.affectedRows || 0), limit, secrets_included: false };
  } catch (cause) {
    throw responseChunkError("response_chunk_cleanup_unavailable", "Expired response chunk cleanup is unavailable.", 503, { cause_code: cause?.code || null });
  }
}
