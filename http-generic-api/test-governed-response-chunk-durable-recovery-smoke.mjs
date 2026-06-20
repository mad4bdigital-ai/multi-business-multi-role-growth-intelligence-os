import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evictToolResponseChunkMemoryCache,
  maybeChunkToolResponseBody,
  readCachedToolResponseChunk,
} from "./routes/gptToolsRoutes.js";
import {
  GOVERNED_RESPONSE_CHUNK_DURABLE_RECOVERY_CONFIRMATION,
  buildGovernedResponseChunkUnicodeSmokePayload,
  runGovernedResponseChunkDurableRecoverySmoke,
} from "./governedResponseChunkDurableRecoverySmoke.js";

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
          updated_at: new Date(createdAtMs),
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("FROM governed_tool_response_chunks") && sql.includes("WHERE chunk_id = ?")) {
        const row = rows.get(params[0]);
        return [[...(row ? [{ ...row }] : [])]];
      }
      if (sql.includes("UPDATE governed_tool_response_chunks")) {
        const [candidate, , chunkId] = params;
        const row = rows.get(chunkId);
        if (!row) return [{ affectedRows: 0 }];
        if (new Date(candidate).getTime() > new Date(row.expires_at).getTime()) {
          row.expires_at = new Date(candidate);
          row.updated_at = new Date(candidate);
        }
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in fake pool: ${sql.slice(0, 120)}`);
    },
  };
}

async function main() {
  const payload = buildGovernedResponseChunkUnicodeSmokePayload(24);
  const serialized = JSON.stringify(payload);
  assert.ok(serialized.length > 5000);
  assert.ok(serialized.includes("مرحبا بالعالم"));
  assert.ok(serialized.includes("🌍✅"));

  await assert.rejects(
    () => runGovernedResponseChunkDurableRecoverySmoke({}, {
      pool: createFakePool(),
      maybeChunkToolResponseBody,
      evictToolResponseChunkMemoryCache,
      readCachedToolResponseChunk,
    }),
    (error) => error?.code === "response_chunk_smoke_confirmation_required" && error?.status === 400
  );

  const pool = createFakePool();
  const result = await runGovernedResponseChunkDurableRecoverySmoke({
    confirm: GOVERNED_RESPONSE_CHUNK_DURABLE_RECOVERY_CONFIRMATION,
    repeat_count: 24,
    chunk_ttl_minutes: 5,
  }, {
    pool,
    now: Date.parse("2026-06-20T01:00:00.000Z"),
    maybeChunkToolResponseBody,
    evictToolResponseChunkMemoryCache,
    readCachedToolResponseChunk,
  });

  assert.equal(result.ok, true);
  assert.equal(result.persistence.durable_row_present_immediately_after_chunk_id_return, true);
  assert.equal(result.persistence.memory_cache_evicted, true);
  assert.equal(result.persistence.recovery_source, "governed_tool_response_chunk_store");
  assert.ok(result.persistence.page_count >= 2);
  assert.equal(result.integrity.persisted_sha256_match, true);
  assert.equal(result.integrity.persisted_utf8_byte_length_match, true);
  assert.equal(result.integrity.exact_unicode_reconstruction, true);
  assert.equal(result.integrity.reconstructed_sha256_match, true);
  assert.equal(result.integrity.reconstructed_utf8_byte_length_match, true);
  assert.equal(result.integrity.cursor_policy, "utf16_code_unit_cursor_v1");
  assert.equal(result.integrity.no_secret_policy_passed, true);
  assert.equal(result.expiry.sliding_extension_verified, true);
  assert.notEqual(result.expiry.initial_expires_at, result.expiry.final_expires_at);
  assert.equal(result.payload_summary.raw_payload_returned, false);
  assert.equal(result.provider_calls, 0);
  assert.equal(result.external_writes, 0);
  assert.equal(result.secrets_included, false);

  const routeSource = readFileSync("routes/gptToolsRoutes.js", "utf8");
  assert.ok(routeSource.includes("response_chunk_durable_recovery_smoke"));
  assert.ok(routeSource.includes("runGovernedResponseChunkDurableRecoverySmoke"));
  assert.ok(routeSource.includes("memory_cache_evicted"));

  console.log("governed response chunk durable recovery smoke tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
