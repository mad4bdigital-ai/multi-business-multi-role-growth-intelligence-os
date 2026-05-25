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
const tenant = loadYaml("openapi.tenant-gpt.auth.yaml");
const splitScript = readFileSync("scripts/split-openapi.mjs", "utf8");

const sourcePairs = new Set(collectOperations(main).map((op) => `${op.method.toUpperCase()} ${op.pathKey}`));
const sourceOperationIds = new Set(
  collectOperations(main)
    .flatMap((op) => [op.operation?.operationId, op.operation?.["x-tenant-gpt-operationId"]])
    .filter(Boolean)
);

function assertSplitDerivedFromMain(label, doc) {
  for (const op of collectOperations(doc)) {
    const pair = `${op.method.toUpperCase()} ${op.pathKey}`;
    assert(sourcePairs.has(pair), `${label} carries split-only path/method: ${pair}`);
    if (op.operation?.operationId) {
      assert(sourceOperationIds.has(op.operation.operationId), `${label} carries split-only operationId: ${op.operation.operationId}`);
    }
  }
}

assert(main["x-tenant-gpt-auth"], "main OpenAPI must define x-tenant-gpt-auth");
assert(Array.isArray(main["x-tenant-gpt-auth"].tenant_operation_ids), "x-tenant-gpt-auth.tenant_operation_ids must define tenant split operations");
for (const opId of main["x-tenant-gpt-auth"].tenant_operation_ids) {
  assert(sourceOperationIds.has(opId), `tenant split operationId missing from main OpenAPI: ${opId}`);
}

assertSplitDerivedFromMain("tenant GPT split", tenant);
assertSplitDerivedFromMain("admin auth dispatcher split", admin);

assert(splitScript.includes("tenant_operation_ids"), "split-openapi must select tenant operations from main config");
assert(splitScript.includes("validateSplitOperationsComeFromSource"), "split-openapi must validate split operations against main source");
assert(!splitScript.includes("yaml.load(fs.readFileSync(tenantPath"), "split-openapi must not use tenant schema as the tenant source-of-truth");

console.log("openapi split governance tests passed");
