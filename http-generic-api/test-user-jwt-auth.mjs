import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { createUserJwtMiddleware, verifyUserJwtAuthorization } from "./userJwtAuth.js";
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
  const env = { JWT_SECRET: "local-manager-user-jwt-secret-32-chars-minimum" };
  const profile = {
    issuer: "https://auth.mad4b.com",
    audience: "mad4b-local-manager-user",
    requiredPurpose: "local_manager_user_access",
    requiredScope: "local_manager.user",
  };
  const valid = jwt.sign({
    iss: "https://auth.mad4b.com",
    aud: "mad4b-local-manager-user",
    purpose: "local_manager_user_access",
    scope: "local_manager.user",
    user_id: "user-1",
    tenant_id: "tenant-1",
  }, env.JWT_SECRET, { algorithm: "HS256", expiresIn: "5m" });
  assert.equal(verifyUserJwtAuthorization(`Bearer ${valid}`, { env, ...profile }).ok, true);

  const sameKeyDeviceToken = jwt.sign({
    iss: "https://auth.mad4b.com",
    aud: "mad4b-local-manager-device",
    purpose: "local_manager_device_access",
    scope: "local_manager.device",
    user_id: "user-1",
    tenant_id: "tenant-1",
    device_id: "device-1",
  }, env.JWT_SECRET, { algorithm: "HS256", expiresIn: "5m" });
  const deviceRejected = verifyUserJwtAuthorization(`Bearer ${sameKeyDeviceToken}`, { env, ...profile });
  assert.equal(deviceRejected.ok, false);
  assert.equal(deviceRejected.status, 401);

  const wrongPurpose = jwt.sign({
    iss: "https://auth.mad4b.com",
    aud: "mad4b-local-manager-user",
    purpose: "tenant_gpt_access",
    scope: "local_manager.user",
    user_id: "user-1",
  }, env.JWT_SECRET, { algorithm: "HS256", expiresIn: "5m" });
  const wrongPurposeRejected = verifyUserJwtAuthorization(`Bearer ${wrongPurpose}`, { env, ...profile });
  assert.equal(wrongPurposeRejected.ok, false);
  assert.equal(wrongPurposeRejected.code, "wrong_user_token_class");

  const wrongScope = jwt.sign({
    iss: "https://auth.mad4b.com",
    aud: "mad4b-local-manager-user",
    purpose: "local_manager_user_access",
    scope: "tenant.status",
    user_id: "user-1",
  }, env.JWT_SECRET, { algorithm: "HS256", expiresIn: "5m" });
  const wrongScopeRejected = verifyUserJwtAuthorization(`Bearer ${wrongScope}`, { env, ...profile });
  assert.equal(wrongScopeRejected.ok, false);
  assert.equal(wrongScopeRejected.code, "wrong_user_token_scope");
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
