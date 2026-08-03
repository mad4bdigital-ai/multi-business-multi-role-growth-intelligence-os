import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import YAML from "yaml";
import { buildSystemLayerRoutes } from "./routes/systemLayerRoutes.js";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.auth = { is_admin: true };
  next();
});
app.use(buildSystemLayerRoutes({ requireBackendApiKey: (_req, _res, next) => next() }));

const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));

try {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/admin/system/tools?cursor=not-a-valid-catalog-cursor`);
  const body = await response.json();
  assert.equal(response.status, 400, "admin invalid cursor must be a client error");
  assert.equal(body.ok, false, "admin invalid cursor must use the stable error envelope");
  assert.equal(body.error?.code, "SYSTEM_TOOL_CATALOG_CURSOR_INVALID", "admin invalid cursor must preserve the Catalog V2 error code");
  assert.equal(body.secrets_included, false, "admin invalid cursor response must exclude secrets");
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const root = YAML.parse(readFileSync("openapi.yaml", "utf8"));
const spec = YAML.parse(readFileSync("../specs/013-system-tool-catalog-v2/contracts/system-tool-catalog-v2.openapi.yaml", "utf8"));

function assertSecurityAlternatives(security, expectedSchemes, label) {
  assert.ok(Array.isArray(security), `${label} must declare a security array`);
  assert.ok(security.every((entry) => entry && Object.keys(entry).length === 1), `${label} must use one scheme per Security Requirement Object`);
  const actual = security.map((entry) => Object.keys(entry)[0]).sort();
  assert.deepEqual(actual, [...expectedSchemes].sort(), `${label} must preserve bearer/API-key OR semantics`);
}

for (const [path, method, bearer] of [
  ["/system/tools", "get", "backendBearerAuth"],
  ["/system/tools/catalog-observability", "get", "adminBearerAuth"],
  ["/system/tools/{toolName}", "get", "backendBearerAuth"],
  ["/system/capabilities/resolve", "post", "backendBearerAuth"],
  ["/system/tools/call", "post", "backendBearerAuth"],
]) {
  assertSecurityAlternatives(
    root.paths?.[path]?.[method]?.security,
    [bearer, "backendApiKeyAuth"],
    `Root OpenAPI ${method.toUpperCase()} ${path}`,
  );
}

assertSecurityAlternatives(spec.security, ["bearerAuth", "backendApiKeyAuth"], "Spec 013 global security");
assertSecurityAlternatives(
  spec.paths?.["/system/tools/catalog-observability"]?.get?.security,
  ["bearerAuth", "backendApiKeyAuth"],
  "Spec 013 observability security",
);
assert.deepEqual(
  spec.components?.securitySchemes?.backendApiKeyAuth,
  { type: "apiKey", in: "header", name: "x-api-key" },
  "Spec 013 must define the backend API-key scheme",
);

console.log("system tool catalog v2 post-merge contract tests passed");
