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
    let occurrence = 0;
    for (const match of source.matchAll(pattern)) {
      const method = match[1].toUpperCase();
      const routePath = match[2];
      routes.push({
        route_id: `${path}#${method}:${routePath}:${occurrence}`,
        source_line: source.slice(0, match.index).split("\n").length,
        source_offset: match.index,
        method,
        path: routePath,
        file: path,
        write: ["POST", "PUT", "PATCH", "DELETE"].includes(method),
      });
      occurrence += 1;
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
      route_id: route.route_id,
      method: route.method,
      path: route.path,
      file: route.file,
      status: "shadow",
      provider_mutation_allowed: false,
      readback_required: true,
    })));
}

function unmappedRouteReason(route) {
  const value = `${route.path} ${route.file}`.toLowerCase();
  if (/connector|shell|browser|fetch-upload|gcloud|n8n|\bps\b|\bwin\b|file/i.test(value)) return { reason: "connector_or_local_execution_requires_device_capability", risk: "critical" };
  if (/credential|secret|token|oauth|auth/i.test(value)) return { reason: "credential_or_identity_mutation_requires_security_contract", risk: "critical" };
  if (/release|deploy|migration|bootstrap|control-plane|platform/i.test(value)) return { reason: "platform_control_plane_requires_explicit_capability_and_change_control", risk: "critical" };
  if (/agent|skill|workflow|planner|execution|job|session/i.test(value)) return { reason: "agent_or_execution_state_requires_authority_binding", risk: "high" };
  if (/support|ticket|approval|hold/i.test(value)) return { reason: "support_or_human_review_requires_approval_binding", risk: "high" };
  if (/tenant|workspace|brand|customer|commercial/i.test(value)) return { reason: "tenant_domain_write_requires_resource_authority_binding", risk: "high" };
  if (/registry|schema|catalog|route|policy/i.test(value)) return { reason: "registry_mutation_requires_live_schema_and_policy_contract", risk: "high" };
  if (/webhook|callback|trigger/i.test(value)) return { reason: "event_ingress_requires_signature_and_replay_contract", risk: "high" };
  return { reason: "unclassified_surface_requires_manual_owner_mapping", risk: "medium" };
}

function routeDomain(route) {
  const value = `${route.path} ${route.file}`.toLowerCase();
  const domains = [
    ["github", /github|repository|repo-conflict/],
    ["cloudflare", /cloudflare|(?:^|\/)dns(?:\/|$)|\bcf\b/],
    ["hostinger", /hostinger|hosting|ssh|deploy|release/],
    ["connector", /connector|browser|shell|file|gcloud|n8n/],
    ["approvals", /approval|hold|grant-request|decision/],
    ["support", /support|ticket/],
    ["assets", /asset|upload|media/],
    ["identity", /auth|identity|membership|user|tenant/],
    ["agent_execution", /agent|skill|workflow|planner|execution|job|session/],
    ["platform_control_plane", /platform|admin|bootstrap|control-plane|registry|schema/],
  ];
  return domains.find(([, pattern]) => pattern.test(value))?.[0] || "application_domain";
}

function routeOperationClass(route) {
  const value = String(route.path || "").toLowerCase();
  if (/decision|decide|approve|reject/.test(value)) return "decision";
  if (/dispatch|execute|invoke|run|shell|browser/.test(value)) return "execute";
  if (/deploy|release|publish|promote/.test(value)) return "deploy";
  if (/grant|request|install|register|create|upload|append/.test(value) || route.method === "POST") return "create_or_request";
  if (route.method === "DELETE") return "delete";
  if (["PUT", "PATCH"].includes(route.method)) return "update";
  return "write_unknown";
}

function routeOwner(domain) {
  return `${domain.replaceAll("_", "-")}-governance`;
}

function routeEvidence(route) {
  const source = read(route.file);
  const lines = source.split("\n");
  const start = Math.max(0, Number(route.source_line || 1) - 1);
  const sourceOffset = Math.max(0, Number(route.source_offset || 0));
  const remainder = source.slice(sourceOffset);
  const nextRouteOffset = remainder.slice(1).search(/\n\s*router\.(?:get|post|put|patch|delete)\(/i);
  const handlerWindow = remainder.slice(0, nextRouteOffset > 0 ? nextRouteOffset : 12000);
  const signals = {
    provider: [...new Set((handlerWindow.match(/github|cloudflare|hostinger|axios|fetch\(|request\(|shell|browser|dispatch/gi) || []))].map((value) => value.toLowerCase()),
    db_registry: [...new Set((handlerWindow.match(/platform_[a-z0-9_]*(?:registry|bindings|catalog|operations?)/gi) || []))],
    authority: [...new Set((handlerWindow.match(/authority|membership|capability|approval|lease|scope|role|admin/gi) || []))].map((value) => value.toLowerCase()),
    readback: [...new Set((handlerWindow.match(/SELECT|RETURNING|readback|verify|res\.(?:json|send)|response/gi) || []))].map((value) => value.toLowerCase()),
    mutation: [...new Set((handlerWindow.match(/insert|update|delete|create|install|deploy|release|execute|dispatch|write/gi) || []))].map((value) => value.toLowerCase()),
  };
  const evidenceFlags = {
    handler_window_present: handlerWindow.length > 0,
    provider_signal: signals.provider.length > 0,
    db_registry_signal: signals.db_registry.length > 0,
    authority_signal: signals.authority.length > 0,
    readback_signal: signals.readback.length > 0,
    mutation_signal: signals.mutation.length > 0,
  };
  return {
    file: route.file,
    source_line: route.source_line,
    handler_window_lines: [start + 1, Math.min(lines.length, start + handlerWindow.split("\n").length)],
    evidence_flags: evidenceFlags,
    signals,
    static_only: true,
    secrets_included: false,
  };
}

function promotionPrerequisites(domain, evidence) {
  const prerequisites = [
    "explicit_resource_operation_scope_binding",
    "live_resource_authority_binding",
    "approval_policy_evidence",
    "capability_envelope_evidence",
    "lease_evidence",
    "staging_environment",
    "same_cycle_readback_contract",
  ];
  if (evidence.evidence_flags.provider_signal || ["connector", "github", "cloudflare", "hostinger"].includes(domain)) {
    prerequisites.push("provider_adapter_allowlist", "provider_idempotency", "provider_rollback_or_compensation");
  }
  if (evidence.evidence_flags.db_registry_signal || domain === "platform_control_plane") prerequisites.push("live_db_registry_readback");
  if (domain === "connector") prerequisites.push("device_capability_and_explicit_user_consent");
  return [...new Set(prerequisites)];
}

function evidenceConfidence(classification, evidence) {
  const flags = evidence.evidence_flags;
  const strongStaticSignals = Number(flags.authority_signal) + Number(flags.readback_signal) + Number(flags.mutation_signal);
  if (classification === "shadow_candidate" && strongStaticSignals >= 3) {
    return { level: "medium_static", basis: "catalog_pattern_plus_handler_signals", authorizes: false };
  }
  if (strongStaticSignals > 0) {
    return { level: "low_static", basis: "handler_window_signals_only", authorizes: false };
  }
  return { level: "none", basis: "domain_and_route_shape_only", authorizes: false };
}

function routeKey(route) {
  return route.route_id || `${route.method}:${route.path}:${route.file}`;
}

function buildWriteRouteClassifications(routes, candidates) {
  const byRoute = new Map();
  for (const candidate of candidates) {
    const key = routeKey(candidate);
    const current = byRoute.get(key) || [];
    current.push(candidate);
    byRoute.set(key, current);
  }
  return routes.map((route) => {
    const key = routeKey(route);
    const candidateScopes = byRoute.get(key) || [];
    const domain = routeDomain(route);
    const evidence = routeEvidence(route);
    if (candidateScopes.length) {
      return {
        route_id: route.route_id,
        classification: "shadow_candidate",
        mapping_status: "blocked_until_explicit_binding",
        domain,
        operation_class: routeOperationClass(route),
        evidence,
        evidence_confidence: evidenceConfidence("shadow_candidate", evidence),
        promotion_prerequisites: promotionPrerequisites(domain, evidence),
        promotion_status: "blocked",
        scope_keys: [...new Set(candidateScopes.map((candidate) => candidate.scope_key))],
        classification_confidence: "catalog_pattern",
        authority_required: true,
        provider_mutation_allowed: false,
        readback_required: true,
        owner: "remote-mcp-governance",
      };
    }
    const unmapped = unmappedRouteReason(route);
    return {
      route_id: route.route_id,
      classification: "intentionally_unmapped",
      mapping_status: "blocked",
      domain,
      operation_class: routeOperationClass(route),
      evidence,
      evidence_confidence: evidenceConfidence("intentionally_unmapped", evidence),
      promotion_prerequisites: promotionPrerequisites(domain, evidence),
      promotion_status: "blocked",
      scope_keys: [],
      resource_candidate: routeDomain(route),
      resource_key: null,
      operation_key: null,
      authority_required: true,
      provider_mutation_allowed: false,
      readback_required: true,
      owner: routeOwner(domain),
      classification_confidence: "heuristic_requires_manual_confirmation",
      risk_class: unmapped.risk,
      reason: unmapped.reason,
    };
  });
}

function summarizeEvidenceGraph(classifications) {
  const domains = new Set(classifications.map((route) => route.domain));
  const files = new Set(classifications.map((route) => route.evidence?.file));
  const countFlag = (key) => classifications.filter((route) => route.evidence?.evidence_flags?.[key] === true).length;
  return {
    node_counts: {
      routes: classifications.length,
      domains: domains.size,
      handler_files: files.size,
    },
    edge_counts: {
      route_to_handler_file: classifications.length,
      route_to_domain: classifications.length,
      route_to_provider_signal: countFlag("provider_signal"),
      route_to_db_registry_signal: countFlag("db_registry_signal"),
      route_to_authority_signal: countFlag("authority_signal"),
      route_to_readback_signal: countFlag("readback_signal"),
      route_to_mutation_signal: countFlag("mutation_signal"),
      route_to_explicit_scope_candidate: classifications.filter((route) => route.scope_keys?.length > 0).length,
    },
    execution_edges_are_non_authorizing: true,
    static_only: true,
    secrets_included: false,
  };
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
const writeRouteClassifications = buildWriteRouteClassifications(routeWrites, writeSurfaceCandidates);
const intentionallyUnmappedRoutes = writeRouteClassifications.filter((route) => route.classification === "intentionally_unmapped");
const sensitiveIntentionallyUnmappedRoutes = intentionallyUnmappedRoutes.filter((route) => ["critical", "high"].includes(route.risk_class));
const evidenceGraph = summarizeEvidenceGraph(writeRouteClassifications);
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
if (intentionallyUnmappedRoutes.length) findings.push({ severity: "high", code: "INTENTIONALLY_UNMAPPED_WRITE_ROUTES_BLOCKED", count: intentionallyUnmappedRoutes.length, sensitive_count: sensitiveIntentionallyUnmappedRoutes.length });
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
  classified_write_route_count: writeRouteClassifications.length,
  unclassified_write_route_count: writeRouteClassifications.filter((route) => !route.classification).length,
  intentionally_unmapped_write_route_count: intentionallyUnmappedRoutes.length,
  sensitive_intentionally_unmapped_write_route_count: sensitiveIntentionallyUnmappedRoutes.length,
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
  write_route_classifications: writeRouteClassifications,
  evidence_graph: evidenceGraph,
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
  ? findings.map((finding) => "- **" + finding.severity + "** `" + finding.code + "`" + (finding.scope_key ? " — `" + finding.scope_key + "`" : "") + (finding.count !== undefined ? " — count: " + finding.count : "") + (finding.sensitive_count !== undefined ? " — sensitive: " + finding.sensitive_count : "")).join("\n")
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
| Classified write routes | ${inventory.classified_write_route_count} |
| Intentionally unmapped write routes (blocked) | ${inventory.intentionally_unmapped_write_route_count} |
| Migrations with governance evidence | ${inventory.migration_count} |
| DB catalog fingerprint match | ${inventory.db_catalog_fingerprint_match} |
| Registry evidence entries | ${inventory.registry_evidence_count} |
| Write scopes | ${inventory.write_scope_count} |
| Bound write scopes | ${inventory.bound_write_scope_count} |
| Inventory ready | ${inventory.readiness.inventory_ready} |
| Write activation allowed | ${inventory.readiness.write_activation_allowed} |

## Findings

${findingLines}

## Classification contract

Every write route is represented exactly once in 'write_route_classifications':

| Classification | Meaning | Execution status |
|---|---|---|
| 'shadow_candidate' | Heuristic/catalog-owned surface candidate requiring explicit resource-operation-scope binding | Blocked until binding, authority, approval, capability, lease, and readback exist |
| 'intentionally_unmapped' | Route is inventoried but not proven to belong to the Remote MCP write surface | Blocked; owner and machine-readable reason are required |

'unclassified_write_route_count' must remain zero. A zero unclassified count does **not** mean write readiness; the inventory is ready only when blocked intentional mappings, scope bindings, DB evidence, and all governance gates are resolved.

## Evidence graph

The generated artifact includes a static-only evidence graph connecting each route declaration to its handler file, domain, catalog scope candidate, and detected provider, database, authority, readback, and mutation signals. These edges are evidence for review and never authorize execution.

## Safety boundary

The inventory explicitly keeps provider mutation, migration application, and Production activation disabled.
 A write scope is not eligible merely because it exists in the catalog; it requires an explicit resource-operation binding, tool binding, approval policy, capability envelope, lease, staging environment, and same-cycle readback.
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
