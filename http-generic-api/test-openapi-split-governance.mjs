import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";

const METHOD_NAMES = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);
const SPLIT_SCHEMA_FILES = [
  "openapi.tenant-gpt.auth.yaml",
  "openapi.custom-gpt.auth-dispatcher.yaml",
];

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
  return YAML.parse(readFileSync(path, "utf8"));
}

function resolveJsonPointer(doc, pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("#/")) return undefined;
  return pointer
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((current, part) => current && current[part], doc);
}

function collectRefs(value, refs = new Set()) {
  if (!value || typeof value !== "object") return refs;
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
    return refs;
  }
  if (typeof value.$ref === "string") refs.add(value.$ref);
  for (const child of Object.values(value)) collectRefs(child, refs);
  return refs;
}

const mainText = readFileSync("openapi.yaml", "utf8");
const splitScript = readFileSync("scripts/split-openapi.mjs", "utf8");

assert(mainText.includes("x-tenant-gpt-auth"), "main OpenAPI must define x-tenant-gpt-auth");
assert(mainText.includes("tenant_operation_ids"), "x-tenant-gpt-auth.tenant_operation_ids must define tenant split operations");

for (const requiredPath of [
  "/tenant/platform/plugins/catalog",
  "/tenant/platform/plugins/install",
  "/tenant/platform/plugins/resolve",
]) {
  assert(mainText.includes(`${requiredPath}:`), `tenant Platform Plugin path must be declared in main OpenAPI: ${requiredPath}`);
}

for (const requiredAlias of ["activateSession", "listTools", "callTool", "writeSessionTurn", "endSession"]) {
  assert(mainText.includes(`x-tenant-gpt-operationId: ${requiredAlias}`), `tenant alias must be declared in main OpenAPI via x-tenant-gpt-operationId: ${requiredAlias}`);
}
assert(mainText.includes("/system/tools:"), "tenant listTools source path must be declared in main OpenAPI");
assert(mainText.includes("/system/tools/call:"), "tenant callTool source path must be declared in main OpenAPI");

for (const splitFile of SPLIT_SCHEMA_FILES) {
  const splitDoc = loadYaml(splitFile);
  const splitOps = collectOperations(splitDoc);
  assert(splitOps.length > 0, `${splitFile} must contain operations`);

  for (const op of splitOps) {
    const pair = `${op.method.toUpperCase()} ${op.pathKey}`;
    assert(mainText.includes(`${op.pathKey}:`), `${splitFile} contains split-only path not present in main OpenAPI text: ${pair}`);
    if (op.operation?.operationId) {
      assert(
        mainText.includes(`operationId: ${op.operation.operationId}`) ||
          mainText.includes(`x-tenant-gpt-operationId: ${op.operation.operationId}`),
        `${splitFile} contains split-only operationId not present or aliased in main OpenAPI text: ${op.operation.operationId}`,
      );
    }
  }

  for (const ref of collectRefs(splitDoc)) {
    assert(ref.startsWith("#/"), `${splitFile} contains non-local ref: ${ref}`);
    assert(resolveJsonPointer(splitDoc, ref) !== undefined, `${splitFile} contains unresolved local ref: ${ref}`);
  }
}

assert(splitScript.includes("tenant_operation_ids"), "split-openapi must select tenant operations from main config");
assert(splitScript.includes("x-tenant-gpt-operationId"), "split-openapi must support source-declared tenant aliases");
assert(splitScript.includes("validateUniqueTenantAliases"), "split-openapi must reject duplicate tenant operation aliases");
assert(splitScript.includes("validateSplitOperationsComeFromSource"), "split-openapi must validate generated split operations against main source");
assert(!splitScript.includes("YAML.parse(fs.readFileSync(tenantPath"), "split-openapi must not use tenant schema as the tenant source-of-truth");

console.log("openapi split governance tests passed");
