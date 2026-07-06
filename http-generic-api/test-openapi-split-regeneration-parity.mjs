import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import YAML from "yaml";

const METHODS = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);
const registry = YAML.parse(readFileSync("../canonicals/openapi/custom-gpt-surfaces.yaml", "utf8"));

function loadSurface(surfaceKey) {
  const surface = registry.surfaces[surfaceKey];
  assert(surface, `missing registry surface ${surfaceKey}`);
  return YAML.parse(readFileSync(surface.output_file, "utf8"));
}

function operationSignatures(doc) {
  const signatures = new Set();
  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    for (const method of Object.keys(pathItem || {}).filter((name) => METHODS.has(name))) {
      const operation = pathItem[method] || {};
      signatures.add([
        method.toUpperCase(),
        pathKey,
        operation.operationId || "",
        operation["x-openai-isConsequential"] === true ? "consequential" : "non_consequential",
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

const adminCore = loadSurface("admin_core");
const adminActivation = loadSurface("activation_admin");
const tenantCore = loadSurface("tenant_core");
const tenantActivation = loadSurface("tenant_activation");
const splitScript = readFileSync("scripts/split-openapi.mjs", "utf8");
const orchestrator = readFileSync("scripts/generate-custom-gpt-schemas.mjs", "utf8");

const adminCoreOps = operationSignatures(adminCore);
const adminActivationOps = operationSignatures(adminActivation);
const tenantCoreOps = operationSignatures(tenantCore);
const tenantActivationOps = operationSignatures(tenantActivation);

for (const signature of [
  "GET /system/tools listSystemTools non_consequential",
  "POST /system/tools/call callSystemTool non_consequential",
  "GET /gpt/tools listAdminTools non_consequential",
  "POST /gpt/tools/call callAdminTool non_consequential",
  "GET /admin/system/tools listAdminSystemTools non_consequential",
  "POST /admin/system/tools/call callAdminSystemTool non_consequential",
]) {
  assertHasOperation(adminCoreOps, signature, "admin core artifact");
}

for (const signature of [
  "GET /activation/session-context getActivationSessionContext non_consequential",
  "GET /activation/hard-run/summary getActivationHardRunSummary non_consequential",
  "POST /activation/hard-run runHardActivation non_consequential",
  "GET /activation/platform-access getActivationPlatformAccess non_consequential",
]) {
  assertHasOperation(adminActivationOps, signature, "admin Activation artifact");
}

for (const signature of [
  "GET /system/tools listTools non_consequential",
  "POST /system/tools/call callTool non_consequential",
  "POST /gpt/sessions/{id}/turn writeSessionTurn non_consequential",
  "POST /gpt/sessions/{id}/end endSession non_consequential",
  "POST /tenant/platform/plugins/install tenantPlatformPluginInstall consequential",
]) {
  assertHasOperation(tenantCoreOps, signature, "tenant core artifact");
}

for (const signature of [
  "GET /tenant/activation/session-context activateSession non_consequential",
  "GET /tenant/activation/awareness readTenantActivationAwareness non_consequential",
  "GET /tenant/activation/operational-attention readTenantActivationOperationalAttention non_consequential",
  "GET /tenant/activation/dynamic-tabs/detail readTenantActivationDynamicTabDetail non_consequential",
]) {
  assertHasOperation(tenantActivationOps, signature, "tenant Activation artifact");
}

assert.equal([...adminCoreOps].some((signature) => signature.includes(" /activation/") || signature.includes(" /tenant/activation/")), false);
assert.equal([...tenantCoreOps].some((signature) => signature.includes(" /activation/") || signature.includes(" /tenant/activation/")), false);
assert.equal([...adminActivationOps].every((signature) => signature.includes(" /activation/")), true);
assert.equal([...tenantActivationOps].every((signature) => signature.includes(" /tenant/activation/")), true);

for (const [label, doc, scheme] of [
  ["admin core", adminCore, "backendBearerAuth"],
  ["admin Activation", adminActivation, "backendBearerAuth"],
  ["tenant core", tenantCore, "userBearerAuth"],
  ["tenant Activation", tenantActivation, "userBearerAuth"],
]) {
  assert(securitySchemeNames(doc).has(scheme), `${label} missing expected security scheme ${scheme}`);
}

assert.equal(adminCore.servers?.[0]?.url, "https://auth.mad4b.com");
assert.equal(tenantCore.servers?.[0]?.url, "https://auth.mad4b.com");
assert.equal(adminActivation.servers?.[0]?.url, "https://activation.mad4b.com");
assert.equal(tenantActivation.servers?.[0]?.url, "https://activation.mad4b.com");

assert(splitScript.includes("SURFACE_REGISTRY_FILE"));
assert(splitScript.includes("selectOperations"));
assert(splitScript.includes("validateGeneratedDoc"));
assert(splitScript.includes("validateUniqueTenantAliases"));
assert(orchestrator.includes("generatedSchemaArtifacts"));
assert(orchestrator.includes("generateGatewayPolicies"));
assert(orchestrator.includes("validateOpenApiFiles"));

console.log("OpenAPI surface regeneration parity tests passed.");
