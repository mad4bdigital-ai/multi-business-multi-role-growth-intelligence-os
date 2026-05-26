import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const ROOT = process.cwd();
const ROUTES_DIR = path.join(ROOT, "routes");
const OPENAPI_PATH = path.join(ROOT, "openapi.yaml");
const ALLOWLIST_PATH = path.join(ROOT, "openapi-route-coverage.allowlist.json");
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const ROUTE_FILE_RE = /(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*([`'\"])(.*?)\2/gs;
const APP_USE_RE = /app\.use\s*\(\s*([`'\"])(.*?)\1\s*,/gs;
const ROUTER_USE_RE = /router\.use\s*\(\s*([`'\"])(.*?)\1\s*,/gs;

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeExpressPath(routePath) {
  let p = String(routePath || "").trim();
  if (!p || p === "/") return "/";
  if (!p.startsWith("/")) p = `/${p}`;
  return p.replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function joinPaths(base, routePath) {
  const b = normalizeExpressPath(base || "/");
  const r = normalizeExpressPath(routePath || "/");
  if (b === "/") return r;
  if (r === "/") return b;
  return `${b}${r}`.replace(/\/+/g, "/");
}

function routeFilePaths() {
  return fs.readdirSync(ROUTES_DIR)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(ROUTES_DIR, name))
    .sort();
}

function collectOpenApiOperations() {
  const doc = yaml.load(fs.readFileSync(OPENAPI_PATH, "utf8"));
  const ops = new Set();
  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    for (const method of Object.keys(pathItem || {})) {
      if (HTTP_METHODS.has(method)) ops.add(`${method.toUpperCase()} ${pathKey}`);
    }
  }
  return ops;
}

function collectMountPrefixes(indexSource) {
  const prefixes = new Set([""]);
  let match;
  while ((match = APP_USE_RE.exec(indexSource)) !== null) prefixes.add(normalizeExpressPath(match[2]));
  return prefixes;
}

function collectRoutesFromSource(filePath, source, indexPrefixes) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, "/");
  const localPrefixes = new Set([""]);
  let match;
  while ((match = ROUTER_USE_RE.exec(source)) !== null) localPrefixes.add(normalizeExpressPath(match[2]));

  const routes = [];
  while ((match = ROUTE_FILE_RE.exec(source)) !== null) {
    const method = match[1].toUpperCase();
    const routePath = normalizeExpressPath(match[3]);
    const prefixes = rel === "routes/index.js" ? indexPrefixes : localPrefixes;
    for (const prefix of prefixes) {
      routes.push({ method, path: joinPaths(prefix, routePath), file: rel });
    }
  }
  return routes;
}

function collectRoutes() {
  const indexPath = path.join(ROUTES_DIR, "index.js");
  const indexSource = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
  const indexPrefixes = collectMountPrefixes(indexSource);
  return routeFilePaths().flatMap((filePath) =>
    collectRoutesFromSource(filePath, fs.readFileSync(filePath, "utf8"), indexPrefixes)
  );
}

function allowlistMatchers(allowlist) {
  const exact = new Set(allowlist.exact || []);
  const prefixes = allowlist.prefixes || [];
  const files = allowlist.files || [];
  return function isAllowed(route) {
    const sig = `${route.method} ${route.path}`;
    if (exact.has(sig)) return true;
    if (prefixes.some((p) => route.path === p || route.path.startsWith(`${p}/`))) return true;
    if (files.includes(route.file)) return true;
    return false;
  };
}

function main() {
  const openapiOps = collectOpenApiOperations();
  const routes = collectRoutes();
  const allowlist = loadJson(ALLOWLIST_PATH, { exact: [], prefixes: [], files: [] });
  const isAllowed = allowlistMatchers(allowlist);
  const missing = [];
  const seen = new Set();

  for (const route of routes) {
    const sig = `${route.method} ${route.path}`;
    if (seen.has(`${sig} ${route.file}`)) continue;
    seen.add(`${sig} ${route.file}`);
    if (openapiOps.has(sig) || isAllowed(route)) continue;
    missing.push({ ...route, signature: sig });
  }

  if (missing.length > 0) {
    console.error(JSON.stringify({
      ok: false,
      error: "openapi_route_coverage_failed",
      message: "Express routes must be documented in openapi.yaml or explicitly allowlisted.",
      missing_count: missing.length,
      missing: missing.slice(0, 200),
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    route_count: routes.length,
    openapi_operation_count: openapiOps.size,
    allowlist_counts: {
      exact: (allowlist.exact || []).length,
      prefixes: (allowlist.prefixes || []).length,
      files: (allowlist.files || []).length,
    },
  }));
}

main();
