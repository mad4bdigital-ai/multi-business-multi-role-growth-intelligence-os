import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { buildConnectorProxyRoutes } from "./routes/connectorProxyRoutes.js";
import { resetConnectorSchemaCompatibilityCache } from "./connectorSchemaCompatibility.js";
import { createBackendApiKeyMiddleware } from "./runtimeGuards.js";

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function postJson(baseUrl, path, token, body = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const upstream = express();
upstream.use(express.json());
upstream.post("/browser", async (req, res) => {
  if (req.headers.authorization !== "Bearer tenant-connector-secret") {
    return res.status(401).json({ ok: false, error: { code: "credential_rejected", message: "Credential rejected." } });
  }
  switch (req.body?.action) {
    case "denied_scope":
      return res.status(403).json({ ok: false, error: { code: "scope_denied", message: "Scope denied." } });
    case "rate_limited":
      return res.status(429).json({ ok: false, error: { code: "provider_rate_limit", message: "Rate limited." } });
    case "upstream_5xx":
      return res.status(500).json({ ok: false, error: { code: "provider_internal_error", message: "Provider failed." } });
    case "operation_failure":
      return res.status(422).json({ ok: false, error: { code: "invalid_operation", message: "Operation rejected." } });
    case "invalid_upstream_response":
      return res.status(200).type("text/plain").send("not-json");
    case "timeout":
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return res.status(200).json({ ok: true, late: true });
    default:
      return res.status(200).json({ ok: true, action: req.body?.action || "success" });
  }
});
const upstreamRuntime = await startServer(upstream);

const env = {
  BACKEND_API_KEY: "admin-key-unused-by-tenant",
  JWT_SECRET: "tenant-taxonomy-jwt-secret",
};
const token = jwt.sign(
  { user_id: "tenant-user-4451", tenant_id: "tenant-4451" },
  env.JWT_SECRET,
  { algorithm: "HS256", expiresIn: "5m" },
);

const dbEnvKeys = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];
const originalDbEnv = Object.fromEntries(dbEnvKeys.map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  DB_HOST: "127.0.0.1",
  DB_NAME: "tenant_connector_taxonomy",
  DB_USER: "tenant_connector_taxonomy",
  DB_PASSWORD: "tenant_connector_taxonomy",
});

const originalCreatePool = mysql.createPool;
const fakePool = {
  async query(sql, params = []) {
    const text = String(sql);
    if (/INFORMATION_SCHEMA\.COLUMNS/i.test(text)) return [[{ column_count: 0 }]];
    if (/FROM\s+`local_connector_device_aliases`/i.test(text)) return [[]];
    if (/FROM\s+`local_connector_device_routes`/i.test(text)) return [[]];
    if (/FROM\s+`local_connector_user_configs`/i.test(text)) {
      const deviceId = String(params[1] || "");
      const connectorSecret = deviceId === "missing-credential"
        ? null
        : deviceId === "invalid-credential"
          ? "wrong-secret"
          : "tenant-connector-secret";
      return [[{
        config_id: `cfg-${deviceId}`,
        tunnel_url: upstreamRuntime.baseUrl,
        public_gateway_url: null,
        device_runtime_url: upstreamRuntime.baseUrl,
        admin_recovery_url: null,
        connector_secret: connectorSecret,
        connector_local_api_key: null,
        user_id: "tenant-user-4451",
        tenant_id: "tenant-4451",
        device_id: deviceId,
        last_health_at: null,
        last_error_code: null,
        last_error_message: null,
      }]];
    }
    throw new Error(`Unexpected query in connector taxonomy regression: ${text.slice(0, 160)}`);
  },
};
mysql.createPool = () => fakePool;
resetConnectorSchemaCompatibilityCache();

const api = express();
api.use(express.json());
api.use(buildConnectorProxyRoutes({
  requireBackendApiKey: createBackendApiKeyMiddleware(env),
}));
const apiRuntime = await startServer(api);

try {
  const success = await postJson(apiRuntime.baseUrl, "/connector/device-ok/browser", token, { action: "success" });
  assert.equal(success.status, 200, JSON.stringify(success.body));
  assert.equal(success.body.ok, true);
  assert.notEqual(success.body?.error?.code, "admin_backend_api_key_required");

  const missing = await postJson(apiRuntime.baseUrl, "/connector/missing-credential/browser", token, { action: "success" });
  assert.equal(missing.status, 503, JSON.stringify(missing.body));
  assert.equal(missing.body.error.code, "connector_auth_unconfigured");
  assert.equal(missing.body.connector_error.class, "missing_credential");

  const invalid = await postJson(apiRuntime.baseUrl, "/connector/invalid-credential/browser", token, { action: "success" });
  assert.equal(invalid.status, 502, JSON.stringify(invalid.body));
  assert.equal(invalid.body.connector_error.class, "invalid_credential");
  assert.equal(invalid.body.error.details.attempts[0].connector_error_class, "invalid_credential");

  const denied = await postJson(apiRuntime.baseUrl, "/connector/device-ok/browser", token, { action: "denied_scope" });
  assert.equal(denied.status, 502, JSON.stringify(denied.body));
  assert.equal(denied.body.connector_error.class, "denied_scope");

  const rate = await postJson(apiRuntime.baseUrl, "/connector/device-ok/browser", token, { action: "rate_limited" });
  assert.equal(rate.status, 429, JSON.stringify(rate.body));
  assert.equal(rate.body.connector_error.class, "rate_limited");
  assert.equal(rate.body.connector_error.retryable, true);

  const operation = await postJson(apiRuntime.baseUrl, "/connector/device-ok/browser", token, { action: "operation_failure" });
  assert.equal(operation.status, 422, JSON.stringify(operation.body));
  assert.equal(operation.body.connector_error.class, "operation_failure");
  assert.equal(operation.body.connector_error.retryable, false);

  const upstreamFailure = await postJson(apiRuntime.baseUrl, "/connector/device-ok/browser", token, { action: "upstream_5xx" });
  assert.equal(upstreamFailure.status, 502, JSON.stringify(upstreamFailure.body));
  assert.equal(upstreamFailure.body.connector_error.class, "upstream_5xx");

  const invalidResponse = await postJson(apiRuntime.baseUrl, "/connector/device-ok/browser", token, { action: "invalid_upstream_response" });
  assert.equal(invalidResponse.status, 502, JSON.stringify(invalidResponse.body));
  assert.equal(invalidResponse.body.connector_error.class, "invalid_upstream_response");

  const timeout = await postJson(apiRuntime.baseUrl, "/connector/device-ok/browser", token, { action: "timeout", timeout_ms: 1000 });
  assert.equal(timeout.status, 502, JSON.stringify(timeout.body));
  assert.equal(timeout.body.connector_error.class, "timeout");

  for (const result of [missing, invalid, denied, rate, operation, upstreamFailure, invalidResponse, timeout]) {
    assert.equal(result.body.secrets_included, false, JSON.stringify(result.body));
    assert.equal(JSON.stringify(result.body).includes("tenant-connector-secret"), false);
  }
} finally {
  await new Promise((resolve, reject) => apiRuntime.server.close((error) => error ? reject(error) : resolve()));
  await new Promise((resolve, reject) => upstreamRuntime.server.close((error) => error ? reject(error) : resolve()));
  mysql.createPool = originalCreatePool;
  resetConnectorSchemaCompatibilityCache();
  for (const key of dbEnvKeys) {
    if (originalDbEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalDbEnv[key];
  }
}

console.log("tenant Local Connector error taxonomy regression passed");
