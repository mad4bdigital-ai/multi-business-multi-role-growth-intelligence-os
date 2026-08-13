import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getRemoteMcpCatalogFingerprint } from "../http-generic-api/remoteMcpScopeCatalog.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputJson = process.env.REMOTE_MCP_WRITE_SCOPE_INVENTORY_JSON
  || "http-generic-api/remote-mcp-write-scope-inventory.generated.json";
const outputMarkdown = process.env.REMOTE_MCP_WRITE_SCOPE_INVENTORY_MARKDOWN
  || "docs/remote-mcp-write-scope-inventory.md";
const checkOnly = process.argv.includes("--check");

function read(path) {
  try { return readFileSync(join(root, path), "utf8"); } catch { return ""; }
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0").filter(Boolean);
}

function safeJson(path) {
  try { return JSON.parse(read(path)); } catch { return null; }
}

function routeInventory(files) {
  const routes = [];
  for (const path of files.filter((candidate) => candidate.startsWith("http-generic-api/routes/") && candidate.endsWith(".js"))) {
    const source = read(path);
    const pattern = /router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
    for (const match of source.matchAll(pattern)) {
      routes.push({ method: match[1].toUpperCase(), path: match[2], file: path, write: ["POST", "PUT", "PATCH", "DELETE"].includes(match[1].toUpperCase()) });
    }
  }
  return routes;
}

function migrationInventory(files) {
  const migrations = [];
  for (const path of files.filter((candidate) => candidate.startsWith("http-generic-api/migrations/") && candidate.endsWith(".sql"))) {
    const source = read(path);
    const tables = [...new Set([...source.matchAll(/(?:CREATE TABLE IF NOT EXISTS|INSERT INTO|UPDATE|FROM|JOIN)\s+`?([a-zA-Z0-9_]+)`?/gi)].map((match) => match[1]))];
    const writeScopes = [...new Set([...source.matchAll(/'([a-z][a-z0-9]+\.(?:create|update|archive|restore|write|deploy|request|decide|manage))'/gi)].map((match) => match[1]))];
    const catalogFingerprints = [...new Set([...source.matchAll(/'([a-f0-9]{64})',\s*\n\s*CURRENT_TIMESTAMP/gi)].map((match) => match[1]))];
    if (writeScopes.length || catalogFingerprints.length || tables.some((table) => table.includes("resource") || table.includes("scope") || table.includes("tool"))) {
      migrations.push({ path, tables: tables.slice(0, 80), write_scopes: writeScopes, catalog_fingerprints: catalogFingerprints });
    }
  }
  return migrations;
}

const WRITE_SURFACE_RULES = [
  { scope_key: "assets.create", pattern: /asset/i, methods: new Set(["POST"]) },
  { scope_key: "assets.update", pattern: /asset/i, methods: new Set(["PUT", "PATCH", "DELETE"]) },
  { scope_key: "approvals.request", pattern: /approval|grant-request/i, methods: new Set(["POST", "PUT", "PATCH"]) },
  { scope_key: "github.write", pattern: /github/i, methods: new Set(["POST", "PUT", "PATCH", "DELETE"]) },
  { scope_key: "cloudflare.write", pattern: /cloudflare|(?:^|\/)dns(?:\/|$)/i, methods: new Set(["POST", "PUT", "PATCH", "DELETE"]) },
  { scope_key: "hostinger.deploy", pattern: /hostinger|deploy/i, methods: new Set(["POST", "PUT", "PATCH", "DELETE"]) },
];

function classifyWriteSurfaces(routes, catalog) {
  const catalogRules = Array.isArray(catalog?.shadow_route_bindings)
    ? catalog.shadow_route_bindings.map((rule) => {
      try {
        return {
          scope_key: rule.scope_key,
          pattern: new RegExp(String(rule.path_pattern || ""), "i"),
          methods: new Set(rule.methods || []),
        };
      } catch {
        return null;
      }
    }).filter(Boolean)
    : WRITE_SURFACE_RULES;
  return routes.flatMap((route) => catalogRules
    .filter((rule) => rule.methods.has(route.method) && rule.pattern.test(`${route.path} ${route.file}`))
    .map((rule) => ({
      scope_key: rule.scope_key,
      method: route.method,
      path: route.path,
      file: route.file,
      status: "shadow",
      provider_mutation_allowed: false,
      readback_required: true,
    })));
}

function dbRegistryInventory(files) {
  const registryNames = [
    "platform_resource_type_registry",
    "platform_resource_operation_registry",
    "platform_resource_surface_policy_registry",
    "platform_resource_authority_bindings",
    "platform_tool_dispatch_bindings",
    "platform_tool_scope_bindings",
    "platform_resource_scope_bindings",
    "platform_oauth_scope_registry",
    "platform_scope_catalog_revisions",
  ];
  const evidence = [];
  for (const path of files.filter((candidate) => candidate.endsWith(".sql") || candidate.endsWith(".js") || candidate.endsWith(".mjs"))) {
    const source = read(path);
    const found = registryNames.filter((name) => source.includes(name));
    if (found.length) evidence.push({ path, registries: found });
  }
  return evidence;
}

const files = trackedFiles();
const catalog = safeJson("http-generic-api/remote-mcp-scope-catalog.generated.json") || {};
const writeScopes = (catalog.scopes || []).filter((scope) => scope.effect_class !== "read_only");
const toolBindings = catalog.tool_bindings || [];
const resourceBindings = catalog.resource_operation_bindings || [];
const routes = routeInventory(files);
const migrations = migrationInventory(files);
const registries = dbRegistryInventory(files);
const routeWrites = routes.filter((route) => route.write);
const writeSurfaceCandidates = classifyWriteSurfaces(routeWrites, catalog);
const writeSurfaceScopeKeys = new Set(writeSurfaceCandidates.map((candidate) => candidate.scope_key));
const writeScopeKeys = new Set(writeScopes.map((scope) => scope.scope_key));
const migrationScopeKeys = new Set(migrations.flatMap((migration) => migration.write_scopes));
const dbCatalogFingerprints = new Set(migrations.flatMap((migration) => migration.catalog_fingerprints || []));
const catalogFingerprint = getRemoteMcpCatalogFingerprint(catalog);
const boundWriteScopes = new Set([
  ...toolBindings.flatMap((binding) => (writeScopeKeys.has(binding.scope_key) ? [binding.scope_key] : [])),
  ...resourceBindings.flatMap((binding) => (writeScopeKeys.has(binding.scope_key) ? [binding.scope_key] : [])),
]);

const findings = [];
for (const scope of writeScopes) {
  if (scope.default_request === true) findings.push({ severity: "critical", code: "WRITE_SCOPE_DEFAULT_REQUEST", scope_key: scope.scope_key });
  if (scope.status !== "shadow") findings.push({ severity: "high", code: "WRITE_SCOPE_NOT_SHADOW", scope_key: scope.scope_key, status: scope.status });
  if (!boundWriteScopes.has(scope.scope_key)) findings.push({ severity: "high", code: "WRITE_SCOPE_UNBOUND", scope_key: scope.scope_key });
  if (!migrationScopeKeys.has(scope.scope_key)) findings.push({ severity: "medium", code: "WRITE_SCOPE_MIGRATION_EVIDENCE_MISSING", scope_key: scope.scope_key });
}
if (!registries.some((entry) => entry.registries.includes("platform_resource_authority_bindings"))) {
  findings.push({ severity: "high", code: "RESOURCE_AUTHORITY_REGISTRY_MISSING" });
}
if (!routeWrites.length) findings.push({ severity: "medium", code: "NO_WRITE_ROUTES_DISCOVERED" });
if (!dbCatalogFingerprints.has(catalogFingerprint)) findings.push({ severity: "high", code: dbCatalogFingerprints.size ? "DB_CATALOG_FINGERPRINT_MISMATCH" : "DB_CATALOG_FINGERPRINT_MISSING", catalog_fingerprint: catalogFingerprint });
for (const scope of writeScopes) {
  if (!writeSurfaceScopeKeys.has(scope.scope_key)) findings.push({ severity: "medium", code: "WRITE_SCOPE_NO_ROUTE_CANDIDATE", scope_key: scope.scope_key });
}

const inventory = {
  schema_version: 1,
  generated_from: "git-index-and-runtime-catalog",
  source_revision: read("http-generic-api/remote-mcp-scope-catalog.generated.json")
    ? catalog.source_revision || null : null,
  catalog_revision: catalog.revision || null,
  catalog_fingerprint: catalogFingerprint,
  db_catalog_fingerprints: [...dbCatalogFingerprints],
  db_catalog_fingerprint_match: dbCatalogFingerprints.has(catalogFingerprint),
  file_count: files.length,
  route_count: routes.length,
  write_route_count: routeWrites.length,
  classified_write_surface_count: writeSurfaceCandidates.length,
  unclassified_write_route_count: routeWrites.length - new Set(writeSurfaceCandidates.map((candidate) => `${candidate.method}:${candidate.path}:${candidate.file}`)).size,
  migration_count: migrations.length,
  registry_evidence_count: registries.length,
  write_scope_count: writeScopes.length,
  bound_write_scope_count: boundWriteScopes.size,
  write_scopes: writeScopes.map((scope) => ({
    scope_key: scope.scope_key,
    effect_class: scope.effect_class,
    risk_class: scope.risk_class,
    status: scope.status,
    default_request: Boolean(scope.default_request),
    incremental_request: Boolean(scope.incremental_request),
    tool_bound: boundWriteScopes.has(scope.scope_key),
    migration_evidence: migrationScopeKeys.has(scope.scope_key),
  })),
  route_inventory: routes,
  write_surface_candidates: writeSurfaceCandidates,
  migration_inventory: migrations,
  registry_evidence: registries,
  findings,
  readiness: {
    inventory_ready: findings.length === 0,
    write_activation_allowed: false,
    provider_mutation_allowed: false,
    production_allowed: false,
    migration_apply_allowed: false,
    secrets_included: false,
  },
};

const findingLines = findings.length
  ? findings.map((finding) => "- **" + finding.severity + "** `" + finding.code + "`" + (finding.scope_key ? " — `" + finding.scope_key + "`" : "")).join("\n")
  : "No findings.";

const markdown = `<!-- GENERATED FILE. Run npm run write-scopes:inventory. -->
# Remote MCP Write-Scope Smart Inventory

This artifact is generated from the Git index, the Remote MCP scope catalog, application route declarations, migration SQL, and database registry references. It is a **read-only governance inventory**; it does not apply migrations or execute provider mutations.

| Metric | Value |
|---|---:|
| Tracked files scanned | ${inventory.file_count} |
| Routes discovered | ${inventory.route_count} |
| Write routes discovered | ${inventory.write_route_count} |
| Classified write-surface candidates | ${inventory.classified_write_surface_count} |
| Migrations with governance evidence | ${inventory.migration_count} |
| DB catalog fingerprint match | ${inventory.db_catalog_fingerprint_match} |
| Registry evidence entries | ${inventory.registry_evidence_count} |
| Write scopes | ${inventory.write_scope_count} |
| Bound write scopes | ${inventory.bound_write_scope_count} |
| Inventory ready | ${inventory.readiness.inventory_ready} |
| Write activation allowed | ${inventory.readiness.write_activation_allowed} |

## Findings

${findingLines}

## Safety boundary

The inventory explicitly keeps provider mutation, migration application, and Production activation disabled. A write scope is not eligible merely because it exists in the catalog; it requires an explicit resource-operation binding, tool binding, approval policy, capability envelope, lease, staging environment, and same-cycle readback.
`;

const jsonText = `${JSON.stringify(inventory, null, 2)}\n`;
const markdownText = markdown.endsWith("\n") ? markdown : markdown + "\n";
const outputs = [[outputJson, jsonText], [outputMarkdown, markdownText]];
const mismatches = outputs.filter(([path, expected]) => {
  try { return read(path) !== expected; } catch { return true; }
});
if (checkOnly) {
  if (mismatches.length) {
    console.error(`Write-scope inventory artifacts are stale: ${mismatches.map(([path]) => path).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true, checked: outputs.map(([path]) => path), findings: findings.length }, null, 2));
  }
} else {
  for (const [path, text] of outputs) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  console.log(JSON.stringify({ ok: true, findings: findings.length, write_scopes: writeScopes.length, outputJson, outputMarkdown }, null, 2));
}
