import fs from "fs";
import yaml from "js-yaml";
import path from "path";

const SOURCE_OPENAPI_FILE = "openapi.yaml";
const OUTPUT_PREFIX = "openapi.custom-gpt";
const AUTH_DISPATCHER_SCHEMA_FILE = `${OUTPUT_PREFIX}.auth-dispatcher.yaml`;
const MAX_OPERATIONS_PER_SCHEMA = 29;
const METHOD_NAMES = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);
const DEDICATED_SCOPE_TAGS = new Set(["admin-control"]);
const CUSTOM_GPT_SECURITY_SCHEME = "backendBearerAuth";
const CUSTOM_GPT_DESCRIPTION_LIMIT = 300;
const CUSTOM_GPT_REQUIRED_SECURITY = [{ [CUSTOM_GPT_SECURITY_SCHEME]: [] }];

const SERVER_SCOPES = [
  { slug: "runtime", host: "api.mad4b.com", title: "Runtime Governed Actions" },
  { slug: "identity", host: "identity.mad4b.com", title: "Identity And Access Actions" },
  { slug: "customers", host: "customers.mad4b.com", title: "Customer Operations Actions" },
  { slug: "systems", host: "systems.mad4b.com", title: "Connected Systems Actions" },
  { slug: "logic", host: "logic.mad4b.com", title: "Logic And Workflow Actions" },
  { slug: "observability", host: "observability.mad4b.com", title: "Observability And Security Actions" },
  { slug: "developer", host: "developer.mad4b.com", title: "Developer And Release Actions" },
  { slug: "admin-cli", host: "admin.mad4b.com", title: "Admin Control Actions" },
  { slug: "ops", host: "ops.mad4b.com", title: "Platform Operations Actions" },
  { slug: "platform", host: "platform.mad4b.com", title: "Platform Extension Actions" }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function operationId(pathKey, method, operation) {
  return `${method.toUpperCase()} ${pathKey} :: ${operation.operationId || ""}`;
}

function getPrimaryTag(operation) {
  return Array.isArray(operation.tags) && operation.tags.length > 0 ? operation.tags[0] : "untagged";
}

function collectOperations(doc) {
  const operations = [];

  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!METHOD_NAMES.has(method)) continue;
      operations.push({
        pathKey,
        pathItem,
        method,
        operation,
        primaryTag: getPrimaryTag(operation),
        id: operationId(pathKey, method, operation)
      });
    }
  }

  return operations;
}

function groupOperationsByTag(operations) {
  const groups = [];
  const groupByTag = new Map();

  for (const operation of operations) {
    if (!groupByTag.has(operation.primaryTag)) {
      const group = { tag: operation.primaryTag, operations: [] };
      groupByTag.set(operation.primaryTag, group);
      groups.push(group);
    }

    groupByTag.get(operation.primaryTag).operations.push(operation);
  }

  return groups;
}

function chunkOperationsByTag(operations) {
  const chunks = [];
  let currentChunk = [];
  let currentTags = new Set();

  function flushChunk() {
    if (currentChunk.length === 0) return;
    chunks.push({ operations: currentChunk, tags: [...currentTags] });
    currentChunk = [];
    currentTags = new Set();
  }

  for (const group of groupOperationsByTag(operations)) {
    if (DEDICATED_SCOPE_TAGS.has(group.tag)) {
      flushChunk();

      for (let index = 0; index < group.operations.length; index += MAX_OPERATIONS_PER_SCHEMA) {
        chunks.push({
          operations: group.operations.slice(index, index + MAX_OPERATIONS_PER_SCHEMA),
          tags: [group.tag]
        });
      }

      continue;
    }

    if (group.operations.length > MAX_OPERATIONS_PER_SCHEMA) {
      flushChunk();

      for (let index = 0; index < group.operations.length; index += MAX_OPERATIONS_PER_SCHEMA) {
        chunks.push({
          operations: group.operations.slice(index, index + MAX_OPERATIONS_PER_SCHEMA),
          tags: [group.tag]
        });
      }

      continue;
    }

    if (currentChunk.length + group.operations.length > MAX_OPERATIONS_PER_SCHEMA) {
      flushChunk();
    }

    currentChunk.push(...group.operations);
    currentTags.add(group.tag);
  }

  flushChunk();

  return chunks;
}

function addOperationPath(paths, operationEntry) {
  if (!paths[operationEntry.pathKey]) {
    paths[operationEntry.pathKey] = {};
    if (Array.isArray(operationEntry.pathItem.parameters)) {
      paths[operationEntry.pathKey].parameters = clone(operationEntry.pathItem.parameters);
    }
  }

  paths[operationEntry.pathKey][operationEntry.method] = clone(operationEntry.operation);
}

function collectTags(paths, tags = []) {
  const referencedTags = new Set();

  for (const pathItem of Object.values(paths)) {
    for (const operation of Object.values(pathItem || {})) {
      if (!operation || typeof operation !== "object" || !Array.isArray(operation.tags)) continue;
      for (const tag of operation.tags) {
        referencedTags.add(tag);
      }
    }
  }

  const knownTags = tags.filter((tag) => referencedTags.has(tag.name));
  const knownTagNames = new Set(knownTags.map((tag) => tag.name));
  const inferredTags = [...referencedTags]
    .filter((tagName) => !knownTagNames.has(tagName))
    .sort()
    .map((tagName) => ({ name: tagName }));

  return [...knownTags, ...inferredTags];
}

function normalizeCustomGptSecurity(value) {
  if (!Array.isArray(value)) return value;
  if (value.length === 0) return value;

  const usesSupportedScheme = value.some((requirement) => {
    return requirement && typeof requirement === "object" && CUSTOM_GPT_SECURITY_SCHEME in requirement;
  });

  return usesSupportedScheme ? [{ [CUSTOM_GPT_SECURITY_SCHEME]: [] }] : value;
}

function trimDescription(value) {
  if (typeof value !== "string" || value.length <= CUSTOM_GPT_DESCRIPTION_LIMIT) return value;
  return `${value.slice(0, CUSTOM_GPT_DESCRIPTION_LIMIT - 1).trimEnd()}.`;
}

function normalizeCustomGptDescriptions(value) {
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value) {
      normalizeCustomGptDescriptions(item);
    }
    return;
  }

  if (typeof value.description === "string") {
    value.description = trimDescription(value.description);
  }

  for (const child of Object.values(value)) {
    normalizeCustomGptDescriptions(child);
  }
}

function resolveLocalRef(doc, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return null;

  const parts = ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));

  let current = doc;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) return null;
    current = current[part];
  }

  return current;
}

function normalizeCustomGptRequestBody(doc, operation) {
  let schema = operation?.requestBody?.content?.["application/json"]?.schema;
  if (!schema || typeof schema !== "object") return;

  if (schema.$ref) {
    const resolved = resolveLocalRef(doc, schema.$ref);
    if (resolved && typeof resolved === "object") {
      schema = clone(resolved);
      operation.requestBody.content["application/json"].schema = schema;
    }
  }

  if (Array.isArray(schema.oneOf)) {
    const objectOption = schema.oneOf.find((option) => option && typeof option === "object" && option.type === "object");
    if (objectOption) {
      operation.requestBody.content["application/json"].schema = objectOption;
    }
  }

  const explicitParameterNames = new Set(
    (operation.parameters || [])
      .filter((parameter) => parameter && typeof parameter === "object" && typeof parameter.name === "string")
      .map((parameter) => parameter.name)
  );

  if (schema.type === "object" && schema.properties && explicitParameterNames.size > 0) {
    for (const parameterName of explicitParameterNames) {
      delete schema.properties[parameterName];
    }

    if (Array.isArray(schema.required)) {
      schema.required = schema.required.filter((name) => !explicitParameterNames.has(name));
      if (schema.required.length === 0) {
        delete schema.required;
      }
    }
  }
}

function normalizeCustomGptObjects(value) {
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value) {
      normalizeCustomGptObjects(item);
    }
    return;
  }

  if (value.type === "object" && !("properties" in value)) {
    value.properties = {};
  }

  for (const child of Object.values(value)) {
    normalizeCustomGptObjects(child);
  }
}

function normalizeCustomGptDoc(scopedDoc) {
  if (scopedDoc.components?.securitySchemes) {
    scopedDoc.components.securitySchemes = {
      [CUSTOM_GPT_SECURITY_SCHEME]: scopedDoc.components.securitySchemes[CUSTOM_GPT_SECURITY_SCHEME]
    };
  }

  scopedDoc.security = clone(CUSTOM_GPT_REQUIRED_SECURITY);

  for (const pathItem of Object.values(scopedDoc.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!METHOD_NAMES.has(method) || !operation || typeof operation !== "object") continue;
      operation.security = clone(CUSTOM_GPT_REQUIRED_SECURITY);
      normalizeCustomGptRequestBody(scopedDoc, operation);
    }
  }

  normalizeCustomGptDescriptions(scopedDoc);
  normalizeCustomGptObjects(scopedDoc);
}

function buildScopeDoc(doc, chunk, scope) {
  const scopedPaths = {};

  for (const operation of chunk.operations) {
    addOperationPath(scopedPaths, operation);
  }

  const scopedDoc = clone(doc);
  const tagSummary = chunk.tags.join(", ");
  scopedDoc.info = {
    ...scopedDoc.info,
    title: `${doc.info?.title || "Platform API"} - ${scope.title}`,
    summary: `Custom GPT action schema for ${tagSummary}.`,
    description: `Custom GPT action schema generated from ${SOURCE_OPENAPI_FILE}. Scope tags: ${tagSummary}.`
  };
  scopedDoc.servers = [
    {
      url: `https://${scope.host}`,
      description: `${scope.title} custom domain`
    }
  ];
  scopedDoc.tags = collectTags(scopedPaths, scopedDoc.tags || []);
  scopedDoc.paths = scopedPaths;
  normalizeCustomGptDoc(scopedDoc);

  return scopedDoc;
}

function countOperations(paths) {
  let operationCount = 0;

  for (const pathItem of Object.values(paths)) {
    operationCount += Object.keys(pathItem || {}).filter((method) => METHOD_NAMES.has(method)).length;
  }

  return operationCount;
}

function removeStaleGeneratedSchemas() {
  for (const scope of SERVER_SCOPES) {
    const fileName = `${OUTPUT_PREFIX}.${scope.slug}.yaml`;
    const filePath = path.resolve(`./${fileName}`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
  const dispatcherPath = path.resolve(`./${AUTH_DISPATCHER_SCHEMA_FILE}`);
  if (fs.existsSync(dispatcherPath)) {
    fs.unlinkSync(dispatcherPath);
  }
}

function validateCoverage(sourceOperations, generatedDocs) {
  const sourceIds = new Set(sourceOperations.map((operation) => operation.id));
  const generatedIds = new Set();

  for (const [fileName, doc] of generatedDocs) {
    const operationCount = countOperations(doc.paths);
    if (operationCount >= 30) {
      throw new Error(`${fileName} has ${operationCount} operations; Custom GPT schemas must stay under 30.`);
    }

    for (const operation of collectOperations(doc)) {
      if (generatedIds.has(operation.id)) {
        throw new Error(`Duplicate generated operation: ${operation.id}`);
      }
      generatedIds.add(operation.id);
    }
  }

  const missing = [...sourceIds].filter((id) => !generatedIds.has(id));
  const extra = [...generatedIds].filter((id) => !sourceIds.has(id));

  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`Coverage mismatch. Missing: ${missing.length}. Extra: ${extra.length}.`);
  }
}

function main() {
  const openApiPath = path.resolve(`./${SOURCE_OPENAPI_FILE}`);

  if (!fs.existsSync(openApiPath)) {
    console.error(`Could not find ${SOURCE_OPENAPI_FILE}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(openApiPath, "utf8");
  const doc = yaml.load(raw);
  const sourceOperations = collectOperations(doc);
  const chunks = chunkOperationsByTag(sourceOperations);

  if (chunks.length > SERVER_SCOPES.length) {
    console.error(`Need ${chunks.length} unique server scopes, but only ${SERVER_SCOPES.length} are configured.`);
    process.exit(1);
  }

  removeStaleGeneratedSchemas();

  const generatedDocs = [];
  const serverUrls = new Set();

  chunks.forEach((chunk, index) => {
    const scope = SERVER_SCOPES[index];
    const serverUrl = `https://${scope.host}`;

    if (serverUrls.has(serverUrl)) {
      console.error(`Duplicate server URL configured for scoped Custom GPT schemas: ${serverUrl}`);
      process.exit(1);
    }
    serverUrls.add(serverUrl);

    const scopedDoc = buildScopeDoc(doc, chunk, scope);
    const operationCount = countOperations(scopedDoc.paths);
    const outFile = `${OUTPUT_PREFIX}.${scope.slug}.yaml`;
    const outPath = path.resolve(`./${outFile}`);
    const outYaml = yaml.dump(scopedDoc, { lineWidth: -1, noRefs: true });

    fs.writeFileSync(outPath, outYaml, "utf8");
    generatedDocs.push([outFile, scopedDoc]);
    console.log(`Generated ${outPath} (${operationCount} operations) -> ${serverUrl}`);
  });

  validateCoverage(sourceOperations, generatedDocs);

  const adminOperations = sourceOperations.filter((operation) => operation.primaryTag === "admin-control");
  if (adminOperations.length > 0) {
    const dispatcherDoc = buildScopeDoc(doc, { operations: adminOperations, tags: ["admin-control"] }, {
      slug: "auth-dispatcher",
      host: "auth.mad4b.com",
      title: "Auth Dispatcher Admin Control Actions"
    });
    dispatcherDoc.info = {
      ...dispatcherDoc.info,
      title: `${doc.info?.title || "Platform API"} - Auth Dispatcher Admin Control Actions`,
      summary: "Custom GPT action schema for admin-control via auth dispatcher.",
      description: `Single-host Custom GPT action schema generated from ${SOURCE_OPENAPI_FILE}. Exposes admin-control routes via auth.mad4b.com.`
    };
    const dispatcherPath = path.resolve(`./${AUTH_DISPATCHER_SCHEMA_FILE}`);
    const dispatcherYaml = yaml.dump(dispatcherDoc, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(dispatcherPath, dispatcherYaml, "utf8");
    console.log(`Generated ${dispatcherPath} (${countOperations(dispatcherDoc.paths)} operations) -> https://auth.mad4b.com`);
  }

  console.log(`\nSuccessfully generated ${generatedDocs.length} scoped Custom GPT schemas from ${SOURCE_OPENAPI_FILE}.`);
}

main();
