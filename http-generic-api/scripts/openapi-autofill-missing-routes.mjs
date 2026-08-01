import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const ROOT = process.cwd();
const ROUTES_DIR = path.join(ROOT, "routes");
const OPENAPI_PATH = path.join(ROOT, "openapi.yaml");
const ALLOWLIST_PATH = path.join(ROOT, "openapi-route-coverage.allowlist.json");
const CONTRACT_REGISTRY_PATH = path.join(ROOT, "openapi-route-contracts.yaml");
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const ROUTE_FILE_RE = /(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*([`'"])(.*?)\2/gs;
const APP_USE_RE = /app\.use\s*\(\s*([`'"])(.*?)\1\s*,/gs;
const ROUTER_USE_RE = /router\.use\s*\(\s*([`'"])(.*?)\1\s*,\s*([A-Za-z0-9_$]+)/gs;

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadYaml(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return YAML.parse(fs.readFileSync(filePath, "utf8")) || fallback;
}

function normalizeExpressPath(routePath) {
  let normalized = String(routePath || "").trim();
  if (!normalized || normalized === "/") return "/";
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  return normalized
    .replace(/:([A-Za-z0-9_]+)/g, "{$1}")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "") || "/";
}

function joinPaths(base, routePath) {
  const normalizedBase = normalizeExpressPath(base || "/");
  const normalizedRoute = normalizeExpressPath(routePath || "/");
  if (normalizedBase === "/") return normalizedRoute;
  if (normalizedRoute === "/") return normalizedBase;
  return `${normalizedBase}${normalizedRoute}`.replace(/\/+/g, "/");
}

function routeFilePaths() {
  if (!fs.existsSync(ROUTES_DIR)) return [];
  return fs.readdirSync(ROUTES_DIR)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(ROUTES_DIR, name))
    .sort();
}

function collectMountPrefixes(indexSource) {
  const prefixes = new Set([""]);
  let match;
  while ((match = APP_USE_RE.exec(indexSource)) !== null) {
    prefixes.add(normalizeExpressPath(match[2]));
  }
  return prefixes;
}

function collectRoutesFromSource(filePath, source, indexPrefixes) {
  const relativePath = path.relative(ROOT, filePath).replace(/\\/g, "/");
  const localPrefixes = new Set([""]);
  let match;
  while ((match = ROUTER_USE_RE.exec(source)) !== null) {
    const handlerName = String(match[3] || "");
    if (/(Router|Routes)$/i.test(handlerName)) {
      localPrefixes.add(normalizeExpressPath(match[2]));
    }
  }

  const routes = [];
  while ((match = ROUTE_FILE_RE.exec(source)) !== null) {
    const method = match[1].toUpperCase();
    const routePath = normalizeExpressPath(match[3]);
    const prefixes = relativePath === "routes/index.js" ? indexPrefixes : localPrefixes;
    for (const prefix of prefixes) {
      routes.push({ method, path: joinPaths(prefix, routePath), file: relativePath });
    }
  }
  return routes;
}

function collectRoutes(requiredFiles = null) {
  const indexPath = path.join(ROUTES_DIR, "index.js");
  const indexSource = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
  const indexPrefixes = collectMountPrefixes(indexSource);
  const required = Array.isArray(requiredFiles) && requiredFiles.length > 0
    ? new Set(requiredFiles.map((entry) => entry.replace(/\\/g, "/")))
    : null;

  return routeFilePaths()
    .filter((filePath) => {
      if (!required) return true;
      const relativePath = path.relative(ROOT, filePath).replace(/\\/g, "/");
      return required.has(relativePath);
    })
    .flatMap((filePath) => collectRoutesFromSource(
      filePath,
      fs.readFileSync(filePath, "utf8"),
      indexPrefixes,
    ));
}

function allowlistMatchers(allowlist) {
  const exact = new Set(allowlist.exact || []);
  const prefixes = allowlist.prefixes || [];
  const files = allowlist.files || [];
  return function isAllowed(route) {
    const signature = `${route.method} ${route.path}`;
    if (exact.has(signature)) return true;
    if (prefixes.some((prefix) => route.path === prefix || route.path.startsWith(`${prefix}/`))) {
      return true;
    }
    return files.includes(route.file);
  };
}

function normalizeContractRegistry(input) {
  const entries = input?.contracts && typeof input.contracts === "object" ? input.contracts : {};
  const registry = new Map();
  for (const [rawSignature, rawContract] of Object.entries(entries)) {
    const signature = String(rawSignature || "").trim();
    const match = signature.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/);
    if (!match) throw new Error(`Invalid OpenAPI route contract signature: ${signature}`);

    const method = match[1];
    const routePath = normalizeExpressPath(match[2]);
    const pathItemRef = String(rawContract?.path_item_ref || "").trim();
    if (!pathItemRef.startsWith("./openapi/") || !pathItemRef.includes("#/")) {
      throw new Error(
        `OpenAPI route contract ${method} ${routePath} requires a local ./openapi/...#/ path_item_ref.`,
      );
    }

    const routeFile = String(rawContract?.route_file || "").trim().replace(/\\/g, "/");
    if (!routeFile.startsWith("routes/") || !routeFile.endsWith(".js")) {
      throw new Error(
        `OpenAPI route contract ${method} ${routePath} requires a source-bound routes/*.js route_file.`,
      );
    }

    registry.set(`${method} ${routePath}`, {
      ...rawContract,
      path_item_ref: pathItemRef,
      route_file: routeFile,
    });
  }
  return registry;
}

function collectOpenApiCoverage(document) {
  const operations = new Set();
  const referencedPaths = new Set();
  for (const [pathKey, pathItem] of Object.entries(document.paths || {})) {
    if (typeof pathItem?.$ref === "string") referencedPaths.add(pathKey);
    for (const method of Object.keys(pathItem || {})) {
      if (HTTP_METHODS.has(method)) operations.add(`${method.toUpperCase()} ${pathKey}`);
    }
  }
  return { operations, referencedPaths };
}

function findMissing(document, allowlist, contracts) {
  const { operations, referencedPaths } = collectOpenApiCoverage(document);
  const requiredFiles = new Set(allowlist.required_files || []);
  for (const contract of contracts.values()) requiredFiles.add(contract.route_file);

  const routes = collectRoutes([...requiredFiles]);
  const isAllowed = allowlistMatchers(allowlist);
  const missing = [];
  const seen = new Set();

  for (const route of routes) {
    const signature = `${route.method} ${route.path}`;
    const sourceIdentity = `${signature} ${route.file}`;
    if (seen.has(sourceIdentity)) continue;
    seen.add(sourceIdentity);
    if (operations.has(signature) || referencedPaths.has(route.path) || isAllowed(route)) continue;
    missing.push({
      ...route,
      signature,
      precise_contract_registered: contracts.has(signature),
    });
  }
  return missing;
}

function buildReport({ write, check, contracts, missing }) {
  const uncontracted = missing.filter((entry) => !entry.precise_contract_registered);
  const blocked = missing.length > 0;
  return {
    ok: !blocked,
    changed: false,
    blocked,
    reason: blocked ? "missing_precise_contracts" : null,
    mode: write ? "write" : check ? "check" : "report",
    repository_mutation_performed: false,
    missing_count: missing.length,
    uncontracted_missing_count: uncontracted.length,
    precise_contract_count: contracts.size,
    missing,
  };
}

function main() {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  const document = YAML.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
  const allowlist = loadJson(ALLOWLIST_PATH, {
    exact: [],
    prefixes: [],
    files: [],
    required_files: [],
  });
  const contracts = normalizeContractRegistry(
    loadYaml(CONTRACT_REGISTRY_PATH, { contracts: {} }),
  );
  const missing = findMissing(document, allowlist, contracts);
  const report = buildReport({ write, check, contracts, missing });

  console.log(JSON.stringify(report, null, 2));

  if (missing.length > 0 && (write || check)) {
    process.exitCode = 1;
  }
}

main();
