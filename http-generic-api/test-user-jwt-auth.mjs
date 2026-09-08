import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import jwt from "jsonwebtoken";
import {
  createUserJwtMiddleware,
  issueUserTenantContextJwt,
  resolveUserTenantContextTtlSeconds,
  verifyUserJwtAuthorization,
} from "./userJwtAuth.js";
import { ensureFreshCredentials } from "./appAdapters/index.js";
import { encryptCredentials } from "./tokenEncryption.js";
import { addedLineViolations, hardenedFileViolations } from "./scripts/user-jwt-auth-governance.mjs";

function callMiddleware(middleware, { authorization = "", auth = null } = {}) {
  let status = null;
  let body = null;
  let nextCalled = false;
  const req = { headers: { authorization }, auth };
  const res = {
    status(value) { status = value; return this; },
    json(value) { body = value; return this; },
  };
  middleware(req, res, () => { nextCalled = true; });
  return { req, status, body, nextCalled };
}

{
  const middleware = createUserJwtMiddleware({ env: {} });
  const missing = callMiddleware(middleware);
  assert.equal(missing.status, 401);
  assert.equal(missing.body?.error?.code, "user_jwt_required");

  const unavailable = callMiddleware(middleware, { authorization: "Bearer token" });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body?.error?.code, "user_jwt_verifier_unavailable");
  assert.equal(unavailable.body?.secrets_included, false);
}

{
  const env = { JWT_SECRET: "test-user-jwt-secret" };
  const token = jwt.sign({ user_id: "user-1", tenant_id: "tenant-1", email: "u@example.com" }, env.JWT_SECRET, { algorithm: "HS256" });
  const accepted = callMiddleware(createUserJwtMiddleware({ env }), { authorization: `Bearer ${token}` });
  assert.equal(accepted.nextCalled, true);
  assert.equal(accepted.req.auth?.mode, "user_jwt");
  assert.equal(accepted.req.auth?.user_id, "user-1");
  assert.equal(accepted.req.auth?.tenant_id, "tenant-1");

  const wrongAlgorithm = jwt.sign({ user_id: "user-1" }, env.JWT_SECRET, { algorithm: "HS384" });
  const rejected = verifyUserJwtAuthorization(`Bearer ${wrongAlgorithm}`, { env });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 401);
}

{
  const trusted = callMiddleware(createUserJwtMiddleware({ env: {} }), {
    auth: { mode: "user_jwt", user_id: "upstream-user", tenant_id: null },
  });
  assert.equal(trusted.nextCalled, true);

  const incomplete = callMiddleware(createUserJwtMiddleware({ env: {} }), {
    auth: { mode: "user_jwt", user_id: "" },
  });
  assert.equal(incomplete.nextCalled, false);
  assert.equal(incomplete.status, 401);
}

// Tenant context TTL must be derived once from the parent session and reported
// truthfully by the active-context route. Missing parent expiry means the normal
// bounded context TTL; an expired or malformed parent fails closed.
{
  assert.equal(
    resolveUserTenantContextTtlSeconds({ parentExp: null, maxTtlSeconds: 3600 }, { nowSeconds: 1000 }),
    3600,
  );
  assert.equal(
    resolveUserTenantContextTtlSeconds({ parentExp: 1120, maxTtlSeconds: 3600 }, { nowSeconds: 1000 }),
    120,
  );
  assert.equal(
    resolveUserTenantContextTtlSeconds({ parentExp: 9000, maxTtlSeconds: 3600 }, { nowSeconds: 1000 }),
    3600,
  );

  assert.throws(
    () => resolveUserTenantContextTtlSeconds({ parentExp: 1000 }, { nowSeconds: 1000 }),
    (error) => error?.code === "tenant_context_parent_expired" && error?.status === 401,
  );
  assert.throws(
    () => resolveUserTenantContextTtlSeconds({ parentExp: "not-a-time" }, { nowSeconds: 1000 }),
    (error) => error?.code === "tenant_context_parent_expiry_invalid" && error?.status === 401,
  );

  let signingOptions = null;
  const issued = issueUserTenantContextJwt({
    userId: "user-ttl",
    tenantId: "tenant-ttl",
    parentExp: 1120,
    maxTtlSeconds: 3600,
  }, {
    env: { JWT_SECRET: "tenant-context-signing-secret-for-test" },
    nowSeconds: 1000,
    newId: () => "context-id",
    signToken: (_payload, _secret, options) => {
      signingOptions = options;
      return "signed-context-token";
    },
  });
  assert.equal(issued, "signed-context-token");
  assert.equal(signingOptions?.expiresIn, 120);

  const routeSource = readFileSync(new URL("./routes/tenantConnectionSelfRepairRoutes.js", import.meta.url), "utf8");
  assert.match(routeSource, /expires_in:\s*issued\.expires_in/u, "active-context response must expose the actual signed TTL");
}

// Provider refresh is a durable authority transition. The fresh credential may
// be returned only if the original connection snapshot wins a compare-and-swap.
// A concurrent disconnect/refresh therefore produces affectedRows=0 and fails
// closed instead of resurrecting status='active'.
{
  const originalEncryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = "11".repeat(32);
  try {
    const originalCiphertext = encryptCredentials({ access_token: "old-access", refresh_token: "refresh-1" });
    const connection = {
      connection_id: "connection-cas-1",
      app_key: "google_drive",
      encrypted_credentials: originalCiphertext,
      token_expires_at: "2000-01-01 00:00:00",
    };
    const adapter = {
      async refreshAccessToken() {
        return { access_token: "fresh-access", refresh_token: "refresh-2", expires_in: 3600 };
      },
    };

    const successQueries = [];
    const successPool = {
      async query(sql, params) {
        successQueries.push({ sql: String(sql), params });
        return [{ affectedRows: 1 }, []];
      },
    };
    const fresh = await ensureFreshCredentials(connection, { pool: successPool, adapter, oauthConfig: {} });
    assert.equal(fresh.access_token, "fresh-access");
    assert.equal(fresh.refresh_token, "refresh-2");
    assert.equal(successQueries.length, 1);
    assert.match(successQueries[0].sql, /status <> 'revoked'/u);
    assert.match(successQueries[0].sql, /encrypted_credentials = \?/u);
    assert.equal(successQueries[0].params.at(-1), originalCiphertext);

    const conflictQueries = [];
    const conflictPool = {
      async query(sql, params) {
        const source = String(sql);
        conflictQueries.push({ sql: source, params });
        return [{ affectedRows: 0 }, []];
      },
    };
    await assert.rejects(
      () => ensureFreshCredentials(connection, { pool: conflictPool, adapter, oauthConfig: {} }),
      (error) => error?.code === "credential_refresh_persistence_conflict" && error?.status === 503,
    );
    assert.equal(conflictQueries.length, 2, "CAS conflict should attempt only guarded reauth cleanup after the failed durable write");
    for (const entry of conflictQueries) {
      assert.match(entry.sql, /status <> 'revoked'/u);
      assert.match(entry.sql, /encrypted_credentials = \?/u);
      assert.equal(entry.params.at(-1), originalCiphertext);
    }
  } finally {
    if (originalEncryptionKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = originalEncryptionKey;
  }
}

{
  assert.deepEqual(hardenedFileViolations(), []);
  const violations = addedLineViolations([
    { file: "http-generic-api/routes/newRoutes.js", text: 'const secret = process.env.JWT_SECRET || "dev-secret";' },
    { file: "http-generic-api/routes/newRoutes.js", text: "function requireUserJwt(req, res, next) {" },
    { file: "http-generic-api/test-example.mjs", text: 'const secret = process.env.JWT_SECRET || "dev-secret";' },
  ]);
  assert.deepEqual(violations.map((item) => item.rule), [
    "jwt_secret_fallback",
    "route_local_user_jwt_guard",
  ]);
}

console.log("user JWT auth tests passed");
