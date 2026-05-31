import assert from "node:assert/strict";
import {
  inspectRepoReadOnly,
  maybeChunkToolResponseBody,
  paginateItems,
  readCachedToolResponseChunk,
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

  assert.equal(firstChunk.response_chunked, true);
  assert.ok(firstChunk.chunk_id);
  assert.equal(firstChunk.page.has_more, true);
  assert.equal(firstChunk.page.cursor, 0);
  assert.ok(firstChunk.page.next_cursor > 0);
  assert.ok(firstChunk.chunk.length <= 5000);

  const secondChunk = readCachedToolResponseChunk({
    chunk_id: firstChunk.chunk_id,
    cursor: firstChunk.page.next_cursor,
    max_chars: 5000,
  });

  assert.equal(secondChunk.response_chunked, true);
  assert.equal(secondChunk.chunk_id, firstChunk.chunk_id);
  assert.equal(secondChunk.page.cursor, firstChunk.page.next_cursor);
  assert.ok(secondChunk.chunk.length <= 5000);

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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
