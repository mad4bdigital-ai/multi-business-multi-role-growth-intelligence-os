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

const main = loadYaml("openapi.yaml");
const splitScript = readFileSync("scripts/split-openapi.mjs", "utf8");

const sourcePairs = new Set();
const sourceOperationIds = new Set();
const sourceTenantAliases = new Set();
const sourceTenantAliasLocations = new Map();
for (const op of collectOperations(main)) {
  sourcePairs.add(`${op.method.toUpperCase()} ${op.pathKey}`);
  if (op.operation?.operationId) sourceOperationIds.add(op.operation.operationId);
  if (op.operation?.["x-tenant-gpt-operationId"]) {
    const alias = op.operation["x-tenant-gpt-operationId"];
    sourceOperationIds.add(alias);
    sourceTenantAliases.add(alias);
    const locations = sourceTenantAliasLocations.get(alias) || [];
    locations.push(`${op.method.toUpperCase()} ${op.pathKey}`);
    sourceTenantAliasLocations.set(alias, locations);
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
for (const [alias, locations] of sourceTenantAliasLocations.entries()) {
  assert(locations.length === 1, `tenant alias must be unique in main OpenAPI: ${alias} => ${locations.join(", ")}`);
}
assert(sourceTenantAliasLocations.get("listTools")?.[0] === "GET /system/tools", "tenant listTools alias must bind to /system/tools");
assert(sourceTenantAliasLocations.get("callTool")?.[0] === "POST /system/tools/call", "tenant callTool alias must bind to /system/tools/call");

for (const splitFile of SPLIT_SCHEMA_FILES) {
  const splitDoc = loadYaml(splitFile);
  const splitOps = collectOperations(splitDoc);
  assert(splitOps.length > 0, `${splitFile} must contain operations`);

  for (const op of splitOps) {
    const pair = `${op.method.toUpperCase()} ${op.pathKey}`;
    assert(sourcePairs.has(pair), `${splitFile} contains split-only path/method not present in main OpenAPI: ${pair}`);
    if (op.operation?.operationId) {
      assert(sourceOperationIds.has(op.operation.operationId), `${splitFile} contains split-only operationId not present or aliased in main OpenAPI: ${op.operation.operationId}`);
    }
  }

  for (const ref of collectRefs(splitDoc)) {
    assert(ref.startsWith("#/"), `${splitFile} contains non-local ref: ${ref}`);
    assert(resolveJsonPointer(splitDoc, ref) !== undefined, `${splitFile} contains unresolved local ref: ${ref}`);
    if (ref.startsWith("#/components/") && ref !== "#/components/securitySchemes/userBearerAuth") {
      assert(resolveJsonPointer(main, ref) !== undefined, `${splitFile} contains component ref not declared in main OpenAPI: ${ref}`);
    }
  }
}

assert(splitScript.includes("tenant_operation_ids"), "split-openapi must select tenant operations from main config");
assert(splitScript.includes("x-tenant-gpt-operationId"), "split-openapi must support source-declared tenant aliases");
assert(splitScript.includes("validateUniqueTenantAliases"), "split-openapi must reject duplicate tenant operation aliases");
assert(splitScript.includes("validateSplitOperationsComeFromSource"), "split-openapi must validate generated split operations against main source");
assert(!splitScript.includes("YAML.parse(fs.readFileSync(tenantPath"), "split-openapi must not use tenant schema as the tenant source-of-truth");

console.log("openapi split governance tests passed");
