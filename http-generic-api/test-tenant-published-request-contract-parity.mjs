import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import YAML from "yaml";

const root = YAML.parse(await readFile(new URL("./openapi.yaml", import.meta.url), "utf8"));
const tenant = YAML.parse(await readFile(new URL("./openapi/openapi.tenant-gpt.auth.yaml", import.meta.url), "utf8"));
const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);

function operations(doc) {
  const rows = [];
  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!methods.has(method) || !operation?.operationId) continue;
      rows.push({ pathKey, method, operation });
    }
  }
  return rows;
}

function resolveRef(doc, value) {
  if (!value?.$ref || typeof value.$ref !== "string" || !value.$ref.startsWith("#/")) return value;
  let cursor = doc;
  for (const part of value.$ref.slice(2).split("/").map((item) => item.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    cursor = cursor?.[part];
  }
  return cursor || value;
}

function requestShape(doc, schema, seen = new Set()) {
  const resolved = resolveRef(doc, schema);
  if (!resolved || typeof resolved !== "object") return resolved ?? null;
  if (resolved.$ref && seen.has(resolved.$ref)) return { $ref: resolved.$ref };
  const nextSeen = new Set(seen);
  if (resolved.$ref) nextSeen.add(resolved.$ref);
  const out = {};
  for (const key of ["type", "const", "default", "nullable", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "pattern"]) {
    if (Object.hasOwn(resolved, key)) out[key] = resolved[key];
  }
  if (Array.isArray(resolved.enum)) out.enum = [...resolved.enum];
  if (Array.isArray(resolved.required)) out.required = [...resolved.required].sort();
  if (Object.hasOwn(resolved, "additionalProperties")) {
    out.additionalProperties = typeof resolved.additionalProperties === "object"
      ? requestShape(doc, resolved.additionalProperties, nextSeen)
      : resolved.additionalProperties;
  }
  if (resolved.properties && typeof resolved.properties === "object") {
    out.properties = Object.fromEntries(
      Object.keys(resolved.properties).sort().map((key) => [key, requestShape(doc, resolved.properties[key], nextSeen)]),
    );
  }
  if (resolved.items) out.items = requestShape(doc, resolved.items, nextSeen);
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    if (Array.isArray(resolved[key])) out[key] = resolved[key].map((item) => requestShape(doc, item, nextSeen));
  }
  return out;
}

function bodyShape(doc, operation) {
  const body = operation?.requestBody?.content?.["application/json"]?.schema;
  return body ? requestShape(doc, body) : null;
}

const tenantByOperationId = new Map(operations(tenant).map((row) => [row.operation.operationId, row]));
const governed = operations(root).filter(({ operation }) =>
  operation["x-contract-completeness"] === "precise-runtime-contract"
  && operation["x-runtime-contract-source"]
  && tenantByOperationId.has(operation.operationId)
);
assert.ok(governed.length > 0, "At least one precise runtime-bound tenant operation must be parity checked.");

for (const rootRow of governed) {
  const tenantRow = tenantByOperationId.get(rootRow.operation.operationId);
  assert.deepEqual(
    bodyShape(tenant, tenantRow.operation),
    bodyShape(root, rootRow.operation),
    `${rootRow.operation.operationId} published tenant request schema must match root precise runtime contract`,
  );
}

const rootResolve = operations(root).find((row) => row.operation.operationId === "tenantPlatformPluginResolve");
const tenantResolve = tenantByOperationId.get("tenantPlatformPluginResolve");
assert.ok(rootResolve && tenantResolve, "tenantPlatformPluginResolve must exist on root and published tenant schemas");
for (const [label, doc, row] of [["root", root, rootResolve], ["tenant", tenant, tenantResolve]]) {
  const shape = bodyShape(doc, row.operation);
  assert.ok(shape?.required?.includes("workspace_id"), `${label} tenantPlatformPluginResolve must require workspace_id`);
  assert.ok(shape?.properties?.workspace_id, `${label} tenantPlatformPluginResolve must expose workspace_id`);
  assert.equal(shape.additionalProperties, false, `${label} tenantPlatformPluginResolve must reject unknown request fields`);
}

console.log(`tenant published request contract parity tests passed (${governed.length} precise operations)`);
