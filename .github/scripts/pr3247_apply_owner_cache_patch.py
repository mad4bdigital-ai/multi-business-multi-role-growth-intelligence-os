from pathlib import Path

ROUTE_PATH = Path("http-generic-api/routes/gptToolsRoutes.js")
TEST_PATH = Path("http-generic-api/test-gpt-tools-response-chunking.mjs")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        if old in text:
            raise SystemExit(f"{label}: both old and new forms are present")
        return text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one exact match, found {count}")
    return text.replace(old, new, 1)


def replace_section(text: str, start: str, end: str, new_section: str, label: str, applied_marker: str) -> str:
    if applied_marker in text:
        return text
    start_count = text.count(start)
    end_count = text.count(end)
    if start_count != 1 or end_count != 1:
        raise SystemExit(f"{label}: boundary mismatch start={start_count} end={end_count}")
    start_index = text.index(start)
    end_index = text.index(end, start_index)
    return text[:start_index] + new_section.rstrip() + "\n\n" + text[end_index:]


route_original = ROUTE_PATH.read_text(encoding="utf-8")
route = route_original

new_store = '''async function storeToolResponseForChunks(body, optionsSource = {}, deps = {}) {
  const now = toolResponseChunkNow(deps);
  cleanupToolResponseChunkCache(now);
  const serialized = JSON.stringify(body ?? {});
  const ttlMs = resolveToolResponseChunkTtlMs(optionsSource, serialized.length);
  const chunkId = crypto.randomUUID();
  const principalInput = {
    auth: optionsSource?.auth,
    trustedInternal: optionsSource?.trustedInternal === true || optionsSource?.trusted_internal === true,
    principalId: optionsSource?.principalId || optionsSource?.principal_id,
    source_surface: optionsSource?.source_surface || optionsSource?.sourceSurface || "gpt_tools",
  };
  const principal = resolveGovernedResponseChunkPrincipal(principalInput);
  if (!principal) {
    const err = new Error("A governed response chunk owner is required.");
    err.status = 403;
    err.code = "response_chunk_owner_required";
    throw err;
  }
  const owner = governedResponseChunkOwnerFields(principal);
  const durable = await persistGovernedToolResponseChunk({
    chunk_id: chunkId,
    serialized,
    ttl_ms: ttlMs,
    source_tool_key: optionsSource?.source_tool_key || optionsSource?.tool_key || optionsSource?.name || null,
    cursor_policy: GOVERNED_RESPONSE_CHUNK_CURSOR_POLICY,
    secrets_included: false,
    ...principalInput,
  }, deps);
  TOOL_RESPONSE_CHUNK_CACHE.set(chunkId, {
    serialized,
    createdAt: now,
    lastReadAt: now,
    ttlMs,
    expiresAt: new Date(durable.expires_at).getTime(),
    readCount: 0,
    durable: true,
    cursorPolicy: durable.cursor_policy,
    responseSha256: durable.response_sha256,
    ...owner,
  });
  return { chunkId, serialized, ttlMs, expiresAt: new Date(durable.expires_at).getTime() };
}'''

route = replace_section(
    route,
    "async function storeToolResponseForChunks(body, optionsSource = {}, deps = {}) {",
    "export function isGovernedToolResponseChunkEnvelope(body = {}) {",
    new_store,
    "storeToolResponseForChunks",
    "const principal = resolveGovernedResponseChunkPrincipal(principalInput);",
)

new_read = '''export async function readCachedToolResponseChunk(args = {}, deps = {}) {
  const chunkId = String(args.chunk_id || "").trim();
  if (!chunkId) {
    const err = new Error("chunk_id is required.");
    err.status = 400;
    err.code = "missing_chunk_id";
    throw err;
  }
  const principalInput = {
    auth: args?.auth,
    trustedInternal: args?.trustedInternal === true || args?.trusted_internal === true,
    principalId: args?.principalId || args?.principal_id,
    source_surface: args?.source_surface || args?.sourceSurface || "gpt_tools",
  };
  const principal = resolveGovernedResponseChunkPrincipal(principalInput);
  const notFound = () => {
    const err = new Error("response chunk was not found or has expired.");
    err.status = 404;
    err.code = "response_chunk_not_found";
    return err;
  };
  if (!principal) throw notFound();

  const now = toolResponseChunkNow(deps);
  cleanupToolResponseChunkCache(now);
  let entry = TOOL_RESPONSE_CHUNK_CACHE.get(chunkId);
  let source = "tool_response_cache";
  if (entry && !canAccessGovernedResponseChunk(principal, entry)) throw notFound();
  if (!entry) {
    const durable = await loadGovernedToolResponseChunk({
      chunk_id: chunkId,
      ...principalInput,
    }, deps);
    if (!durable || !canAccessGovernedResponseChunk(principal, durable)) throw notFound();
    entry = {
      serialized: durable.serialized,
      createdAt: durable.created_at ? new Date(durable.created_at).getTime() : now,
      lastReadAt: now,
      ttlMs: Math.max(1, new Date(durable.expires_at).getTime() - now),
      expiresAt: new Date(durable.expires_at).getTime(),
      readCount: 0,
      durable: true,
      cursorPolicy: durable.cursor_policy,
      responseSha256: durable.response_sha256,
      owner_tenant_id: durable.owner_tenant_id,
      owner_user_id: durable.owner_user_id,
      owner_workspace_id: durable.owner_workspace_id,
      owner_principal_type: durable.owner_principal_type,
      owner_principal_id: durable.owner_principal_id,
      source_surface: durable.source_surface,
    };
    source = "governed_tool_response_chunk_store";
  }
  const options = normalizeResponseOptions(args);
  const ttlMs = resolveToolResponseChunkTtlMs(args, entry.serialized.length);
  entry.ttlMs = Math.max(Number(entry.ttlMs || 0), ttlMs);
  entry.lastReadAt = now;
  entry.readCount = Number(entry.readCount || 0) + 1;
  entry.expiresAt = now + entry.ttlMs;
  await extendGovernedToolResponseChunkExpiry({
    chunk_id: chunkId,
    ttl_ms: entry.ttlMs,
    ...principalInput,
  }, deps);
  TOOL_RESPONSE_CHUNK_CACHE.set(chunkId, entry);
  return buildToolResponseChunk({
    serialized: entry.serialized,
    chunkId,
    cursor: options.cursor,
    maxChars: options.maxChars,
    source,
  });
}'''

route = replace_section(
    route,
    "export async function readCachedToolResponseChunk(args = {}, deps = {}) {",
    "export function paginateItems(items = [], query = {}) {",
    new_read,
    "readCachedToolResponseChunk",
    "if (entry && !canAccessGovernedResponseChunk(principal, entry)) throw notFound();",
)

route = replace_once(
    route,
    '''      ? await maybeChunkToolResponseBody(result?.body, {
          ...responseOptions,
          source_tool_key: toolKey,
        })''',
    '''      ? await maybeChunkToolResponseBody(result?.body, {
          ...responseOptions,
          auth: req?.auth || null,
          source_tool_key: toolKey,
          source_surface: "gpt_tools_dispatch",
        })''',
    "dispatch chunk auth",
)

route = replace_once(
    route,
    '''  if (callerType === "admin" && toolKey === "response_chunk_read") {
    return { status: 200, body: await readCachedToolResponseChunk(args) };
  }''',
    '''  if (callerType === "admin" && toolKey === "response_chunk_read") {
    return {
      status: 200,
      body: await readCachedToolResponseChunk({
        ...(args || {}),
        auth: req?.auth || null,
        source_surface: "gpt_tools_admin_response_chunk_read",
      }),
    };
  }''',
    "admin chunk read auth",
)

route = replace_once(
    route,
    '''      return res.status(200).json(await maybeChunkToolResponseBody(body, {
        response_options: req.query || {},
        source_tool_key: "gpt_tools_list",
      }));''',
    '''      return res.status(200).json(await maybeChunkToolResponseBody(body, {
        response_options: req.query || {},
        auth: req?.auth || null,
        source_tool_key: "gpt_tools_list",
        source_surface: "gpt_tools_list",
      }));''',
    "tools list chunk auth",
)

test_original = TEST_PATH.read_text(encoding="utf-8")
test = test_original

old_pool = '''function createFakeChunkPool() {
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
      throw new Error(`Unexpected SQL in fake pool: ${sql.slice(0, 100)}`);
    },
  };
}'''

new_pool = '''function createFakeChunkPool() {
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
}'''
test = replace_once(test, old_pool, new_pool, "fake chunk pool")

test = replace_once(
    test,
    '''  const deps = { pool, now };
  const largeBody = {''',
    '''  const deps = { pool, now };
  const tenantA = { tenant_id: "tenant-a", user_id: "user-a", workspace_id: "workspace-a" };
  const tenantB = { tenant_id: "tenant-b", user_id: "user-b", workspace_id: "workspace-b" };
  const admin = { is_admin: true, user_id: "admin-user" };
  const largeBody = {''',
    "test principals",
)

test = replace_once(
    test,
    '''    source_tool_key: "test_response_chunking",
  }, deps);''',
    '''    source_tool_key: "test_response_chunking",
    auth: tenantA,
  }, deps);''',
    "first chunk owner",
)

test = replace_once(
    test,
    '''  assert.ok(pool.rows.has(firstChunk.chunk_id), "SQL persistence must complete before chunk_id is returned");

  const requestedTtl''',
    '''  assert.ok(pool.rows.has(firstChunk.chunk_id), "SQL persistence must complete before chunk_id is returned");
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

  const requestedTtl''',
    "memory cross-tenant regression",
)

test = replace_once(
    test,
    '''    source_tool_key: "test_top_level_response_chunking",
  }, deps);''',
    '''    source_tool_key: "test_top_level_response_chunking",
    auth: tenantA,
  }, deps);''',
    "top-level chunk owner",
)

test = replace_once(
    test,
    '''  assert.equal(evictToolResponseChunkMemoryCache(firstChunk.chunk_id), true);
  const recoveredFirstChunk = await readCachedToolResponseChunk({
    chunk_id: firstChunk.chunk_id,
    cursor: 0,
    max_chars: 5000,
  }, { pool, now: now + 1000 });
  assert.equal(recoveredFirstChunk.source, "governed_tool_response_chunk_store");
  assert.equal(recoveredFirstChunk.chunk, firstChunk.chunk);
  assert.equal(recoveredFirstChunk.cache.durable, true);''',
    '''  assert.equal(evictToolResponseChunkMemoryCache(firstChunk.chunk_id), true);
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
  assert.equal(recoveredFirstChunk.cache.durable, true);''',
    "durable cross-tenant regression",
)

test = replace_once(
    test,
    '''    cursor: recoveredFirstChunk.page.next_cursor,
    max_chars: 5000,
  }, { pool, now: now + 2000 });''',
    '''    cursor: recoveredFirstChunk.page.next_cursor,
    max_chars: 5000,
    auth: tenantA,
  }, { pool, now: now + 2000 });''',
    "second chunk owner",
)

test = replace_once(
    test,
    '''  assert.equal(secondChunk.cache.extended_on_read, true);

  let reconstructed''',
    '''  assert.equal(secondChunk.cache.extended_on_read, true);

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

  let reconstructed''',
    "admin and unresolved read regression",
)

test = replace_once(
    test,
    '''      cursor,
      max_chars: 5000,
    }, { pool, now: now + 3000 + cursor });''',
    '''      cursor,
      max_chars: 5000,
      auth: tenantA,
    }, { pool, now: now + 3000 + cursor });''',
    "reconstruction owner",
)

if route == route_original and test == test_original:
    raise SystemExit("owner-cache patch produced no changes")

ROUTE_PATH.write_text(route, encoding="utf-8")
TEST_PATH.write_text(test, encoding="utf-8")
print("PR3247 owner-cache patch applied")
