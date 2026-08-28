import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(apiRoot, "..");
const registryPath = path.join(repoRoot, "canonicals/openapi/custom-gpt-surfaces.yaml");
const sourceOpenApiPath = path.join(apiRoot, "openapi.yaml");
const mutationRegistryPath = path.join(apiRoot, "openapi/openapi-mutation-policy.generated.json");
const sourceCoverageBaselinePath = path.join(apiRoot, "openapi/source-operation-coverage.baseline.json");
const inventoryPath = path.join(apiRoot, "remote-mcp-write-scope-inventory.generated.json");
const mutationArtifacts = [
  "openapi/openapi.custom-gpt.auth-dispatcher.yaml",
  "openapi/openapi.custom-gpt.activation-admin.yaml",
  "openapi/openapi.tenant-gpt.auth.yaml",
  "openapi/openapi.tenant-gpt.activation.yaml",
];
const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
const mutationMethods = new Set(["post", "put", "patch", "delete"]);
const expectedSharedSurfaceAllowlist = ["listSystemTools", "callSystemTool"];

function read(file) {
  return readFileSync(file, "utf8");
}

function loadYaml(file) {
  return parse(read(file));
}

function collectOperations(document) {
  const operations = [];
  for (const [routePath, pathItem] of Object.entries(document?.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!methods.has(method) || !operation || typeof operation !== "object") continue;
      operations.push({ path: routePath, method: method.toUpperCase(), operation });
    }
  }
  return operations;
}

function operationKey(operation) {
  return `${operation.method} ${operation.path} ${operation.operation?.operationId || ""}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  throw new Error(`[ci:path-guard] ${message}`);
}

const registry = loadYaml(registryPath);
const registryVersion = Number(registry.version);
assert.ok([2, 3].includes(registryVersion), "surface registry version must be 2 or the reviewed environment-aware version 3");
assert.deepEqual(
  registry.shared_surface_allowlist,
  expectedSharedSurfaceAllowlist,
  "shared_surface_allowlist changed; update requires an explicit reviewed guard change",
);
assert.equal(registry.source_openapi, "http-generic-api/openapi.yaml", "surface registry must point to canonical source OpenAPI");

const generatedSurfaces = Object.entries(registry.surfaces || {})
  .filter(([, surface]) => surface?.mode === "generated_from_openapi")
  .map(([surfaceKey, surface]) => ({ surfaceKey, ...surface }));
const baseSurfaceKeys = ["admin_core", "activation_admin", "tenant_core", "tenant_activation"];
const baseGeneratedSurfaces = generatedSurfaces.filter((surface) => !surface.base_surface);
const environmentGeneratedSurfaces = generatedSurfaces.filter((surface) => Boolean(surface.base_surface));
assert.deepEqual(
  baseGeneratedSurfaces.map((surface) => surface.surfaceKey).sort(),
  baseSurfaceKeys.slice().sort(),
  "base generated Custom GPT surfaces must remain the four reviewed canonical surfaces",
);
assert.equal(generatedSurfaces.length, 13, "environment-aware registry must contain four base surfaces, eight standard projections, and one private Production projection");
assert.equal(environmentGeneratedSurfaces.length, 9, "environment-aware registry must contain eight standard projections plus one private Production projection");
const privateProductionSurfaces = environmentGeneratedSurfaces.filter((surface) => surface.private_only === true);
assert.deepEqual(privateProductionSurfaces.map((surface) => surface.surfaceKey), ["admin_recovery_production"], "only the reviewed private Recovery projection may be private");
const projectionKeys = new Set();
for (const surface of environmentGeneratedSurfaces) {
  assert.ok(baseSurfaceKeys.includes(surface.base_surface), `${surface.surfaceKey} must derive from a reviewed base surface`);
  assert.ok(["staging", "production"].includes(surface.environment), `${surface.surfaceKey} must declare staging or production`);
  assert.equal(surface.private_only === true, surface.surfaceKey === "admin_recovery_production");
  const projectionKey = `${surface.base_surface}:${surface.environment}`;
  if (surface.private_only !== true) {
    assert(!projectionKeys.has(projectionKey), `${surface.surfaceKey} duplicates environment projection ${projectionKey}`);
    projectionKeys.add(projectionKey);
  } else {
    assert.equal(surface.environment, "production", `${surface.surfaceKey} private projection must be Production-only`);
  }
  assert.match(String(surface.output_file), new RegExp(`\\.${surface.environment}\\.yaml$`), `${surface.surfaceKey} output must be environment-specific`);
}
for (const baseSurfaceKey of baseSurfaceKeys) {
  for (const environment of ["staging", "production"]) {
    assert(projectionKeys.has(`${baseSurfaceKey}:${environment}`), `missing ${environment} projection for ${baseSurfaceKey}`);
  }
}
for (const surface of baseGeneratedSurfaces) {
  assert.equal(surface.candidate_policy?.mode, "marker_required", `${surface.surfaceKey} candidate policy must be marker_required`);
  assert.equal(surface.candidate_policy?.required_marker, surface.surfaceKey, `${surface.surfaceKey} required marker drifted`);
  assert.equal(surface.candidate_policy?.omission, "fail", `${surface.surfaceKey} omission policy must remain fail`);
  assert.deepEqual(surface.selector?.source_markers, [surface.surfaceKey], `${surface.surfaceKey} selector marker drifted`);
}

const source = loadYaml(sourceOpenApiPath);
const sourceOperations = collectOperations(source);
assert(sourceOperations.length > 0, "canonical source OpenAPI must contain operations");
const knownSurfaceKeys = new Set(generatedSurfaces.map((surface) => surface.surfaceKey));
const exclusionRecords = new Map();
for (const surface of generatedSurfaces) {
  for (const record of surface.candidate_policy?.exclusion_records || []) {
    const operationId = String(record.operation_id || "").trim();
    if (!operationId) fail(`${surface.surfaceKey} contains an exclusion record without operation_id`);
    const records = exclusionRecords.get(operationId) || [];
    records.push({ surface: surface.surfaceKey, record });
    exclusionRecords.set(operationId, records);
  }
}
const uncovered = [];
for (const entry of sourceOperations) {
  const operationId = String(entry.operation.operationId || "").trim();
  const markers = Array.isArray(entry.operation["x-custom-gpt-surfaces"])
    ? entry.operation["x-custom-gpt-surfaces"]
    : [];
  for (const marker of markers) {
    if (!knownSurfaceKeys.has(marker)) fail(`${operationId || operationKey(entry)} references unknown surface marker ${marker}`);
  }
  if (markers.length === 0 && !exclusionRecords.has(operationId)) {
    uncovered.push(`${entry.method} ${entry.path} ${operationId || "<missing-operation-id>"}`);
  }
}
const uncoveredKeys = uncovered.sort();
if (process.argv.includes("--write-baseline")) {
  writeFileSync(sourceCoverageBaselinePath, `${JSON.stringify({
    schema_version: 1,
    source_openapi: "http-generic-api/openapi.yaml",
    legacy_uncovered_operations: uncoveredKeys,
  }, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, baseline: path.relative(repoRoot, sourceCoverageBaselinePath), legacy_uncovered_count: uncoveredKeys.length }, null, 2));
  process.exit(0);
}
let baseline = { schema_version: 1, source_openapi: "http-generic-api/openapi.yaml", legacy_uncovered_operations: [] };
try { baseline = JSON.parse(readFileSync(sourceCoverageBaselinePath, "utf8")); } catch { fail("source-operation-coverage.baseline.json is missing; generate it deliberately with --write-baseline"); }
assert.equal(baseline.schema_version, 1, "source coverage baseline schema version must remain 1");
assert.equal(baseline.source_openapi, "http-generic-api/openapi.yaml", "source coverage baseline must point to canonical source OpenAPI");
const baselineKeys = new Set(baseline.legacy_uncovered_operations || []);
const currentUncoveredKeys = new Set(uncoveredKeys);
const unexpectedUncovered = uncoveredKeys.filter((operationKeyValue) => !baselineKeys.has(operationKeyValue));
const removedFromSource = [...baselineKeys].filter((operationId) => !currentUncoveredKeys.has(operationId));
if (unexpectedUncovered.length) fail(`new source OpenAPI operations without marker or exclusion record: ${unexpectedUncovered.join(", ")}`);
if (removedFromSource.length) fail(`source coverage baseline contains removed legacy operations; regenerate deliberately: ${removedFromSource.join(", ")}`);

const expectedMutations = [];
for (const relative of mutationArtifacts) {
  const document = loadYaml(path.join(apiRoot, relative));
  for (const entry of collectOperations(document)) {
    if (!mutationMethods.has(entry.method.toLowerCase())) continue;
    expectedMutations.push({
      surface: path.basename(relative, ".yaml"),
      artifact: relative,
      method: entry.method,
      path: entry.path,
      operation_id: String(entry.operation.operationId || "").trim(),
      effect_class: entry.method === "DELETE" || /(?:restore|transition|decide|apply|install|rotate|revoke|destroy|remove)/iu.test(entry.path) ? "destructive" : "internal_write",
      declared_security_scopes: Object.values(entry.operation.security?.[0]?.userBearerAuth || {})
        .map((scope) => String(scope).replace(/^https?:\/\/[^/]+\/scopes\//u, ""))
        .sort(),
      policy_status: "unbound",
      required_scope: null,
      reason: "No write scope is promoted; operation remains explicitly denied until independent resource-operation approval, capability, lease, and readback policy is reviewed.",
      owner: "platform-governance",
      review_after: "2026-09-30",
    });
  }
}
expectedMutations.sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
const mutationRegistry = JSON.parse(read(mutationRegistryPath));
const sourceFingerprint = sha256(mutationArtifacts.map((relative) => read(path.join(apiRoot, relative))).join("\n"));
assert.equal(mutationRegistry.source_fingerprint_sha256, sourceFingerprint, "operation registry source fingerprint is stale");
assert.equal(mutationRegistry.operation_count, expectedMutations.length, "operation registry mutation count drifted");
assert.equal(mutationRegistry.unbound_operation_count, expectedMutations.length, "all current mutations must remain explicitly unbound");
assert.equal(mutationRegistry.write_activation_allowed, false, "CI path guard must never allow write activation");
assert.deepEqual(mutationRegistry.operations, expectedMutations, "operation registry is stale or mutation policy changed without regeneration");
const registryKeys = new Set((mutationRegistry.operations || []).map((operation) => `${operation.method} ${operation.path} ${operation.operation_id}`));
const missingMutations = expectedMutations.filter((operation) => !registryKeys.has(`${operation.method} ${operation.path} ${operation.operation_id}`));
if (missingMutations.length) fail(`mutations outside operation registry: ${missingMutations.map((operation) => `${operation.method} ${operation.path} ${operation.operation_id}`).join(", ")}`);

const inventory = JSON.parse(read(inventoryPath));
assert.equal(inventory.unclassified_write_route_count, 0, "unclassified_write_route_count must remain zero");
assert.equal(inventory.readiness?.write_activation_allowed, false, "write activation must remain disabled in inventory");
execFileSync(process.execPath, [path.join(repoRoot, "scripts/remote-mcp-write-scope-semantic-currentness.mjs")], {
  cwd: repoRoot,
  stdio: "inherit",
});

console.log(JSON.stringify({
  ok: true,
  source_operation_count: sourceOperations.length,
  generated_surface_count: generatedSurfaces.length,
  operation_registry_mutation_count: expectedMutations.length,
  unclassified_write_route_count: inventory.unclassified_write_route_count,
  write_activation_allowed: false,
}, null, 2));
