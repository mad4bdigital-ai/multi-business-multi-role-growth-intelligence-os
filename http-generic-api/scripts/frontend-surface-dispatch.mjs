#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const DEFAULT_OUTPUT = "frontend-surface-dispatch.generated.json";
const DEFAULT_POLICY = "frontend-surface-policy.json";
const DEFAULT_GENERATED_GOVERNANCE = "frontend-operation-governance.generated.json";
const DEFAULT_OPENAPI_INDEX = "openapi/frontend-runtime-routes.generated.yaml";
const AUTH_GUARDS = new Set([
  "requireBackendApiKey",
  "requireAdminPrincipal",
  "requireAdmin",
  "requireUserJwt",
  "requireTenantUserJwt",
  "verifyUserJwt",
  "requireUser",
  "requireTenantPrincipal",
  "requireTenantOperationPrincipal",
  "requireResolutionPrincipal",
  "requireActiveMembership",
  "requireWorkspaceOwner",
  "requireLocalManagerDevice",
  "requireLocalManagerUser",
  "requireFreshLocalManagerDeviceForPrivilegedInstaller",
  "requireMcpToken",
  "verifyInstallerDownloadToken",
  "requireGitHubWebhookSignature",
]);
const AUTH_SCHEME_ALIASES = new Map([
  ["userBearerAuth", "userJwtAuth"],
  ["userJwt", "userJwtAuth"],
  ["backendApiKey", "backendApiKeyAuth"],
]);
const AUTH_PROFILES = {
  public: { alternatives: [], principal: "anonymous", configuration_dependencies: [] },
  user_jwt: { alternatives: [["userJwtAuth"]], principal: "tenant_user", configuration_dependencies: ["JWT_SECRET"] },
  admin_backend: { alternatives: [["adminBearerAuth"], ["backendApiKeyAuth"]], principal: "admin", configuration_dependencies: ["BACKEND_API_KEY"] },
  backend_or_user: { alternatives: [["backendBearerAuth"], ["backendApiKeyAuth"]], principal: "authenticated", configuration_dependencies: ["BACKEND_API_KEY", "JWT_SECRET"] },
  connector_bearer: { alternatives: [["connectorBearerAuth"]], principal: "local_connector", configuration_dependencies: ["BACKEND_API_KEY"] },
  local_manager: { alternatives: [["localManagerBearerAuth"]], principal: "local_manager", configuration_dependencies: ["JWT_SECRET"] },
  mcp_query_token: { alternatives: [["mcpQueryTokenAuth"]], principal: "mcp_client", configuration_dependencies: ["MCP_QUERY_TOKEN"] },
  signed_query_token: { alternatives: [["signedQueryTokenAuth"]], principal: "signed_link", configuration_dependencies: [] },
  github_webhook_hmac: { alternatives: [["githubWebhookSignature"]], principal: "github_webhook", configuration_dependencies: ["GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET"] },
};
const OPERATION_CLASSIFICATIONS = new Set(["read", "read_action", "preflight", "state_change", "external_effect", "disabled", "unresolved"]);

function canonicalText(value = "") {
  return String(value).replace(/\r\n?/g, "\n");
}

function digest(value = "") {
  return createHash("sha256").update(canonicalText(value), "utf8").digest("hex");
}

function readText(file) {
  return fs.existsSync(file) ? canonicalText(fs.readFileSync(file, "utf8")) : "";
}

function readJson(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(readText(file));
}

function filesUnder(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function normalizeRoutePath(value = "") {
  let route = String(value || "").trim();
  if (!route || route === "/") return "/";
  if (!route.startsWith("/")) route = `/${route}`;
  return route
    .replace(/:([A-Za-z0-9_]+)\?/g, "{$1}")
    .replace(/:([A-Za-z0-9_]+)/g, "{$1}")
    .replace(/\$\{[^}]+\}/g, "{dynamic}")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "") || "/";
}

export function expandRoutePaths(value = "") {
  const pending = [String(value || "")];
  const expanded = [];
  const optionalSegment = /\/:([A-Za-z0-9_]+)\?/;
  while (pending.length) {
    const route = pending.pop();
    const match = route.match(optionalSegment);
    if (!match || match.index === undefined) {
      expanded.push(normalizeRoutePath(route));
      continue;
    }
    const before = route.slice(0, match.index);
    const after = route.slice(match.index + match[0].length);
    pending.push(`${before}${after}`);
    pending.push(`${before}/:${match[1]}${after}`);
  }
  return unique(expanded);
}

function joinRoutePath(prefix, route) {
  const left = normalizeRoutePath(prefix || "/");
  const right = normalizeRoutePath(route || "/");
  if (left === "/") return right;
  if (right === "/") return left;
  return normalizeRoutePath(`${left}/${right}`);
}

function toKebab(value = "") {
  return String(value)
    .replace(/Routes?\.js$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function decodeJsonPointerSegment(value = "") {
  return String(value).replace(/~1/g, "/").replace(/~0/g, "~");
}

function referencedPathItemMethods({ reference, sourcePath, apiRoot }) {
  const [relativeFile, fragment = ""] = String(reference || "").split("#", 2);
  if (!relativeFile || !fragment.startsWith("/") || !sourcePath || !apiRoot) return [];
  const target = path.resolve(path.dirname(sourcePath), relativeFile);
  const root = path.resolve(apiRoot);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return [];
  const source = readText(target);
  if (!source) return [];

  const segments = fragment.slice(1).split("/").map(decodeJsonPointerSegment);
  if (segments.length !== 1) return [];
  const key = segments[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = source.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*(?:#.*)?$`).test(line));
  if (start < 0) return [];
  const methods = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index])) break;
    const method = lines[index].match(/^\s{2}(get|post|put|patch|delete):\s*(?:#.*)?$/i)?.[1];
    if (method) methods.push(method.toUpperCase());
  }
  return methods;
}

function openApiReferenceFiles(source = "", sourcePath, apiRoot) {
  if (!sourcePath || !apiRoot) return [];
  const root = path.resolve(apiRoot);
  return unique([...canonicalText(source).matchAll(/^\s+\$ref:\s*["']?([^"'\s#]+\.ya?ml)#/gim)].map((match) => {
    const target = path.resolve(path.dirname(sourcePath), match[1]);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null;
    return target;
  }));
}

function openApiProjectionRegistry(apiRoot) {
  const registryPath = path.resolve(apiRoot, "..", "canonicals", "openapi", "custom-gpt-surfaces.yaml");
  if (!fs.existsSync(registryPath)) return { registryPath, projectedFiles: [] };
  const registry = YAML.parse(readText(registryPath)) || {};
  const root = path.resolve(apiRoot);
  const projectedFiles = [];
  for (const surface of Object.values(registry.surfaces || {})) {
    if (surface?.mode !== "generated_from_openapi" || !surface.output_file) continue;
    const target = path.resolve(apiRoot, surface.output_file);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Generated OpenAPI projection escapes API root: ${surface.output_file}`);
    }
    projectedFiles.push(target);
  }
  return { registryPath, projectedFiles: unique(projectedFiles) };
}

export function canonicalOpenApiAuthority({
  apiRoot = process.cwd(),
  openapiPath = path.join(apiRoot, "openapi.yaml"),
  runtimeOpenapiPath = path.join(apiRoot, DEFAULT_OPENAPI_INDEX),
} = {}) {
  const projectionRegistry = openApiProjectionRegistry(apiRoot);
  const excluded = new Set([path.resolve(runtimeOpenapiPath), ...projectionRegistry.projectedFiles.map((file) => path.resolve(file))]);
  const additionalFiles = filesUnder(path.join(apiRoot, "openapi"))
    .filter((file) => /\.ya?ml$/i.test(file) && !excluded.has(path.resolve(file)))
    .filter((file) => /^\s*openapi:/m.test(readText(file)) && /^\s*paths:/m.test(readText(file)));
  return {
    files: unique([path.resolve(openapiPath), ...additionalFiles]),
    projection_registry_path: projectionRegistry.registryPath,
    excluded_projection_files: projectionRegistry.projectedFiles,
  };
}

export function parseOpenApiOperations(source = "", { sourcePath, apiRoot } = {}) {
  const operations = new Set();
  let currentPath = "";
  for (const line of canonicalText(source).split("\n")) {
    const pathMatch = line.match(/^\s{2}(\/[^:]+):\s*$/);
    if (pathMatch) {
      currentPath = normalizeRoutePath(pathMatch[1]);
      continue;
    }
    const methodMatch = line.match(/^\s{4}(get|post|put|patch|delete):\s*(?:#.*)?$/i);
    if (currentPath && methodMatch) operations.add(`${methodMatch[1].toUpperCase()} ${currentPath}`);
    const refMatch = line.match(/^\s{4}\$ref:\s*["']?([^"'\s]+)["']?\s*(?:#.*)?$/i);
    if (currentPath && refMatch) {
      for (const method of referencedPathItemMethods({ reference: refMatch[1], sourcePath, apiRoot })) {
        operations.add(`${method} ${currentPath}`);
      }
    }
    else if (/^\s{0,2}\S/.test(line) && !/^\s{2}\//.test(line)) currentPath = "";
  }
  return operations;
}

function jsonPointerValue(document, fragment = "") {
  if (!fragment || fragment === "#") return document;
  const pointer = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (!pointer.startsWith("/")) return null;
  return pointer.slice(1).split("/").map(decodeJsonPointerSegment).reduce((value, key) => value?.[key], document);
}

function resolveOpenApiReference(reference, sourcePath, apiRoot) {
  const [relativeFile = "", fragment = ""] = String(reference || "").split("#", 2);
  if (!relativeFile || !sourcePath || !apiRoot) return null;
  const target = path.resolve(path.dirname(sourcePath), relativeFile);
  const root = path.resolve(apiRoot);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null;
  const source = readText(target);
  if (!source) return null;
  const document = YAML.parse(source);
  return { value: jsonPointerValue(document, `#${fragment}`), sourcePath: target };
}

function normalizeSecurityAlternatives(security) {
  if (!Array.isArray(security)) return null;
  if (security.length === 0) return [];
  return security
    .map((requirement) => Object.keys(requirement || {}).sort())
    .filter((requirement) => requirement.length)
    .sort((a, b) => a.join("+").localeCompare(b.join("+")));
}

function canonicalAlternativeList(alternatives) {
  return (alternatives || [])
    .map((entry) => unique(entry.map((scheme) => AUTH_SCHEME_ALIASES.get(scheme) || scheme)))
    .sort((a, b) => a.join("+").localeCompare(b.join("+")));
}

export function parseOpenApiContracts(source = "", { sourcePath, apiRoot } = {}) {
  const contracts = new Map();
  const document = YAML.parse(canonicalText(source)) || {};
  const knownSchemes = new Set(Object.keys(document.components?.securitySchemes || {}));
  for (const [routePath, rawPathItem] of Object.entries(document.paths || {})) {
    let pathItem = rawPathItem;
    let operationSource = sourcePath || "openapi.yaml";
    let securityPathBase = ["paths", routePath];
    if (rawPathItem?.$ref) {
      const resolved = resolveOpenApiReference(rawPathItem.$ref, sourcePath, apiRoot);
      if (resolved?.value) {
        pathItem = resolved.value;
        operationSource = resolved.sourcePath;
        const fragment = String(rawPathItem.$ref).split("#", 2)[1] || "";
        if (fragment.startsWith("/")) securityPathBase = fragment.slice(1).split("/").map(decodeJsonPointerSegment);
      }
    }
    for (const [method, operation] of Object.entries(pathItem || {})) {
      const normalizedMethod = method.toUpperCase();
      if (!HTTP_METHODS.has(normalizedMethod)) continue;
      const security = Object.hasOwn(operation || {}, "security") ? operation.security : document.security;
      const alternatives = normalizeSecurityAlternatives(security);
      const usedSchemes = unique((alternatives || []).flat());
      contracts.set(`${normalizedMethod} ${normalizeRoutePath(routePath)}`, {
        signature: `${normalizedMethod} ${normalizeRoutePath(routePath)}`,
        source_file: sourcePath && apiRoot ? path.relative(apiRoot, operationSource).replace(/\\/g, "/") : operationSource,
        security_declared: Object.hasOwn(operation || {}, "security"),
        security_alternatives: alternatives,
        unknown_security_schemes: usedSchemes.filter((scheme) => !knownSchemes.has(scheme)),
        operation_id: operation?.operationId || null,
        contract_level: operation?.["x-contract-completeness"] || "canonical",
        security_path: [...securityPathBase, method, "security"],
      });
    }
  }
  return contracts;
}

function authParity(runtimeAuth, openapiAuth) {
  if (!openapiAuth) return { state: "missing_openapi", reasons: ["operation_not_documented"] };
  if (openapiAuth.unknown_security_schemes?.length) {
    return { state: "undefined_scheme", reasons: openapiAuth.unknown_security_schemes.map((scheme) => `undefined_security_scheme:${scheme}`) };
  }
  if (runtimeAuth?.state !== "resolved") return { state: "unknown", reasons: [runtimeAuth?.profile || "runtime_auth_unresolved"] };
  if (openapiAuth.security_alternatives === null) return { state: "unknown", reasons: ["openapi_security_inheritance_unresolved"] };
  const runtimeAlternatives = canonicalAlternativeList(runtimeAuth.alternatives);
  const contractAlternatives = canonicalAlternativeList(openapiAuth.security_alternatives);
  const runtime = JSON.stringify(runtimeAlternatives);
  const contract = JSON.stringify(contractAlternatives);
  if (runtime === contract) return { state: "equivalent", reasons: [] };
  return {
    state: "mismatch",
    reasons: [`runtime:${runtimeAlternatives.map((entry) => entry.join("+")).join("|") || "public"}`, `openapi:${contractAlternatives.map((entry) => entry.join("+")).join("|") || "public"}`],
  };
}

export function parseMountedRouteFiles(indexSource = "") {
  const imports = new Map();
  const importRe = /import\s*{([\s\S]*?)}\s*from\s*["']\.\/([^"']+)["'];/g;
  let match;
  while ((match = importRe.exec(indexSource)) !== null) {
    const file = `routes/${match[2]}`.replace(/\\/g, "/");
    for (const raw of match[1].split(",")) {
      const symbol = raw.trim().split(/\s+as\s+/i).pop();
      if (symbol) imports.set(symbol, file);
    }
  }

  const dynamicImportRe = /import\(\s*["']\.\/([^"']+)["']\s*\)\s*\.then\(\s*\(\s*{([^}]+)}\s*\)\s*=>/g;
  while ((match = dynamicImportRe.exec(indexSource)) !== null) {
    const file = `routes/${match[1]}`.replace(/\\/g, "/");
    for (const raw of match[2].split(",")) {
      const symbol = raw.trim().split(/\s*:\s*|\s+as\s+/i).pop();
      if (symbol) imports.set(symbol, file);
    }
  }

  const mounted = [];
  const useRe = /app\.use\(\s*(?:(["'`])([^"'`]+)\1\s*,\s*)?(build[A-Za-z0-9_]+)\s*\(/g;
  while ((match = useRe.exec(indexSource)) !== null) {
    const builder = match[3];
    const file = imports.get(builder);
    if (!file) continue;
    mounted.push({ builder, file, mount_prefix: normalizeRoutePath(match[2] || "/"), mount_order: match.index });
  }
  const seen = new Set();
  return mounted
    .sort((a, b) => a.mount_order - b.mount_order)
    .filter((entry) => {
      const key = `${entry.builder}|${entry.file}|${entry.mount_prefix}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function findMatchingBrace(source, openingIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (["\"", "'", "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}" && --depth === 0) return index;
  }
  return -1;
}

function findMatchingDelimiter(source, openingIndex, openingCharacter, closingCharacter) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (["\"", "'", "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === openingCharacter) depth += 1;
    if (character === closingCharacter && --depth === 0) return index;
  }
  return -1;
}

function splitTopLevelArguments(source = "") {
  const values = [];
  let start = 0;
  let quote = "";
  let escaped = false;
  let round = 0;
  let square = 0;
  let curly = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (["\"", "'", "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    else if (character === "[") square += 1;
    else if (character === "]") square -= 1;
    else if (character === "{") curly += 1;
    else if (character === "}") curly -= 1;
    else if (character === "," && round === 0 && square === 0 && curly === 0) {
      values.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = source.slice(start).trim();
  if (tail) values.push(tail);
  return values;
}

function maskJavaScriptComments(source = "") {
  const input = canonicalText(source);
  const output = [...input];
  let quote = "";
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (["\"", "'", "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === "/" && next === "/") {
      output[index] = " ";
      output[index + 1] = " ";
      index += 2;
      while (index < input.length && input[index] !== "\n") {
        output[index] = " ";
        index += 1;
      }
      index -= 1;
      continue;
    }
    if (character === "/" && next === "*") {
      output[index] = " ";
      output[index + 1] = " ";
      index += 2;
      while (index < input.length) {
        if (input[index] === "*" && input[index + 1] === "/") {
          output[index] = " ";
          output[index + 1] = " ";
          index += 1;
          break;
        }
        if (input[index] !== "\n") output[index] = " ";
        index += 1;
      }
    }
  }
  return output.join("");
}

function middlewareAliases(source = "") {
  const aliases = new Map();
  const text = maskJavaScriptComments(source);
  for (const match of text.matchAll(/\b(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*\[([\s\S]*?)\]\s*(?:\.\s*filter\s*\(\s*Boolean\s*\))?\s*;/g)) {
    const containsGuard = [...match[2].matchAll(/\b(?:deps\.)?([A-Za-z_$][A-Za-z0-9_$]*)\b/g)]
      .some((entry) => AUTH_GUARDS.has(entry[1]) || aliases.has(entry[1]));
    if (/^(?:require|verify|authenticate|authorize|auth)/i.test(match[1]) || containsGuard) aliases.set(match[1], match[2]);
  }
  const helperRe = /\bfunction\s+([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/g;
  let helper;
  while ((helper = helperRe.exec(text)) !== null) {
    const opening = text.indexOf("{", helper.index);
    const closing = findMatchingBrace(text, opening);
    if (closing < 0) continue;
    const returnedArray = text.slice(opening + 1, closing).match(/\breturn\s*\[([\s\S]*?)\]\s*;?/);
    if (returnedArray) {
      const containsGuard = [...returnedArray[1].matchAll(/\b(?:deps\.)?([A-Za-z_$][A-Za-z0-9_$]*)\b/g)]
        .some((entry) => AUTH_GUARDS.has(entry[1]) || aliases.has(entry[1]));
      if (/^(?:require|verify|authenticate|authorize|auth)/i.test(helper[1]) || containsGuard) aliases.set(helper[1], returnedArray[1]);
    }
    helperRe.lastIndex = closing + 1;
  }
  for (const match of text.matchAll(
    /\b(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*requireSecurityMiddleware\s*\(\s*(["'`])[^"'`]+\2\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*,?\s*\)\s*;/g,
  )) {
    aliases.set(match[1], match[3]);
  }
  for (const match of text.matchAll(/\b(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*\([^)]*\)\s*=>\s*([\s\S]*?);/g)) {
    const containsGuard = [...match[2].matchAll(/\b(?:deps\.)?([A-Za-z_$][A-Za-z0-9_$]*)\b/g)]
      .some((entry) => AUTH_GUARDS.has(entry[1]) || aliases.has(entry[1]));
    if (containsGuard) aliases.set(match[1], match[2]);
  }
  for (const match of text.matchAll(/\b(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*([^;\n]+);/g)) {
    if (aliases.has(match[1])) continue;
    const containsGuard = [...match[2].matchAll(/\b(?:deps\.)?([A-Za-z_$][A-Za-z0-9_$]*)\b/g)]
      .some((entry) => AUTH_GUARDS.has(entry[1]) || aliases.has(entry[1]));
    if (/^(?:require|verify|authenticate|authorize|auth)/i.test(match[1]) || containsGuard) aliases.set(match[1], match[2]);
  }
  return aliases;
}

function middlewareGuards(expression = "", aliases = new Map(), seen = new Set()) {
  const guards = [];
  for (const match of String(expression).matchAll(/\b(?:deps\.)?([A-Za-z_$][A-Za-z0-9_$]*)\b/g)) {
    const name = match[1];
    if (AUTH_GUARDS.has(name)) guards.push(name);
    if (aliases.has(name) && !seen.has(name)) {
      const nextSeen = new Set(seen);
      nextSeen.add(name);
      guards.push(...middlewareGuards(aliases.get(name), aliases, nextSeen));
    }
  }
  return unique(guards);
}

function activeRouterUseGuards(source, sourceIndex, routePath, aliases) {
  const guards = [];
  const useRe = /(?:router|app)\.use\s*\(/g;
  let match;
  while ((match = useRe.exec(source)) !== null && match.index < sourceIndex) {
    const opening = source.indexOf("(", match.index);
    const closing = findMatchingDelimiter(source, opening, "(", ")");
    if (closing < 0 || closing >= sourceIndex) continue;
    const args = splitTopLevelArguments(source.slice(opening + 1, closing));
    const prefixMatch = args[0]?.match(/^["'`]([^"'`]+)["'`]$/);
    const prefix = prefixMatch ? normalizeRoutePath(prefixMatch[1]) : null;
    if (prefix && routePath !== prefix && !routePath.startsWith(`${prefix}/`)) continue;
    for (const argument of prefix ? args.slice(1) : args) guards.push(...middlewareGuards(argument, aliases));
  }
  return unique(guards);
}

export function runtimeAuthProfile({ routePath, routeGuards = [], inheritedGuards = [], override = null }) {
  const guardChain = unique([...inheritedGuards, ...routeGuards]);
  const evidence = [
    ...inheritedGuards.map((guard) => `router.use:${guard}`),
    ...routeGuards.map((guard) => `route:${guard}`),
  ];
  if (override?.profile && guardChain.length) {
    const discovered = runtimeAuthProfile({ routePath, routeGuards, inheritedGuards, override: null });
    if (discovered.state !== "resolved") {
      return { ...discovered, evidence: unique([...(discovered.evidence || []), ...(override.evidence_refs || [])]) };
    }
    if (discovered.profile !== override.profile) {
      return {
        state: "unresolved",
        profile: "auth_policy_conflicts_with_runtime_guard",
        alternatives: null,
        principal: null,
        guard_chain: guardChain,
        evidence: unique([...evidence, ...(override.evidence_refs || [])]),
        configuration_dependencies: discovered.configuration_dependencies || [],
      };
    }
    return { ...discovered, evidence: unique([...(discovered.evidence || []), ...(override.evidence_refs || [])]) };
  }
  if (override?.profile) {
    const selected = AUTH_PROFILES[override.profile];
    if (selected) return { state: "resolved", profile: override.profile, ...selected, guard_chain: guardChain, evidence: unique([...evidence, ...(override.evidence_refs || [])]) };
  }

  const hasBackend = guardChain.includes("requireBackendApiKey");
  const hasAdmin = guardChain.includes("requireAdminPrincipal") || guardChain.includes("requireAdmin");
  const hasBackendOrUser = guardChain.includes("requireResolutionPrincipal");
  const hasUser = guardChain.some((guard) => ["requireUserJwt", "requireTenantUserJwt", "verifyUserJwt", "requireUser", "requireTenantPrincipal", "requireTenantOperationPrincipal", "requireActiveMembership", "requireWorkspaceOwner"].includes(guard));
  const hasLocal = guardChain.some((guard) => ["requireLocalManagerDevice", "requireLocalManagerUser", "requireFreshLocalManagerDeviceForPrivilegedInstaller"].includes(guard));
  const hasMcp = guardChain.includes("requireMcpToken");
  const hasSignedQuery = guardChain.includes("verifyInstallerDownloadToken");
  const hasGitHubWebhook = guardChain.includes("requireGitHubWebhookSignature");
  const hasBackendAuthenticator = hasBackend || hasBackendOrUser;
  const hasPrincipalAuthenticator = hasBackendAuthenticator || hasAdmin || hasUser || hasLocal;
  const hasStandaloneSignedQuery = hasSignedQuery && !hasPrincipalAuthenticator;
  const isolatedModes = [hasLocal, hasMcp, hasStandaloneSignedQuery, hasGitHubWebhook].filter(Boolean).length;
  if (hasBackendAuthenticator && hasLocal && !hasAdmin && !hasUser && !hasMcp && !hasGitHubWebhook) {
    return {
      state: "resolved",
      profile: "backend_local_manager",
      alternatives: [
        ["backendBearerAuth", "localManagerBearerAuth"],
        ["backendApiKeyAuth", "localManagerBearerAuth"],
      ],
      principal: "local_manager",
      guard_chain: guardChain,
      evidence,
      configuration_dependencies: ["BACKEND_API_KEY"],
    };
  }
  if (isolatedModes > 1 || (isolatedModes === 1 && (hasBackendAuthenticator || hasAdmin || hasUser))) {
    return { state: "unresolved", profile: "mixed_guard_chain", alternatives: null, principal: null, guard_chain: guardChain, evidence, configuration_dependencies: [] };
  }
  if (hasBackendAuthenticator && hasAdmin && !hasUser) {
    return { state: "resolved", profile: "admin_backend", alternatives: [["adminBearerAuth"], ["backendApiKeyAuth"]], principal: "admin", guard_chain: guardChain, evidence, configuration_dependencies: ["BACKEND_API_KEY"] };
  }
  if (hasBackendAuthenticator && hasUser && !hasAdmin) {
    return { state: "resolved", profile: "user_jwt", alternatives: [["userJwtAuth"]], principal: "tenant_user", guard_chain: guardChain, evidence, configuration_dependencies: ["BACKEND_API_KEY", "JWT_SECRET"] };
  }
  if (hasBackendAuthenticator && !hasAdmin && !hasUser) {
    return { state: "resolved", profile: "backend_or_user", alternatives: [["backendBearerAuth"], ["backendApiKeyAuth"]], principal: "authenticated", guard_chain: guardChain, evidence, configuration_dependencies: ["BACKEND_API_KEY", "JWT_SECRET"] };
  }
  if (hasAdmin && !hasBackendAuthenticator && !hasUser) {
    return { state: "unresolved", profile: "authorizer_without_authenticator", alternatives: null, principal: "admin", guard_chain: guardChain, evidence, configuration_dependencies: [] };
  }
  if (hasAdmin && hasUser) {
    return { state: "unresolved", profile: "mixed_guard_chain", alternatives: null, principal: null, guard_chain: guardChain, evidence, configuration_dependencies: [] };
  }
  if (hasUser) return { state: "resolved", profile: "user_jwt", alternatives: [["userJwtAuth"]], principal: "tenant_user", guard_chain: guardChain, evidence, configuration_dependencies: ["JWT_SECRET"] };
  if (hasLocal) return { state: "resolved", profile: "local_manager", alternatives: [["localManagerBearerAuth"]], principal: "local_manager", guard_chain: guardChain, evidence, configuration_dependencies: [] };
  if (hasMcp) return { state: "resolved", profile: "mcp_query_token", alternatives: [["mcpQueryTokenAuth"]], principal: "mcp_client", guard_chain: guardChain, evidence, configuration_dependencies: ["MCP_QUERY_TOKEN"] };
  if (hasSignedQuery) return { state: "resolved", profile: "signed_query_token", alternatives: [["signedQueryTokenAuth"]], principal: "signed_link", guard_chain: guardChain, evidence, configuration_dependencies: [] };
  if (hasGitHubWebhook) return { state: "resolved", profile: "github_webhook_hmac", alternatives: [["githubWebhookSignature"]], principal: "github_webhook", guard_chain: guardChain, evidence, configuration_dependencies: ["GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET"] };
  if (/^\/(?:connect$|connect\/assets(?:\/|$)|platform$|platform\/assets(?:\/|$)|platform\/ui-surfaces$|favicon\.ico$|robots\.txt$)/.test(routePath)) {
    return { state: "resolved", profile: "public", alternatives: [], principal: "anonymous", guard_chain: [], evidence: ["explicit_public_route_allowlist"], configuration_dependencies: [] };
  }
  return { state: "unresolved", profile: "no_explicit_auth_evidence", alternatives: null, principal: null, guard_chain: guardChain, evidence, configuration_dependencies: [] };
}

function enclosingHelper(source, sourceIndex) {
  const functionRe = /function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*\{/g;
  let match;
  let enclosing = null;
  while ((match = functionRe.exec(source)) !== null && match.index < sourceIndex) {
    const opening = functionRe.lastIndex - 1;
    const closing = findMatchingBrace(source, opening);
    if (closing >= sourceIndex) {
      enclosing = {
        name: match[1],
        declaration_index: match.index,
        closing,
        parameters: splitTopLevelArguments(match[2])
          .map((parameter) => parameter.match(/^[A-Za-z_$][A-Za-z0-9_$]*/)?.[0])
          .filter(Boolean),
      };
    }
  }
  return enclosing;
}

function staticTemplateExpansions(source, sourceIndex, routeTemplate) {
  const tokens = unique([...String(routeTemplate).matchAll(/\$\{([A-Za-z0-9_]+)}/g)].map((match) => match[1]));
  if (!tokens.length) return [routeTemplate];
  const helper = enclosingHelper(source, sourceIndex);
  if (!helper) return [];
  const expanded = [];
  const callSources = [
    source.slice(0, helper.declaration_index),
    source.slice(helper.closing + 1),
  ];
  for (const callSource of callSources) {
    const callRe = new RegExp(`\\b${helper.name}\\s*\\(([\\s\\S]*?)\\);`, "g");
    let call;
    while ((call = callRe.exec(callSource)) !== null) {
      const bindings = {};
      for (const token of tokens) {
        const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, (character) => `\\${character}`);
        const value = call[1].match(new RegExp(`\\b${escapedToken}\\s*:\\s*([\"'\\x60])([^\"'\\x60]+)\\1`))?.[2];
        if (value) bindings[token] = value;
      }
      if (tokens.every((token) => bindings[token])) {
        expanded.push(tokens.reduce((value, token) => value.replaceAll(`\${${token}}`, bindings[token]), routeTemplate));
      }
    }
  }
  return unique(expanded);
}

function mountedPrefixesForReceiver(source, receiverName, startIndex = 0) {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(receiverName)) return [];
  const useRe = new RegExp(
    `\\b[A-Za-z_$][A-Za-z0-9_$]*\\.use\\s*\\(\\s*([\\"'\\x60])([^\\"'\\x60]+)\\1\\s*,\\s*${receiverName}\\b`,
    "g",
  );
  useRe.lastIndex = startIndex;
  const prefixes = [];
  let match;
  while ((match = useRe.exec(source)) !== null) prefixes.push(normalizeRoutePath(match[2]));
  return unique(prefixes);
}

function helperInvocationBindings(source, sourceIndex, aliases, mountPrefix) {
  const helper = enclosingHelper(source, sourceIndex);
  const fallback = [{ mount_prefix: normalizeRoutePath(mountPrefix), guards: [] }];
  if (!helper || helper.parameters[0] !== "router") return fallback;

  const callRe = new RegExp(`\\b${helper.name}\\s*\\(`, "g");
  callRe.lastIndex = helper.closing + 1;
  const bindings = [];
  let call;
  while ((call = callRe.exec(source)) !== null) {
    const opening = source.indexOf("(", call.index);
    const closing = findMatchingDelimiter(source, opening, "(", ")");
    if (closing < 0) continue;
    const args = splitTopLevelArguments(source.slice(opening + 1, closing));
    const receiverName = args[0]?.match(/^[A-Za-z_$][A-Za-z0-9_$]*$/)?.[0];
    if (!receiverName) {
      callRe.lastIndex = closing + 1;
      continue;
    }
    const guards = unique(args.slice(1).flatMap((argument) => middlewareGuards(argument, aliases)));
    const internalPrefixes = mountedPrefixesForReceiver(source, receiverName, closing + 1);
    for (const internalPrefix of internalPrefixes.length ? internalPrefixes : ["/"]) {
      bindings.push({
        mount_prefix: joinRoutePath(mountPrefix, internalPrefix),
        guards,
      });
    }
    callRe.lastIndex = closing + 1;
  }

  const seen = new Set();
  const uniqueBindings = bindings.filter((binding) => {
    const key = `${binding.mount_prefix}|${binding.guards.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return uniqueBindings.length ? uniqueBindings : fallback;
}

export function parseRoutesFromFile(source, file, mountPrefix = "/", { receiver = "router_or_app" } = {}) {
  const operations = [];
  const scanSource = maskJavaScriptComments(source);
  const aliases = middlewareAliases(scanSource);
  const receiverPattern = receiver === "app" ? "app" : "(?:router|app)";
  const routeRe = new RegExp(`${receiverPattern}\\.(get|post|put|patch|delete|all)\\s*\\(\\s*([\"'\\x60])([^\"'\\x60]+)\\2`, "gs");
  let match;
  while ((match = routeRe.exec(scanSource)) !== null) {
    const registrationMethod = match[1].toUpperCase();
    const methods = registrationMethod === "ALL" ? [...HTTP_METHODS] : [registrationMethod];
    if (methods.some((method) => !HTTP_METHODS.has(method))) continue;
    const opening = scanSource.indexOf("(", match.index);
    const closing = findMatchingDelimiter(scanSource, opening, "(", ")");
    if (closing < 0) continue;
    const declaration = scanSource.slice(match.index, closing + 1);
    const args = splitTopLevelArguments(scanSource.slice(opening + 1, closing));
    // Authentication is sometimes enforced inside the final handler rather than
    // as Express middleware (for example, signed installer download tokens).
    // Inspect every post-path argument so those gates remain visible to parity.
    const routeGuards = unique([
      ...args.slice(1).flatMap((argument) => middlewareGuards(argument, aliases)),
      ...middlewareGuards(declaration, aliases),
    ]);
    const helperBindings = helperInvocationBindings(scanSource, match.index, aliases, mountPrefix);
    const expansions = staticTemplateExpansions(scanSource, match.index, match[3]);
    const routes = expansions.length ? expansions : [match[3]];
    for (const route of routes) {
      for (const expandedRoute of expandRoutePaths(route)) {
        for (const binding of helperBindings) {
          const routePath = joinRoutePath(binding.mount_prefix, expandedRoute);
          const inheritedGuards = unique([
            ...activeRouterUseGuards(scanSource, match.index, routePath, aliases),
            ...binding.guards,
          ]);
          for (const method of methods) {
            operations.push({
              method,
              path: routePath,
              signature: `${method} ${routePath}`,
              source_file: file,
              source_index: match.index,
              declaration,
              route_guards: routeGuards,
              inherited_guards: inheritedGuards,
            });
          }
        }
      }
    }
  }
  return operations;
}

function scopeFor({ path: routePath, source, declaration = "", sourceIndex = 0, runtimeAuth = null }) {
  if (runtimeAuth?.state === "resolved") {
    if (runtimeAuth.profile === "public") return "public";
    if (runtimeAuth.profile === "admin_backend") return "admin";
    if (runtimeAuth.profile === "user_jwt") return "tenant";
    if (["local_manager", "backend_local_manager"].includes(runtimeAuth.profile)) return "local_device";
    if (["mcp_query_token", "signed_query_token", "github_webhook_hmac"].includes(runtimeAuth.profile)) return "developer";
  }
  if (/^\/(?:connect$|connect\/assets(?:\/|$)|platform$|platform\/assets(?:\/|$)|platform\/ui-surfaces$|favicon\.ico$|robots\.txt$|legal(?:\/|$))/.test(routePath)) return "public";
  if (/local-manager|local-gateway|connector\/(?:devices?|routes?)/i.test(routePath)) return "local_device";
  if (/^\/me(?:\/|$)|\/workspaces?\/{[^}]+}/.test(routePath)) return "tenant";
  if (/requireTenant|requireUser|requireMembership|requireWorkspace/i.test(declaration)) return "tenant";
  if (/^\/admin(?:\/|$)/.test(routePath) || /requireAdminPrincipal|requireBackendApiKey/.test(declaration)) return "admin";
  const globalAdminGuards = [...source.matchAll(/(?:router|app)\.use\s*\(\s*(?:requireBackendApiKey|requireAdminPrincipal)/g)]
    .map((match) => match.index)
    .filter((index) => index < sourceIndex);
  if (globalAdminGuards.length) return "admin";
  if (/developer|openapi|audit|evidence/i.test(routePath)) return "developer";
  return "unresolved";
}

function groupFor(routePath, file) {
  const value = `${routePath} ${file}`.toLowerCase();
  const groups = [
    ["authentication", /auth|onboarding|connect/],
    ["growth", /growth|dashboard|activation-guidance/],
    ["resources", /resource|workspace/],
    ["connections", /connector|credential|integration/],
    ["local-manager", /local-manager|local-gateway|device/],
    ["support", /support|ticket/],
    ["agents", /agent|gpt|session/],
    ["plugins", /plugin|connected-execution/],
    ["operations", /operational|runtime-verification|status|health|incident/],
    ["activation", /activation/],
    ["infrastructure", /infrastructure|deployment|ssh|database|backup/],
    ["governance", /governance|authority|grant|policy|access/],
    ["release", /release|readiness/],
    ["developer-evidence", /developer|openapi|schema|audit|evidence|revision|change|graph|job|workflow/],
  ];
  return groups.find(([, matcher]) => matcher.test(value))?.[0] || "platform-core";
}

function evidenceRoute(operation) {
  return /evidence|readback|verification|audit|changes|revisions|history|preview|status|health/i.test(operation.path);
}

function testFilesFromManifest(source = "") {
  return unique([...canonicalText(source).matchAll(/\bnode\s+((?:[A-Za-z0-9_.-]+\/)*test-[A-Za-z0-9_.-]+\.mjs)\b/g)].map((match) => match[1]));
}

export function parseTestEvidenceClaims(source = "") {
  return unique([...canonicalText(source).matchAll(/^\s*\/\/\s*frontend-surface-operation:\s*(get|post|put|patch|delete)\s+(\/\S*)\s*$/gim)]
    .map((match) => `${match[1].toUpperCase()} ${normalizeRoutePath(match[2])}`));
}

function loadRegisteredTestEvidence(apiRoot, testFiles) {
  const root = path.resolve(apiRoot);
  const bySignature = new Map();
  const claimedFiles = [];
  for (const testFile of testFiles) {
    const target = path.resolve(apiRoot, testFile);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) continue;
    const source = readText(target);
    let claimed = false;
    for (const signature of parseTestEvidenceClaims(source)) {
      if (!bySignature.has(signature)) bySignature.set(signature, []);
      bySignature.get(signature).push(testFile);
      claimed = true;
    }
    if (claimed) claimedFiles.push(target);
  }
  for (const [signature, files] of bySignature) bySignature.set(signature, unique(files));
  return { bySignature, claimedFiles: unique(claimedFiles) };
}

function resourceEvidenceForFamily(file, resourceManifest) {
  const body = JSON.stringify(resourceManifest || {});
  const basename = path.basename(file);
  const key = toKebab(basename).replace(/-/g, "_");
  const resources = Array.isArray(resourceManifest?.resources) ? resourceManifest.resources : [];
  return resources
    .filter((entry) => entry.route_file === file.replace(/^http-generic-api\//, "").replace(/^routes\//, "routes/")
      || entry.route_file === file
      || body.includes(basename)
      || String(entry.resource_key || "").includes(key))
    .map((entry) => entry.resource_key)
    .filter(Boolean);
}

function operationDeliveryEvidence(operation) {
  const declaration = String(operation.declaration || "");
  const evidence = [];
  if (/text\/html|\.type\s*\(\s*["']html["']|<!doctype html/i.test(declaration)) evidence.push("response_content_type:text/html");
  if (/sendFile\s*\(/.test(declaration) && /\/assets(?:\/|\{|$)/.test(operation.path)) evidence.push("response_static_asset");
  return {
    embedded_ui: evidence.length > 0,
    embedded_ui_evidence: evidence,
    delivery_kind: evidence.includes("response_content_type:text/html") ? "embedded_html" : evidence.length ? "embedded_asset" : "api",
  };
}

const SURFACE_DECISIONS = new Set([
  "unified_ui",
  "embedded_ui",
  "legacy_compatibility",
  "api_only",
  "internal_only",
  "deferred",
  "requires_review",
]);

function normalizedSurfaceDecision(value) {
  return SURFACE_DECISIONS.has(value) ? value : "requires_review";
}

function pathMatchesPolicyPrefix(routePath, prefix) {
  const normalizedPrefix = normalizeRoutePath(prefix);
  return routePath === normalizedPrefix || routePath.startsWith(`${normalizedPrefix}/`);
}

function surfacePolicyPartitionKey(operation, policy) {
  const prefixes = (Array.isArray(policy?.rules) ? policy.rules : [])
    .filter((rule) => {
      if (!rule.path_prefix || !pathMatchesPolicyPrefix(operation.path, rule.path_prefix)) return false;
      if (rule.source_file && rule.source_file !== operation.source_file) return false;
      if (rule.scope && rule.scope !== operation.scope) return false;
      if (rule.group && rule.group !== groupFor(operation.path, operation.source_file)) return false;
      return true;
    })
    .map((rule) => normalizeRoutePath(rule.path_prefix));
  return unique(prefixes).sort().join("|") || "default";
}

function policyDecision(family, policy) {
  const rules = Array.isArray(policy?.rules) ? policy.rules : [];
  const matchingRules = rules.filter((candidate) => {
    if (candidate.family_key && candidate.family_key !== family.family_key) return false;
    if (candidate.source_file && candidate.source_file !== family.source_file) return false;
    if (candidate.scope && candidate.scope !== family.scope) return false;
    if (candidate.path_prefix && (!family.operations.length || !family.operations.every((operation) => pathMatchesPolicyPrefix(operation.path, candidate.path_prefix)))) return false;
    if (candidate.group && candidate.group !== family.group) return false;
    return true;
  });
  if (matchingRules.length > 1) {
    return {
      decision: "requires_review",
      rationale: `Multiple surface policy rules match this family: ${matchingRules.map((rule) => rule.rule_id || "unnamed").join(", ")}.`,
      owner: null,
    };
  }
  const rule = matchingRules[0];
  if (rule && rule.owner && rule.rationale) {
    const decision = normalizedSurfaceDecision(rule.decision);
    return {
      decision,
      rationale: decision === rule.decision
        ? rule.rationale
        : `Invalid surface decision "${String(rule.decision)}" in policy rule ${rule.rule_id || "unnamed"}; explicit review is required.`,
      owner: decision === rule.decision ? rule.owner : null,
      rule_id: rule.rule_id || null,
      evidence_refs: unique(rule.evidence_refs || []),
    };
  }
  return {
    decision: normalizedSurfaceDecision(policy?.default_decision),
    rationale: "No repository policy decision covers this route family.",
    owner: null,
  };
}

function matchingOperationRules(operation, policy) {
  return (Array.isArray(policy?.operation_rules) ? policy.operation_rules : []).filter((rule) => {
    if (rule.operation !== operation.signature) return false;
    if (rule.source_file && rule.source_file !== operation.source_file) return false;
    return true;
  });
}

function authRuleOperations(rule = {}) {
  return unique([rule.operation, ...(Array.isArray(rule.operations) ? rule.operations : [])]);
}

function matchingAuthRules(operation, policy) {
  return (Array.isArray(policy?.auth_rules) ? policy.auth_rules : []).filter((rule) => {
    if (!authRuleOperations(rule).includes(operation.signature)) return false;
    if (rule.source_file && rule.source_file !== operation.source_file) return false;
    return true;
  });
}

function referencedOperations(control = {}) {
  return unique([control.operation, ...(Array.isArray(control.operations) ? control.operations : [])]);
}

function mutationGovernance(operation, policy, discoveredSignatures) {
  if (operation.method === "GET") {
    return {
      classification: "read",
      classification_source: "http_method",
      mutation_candidate: false,
      governed: true,
      controls: null,
      blockers: [],
      rule_id: null,
    };
  }
  const rules = matchingOperationRules(operation, policy);
  if (rules.length !== 1) {
    return {
      classification: "unresolved",
      classification_source: "fail_closed",
      mutation_candidate: true,
      governed: false,
      controls: null,
      blockers: [rules.length > 1 ? "duplicate_operation_rule" : "operation_classification_gap"],
      rule_id: null,
    };
  }
  const rule = rules[0];
  const classification = OPERATION_CLASSIFICATIONS.has(rule.classification) ? rule.classification : "unresolved";
  const blockers = [];
  if (!rule.owner || !rule.rationale) blockers.push("operation_rule_attribution_gap");
  if (classification === "unresolved") blockers.push("operation_classification_gap");
  const mutation = ["state_change", "external_effect"].includes(classification);
  const controls = mutation ? {
    preflight: rule.preflight || null,
    approval: rule.approval || null,
    readback: rule.readback || null,
    rollback: rule.rollback || null,
  } : null;
  if (mutation) {
    for (const controlName of ["preflight", "approval", "readback", "rollback"]) {
      const control = controls[controlName];
      if (!control?.mode) {
        blockers.push(`mutation_${controlName}_gap`);
        continue;
      }
      const references = referencedOperations(control);
      if (references.some((signature) => !discoveredSignatures.has(signature))) blockers.push(`mutation_${controlName}_reference_gap`);
      if (controlName === "readback" && references.includes(operation.signature) && control.mode !== "inline_post_commit") blockers.push("mutation_readback_self_reference");
      if (control.mode === "inline_post_commit" && !(rule.evidence_refs || []).length) blockers.push(`mutation_${controlName}_evidence_gap`);
      if (control.mode === "not_required" && (!control.rationale || !rule.owner)) blockers.push(`mutation_${controlName}_exemption_gap`);
    }
    if (!(rule.evidence_refs || []).length) blockers.push("mutation_evidence_gap");
    if (!rule.parameter_bindings && ["state_change", "external_effect"].includes(classification)) blockers.push("mutation_parameter_binding_gap");
  }
  return {
    classification,
    classification_source: rule.generated_evidence ? "generated_operation_rule" : "operation_rule",
    mutation_candidate: true,
    governed: blockers.length === 0,
    controls,
    parameter_bindings: rule.parameter_bindings || null,
    blockers: unique(blockers),
    rule_id: rule.rule_id || null,
    owner: rule.owner || null,
    rationale: rule.rationale || null,
    evidence_refs: unique(rule.evidence_refs || []),
  };
}

function operationAuthOverride(operation, policy) {
  const authRules = matchingAuthRules(operation, policy);
  if (authRules.length === 1) return authRules[0];
  if (authRules.length > 1) return null;
  const operationRules = matchingOperationRules(operation, policy);
  return operationRules.length === 1 ? operationRules[0].auth || null : null;
}

function generatedOperationId(operation) {
  const base = `${operation.method.toLowerCase()}-${operation.path}`
    .replace(/\{([^}]+)\}/g, "-by-$1")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .filter(Boolean)
    .map((part, index) => index === 0 ? part : `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
    .join("");
  return `${base || "runtimeOperation"}${digest(operation.signature).slice(0, 8)}`;
}

function securityRequirements(alternatives) {
  if (!alternatives?.length) return [];
  return alternatives.map((schemes) => Object.fromEntries(schemes.map((scheme) => [scheme, []])));
}

function runtimeOpenApiDocument(plan) {
  const bySignature = new Map();
  for (const family of plan.families || []) {
    for (const operation of family.operations || []) {
      if (operation.openapi_canonical_documented || operation.runtime_auth?.state !== "resolved") continue;
      if (!bySignature.has(operation.signature)) bySignature.set(operation.signature, []);
      bySignature.get(operation.signature).push(operation);
    }
  }
  const paths = {};
  for (const [signature, records] of [...bySignature.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const profiles = unique(records.map((record) => JSON.stringify(record.runtime_auth.alternatives || [])));
    if (profiles.length !== 1) continue;
    const operation = records[0];
    const parameters = [...operation.path.matchAll(/\{([^}]+)}/g)].map((match) => ({
      name: match[1],
      in: "path",
      required: true,
      schema: { type: "string", minLength: 1 },
    }));
    if (!paths[operation.path]) paths[operation.path] = {};
    paths[operation.path][operation.method.toLowerCase()] = {
      operationId: generatedOperationId(operation),
      summary: `${signature} (runtime operation index)`,
      description: "Machine-generated operation presence and authentication index. Request and response schemas require a reviewed canonical contract before frontend dispatch.",
      tags: ["runtime-route-index"],
      security: securityRequirements(operation.runtime_auth.alternatives),
      ...(parameters.length ? { parameters } : {}),
      responses: {
        default: { description: "Runtime response shape is not yet captured by a reviewed canonical schema." },
      },
      "x-contract-completeness": "operation-index-only",
      "x-source-file": operation.source_file,
      "x-mad4b-runtime-auth": {
        profile: operation.runtime_auth.profile,
        principal: operation.runtime_auth.principal,
        guard_chain: operation.runtime_auth.guard_chain,
        configuration_dependencies: operation.runtime_auth.configuration_dependencies,
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "MAD4B Runtime Route Operation Index",
      version: "1.0.0-generated",
      description: "Generated from mounted Express routes. This document closes operation-discovery gaps only; x-contract-completeness=operation-index-only is not a reviewed request/response schema contract.",
    },
    servers: [{ url: "https://auth.mad4b.com" }],
    tags: [{ name: "runtime-route-index", description: "Fail-closed generated inventory of runtime operations with explicit authentication evidence." }],
    paths,
    components: {
      securitySchemes: {
        adminBearerAuth: { type: "http", scheme: "bearer", bearerFormat: "Backend API Key", description: "Backend API key supplied as a bearer token and accepted only with the admin principal guard." },
        backendBearerAuth: { type: "http", scheme: "bearer", bearerFormat: "Backend API Key, User JWT, or API credential" },
        backendApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
        userJwtAuth: { type: "http", scheme: "bearer", bearerFormat: "User JWT" },
        localManagerBearerAuth: { type: "http", scheme: "bearer", bearerFormat: "User JWT or Local Manager device token" },
        connectorBearerAuth: { type: "http", scheme: "bearer", bearerFormat: "Connector secret or backend API key" },
        mcpQueryTokenAuth: { type: "apiKey", in: "query", name: "token" },
        signedQueryTokenAuth: { type: "apiKey", in: "query", name: "token" },
      },
    },
  };
}

function runtimeOpenApiContent(plan) {
  return `${YAML.stringify(runtimeOpenApiDocument(plan), { lineWidth: 0 })}`;
}

function waveFor(family) {
  if (family.scope === "admin") return "F3-admin-workspaces";
  if (family.scope === "local_device") return "F4-local-manager";
  if (family.scope === "developer" || family.group === "developer-evidence") return "F5-developer-evidence";
  if (["tenant", "public"].includes(family.scope)) return "F1-tenant-shell";
  return "F0-authority-resolution";
}

function dependenciesFor(family) {
  const deps = ["F0-source-baseline"];
  if (family.scope === "admin") deps.push("F2-admin-bff-session");
  if (family.scope === "local_device") deps.push("F1-tenant-workspace-context", "F4-device-trust");
  if (["tenant", "developer"].includes(family.scope)) deps.push("F1-tenant-workspace-context");
  if (family.operations.some((operation) => operation.mutation_candidate)) deps.push("operation-classification");
  if (family.operations.some((operation) => operation.mutation)) deps.push("mutation-preflight", "same-cycle-readback");
  return unique(deps);
}

function riskFor(family) {
  let score = 0;
  if (family.scope === "admin") score += 5;
  if (family.scope === "local_device") score += 4;
  if (family.scope === "unresolved") score += 5;
  if (family.operations.some((operation) => operation.mutation_candidate)) score += 2;
  if (family.operations.some((operation) => operation.mutation)) score += 2;
  if (family.openapi_gaps.length) score += 2;
  if (family.openapi_detail_gaps?.length) score += 1;
  if (family.auth_contract_gaps?.length) score += 2;
  if (family.untested_operations.length) score += 2;
  if (family.surface_decision.decision === "requires_review") score += 2;
  return { score, class: score >= 9 ? "critical" : score >= 6 ? "high" : score >= 3 ? "medium" : "low" };
}

function taskFor(family) {
  const blockers = [];
  if (family.scope === "unresolved") blockers.push("scope_unresolved");
  if (family.openapi_gaps.length) blockers.push("openapi_contract_gap");
  if (family.openapi_detail_gaps?.length) blockers.push("openapi_detail_contract_gap");
  if (family.auth_contract_gaps?.length) blockers.push("auth_contract_gap");
  if (family.untested_operations.length) blockers.push("test_ownership_gap");
  if (["requires_review", "deferred"].includes(family.surface_decision.decision)) blockers.push("surface_policy_decision_required");
  blockers.push(...unique((family.operation_blockers || []).flatMap((entry) => entry.blockers)));
  return {
    task_key: `frontend.${family.family_key}`,
    title: `Resolve and deliver ${family.label}`,
    wave: waveFor(family),
    state: blockers.length ? "blocked" : "ready",
    blockers,
    dependencies: dependenciesFor(family),
    source_refs: family.source_refs,
    acceptance_gates: [
      "source_baseline_unchanged",
      "scope_and_auth_explicit",
      "openapi_or_explicit_exemption",
      "surface_policy_resolved",
      "tests_registered",
      ...(family.operations.some((operation) => operation.mutation_candidate) ? ["operation_classification_explicit"] : []),
      ...(family.operations.some((operation) => operation.mutation) ? ["preflight_approval_readback_rollback"] : []),
    ],
    verification: unique([
      ...family.tests.map((file) => `node ${file}`),
      "node scripts/frontend-surface-dispatch.mjs --check",
      "node scripts/resource-api-coverage-audit.mjs --changed",
    ]),
  };
}

export function buildDispatchPlan({ apiRoot = process.cwd(), baselineRef = process.env.GITHUB_SHA || "working-tree" } = {}) {
  const generatorPath = fileURLToPath(import.meta.url);
  const indexPath = path.join(apiRoot, "routes", "index.js");
  const openapiPath = path.join(apiRoot, "openapi.yaml");
  const runtimeOpenapiPath = path.join(apiRoot, DEFAULT_OPENAPI_INDEX);
  const openapiAllowlistPath = path.join(apiRoot, "openapi-route-coverage.allowlist.json");
  const resourcePath = path.join(apiRoot, "resource-api-coverage.manifest.json");
  const testManifestPath = path.join(apiRoot, "scripts", "test-manifest.mjs");
  const policyPath = path.join(apiRoot, DEFAULT_POLICY);
  const generatedGovernancePath = path.join(apiRoot, DEFAULT_GENERATED_GOVERNANCE);
  const governanceGeneratorPath = path.join(apiRoot, "scripts", "frontend-operation-governance-generator.mjs");
  const indexSource = readText(indexPath);
  const openapiSource = readText(openapiPath);
  const resourceManifest = readJson(resourcePath, {});
  const testManifestSource = readText(testManifestPath);
  const frontendAssetPaths = unique([
    ...filesUnder(path.join(apiRoot, "public", "connect")),
    ...filesUnder(path.join(apiRoot, "public", "platform")),
  ]);
  const manualPolicy = readJson(policyPath, { schema_version: "frontend-surface-policy-v1", default_decision: "requires_review", rules: [] });
  const generatedGovernance = readJson(generatedGovernancePath, {});
  const generatedGovernanceValid = generatedGovernance.schema_version === "frontend-operation-governance-v1"
    && Array.isArray(generatedGovernance.operation_rules)
    && Array.isArray(generatedGovernance.rejected_candidates)
    && generatedGovernance.generator?.fail_closed === true
    && generatedGovernance.safety?.writes_runtime_source === false
    && generatedGovernance.safety?.writes_database === false
    && generatedGovernance.safety?.executes_provider_calls === false
    && generatedGovernance.safety?.deploys === false
    && generatedGovernance.safety?.secrets_included === false;
  const policy = {
    ...manualPolicy,
    operation_rules: [
      ...(Array.isArray(manualPolicy.operation_rules) ? manualPolicy.operation_rules : []),
      ...(generatedGovernanceValid ? generatedGovernance.operation_rules : []),
    ],
  };
  const openapiReferencePaths = openApiReferenceFiles(openapiSource, openapiPath, apiRoot);
  const openApiAuthority = canonicalOpenApiAuthority({ apiRoot, openapiPath, runtimeOpenapiPath });
  const canonicalOpenApiPaths = openApiAuthority.files;
  const canonicalOpenApiContracts = new Map();
  for (const file of canonicalOpenApiPaths) {
    for (const [signature, contract] of parseOpenApiContracts(readText(file), { sourcePath: file, apiRoot })) canonicalOpenApiContracts.set(signature, contract);
  }
  const generatedOpenApiContracts = fs.existsSync(runtimeOpenapiPath)
    ? parseOpenApiContracts(readText(runtimeOpenapiPath), { sourcePath: runtimeOpenapiPath, apiRoot })
    : new Map();
  const openapiContracts = new Map([...generatedOpenApiContracts, ...canonicalOpenApiContracts]);
  const openapiAllowlist = readJson(openapiAllowlistPath, { exact: [], prefixes: [], files: [] });
  const isOpenApiExempt = (operation) => (openapiAllowlist.exact || []).includes(operation.signature)
    || (openapiAllowlist.prefixes || []).some((prefix) => operation.path === prefix || operation.path.startsWith(`${prefix}/`))
    || (openapiAllowlist.files || []).includes(operation.source_file);
  const testFiles = testFilesFromManifest(testManifestSource);
  const testEvidence = loadRegisteredTestEvidence(apiRoot, testFiles);
  const mounted = parseMountedRouteFiles(indexSource);
  const directIndexOperations = parseRoutesFromFile(indexSource, "routes/index.js", "/", { receiver: "app" });
  if (directIndexOperations.length) {
    mounted.push({
      builder: "directAppRoutes",
      file: "routes/index.js",
      mount_prefix: "/",
      mount_order: Math.min(...directIndexOperations.map((operation) => operation.source_index)),
      direct: true,
    });
  }
  const families = [];

  for (const mount of mounted) {
    const filePath = path.join(apiRoot, mount.file.replace(/^routes\//, "routes/"));
    const source = readText(filePath);
    const discoveredOperations = mount.direct
      ? directIndexOperations
      : parseRoutesFromFile(source, mount.file, mount.mount_prefix);
    const operations = discoveredOperations.map((operation) => {
      const runtimeAuth = runtimeAuthProfile({
        routePath: operation.path,
        routeGuards: operation.route_guards,
        inheritedGuards: operation.inherited_guards,
        override: operationAuthOverride(operation, policy),
      });
      const canonicalOpenApi = canonicalOpenApiContracts.get(operation.signature) || null;
      const openapi = openapiContracts.get(operation.signature) || null;
      const openapiExempt = !openapi && isOpenApiExempt(operation);
      return {
        ...operation,
        scope: scopeFor({ path: operation.path, source, declaration: operation.declaration, sourceIndex: operation.source_index, runtimeAuth }),
        runtime_auth: runtimeAuth,
        openapi_auth: openapi ? {
          source_file: openapi.source_file,
          security_declared: openapi.security_declared,
          security_alternatives: openapi.security_alternatives,
          unknown_security_schemes: openapi.unknown_security_schemes,
        } : null,
        auth_parity: openapiExempt ? { state: "exempt", reasons: ["repository_openapi_allowlist"] } : authParity(runtimeAuth, openapi),
        openapi_documented: Boolean(openapi),
        openapi_canonical_documented: Boolean(canonicalOpenApi),
        openapi_exempt: openapiExempt,
        openapi_contract_level: canonicalOpenApi ? "canonical" : openapi ? openapi.contract_level : openapiExempt ? "explicit_exemption" : "missing",
        evidence_candidate: evidenceRoute(operation),
        ...operationDeliveryEvidence(operation),
        tests: testEvidence.bySignature.get(operation.signature) || [],
      };
    }).map(({ declaration, source_index, route_guards, inherited_guards, ...operation }) => operation);
    const scopes = unique(operations.map((operation) => operation.scope));
    for (const scope of scopes.length ? scopes : ["unresolved"]) {
      const scopeOperations = operations.filter((operation) => operation.scope === scope);
      const policyPartitions = new Map();
      for (const operation of scopeOperations) {
        const partitionKey = surfacePolicyPartitionKey(operation, policy);
        if (!policyPartitions.has(partitionKey)) policyPartitions.set(partitionKey, []);
        policyPartitions.get(partitionKey).push(operation);
      }
      for (const [policyPartition, scopedOperations] of policyPartitions) {
        const baseKey = toKebab(path.basename(mount.file));
        const splitScope = scopes.length > 1;
        const splitPolicy = policyPartitions.size > 1;
        const split = splitScope || splitPolicy;
        const policyPartitionSuffix = policyPartition === "default"
          ? "default"
          : toKebab(policyPartition.replace(/[{}]/g, ""));
        const familyEmbeddedUi = scopedOperations.some((operation) => operation.embedded_ui);
      const familyTests = unique(scopedOperations.flatMap((operation) => operation.tests));
      const untestedOperations = scopedOperations.length
        ? scopedOperations.filter((operation) => !operation.tests.length).map((operation) => operation.signature)
        : ["NO_DISCOVERED_OPERATIONS"];
      const family = {
        family_key: split
          ? `${baseKey}.${scope}${splitPolicy ? `.${policyPartitionSuffix}` : ""}`
          : baseKey,
        label: `${baseKey.replace(/-/g, " ")}${splitScope ? ` (${scope})` : ""}${splitPolicy ? ` [${policyPartitionSuffix}]` : ""}`,
        source_file: mount.file,
        source_digest: digest(source),
        mount_prefix: mount.mount_prefix,
        mount_order: mount.mount_order,
        split_from_mixed_scope_file: splitScope,
        split_from_surface_policy: splitPolicy,
        surface_policy_partition: policyPartition,
        group: groupFor(scopedOperations[0]?.path || mount.mount_prefix, mount.file),
        scope,
        operations: scopedOperations,
        openapi_gaps: scopedOperations.filter((operation) => !operation.openapi_documented && !operation.openapi_exempt).map((operation) => operation.signature),
        openapi_exemptions: scopedOperations.filter((operation) => operation.openapi_exempt).map((operation) => operation.signature),
        openapi_detail_gaps: scopedOperations.filter((operation) => operation.openapi_contract_level === "operation-index-only").map((operation) => operation.signature),
        auth_contract_gaps: scopedOperations.filter((operation) => !["equivalent", "exempt"].includes(operation.auth_parity.state)).map((operation) => ({ signature: operation.signature, state: operation.auth_parity.state, reasons: operation.auth_parity.reasons })),
        evidence_routes: scopedOperations.filter((operation) => operation.evidence_candidate).map((operation) => operation.signature),
        tests: familyTests,
        untested_operations: untestedOperations,
        resources: resourceEvidenceForFamily(mount.file, resourceManifest),
        embedded_ui: familyEmbeddedUi,
        embedded_ui_operations: scopedOperations.filter((operation) => operation.embedded_ui).map((operation) => operation.signature),
        source_refs: unique([
          mount.file,
          "routes/index.js",
          "openapi.yaml",
          ...scopedOperations.map((operation) => operation.openapi_auth?.source_file),
          "openapi-route-coverage.allowlist.json",
          ...openapiReferencePaths.map((file) => path.relative(apiRoot, file).replace(/\\/g, "/")),
          ...(familyEmbeddedUi ? frontendAssetPaths.map((file) => path.relative(apiRoot, file).replace(/\\/g, "/")) : []),
          "resource-api-coverage.manifest.json",
          "scripts/test-manifest.mjs",
          ...familyTests,
          DEFAULT_POLICY,
          DEFAULT_GENERATED_GOVERNANCE,
        ]),
      };
      family.surface_decision = policyDecision(family, policy);
      families.push(family);
      }
    }
  }

  const discoveredSignatures = new Set(families.flatMap((family) => family.operations.map((operation) => operation.signature)));
  for (const family of families) {
    for (const operation of family.operations) {
      operation.governance = mutationGovernance(operation, policy, discoveredSignatures);
      operation.mutation_candidate = operation.governance.mutation_candidate;
      operation.mutation = ["state_change", "external_effect"].includes(operation.governance.classification);
    }
    family.operation_blockers = family.operations
      .filter((operation) => operation.governance.blockers.length)
      .map((operation) => ({ signature: operation.signature, blockers: operation.governance.blockers }));
    family.risk = riskFor(family);
    family.wave = waveFor(family);
  }

  families.sort((a, b) => a.mount_order - b.mount_order || a.family_key.localeCompare(b.family_key));
  const tasks = families.map(taskFor).sort((a, b) => a.wave.localeCompare(b.wave) || b.state.localeCompare(a.state) || a.task_key.localeCompare(b.task_key));
  const sourceAuthority = unique([
    indexPath,
    ...mounted.map((mount) => path.resolve(apiRoot, mount.file)),
    generatorPath,
    openapiPath,
    runtimeOpenapiPath,
    openapiAllowlistPath,
    ...canonicalOpenApiPaths,
    ...openapiReferencePaths,
    openApiAuthority.projection_registry_path,
    ...frontendAssetPaths,
    resourcePath,
    testManifestPath,
    ...testEvidence.claimedFiles,
    policyPath,
    generatedGovernancePath,
    governanceGeneratorPath,
    path.resolve(apiRoot, "..", "specs", "010-unified-platform-frontend", "contracts", "frontend-dispatch-plan.schema.json"),
    path.resolve(apiRoot, "..", "specs", "010-unified-platform-frontend", "contracts", "frontend-operation-governance.schema.json"),
    path.resolve(apiRoot, "..", "specs", "010-unified-platform-frontend", "contracts", "ui-surface-catalog.schema.json"),
  ]).map((file) => ({
    file: path.relative(apiRoot, file).replace(/\\/g, "/"),
    sha256: digest(readText(file)),
    present: fs.existsSync(file),
  }));
  const operationCount = families.reduce((sum, family) => sum + family.operations.length, 0);
  const openapiGapCount = families.reduce((sum, family) => sum + family.openapi_gaps.length, 0);
  const openapiExemptionCount = families.reduce((sum, family) => sum + family.openapi_exemptions.length, 0);
  const openapiDetailGapCount = families.reduce((sum, family) => sum + family.openapi_detail_gaps.length, 0);
  const openapiCanonicalCount = families.reduce((sum, family) => sum + family.operations.filter((operation) => operation.openapi_canonical_documented).length, 0);
  const authParityCounts = Object.fromEntries([...new Set(families.flatMap((family) => family.operations.map((operation) => operation.auth_parity.state)))]
    .sort()
    .map((state) => [state, families.reduce((sum, family) => sum + family.operations.filter((operation) => operation.auth_parity.state === state).length, 0)]));
  const operationRules = Array.isArray(policy.operation_rules) ? policy.operation_rules : [];
  const unusedOperationRules = operationRules.filter((rule) => !families.some((family) => family.operations.some((operation) => rule.operation === operation.signature && (!rule.source_file || rule.source_file === operation.source_file))));
  const operationRuleKeys = operationRules.map((rule) => `${rule.operation || ""}|${rule.source_file || "*"}`);
  const duplicateOperationRuleKeys = unique(operationRuleKeys.filter((key, index) => operationRuleKeys.indexOf(key) !== index));
  const authRules = Array.isArray(policy.auth_rules) ? policy.auth_rules : [];
  const expandedAuthRules = authRules.flatMap((rule) => authRuleOperations(rule).map((operation) => ({ rule, operation })));
  const unusedAuthRules = expandedAuthRules.filter(({ rule, operation }) => !families.some((family) => family.operations.some((candidate) => (
    operation === candidate.signature && (!rule.source_file || rule.source_file === candidate.source_file)
  ))));
  const authRuleKeys = expandedAuthRules.map(({ rule, operation }) => `${operation}|${rule.source_file || "*"}`);
  const duplicateAuthRuleKeys = unique(authRuleKeys.filter((key, index) => authRuleKeys.indexOf(key) !== index));
  const policyIssues = [
    ...(!fs.existsSync(generatedGovernancePath) ? [{ code: "generated_operation_governance_missing" }] : []),
    ...(fs.existsSync(generatedGovernancePath) && !generatedGovernanceValid ? [{ code: "generated_operation_governance_invalid" }] : []),
    ...(generatedGovernanceValid ? generatedGovernance.rejected_candidates.map((candidate) => ({
      code: "generated_operation_governance_evidence_gap",
      recipe_id: candidate.recipe_id || null,
      operation: candidate.operation || null,
      missing_evidence: candidate.missing_evidence || [],
    })) : []),
    ...unusedOperationRules.map((rule) => ({ code: "unused_operation_rule", rule_id: rule.rule_id || null, operation: rule.operation || null })),
    ...duplicateOperationRuleKeys.map((key) => ({ code: "duplicate_operation_rule", key })),
    ...operationRules.filter((rule) => !OPERATION_CLASSIFICATIONS.has(rule.classification)).map((rule) => ({ code: "invalid_operation_classification", rule_id: rule.rule_id || null, operation: rule.operation || null })),
    ...unusedAuthRules.map(({ rule, operation }) => ({ code: "unused_auth_rule", rule_id: rule.rule_id || null, operation })),
    ...duplicateAuthRuleKeys.map((key) => ({ code: "duplicate_auth_rule", key })),
    ...authRules.filter((rule) => !Object.hasOwn(AUTH_PROFILES, rule.profile)).map((rule) => ({ code: "invalid_auth_profile", rule_id: rule.rule_id || null, profile: rule.profile || null })),
    ...authRules.filter((rule) => !rule.owner || !rule.rationale).map((rule) => ({ code: "auth_rule_attribution_gap", rule_id: rule.rule_id || null })),
    ...authRules.filter((rule) => !(rule.evidence_refs || []).length).map((rule) => ({ code: "auth_rule_evidence_gap", rule_id: rule.rule_id || null })),
  ];
  const untestedOperationCount = families.reduce((sum, family) => sum + family.operations.filter((operation) => !operation.tests.length).length, 0);
  const unresolvedDecisions = families.filter((family) => family.surface_decision.decision === "requires_review").length;
  const mutationCandidates = families.flatMap((family) => family.operations).filter((operation) => operation.mutation_candidate);
  const classifiedMutations = mutationCandidates.filter((operation) => operation.mutation);

  return {
    schema_version: "frontend-surface-dispatch-v1",
    baseline: {
      ref: baselineRef,
      source_digest: digest(sourceAuthority.map((entry) => `${entry.file}:${entry.sha256}`).join("\n")),
      authority: sourceAuthority,
    },
    policy: {
      key: policy.policy_key || "frontend_surface_policy_v1",
      default_decision: policy.default_decision || "requires_review",
      allowed_decisions: ["embedded_ui", "unified_ui", "api_only", "internal_only", "legacy_compatibility", "deferred", "requires_review"],
      issues: policyIssues,
    },
    coverage: {
      mounted_family_count: families.length,
      mounted_route_file_count: mounted.length,
      mixed_scope_route_file_count: new Set(families.filter((family) => family.split_from_mixed_scope_file).map((family) => family.source_file)).size,
      operation_count: operationCount,
      openapi_documented_count: operationCount - openapiGapCount - openapiExemptionCount,
      openapi_canonical_documented_count: openapiCanonicalCount,
      openapi_generated_index_count: openapiDetailGapCount,
      openapi_exemption_count: openapiExemptionCount,
      openapi_gap_count: openapiGapCount,
      openapi_detail_gap_count: openapiDetailGapCount,
      auth_parity_counts: authParityCounts,
      auth_contract_gap_count: Object.entries(authParityCounts).filter(([state]) => !["equivalent", "exempt"].includes(state)).reduce((sum, [, count]) => sum + count, 0),
      operation_policy_issue_count: policyIssues.length,
      non_get_candidate_count: mutationCandidates.length,
      unresolved_operation_class_count: mutationCandidates.filter((operation) => operation.governance.classification === "unresolved").length,
      classified_mutation_count: classifiedMutations.length,
      governed_mutation_operation_count: classifiedMutations.filter((operation) => operation.governance.governed).length,
      embedded_ui_family_count: families.filter((family) => family.embedded_ui).length,
      unresolved_surface_decision_count: unresolvedDecisions,
      test_owned_family_count: families.filter((family) => !family.untested_operations.length).length,
      untested_family_count: families.filter((family) => family.untested_operations.length).length,
      test_owned_operation_count: operationCount - untestedOperationCount,
      untested_operation_count: untestedOperationCount,
      ready_task_count: tasks.filter((task) => task.state === "ready").length,
      blocked_task_count: tasks.filter((task) => task.state === "blocked").length,
      coverage_complete: openapiGapCount === 0 && openapiDetailGapCount === 0 && policyIssues.length === 0 && unresolvedDecisions === 0 && tasks.every((task) => task.state === "ready"),
    },
    waves: [
      { key: "F0-authority-resolution", requires: ["source baseline", "scope decision", "policy decision"] },
      { key: "F1-tenant-shell", requires: ["tenant JWT", "workspace context", "read models"] },
      { key: "F2-admin-bff-session", requires: ["HttpOnly session", "CSRF", "origin binding", "audit"] },
      { key: "F3-admin-workspaces", requires: ["F2", "explicit adapters", "approval and readback"] },
      { key: "F4-local-manager", requires: ["device trust", "local consent", "reachability freshness"] },
      { key: "F5-developer-evidence", requires: ["explicit grant", "redaction", "evidence links"] },
      { key: "F6-cutover", requires: ["legacy parity", "accessibility", "production evidence"] },
    ],
    families,
    tasks,
    safety: {
      executes_provider_calls: false,
      writes_database: false,
      deploys: false,
      secrets_included: false,
      browser_backend_api_key_allowed: false,
    },
  };
}

export function syncDispatchPlan({ apiRoot = process.cwd(), mode = "write", output = DEFAULT_OUTPUT, baselineRef } = {}) {
  const target = path.resolve(apiRoot, output);
  const openapiIndexTarget = path.resolve(apiRoot, DEFAULT_OPENAPI_INDEX);
  const persistedBaselineRef = mode === "check" ? readJson(target, {})?.baseline?.ref : null;
  let plan = buildDispatchPlan({ apiRoot, baselineRef: baselineRef || persistedBaselineRef });
  const expectedOpenApiIndex = runtimeOpenApiContent(plan);
  const openapiIndexDrift = readText(openapiIndexTarget) !== expectedOpenApiIndex;
  if (mode === "write") {
    fs.mkdirSync(path.dirname(openapiIndexTarget), { recursive: true });
    fs.writeFileSync(openapiIndexTarget, expectedOpenApiIndex);
    plan = buildDispatchPlan({ apiRoot, baselineRef: baselineRef || persistedBaselineRef });
  }
  const content = `${JSON.stringify(plan, null, 2)}\n`;
  const current = readText(target);
  const drift = current !== content;
  if (mode === "write") fs.writeFileSync(target, content);
  return {
    ok: mode === "write" || (!drift && !openapiIndexDrift),
    mode,
    output: path.relative(apiRoot, target).replace(/\\/g, "/"),
    openapi_index: path.relative(apiRoot, openapiIndexTarget).replace(/\\/g, "/"),
    drift,
    openapi_index_drift: openapiIndexDrift,
    plan,
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const mode = argv.includes("--check") ? "check" : argv.includes("--write") ? "write" : "json";
  return {
    mode,
    output: argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || DEFAULT_OUTPUT,
    baselineRef: argv.find((arg) => arg.startsWith("--baseline-ref="))?.slice("--baseline-ref=".length),
  };
}

export function isDirectExecution(importMetaUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && importMetaUrl === pathToFileURL(path.resolve(argvPath)).href;
}

if (isDirectExecution(import.meta.url)) {
  const args = parseArgs();
  const result = args.mode === "json"
    ? { ok: true, mode: "json", plan: buildDispatchPlan({ baselineRef: args.baselineRef }) }
    : syncDispatchPlan({ mode: args.mode, output: args.output, baselineRef: args.baselineRef });
  const printable = args.mode === "json" ? result : {
    ok: result.ok,
    mode: result.mode,
    output: result.output,
    openapi_index: result.openapi_index,
    drift: result.drift,
    openapi_index_drift: result.openapi_index_drift,
    coverage: result.plan.coverage,
  };
  process.stdout.write(`${JSON.stringify(printable, null, 2)}\n`);
  if (!result.ok) process.exit(1);
}
