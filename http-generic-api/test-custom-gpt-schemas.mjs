/**
 * test-custom-gpt-schemas.mjs
 *
 * Contract checks for generated Custom GPT OpenAPI action schemas.
 * These tests stay local and deterministic: no network, DB, or credentials.
 *
 * Run: node test-custom-gpt-schemas.mjs
 */

import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCHEMAS = [
  "openapi.custom-gpt.runtime.yaml",
  "openapi.custom-gpt.identity.yaml",
  "openapi.custom-gpt.customers.yaml",
  "openapi.custom-gpt.systems.yaml",
  "openapi.custom-gpt.logic.yaml",
  "openapi.custom-gpt.observability.yaml",
  "openapi.custom-gpt.developer.yaml",
  "openapi.custom-gpt.admin-cli.yaml",
  "openapi.custom-gpt.ops.yaml",
];

const METHOD_NAMES = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);
const CUSTOM_GPT_SECURITY_SCHEME = "backendBearerAuth";
const MAX_OPERATIONS = 29;
const MAX_DESCRIPTION_LENGTH = 300;
const EXPECTED_SERVER_URLS = {
  "openapi.custom-gpt.runtime.yaml": "https://api.mad4b.com",
  "openapi.custom-gpt.identity.yaml": "https://identity.mad4b.com",
  "openapi.custom-gpt.customers.yaml": "https://customers.mad4b.com",
  "openapi.custom-gpt.systems.yaml": "https://systems.mad4b.com",
  "openapi.custom-gpt.logic.yaml": "https://logic.mad4b.com",
  "openapi.custom-gpt.observability.yaml": "https://observability.mad4b.com",
  "openapi.custom-gpt.developer.yaml": "https://developer.mad4b.com",
  "openapi.custom-gpt.admin-cli.yaml": "https://admin.mad4b.com",
  "openapi.custom-gpt.ops.yaml": "https://ops.mad4b.com",
};
const EXPECTED_SCOPE_TAGS = {
  "openapi.custom-gpt.runtime.yaml": new Set(["health", "activation", "governance", "jobs", "execution", "ai", "tenants"]),
  "openapi.custom-gpt.identity.yaml": new Set(["identity", "access"]),
  "openapi.custom-gpt.customers.yaml": new Set(["customers"]),
  "openapi.custom-gpt.systems.yaml": new Set(["connected-systems", "planner", "bootstrap"]),
  "openapi.custom-gpt.logic.yaml": new Set(["logic", "workflows"]),
  "openapi.custom-gpt.observability.yaml": new Set(["observability", "security"]),
  "openapi.custom-gpt.developer.yaml": new Set(["developer-api"]),
  "openapi.custom-gpt.admin-cli.yaml": new Set(["admin-control", "system-layer"]),
  "openapi.custom-gpt.ops.yaml": new Set(["release"]),
};

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n== ${name}`);
}

function loadSchema(file) {
  return yaml.load(readFileSync(resolve(__dirname, file), "utf8"));
}

function collectOperations(doc) {
  const operations = [];
  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!METHOD_NAMES.has(method)) continue;
      operations.push({ pathKey, pathItem, method, operation });
    }
  }
  return operations;
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

function effectiveSchema(doc, schema) {
  if (!schema || typeof schema !== "object") return null;
  if (schema.$ref) return effectiveSchema(doc, resolveLocalRef(doc, schema.$ref));
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.find((option) => effectiveSchema(doc, option)?.type === "object") || schema;
  }
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.find((option) => effectiveSchema(doc, option)?.type === "object") || schema;
  }
  return schema;
}

function walkDescriptions(value, path = "$", out = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkDescriptions(item, `${path}[${index}]`, out));
    return out;
  }
  if (typeof value.description === "string" && value.description.length > MAX_DESCRIPTION_LENGTH) {
    out.push({ path: `${path}.description`, length: value.description.length });
  }
  for (const [key, child] of Object.entries(value)) {
    walkDescriptions(child, `${path}.${key}`, out);
  }
  return out;
}

function parameterKey(parameter) {
  return `${parameter?.in || ""}:${parameter?.name || ""}`;
}

const serverUrls = new Map();

for (const file of SCHEMAS) {
  const doc = loadSchema(file);
  const label = basename(file);
  const operations = collectOperations(doc);

  section(label);

  assert("uses OpenAPI 3.1", doc.openapi === "3.1.0", `got ${doc.openapi}`);
  assert("has exactly one server", Array.isArray(doc.servers) && doc.servers.length === 1);

  const serverUrl = doc.servers?.[0]?.url;
  assert("server URL is HTTPS", typeof serverUrl === "string" && serverUrl.startsWith("https://"), `got ${serverUrl}`);
  assert("server URL matches scope", serverUrl === EXPECTED_SERVER_URLS[file], `got ${serverUrl}`);
  assert("server URL is unique across scoped schemas", !serverUrls.has(serverUrl), `${serverUrl} also used by ${serverUrls.get(serverUrl)}`);
  serverUrls.set(serverUrl, label);

  assert(`operation count <= ${MAX_OPERATIONS}`, operations.length <= MAX_OPERATIONS, `got ${operations.length}`);
  assert("has at least one operation", operations.length > 0);
  assert("does not expose root path operation", !operations.some((operation) => operation.pathKey === "/"));
  const expectedTags = EXPECTED_SCOPE_TAGS[file];
  const unexpectedTags = operations
    .map((operation) => operation.operation.tags?.[0] || "untagged")
    .filter((tag) => !expectedTags.has(tag));
  assert("operations match declared scope tag classification", unexpectedTags.length === 0, unexpectedTags.join(", "));

  const securitySchemes = Object.keys(doc.components?.securitySchemes || {});
  assert("exposes one security scheme", securitySchemes.length === 1, `got ${securitySchemes.join(", ")}`);
  assert("security scheme is backendBearerAuth", securitySchemes[0] === CUSTOM_GPT_SECURITY_SCHEME, `got ${securitySchemes[0]}`);

  const rootSecurity = doc.security || [];
  assert("root security uses backendBearerAuth only",
    Array.isArray(rootSecurity) &&
      rootSecurity.length === 1 &&
      rootSecurity[0] &&
      Object.keys(rootSecurity[0]).length === 1 &&
      CUSTOM_GPT_SECURITY_SCHEME in rootSecurity[0],
    JSON.stringify(rootSecurity));

  const longDescriptions = walkDescriptions(doc);
  assert("all descriptions are <= 300 chars", longDescriptions.length === 0,
    longDescriptions.map((item) => `${item.path}:${item.length}`).join(", "));

  for (const { pathKey, pathItem, method, operation } of operations) {
    const opLabel = `${method.toUpperCase()} ${pathKey} ${operation.operationId || ""}`.trim();
    assert(`${opLabel} path is absolute`, pathKey.startsWith("/"), pathKey);
    const combinedParameters = [
      ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
      ...(Array.isArray(operation.parameters) ? operation.parameters : []),
    ];
    const seen = new Set();
    const duplicates = [];
    for (const parameter of combinedParameters) {
      const key = parameterKey(parameter);
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
    }
    assert(`${opLabel} has no duplicate parameters`, duplicates.length === 0, duplicates.join(", "));

    const requestSchema = operation.requestBody?.content?.["application/json"]?.schema;
    if (requestSchema) {
      const schema = effectiveSchema(doc, requestSchema);
      assert(`${opLabel} request body schema is object`, schema?.type === "object", JSON.stringify(requestSchema));
    }
  }
}

section("openapi.custom-gpt.auth-dispatcher.yaml");
{
  const doc = loadSchema("openapi.custom-gpt.auth-dispatcher.yaml");
  const operations = collectOperations(doc);
  assert("auth dispatcher uses auth host", doc.servers?.[0]?.url === "https://auth.mad4b.com", doc.servers?.[0]?.url);
  assert("auth dispatcher has admin operations", operations.length > 0);
  assert("auth dispatcher is activation/admin-control/system-layer only", operations.every((operation) => ["activation", "admin-control", "system-layer"].includes(operation.operation.tags?.[0])));
  assert("auth dispatcher exposes activation session context", operations.some((operation) => operation.pathKey === "/activation/session-context"));
  assert("auth dispatcher exposes activation platform access", operations.some((operation) => operation.pathKey === "/activation/platform-access"));
  assert("auth dispatcher exposes system layer tools", operations.some((operation) => operation.pathKey === "/admin/system/tools"));
  assert("auth dispatcher exposes system layer tool calls", operations.some((operation) => operation.pathKey === "/admin/system/tools/call"));
  assert("auth dispatcher exposes shared system tools", operations.some((operation) => operation.pathKey === "/system/tools"));
  assert("auth dispatcher exposes shared system tool calls", operations.some((operation) => operation.pathKey === "/system/tools/call"));
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL CUSTOM GPT SCHEMA TESTS PASS");
