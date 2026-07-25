import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  collectGovernedToolResponseChunks,
  projectBoundedOperationDetail,
} from "./operationChunkDetailCollector.js";

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function page({ chunkId = "11111111-1111-4111-8111-111111111111", text, cursor, nextCursor, totalChars, responseHash, hasMore }) {
  return {
    ok: true,
    response_chunked: true,
    chunk_id: chunkId,
    continuation_required: hasMore,
    page: { cursor, next_cursor: nextCursor, has_more: hasMore, max_chars: 8, returned_chars: text.length, total_chars: totalChars },
    cache: {
      durable: true,
      cursor_policy: "utf16_code_unit_cursor_v1",
      response_sha256: responseHash,
      expires_at: "2026-07-25T20:00:00.000Z",
      secrets_included: false,
    },
    chunk: text,
    secrets_included: false,
  };
}

{
  const value = { ok: true, data: { status: "ready" }, secrets_included: false };
  const collected = await collectGovernedToolResponseChunks({ status: 200, body: value });
  assert.equal(collected.body, value);
  assert.equal(collected.chunk_collection.response_chunked, false);
  const projection = projectBoundedOperationDetail(collected, { max_inline_chars: 1_000 });
  assert.equal(projection.detail_status, "inline_complete");
  assert.deepEqual(projection.inline_body, value);
}

{
  const full = JSON.stringify({ ok: true, items: [1, 2, 3], secrets_included: false });
  const responseHash = sha256(full);
  const pieces = [full.slice(0, 8), full.slice(8, 16), full.slice(16)];
  const calls = [];
  const bodies = [
    page({ text: pieces[1], cursor: 8, nextCursor: 16, totalChars: full.length, responseHash, hasMore: true }),
    page({ text: pieces[2], cursor: 16, nextCursor: null, totalChars: full.length, responseHash, hasMore: false }),
  ];
  const collected = await collectGovernedToolResponseChunks(
    { status: 200, body: page({ text: pieces[0], cursor: 0, nextCursor: 8, totalChars: full.length, responseHash, hasMore: true }) },
    { dispatch: async (toolKey, args) => { calls.push({ toolKey, args }); return { status: 200, body: bodies.shift() }; } },
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].toolKey, "response_chunk_read");
  assert.equal(calls[0].args.cursor, 8);
  assert.deepEqual(collected.body, JSON.parse(full));
  assert.equal(collected.chunk_collection.chunk_count, 3);
  assert.equal(collected.chunk_collection.response_sha256, responseHash);
  assert.equal(collected.chunk_collection.detail_reference.tool_args.cursor, 0);
  assert.equal(collected.chunk_collection.detail_reference.durable, true);
  const projection = projectBoundedOperationDetail(collected, { max_inline_chars: 10 });
  assert.equal(projection.detail_status, "detail_reference_required");
  assert.equal(projection.inline_body, null);
  assert.equal(projection.detail_refs.length, 1);
}

{
  const full = "abcdefghijklmnop";
  const responseHash = sha256(full);
  const first = page({ text: full.slice(0, 8), cursor: 0, nextCursor: 8, totalChars: 16, responseHash, hasMore: true });
  await assert.rejects(
    collectGovernedToolResponseChunks({ status: 200, body: first }, {
      dispatch: async () => ({ status: 200, body: page({ text: full.slice(8), cursor: 8, nextCursor: 8, totalChars: 16, responseHash, hasMore: true }) }),
    }),
    (error) => error.code === "operation_chunk_detail_cursor_regression",
  );
}

{
  const full = "abcdefghijklmnop";
  const responseHash = sha256(full);
  const first = page({ text: full.slice(0, 8), cursor: 0, nextCursor: 8, totalChars: 16, responseHash, hasMore: true });
  await assert.rejects(
    collectGovernedToolResponseChunks({ status: 200, body: first }, {
      dispatch: async () => ({ status: 200, body: page({ chunkId: "22222222-2222-4222-8222-222222222222", text: full.slice(8), cursor: 8, nextCursor: null, totalChars: 16, responseHash, hasMore: false }) }),
    }),
    (error) => error.code === "operation_chunk_detail_chunk_id_mismatch",
  );
}

{
  const full = "abcdefghijklmnop";
  const first = page({ text: full.slice(0, 8), cursor: 0, nextCursor: 8, totalChars: 16, responseHash: "f".repeat(64), hasMore: true });
  await assert.rejects(
    collectGovernedToolResponseChunks({ status: 200, body: first }, {
      dispatch: async () => ({ status: 200, body: page({ text: full.slice(8), cursor: 8, nextCursor: null, totalChars: 16, responseHash: "f".repeat(64), hasMore: false }) }),
    }),
    (error) => error.code === "operation_chunk_detail_response_hash_mismatch",
  );
}

{
  const full = "abcdefghijklmnop";
  const responseHash = sha256(full);
  const first = page({ text: full.slice(0, 8), cursor: 0, nextCursor: 8, totalChars: 16, responseHash, hasMore: true });
  await assert.rejects(
    collectGovernedToolResponseChunks({ status: 200, body: first }, { max_chunks: 1, dispatch: async () => { throw new Error("dispatch must not be called"); } }),
    (error) => error.code === "operation_chunk_detail_chunk_limit_exceeded",
  );
}

{
  await assert.rejects(
    collectGovernedToolResponseChunks({ status: 200, body: { ok: true, chunk_id: "11111111-1111-4111-8111-111111111111", chunk: "{}", page: { cursor: 0, has_more: false }, secrets_included: true } }),
    (error) => error.code === "operation_chunk_detail_unsafe_safety_marker",
  );
}

{
  const collected = await collectGovernedToolResponseChunks({ status: 200, body: { ok: true, data: "x".repeat(100), secrets_included: false } });
  const projection = projectBoundedOperationDetail(collected, { max_inline_chars: 20 });
  assert.equal(projection.ok, false);
  assert.equal(projection.detail_status, "blocked_missing_detail_reference");
  assert.equal(projection.detail_refs.length, 0);
}

console.log("operation chunk detail collector tests passed");
