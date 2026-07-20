#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const METHOD_NAMES = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);
const RESPONSE_OBJECT_KEYS = new Set(["description", "headers", "content", "links"]);
const REFERENCE_OBJECT_KEYS = new Set(["$ref", "summary", "description"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function issue(source, objectPath, code, message) {
  return { source, path: objectPath, code, message };
}

function collectResponseMapIssues(responses, objectPath, source, issues) {
  if (!isObject(responses)) {
    issues.push(issue(source, objectPath, "invalid_responses_map", "responses must be an object"));
    return;
  }

  for (const [statusCode, response] of Object.entries(responses)) {
    const responsePath = `${objectPath}.${statusCode}`;
    if (!isObject(response)) {
      issues.push(issue(source, responsePath, "invalid_response_object", "response must be an object"));
      continue;
    }

    const allowedKeys = typeof response.$ref === "string" ? REFERENCE_OBJECT_KEYS : RESPONSE_OBJECT_KEYS;
    for (const key of Object.keys(response)) {
      if (key.startsWith("x-") || allowedKeys.has(key)) continue;
      issues.push(issue(
        source,
        responsePath,
        "unexpected_response_property",
        `Response Object property "${key}" is not allowed by OpenAPI 3.1`,
      ));
    }

    if (!("$ref" in response)) {
      if (typeof response.description !== "string" || response.description.trim() === "") {
        issues.push(issue(
          source,
          responsePath,
          "missing_response_description",
          "Response Object description must be a non-empty string",
        ));
      }
    }
  }
}

export function collectOpenApiResponseObjectIssues(doc, { source = "<memory>" } = {}) {
  const issues = [];
  if (!isObject(doc)) {
    return [issue(source, "$", "invalid_openapi_document", "OpenAPI document must be an object")];
  }

  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    if (!isObject(pathItem)) continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!METHOD_NAMES.has(method) || !isObject(operation) || operation.responses === undefined) continue;
      collectResponseMapIssues(operation.responses, `paths.${pathKey}.${method}.responses`, source, issues);
    }
  }

  if (doc.components?.responses !== undefined) {
    collectResponseMapIssues(doc.components.responses, "components.responses", source, issues);
  }

  return issues;
}

export function formatOpenApiResponseObjectIssue(entry) {
  return `${entry.source} ${entry.path} [${entry.code}] ${entry.message}`;
}

export function assertOpenApiResponseObjects(doc, options = {}) {
  const issues = collectOpenApiResponseObjectIssues(doc, options);
  if (issues.length === 0) return;
  const error = new Error(
    `OpenAPI Response Object validation failed:\n${issues.map(formatOpenApiResponseObjectIssue).join("\n")}`,
  );
  error.code = "openapi_response_object_validation_failed";
  error.issues = issues;
  throw error;
}

export function validateOpenApiResponseFiles(files) {
  const issues = [];
  for (const file of files) {
    try {
      const doc = YAML.parse(fs.readFileSync(file, "utf8"));
      issues.push(...collectOpenApiResponseObjectIssues(doc, { source: file }));
    } catch (error) {
      issues.push(issue(file, "$", "yaml_parse_failed", error.message || String(error)));
    }
  }
  return issues;
}

function defaultOpenApiFiles() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const apiRoot = path.resolve(scriptDir, "..");
  const generatedDir = path.join(apiRoot, "openapi");
  const files = [path.join(apiRoot, "openapi.yaml")];
  if (fs.existsSync(generatedDir)) {
    files.push(
      ...fs.readdirSync(generatedDir)
        .filter((name) => name.endsWith(".yaml"))
        .sort()
        .map((name) => path.join(generatedDir, name)),
    );
  }
  return files;
}

function main() {
  const files = process.argv.slice(2).map((file) => path.resolve(file));
  const targets = files.length > 0 ? files : defaultOpenApiFiles();
  const issues = validateOpenApiResponseFiles(targets);
  if (issues.length > 0) {
    for (const entry of issues) console.error(formatOpenApiResponseObjectIssue(entry));
    process.exitCode = 1;
    return;
  }
  console.log(`OpenAPI Response Object validation passed for ${targets.length} file(s).`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) main();
