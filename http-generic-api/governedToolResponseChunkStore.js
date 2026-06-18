import crypto from "node:crypto";
import { getPool } from "./db.js";

export const GOVERNED_RESPONSE_CHUNK_CURSOR_POLICY = "utf16_code_unit_cursor_v1";
const GOVERNED_RESPONSE_CHUNK_TABLE = "governed_tool_response_chunks";

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

export async function persistGovernedToolResponseChunk(input = {}, deps = {}) {
  const chunkId = assertChunkId(input.chunkId || input.chunk_id);
  const serialized = typeof input.serialized === "string" ? input.serialized : "";
  const ttlMs = positiveInteger(input.ttlMs || input.ttl_ms);
  if (!serialized) throw responseChunkError("response_chunk_empty_payload", "A non-empty serialized response is required.", 400);
  if (!ttlMs) throw responseChunkError("response_chunk_invalid_ttl", "A positive chunk TTL is required.", 400);
  if (input.secretsIncluded === true || input.secrets_included === true) {
    throw responseChunkError("response_chunk_secret_policy_failed", "Secret-bearing responses cannot be persisted in the governed chunk store.", 403);
  }

  const createdAtMs = nowMs(deps);
  const expiresAt = new Date(createdAtMs + ttlMs);
  const responseSha256 = sha256ResponseChunk(serialized);
  const responseBytes = Buffer.byteLength(serialized, "utf8");
  const sourceToolKey = text(input.sourceToolKey || input.source_tool_key).slice(0, 191) || null;
  const cursorPolicy = text(input.cursorPolicy || input.cursor_policy) || GOVERNED_RESPONSE_CHUNK_CURSOR_POLICY;
  const redactionStatus = text(input.redactionStatus || input.redaction_status) || "redacted_or_non_secret";

  try {
    await executor(deps).query(
      `INSERT INTO ${GOVERNED_RESPONSE_CHUNK_TABLE} (
         chunk_id, source_tool_key, response_sha256, response_bytes, response_json,
         cursor_policy, redaction_status, secrets_included, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, FROM_UNIXTIME(? / 1000), ?)
       ON DUPLICATE KEY UPDATE
         source_tool_key = VALUES(source_tool_key), response_sha256 = VALUES(response_sha256),
         response_bytes = VALUES(response_bytes), response_json = VALUES(response_json),
         cursor_policy = VALUES(cursor_policy), redaction_status = VALUES(redaction_status),
         secrets_included = 0, expires_at = VALUES(expires_at)`,
      [chunkId, sourceToolKey, responseSha256, responseBytes, serialized, cursorPolicy, redactionStatus, createdAtMs, expiresAt]
    );
  } catch (cause) {
    throw responseChunkError("response_chunk_persistence_unavailable", "The durable response chunk store is unavailable.", 503, { cause_code: cause?.code || null });
  }

  return { chunk_id: chunkId, response_sha256: responseSha256, response_bytes: responseBytes, cursor_policy: cursorPolicy, expires_at: expiresAt.toISOString(), secrets_included: false };
}

export async function loadGovernedToolResponseChunk(input = {}, deps = {}) {
  const chunkId = assertChunkId(input.chunkId || input.chunk_id);
  let rows;
  try {
    [rows] = await executor(deps).query(
      `SELECT chunk_id, source_tool_key, response_sha256, response_bytes, response_json,
              cursor_policy, redaction_status, secrets_included, created_at, expires_at
         FROM ${GOVERNED_RESPONSE_CHUNK_TABLE} WHERE chunk_id = ? LIMIT 1`,
      [chunkId]
    );
  } catch (cause) {
    throw responseChunkError("response_chunk_persistence_unavailable", "The durable response chunk store is unavailable.", 503, { cause_code: cause?.code || null });
  }

  const row = rows?.[0];
  if (!row) return null;
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
      chunk_id: chunkId, expected_sha256: row.response_sha256 || null, actual_sha256: actualSha256,
      expected_bytes: Number(row.response_bytes || 0), actual_bytes: actualBytes,
    });
  }

  return {
    chunk_id: chunkId, serialized, source_tool_key: row.source_tool_key || null,
    response_sha256: actualSha256, response_bytes: actualBytes,
    cursor_policy: row.cursor_policy || GOVERNED_RESPONSE_CHUNK_CURSOR_POLICY,
    redaction_status: row.redaction_status || "redacted_or_non_secret",
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    expires_at: new Date(row.expires_at).toISOString(), secrets_included: false,
  };
}

export async function extendGovernedToolResponseChunkExpiry(input = {}, deps = {}) {
  const chunkId = assertChunkId(input.chunkId || input.chunk_id);
  const ttlMs = positiveInteger(input.ttlMs || input.ttl_ms);
  if (!ttlMs) throw responseChunkError("response_chunk_invalid_ttl", "A positive chunk TTL is required.", 400);
  const expiresAt = new Date(nowMs(deps) + ttlMs);
  try {
    const [result] = await executor(deps).query(
      `UPDATE ${GOVERNED_RESPONSE_CHUNK_TABLE}
          SET expires_at = CASE WHEN expires_at < ? THEN ? ELSE expires_at END
        WHERE chunk_id = ? AND secrets_included = 0 AND expires_at > CURRENT_TIMESTAMP`,
      [expiresAt, expiresAt, chunkId]
    );
    return { chunk_id: chunkId, extended: Number(result?.affectedRows || 0) > 0, requested_expires_at: expiresAt.toISOString(), secrets_included: false };
  } catch (cause) {
    throw responseChunkError("response_chunk_persistence_unavailable", "The durable response chunk store is unavailable.", 503, { cause_code: cause?.code || null });
  }
}

export async function deleteExpiredGovernedToolResponseChunks(input = {}, deps = {}) {
  const limit = Math.min(Math.max(positiveInteger(input.limit, 500), 1), 5000);
  try {
    const [result] = await executor(deps).query(
      `DELETE FROM ${GOVERNED_RESPONSE_CHUNK_TABLE} WHERE expires_at <= CURRENT_TIMESTAMP ORDER BY expires_at ASC LIMIT ${limit}`
    );
    return { deleted_count: Number(result?.affectedRows || 0), limit, secrets_included: false };
  } catch (cause) {
    throw responseChunkError("response_chunk_cleanup_unavailable", "Expired response chunk cleanup is unavailable.", 503, { cause_code: cause?.code || null });
  }
}
