import { createHash } from "node:crypto";

const DEFAULT_MAX_CHUNKS = 25;
const DEFAULT_MAX_TOTAL_CHARS = 2_000_000;
const DEFAULT_READ_MAX_CHARS = 45_000;
const DEFAULT_INLINE_MAX_CHARS = 20_000;
const DEFAULT_MAX_DETAIL_REFS = 4;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const CHUNK_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,191}$/;

export class OperationChunkDetailCollectorError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "OperationChunkDetailCollectorError";
    this.code = code;
    this.status = status;
    this.details = { ...details, secrets_included: false };
  }
}

function fail(code, message, status = 400, details = {}) {
  throw new OperationChunkDetailCollectorError(code, message, status, details);
}

function boundedInteger(value, fallback, min, max, field) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    fail("operation_chunk_detail_invalid_integer", `${field} must be an integer between ${min} and ${max}.`, 400, { field });
  }
  return parsed;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function utf8Bytes(value) {
  return Buffer.byteLength(String(value), "utf8");
}

function normalizeDispatchResult(result) {
  const status = Number(result?.status || result?.http_status || result?.body?.status || 200);
  const body = result?.body !== undefined ? result.body : result;
  return {
    ok: status < 400 && body?.ok !== false,
    status,
    body,
  };
}

function parseJson(value) {
  if (typeof value !== "string" || !value.length) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function assertSafeMarkers(value, path = "response", depth = 0) {
  if (depth > 12 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafeMarkers(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (key === "secrets_included" && nested !== false) {
      fail("operation_chunk_detail_unsafe_safety_marker", `${path}.${key} must be false.`, 409, { field: `${path}.${key}` });
    }
    assertSafeMarkers(nested, `${path}.${key}`, depth + 1);
  }
}

function normalizeChunkId(value, field = "chunk_id") {
  const normalized = String(value || "").trim();
  if (!CHUNK_ID_PATTERN.test(normalized)) {
    fail("operation_chunk_detail_invalid_chunk_id", `${field} is invalid.`, 400, { field });
  }
  return normalized;
}

function normalizeHash(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (!HASH_PATTERN.test(normalized)) {
    fail("operation_chunk_detail_invalid_hash", `${field} must be a SHA-256 hash.`, 400, { field });
  }
  return normalized;
}

function pageMetadata(body = {}) {
  return {
    cursor: body?.page?.cursor === undefined || body?.page?.cursor === null ? null : Number(body.page.cursor),
    next_cursor: body?.page?.next_cursor === undefined || body?.page?.next_cursor === null ? null : Number(body.page.next_cursor),
    has_more: body?.page?.has_more === true || body?.continuation_required === true,
    max_chars: Number(body?.page?.max_chars || DEFAULT_READ_MAX_CHARS),
  };
}

function continuationFrom(body = {}) {
  if (!body || typeof body !== "object") return null;
  const declared = body?.continuation?.next_call;
  if (declared?.name === "response_chunk_read") {
    const args = declared.tool_args || {};
    return {
      chunk_id: normalizeChunkId(args.chunk_id || body.chunk_id, "continuation.chunk_id"),
      cursor: boundedInteger(args.cursor ?? body?.page?.next_cursor, 0, 0, Number.MAX_SAFE_INTEGER, "continuation.cursor"),
      max_chars: boundedInteger(args.max_chars ?? body?.page?.max_chars, DEFAULT_READ_MAX_CHARS, 1, 150_000, "continuation.max_chars"),
    };
  }
  const page = pageMetadata(body);
  if (!page.has_more && page.next_cursor === null) return null;
  if (!body.chunk_id) {
    fail("operation_chunk_detail_missing_chunk_id", "A chunk continuation was declared without a governed chunk_id.", 409);
  }
  return {
    chunk_id: normalizeChunkId(body.chunk_id),
    cursor: boundedInteger(page.next_cursor, 0, 0, Number.MAX_SAFE_INTEGER, "page.next_cursor"),
    max_chars: boundedInteger(page.max_chars, DEFAULT_READ_MAX_CHARS, 1, 150_000, "page.max_chars"),
  };
}

function integrityMetadata(body = {}) {
  return {
    chunk_id: body?.chunk_id ? normalizeChunkId(body.chunk_id) : null,
    response_sha256: normalizeHash(body?.cache?.response_sha256 || body?.response_sha256, "response_sha256"),
    cursor_policy: body?.cache?.cursor_policy ? String(body.cache.cursor_policy).trim() : null,
    expires_at: body?.cache?.expires_at || null,
    durable: body?.cache?.durable === true,
  };
}

function assertStableIntegrity(expected, observed, requestedCursor = null) {
  if (expected.chunk_id && observed.chunk_id && observed.chunk_id !== expected.chunk_id) {
    fail("operation_chunk_detail_chunk_id_mismatch", "The governed chunk_id changed during collection.", 409, {
      expected_chunk_id: expected.chunk_id,
      observed_chunk_id: observed.chunk_id,
    });
  }
  if (expected.response_sha256 && observed.response_sha256 && observed.response_sha256 !== expected.response_sha256) {
    fail("operation_chunk_detail_response_hash_changed", "The governed response hash changed during collection.", 409, {
      expected_response_sha256: expected.response_sha256,
      observed_response_sha256: observed.response_sha256,
    });
  }
  if (expected.cursor_policy && observed.cursor_policy && observed.cursor_policy !== expected.cursor_policy) {
    fail("operation_chunk_detail_cursor_policy_changed", "The governed cursor policy changed during collection.", 409, {
      expected_cursor_policy: expected.cursor_policy,
      observed_cursor_policy: observed.cursor_policy,
    });
  }
  if (requestedCursor !== null) {
    const observedCursor = pageMetadata(observed.body || {}).cursor;
    if (observedCursor !== null && observedCursor !== requestedCursor) {
      fail("operation_chunk_detail_cursor_readback_mismatch", "The chunk page cursor does not match the requested cursor.", 409, {
        requested_cursor: requestedCursor,
        observed_cursor: observedCursor,
      });
    }
  }
}

function buildDetailReference({ chunkId, responseSha256, cursorPolicy, maxChars, chunkCount, totalChars, totalBytes, expiresAt, durable }) {
  if (!chunkId) return null;
  return Object.freeze({
    ref_type: "governed_tool_response_chunk",
    tool_key: "response_chunk_read",
    tool_args: Object.freeze({ chunk_id: chunkId, cursor: 0, max_chars: maxChars }),
    response_sha256: responseSha256,
    cursor_policy: cursorPolicy || "utf16_code_unit_cursor_v1",
    continuation_policy: "read_until_page_has_more_false",
    chunk_count: chunkCount,
    total_chars: totalChars,
    total_bytes: totalBytes,
    expires_at: expiresAt,
    durable: Boolean(durable),
    secrets_included: false,
  });
}

export async function collectGovernedToolResponseChunks(initial, {
  dispatch,
  max_chunks: maxChunksInput = DEFAULT_MAX_CHUNKS,
  max_total_chars: maxTotalCharsInput = DEFAULT_MAX_TOTAL_CHARS,
} = {}) {
  const maxChunks = boundedInteger(maxChunksInput, DEFAULT_MAX_CHUNKS, 1, 100, "max_chunks");
  const maxTotalChars = boundedInteger(maxTotalCharsInput, DEFAULT_MAX_TOTAL_CHARS, 1, 10_000_000, "max_total_chars");
  const normalized = normalizeDispatchResult(initial);
  let body = normalized.body;
  assertSafeMarkers(body);

  const expected = { ...integrityMetadata(body) };
  const pieces = [];
  const seenCursors = new Set();
  let pageCount = 0;
  let totalChars = 0;
  let continuation = continuationFrom(body);

  const appendPage = (pageBody, requestedCursor = null) => {
    assertSafeMarkers(pageBody);
    const observed = integrityMetadata(pageBody);
    assertStableIntegrity(expected, { ...observed, body: pageBody }, requestedCursor);
    if (!expected.chunk_id && observed.chunk_id) expected.chunk_id = observed.chunk_id;
    if (!expected.response_sha256 && observed.response_sha256) expected.response_sha256 = observed.response_sha256;
    if (!expected.cursor_policy && observed.cursor_policy) expected.cursor_policy = observed.cursor_policy;
    if (!expected.expires_at && observed.expires_at) expected.expires_at = observed.expires_at;
    expected.durable = expected.durable || observed.durable;
    if (typeof pageBody?.chunk === "string") {
      pieces.push(pageBody.chunk);
      totalChars += pageBody.chunk.length;
      if (totalChars > maxTotalChars) {
        fail("operation_chunk_detail_total_limit_exceeded", "The governed response exceeded the bounded character limit.", 409, {
          max_total_chars: maxTotalChars,
          observed_total_chars: totalChars,
        });
      }
    }
    pageCount += 1;
  };

  if (typeof body?.chunk === "string" || continuation) appendPage(body, pageMetadata(body).cursor);

  while (continuation) {
    if (pageCount >= maxChunks) {
      fail("operation_chunk_detail_chunk_limit_exceeded", "Chunk continuation exceeded the bounded collector limit.", 409, {
        max_chunks: maxChunks,
        chunk_count: pageCount,
      });
    }
    if (typeof dispatch !== "function") {
      fail("operation_chunk_detail_dispatch_missing", "Chunked response collection requires a response_chunk_read dispatcher.", 500);
    }
    if (expected.chunk_id && continuation.chunk_id !== expected.chunk_id) {
      fail("operation_chunk_detail_continuation_chunk_id_mismatch", "The continuation references a different governed chunk_id.", 409);
    }
    if (seenCursors.has(continuation.cursor)) {
      fail("operation_chunk_detail_cursor_loop", "The governed chunk continuation repeated a cursor.", 409, { cursor: continuation.cursor });
    }
    seenCursors.add(continuation.cursor);
    const requestedCursor = continuation.cursor;
    const next = normalizeDispatchResult(await dispatch("response_chunk_read", {
      chunk_id: continuation.chunk_id,
      cursor: requestedCursor,
      max_chars: continuation.max_chars,
    }));
    if (!next.ok) {
      fail("operation_chunk_detail_read_failed", "Unable to consume the complete governed response chunk chain.", next.status || 500, {
        cursor: requestedCursor,
        chunk_id: continuation.chunk_id,
      });
    }
    body = next.body;
    appendPage(body, requestedCursor);
    const nextContinuation = continuationFrom(body);
    if (nextContinuation && nextContinuation.cursor <= requestedCursor) {
      fail("operation_chunk_detail_cursor_regression", "The governed continuation cursor did not advance.", 409, {
        requested_cursor: requestedCursor,
        next_cursor: nextContinuation.cursor,
      });
    }
    continuation = nextContinuation;
  }

  const responseChunked = pieces.length > 0;
  const collectedText = responseChunked ? pieces.join("") : null;
  const computedHash = responseChunked ? sha256(collectedText) : null;
  if (expected.response_sha256 && computedHash && expected.response_sha256 !== computedHash) {
    fail("operation_chunk_detail_response_hash_mismatch", "The reconstructed response does not match the governed response hash.", 409, {
      expected_response_sha256: expected.response_sha256,
      observed_response_sha256: computedHash,
    });
  }
  const reconstructed = responseChunked ? parseJson(collectedText) : null;
  const outputBody = responseChunked ? (reconstructed ?? collectedText) : normalized.body;
  const totalBytes = responseChunked ? utf8Bytes(collectedText) : utf8Bytes(JSON.stringify(outputBody ?? null));
  const detailReference = responseChunked
    ? buildDetailReference({
        chunkId: expected.chunk_id,
        responseSha256: expected.response_sha256 || computedHash,
        cursorPolicy: expected.cursor_policy,
        maxChars: boundedInteger(body?.page?.max_chars, DEFAULT_READ_MAX_CHARS, 1, 150_000, "page.max_chars"),
        chunkCount: pageCount,
        totalChars,
        totalBytes,
        expiresAt: expected.expires_at,
        durable: expected.durable,
      })
    : null;

  return {
    ok: normalized.ok,
    status: normalized.status,
    body: outputBody,
    chunk_collection: {
      response_chunked: responseChunked,
      chunk_count: pageCount,
      continuation_complete: continuation === null,
      response_sha256: expected.response_sha256 || computedHash,
      response_chars: responseChunked ? totalChars : null,
      response_bytes: responseChunked ? totalBytes : null,
      cursor_policy: expected.cursor_policy || (responseChunked ? "utf16_code_unit_cursor_v1" : null),
      detail_reference: detailReference,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export function projectBoundedOperationDetail(collection, {
  max_inline_chars: maxInlineCharsInput = DEFAULT_INLINE_MAX_CHARS,
  max_detail_refs: maxDetailRefsInput = DEFAULT_MAX_DETAIL_REFS,
} = {}) {
  if (!collection || typeof collection !== "object") {
    fail("operation_chunk_detail_projection_invalid", "collection must be an object.");
  }
  assertSafeMarkers(collection);
  const maxInlineChars = boundedInteger(maxInlineCharsInput, DEFAULT_INLINE_MAX_CHARS, 1, 150_000, "max_inline_chars");
  const maxDetailRefs = boundedInteger(maxDetailRefsInput, DEFAULT_MAX_DETAIL_REFS, 1, 20, "max_detail_refs");
  const serialized = typeof collection.body === "string" ? collection.body : JSON.stringify(collection.body ?? null);
  const bodySha256 = sha256(serialized);
  const detailReference = collection?.chunk_collection?.detail_reference || null;

  if (serialized.length <= maxInlineChars) {
    return {
      ok: collection.ok !== false,
      detail_status: "inline_complete",
      inline_body: collection.body,
      detail_refs: detailReference ? [detailReference].slice(0, maxDetailRefs) : [],
      body_sha256: bodySha256,
      body_chars: serialized.length,
      truncated: false,
      secrets_included: false,
    };
  }
  if (detailReference) {
    return {
      ok: collection.ok !== false,
      detail_status: "detail_reference_required",
      inline_body: null,
      detail_refs: [detailReference].slice(0, maxDetailRefs),
      body_sha256: bodySha256,
      body_chars: serialized.length,
      truncated: true,
      secrets_included: false,
    };
  }
  return {
    ok: false,
    detail_status: "blocked_missing_detail_reference",
    inline_body: null,
    detail_refs: [],
    body_sha256: bodySha256,
    body_chars: serialized.length,
    truncated: true,
    blocker: {
      code: "operation_chunk_detail_reference_required",
      message: "The response exceeds the inline detail limit and has no governed durable detail reference.",
      secrets_included: false,
    },
    secrets_included: false,
  };
}
