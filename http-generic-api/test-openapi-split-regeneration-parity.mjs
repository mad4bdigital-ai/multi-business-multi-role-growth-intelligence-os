import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";

const GENERATED_SPLIT_FILES = [
  "openapi.tenant-gpt.auth.yaml",
  "openapi.custom-gpt.auth-dispatcher.yaml",
];
const METHODS = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);

function readGeneratedSpecs() {
  return Object.fromEntries(
    GENERATED_SPLIT_FILES.map((file) => [file, YAML.parse(readFileSync(file, "utf8"))])
  );
}

function sortedOperationSignatures(doc) {
  const signatures = [];
  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    for (const method of Object.keys(pathItem || {}).filter((m) => METHODS.has(m))) {
      const op = pathItem[method] || {};
      signatures.push([
        method.toUpperCase(),
        pathKey,
        op.operationId || "",
        op["x-openai-isConsequential"] === true ? "consequential" : "non_consequential",
      ].join(" "));
    }
  }
  return signatures.sort();
}

function securitySchemeNames(doc) {
  return Object.keys(doc.components?.securitySchemes || {}).sort();
}

const specs = readGeneratedSpecs();
const splitScript = readFileSync("scripts/split-openapi.mjs", "utf8");

for (const file of GENERATED_SPLIT_FILES) {
  const signatures = sortedOperationSignatures(specs[file]);
  assert(signatures.length > 0, `${file} must contain generated operations`);
  assert(securitySchemeNames(specs[file]).length > 0, `${file} must contain security schemes`);
}

assert.deepStrictEqual(
  sortedOperationSignatures(specs["openapi.tenant-gpt.auth.yaml"]),
  sortedOperationSignatures(specs["openapi.custom-gpt.auth-dispatcher.yaml"]),
  "Tenant and auth dispatcher generated split artifacts must expose the same operation surface.",
);
assert.deepStrictEqual(
  securitySchemeNames(specs["openapi.tenant-gpt.auth.yaml"]),
  securitySchemeNames(specs["openapi.custom-gpt.auth-dispatcher.yaml"]),
  "Tenant and auth dispatcher generated split artifacts must expose the same security schemes.",
);

assert(splitScript.includes("tenant_operation_ids"), "split-openapi must select tenant operations from main config");
assert(splitScript.includes("x-tenant-gpt-operationId"), "split-openapi must support source-declared tenant aliases");
assert(splitScript.includes("validateUniqueTenantAliases"), "split-openapi must reject duplicate tenant operation aliases");
assert(splitScript.includes("validateSplitOperationsComeFromSource"), "split-openapi must validate generated split operations against main source");
assert(!splitScript.includes("YAML.parse(fs.readFileSync(tenantPath"), "split-openapi must not use tenant schema as the tenant source-of-truth");

console.log("openapi split regeneration operation parity tests passed");
