import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { buildConnectorProxyRoutes } from "./routes/connectorProxyRoutes.js";
import { resetConnectorSchemaCompatibilityCache } from "./connectorSchemaCompatibility.js";
import { createBackendApiKeyMiddleware } from "./runtimeGuards.js";

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function postJson(baseUrl, path, token, body = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

const env = {
  BACKEND_API_KEY: "connector-admin-regression-key",
  JWT_SECRET: "tenant-local-connector-user-jwt-regression-secret",
};
const token = jwt.sign(
  {
    user_id: "tenant-user-4451",
    tenant_id: "tenant-4451",
    email: "tenant-4451@example.invalid",
  },
  env.JWT_SECRET,
  { algorithm: "HS256", expiresIn: "5m" },
);

const dbEnvKeys = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];
const originalDbEnv = Object.fromEntries(dbEnvKeys.map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  DB_HOST: "127.0.0.1",
  DB_NAME: "tenant_local_connector_regression",
  DB_USER: "tenant_local_connector_regression",
  DB_PASSWORD: "tenant_local_connector_regression",
});

const originalCreatePool = mysql.createPool;
const queries = [];
const fakePool = {
  async query(sql, params = []) {
    queries.push({ sql: String(sql), params: [...params] });

    if (/INFORMATION_SCHEMA\.COLUMNS/i.test(sql)) {
      return [[{ column_count: 0 }]];
    }
    if (/FROM\s+`local_connector_device_aliases`/i.test(sql)) {
      return [[]];
    }
    if (/FROM\s+`local_connector_user_configs`/i.test(sql)) {
      return [[]];
    }

    throw new Error(`Unexpected query in tenant local connector regression: ${String(sql).slice(0, 160)}`);
  },
};

mysql.createPool = () => fakePool;
resetConnectorSchemaCompatibilityCache();

const app = express();
app.use(express.json());
app.use(buildConnectorProxyRoutes({
  requireBackendApiKey: createBackendApiKeyMiddleware(env),
}));
const { server, baseUrl } = await startServer(app);

try {
  const tenantBrowser = await postJson(
    baseUrl,
    "/connector/device-4451/browser",
    token,
    {
      tenant_id: "attacker-selected-tenant",
      action: "inspect",
    },
  );

  assert.equal(tenantBrowser.status, 404, JSON.stringify(tenantBrowser.body));
  assert.equal(tenantBrowser.body?.error?.code, "device_not_found", JSON.stringify(tenantBrowser.body));
  assert.notEqual(
    tenantBrowser.body?.error?.code,
    "admin_backend_api_key_required",
    "tenant-safe browser proxy must not require admin/service BACKEND_API_KEY after a valid User JWT",
  );

  const configQuery = queries.find((entry) => /FROM\s+`local_connector_user_configs`/i.test(entry.sql));
  assert.ok(configQuery, "tenant browser proxy must reach tenant-scoped device resolution after User JWT auth");
  assert.match(configQuery.sql, /AND user_id = \? AND device_id = \?/);
  assert.match(configQuery.sql, /AND \(tenant_id = \? OR tenant_id = '00000000-0000-0000-0000-000000000000'\)/);
  assert.deepEqual(
    configQuery.params,
    ["tenant-user-4451", "device-4451", "tenant-4451", "tenant-4451"],
    "effective device scope must use User JWT user/tenant identity and ignore a conflicting body tenant_id",
  );
  assert.ok(
    !configQuery.params.includes("attacker-selected-tenant"),
    "request body tenant_id must not override authenticated tenant scope",
  );

  const queryCountBeforeAdminOnly = queries.length;
  const adminOnlyBrowser = await postJson(
    baseUrl,
    "/connector/device-4451/browser4",
    token,
    { action: "inspect" },
  );

  assert.equal(adminOnlyBrowser.status, 403, JSON.stringify(adminOnlyBrowser.body));
  assert.equal(
    adminOnlyBrowser.body?.error?.code,
    "admin_backend_api_key_required",
    "browser4 must remain an explicit admin/break-glass surface",
  );
  assert.equal(
    queries.length,
    queryCountBeforeAdminOnly,
    "admin-only denial must occur before device/credential lookup or connector access",
  );
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  mysql.createPool = originalCreatePool;
  resetConnectorSchemaCompatibilityCache();
  for (const key of dbEnvKeys) {
    if (originalDbEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalDbEnv[key];
    }
  }
}

console.log("tenant Local Connector User JWT proxy boundary regression passed");
