import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import YAML from "yaml";

const METHOD_NAMES = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);
const REGISTRY_PATH = "../canonicals/openapi/custom-gpt-surfaces.yaml";
const registry = YAML.parse(readFileSync(REGISTRY_PATH, "utf8"));
const GENERATED_SURFACES = Object.entries(registry.surfaces)
  .filter(([, surface]) => surface.mode === "generated_from_openapi")
  .map(([surfaceKey, surface]) => ({ surfaceKey, ...surface }));

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

function schemaPath(file) {
  const relocated = `openapi/${file}`;
  if (existsSync(relocated)) return relocated;
  return file;
}

function loadYaml(file) {
  return YAML.parse(readFileSync(schemaPath(file), "utf8"));
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
const orchestrator = readFileSync("scripts/generate-custom-gpt-schemas.mjs", "utf8");

assert.equal(registry.version, 1);
assert.equal(GENERATED_SURFACES.length, 4, "registry must define four generated Core/Activation surfaces");
assert.equal(registry.surfaces.admin_core.server_url, "https://auth.mad4b.com");
assert.equal(registry.surfaces.tenant_core.server_url, "https://auth.mad4b.com");
assert.equal(registry.surfaces.activation_admin.server_url, "https://activation.mad4b.com");
assert.equal(registry.surfaces.tenant_activation.server_url, "https://activation.mad4b.com");
assert.equal(registry.surfaces.local_connector_admin.mode, "canonical_copy");
assert.equal(registry.surfaces.local_connector_admin.server_url, "https://connector.mad4b.com");
assert.equal(registry.gateway_policies.activation_gateway.upstream_origin, "https://auth.mad4b.com");

assert(mainText.includes("x-tenant-gpt-auth"), "main OpenAPI must retain the canonical tenant OAuth profile");
for (const requiredPath of [
  "/tenant/activation/session-context",
  "/tenant/platform/plugins/catalog",
  "/tenant/platform/plugins/install",
  "/tenant/platform/plugins/resolve",
]) {
  assert(mainText.includes(`${requiredPath}:`), `path must be declared in main OpenAPI: ${requiredPath}`);
}
for (const requiredAlias of ["activateSession", "listTools", "callTool", "writeSessionTurn", "endSession"]) {
  assert(mainText.includes(`x-tenant-gpt-operationId: ${requiredAlias}`), `tenant alias must be declared in main OpenAPI: ${requiredAlias}`);
}

for (const surface of GENERATED_SURFACES) {
  const doc = loadYaml(surface.output_file);
  const operations = collectOperations(doc);
  assert(operations.length > 0, `${surface.output_file} must contain operations`);
  assert.equal(doc.servers?.[0]?.url, surface.server_url, `${surface.surfaceKey} server must match registry`);
  assert(operations.length <= surface.hard_operation_limit, `${surface.surfaceKey} must remain below its hard operation limit`);

  for (const entry of operations) {
    const pair = `${entry.method.toUpperCase()} ${entry.pathKey}`;
    assert(mainText.includes(`${entry.pathKey}:`), `${surface.output_file} contains a split-only path: ${pair}`);
    const operationId = entry.operation?.operationId;
    assert(operationId, `${surface.output_file} operation must define operationId: ${pair}`);
    assert(
      mainText.includes(`operationId: ${operationId}`) || mainText.includes(`x-tenant-gpt-operationId: ${operationId}`),
      `${surface.output_file} contains a split-only operationId: ${operationId}`,
    );
  }

  for (const ref of collectRefs(doc)) {
    assert(ref.startsWith("#/"), `${surface.output_file} contains a non-local ref: ${ref}`);
    assert(resolveJsonPointer(doc, ref) !== undefined, `${surface.output_file} contains an unresolved local ref: ${ref}`);
  }
}

const adminCore = loadYaml(registry.surfaces.admin_core.output_file);
const tenantCore = loadYaml(registry.surfaces.tenant_core.output_file);
const adminActivation = loadYaml(registry.surfaces.activation_admin.output_file);
const tenantActivation = loadYaml(registry.surfaces.tenant_activation.output_file);
assert.equal(Object.keys(adminCore.paths).some((path) => path.startsWith("/activation") || path.startsWith("/tenant/activation")), false);
assert.equal(Object.keys(tenantCore.paths).some((path) => path.startsWith("/activation") || path.startsWith("/tenant/activation")), false);
assert.equal(Object.keys(adminActivation.paths).every((path) => path.startsWith("/activation")), true);
assert.equal(Object.keys(tenantActivation.paths).every((path) => path.startsWith("/tenant/activation")), true);

assert(splitScript.includes("SURFACE_REGISTRY_FILE"), "split generator must read the canonical surface registry");
assert(splitScript.includes("validateGeneratedDoc"), "split generator must validate generated operations against the source OpenAPI");
assert(splitScript.includes("validateUniqueTenantAliases"), "split generator must reject duplicate tenant aliases");
assert(splitScript.includes("selector.operation_ids") && splitScript.includes("selector.tenant_operation_ids") && splitScript.includes("selector.include_tags"));
assert(orchestrator.includes("generateGatewayPolicies"), "orchestrator must generate gateway policy from Activation surfaces");
assert(orchestrator.includes("materializeCanonicalCopies"), "orchestrator must materialize canonical-copy surfaces");
assert(!splitScript.includes("YAML.parse(fs.readFileSync(tenantPath"), "generated tenant artifacts must never become source-of-truth");

console.log("OpenAPI surface registry governance tests passed.");
