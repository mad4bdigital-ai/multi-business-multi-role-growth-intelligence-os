import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { createBackendApiKeyMiddleware } from "./runtimeGuards.js";

function callMiddleware(headers = {}, env = { BACKEND_API_KEY: "secret" }) {
  const middleware = createBackendApiKeyMiddleware(env);
  let nextCalled = false;
  let responseStatus = null;
  let responseBody = null;
  const lowerHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  const req = {
    headers: lowerHeaders,
    header(name) {
      return lowerHeaders[String(name).toLowerCase()];
    }
  };
  const res = {
    status(status) {
      responseStatus = status;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    }
  };

  middleware(req, res, () => {
    nextCalled = true;
  });

  return { nextCalled, responseStatus, responseBody, req };
}

{
  const result = callMiddleware({ Authorization: "Bearer secret" });
  assert.equal(result.nextCalled, true, "accepts Authorization bearer token");
  assert.equal(result.req.auth?.is_admin, true, "backend bearer auth is admin");
}

{
  const result = callMiddleware({ "x-api-key": "secret" });
  assert.equal(result.nextCalled, true, "accepts x-api-key token");
  assert.equal(result.req.auth?.is_admin, true, "x-api-key auth is admin");
}

{
  const token = jwt.sign({ user_id: "user-1", email: "user@example.com" }, "jwt-secret", { expiresIn: "5m" });
  const result = callMiddleware(
    { Authorization: `Bearer ${token}` },
    { BACKEND_API_KEY: "secret", JWT_SECRET: "jwt-secret" }
  );
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.auth?.mode, "user_jwt");
  assert.equal(result.req.auth?.is_admin, false);
  assert.equal(result.req.auth?.user_id, "user-1");
}

{
  const result = callMiddleware({});
  assert.equal(result.nextCalled, false);
  assert.equal(result.responseStatus, 401);
  assert.equal(result.responseBody.ok, false);
  assert.equal(result.responseBody.error.code, "missing_backend_api_key");
}

{
  const result = callMiddleware({ Authorization: "Bearer wrong" });
  assert.equal(result.nextCalled, false);
  assert.equal(result.responseStatus, 403);
  assert.equal(result.responseBody.ok, false);
  assert.equal(result.responseBody.error.code, "invalid_auth_token");
}

{
  const result = callMiddleware({ "x-api-key": "wrong" });
  assert.equal(result.nextCalled, false);
  assert.equal(result.responseStatus, 403);
  assert.equal(result.responseBody.ok, false);
  assert.equal(result.responseBody.error.code, "invalid_backend_api_key");
}

console.log("runtime guard tests passed");
