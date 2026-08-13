import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { assertOpenApiResponseObjects } from "./openapi-response-object-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(API_ROOT, "..");
const SOURCE_OPENAPI_FILE = path.join(API_ROOT, "openapi.yaml");
const SURFACE_REGISTRY_FILE = path.join(REPO_ROOT, "canonicals", "openapi", "custom-gpt-surfaces.yaml");
const METHOD_NAMES = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);
const DESCRIPTION_LIMIT = 300;
const SOURCE_OPENAPI_SHA256 = createHash("sha256").update(fs.readFileSync(SOURCE_OPENAPI_FILE, "utf8")).digest("hex");
const SURFACE_REGISTRY_SHA256 = createHash("sha256").update(fs.readFileSync(SURFACE_REGISTRY_FILE, "utf8")).digest("hex");

function cliValue(name) {
  const inline = process.argv.find((arg) => String(arg).startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const OUTPUT_DIR = path.resolve(cliValue("--output-dir") || API_ROOT);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function outputPath(file) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const target = path.join(OUTPUT_DIR, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return target;
}

function collectOperations(doc) {
  const operations = [];
  let sourceIndex = 0;
  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!METHOD_NAMES.has(method)) continue;
      const primaryTag = Array.isArray(operation.tags) && operation.tags.length > 0
        ? operation.tags[0]
        : "untagged";
      operations.push({ pathKey, pathItem, method, operation, primaryTag, sourceIndex });
      sourceIndex += 1;
    }
  }
  return operations;
}

function tenantOperationId(operation) {
  return operation?.["x-tenant-gpt-operationId"] || operation?.operationId || null;
}

function validateUniqueTenantAliases(sourceOperations) {
  const byAlias = new Map();
  for (const entry of sourceOperations) {
    const alias = entry.operation?.["x-tenant-gpt-operationId"];
    if (!alias) continue;
    const list = byAlias.get(alias) || [];
    list.push(`${entry.method.toUpperCase()} ${entry.pathKey}`);
    byAlias.set(alias, list);
  }
  const duplicates = [...byAlias.entries()].filter(([, entries]) => entries.length > 1);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate tenant aliases: ${duplicates.map(([id, entries]) => `${id} => ${entries.join(", ")}`).join("; ")}`);
  }
}

function countOperations(paths) {
  let count = 0;
  for (const item of Object.values(paths || {})) {
    count += Object.keys(item || {}).filter((method) => METHOD_NAMES.has(method)).length;
  }
  return count;
}

function collectTags(paths, sourceTags = []) {
  const names = new Set();
  for (const item of Object.values(paths || {})) {
    for (const [method, operation] of Object.entries(item || {})) {
      if (!METHOD_NAMES.has(method) || !Array.isArray(operation?.tags)) continue;
      for (const tag of operation.tags) names.add(tag);
    }
  }
  const known = sourceTags.filter((entry) => names.has(entry.name));
  const knownNames = new Set(known.map((entry) => entry.name));
  return [...known, ...[...names].filter((name) => !knownNames.has(name)).sort().map((name) => ({ name }))];
}

function resolveLocalRef(doc, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
  const parts = ref.slice(2).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current = doc;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) return null;
    current = current[part];
  }
  return current;
}

function collectLocalRefs(value, refs = new Set()) {
  if (!value || typeof value !== "object") return refs;
  if (Array.isArray(value)) {
    for (const item of value) collectLocalRefs(item, refs);
    return refs;
  }
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/")) refs.add(value.$ref);
  for (const child of Object.values(value)) collectLocalRefs(child, refs);
  return refs;
}

function refName(ref, prefix) {
  return ref.startsWith(prefix) ? ref.slice(prefix.length).split("/")[0] : null;
}

function pruneComponents(doc) {
  const refs = collectLocalRefs({ paths: doc.paths, responses: doc.components?.responses || {} });
  let changed = true;
  while (changed) {
    changed = false;
    for (const ref of [...refs]) {
      const before = refs.size;
      collectLocalRefs(resolveLocalRef(doc, ref), refs);
      if (refs.size !== before) changed = true;
    }
  }
  const schemaNames = new Set([...refs].map((ref) => refName(ref, "#/components/schemas/")).filter(Boolean));
  const responseNames = new Set([...refs].map((ref) => refName(ref, "#/components/responses/")).filter(Boolean));
  if (doc.components?.schemas) {
    doc.components.schemas = Object.fromEntries(Object.entries(doc.components.schemas).filter(([name]) => schemaNames.has(name)));
  }
  if (doc.components?.responses) {
    doc.components.responses = Object.fromEntries(Object.entries(doc.components.responses).filter(([name]) => responseNames.has(name)));
  }
}

function trimDescriptions(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) trimDescriptions(item);
    return;
  }
  if (typeof value.description === "string" && value.description.length > DESCRIPTION_LIMIT) {
    value.description = `${value.description.slice(0, DESCRIPTION_LIMIT - 1).trimEnd()}.`;
  }
  for (const child of Object.values(value)) trimDescriptions(child);
}

function normalizeObjects(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) normalizeObjects(item);
    return;
  }
  if (value.type === "object" && !("properties" in value)) value.properties = {};
  for (const child of Object.values(value)) normalizeObjects(child);
}

function normalizeRequestBody(sourceDoc, operation) {
  let schema = operation?.requestBody?.content?.["application/json"]?.schema;
  if (!schema || typeof schema !== "object") return;
  if (schema.$ref) {
    const resolved = resolveLocalRef(sourceDoc, schema.$ref);
    if (resolved) {
      schema = clone(resolved);
      operation.requestBody.content["application/json"].schema = schema;
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const objectSchema = schema.oneOf.find((candidate) => candidate?.type === "object");
    if (objectSchema) {
      schema = clone(objectSchema);
      operation.requestBody.content["application/json"].schema = schema;
    }
  }
  const parameterNames = new Set((operation.parameters || [])
    .filter((parameter) => parameter && typeof parameter.name === "string")
    .map((parameter) => parameter.name));
  if (schema.type === "object" && schema.properties && parameterNames.size > 0) {
    for (const name of parameterNames) delete schema.properties[name];
    if (Array.isArray(schema.required)) {
      schema.required = schema.required.filter((name) => !parameterNames.has(name));
      if (schema.required.length === 0) delete schema.required;
    }
  }
}

function normalizeTenantToolCallBody(operation) {
  if (operation?.operationId !== "callTool") return;
  const schema = operation.requestBody?.content?.["application/json"]?.schema;
  if (schema?.type === "object" && schema.properties) delete schema.properties.arguments;
}

function applyTenantOAuthEndpointOverride(doc, surface) {
  const override = surface.oauth_endpoints;
  if (!override) return;

  const authorizationUrl = String(override.authorization_url || "");
  const tokenUrl = String(override.token_url || "");
  if (!authorizationUrl || !tokenUrl) {
    throw new Error("tenant OAuth endpoint override requires authorization_url and token_url");
  }
  for (const [label, value] of [["authorization_url", authorizationUrl], ["token_url", tokenUrl]]) {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.search || parsed.hash) {
      throw new Error(`tenant OAuth ${label} must be an HTTPS URL without query or fragment`);
    }
  }

  const scheme = Object.values(doc.components?.securitySchemes || {})[0];
  const flow = scheme?.flows?.authorizationCode;
  if (!flow) throw new Error("tenant OAuth authorizationCode flow is missing");
  flow.authorizationUrl = authorizationUrl;
  flow.tokenUrl = tokenUrl;

  if (doc["x-gpt-action-auth-preset"]) {
    doc["x-gpt-action-auth-preset"].authorization_url = authorizationUrl;
    doc["x-gpt-action-auth-preset"].token_url = tokenUrl;
  }
}

function pathMatchesPrefix(pathKey, prefix) {
  const normalizedPath = String(pathKey || "");
  const normalizedPrefix = String(prefix || "").replace(/\/+$/u, "") || "/";
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

function orderSelectedOperations(entries, surface = {}) {
  const orderIds = Array.isArray(surface.selector?.order_operation_ids) ? surface.selector.order_operation_ids : [];
  if (!orderIds.length) return entries;
  const rank = new Map(orderIds.map((operationId, index) => [operationId, index]));
  return [...entries].sort((left, right) => {
    const leftOperationId = tenantOperationId(left.operation);
    const rightOperationId = tenantOperationId(right.operation);
    const leftRank = rank.has(leftOperationId) ? rank.get(leftOperationId) : Number.MAX_SAFE_INTEGER;
    const rightRank = rank.has(rightOperationId) ? rank.get(rightOperationId) : Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return Number(left.sourceIndex || 0) - Number(right.sourceIndex || 0);
  });
}

function cloneOperationEntries(entries, surface = {}) {
  return orderSelectedOperations(entries, surface).map((entry) => {
    const operation = clone(entry.operation);
    if (surface.auth_profile === "tenant_oauth" && operation?.["x-tenant-gpt-operationId"]) {
      operation.operationId = operation["x-tenant-gpt-operationId"];
      delete operation["x-tenant-gpt-operationId"];
    }
    return { ...entry, operation };
  });
}

function selectCoverageOperations(sourceOperations, surfaceKey, surface) {
  const coverage = surface.selector?.coverage || {};
  const selected = sourceOperations.filter((entry) => {
    const includeTags = Array.isArray(coverage.include_tags) ? coverage.include_tags : [];
    const includePrefixes = Array.isArray(coverage.include_path_prefixes) ? coverage.include_path_prefixes : [];
    const tagMatch = includeTags.length > 0 && includeTags.includes(entry.primaryTag);
    const prefixMatch = includePrefixes.length > 0 && includePrefixes.some((prefix) => pathMatchesPrefix(entry.pathKey, prefix));
    if (includeTags.length === 0 && includePrefixes.length === 0) return false;
    if (!tagMatch && !prefixMatch) return false;
    if (Array.isArray(coverage.exclude_path_prefixes) && coverage.exclude_path_prefixes.some((prefix) => pathMatchesPrefix(entry.pathKey, prefix))) return false;
    if (coverage.respect_source_exclusions !== false && (entry.operation?.["x-custom-gpt-exclude"] === true || entry.operation?.["x-gpt-action-exclude"] === true)) return false;
    return true;
  });
  if (selected.length === 0) throw new Error(`${surfaceKey}: coverage selector matched no source operations`);
  return selected;
}

function validateCandidatePolicy(sourceOperations, surfaceKey, surface) {
  const policy = surface.candidate_policy;
  if (!policy || policy.mode !== "marker_required" || policy.omission !== "fail") {
    throw new Error(`${surfaceKey}: candidate_policy must use marker_required mode with omission=fail`);
  }
  const requiredMarker = String(policy.required_marker || "").trim();
  const candidateTags = new Set(Array.isArray(policy.candidate_tags) ? policy.candidate_tags.map((tag) => String(tag).trim()).filter(Boolean) : []);
  const sourceMarkers = new Set(surface.selector?.source_markers || []);
  if (!requiredMarker || !sourceMarkers.has(requiredMarker)) {
    throw new Error(`${surfaceKey}: candidate_policy.required_marker must be present in selector.source_markers`);
  }
  if (candidateTags.size === 0) throw new Error(`${surfaceKey}: candidate_policy.candidate_tags must be non-empty`);
  if (!Array.isArray(policy.exclusion_records)) throw new Error(`${surfaceKey}: candidate_policy.exclusion_records must be an array`);
  const exclusions = new Map();
  for (const exclusion of policy.exclusion_records) {
    if (!exclusion?.operation_id || !exclusion?.reason || !exclusion?.owner || !exclusion?.review_after) {
      throw new Error(`${surfaceKey}: every candidate exclusion record requires operation_id, reason, owner, and review_after`);
    }
    if (exclusions.has(exclusion.operation_id)) throw new Error(`${surfaceKey}: duplicate candidate exclusion ${exclusion.operation_id}`);
    exclusions.set(exclusion.operation_id, exclusion);
  }
  const candidates = sourceOperations.filter((entry) => (entry.operation?.tags || []).some((tag) => candidateTags.has(tag)));
  if (candidates.length === 0) throw new Error(`${surfaceKey}: candidate policy tags have no source candidates`);
  const unresolved = candidates.filter((entry) => {
    const operationId = entry.operation?.operationId;
    return !(entry.operation?.["x-custom-gpt-surfaces"] || []).includes(requiredMarker) && !exclusions.has(operationId);
  });
  if (unresolved.length > 0) {
    throw new Error(`${surfaceKey}: unmapped candidates: ${unresolved.map((entry) => entry.operation?.operationId).join(", ")}`);
  }
  const invalidExclusions = [...exclusions.keys()].filter((operationId) => !candidates.some((entry) => entry.operation?.operationId === operationId));
  if (invalidExclusions.length > 0) throw new Error(`${surfaceKey}: exclusions are not candidates: ${invalidExclusions.join(", ")}`);
  const marked = sourceOperations.filter((entry) => (entry.operation?.["x-custom-gpt-surfaces"] || []).includes(requiredMarker));
  if (marked.length === 0) throw new Error(`${surfaceKey}: candidate policy marker has no source candidates`);
}

function validateMarkerOverlapAllowlist(sourceOperations, registry) {
  const allowlist = new Set(Array.isArray(registry.shared_surface_allowlist) ? registry.shared_surface_allowlist : []);
  const overlaps = [];
  for (const entry of sourceOperations) {
    const markers = Array.isArray(entry.operation?.["x-custom-gpt-surfaces"]) ? entry.operation["x-custom-gpt-surfaces"] : [];
    if (markers.length <= 1) continue;
    const operationId = entry.operation?.operationId || tenantOperationId(entry.operation);
    overlaps.push(operationId);
    if (!allowlist.has(operationId)) {
      throw new Error(`Marker overlap is not allowlisted: ${operationId}`);
    }
  }
  for (const operationId of allowlist) {
    if (!overlaps.includes(operationId)) throw new Error(`Shared surface allowlist entry has no marker overlap: ${operationId}`);
  }
}

function validateSourceMarkerCoverage(sourceOperations, surfaceKey, surface) {
  validateCandidatePolicy(sourceOperations, surfaceKey, surface);
  const markers = new Set(surface.selector?.source_markers || []);
  if (!markers.size) return;
  if (!markers.has(surfaceKey)) throw new Error(`${surfaceKey}: source_markers must include the surface key`);
  if (!surface.selector?.coverage) return;
  const coverage = selectCoverageOperations(sourceOperations, surfaceKey, surface);
  const missingMarkers = coverage.filter((entry) => !(entry.operation?.["x-custom-gpt-surfaces"] || []).includes(surfaceKey));
  const markerOnly = sourceOperations.filter((entry) => (entry.operation?.["x-custom-gpt-surfaces"] || []).includes(surfaceKey));
  const outsideCoverage = markerOnly.filter((entry) => !coverage.some((candidate) => candidate.pathKey === entry.pathKey && candidate.method === entry.method));
  if (missingMarkers.length > 0 || outsideCoverage.length > 0) {
    const missing = missingMarkers.map((entry) => `${entry.method.toUpperCase()} ${entry.pathKey}`).join(", ");
    const extra = outsideCoverage.map((entry) => `${entry.method.toUpperCase()} ${entry.pathKey}`).join(", ");
    throw new Error(`${surfaceKey}: source marker coverage drift; missing=[${missing}] outside_coverage=[${extra}]`);
  }
}

function selectOperations(sourceOperations, surfaceKey, surface) {
  const selector = surface.selector || {};
  if (Array.isArray(selector.source_markers)) {
    validateSourceMarkerCoverage(sourceOperations, surfaceKey, surface);
    const markerSet = new Set(selector.source_markers);
    return cloneOperationEntries(sourceOperations.filter((entry) => (entry.operation?.["x-custom-gpt-surfaces"] || []).some((marker) => markerSet.has(marker))), surface);
  }
  if (Array.isArray(selector.operation_ids)) {
    const byId = new Map(sourceOperations.map((entry) => [entry.operation?.operationId, entry]));
    const missing = selector.operation_ids.filter((id) => !byId.has(id));
    if (missing.length > 0) throw new Error(`${surfaceKey}: source operationIds missing: ${missing.join(", ")}`);
    return selector.operation_ids.map((id) => ({ ...byId.get(id), operation: clone(byId.get(id).operation) }));
  }
  if (Array.isArray(selector.tenant_operation_ids)) {
    const byTenantId = new Map();
    for (const entry of sourceOperations) {
      const id = tenantOperationId(entry.operation);
      if (id) byTenantId.set(id, entry);
    }
    const missing = selector.tenant_operation_ids.filter((id) => !byTenantId.has(id));
    if (missing.length > 0) throw new Error(`${surfaceKey}: tenant operationIds missing: ${missing.join(", ")}`);
    return selector.tenant_operation_ids.map((id) => {
      const source = byTenantId.get(id);
      const entry = { ...source, operation: clone(source.operation) };
      entry.operation.operationId = id;
      delete entry.operation["x-tenant-gpt-operationId"];
      return entry;
    });
  }
  if (Array.isArray(selector.include_tags)) {
    const tags = new Set(selector.include_tags);
    const respectExclusions = selector.respect_source_exclusions !== false;
    return sourceOperations
      .filter((entry) => tags.has(entry.primaryTag))
      .filter((entry) => !respectExclusions || (entry.operation?.["x-custom-gpt-exclude"] !== true && entry.operation?.["x-gpt-action-exclude"] !== true))
      .map((entry) => ({ ...entry, operation: clone(entry.operation) }));
  }
  throw new Error(`${surfaceKey}: selector must define source_markers, operation_ids, tenant_operation_ids, or include_tags`);
}

function applySecurityProfile(doc, sourceDoc, surface) {
  doc.components = doc.components || {};
  if (surface.auth_profile === "admin_service") {
    const sourceScheme = sourceDoc.components?.securitySchemes?.backendBearerAuth;
    if (!sourceScheme) throw new Error("backendBearerAuth missing from source OpenAPI");
    doc.components.securitySchemes = { backendBearerAuth: clone(sourceScheme) };
    doc.security = [{ backendBearerAuth: [] }];
    for (const item of Object.values(doc.paths || {})) {
      for (const [method, operation] of Object.entries(item || {})) {
        if (METHOD_NAMES.has(method)) operation.security = [{ backendBearerAuth: [] }];
      }
    }
    return;
  }
  if (surface.auth_profile === "tenant_oauth") {
    const tenantConfig = sourceDoc["x-tenant-gpt-auth"];
    if (!tenantConfig?.security_scheme || !Array.isArray(tenantConfig.security)) {
      throw new Error("x-tenant-gpt-auth security configuration missing from source OpenAPI");
    }
    const schemeName = String(tenantConfig.security_scheme_name || "userBearerAuth");
    doc.components.securitySchemes = { [schemeName]: clone(tenantConfig.security_scheme) };
    doc.security = clone(tenantConfig.security);
    if (tenantConfig.action_auth_preset) doc["x-gpt-action-auth-preset"] = clone(tenantConfig.action_auth_preset);
    applyTenantOAuthEndpointOverride(doc, surface);
    for (const item of Object.values(doc.paths || {})) {
      for (const [method, operation] of Object.entries(item || {})) {
        if (!METHOD_NAMES.has(method)) continue;
        operation.security = clone(tenantConfig.security);
        normalizeTenantToolCallBody(operation);
      }
    }
    return;
  }
  throw new Error(`Unsupported generated auth profile: ${surface.auth_profile}`);
}

function buildSurfaceDoc(sourceDoc, selectedOperations, surfaceKey, surface, registry) {
  const paths = {};
  for (const entry of selectedOperations) {
    if (!paths[entry.pathKey]) {
      paths[entry.pathKey] = {};
      if (Array.isArray(entry.pathItem.parameters)) paths[entry.pathKey].parameters = clone(entry.pathItem.parameters);
    }
    paths[entry.pathKey][entry.method] = clone(entry.operation);
    delete paths[entry.pathKey][entry.method]["x-custom-gpt-surfaces"];
  }
  const doc = clone(sourceDoc);
  doc.info = {
    ...doc.info,
    title: surface.info?.title || `${sourceDoc.info?.title || "Platform API"} - ${surfaceKey}`,
    summary: surface.info?.summary || `Generated ${surfaceKey} Custom GPT surface.`,
    description: surface.info?.description || `Generated from ${path.relative(REPO_ROOT, SOURCE_OPENAPI_FILE)} and ${path.relative(REPO_ROOT, SURFACE_REGISTRY_FILE)}.`,
  };
  doc.servers = [{ url: surface.server_url, description: `${surfaceKey} surface` }];
  const operationCount = selectedOperations.length;
  const warningLimit = Number(surface.warning_operation_limit || surface.hard_operation_limit || 30);
  doc["x-custom-gpt-generation"] = {
    generator: "http-generic-api/scripts/split-openapi.mjs",
    source_openapi: path.relative(REPO_ROOT, SOURCE_OPENAPI_FILE),
    source_openapi_sha256: SOURCE_OPENAPI_SHA256,
    registry_file: path.relative(REPO_ROOT, SURFACE_REGISTRY_FILE),
    registry_sha256: SURFACE_REGISTRY_SHA256,
    registry_version: Number(registry.version || 1),
    selector_model: surface.candidate_policy?.mode || "unspecified",
    candidate_policy: surface.candidate_policy || null,
    operation_count: operationCount,
    warning_operation_limit: warningLimit,
    warning_budget_exceeded: operationCount > warningLimit,
    hard_operation_limit: Number(surface.hard_operation_limit || 30),
    secrets_included: false,
  };
  doc.paths = paths;
  doc.tags = collectTags(paths, sourceDoc.tags || []);
  delete doc["x-tenant-gpt-auth"];
  for (const item of Object.values(doc.paths || {})) {
    for (const [method, operation] of Object.entries(item || {})) {
      if (!METHOD_NAMES.has(method)) continue;
      normalizeRequestBody(sourceDoc, operation);
    }
  }
  applySecurityProfile(doc, sourceDoc, surface);
  pruneComponents(doc);
  trimDescriptions(doc);
  normalizeObjects(doc);
  return doc;
}

function validateGeneratedDoc(doc, sourceDoc, surfaceKey, surface) {
  assertOpenApiResponseObjects(doc, { source: surface.output_file || surfaceKey });
  const sourcePairs = new Set(collectOperations(sourceDoc).map((entry) => `${entry.method.toUpperCase()} ${entry.pathKey}`));
  const seenIds = new Set();
  for (const entry of collectOperations(doc)) {
    const pair = `${entry.method.toUpperCase()} ${entry.pathKey}`;
    if (!sourcePairs.has(pair)) throw new Error(`${surfaceKey}: generated path/method not in source: ${pair}`);
    const id = entry.operation?.operationId;
    if (!id) throw new Error(`${surfaceKey}: missing operationId for ${pair}`);
    if (seenIds.has(id)) throw new Error(`${surfaceKey}: duplicate operationId ${id}`);
    seenIds.add(id);
  }
  const count = countOperations(doc.paths);
  const hardLimit = Number(surface.hard_operation_limit || 30);
  const warningLimit = Number(surface.warning_operation_limit || hardLimit);
  if (count > hardLimit) throw new Error(`${surfaceKey}: ${count} operations exceeds hard limit ${hardLimit}`);
  if (count > warningLimit) console.warn(`${surfaceKey}: ${count} operations exceeds warning limit ${warningLimit}`);
  return count;
}

function generateConfiguredSurfaces(sourceDoc, sourceOperations, registry) {
  validateMarkerOverlapAllowlist(sourceOperations, registry);
  const generated = [];
  for (const [surfaceKey, surface] of Object.entries(registry.surfaces || {})) {
    if (surface.mode !== "generated_from_openapi") continue;
    const selected = selectOperations(sourceOperations, surfaceKey, surface);
    const doc = buildSurfaceDoc(sourceDoc, selected, surfaceKey, surface, registry);
    const count = validateGeneratedDoc(doc, sourceDoc, surfaceKey, surface);
    const target = outputPath(surface.output_file);
    fs.writeFileSync(target, YAML.stringify(doc, { lineWidth: -1, aliasDuplicateObjects: false }), "utf8");
    generated.push({ surfaceKey, file: surface.output_file, server: surface.server_url, count, authProfile: surface.auth_profile });
    console.log(`Generated ${target} (${count} operations) -> ${surface.server_url}`);
  }
  return generated;
}

function main() {
  if (!fs.existsSync(SOURCE_OPENAPI_FILE)) throw new Error(`Missing ${SOURCE_OPENAPI_FILE}`);
  if (!fs.existsSync(SURFACE_REGISTRY_FILE)) throw new Error(`Missing ${SURFACE_REGISTRY_FILE}`);
  const sourceDoc = YAML.parse(fs.readFileSync(SOURCE_OPENAPI_FILE, "utf8"));
  assertOpenApiResponseObjects(sourceDoc, { source: path.relative(REPO_ROOT, SOURCE_OPENAPI_FILE) });
  const registry = YAML.parse(fs.readFileSync(SURFACE_REGISTRY_FILE, "utf8"));
  validateUniqueTenantAliases(collectOperations(sourceDoc));
  const generated = generateConfiguredSurfaces(sourceDoc, collectOperations(sourceDoc), registry);
  console.log(`\nGenerated ${generated.length} registry-owned OpenAPI surfaces.`);
  for (const item of generated) console.log(`  ${item.file} - ${item.surfaceKey} (${item.authProfile}, ${item.count} operations)`);
  console.log("  openapi.gpt-action.local-connector.yaml - copied from canonicals/openapi/local-connector.openapi.yaml by the schema orchestrator");
  console.log("  openapi.gpt-action.dev-dispatcher.yaml - externally managed development surface");
}

main();
