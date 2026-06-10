import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";

const SPLIT_SCHEMA_FILES = {
  tenant: "openapi.tenant-gpt.auth.yaml",
  admin: "openapi.custom-gpt.auth-dispatcher.yaml",
};
const METHODS = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);

function loadYaml(file) {
  return YAML.parse(readFileSync(file, "utf8"));
}

function operationSignatures(doc) {
  const signatures = new Set();
  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    for (const method of Object.keys(pathItem || {}).filter((m) => METHODS.has(m))) {
      const op = pathItem[method] || {};
      signatures.add([
        method.toUpperCase(),
        pathKey,
        op.operationId || "",
        op["x-openai-isConsequential"] === true ? "consequential" : "non_consequential",
      ].join(" "));
    }
  }
  return signatures;
}

function securitySchemeNames(doc) {
  return new Set(Object.keys(doc.components?.securitySchemes || {}));
}

function assertHasOperation(signatures, signature, label) {
  assert(signatures.has(signature), `${label} missing expected operation: ${signature}`);
}

function assertHasSecurityScheme(schemes, scheme, label) {
  assert(schemes.has(scheme), `${label} missing expected security scheme: ${scheme}`);
}

const tenantDoc = loadYaml(SPLIT_SCHEMA_FILES.tenant);
const adminDoc = loadYaml(SPLIT_SCHEMA_FILES.admin);
const tenantOps = operationSignatures(tenantDoc);
const adminOps = operationSignatures(adminDoc);
const tenantSchemes = securitySchemeNames(tenantDoc);
const adminSchemes = securitySchemeNames(adminDoc);
const splitScript = readFileSync("scripts/split-openapi.mjs", "utf8");

assert(tenantOps.size > 0, "tenant split artifact must contain operations");
assert(adminOps.size > 0, "admin/auth dispatcher split artifact must contain operations");

for (const signature of [
  "GET /activation/session-context activateSession non_consequential",
  "GET /system/tools listTools non_consequential",
  "POST /system/tools/call callTool non_consequential",
  "POST /gpt/sessions/{id}/turn writeSessionTurn non_consequential",
  "POST /gpt/sessions/{id}/end endSession non_consequential",
]) {
  assertHasOperation(tenantOps, signature, "tenant split artifact");
}

for (const signature of [
  "GET /activation/session-context getActivationSessionContext non_consequential",
  "GET /system/tools listSystemTools non_consequential",
  "POST /system/tools/call callSystemTool non_consequential",
  "GET /gpt/tools listAdminTools non_consequential",
  "POST /gpt/tools/call callAdminTool non_consequential",
  "GET /admin/system/tools listAdminSystemTools non_consequential",
  "POST /admin/system/tools/call callAdminSystemTool non_consequential",
]) {
  assertHasOperation(adminOps, signature, "admin/auth dispatcher split artifact");
}

for (const scheme of ["userBearerAuth"]) {
  assertHasSecurityScheme(tenantSchemes, scheme, "tenant split artifact");
}
for (const scheme of ["backendBearerAuth", "backendApiKeyAuth", "userBearerAuth"]) {
  assertHasSecurityScheme(adminSchemes, scheme, "admin/auth dispatcher split artifact");
}

assert(splitScript.includes("tenant_operation_ids"), "split-openapi must select tenant operations from main config");
assert(splitScript.includes("x-tenant-gpt-operationId"), "split-openapi must support source-declared tenant aliases");
assert(splitScript.includes("validateUniqueTenantAliases"), "split-openapi must reject duplicate tenant operation aliases");
assert(splitScript.includes("validateSplitOperationsComeFromSource"), "split-openapi must validate generated split operations against main source");
assert(!splitScript.includes("YAML.parse(fs.readFileSync(tenantPath"), "split-openapi must not use tenant schema as the tenant source-of-truth");

console.log("openapi split regeneration operation parity tests passed");
