import assert from "node:assert/strict";
import {
  GOVERNED_RESPONSE_CHUNK_CURSOR_POLICY,
  extendGovernedToolResponseChunkExpiry,
  loadGovernedToolResponseChunk,
  persistGovernedToolResponseChunk,
  sha256ResponseChunk,
} from "./governedToolResponseChunkStore.js";

function createFakePool() {
  const rows = new Map();
  return {
    rows,
    async query(sql, params = []) {
      if (sql.includes("INSERT INTO governed_tool_response_chunks")) {
        const [chunkId, sourceToolKey, hash, bytes, serialized, cursorPolicy, redactionStatus, createdAtMs, expiresAt] = params;
        rows.set(chunkId, {
          chunk_id: chunkId,
          source_tool_key: sourceToolKey,
          response_sha256: hash,
          response_bytes: bytes,
          response_json: serialized,
          cursor_policy: cursorPolicy,
          redaction_status: redactionStatus,
          secrets_included: 0,
          created_at: new Date(createdAtMs),
          expires_at: new Date(expiresAt),
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("FROM governed_tool_response_chunks") && sql.includes("WHERE chunk_id = ?")) {
        const row = rows.get(params[0]);
        return [[...(row ? [row] : [])]];
      }
      if (sql.includes("UPDATE governed_tool_response_chunks")) {
        const [candidate, , chunkId] = params;
        const row = rows.get(chunkId);
        if (!row) return [{ affectedRows: 0 }];
        if (new Date(candidate).getTime() > new Date(row.expires_at).getTime()) row.expires_at = new Date(candidate);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in fake pool: ${sql.slice(0, 80)}`);
    },
  };
}

const now = Date.parse("2026-06-18T20:00:00.000Z");
const pool = createFakePool();
const chunkId = "11111111-2222-4333-8444-555555555555";
const serialized = JSON.stringify({ message: "مرحبا بالعالم 🌍", nested: ["😀", "بيانات"] });

const persisted = await persistGovernedToolResponseChunk({
  chunk_id: chunkId,
  serialized,
  ttl_ms: 10 * 60 * 1000,
  source_tool_key: "test_unicode_response",
}, { pool, now });
assert.equal(persisted.cursor_policy, GOVERNED_RESPONSE_CHUNK_CURSOR_POLICY);
assert.equal(persisted.response_sha256, sha256ResponseChunk(serialized));
assert.equal(persisted.response_bytes, Buffer.byteLength(serialized, "utf8"));

const loaded = await loadGovernedToolResponseChunk({ chunk_id: chunkId }, { pool, now: now + 1000 });
assert.equal(loaded.serialized, serialized);
assert.equal(loaded.response_sha256, persisted.response_sha256);
assert.equal(loaded.response_bytes, Buffer.byteLength(serialized, "utf8"));

await extendGovernedToolResponseChunkExpiry({ chunk_id: chunkId, ttl_ms: 20 * 60 * 1000 }, { pool, now: now + 2000 });
assert.equal(new Date(pool.rows.get(chunkId).expires_at).toISOString(), new Date(now + 2000 + 20 * 60 * 1000).toISOString());

await assert.rejects(
  persistGovernedToolResponseChunk({ chunk_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", serialized, ttl_ms: 300000, secrets_included: true }, { pool, now }),
  (err) => err.code === "response_chunk_secret_policy_failed" && err.status === 403
);

const tamperedId = "99999999-8888-4777-8666-555555555555";
await persistGovernedToolResponseChunk({ chunk_id: tamperedId, serialized, ttl_ms: 300000 }, { pool, now });
pool.rows.get(tamperedId).response_json = `${serialized}tampered`;
await assert.rejects(
  loadGovernedToolResponseChunk({ chunk_id: tamperedId }, { pool, now: now + 1 }),
  (err) => err.code === "response_chunk_integrity_failed" && err.status === 500
);

const expiredId = "12121212-3434-4567-8989-101010101010";
await persistGovernedToolResponseChunk({ chunk_id: expiredId, serialized, ttl_ms: 300000 }, { pool, now });
await assert.rejects(
  loadGovernedToolResponseChunk({ chunk_id: expiredId }, { pool, now: now + 300000 }),
  (err) => err.code === "response_chunk_expired" && err.status === 410
);

const failingPool = { async query() { const err = new Error("db down"); err.code = "ECONNREFUSED"; throw err; } };
await assert.rejects(
  persistGovernedToolResponseChunk({ chunk_id: "abababab-cdcd-4efe-8123-456789abcdef", serialized, ttl_ms: 300000 }, { pool: failingPool, now }),
  (err) => err.code === "response_chunk_persistence_unavailable" && err.status === 503
);

console.log("governed tool response chunk store tests passed");
