#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const activationRequired = process.argv.includes("--activation-required");
const timeoutMs = 20_000;

const surfaces = [
  {
    key: "tenant_core",
    remote: "https://dev.mad4b.com/openapi.tenant-gpt.auth.staging.yaml",
    local: "openapi/openapi.tenant-gpt.auth.staging.yaml",
    server: "https://dev.mad4b.com",
    securityScheme: "userBearerAuth",
    securityType: "oauth2",
    titleToken: "Tenant Core Actions",
    oauthAuthorizationUrl: "https://dev.mad4b.com/auth/oauth/authorize",
    oauthTokenUrl: "https://dev.mad4b.com/auth/oauth/token",
  },
  {
    key: "admin_core",
    remote: "https://dev.mad4b.com/openapi.custom-gpt.auth-dispatcher.staging.yaml",
    local: "openapi/openapi.custom-gpt.auth-dispatcher.staging.yaml",
    server: "https://dev.mad4b.com",
    securityScheme: "backendBearerAuth",
    securityType: "http",
    titleToken: "Admin Core Actions",
  },
  {
    key: "remote_mcp",
    remote: "https://mcp-dev.mad4b.com/openapi.remote-mcp.staging.yaml",
    local: "openapi/openapi.remote-mcp.staging.yaml",
    server: "https://mcp-dev.mad4b.com",
    securityScheme: "remoteMcpBearerAuth",
    securityType: "http",
    titleToken: "Staging Remote MCP",
  },
];

if (activationRequired) {
  surfaces.push(
    {
      key: "tenant_activation",
      remote: "https://activation-dev.mad4b.com/openapi.tenant-gpt.activation.staging.yaml",
      local: "openapi/openapi.tenant-gpt.activation.staging.yaml",
      server: "https://activation-dev.mad4b.com",
      securityScheme: "userBearerAuth",
      securityType: "oauth2",
      titleToken: "Tenant Activation Actions",
      oauthAuthorizationUrl: "https://activation-dev.mad4b.com/auth/oauth/authorize",
      oauthTokenUrl: "https://activation-dev.mad4b.com/auth/oauth/token",
    },
    {
      key: "admin_activation",
      remote: "https://activation-dev.mad4b.com/openapi.custom-gpt.activation-admin.staging.yaml",
      local: "openapi/openapi.custom-gpt.activation-admin.staging.yaml",
      server: "https://activation-dev.mad4b.com",
      securityScheme: "backendBearerAuth",
      securityType: "http",
      titleToken: "Admin Activation",
    },
  );
}

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function semanticHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function resolveJsonPointer(root, ref) {
  if (!String(ref).startsWith("#/")) return null;
  const segments = String(ref).slice(2).split("/").map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current = root;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || !(segment in current)) return null;
    current = current[segment];
  }
  return current;
}

function collectRefs(value, refs = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRefs(item, refs));
    return refs;
  }
  if (!value || typeof value !== "object") return refs;
  if (typeof value.$ref === "string") refs.push(value.$ref);
  Object.values(value).forEach((item) => collectRefs(item, refs));
  return refs;
}

function collectOperations(document) {
  const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
  const operations = [];
  for (const [route, pathItem] of Object.entries(document.paths || {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!methods.has(method.toLowerCase())) continue;
      if (!operation || typeof operation !== "object") fail("OpenAPI operation is not an object", { route, method });
      const operationId = String(operation.operationId || "").trim();
      if (!operationId) fail("OpenAPI operationId is required", { route, method });
      operations.push({ route, method: method.toLowerCase(), operationId });
    }
  }
  if (!operations.length) fail("OpenAPI document contains no operations");
  const ids = operations.map((entry) => entry.operationId);
  if (new Set(ids).size !== ids.length) fail("OpenAPI operationIds must be unique");
  return operations;
}

function validateDocument(document, surface) {
  if (!String(document?.openapi || "").startsWith("3.")) fail("OpenAPI 3.x document required", { surface: surface.key });
  if (!String(document?.info?.title || "").includes(surface.titleToken)) fail("Unexpected OpenAPI surface title", { surface: surface.key });
  if (!Array.isArray(document.servers) || document.servers.length !== 1 || document.servers[0]?.url !== surface.server) {
    fail("OpenAPI server binding mismatch", { surface: surface.key, expected: surface.server });
  }
  const schemes = document?.components?.securitySchemes || {};
  const schemeNames = Object.keys(schemes);
  if (schemeNames.length !== 1 || schemeNames[0] !== surface.securityScheme) {
    fail("OpenAPI security scheme boundary mismatch", { surface: surface.key, observed: schemeNames });
  }
  const scheme = schemes[surface.securityScheme];
  if (scheme?.type !== surface.securityType) fail("OpenAPI security scheme type mismatch", { surface: surface.key });
  if (surface.securityType === "http" && String(scheme?.scheme || "").toLowerCase() !== "bearer") {
    fail("HTTP security surface must use bearer", { surface: surface.key });
  }
  if (surface.securityType === "oauth2") {
    const flow = scheme?.flows?.authorizationCode;
    if (!flow || flow.authorizationUrl !== surface.oauthAuthorizationUrl || flow.tokenUrl !== surface.oauthTokenUrl) {
      fail("OAuth authorization-code endpoints mismatch", { surface: surface.key });
    }
  }
  const operations = collectOperations(document);
  const refs = collectRefs(document);
  for (const ref of refs) {
    if (!String(ref).startsWith("#/")) fail("External OpenAPI refs are forbidden on Staging GPT surfaces", { surface: surface.key, ref });
    if (resolveJsonPointer(document, ref) === null) fail("Unresolved OpenAPI local ref", { surface: surface.key, ref });
  }
  return { operation_count: operations.length, ref_count: refs.length, security_scheme: surface.securityScheme };
}

async function readRemote(url) {
  const response = await fetch(url, { headers: { accept: "application/yaml,text/yaml,text/plain" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) fail("Remote OpenAPI fetch failed", { url, status: response.status });
  return response.text();
}

const evidence = [];
try {
  for (const surface of surfaces) {
    const localText = fs.readFileSync(path.join(apiRoot, surface.local), "utf8");
    const remoteText = await readRemote(surface.remote);
    const localDocument = YAML.parse(localText);
    const remoteDocument = YAML.parse(remoteText);
    const localHash = semanticHash(localDocument);
    const remoteHash = semanticHash(remoteDocument);
    if (localHash !== remoteHash) {
      fail("Published OpenAPI semantic content does not match exact-checkout canonical", {
        surface: surface.key,
        local_semantic_sha256: localHash,
        remote_semantic_sha256: remoteHash,
      });
    }
    const semantics = validateDocument(remoteDocument, surface);
    evidence.push({
      surface: surface.key,
      server: surface.server,
      semantic_sha256: remoteHash,
      ...semantics,
      ready: true,
    });
  }
  console.log(JSON.stringify({
    contract: "mad4b.staging-public-schema-readiness.v1",
    activation_required: activationRequired,
    schema_count: evidence.length,
    surfaces: evidence,
    ready: true,
    secrets_included: false,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    contract: "mad4b.staging-public-schema-readiness.v1",
    ready: false,
    reason: error?.message || "staging_public_schema_readiness_failed",
    details: error?.details || null,
    secrets_included: false,
  }));
  process.exit(1);
}
