import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHUNKED_TOOL_RESPONSE_CONTINUATION_CONTRACT,
  evictToolResponseChunkMemoryCache,
  inspectRepoReadOnly,
  isGovernedToolResponseChunkEnvelope,
  maybeChunkToolResponseBody,
  paginateItems,
  resolveAdaptiveToolResponseMaxChars,
  readCachedToolResponseChunk,
  resolveToolResponseChunkTtlMs,
  shouldChunkDispatchedToolResponse,
} from "./routes/gptToolsRoutes.js";

function createFakeChunkPool() {
  const rows = new Map();
  const state = { ttl_update_count: 0 };
  return {
    rows,
    state,
    async query(sql, params = []) {
      if (sql.includes("INSERT INTO governed_tool_response_chunks")) {
        const [
          chunkId,
          sourceToolKey,
          hash,
          bytes,
          serialized,
          cursorPolicy,
          redactionStatus,
          ownerTenantId,
          ownerUserId,
          ownerWorkspaceId,
          ownerPrincipalType,
          ownerPrincipalId,
          sourceSurface,
          createdAtMs,
          expiresAt,
        ] = params;
        rows.set(chunkId, {
          chunk_id: chunkId,
          source_tool_key: sourceToolKey,
          response_sha256: hash,
          response_bytes: bytes,
          response_json: serialized,
          cursor_policy: cursorPolicy,
          redaction_status: redactionStatus,
          secrets_included: 0,
          owner_tenant_id: ownerTenantId,
          owner_user_id: ownerUserId,
          owner_workspace_id: ownerWorkspaceId,
          owner_principal_type: ownerPrincipalType,
          owner_principal_id: ownerPrincipalId,
          source_surface: sourceSurface,
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
        const [candidate, , chunkId, privileged, ownerTenantId, ownerUserId, ownerPrincipalType, ownerPrincipalId] = params;
        const row = rows.get(chunkId);
        if (!row) return [{ affectedRows: 0 }];
        const ownerMatches = Number(privileged || 0) === 1 || (
          row.owner_tenant_id === ownerTenantId
          && row.owner_user_id === ownerUserId
          && row.owner_principal_type === ownerPrincipalType
          && row.owner_principal_id === ownerPrincipalId
        );
        if (!ownerMatches) return [{ affectedRows: 0 }];
        state.ttl_update_count += 1;
        if (new Date(candidate).getTime() > new Date(row.expires_at).getTime()) row.expires_at = new Date(candidate);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in fake pool: ${sql.slice(0, 100)}`);
    },
  };
}

async function main() {
  const now = Date.parse("2026-06-18T20:00:00.000Z");
  const pool = createFakeChunkPool();
  const deps = { pool, now };
  const tenantA = { tenant_id: "tenant-a", user_id: "user-a", workspace_id: "workspace-a" };
  const tenantB = { tenant_id: "tenant-b", user_id: "user-b", workspace_id: "workspace-b" };
  const admin = { is_admin: true, user_id: "admin-user" };
  const largeBody = {
    ok: true,
    items: Array.from({ length: 200 }, (_, index) => ({
      id: index,
      text: `استجابة-${index}-🌍-${"x".repeat(120)}`,
    })),
  };

  const firstChunk = await maybeChunkToolResponseBody(largeBody, {
    response_options: { max_chars: 5000 },
    source_tool_key: "test_response_chunking",
    auth: tenantA,
  }, deps);

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
  assert.equal(firstChunk.cache.durable, true);
  assert.equal(firstChunk.cache.cursor_policy, "utf16_code_unit_cursor_v1");
  assert.match(firstChunk.cache.response_sha256, /^[0-9a-f]{64}$/);
  assert.ok(pool.rows.has(firstChunk.chunk_id), "SQL persistence must complete before chunk_id is returned");
  const initialExpiry = new Date(pool.rows.get(firstChunk.chunk_id).expires_at).getTime();
  await assert.rejects(
    () => readCachedToolResponseChunk({
      chunk_id: firstChunk.chunk_id,
      cursor: 0,
      max_chars: 5000,
      auth: tenantB,
    }, { pool, now: now + 500 }),
    (err) => err?.status === 404 && err?.code === "response_chunk_not_found",
  );
  assert.equal(new Date(pool.rows.get(firstChunk.chunk_id).expires_at).getTime(), initialExpiry);
  assert.equal(pool.state.ttl_update_count, 0, "cross-tenant memory denial must not extend durable TTL");

  const ownerMemoryRead = await readCachedToolResponseChunk({
    chunk_id: firstChunk.chunk_id,
    cursor: 0,
    max_chars: 5000,
    auth: tenantA,
  }, { pool, now: now + 750 });
  assert.equal(ownerMemoryRead.source, "tool_response_cache");
  assert.equal(ownerMemoryRead.cache.read_count, 1, "denied reads must not increment memory read count");
  assert.equal(pool.state.ttl_update_count, 1);

  const requestedTtl = resolveToolResponseChunkTtlMs({ response_options: { max_chars: 5000, chunk_ttl_minutes: 45 } }, JSON.stringify(largeBody).length);
  assert.ok(requestedTtl >= 45 * 60 * 1000);

  assert.equal(shouldChunkDispatchedToolResponse("response_chunk_read"), false);
  assert.equal(shouldChunkDispatchedToolResponse("activation_awareness_read_api"), true);

  const topLevelChunk = await maybeChunkToolResponseBody(largeBody, {
    max_response_chars: 5000,
    chunk_ttl_minutes: 45,
    source_tool_key: "test_top_level_response_chunking",
    auth: tenantA,
  }, deps);
  assert.equal(topLevelChunk.response_chunked, true, "top-level response options must be honored");
  assert.ok(topLevelChunk.cache.ttl_ms >= 45 * 60 * 1000);

  assert.equal(evictToolResponseChunkMemoryCache(firstChunk.chunk_id), true);
  const ttlUpdatesBeforeDurableDenial = pool.state.ttl_update_count;
  await assert.rejects(
    () => readCachedToolResponseChunk({
      chunk_id: firstChunk.chunk_id,
      cursor: 0,
      max_chars: 5000,
      auth: tenantB,
    }, { pool, now: now + 900 }),
    (err) => err?.status === 404 && err?.code === "response_chunk_not_found",
  );
  assert.equal(pool.state.ttl_update_count, ttlUpdatesBeforeDurableDenial);

  const recoveredFirstChunk = await readCachedToolResponseChunk({
    chunk_id: firstChunk.chunk_id,
    cursor: 0,
    max_chars: 5000,
    auth: tenantA,
  }, { pool, now: now + 1000 });
  assert.equal(recoveredFirstChunk.source, "governed_tool_response_chunk_store");
  assert.equal(recoveredFirstChunk.chunk, firstChunk.chunk);
  assert.equal(recoveredFirstChunk.cache.durable, true);

  const secondChunk = await readCachedToolResponseChunk({
    chunk_id: firstChunk.chunk_id,
    cursor: recoveredFirstChunk.page.next_cursor,
    max_chars: 5000,
    auth: tenantA,
  }, { pool, now: now + 2000 });

  assert.equal(secondChunk.response_chunked, true);
  assert.equal(secondChunk.chunk_id, firstChunk.chunk_id);
  assert.equal(secondChunk.page.cursor, recoveredFirstChunk.page.next_cursor);
  assert.ok(secondChunk.chunk.length <= 5000);
  assert.ok(secondChunk.cache.read_count >= 2);
  assert.equal(secondChunk.cache.extended_on_read, true);

  const adminRead = await readCachedToolResponseChunk({
    chunk_id: firstChunk.chunk_id,
    cursor: 0,
    max_chars: 5000,
    auth: admin,
  }, { pool, now: now + 2500 });
  assert.equal(adminRead.chunk_id, firstChunk.chunk_id);

  const ttlUpdatesBeforeUnresolvedRead = pool.state.ttl_update_count;
  await assert.rejects(
    () => readCachedToolResponseChunk({
      chunk_id: firstChunk.chunk_id,
      cursor: 0,
      max_chars: 5000,
    }, { pool, now: now + 2600 }),
    (err) => err?.status === 404 && err?.code === "response_chunk_not_found",
  );
  assert.equal(pool.state.ttl_update_count, ttlUpdatesBeforeUnresolvedRead);

  let reconstructed = "";
  let cursor = 0;
  do {
    const page = await readCachedToolResponseChunk({
      chunk_id: firstChunk.chunk_id,
      cursor,
      max_chars: 5000,
      auth: tenantA,
    }, { pool, now: now + 3000 + cursor });
    reconstructed += page.chunk;
    cursor = page.page.next_cursor;
  } while (cursor !== null);
  assert.equal(reconstructed, JSON.stringify(largeBody), "UTF-16 cursor slices must reconstruct Unicode JSON exactly");

  const smallBody = { ok: true, value: "small" };
  assert.deepEqual(await maybeChunkToolResponseBody(smallBody, { response_options: { max_chars: 5000 } }, deps), smallBody);

  const existingChunkEnvelope = {
    ok: true,
    response_chunked: true,
    chunk_id: firstChunk.chunk_id,
    source: "tool_response_auto_chunk",
    continuation_required: true,
    continuation: firstChunk.continuation,
    page: firstChunk.page,
    cache: firstChunk.cache,
    chunk: firstChunk.chunk,
  };
  assert.equal(isGovernedToolResponseChunkEnvelope(existingChunkEnvelope), true);
  assert.equal(
    await maybeChunkToolResponseBody(existingChunkEnvelope, { response_options: { max_chars: 10 } }, deps),
    existingChunkEnvelope,
    "already chunked governed envelopes must not be re-chunked into nested chunk payloads",
  );
  assert.equal(shouldChunkDispatchedToolResponse("github_rest_endpoint_dispatch", existingChunkEnvelope), false);

  assert.equal(resolveAdaptiveToolResponseMaxChars({ max_chars: 150000 }), 45000);
  assert.equal(
    resolveAdaptiveToolResponseMaxChars({ max_chars: 150000, client_response_budget_chars: 60000, response_envelope_overhead_chars: 12000 }),
    48000,
    "requested chunks must be clamped to the effective client budget minus response envelope overhead",
  );
  assert.equal(resolveAdaptiveToolResponseMaxChars({ max_chars: 4000 }), 5000);

  const paged = paginateItems([
    { name: "alpha_tool", tags: ["repo"] },
    { name: "beta_tool", tags: ["repo", "git"] },
    { name: "gamma", tags: ["other"] },
  ], { limit: 1, cursor: 1, q: "tool", tag: "repo" });

  assert.equal(paged.items.length, 1);
  assert.equal(paged.items[0].name, "beta_tool");
  assert.equal(paged.page.total_count, 2);
  assert.equal(paged.page.has_more, false);

  const multiTerm = paginateItems([
    { name: "activation_platform_access", description: "Activation counts and scope", tags: ["activation"] },
    { name: "activation_dynamic_tab_detail_read_api", description: "Operational task, connector, and skill tab details", tags: ["activation", "operational"] },
    { name: "unrelated_tool", description: "Unrelated capability", tags: ["other"] },
  ], { q: "activation operational tasks connectors skills", limit: 10 });

  assert.equal(multiTerm.page.total_count, 2);
  assert.ok(multiTerm.items.some((item) => item.name === "activation_dynamic_tab_detail_read_api"));
  assert.ok(multiTerm.items.every((item) => item.name !== "unrelated_tool"));

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
  assert.ok(systemLayerRoutes.includes("await readCachedToolResponseChunk(args)"), "system layer chunk reads must await durable recovery");
  assert.ok(systemLayerRoutes.includes("buildSystemToolsListResponse"), "system layer tools list must be bounded and page-aware");
  assert.ok(systemLayerRoutes.includes("bounded_paginated_chunkable"), "system layer tools list must advertise bounded chunkable mode");
  assert.ok(systemLayerRoutes.includes("chunk_ttl_minutes"), "system layer must expose controllable chunk TTL options");

  const continuationMigrationName = "232_sprint68_chunked_tool_response_continuation_policy.sql";
  const continuationMigration = readFileSync(`migrations/${continuationMigrationName}`, "utf8");
  const durableMigration = readFileSync("migrations/20260618_governed_tool_response_chunks.sql", "utf8");
  const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
  const readiness = readFileSync("releaseReadiness.js", "utf8");
  assert.ok(continuationMigration.includes("Chunked Tool Response Continuation Contract"));
  assert.ok(continuationMigration.includes("chunk_read_before_alternative_surface"));
  assert.ok(continuationMigration.includes("response_chunk_read"));
  assert.ok(continuationMigration.includes("only_then_use_secondary_search_slice_or_external_fallback"));
  assert.ok(continuationMigration.includes("claim_file_too_large_without_attempting_response_chunk_read"));
  assert.ok(runner.includes(continuationMigrationName), "governed migration runner must allow migration 232");
  assert.ok(readiness.includes(continuationMigrationName), "release readiness must track migration 232");
  assert.ok(durableMigration.includes("CREATE TABLE IF NOT EXISTS governed_tool_response_chunks"));
  assert.ok(durableMigration.includes("utf8mb4"));
  assert.ok(durableMigration.includes("expires_at"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
