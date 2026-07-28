import assert from "node:assert/strict";
import {
  GOVERNED_RESPONSE_CHUNK_CURSOR_POLICY,
  extendGovernedToolResponseChunkExpiry,
  loadGovernedToolResponseChunk,
  persistGovernedToolResponseChunk,
  sha256ResponseChunk,
} from "./governedToolResponseChunkStore.js";

const PRIVILEGED_TYPES = new Set(["admin", "backend_service", "trusted_internal"]);

function sameOwner(row, incoming) {
  return row.owner_tenant_id === incoming.owner_tenant_id
    && row.owner_user_id === incoming.owner_user_id
    && row.owner_principal_type === incoming.owner_principal_type
    && row.owner_principal_id === incoming.owner_principal_id;
}

function createFakePool() {
  const rows = new Map();
  return {
    rows,
    async query(sql, params = []) {
      if (sql.includes("INSERT INTO governed_tool_response_chunks")) {
        const [
          chunkId, sourceToolKey, hash, bytes, serialized, cursorPolicy, redactionStatus,
          ownerTenantId, ownerUserId, ownerWorkspaceId, ownerPrincipalType,
          ownerPrincipalId, sourceSurface, createdAtMs, expiresAt,
        ] = params;
        const incoming = {
          owner_tenant_id: ownerTenantId,
          owner_user_id: ownerUserId,
          owner_workspace_id: ownerWorkspaceId,
          owner_principal_type: ownerPrincipalType,
          owner_principal_id: ownerPrincipalId,
          source_surface: sourceSurface,
        };
        const existing = rows.get(chunkId);
        if (!existing) {
          rows.set(chunkId, {
            chunk_id: chunkId,
            source_tool_key: sourceToolKey,
            response_sha256: hash,
            response_bytes: bytes,
            response_json: serialized,
            cursor_policy: cursorPolicy,
            redaction_status: redactionStatus,
            secrets_included: 0,
            ...incoming,
            created_at: new Date(createdAtMs),
            expires_at: new Date(expiresAt),
          });
          return [{ affectedRows: 1 }];
        }
        if (PRIVILEGED_TYPES.has(ownerPrincipalType) || sameOwner(existing, incoming)) {
          Object.assign(existing, {
            source_tool_key: sourceToolKey,
            response_sha256: hash,
            response_bytes: bytes,
            response_json: serialized,
            cursor_policy: cursorPolicy,
            redaction_status: redactionStatus,
            source_surface: sourceSurface,
            expires_at: new Date(expiresAt),
          });
          return [{ affectedRows: 2 }];
        }
        return [{ affectedRows: 0 }];
      }
      if (sql.includes("FROM governed_tool_response_chunks") && sql.includes("WHERE chunk_id = ?")) {
        const row = rows.get(params[0]);
        return [[...(row ? [row] : [])]];
      }
      if (sql.includes("UPDATE governed_tool_response_chunks")) {
        const [candidate, , chunkId, privileged, ownerTenantId, ownerUserId, ownerPrincipalType, ownerPrincipalId] = params;
        const row = rows.get(chunkId);
        if (!row) return [{ affectedRows: 0 }];
        const authorized = Number(privileged) === 1 || sameOwner(row, {
          owner_tenant_id: ownerTenantId,
          owner_user_id: ownerUserId,
          owner_principal_type: ownerPrincipalType,
          owner_principal_id: ownerPrincipalId,
        });
        if (!authorized) return [{ affectedRows: 0 }];
        if (new Date(candidate).getTime() > new Date(row.expires_at).getTime()) row.expires_at = new Date(candidate);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in fake pool: ${sql.slice(0, 120)}`);
    },
  };
}

const now = Date.parse("2026-06-18T20:00:00.000Z");
const pool = createFakePool();
const tenantA = { tenant_id: "tenant-a", user_id: "user-a", workspace_id: "workspace-a" };
const tenantB = { tenant_id: "tenant-b", user_id: "user-b", workspace_id: "workspace-b" };
const admin = { is_admin: true, user_id: "admin-1" };
const backend = { mode: "backend_api_key", principal_id: "response-chunk-test-service" };
const chunkId = "11111111-2222-4333-8444-555555555555";
const serialized = JSON.stringify({ message: "مرحبا بالعالم 🌍", nested: ["😀", "بيانات"] });

const persisted = await persistGovernedToolResponseChunk({
  chunk_id: chunkId,
  serialized,
  ttl_ms: 10 * 60 * 1000,
  source_tool_key: "test_unicode_response",
  source_surface: "test_suite",
  auth: tenantA,
}, { pool, now });
assert.equal(persisted.cursor_policy, GOVERNED_RESPONSE_CHUNK_CURSOR_POLICY);
assert.equal(persisted.response_sha256, sha256ResponseChunk(serialized));
assert.equal(persisted.response_bytes, Buffer.byteLength(serialized, "utf8"));
assert.equal(pool.rows.get(chunkId).owner_tenant_id, "tenant-a");
assert.equal(pool.rows.get(chunkId).owner_user_id, "user-a");
assert.equal(pool.rows.get(chunkId).owner_principal_type, "tenant_user");

const loaded = await loadGovernedToolResponseChunk({ chunk_id: chunkId, auth: tenantA }, { pool, now: now + 1000 });
assert.equal(loaded.serialized, serialized);
assert.equal(loaded.response_sha256, persisted.response_sha256);
assert.equal(loaded.response_bytes, Buffer.byteLength(serialized, "utf8"));
assert.equal(loaded.owner_tenant_id, "tenant-a");

const crossTenantLoad = await loadGovernedToolResponseChunk({ chunk_id: chunkId, auth: tenantB }, { pool, now: now + 1000 });
assert.equal(crossTenantLoad, null, "cross-tenant durable reads must be indistinguishable from missing chunks");

const beforeUnauthorizedExtend = new Date(pool.rows.get(chunkId).expires_at).toISOString();
const unauthorizedExtend = await extendGovernedToolResponseChunkExpiry(
  { chunk_id: chunkId, ttl_ms: 20 * 60 * 1000, auth: tenantB },
  { pool, now: now + 2000 },
);
assert.equal(unauthorizedExtend.extended, false);
assert.equal(new Date(pool.rows.get(chunkId).expires_at).toISOString(), beforeUnauthorizedExtend);

await assert.rejects(
  persistGovernedToolResponseChunk({
    chunk_id: chunkId,
    serialized: JSON.stringify({ overwritten: true }),
    ttl_ms: 300000,
    auth: tenantB,
  }, { pool, now: now + 3000 }),
  (err) => err.code === "response_chunk_not_found" && err.status === 404,
);
assert.equal(pool.rows.get(chunkId).response_json, serialized, "cross-tenant overwrite must not mutate the stored response");

await extendGovernedToolResponseChunkExpiry(
  { chunk_id: chunkId, ttl_ms: 20 * 60 * 1000, auth: tenantA },
  { pool, now: now + 2000 },
);
assert.equal(new Date(pool.rows.get(chunkId).expires_at).toISOString(), new Date(now + 2000 + 20 * 60 * 1000).toISOString());

const adminLoaded = await loadGovernedToolResponseChunk({ chunk_id: chunkId, auth: admin }, { pool, now: now + 1000 });
assert.equal(adminLoaded.serialized, serialized);

const legacyId = "22222222-3333-4444-8555-666666666666";
pool.rows.set(legacyId, {
  chunk_id: legacyId,
  source_tool_key: "legacy",
  response_sha256: sha256ResponseChunk(serialized),
  response_bytes: Buffer.byteLength(serialized, "utf8"),
  response_json: serialized,
  cursor_policy: GOVERNED_RESPONSE_CHUNK_CURSOR_POLICY,
  redaction_status: "redacted_or_non_secret",
  secrets_included: 0,
  owner_tenant_id: null,
  owner_user_id: null,
  owner_workspace_id: null,
  owner_principal_type: null,
  owner_principal_id: null,
  source_surface: null,
  created_at: new Date(now),
  expires_at: new Date(now + 300000),
});
assert.equal(await loadGovernedToolResponseChunk({ chunk_id: legacyId, auth: tenantA }, { pool, now: now + 1 }), null);
assert.equal((await loadGovernedToolResponseChunk({ chunk_id: legacyId, auth: backend }, { pool, now: now + 1 })).serialized, serialized);

await assert.rejects(
  persistGovernedToolResponseChunk({ chunk_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", serialized, ttl_ms: 300000 }, { pool, now }),
  (err) => err.code === "response_chunk_owner_required" && err.status === 403,
);
await assert.rejects(
  persistGovernedToolResponseChunk({ chunk_id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", serialized, ttl_ms: 300000, secrets_included: true, auth: tenantA }, { pool, now }),
  (err) => err.code === "response_chunk_secret_policy_failed" && err.status === 403,
);

const tamperedId = "99999999-8888-4777-8666-555555555555";
await persistGovernedToolResponseChunk({ chunk_id: tamperedId, serialized, ttl_ms: 300000, auth: tenantA }, { pool, now });
pool.rows.get(tamperedId).response_json = `${serialized}tampered`;
await assert.rejects(
  loadGovernedToolResponseChunk({ chunk_id: tamperedId, auth: tenantA }, { pool, now: now + 1 }),
  (err) => err.code === "response_chunk_integrity_failed" && err.status === 500,
);

const expiredId = "12121212-3434-4567-8989-101010101010";
await persistGovernedToolResponseChunk({ chunk_id: expiredId, serialized, ttl_ms: 300000, auth: tenantA }, { pool, now });
await assert.rejects(
  loadGovernedToolResponseChunk({ chunk_id: expiredId, auth: tenantA }, { pool, now: now + 300000 }),
  (err) => err.code === "response_chunk_expired" && err.status === 410,
);

const failingPool = { async query() { const err = new Error("db down"); err.code = "ECONNREFUSED"; throw err; } };
await assert.rejects(
  persistGovernedToolResponseChunk({
    chunk_id: "abababab-cdcd-4efe-8123-456789abcdef",
    serialized,
    ttl_ms: 300000,
    auth: tenantA,
  }, { pool: failingPool, now }),
  (err) => err.code === "response_chunk_persistence_unavailable" && err.status === 503,
);

console.log("governed tool response chunk store ownership tests passed");
