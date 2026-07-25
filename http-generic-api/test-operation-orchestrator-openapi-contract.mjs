import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import YAML from "yaml";

const document = YAML.parse(
  await readFile(
    new URL("./openapi/operation-orchestrator.yaml", import.meta.url),
    "utf8",
  ),
);

assert.equal(document.openapi, "3.1.0");

const expectedContracts = [
  ["get", "/admin/operations/contracts"],
  ["post", "/admin/operations/context"],
  ["post", "/admin/operations/preview"],
  ["post", "/admin/operations/status"],
  ["post", "/admin/operations/ci-diagnose"],
  ["get", "/tenant/operations/contracts"],
  ["post", "/tenant/operations/context"],
  ["post", "/tenant/operations/preview"],
  ["post", "/tenant/operations/status"],
  ["post", "/tenant/operations/ci-diagnose"],
];
const operationIds = new Set();

for (const [method, routePath] of expectedContracts) {
  const operation = document.paths?.[routePath]?.[method];
  assert(operation, `${method.toUpperCase()} ${routePath} must be documented`);
  assert(operation.summary, `${method.toUpperCase()} ${routePath} needs a summary`);
  assert(operation.operationId, `${method.toUpperCase()} ${routePath} needs an operationId`);
  assert(!operationIds.has(operation.operationId), `${operation.operationId} must be unique`);
  operationIds.add(operation.operationId);
  assert(Array.isArray(operation.security), `${method.toUpperCase()} ${routePath} needs explicit security`);
  assert(operation.responses?.["401"], `${method.toUpperCase()} ${routePath} needs a 401 response`);
  assert(operation.responses?.["403"], `${method.toUpperCase()} ${routePath} needs a 403 response`);
  assert(operation.responses?.["500"], `${method.toUpperCase()} ${routePath} needs a 500 response`);
  if (method === "post") {
    assert(operation.requestBody, `${method.toUpperCase()} ${routePath} needs a request body`);
  }
}

assert.deepEqual(document.paths["/admin/operations/contracts"].get.security, [
  { adminBearerAuth: [] },
  { backendApiKeyAuth: [] },
]);
assert.deepEqual(document.paths["/tenant/operations/contracts"].get.security, [
  { userJwtAuth: [] },
]);
assert(document.paths["/admin/operations/preview"].post.responses["202"]);
assert(document.paths["/tenant/operations/status"].post.responses["404"]);

console.log("operation orchestrator OpenAPI contract tests passed");
