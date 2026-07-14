import assert from "node:assert/strict";
import express from "express";
import { buildConnectApiRoutes } from "./routes/connectApiRoutes.js";
import { TENANT_CONNECTION_SELF_REPAIR_ROUTE_CONTRACTS } from "./tenantConnectionSelfRepairService.js";

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function requestPath(contract) {
  return contract.path.replace("{connection_id}", "connection-test-1");
}

const queries = [];
const pool = {
  async query(sql, params = []) {
    queries.push({ sql: String(sql), params });
    if (String(sql).includes("tenant_platform_endpoint_tools")) {
      return [[{ tool_key: params[0], is_enabled: 0 }], []];
    }
    if (String(sql).includes("memberships")) {
      return [[{ tenant_id: "tenant-test-1" }], []];
    }
    if (String(sql).includes("user_app_connections")) {
      throw new Error("connection lookup must not occur while capability is disabled");
    }
    throw new Error(`unexpected query: ${String(sql).slice(0, 120)}`);
  },
};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.auth = {
    mode: "user_jwt",
    user_id: "user-test-1",
    tenant_id: "tenant-test-1",
    is_admin: false,
  };
  next();
});
app.use(buildConnectApiRoutes({ pool }));

const { server, baseUrl } = await startServer(app);
try {
  assert.equal(TENANT_CONNECTION_SELF_REPAIR_ROUTE_CONTRACTS.length, 9);
  for (const contract of TENANT_CONNECTION_SELF_REPAIR_ROUTE_CONTRACTS) {
    const response = await fetch(`${baseUrl}${requestPath(contract)}`, {
      method: contract.method,
      headers: contract.method === "GET" ? undefined : { "content-type": "application/json" },
      body: contract.method === "GET" ? undefined : JSON.stringify({}),
    });
    const body = await response.json();
    assert.equal(response.status, 503, `${contract.tool_key} must fail closed`);
    assert.equal(body?.error?.code, "tenant_connection_self_repair_capability_disabled");
    assert.equal(body?.error?.details?.tool_key, contract.tool_key);
    assert.equal(body?.secrets_included, false);
  }
  assert.equal(queries.filter((entry) => entry.sql.includes("user_app_connections")).length, 0);
  assert.equal(queries.filter((entry) => entry.sql.includes("tenant_platform_endpoint_tools")).length, 9);
} finally {
  server.close();
}

const unauthenticatedApp = express();
unauthenticatedApp.use(express.json());
unauthenticatedApp.use(buildConnectApiRoutes({ pool }));
const unauthenticated = await startServer(unauthenticatedApp);
try {
  const response = await fetch(`${unauthenticated.baseUrl}/me/connections/connection-test-1/effective-credential-plan`);
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body?.error?.code, "user_jwt_required");
} finally {
  unauthenticated.server.close();
}

console.log("tenant connection self-repair fail-closed routes passed");
