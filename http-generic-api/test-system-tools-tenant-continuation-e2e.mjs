import assert from "node:assert/strict";
import express from "express";
import mysql from "mysql2/promise";
import { buildSystemLayerRoutes } from "./routes/systemLayerRoutes.js";
import { GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS } from "./governedToolResponseChunkStore.js";

const DB_ENV_KEYS = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];
const originalDbEnv = new Map(DB_ENV_KEYS.map((key) => [key, process.env[key]]));
for (const key of DB_ENV_KEYS) process.env[key] = `system-tools-continuation-${key.toLowerCase()}`;

const originalCreatePool = mysql.createPool;
const chunkRows = new Map();
const fakePool = {
  async query(sql, params = []) {
    const statement = String(sql);
    if (/information_schema\.columns/i.test(statement) && /governed_tool_response_chunks/i.test(statement)) {
      return [GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS.map((column_name) => ({ column_name }))];
    }
    if (/INSERT INTO governed_tool_response_chunks/i.test(statement)) {
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
      chunkRows.set(chunkId, {
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
    if (/FROM governed_tool_response_chunks/i.test(statement) && /WHERE chunk_id = \?/i.test(statement)) {
      const row = chunkRows.get(params[0]);
      return [[...(row ? [row] : [])]];
    }
    if (/UPDATE governed_tool_response_chunks/i.test(statement)) {
      const [candidate, , chunkId, privileged, ownerTenantId, ownerUserId, ownerWorkspaceId, ownerPrincipalType, ownerPrincipalId] = params;
      const row = chunkRows.get(chunkId);
      if (!row) return [{ affectedRows: 0 }];
      const ownerMatches = Number(privileged || 0) === 1 || (
        row.owner_tenant_id === ownerTenantId
        && row.owner_user_id === ownerUserId
        && row.owner_workspace_id === ownerWorkspaceId
        && row.owner_principal_type === ownerPrincipalType
        && row.owner_principal_id === ownerPrincipalId
      );
      if (!ownerMatches) return [{ affectedRows: 0 }];
      if (new Date(candidate).getTime() > new Date(row.expires_at).getTime()) row.expires_at = new Date(candidate);
      return [{ affectedRows: 1 }];
    }
    if (/^\s*SELECT\b/i.test(statement)) return [[]];
    throw new Error(`Unexpected SQL in system tools continuation regression: ${statement.slice(0, 180)}`);
  },
};
mysql.createPool = () => fakePool;

function authForRequest(req) {
  if (req.headers["x-test-admin"] === "1") {
    return {
      mode: "admin_test_principal",
      is_admin: true,
      user_id: "admin-4451",
      principal_type: "platform_admin_service",
      principal_id: "admin-4451",
    };
  }
  const tenantId = String(req.headers["x-test-tenant"] || "tenant-4451");
  return {
    mode: "user_jwt",
    is_admin: false,
    tenant_id: tenantId,
    user_id: `user-${tenantId}`,
    workspace_id: `workspace-${tenantId}`,
    principal_type: "user",
    principal_id: `user-${tenantId}`,
  };
}

const app = express();
app.use(express.json());
app.use(buildSystemLayerRoutes({
  requireBackendApiKey: (req, _res, next) => {
    req.auth = authForRequest(req);
    next();
  },
  executionFacade: null,
}));

const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

async function requestJson(path, { method = "GET", body, tenant = "tenant-4451", admin = false } = {}) {
  const headers = {
    "content-type": "application/json",
    "x-test-tenant": tenant,
    ...(admin ? { "x-test-admin": "1" } : {}),
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function reconstructChunkedEnvelope(envelope, { tenant = "tenant-4451", admin = false } = {}) {
  if (envelope?.response_chunked !== true) return envelope;
  let serialized = String(envelope.chunk || "");
  let cursor = envelope?.page?.next_cursor;
  let hasMore = envelope?.page?.has_more === true;
  while (hasMore) {
    const next = await requestJson("/system/tools/call", {
      method: "POST",
      tenant,
      admin,
      body: {
        name: "response_chunk_read",
        tool_args: {
          chunk_id: envelope.chunk_id,
          cursor,
          max_chars: 5000,
        },
      },
    });
    assert.equal(next.status, 200, JSON.stringify(next.body));
    serialized += String(next.body.chunk || "");
    cursor = next.body?.page?.next_cursor;
    hasMore = next.body?.page?.has_more === true;
  }
  return JSON.parse(serialized);
}

const blockedTenantNames = new Set([
  "runtime_endpoint_call",
  "google_drive_endpoint_catalog",
  "google_drive_folder_inspect",
  "system_tools_list",
  "system_tools_read",
  "system_tools_search",
  "system_registry_read",
  "system_registry_search",
]);

try {
  const firstRaw = await requestJson("/system/tools?limit=7&max_chars=5000");
  assert.equal(firstRaw.status, 200, JSON.stringify(firstRaw.body));
  assert.equal(firstRaw.body.response_chunked, true, "bounded catalog page should exercise governed chunk continuation");
  assert.ok(firstRaw.body.chunk_id, "chunked system tool catalog response must return chunk_id");
  assert.ok(firstRaw.body.page?.next_cursor > 0, "chunked response must expose a continuation cursor");

  const crossTenant = await requestJson("/system/tools/call", {
    method: "POST",
    tenant: "tenant-other-4451",
    body: {
      name: "response_chunk_read",
      tool_args: {
        chunk_id: firstRaw.body.chunk_id,
        cursor: firstRaw.body.page.next_cursor,
        max_chars: 5000,
      },
    },
  });
  assert.equal(crossTenant.status, 404, JSON.stringify(crossTenant.body));
  assert.equal(crossTenant.body?.error?.code, "response_chunk_not_found", "chunk ownership must not leak across tenants");

  const allTenantNames = [];
  let catalogCursor = null;
  let pageCount = 0;
  let raw = firstRaw;
  while (true) {
    if (pageCount > 0) {
      const suffix = `?limit=7&max_chars=5000&cursor=${encodeURIComponent(catalogCursor)}`;
      raw = await requestJson(`/system/tools${suffix}`);
      assert.equal(raw.status, 200, JSON.stringify(raw.body));
    }
    const pageBody = await reconstructChunkedEnvelope(raw.body);
    assert.equal(pageBody?.principal?.mode, "user_jwt");
    assert.equal(pageBody?.principal?.is_admin, false);
    assert.equal(pageBody?.principal?.tenant_id, "tenant-4451");
    assert.ok(Array.isArray(pageBody.items));
    assert.ok(pageBody.items.length <= 7, `page exceeded requested limit: ${pageBody.items.length}`);
    for (const item of pageBody.items) {
      assert.ok(!blockedTenantNames.has(item.name), `tenant page leaked blocked/admin tool ${item.name}`);
      allTenantNames.push(item.name);
    }
    pageCount += 1;
    catalogCursor = pageBody?.page?.next_cursor || null;
    if (!catalogCursor) {
      assert.equal(pageBody?.page?.has_more, false);
      break;
    }
  }

  assert.ok(pageCount > 1, "tenant system tool catalog must be traversed through more than one bounded page");
  assert.ok(allTenantNames.length > 7, "tenant catalog traversal must enumerate beyond the first page");
  assert.equal(new Set(allTenantNames).size, allTenantNames.length, "cursor traversal must not duplicate tools");
  for (const name of blockedTenantNames) {
    assert.ok(!allTenantNames.includes(name), `blocked/admin tool ${name} must remain hidden across every tenant page`);
  }

  const adminRaw = await requestJson("/admin/system/tools?limit=200&max_chars=5000", { admin: true });
  assert.equal(adminRaw.status, 200, JSON.stringify(adminRaw.body));
  const adminBody = await reconstructChunkedEnvelope(adminRaw.body, { admin: true });
  const adminNames = new Set((adminBody.items || []).map((item) => item.name));
  assert.ok(adminNames.has("runtime_endpoint_call"), "admin catalog should retain an admin-only tool hidden from tenants");
  assert.ok(!allTenantNames.includes("runtime_endpoint_call"));
  assert.ok(chunkRows.size > 0, "test must prove real governed response chunk persistence was exercised");
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  mysql.createPool = originalCreatePool;
  for (const [key, value] of originalDbEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("tenant system tools pagination + governed chunk continuation E2E regression passed");
