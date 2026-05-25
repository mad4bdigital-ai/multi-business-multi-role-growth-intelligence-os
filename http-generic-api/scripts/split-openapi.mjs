import fs from "fs";
import yaml from "js-yaml";
import path from "path";

// GPT schema architecture:
//   one server URL per action schema; never mix hosts in one dispatcher schema.
//   openapi.custom-gpt.auth-dispatcher.yaml  — admin dispatcher on auth.mad4b.com
//   openapi.tenant-gpt.auth.yaml             — tenant dispatcher on auth.mad4b.com
//   openapi.gpt-action.dev-dispatcher.yaml   — dev dispatcher on dev.mad4b.com
//   openapi.gpt-action.local-connector.yaml  — connector dispatcher on connector.mad4b.com
//
// Source-of-truth rule:
//   split schemas must be generated from operations present in openapi.yaml.
//   Tenant aliases use x-tenant-gpt-operationId on the main operation.
//
// Run: node scripts/split-openapi.mjs

const SOURCE_OPENAPI_FILE = "openapi.yaml";
const AUTH_DISPATCHER_SCHEMA_FILE = "openapi.custom-gpt.auth-dispatcher.yaml";
const TENANT_AUTH_SCHEMA_FILE = "openapi.tenant-gpt.auth.yaml";
const AUTH_DISPATCHER_HOST = "auth.mad4b.com";
const AUTH_DISPATCHER_TAGS = new Set(["activation", "admin-control", "system-layer"]);
const MAX_OPERATIONS = 30;
const METHOD_NAMES = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);
const CUSTOM_GPT_SECURITY_SCHEME = "backendBearerAuth";
const CUSTOM_GPT_DESCRIPTION_LIMIT = 300;
const CUSTOM_GPT_REQUIRED_SECURITY = [{ [CUSTOM_GPT_SECURITY_SCHEME]: [] }];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function collectOperations(doc) {
  const operations = [];
  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!METHOD_NAMES.has(method)) continue;
      const primaryTag = Array.isArray(operation.tags) && operation.tags.length > 0
        ? operation.tags[0]
        : "untagged";
      operations.push({ pathKey, pathItem, method, operation, primaryTag });
    }
  }
  return operations;
}

function tenantOperationId(operation) {
  return operation?.["x-tenant-gpt-operationId"] || operation?.operationId || null;
}

function countOperations(paths) {
  let n = 0;
  for (const pathItem of Object.values(paths || {})) {
    n += Object.keys(pathItem || {}).filter((m) => METHOD_NAMES.has(m)).length;
  }
  return n;
}

function collectTags(paths, tags = []) {
  const referenced = new Set();
  for (const pathItem of Object.values(paths || {})) {
    for (const operation of Object.values(pathItem || {})) {
      if (!operation || typeof operation !== "object" || !Array.isArray(operation.tags)) continue;
      for (const tag of operation.tags) referenced.add(tag);
    }
  }
  const known = tags.filter((t) => referenced.has(t.name));
  const knownNames = new Set(known.map((t) => t.name));
  const inferred = [...referenced].filter((n) => !knownNames.has(n)).sort().map((n) => ({ name: n }));
  return [...known, ...inferred];
}

function trimDescription(value) {
  if (typeof value !== "string" || value.length <= CUSTOM_GPT_DESCRIPTION_LIMIT) return value;
  return `${value.slice(0, CUSTOM_GPT_DESCRIPTION_LIMIT - 1).trimEnd()}.`;
}

function normalizeDescriptions(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const item of value) normalizeDescriptions(item); return; }
  if (typeof value.description === "string") value.description = trimDescription(value.description);
  for (const child of Object.values(value)) normalizeDescriptions(child);
}

function resolveLocalRef(doc, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
  const parts = ref.slice(2).split("/").map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current = doc;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) return null;
    current = current[part];
  }
  return current;
}

function normalizeRequestBody(doc, operation) {
  let schema = operation?.requestBody?.content?.["application/json"]?.schema;
  if (!schema || typeof schema !== "object") return;
  if (schema.$ref) {
    const resolved = resolveLocalRef(doc, schema.$ref);
    if (resolved) {
      schema = clone(resolved);
      operation.requestBody.content["application/json"].schema = schema;
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const obj = schema.oneOf.find((o) => o && typeof o === "object" && o.type === "object");
    if (obj) operation.requestBody.content["application/json"].schema = obj;
  }
  const paramNames = new Set(
    (operation.parameters || [])
      .filter((p) => p && typeof p === "object" && typeof p.name === "string")
      .map((p) => p.name)
  );
  if (schema.type === "object" && schema.properties && paramNames.size > 0) {
    for (const name of paramNames) delete schema.properties[name];
    if (Array.isArray(schema.required)) {
      schema.required = schema.required.filter((n) => !paramNames.has(n));
      if (schema.required.length === 0) delete schema.required;
    }
  }
}

function normalizeObjects(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const item of value) normalizeObjects(item); return; }
  if (value.type === "object" && !("properties" in value)) value.properties = {};
  for (const child of Object.values(value)) normalizeObjects(child);
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
  const refs = collectLocalRefs({ paths: doc.paths, components: { responses: doc.components?.responses || {} } });
  let changed = true;
  while (changed) {
    changed = false;
    for (const ref of Array.from(refs)) {
      const target = resolveLocalRef(doc, ref);
      const before = refs.size;
      collectLocalRefs(target, refs);
      if (refs.size !== before) changed = true;
    }
  }

  const keepSchemas = new Set(Array.from(refs).map((ref) => refName(ref, "#/components/schemas/")).filter(Boolean));
  const keepResponses = new Set(Array.from(refs).map((ref) => refName(ref, "#/components/responses/")).filter(Boolean));

  if (doc.components?.schemas) {
    doc.components.schemas = Object.fromEntries(
      Object.entries(doc.components.schemas).filter(([key]) => keepSchemas.has(key))
    );
  }
  if (doc.components?.responses) {
    doc.components.responses = Object.fromEntries(
      Object.entries(doc.components.responses).filter(([key]) => keepResponses.has(key))
    );
  }
}

function normalizeDoc(doc, sourceDoc) {
  if (doc.components?.securitySchemes) {
    doc.components.securitySchemes = { [CUSTOM_GPT_SECURITY_SCHEME]: doc.components.securitySchemes[CUSTOM_GPT_SECURITY_SCHEME] };
  }
  doc.security = clone(CUSTOM_GPT_REQUIRED_SECURITY);
  for (const pathItem of Object.values(doc.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!METHOD_NAMES.has(method) || !operation || typeof operation !== "object") continue;
      operation.security = clone(CUSTOM_GPT_REQUIRED_SECURITY);
      normalizeRequestBody(sourceDoc || doc, operation);
    }
  }
  pruneComponents(doc);
  normalizeDescriptions(doc);
  normalizeObjects(doc);
}

function buildDoc(sourceDoc, operations, { host, title, summary, description }) {
  const paths = {};
  for (const op of operations) {
    if (!paths[op.pathKey]) {
      paths[op.pathKey] = {};
      if (Array.isArray(op.pathItem.parameters)) paths[op.pathKey].parameters = clone(op.pathItem.parameters);
    }
    paths[op.pathKey][op.method] = clone(op.operation);
  }
  const doc = clone(sourceDoc);
  doc.info = { ...doc.info, title, summary, description };
  doc.servers = [{ url: `https://${host}`, description: title }];
  doc.tags = collectTags(paths, doc.tags || []);
  doc.paths = paths;
  delete doc["x-tenant-gpt-auth"];
  normalizeDoc(doc, sourceDoc);
  return doc;
}

function generateAuthDispatcher(sourceDoc, sourceOperations) {
  const operations = sourceOperations.filter((op) => AUTH_DISPATCHER_TAGS.has(op.primaryTag));
  if (operations.length === 0) {
    console.warn("No admin-control/activation/system-layer operations found — auth-dispatcher not generated.");
    return;
  }

  const doc = buildDoc(sourceDoc, operations, {
    host: AUTH_DISPATCHER_HOST,
    title: `${sourceDoc.info?.title || "Platform API"} - Auth Dispatcher Admin Control Actions`,
    summary: "Admin GPT action schema — MCP-like dispatcher for activation, admin control, and system layer.",
    description: `Single-host admin GPT schema generated from ${SOURCE_OPENAPI_FILE}. Dispatches activation, admin-control, and system-layer routes via ${AUTH_DISPATCHER_HOST}.`
  });

  validateSplitOperationsComeFromSource(doc, sourceDoc, AUTH_DISPATCHER_SCHEMA_FILE);
  const count = countOperations(doc.paths);
  const outPath = path.resolve(`./${AUTH_DISPATCHER_SCHEMA_FILE}`);
  fs.writeFileSync(outPath, yaml.dump(doc, { lineWidth: -1, noRefs: true }), "utf8");
  console.log(`Generated ${outPath} (${count} operations) -> https://${AUTH_DISPATCHER_HOST}`);
}

function buildDocFromTenantOperationIds(sourceDoc, sourceOperations, operationIds, { host, title, summary, description }) {
  const byTenantId = new Map();
  for (const op of sourceOperations) {
    const id = tenantOperationId(op.operation);
    if (id) byTenantId.set(id, op);
  }
  const missing = operationIds.filter((id) => !byTenantId.has(id));
  if (missing.length > 0) {
    throw new Error(`Configured tenant operationIds are missing from ${SOURCE_OPENAPI_FILE}: ${missing.join(", ")}`);
  }
  const operations = operationIds.map((id) => {
    const op = byTenantId.get(id);
    const cloned = { ...op, operation: clone(op.operation) };
    cloned.operation.operationId = id;
    delete cloned.operation["x-tenant-gpt-operationId"];
    return cloned;
  });
  return buildDoc(sourceDoc, operations, { host, title, summary, description });
}

function normalizeTenantDoc(doc, sourceDoc, config) {
  const schemeName = String(config.security_scheme_name || "userBearerAuth").trim();
  doc.components = doc.components || {};
  doc.components.securitySchemes = { [schemeName]: clone(config.security_scheme) };
  doc.security = clone(config.security);
  if (config.action_auth_preset && typeof config.action_auth_preset === "object") {
    doc["x-gpt-action-auth-preset"] = clone(config.action_auth_preset);
  }
  for (const pathItem of Object.values(doc.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!METHOD_NAMES.has(method) || !operation || typeof operation !== "object") continue;
      operation.security = clone(config.security);
      normalizeRequestBody(sourceDoc, operation);
    }
  }
  normalizeDescriptions(doc);
  normalizeObjects(doc);
}

function validateSplitOperationsComeFromSource(splitDoc, sourceDoc, schemaName) {
  const sourcePairs = new Set();
  const sourceIds = new Set();
  for (const op of collectOperations(sourceDoc)) {
    sourcePairs.add(`${op.method.toUpperCase()} ${op.pathKey}`);
    if (op.operation?.operationId) sourceIds.add(op.operation.operationId);
    const alias = tenantOperationId(op.operation);
    if (alias) sourceIds.add(alias);
  }
  const failures = [];
  for (const op of collectOperations(splitDoc)) {
    const pair = `${op.method.toUpperCase()} ${op.pathKey}`;
    const operationId = op.operation?.operationId;
    if (!sourcePairs.has(pair)) failures.push(`${schemaName}: split-only path/method ${pair}`);
    if (operationId && !sourceIds.has(operationId)) failures.push(`${schemaName}: split-only operationId ${operationId}`);
  }
  if (failures.length > 0) {
    throw new Error(`OpenAPI split governance failed: ${failures.join("; ")}`);
  }
}

function generateTenantAuthSchema(sourceDoc, sourceOperations) {
  const config = sourceDoc["x-tenant-gpt-auth"];
  if (!config || typeof config !== "object") throw new Error("x-tenant-gpt-auth missing from openapi.yaml.");
  if (!config.security_scheme || typeof config.security_scheme !== "object") throw new Error("x-tenant-gpt-auth.security_scheme required.");
  if (!Array.isArray(config.security) || config.security.length === 0) throw new Error("x-tenant-gpt-auth.security required.");
  if (!Array.isArray(config.tenant_operation_ids) || config.tenant_operation_ids.length === 0) {
    throw new Error("x-tenant-gpt-auth.tenant_operation_ids required. Tenant split schemas must be generated from main openapi.yaml operationIds or x-tenant-gpt-operationId aliases.");
  }

  const tenantOperationIds = config.tenant_operation_ids.map((id) => String(id).trim()).filter(Boolean);
  const schemaInfo = config.schema_info && typeof config.schema_info === "object" ? config.schema_info : {};
  const doc = buildDocFromTenantOperationIds(sourceDoc, sourceOperations, tenantOperationIds, {
    host: AUTH_DISPATCHER_HOST,
    title: schemaInfo.title || `${sourceDoc.info?.title || "Platform API"} - Tenant GPT Auth Actions`,
    summary: schemaInfo.summary || "Tenant GPT schema generated from main OpenAPI using x-tenant-gpt-auth.tenant_operation_ids.",
    description: schemaInfo.description || "Tenant MCP schema. Use connect_activate with tool_args.mode and integration_modes. Also supports Platform Plugin catalog, install, and resolve."
  });
  if (schemaInfo.version) doc.info.version = schemaInfo.version;
  if (config.server_description && doc.servers?.[0]) doc.servers[0].description = String(config.server_description);
  normalizeTenantDoc(doc, sourceDoc, config);
  validateSplitOperationsComeFromSource(doc, sourceDoc, TENANT_AUTH_SCHEMA_FILE);

  const count = countOperations(doc.paths);
  if (count > MAX_OPERATIONS) throw new Error(`${TENANT_AUTH_SCHEMA_FILE} has ${count} operations; max is ${MAX_OPERATIONS}.`);
  const tenantPath = path.resolve(`./${TENANT_AUTH_SCHEMA_FILE}`);
  fs.writeFileSync(tenantPath, yaml.dump(doc, { lineWidth: -1, noRefs: true }), "utf8");
  console.log(`Generated ${tenantPath} (${count} operations) -> ${doc.servers?.[0]?.url || "tenant auth"}`);
}

function main() {
  const openApiPath = path.resolve(`./${SOURCE_OPENAPI_FILE}`);
  if (!fs.existsSync(openApiPath)) { console.error(`Could not find ${SOURCE_OPENAPI_FILE}`); process.exit(1); }

  const sourceDoc = yaml.load(fs.readFileSync(openApiPath, "utf8"));
  const sourceOperations = collectOperations(sourceDoc);

  generateAuthDispatcher(sourceDoc, sourceOperations);
  generateTenantAuthSchema(sourceDoc, sourceOperations);

  console.log("\nDone. Active GPT schemas:");
  console.log("  openapi.custom-gpt.auth-dispatcher.yaml  — admin dispatcher (auth.mad4b.com)");
  console.log("  openapi.tenant-gpt.auth.yaml             — tenant dispatcher (auth.mad4b.com)");
  console.log("  openapi.gpt-action.dev-dispatcher.yaml   — dev dispatcher (dev.mad4b.com, hand-maintained)");
  console.log("  openapi.gpt-action.local-connector.yaml  — connector dispatcher (connector.mad4b.com, hand-maintained)");
}

main();
