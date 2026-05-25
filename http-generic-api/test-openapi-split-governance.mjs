import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const METHOD_NAMES = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);

function collectOperations(doc) {
  const operations = [];
  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!METHOD_NAMES.has(method)) continue;
      operations.push({ pathKey, method, operation });
    }
  }
  return operations;
}

function loadYaml(path) {
  return yaml.load(readFileSync(path, "utf8"));
}

const main = loadYaml("openapi.yaml");
const splitScript = readFileSync("scripts/split-openapi.mjs", "utf8");

const sourceOperationIds = new Set();
const sourceTenantAliases = new Set();
for (const op of collectOperations(main)) {
  if (op.operation?.operationId) sourceOperationIds.add(op.operation.operationId);
  if (op.operation?.["x-tenant-gpt-operationId"]) {
    sourceOperationIds.add(op.operation["x-tenant-gpt-operationId"]);
    sourceTenantAliases.add(op.operation["x-tenant-gpt-operationId"]);
  }
}

assert(main["x-tenant-gpt-auth"], "main OpenAPI must define x-tenant-gpt-auth");
assert(Array.isArray(main["x-tenant-gpt-auth"].tenant_operation_ids), "x-tenant-gpt-auth.tenant_operation_ids must define tenant split operations");
for (const opId of main["x-tenant-gpt-auth"].tenant_operation_ids) {
  assert(sourceOperationIds.has(opId), `tenant split operationId missing from main OpenAPI operationId or x-tenant-gpt-operationId: ${opId}`);
}

for (const requiredPath of [
  "/tenant/platform/plugins/catalog",
  "/tenant/platform/plugins/install",
  "/tenant/platform/plugins/resolve",
]) {
  assert(main.paths?.[requiredPath], `tenant Platform Plugin path must be declared in main OpenAPI: ${requiredPath}`);
}

for (const requiredAlias of ["activateSession", "listTools", "callTool", "writeSessionTurn", "endSession"]) {
  assert(sourceTenantAliases.has(requiredAlias), `tenant alias must be declared in main OpenAPI via x-tenant-gpt-operationId: ${requiredAlias}`);
}

assert(splitScript.includes("tenant_operation_ids"), "split-openapi must select tenant operations from main config");
assert(splitScript.includes("x-tenant-gpt-operationId"), "split-openapi must support source-declared tenant aliases");
assert(splitScript.includes("validateSplitOperationsComeFromSource"), "split-openapi must validate generated split operations against main source");
assert(!splitScript.includes("yaml.load(fs.readFileSync(tenantPath"), "split-openapi must not use tenant schema as the tenant source-of-truth");

console.log("openapi split governance tests passed");
