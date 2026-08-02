import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {
  createUserJwtMiddleware,
  resolveUserJwtSecret,
  resolveUserJwtSecretStatus,
  verifyUserJwtAuthorization,
} from "./userJwtAuth.js";
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
  const aliasEnv = {
    USER_JWT_SECRET: "alias-user-jwt-secret",
    AUTH_JWT_SECRET: "lower-priority-auth-secret",
    BACKEND_API_KEY: "backend-key-must-not-win",
  };
  assert.equal(resolveUserJwtSecret(aliasEnv), aliasEnv.USER_JWT_SECRET);
  assert.deepEqual(resolveUserJwtSecretStatus(aliasEnv), {
    configured: true,
    source: "USER_JWT_SECRET",
    derived: false,
    secrets_included: false,
  });
}

{
  const env = { BACKEND_API_KEY: "startup-smoke-backend-key" };
  const derivedSecret = resolveUserJwtSecret(env);
  assert.ok(derivedSecret, "BACKEND_API_KEY must provide a deterministic compatibility secret");
  assert.notEqual(derivedSecret, env.BACKEND_API_KEY, "the JWT secret must be context-derived, not reused verbatim");
  assert.equal(derivedSecret, resolveUserJwtSecret({ ...env }), "derived secret must be deterministic across instances");
  assert.deepEqual(resolveUserJwtSecretStatus(env), {
    configured: true,
    source: "BACKEND_API_KEY_DERIVED",
    derived: true,
    secrets_included: false,
  });

  const token = jwt.sign({ user_id: "tenant-user", tenant_id: "tenant-1" }, derivedSecret, { algorithm: "HS256" });
  const accepted = callMiddleware(createUserJwtMiddleware({ env }), { authorization: `Bearer ${token}` });
  assert.equal(accepted.nextCalled, true);
  assert.equal(accepted.req.auth?.user_id, "tenant-user");
  assert.equal(accepted.req.auth?.tenant_id, "tenant-1");
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
