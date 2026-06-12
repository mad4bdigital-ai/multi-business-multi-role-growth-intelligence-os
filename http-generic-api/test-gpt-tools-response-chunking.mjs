import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHUNKED_TOOL_RESPONSE_CONTINUATION_CONTRACT,
  inspectRepoReadOnly,
  maybeChunkToolResponseBody,
  paginateItems,
  readCachedToolResponseChunk,
  resolveToolResponseChunkTtlMs,
} from "./routes/gptToolsRoutes.js";

async function main() {
  const largeBody = {
    ok: true,
    items: Array.from({ length: 200 }, (_, index) => ({
      id: index,
      text: `tool-response-${index}-${"x".repeat(120)}`,
    })),
  };

  const firstChunk = maybeChunkToolResponseBody(largeBody, {
    response_options: { max_chars: 5000 },
  });

  assert.equal(CHUNKED_TOOL_RESPONSE_CONTINUATION_CONTRACT.policy, "chunk_read_before_alternative_surface");
  assert.equal(CHUNKED_TOOL_RESPONSE_CONTINUATION_CONTRACT.required_tool, "response_chunk_read");
  assert.ok(CHUNKED_TOOL_RESPONSE_CONTINUATION_CONTRACT.applies_to.includes("any_governed_tool_response"));
  assert.equal(firstChunk.response_chunked, true);
  assert.ok(firstChunk.chunk_id);
  assert.equal(firstChunk.continuation_required, true);
  assert.equal(firstChunk.continuation.policy, "chunk_read_before_alternative_surface");
  assert.equal(firstChunk.continuation.required_tool, "response_chunk_read");
  assert.equal(firstChunk.continuation.required_before_fallback, true);
  assert.equal(firstChunk.continuation.next_call.name, "response_chunk_read");
  assert.equal(firstChunk.continuation.next_call.tool_args.chunk_id, firstChunk.chunk_id);
  assert.equal(firstChunk.continuation.next_call.tool_args.cursor, firstChunk.page.next_cursor);
  assert.equal(firstChunk.page.has_more, true);
  assert.equal(firstChunk.page.cursor, 0);
  assert.ok(firstChunk.page.next_cursor > 0);
  assert.ok(firstChunk.chunk.length <= 5000);
  assert.ok(firstChunk.cache.ttl_ms >= 15 * 60 * 1000);
  assert.ok(firstChunk.cache.expires_at);

  const requestedTtl = resolveToolResponseChunkTtlMs({ response_options: { max_chars: 5000, chunk_ttl_minutes: 45 } }, JSON.stringify(largeBody).length);
  assert.ok(requestedTtl >= 45 * 60 * 1000);

  const secondChunk = readCachedToolResponseChunk({
    chunk_id: firstChunk.chunk_id,
    cursor: firstChunk.page.next_cursor,
    max_chars: 5000,
  });

  assert.equal(secondChunk.response_chunked, true);
  assert.equal(secondChunk.chunk_id, firstChunk.chunk_id);
  assert.equal(secondChunk.page.cursor, firstChunk.page.next_cursor);
  assert.ok(secondChunk.chunk.length <= 5000);
  assert.ok(secondChunk.cache.read_count >= 1);
  assert.equal(secondChunk.cache.extended_on_read, true);

  const paged = paginateItems([
    { name: "alpha_tool", tags: ["repo"] },
    { name: "beta_tool", tags: ["repo", "git"] },
    { name: "gamma", tags: ["other"] },
  ], { limit: 1, cursor: 1, q: "tool", tag: "repo" });

  assert.equal(paged.items.length, 1);
  assert.equal(paged.items[0].name, "beta_tool");
  assert.equal(paged.page.total_count, 2);
  assert.equal(paged.page.has_more, false);

  const status = await inspectRepoReadOnly({ action: "git_status", max_chars: 10000 });
  assert.equal(status.action, "git_status");
  assert.ok(status.head_sha.length >= 7);
  assert.ok(typeof status.status === "string");

  const log = await inspectRepoReadOnly({ action: "git_log", max_entries: 1, max_chars: 10000 });
  assert.equal(log.action, "git_log");
  assert.ok(log.count <= 1);
  if (log.count === 1) assert.ok(log.commits[0].sha.length >= 7);

  const diff = await inspectRepoReadOnly({ action: "git_diff_name_status", head_ref: "HEAD", max_chars: 10000 });
  assert.equal(diff.action, "git_diff_name_status");
  assert.ok(Array.isArray(diff.files));

  const systemLayerRoutes = readFileSync("routes/systemLayerRoutes.js", "utf8");
  assert.ok(systemLayerRoutes.includes("response_chunk_read"), "system layer must expose response_chunk_read for admin and tenant callers");
  assert.ok(systemLayerRoutes.includes("chunkSystemLayerResponse"), "system layer list/call routes must chunk oversized responses");
  assert.ok(systemLayerRoutes.includes("buildSystemToolsListResponse"), "system layer tools list must be bounded and page-aware");
  assert.ok(systemLayerRoutes.includes("bounded_paginated_chunkable"), "system layer tools list must advertise bounded chunkable mode");
  assert.ok(systemLayerRoutes.includes("chunk_ttl_minutes"), "system layer must expose controllable chunk TTL options");

  const migrationName = "232_sprint68_chunked_tool_response_continuation_policy.sql";
  const migration = readFileSync(`migrations/${migrationName}`, "utf8");
  const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
  const readiness = readFileSync("releaseReadiness.js", "utf8");
  assert.ok(migration.includes("Chunked Tool Response Continuation Contract"));
  assert.ok(migration.includes("chunk_read_before_alternative_surface"));
  assert.ok(migration.includes("response_chunk_read"));
  assert.ok(migration.includes("only_then_use_secondary_search_slice_or_external_fallback"));
  assert.ok(migration.includes("claim_file_too_large_without_attempting_response_chunk_read"));
  assert.ok(runner.includes(migrationName), "governed migration runner must allow migration 232");
  assert.ok(readiness.includes(migrationName), "release readiness must track migration 232");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
