import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(API_ROOT, "..");
const sourcePath = path.join(REPO_ROOT, "edge/activation-gateway/generated/route-policy.json");
const outputPath = path.join(REPO_ROOT, "edge/activation-gateway/generated/route-policy.staging.json");
const registryPath = path.join(REPO_ROOT, "canonicals/openapi/custom-gpt-surfaces.yaml");
const sourceOpenApiPath = path.join(API_ROOT, "openapi.yaml");
const METHOD_NAMES = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}
function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function collectDocOperations(doc) {
  const operations = [];
  for (const [pathKey, item] of Object.entries(doc.paths || {})) {
    for (const [method, operation] of Object.entries(item || {})) {
      if (!METHOD_NAMES.has(method)) continue;
      operations.push({ pathKey, method: method.toUpperCase(), operation });
    }
  }
  return operations;
}
function loadRegistry() {
  const registry = YAML.parse(fs.readFileSync(registryPath, "utf8"));
  if (!registry?.surfaces || !registry.registration_sets) throw new Error("Registry must define surfaces and registration_sets");
  return registry;
}
function registrationMembers(registry, surfaceKey) {
  const surface = registry.surfaces[surfaceKey];
  const set = surface?.registration_set ? registry.registration_sets[surface.registration_set] : null;
  return set?.output_surface === surfaceKey ? [...set.members] : [surfaceKey];
}
function effectiveSourceSurfaces(registry, surfaceKeys) {
  return [...new Set(surfaceKeys.flatMap((surfaceKey) => registrationMembers(registry, surfaceKey)))].sort();
}
function buildRoutes(registry, surfaceKeys, limits) {
  const byRoute = new Map();
  for (const surfaceKey of surfaceKeys) {
    const surface = registry.surfaces[surfaceKey];
    if (!surface) throw new Error(`Missing Staging route surface: ${surfaceKey}`);
    const schemaPath = path.join(API_ROOT, surface.output_file);
    if (!fs.existsSync(schemaPath)) throw new Error(`Missing generated Staging schema: ${surface.output_file}`);
    const doc = YAML.parse(fs.readFileSync(schemaPath, "utf8"));
    if (doc?.servers?.[0]?.url !== surface.server_url) throw new Error(`${surfaceKey}: generated schema server mismatch`);
    for (const { pathKey, method, operation } of collectDocOperations(doc)) {
      const key = `${method} ${pathKey}`;
      const embeddedSurface = operation?.["x-mad4b-embedded-surface"];
      const current = byRoute.get(key) || {
        ...limits,
        method,
        path: pathKey,
        mutation: !["GET", "HEAD"].includes(method),
        operation_ids: [],
        auth_profiles: [],
        surfaces: [],
        allowed_query_parameters: [],
      };
      current.operation_ids.push(operation.operationId);
      current.auth_profiles.push(surface.auth_profile);
      current.surfaces.push(surfaceKey);
      if (embeddedSurface) current.surfaces.push(embeddedSurface);
      current.allowed_query_parameters.push(...(operation.parameters || [])
        .filter((parameter) => parameter?.in === "query" && typeof parameter.name === "string")
        .map((parameter) => parameter.name));
      byRoute.set(key, current);
    }
  }
  return [...byRoute.values()]
    .map((route) => ({
      ...route,
      operation_ids: [...new Set(route.operation_ids)].sort(),
      auth_profiles: [...new Set(route.auth_profiles)].sort(),
      surfaces: [...new Set(route.surfaces)].sort(),
      allowed_query_parameters: [...new Set(route.allowed_query_parameters)].sort(),
    }))
    .sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}
function buildWarningBudget(registry, schemaSurfaceKeys) {
  return schemaSurfaceKeys.map((surfaceKey) => {
    const surface = registry.surfaces[surfaceKey];
    const schemaPath = path.join(API_ROOT, surface.output_file);
    const operationCount = collectDocOperations(YAML.parse(fs.readFileSync(schemaPath, "utf8"))).length;
    const warningLimit = Number(surface.warning_operation_limit || surface.hard_operation_limit || 30);
    return { surface: surfaceKey, operation_count: operationCount, warning_limit: warningLimit, exceeded: operationCount > warningLimit };
  }).sort((a, b) => a.surface.localeCompare(b.surface));
}
function payload(policy) {
  const { content_hash_sha256: _ignored, signature_algorithm: _algorithm, deployment_signature_required: _required, secrets_included: _secrets, ...rest } = policy;
  return rest;
}
function build() {
  const production = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const registry = loadRegistry();
  const limits = {
    request_body_limit_bytes: Number(production.request_body_limit_bytes),
    response_body_limit_bytes: Number(production.response_body_limit_bytes),
    timeout_ms: Number(production.timeout_ms),
  };
  const routeSurfaces = ["activation_admin_staging", "tenant_activation_staging"];
  const staging = {
    ...production,
    policy_key: "activation_gateway_staging",
    public_host: "activation-dev.mad4b.com",
    upstream_origin: "https://dev.mad4b.com",
    surface_registry_version: Number(registry.version),
    source_openapi_sha256: sha256(fs.readFileSync(sourceOpenApiPath, "utf8")),
    surface_registry_sha256: sha256(fs.readFileSync(registryPath, "utf8")),
    source_surfaces: effectiveSourceSurfaces(registry, routeSurfaces),
    warning_budget: buildWarningBudget(registry, routeSurfaces),
    routes: buildRoutes(registry, routeSurfaces, limits),
    deployment_signature_required: true,
    secrets_included: false,
  };
  const canonical = stableJson(payload(staging));
  staging.content_hash_sha256 = sha256(canonical);
  return stableJson(staging);
}

const output = build();
const write = process.argv.includes("--write");
const check = process.argv.includes("--check");
if (write === check) throw new Error("Use exactly one of --write or --check");
if (check) {
  const actual = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  if (actual !== output) throw new Error(`Staging policy drift: ${outputPath}`);
  console.log(JSON.stringify({ ok: true, mode: "check", output: outputPath, policy_key: "activation_gateway_staging" }));
} else {
  fs.writeFileSync(outputPath, output, "utf8");
  console.log(JSON.stringify({ ok: true, mode: "write", output: outputPath, policy_key: "activation_gateway_staging" }));
}
