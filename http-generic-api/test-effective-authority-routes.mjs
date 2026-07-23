import assert from "node:assert/strict";
import express from "express";
import { buildEffectiveAuthorityRoutes } from "./routes/effectiveAuthorityRoutes.js";

const calls = [];
const service = {
  async listConnectorProjection(input) {
    calls.push({ method: "list", input });
    return {
      manifest: { decision: "shadow_ready", secretsIncluded: false },
      items: [],
      page: { nextCursor: null, hasMore: false },
      secretsIncluded: false,
    };
  },
  async resolveDecision(input) {
    calls.push({ method: "resolve", input });
    return {
      manifest: { decision: "shadow_ready", secretsIncluded: false },
      secretsIncluded: false,
    };
  },
};

const app = express();
app.use(express.json());
app.use(
  buildEffectiveAuthorityRoutes({
    effectiveAuthorityService: service,
    requireBackendApiKey(req, res, next) {
      req.auth = { mode: "backend_api_key", is_admin: true, user_id: "admin-1" };
      next();
    },
    requireAdminPrincipal(req, res, next) {
      next();
    },
    requireUserJwt(req, res, next) {
      req.auth = { mode: "user_jwt", user_id: "user-1", tenant_id: "tenant-1" };
      next();
    },
  })
);

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
try {
  const adminResponse = await fetch(`${baseUrl}/authority/projections/connectors?tenantId=tenant-2&limit=10`);
  assert.equal(adminResponse.status, 200);
  const adminBody = await adminResponse.json();
  assert.equal(adminBody.ok, true);
  assert.equal(calls.at(-1).input.tenantId, "tenant-2");

  const tenantResponse = await fetch(`${baseUrl}/me/authority/projections/connectors?limit=5`);
  assert.equal(tenantResponse.status, 200);
  assert.equal(calls.at(-1).input.tenantId, "tenant-1");

  const invalidResponse = await fetch(`${baseUrl}/me/authority/projections/connectors?tenantId=tenant-2`);
  assert.equal(invalidResponse.status, 400);
  const invalidBody = await invalidResponse.json();
  assert.equal(invalidBody.error.code, "AUTHORITY_UNSUPPORTED_FIELD");
  assert.equal(invalidBody.secrets_included, false);

  const decisionResponse = await fetch(`${baseUrl}/me/authority/decisions/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ capabilityKey: "connector.inventory.read" }),
  });
  assert.equal(decisionResponse.status, 200);
  assert.equal(calls.at(-1).input.tenantId, "tenant-1");
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const previousJwtSecret = process.env.JWT_SECRET;
delete process.env.JWT_SECRET;
const failClosedApp = express();
failClosedApp.use(express.json());
failClosedApp.use(buildEffectiveAuthorityRoutes({ effectiveAuthorityService: service }));
const failClosedServer = failClosedApp.listen(0, "127.0.0.1");
await new Promise((resolve) => failClosedServer.once("listening", resolve));
const failClosedBaseUrl = `http://127.0.0.1:${failClosedServer.address().port}`;
try {
  const adminFailure = await fetch(`${failClosedBaseUrl}/authority/projections/connectors`);
  assert.equal(adminFailure.status, 503);
  assert.equal((await adminFailure.json()).error.code, "BACKEND_AUTH_MIDDLEWARE_UNAVAILABLE");

  const tenantFailure = await fetch(`${failClosedBaseUrl}/me/authority/projections/connectors`);
  assert.equal(tenantFailure.status, 401);
  assert.equal((await tenantFailure.json()).error.code, "user_jwt_required");
} finally {
  await new Promise((resolve) => failClosedServer.close(resolve));
  if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousJwtSecret;
}

console.log("effective authority route tests passed");
