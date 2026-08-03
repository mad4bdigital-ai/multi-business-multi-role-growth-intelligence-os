import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { buildDispatchPlan, canonicalOpenApiAuthority } from "./frontend-surface-dispatch.mjs";

const ROOT = process.cwd();
const ROUTES_DIR = path.join(ROOT, "routes");
const OPENAPI_PATH = path.join(ROOT, "openapi.yaml");
const OPENAPI_DIR = path.join(ROOT, "openapi");
const ALLOWLIST_PATH = path.join(ROOT, "openapi-route-coverage.allowlist.json");
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const ROUTE_FILE_RE = /(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*([`'\"])(.*?)\2/gs;
const APP_USE_RE = /app\.use\s*\(\s*([`'\"])(.*?)\1\s*,/gs;
const ROUTER_USE_RE = /router\.use\s*\(\s*([`'\"])(.*?)\1\s*,\s*([A-Za-z0-9_$]+)/gs;

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

function collectOpenApiOperationsFromText(source) {
  const ops = new Set();
  const pathMethodSameLineRe = /(?:^|\n)\s*(\/[A-Za-z0-9_{}./:-]+):\s*(get|post|put|patch|delete):/g;
  const pathBlockRe = /(?:^|\n)\s*(\/[A-Za-z0-9_{}./:-]+):\s*\n([\s\S]*?)(?=\n\s*\/[A-Za-z0-9_{}./:-]+:\s*(?:\n|$)|\ncomponents:|\n\S|$)/g;
  let match;
  while ((match = pathMethodSameLineRe.exec(source)) !== null) {
    ops.add(`${match[2].toUpperCase()} ${match[1]}`);
  }
  while ((match = pathBlockRe.exec(source)) !== null) {
    const pathKey = match[1];
    const block = match[2] || "";
    for (const method of HTTP_METHODS) {
      if (new RegExp(`(?:^|\\n)\\s+${method}:`).test(block)) ops.add(`${method.toUpperCase()} ${pathKey}`);
    }
  }
  return ops;
}

function collectOpenApiOperations() {
  const files = canonicalOpenApiAuthority(ROOT);
  const ops = new Set();
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    try {
      const doc = YAML.parse(source);
      if (!doc?.openapi || !doc?.paths) continue;
      for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
        for (const method of Object.keys(pathItem || {})) {
          if (HTTP_METHODS.has(method)) ops.add(`${method.toUpperCase()} ${pathKey}`);
        }
      }
    } catch (error) {
      const fallback = collectOpenApiOperationsFromText(source);
      if (fallback.size === 0) throw error;
      for (const signature of fallback) ops.add(signature);
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
  while ((match = ROUTER_USE_RE.exec(source)) !== null) {
    const handlerName = String(match[3] || "");
    if (/(Router|Routes)$/i.test(handlerName)) localPrefixes.add(normalizeExpressPath(match[2]));
  }

  const routes = [];
  while ((match = ROUTE_FILE_RE.exec(source)) !== null) {
    const method = match[1].toUpperCase();
    const routePath = normalizeExpressPath(match[3]);
    const prefixes = rel === "routes/index.js" ? indexPrefixes : localPrefixes;
    for (const prefix of prefixes) routes.push({ method, path: joinPaths(prefix, routePath), file: rel });
  }
  return routes;
}

function collectRoutes(requiredFiles = null) {
  const indexPath = path.join(ROUTES_DIR, "index.js");
  const indexSource = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
  const indexPrefixes = collectMountPrefixes(indexSource);
  const required = Array.isArray(requiredFiles) && requiredFiles.length > 0
    ? new Set(requiredFiles.map((p) => p.replace(/\\/g, "/")))
    : null;
  return routeFilePaths()
    .filter((filePath) => {
      if (!required) return true;
      const rel = path.relative(ROOT, filePath).replace(/\\/g, "/");
      return required.has(rel);
    })
    .flatMap((filePath) => collectRoutesFromSource(filePath, fs.readFileSync(filePath, "utf8"), indexPrefixes));
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
  const dispatchCoverage = buildDispatchPlan({ apiRoot: ROOT }).coverage;
  const allowlist = loadJson(ALLOWLIST_PATH, { exact: [], prefixes: [], files: [], required_files: [] });
  const routes = collectRoutes(allowlist.required_files);
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
      missing: missing.slice(0, 100),
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    route_count: routes.length,
    openapi_operation_count: openapiOps.size,
    coverage_scope: allowlist.required_files || [],
    full_repository: {
      operation_count: dispatchCoverage.operation_count,
      canonical_documented_count: dispatchCoverage.openapi_canonical_documented_count,
      generated_index_count: dispatchCoverage.openapi_generated_index_count,
      explicit_exemption_count: dispatchCoverage.openapi_exemption_count,
      operation_gap_count: dispatchCoverage.openapi_gap_count,
      detail_contract_gap_count: dispatchCoverage.openapi_detail_gap_count,
      auth_contract_gap_count: dispatchCoverage.auth_contract_gap_count,
    },
    allowlist_counts: {
      exact: (allowlist.exact || []).length,
      prefixes: (allowlist.prefixes || []).length,
      files: (allowlist.files || []).length,
    },
  }));
}

main();
