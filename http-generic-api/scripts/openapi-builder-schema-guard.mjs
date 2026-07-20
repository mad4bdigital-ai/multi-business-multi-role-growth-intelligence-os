#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const API_ROOT = path.resolve(__dirname, "..");
export const OPENAPI_DIR = path.resolve(API_ROOT, "openapi");
const METHODS = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);
export const DEFAULT_SCHEMA_FILES = [
  "openapi.custom-gpt.auth-dispatcher.yaml",
  "openapi.custom-gpt.activation-admin.yaml",
  "openapi.tenant-gpt.auth.yaml",
  "openapi.tenant-gpt.activation.yaml",
  "openapi.gpt-action.dev-dispatcher.yaml",
  "openapi.gpt-action.local-connector.yaml",
];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function objectType(schema) {
  return schema?.type === "object" || (Array.isArray(schema?.type) && schema.type.includes("object"));
}

function arrayType(schema) {
  return schema?.type === "array" || (Array.isArray(schema?.type) && schema.type.includes("array"));
}

export function resolveLocalRef(doc, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
  let current = doc;
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObject(current) || !(key in current)) return null;
    current = current[key];
  }
  return current;
}

function pushIssue(issues, file, schemaPath, code, message) {
  issues.push({ file, path: schemaPath, code, message });
}

function validateSchema(schema, state, options = {}) {
  const { doc, file, issues } = state;
  const schemaPath = options.path || "$";
  const topLevel = options.topLevel === true;
  const refStack = options.refStack || new Set();

  if (schema == null) {
    pushIssue(issues, file, schemaPath, "schema_null", "Schema value must be an object, not null or empty YAML.");
    return;
  }
  if (!isObject(schema)) {
    pushIssue(issues, file, schemaPath, "schema_not_object", "Schema value must be an object.");
    return;
  }

  if (schema.$ref) {
    const target = resolveLocalRef(doc, schema.$ref);
    if (!target) {
      pushIssue(issues, file, schemaPath, "unresolved_local_ref", `Unable to resolve ${schema.$ref}.`);
      return;
    }
    if (!refStack.has(schema.$ref)) {
      const next = new Set(refStack);
      next.add(schema.$ref);
      validateSchema(target, state, { path: `${schemaPath} -> ${schema.$ref}`, topLevel, refStack: next });
    }
    return;
  }

  if (objectType(schema)) {
    if (schema.properties != null && !isObject(schema.properties)) {
      pushIssue(issues, file, `${schemaPath}.properties`, "properties_not_object", "properties must be an object.");
    }
    const properties = isObject(schema.properties) ? schema.properties : {};
    if (topLevel && !Object.prototype.hasOwnProperty.call(schema, "properties")) {
      pushIssue(issues, file, schemaPath, "top_level_object_properties_required", "Top-level request/response object schemas must declare properties explicitly.");
    }
    for (const [name, child] of Object.entries(properties)) {
      if (child == null) {
        pushIssue(issues, file, `${schemaPath}.properties.${name}`, "property_schema_null", "Property schema must not be empty.");
      } else {
        validateSchema(child, state, { path: `${schemaPath}.properties.${name}`, refStack });
      }
    }
    if (Array.isArray(schema.required)) {
      for (const name of schema.required) {
        if (Object.keys(properties).length > 0 && !(name in properties)) {
          pushIssue(issues, file, `${schemaPath}.required`, "required_property_missing", `Required property ${name} is not defined in properties.`);
        }
      }
    }
  }

  if (arrayType(schema)) {
    if (schema.items == null) {
      pushIssue(issues, file, `${schemaPath}.items`, "array_items_required", "Array schemas must define items.");
    } else {
      validateSchema(schema.items, state, { path: `${schemaPath}.items`, refStack });
    }
  }

  if (isObject(schema.additionalProperties)) {
    validateSchema(schema.additionalProperties, state, { path: `${schemaPath}.additionalProperties`, refStack });
  }

  for (const key of ["allOf", "oneOf", "anyOf"]) {
    if (key in schema) {
      if (!Array.isArray(schema[key]) || schema[key].length === 0) {
        pushIssue(issues, file, `${schemaPath}.${key}`, "combinator_must_be_nonempty", `${key} must be a non-empty array.`);
      } else {
        schema[key].forEach((child, index) => validateSchema(child, state, {
          path: `${schemaPath}.${key}[${index}]`,
          topLevel,
          refStack,
        }));
      }
    }
  }

  if (schema.not != null) validateSchema(schema.not, state, { path: `${schemaPath}.not`, refStack });
  if (Array.isArray(schema.enum) && schema.enum.length === 0) {
    pushIssue(issues, file, `${schemaPath}.enum`, "enum_must_be_nonempty", "enum must contain at least one value.");
  }
}

function contentSchemas(content, state, basePath, topLevel = true) {
  if (!isObject(content)) return;
  for (const [mediaType, media] of Object.entries(content)) {
    if (media?.schema != null) {
      validateSchema(media.schema, state, { path: `${basePath}.content.${mediaType}.schema`, topLevel });
    }
  }
}

function parameterSchemas(parameters, state, basePath) {
  if (!Array.isArray(parameters)) return;
  parameters.forEach((parameter, index) => {
    if (parameter?.schema != null) validateSchema(parameter.schema, state, { path: `${basePath}[${index}].schema` });
    contentSchemas(parameter?.content, state, `${basePath}[${index}]`, false);
  });
}

export function validateOpenApiDocument(doc, { file = "<memory>" } = {}) {
  const issues = [];
  const state = { doc, file, issues };
  if (!isObject(doc)) return [{ file, path: "$", code: "document_not_object", message: "OpenAPI document must be an object." }];

  for (const [name, schema] of Object.entries(doc.components?.schemas || {})) {
    validateSchema(schema, state, { path: `$.components.schemas.${name}` });
  }
  for (const [name, response] of Object.entries(doc.components?.responses || {})) {
    contentSchemas(response?.content, state, `$.components.responses.${name}`);
  }
  for (const [name, requestBody] of Object.entries(doc.components?.requestBodies || {})) {
    contentSchemas(requestBody?.content, state, `$.components.requestBodies.${name}`);
  }
  parameterSchemas(Object.values(doc.components?.parameters || {}), state, "$.components.parameters");

  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    parameterSchemas(pathItem?.parameters, state, `$.paths.${pathKey}.parameters`);
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!METHODS.has(method) || !isObject(operation)) continue;
      const opPath = `$.paths.${pathKey}.${method}`;
      parameterSchemas(operation.parameters, state, `${opPath}.parameters`);
      contentSchemas(operation.requestBody?.content, state, `${opPath}.requestBody`);
      for (const [status, response] of Object.entries(operation.responses || {})) {
        contentSchemas(response?.content, state, `${opPath}.responses.${status}`);
      }
    }
  }
  return issues;
}

export function validateOpenApiFile(filePath) {
  const absolute = path.resolve(filePath);
  try {
    const doc = YAML.parse(fs.readFileSync(absolute, "utf8"));
    return validateOpenApiDocument(doc, { file: absolute });
  } catch (error) {
    return [{ file: absolute, path: "$", code: "yaml_parse_failed", message: error.message }];
  }
}

export function validateOpenApiFiles(files) {
  return files.flatMap((file) => validateOpenApiFile(file));
}

function isCli() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function resolveSchemaPath(file) {
  if (path.isAbsolute(file)) return file;
  const openapiPath = path.resolve(OPENAPI_DIR, file);
  if (fs.existsSync(openapiPath)) return openapiPath;
  return path.resolve(API_ROOT, file);
}

if (isCli()) {
  const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const files = (requested.length ? requested : DEFAULT_SCHEMA_FILES).map(resolveSchemaPath);
  const issues = validateOpenApiFiles(files);
  if (issues.length) {
    console.error(`OpenAPI Builder schema guard failed with ${issues.length} issue(s):`);
    for (const issue of issues) console.error(`- ${issue.file} ${issue.path} [${issue.code}] ${issue.message}`);
    process.exit(1);
  }
  console.log(`OpenAPI Builder schema guard passed for ${files.length} file(s).`);
}
