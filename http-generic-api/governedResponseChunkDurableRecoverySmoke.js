import crypto from "node:crypto";

export const GOVERNED_RESPONSE_CHUNK_DURABLE_RECOVERY_SMOKE_KEY =
  "response_chunk_durable_recovery_smoke_v1";
export const GOVERNED_RESPONSE_CHUNK_DURABLE_RECOVERY_SOURCE_TOOL =
  "response_chunk_durable_recovery_smoke";
export const GOVERNED_RESPONSE_CHUNK_DURABLE_RECOVERY_CONFIRMATION =
  "RUN_RESPONSE_CHUNK_DURABLE_RECOVERY_SMOKE";

const SMOKE_MAX_CHARS = 5000;
const MIN_REPEAT_COUNT = 24;
const MAX_REPEAT_COUNT = 120;
const DEFAULT_REPEAT_COUNT = 48;
const MIN_TTL_MINUTES = 5;
const MAX_TTL_MINUTES = 30;
const DEFAULT_TTL_MINUTES = 5;
const ARABIC_UNICODE_MARKER =
  "استجابة عربية دقيقة 🌍✅ مرحبا بالعالم — حفظ UTF-8 وإعادة تركيب Unicode بلا تغيير.";

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), minimum), maximum);
}

function nowMs(deps = {}) {
  const value = typeof deps.now === "function" ? deps.now() : (deps.now ?? Date.now());
  return value instanceof Date ? value.getTime() : Number(value);
}

function smokeError(code, message, status = 500, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

function assertSmoke(condition, code, message, status = 500, details = undefined) {
  if (!condition) throw smokeError(code, message, status, details);
}

function sha256(value = "") {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function asEpoch(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function asIso(value) {
  const parsed = asEpoch(value);
  return parsed ? new Date(parsed).toISOString() : null;
}

export function buildGovernedResponseChunkUnicodeSmokePayload(repeatCount = DEFAULT_REPEAT_COUNT) {
  const count = boundedInteger(repeatCount, DEFAULT_REPEAT_COUNT, MIN_REPEAT_COUNT, MAX_REPEAT_COUNT);
  return {
    ok: true,
    smoke_contract: GOVERNED_RESPONSE_CHUNK_DURABLE_RECOVERY_SMOKE_KEY,
    items: Array.from({ length: count }, (_, index) => ({
      index,
      text: `بداية-${String(index + 1).padStart(3, "0")}|${ARABIC_UNICODE_MARKER}|نهاية-${String(index + 1).padStart(3, "0")}`,
    })),
    provider_calls: 0,
    external_writes: 0,
    secrets_included: false,
  };
}

async function readDurableRow(pool, chunkId) {
  const [rows] = await pool.query(
    `SELECT chunk_id, source_tool_key, response_sha256, response_bytes, response_json,
            cursor_policy, redaction_status, secrets_included, created_at, expires_at, updated_at
       FROM governed_tool_response_chunks
      WHERE chunk_id = ?
      LIMIT 1`,
    [chunkId]
  );
  return rows?.[0] || null;
}

export async function runGovernedResponseChunkDurableRecoverySmoke(args = {}, deps = {}) {
  assertSmoke(
    String(args.confirm || "") === GOVERNED_RESPONSE_CHUNK_DURABLE_RECOVERY_CONFIRMATION,
    "response_chunk_smoke_confirmation_required",
    `confirm must equal ${GOVERNED_RESPONSE_CHUNK_DURABLE_RECOVERY_CONFIRMATION}.`,
    400
  );

  const pool = deps.pool;
  const maybeChunk = deps.maybeChunkToolResponseBody;
  const evictMemory = deps.evictToolResponseChunkMemoryCache;
  const readChunk = deps.readCachedToolResponseChunk;
  assertSmoke(pool && typeof pool.query === "function", "response_chunk_smoke_pool_required", "A governed SQL pool is required.");
  assertSmoke(typeof maybeChunk === "function", "response_chunk_smoke_chunker_required", "The governed response chunker is required.");
  assertSmoke(typeof evictMemory === "function", "response_chunk_smoke_evictor_required", "The response chunk memory-cache evictor is required.");
  assertSmoke(typeof readChunk === "function", "response_chunk_smoke_reader_required", "The governed response chunk reader is required.");

  const repeatCount = boundedInteger(args.repeat_count, DEFAULT_REPEAT_COUNT, MIN_REPEAT_COUNT, MAX_REPEAT_COUNT);
  const ttlMinutes = boundedInteger(args.chunk_ttl_minutes, DEFAULT_TTL_MINUTES, MIN_TTL_MINUTES, MAX_TTL_MINUTES);
  const payload = buildGovernedResponseChunkUnicodeSmokePayload(repeatCount);
  const serialized = JSON.stringify(payload);
  const expectedSha256 = sha256(serialized);
  const expectedBytes = Buffer.byteLength(serialized, "utf8");
  assertSmoke(serialized.length > SMOKE_MAX_CHARS, "response_chunk_smoke_payload_too_small", "The deterministic smoke payload did not exceed the chunk threshold.", 500, {
    serialized_chars: serialized.length,
    threshold_chars: SMOKE_MAX_CHARS,
  });

  const createdNow = nowMs(deps);
  const firstPage = await maybeChunk(payload, {
    response_options: {
      max_chars: SMOKE_MAX_CHARS,
      chunk_ttl_minutes: ttlMinutes,
    },
    source_tool_key: GOVERNED_RESPONSE_CHUNK_DURABLE_RECOVERY_SOURCE_TOOL,
  }, { pool, now: createdNow });

  assertSmoke(firstPage?.response_chunked === true, "response_chunk_smoke_not_chunked", "The smoke response was not chunked.");
  assertSmoke(firstPage?.cache?.durable === true, "response_chunk_smoke_not_durable", "The smoke response was not marked durable.");
  const chunkId = String(firstPage.chunk_id || "");
  assertSmoke(chunkId, "response_chunk_smoke_chunk_id_missing", "The smoke response did not return chunk_id.");

  const rowBefore = await readDurableRow(pool, chunkId);
  assertSmoke(rowBefore, "response_chunk_smoke_durable_row_missing", "The durable row was not present immediately after chunk_id return.");
  const rowBeforeSerialized = String(rowBefore.response_json ?? "");
  const rowBeforeBytes = Number(rowBefore.response_bytes || 0);
  const initialExpiresAtMs = asEpoch(rowBefore.expires_at);
  const initialExpiresAtIso = asIso(rowBefore.expires_at);
  assertSmoke(rowBeforeSerialized === serialized, "response_chunk_smoke_persisted_payload_mismatch", "The persisted response JSON did not match the deterministic smoke payload.");
  assertSmoke(String(rowBefore.response_sha256 || "") === expectedSha256, "response_chunk_smoke_persisted_sha_mismatch", "The persisted response SHA-256 did not match.");
  assertSmoke(rowBeforeBytes === expectedBytes, "response_chunk_smoke_persisted_bytes_mismatch", "The persisted UTF-8 byte length did not match.");
  assertSmoke(Number(rowBefore.secrets_included || 0) === 0, "response_chunk_smoke_secret_policy_failed", "The durable smoke row violated the no-secret policy.");

  const memoryCacheEvicted = evictMemory(chunkId);
  assertSmoke(memoryCacheEvicted === true, "response_chunk_smoke_cache_evict_failed", "The process-local smoke cache entry could not be evicted.");

  let cursor = 0;
  let reconstructed = "";
  let pageCount = 0;
  let recoverySource = null;
  let finalReadCache = null;
  do {
    const page = await readChunk({
      chunk_id: chunkId,
      cursor,
      max_chars: SMOKE_MAX_CHARS,
      chunk_ttl_minutes: ttlMinutes,
    }, {
      pool,
      now: createdNow + 1000 + pageCount,
    });
    if (pageCount === 0) recoverySource = page.source || null;
    reconstructed += String(page.chunk || "");
    cursor = page.page?.next_cursor ?? null;
    finalReadCache = page.cache || null;
    pageCount += 1;
    assertSmoke(pageCount <= 100, "response_chunk_smoke_page_limit_exceeded", "The smoke continuation exceeded its bounded page limit.");
  } while (cursor !== null);

  const rowAfter = await readDurableRow(pool, chunkId);
  assertSmoke(rowAfter, "response_chunk_smoke_post_read_row_missing", "The durable row disappeared during recovery.");
  const finalExpiresAtMs = asEpoch(rowAfter.expires_at);
  const parsed = JSON.parse(reconstructed);
  const firstText = String(parsed?.items?.[0]?.text || "");
  const lastText = String(parsed?.items?.[parsed.items.length - 1]?.text || "");
  const exactReconstruction = reconstructed === serialized;
  const expiryExtended = finalExpiresAtMs > initialExpiresAtMs;

  assertSmoke(recoverySource === "governed_tool_response_chunk_store", "response_chunk_smoke_mysql_recovery_missing", "The first read after memory eviction did not recover from MySQL.", 500, { recovery_source: recoverySource });
  assertSmoke(exactReconstruction, "response_chunk_smoke_unicode_reconstruction_failed", "Arabic and emoji JSON did not reconstruct exactly.");
  assertSmoke(sha256(reconstructed) === expectedSha256, "response_chunk_smoke_reconstructed_sha_mismatch", "The reconstructed response SHA-256 did not match.");
  assertSmoke(Buffer.byteLength(reconstructed, "utf8") === expectedBytes, "response_chunk_smoke_reconstructed_bytes_mismatch", "The reconstructed UTF-8 byte length did not match.");
  assertSmoke(firstText.startsWith("بداية-001|") && firstText.includes("🌍✅"), "response_chunk_smoke_first_marker_failed", "The first Unicode marker was not preserved.");
  assertSmoke(lastText.endsWith(`نهاية-${String(repeatCount).padStart(3, "0")}`) && lastText.includes("مرحبا بالعالم"), "response_chunk_smoke_last_marker_failed", "The final Unicode marker was not preserved.");
  assertSmoke(expiryExtended, "response_chunk_smoke_expiry_not_extended", "Sliding expiry did not extend after durable recovery.");

  return {
    ok: true,
    smoke_contract: GOVERNED_RESPONSE_CHUNK_DURABLE_RECOVERY_SMOKE_KEY,
    chunk_id: chunkId,
    source_tool_key: GOVERNED_RESPONSE_CHUNK_DURABLE_RECOVERY_SOURCE_TOOL,
    payload_summary: {
      item_count: repeatCount,
      utf16_code_units: serialized.length,
      utf8_bytes: expectedBytes,
      contains_arabic: true,
      contains_emoji: true,
      raw_payload_returned: false,
    },
    persistence: {
      durable_row_present_immediately_after_chunk_id_return: true,
      memory_cache_evicted: true,
      recovery_source: recoverySource,
      page_count: pageCount,
      max_chars_per_page: SMOKE_MAX_CHARS,
    },
    integrity: {
      persisted_sha256_match: String(rowBefore.response_sha256 || "") === expectedSha256,
      persisted_utf8_byte_length_match: rowBeforeBytes === expectedBytes,
      exact_unicode_reconstruction: exactReconstruction,
      reconstructed_sha256_match: sha256(reconstructed) === expectedSha256,
      reconstructed_utf8_byte_length_match: Buffer.byteLength(reconstructed, "utf8") === expectedBytes,
      cursor_policy: rowAfter.cursor_policy || finalReadCache?.cursor_policy || null,
      no_secret_policy_passed: Number(rowAfter.secrets_included || 0) === 0,
    },
    expiry: {
      sliding_extension_verified: expiryExtended,
      initial_expires_at: initialExpiresAtIso,
      final_expires_at: asIso(rowAfter.expires_at),
      ttl_minutes: ttlMinutes,
    },
    provider_calls: 0,
    external_writes: 0,
    cleanup_policy: "natural_ttl_expiry",
    secrets_included: false,
  };
}
