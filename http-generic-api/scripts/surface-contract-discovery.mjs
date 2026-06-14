#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const API_ROOT = process.cwd();
const REPO_ROOT = path.resolve(API_ROOT, "..");
const MIGRATIONS_DIR = path.join(API_ROOT, "migrations");
const OPENAPI_PATH = path.join(API_ROOT, "openapi.yaml");
const OUTPUT_PATH = path.join(REPO_ROOT, "docs", "surface-contract-discovery-status.md");
const JSON_OUTPUT_PATH = path.join(REPO_ROOT, "docs", "surface-contract-discovery-status.json");
const GAP_QUEUE_PATH = path.join(REPO_ROOT, "docs", "surface-contract-gap-queue.md");
const GAP_QUEUE_JSON_PATH = path.join(REPO_ROOT, "docs", "surface-contract-gap-queue.json");
const DOC_TARGETS = [
  "Updating Registry Patch Index.md",
  "deployment_parity_checklist.md",
  "docs/ai-docs-agent-governance.md",
  "docs/auto-docs-agent/README.md",
  "docs/change-documentation-governance.md",
];
const METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const SURFACE_TYPES = ["plugins", "tools", "views", "policies", "routes"];
const SAFETY_MARKERS = [
  "no_provider_call",
  "no_credential_payload_read",
  "no_raw_secrets",
  "no_external_send",
  "no_external_write",
  "secrets_included_false",
];
const ROUTE_CLASSES = [
  "http_route",
  "admin_tool_registry_route",
  "tenant_tool_registry_route",
  "system_tool_dispatch_route",
  "registry_only_surface",
  "false_positive_route_like_string",
  "legacy_closure_route_reviewed",
];
const LEGACY_BACKLOG_CLOSURE = {
  schema_version: "surface-contract-legacy-backlog-closure-v1",
  closure_date: "2026-06-12",
  closure_scope: "current historical SQL-backed surface backlog",
  closed_numeric_prefix_ranges: [[1, 291], [305, 306], [900, 910], [950, 961], [997, 999]],
  closed_filename_prefixes: ["20260611_"],
  future_policy: "Migrations outside these explicit ranges/prefixes remain subject to normal docs, OpenAPI, and safety gap scoring.",
  safety: { executes_provider_calls: false, reads_credentials: false, mutates_runtime: false, writes_database: false, external_sends: false, deploys: false, secrets_included: false },
};

function unique(values = []) {
  return [...new Set(values.filter(Boolean))].sort();
}

function readFileIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function normalizePathForCoverage(route = "") {
  return String(route || "").trim()
    .replace(/:[A-Za-z0-9_]+/g, "{}")
    .replace(/\{[A-Za-z0-9_]+\}/g, "{}")
    .replace(/\/+$/g, "") || "/";
}

function migrationNumericPrefix(fileName = "") {
  const match = String(fileName || "").match(/^(\d+)_/);
  return match ? Number(match[1]) : null;
}

function isLegacyBacklogClosed(fileName = "") {
  const name = String(fileName || "");
  if (LEGACY_BACKLOG_CLOSURE.closed_filename_prefixes.some((prefix) => name.startsWith(prefix))) return true;
  const prefix = migrationNumericPrefix(name);
  if (!Number.isFinite(prefix)) return false;
  return LEGACY_BACKLOG_CLOSURE.closed_numeric_prefix_ranges.some(([min, max]) => prefix >= min && prefix <= max);
}

function legacyClosureRouteClassification(route, fileName) {
  return {
    route,
    route_class: "legacy_closure_route_reviewed",
    openapi_required: false,
    reason: `Route-like literal belongs to ${fileName}, which is covered by the 2026-06-12 legacy backlog closure. It remains visible as evidence but is not treated as a new OpenAPI gap; future migrations outside the closure remain normally scored.`,
  };
}

function collectOpenapiPaths() {
  if (!fs.existsSync(OPENAPI_PATH)) return { operations: [], paths: [] };
  try {
    const doc = YAML.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    const operations = [];
    const paths = [];
    for (const [pathKey, item] of Object.entries(doc.paths || {})) {
      paths.push(pathKey);
      for (const method of Object.keys(item || {})) {
        if (METHODS.has(method)) operations.push(`${method.toUpperCase()} ${pathKey}`);
      }
    }
    return { operations: unique(operations), paths: unique(paths) };
  } catch {
    return { operations: [], paths: [] };
  }
}

function classifyRoute(route, source = "") {
  if (/INSERT\s+INTO\s+admin_platform_endpoint_tools/i.test(source)) {
    return {
      route,
      route_class: "admin_tool_registry_route",
      openapi_required: false,
      reason: "Route literal belongs to an admin_platform_endpoint_tools registry row; dispatch is governed through the admin tool registry rather than inferred as a standalone Express route.",
    };
  }
  if (/INSERT\s+INTO\s+tenant_platform_endpoint_tools/i.test(source)) {
    return {
      route,
      route_class: "tenant_tool_registry_route",
      openapi_required: false,
      reason: "Route literal belongs to a tenant tool registry row and is governed through tenant tool dispatch rather than inferred as a standalone Express route.",
    };
  }
  if (/\/admin\/system\/tools\/call|\/system\/tools\/call/.test(route)) {
    return {
      route,
      route_class: "system_tool_dispatch_route",
      openapi_required: false,
      reason: "System-tool dispatch endpoints are documented by the fixed dispatcher contract and should not create per-tool OpenAPI gaps.",
    };
  }
  if (/UPDATE\s+endpoints/i.test(source) && /schema_json\s*=\s*JSON_OBJECT/i.test(source) && /validated_synthetic_endpoint_native_contract|synthetic_endpoint_native_contract/i.test(source)) {
    return {
      route,
      route_class: "registry_only_surface",
      openapi_required: false,
      reason: "Route literal belongs to endpoint schema_json registry completion, not a newly declared Express route; OpenAPI coverage is governed through the endpoint-native schema contract.",
    };
  }
  if (/registry_only|record_only|readback_only|view-only|view only/i.test(source) && !/http_method|http_path/i.test(source)) {
    return {
      route,
      route_class: "registry_only_surface",
      openapi_required: false,
      reason: "Route-like text appears in a registry/readback-only migration without HTTP method/path registration evidence.",
    };
  }
  return {
    route,
    route_class: "http_route",
    openapi_required: true,
    reason: "Route literal has no registry-only exemption and should be checked against OpenAPI path coverage.",
  };
}

function extractSurfaces(source = "", fileName = "") {
  const routeMatches = [...source.matchAll(/['"`]((?:\/[A-Za-z0-9_{}:.-]+){2,})['"`]/g)].map((m) => m[1]);
  const routes = unique(routeMatches);
  const legacyClosed = isLegacyBacklogClosed(fileName);
  const routeClassifications = routes.map((route) => {
    const classified = classifyRoute(route, source);
    return legacyClosed && classified.openapi_required ? legacyClosureRouteClassification(route, fileName) : classified;
  });
  const views = [...source.matchAll(/`?(v_[A-Za-z0-9_]+)`?/g)].map((m) => m[1]);
  const policies = [...source.matchAll(/['"`]([A-Za-z0-9_]+_policy_v\d+)['"`]/g)].map((m) => m[1]);
  const plugins = [...source.matchAll(/['"`]([A-Za-z0-9_]+_orchestrator)['"`]/g)].map((m) => m[1]);
  const tools = [...source.matchAll(/['"`]([A-Za-z0-9_]+(?:_tool|_readback|_gate|_request|_approve|_decision|_execute|_list|_rollback|_certify|_record|_propose|_lookup|_validate|_blueprint|_dispatch|_preflight|_readiness)[A-Za-z0-9_]*)['"`]/g)].map((m) => m[1]);
  const safety = {
    no_provider_call: /no_provider_call['"`]?\s*,?\s*true|No provider calls?/i.test(source),
    no_credential_payload_read: /no_credential_payload_read['"`]?\s*,?\s*true|credential payload reads?/i.test(source),
    no_raw_secrets: /no_raw_secrets['"`]?\s*,?\s*true|raw secrets?/i.test(source),
    no_external_send: /no_external_send['"`]?\s*,?\s*true|No external send/i.test(source),
    no_external_write: /no_external_write['"`]?\s*,?\s*true|external writes?/i.test(source),
    secrets_included_false: /secrets_included['"`]?\s*,?\s*false|secrets_included\s*=\s*0|secrets_included=false/i.test(source),
  };
  return {
    routes,
    route_classifications: routeClassifications,
    views: unique(views),
    policies: unique(policies),
    plugins: unique(plugins),
    tools: unique(tools),
    safety,
  };
}

function docsCoverageFor(fileName, docsByPath) {
  const legacyClosed = isLegacyBacklogClosed(fileName);
  const shortName = fileName.replace(/\.sql$/i, "");
  const values = {};
  for (const target of DOC_TARGETS) {
    const body = docsByPath[target] || "";
    values[target] = legacyClosed || body.includes(fileName) || body.includes(shortName);
  }
  return values;
}

function hasAnySurface(surfaces) {
  return SURFACE_TYPES.some((type) => surfaces[type].length > 0);
}

function countSurfaces(entries) {
  return Object.fromEntries(SURFACE_TYPES.map((type) => [type, entries.reduce((sum, entry) => sum + entry.surfaces[type].length, 0)]));
}

function countMigrationsBySurface(entries) {
  return Object.fromEntries(SURFACE_TYPES.map((type) => [type, entries.filter((entry) => entry.surfaces[type].length > 0).length]));
}

function classifyGap(entry) {
  if (entry.documentation_complete) return "none";
  if (entry.surfaces.routes.length || entry.surfaces.plugins.length) return "high";
  if (entry.surfaces.tools.length || entry.surfaces.policies.length) return "medium";
  if (entry.surfaces.views.length) return "low";
  return "none";
}

function routeCoverageFor(entry, openapiPathSet) {
  const routes = entry.surfaces.routes;
  const classifications = entry.surfaces.route_classifications || routes.map((route) => ({ route, route_class: "http_route", openapi_required: true, reason: "legacy classification fallback" }));
  const required = classifications.filter((item) => item.openapi_required).map((item) => item.route);
  const exempted = classifications.filter((item) => !item.openapi_required);
  const documented = required.filter((route) => openapiPathSet.has(normalizePathForCoverage(route)) || openapiPathSet.has(route));
  const missing = required.filter((route) => !documented.includes(route));
  const routeClassCounts = Object.fromEntries(ROUTE_CLASSES.map((routeClass) => [routeClass, classifications.filter((item) => item.route_class === routeClass).length]));
  return {
    route_count: required.length,
    total_route_count: routes.length,
    openapi_required_route_count: required.length,
    exempted_route_count: exempted.length,
    route_class_counts: routeClassCounts,
    documented_count: documented.length,
    missing_count: missing.length,
    documented_routes: documented,
    missing_routes: missing,
    exempted_routes: exempted,
    route_classifications: classifications,
  };
}

function buildCoverageSummary({ allMigrations, openapiPaths }) {
  const openapiPathSet = new Set(openapiPaths.map(normalizePathForCoverage));
  const docsComplete = allMigrations.filter((entry) => entry.documentation_complete).length;
  const docsGap = allMigrations.length - docsComplete;
  const missingDocTargetCounts = Object.fromEntries(DOC_TARGETS.map((target) => [target, allMigrations.filter((entry) => entry.missing_docs.includes(target)).length]));
  const gapSeverityCounts = { high: 0, medium: 0, low: 0, none: 0 };
  const safetyMarkerCounts = Object.fromEntries(SAFETY_MARKERS.map((marker) => [marker, allMigrations.filter((entry) => entry.legacy_backlog_closed || entry.surfaces.safety[marker]).length]));
  const routeEntries = allMigrations.map((entry) => routeCoverageFor(entry, openapiPathSet));
  const routeCount = routeEntries.reduce((sum, entry) => sum + entry.route_count, 0);
  const totalRouteCount = routeEntries.reduce((sum, entry) => sum + entry.total_route_count, 0);
  const exemptedRouteCount = routeEntries.reduce((sum, entry) => sum + entry.exempted_route_count, 0);
  const routeClassCounts = Object.fromEntries(ROUTE_CLASSES.map((routeClass) => [routeClass, routeEntries.reduce((sum, entry) => sum + (entry.route_class_counts?.[routeClass] || 0), 0)]));
  const documentedRouteCount = routeEntries.reduce((sum, entry) => sum + entry.documented_count, 0);
  const missingRouteCount = routeEntries.reduce((sum, entry) => sum + entry.missing_count, 0);
  const safetyMarkerGapMigrations = allMigrations.filter((entry) => !entry.legacy_backlog_closed && !entry.surfaces.safety.secrets_included_false).length;
  const highRiskMissingDocs = [];
  const mediumRiskMissingDocs = [];
  const routeOpenapiGaps = [];
  for (const entry of allMigrations) {
    const severity = classifyGap(entry);
    gapSeverityCounts[severity] += 1;
    if (severity === "high") highRiskMissingDocs.push(entry.migration_file);
    if (severity === "medium") mediumRiskMissingDocs.push(entry.migration_file);
    const routeCoverage = routeCoverageFor(entry, openapiPathSet);
    if (routeCoverage.missing_count) routeOpenapiGaps.push({ migration_file: entry.migration_file, missing_routes: routeCoverage.missing_routes });
  }
  return {
    migrations_with_surfaces: allMigrations.length,
    docs_complete_count: docsComplete,
    docs_gap_count: docsGap,
    docs_completion_percent: allMigrations.length ? Number(((docsComplete / allMigrations.length) * 100).toFixed(2)) : 100,
    surface_totals: countSurfaces(allMigrations),
    migrations_by_surface_type: countMigrationsBySurface(allMigrations),
    missing_doc_target_counts: missingDocTargetCounts,
    gap_severity_counts: gapSeverityCounts,
    high_risk_missing_docs: highRiskMissingDocs,
    medium_risk_missing_docs: mediumRiskMissingDocs,
    safety_marker_counts: safetyMarkerCounts,
    safety_marker_gap_migrations: safetyMarkerGapMigrations,
    route_coverage: {
      sql_route_count: routeCount,
      total_sql_route_like_count: totalRouteCount,
      openapi_exempt_sql_route_count: exemptedRouteCount,
      route_class_counts: routeClassCounts,
      openapi_documented_sql_route_count: documentedRouteCount,
      openapi_missing_sql_route_count: missingRouteCount,
      openapi_sql_route_coverage_percent: routeCount ? Number(((documentedRouteCount / routeCount) * 100).toFixed(2)) : 100,
      route_openapi_gaps: routeOpenapiGaps,
    },
  };
}

function enrichEntry(entry, openapiPathSet) {
  const gapSeverity = classifyGap(entry);
  const routeCoverage = routeCoverageFor(entry, openapiPathSet);
  return {
    ...entry,
    coverage: {
      gap_severity: gapSeverity,
      requires_docs_review: gapSeverity !== "none",
      route_coverage: routeCoverage,
      surface_count: SURFACE_TYPES.reduce((sum, type) => sum + entry.surfaces[type].length, 0),
      safety_marker_count: SAFETY_MARKERS.filter((marker) => entry.surfaces.safety[marker]).length,
    },
  };
}

function safetyGapsFor(entry) {
  if (entry.legacy_backlog_closed) return [];
  return SAFETY_MARKERS.filter((marker) => !entry.surfaces.safety[marker]);
}

function remediationFor(entry) {
  const routeCoverage = entry.coverage.route_coverage;
  const safetyGaps = safetyGapsFor(entry);
  const actions = [];
  if (entry.missing_docs.length) {
    actions.push({ action_key: "document_surface_contract", owner_hint: "docs-agent/human-review", targets: entry.missing_docs, reason: "Migration surfaces are not mentioned in all required documentation targets." });
  }
  if (routeCoverage.missing_count) {
    actions.push({ action_key: "review_openapi_contract", owner_hint: "api-contract-review", targets: routeCoverage.missing_routes, reason: "SQL-declared route-like surfaces are not covered by an OpenAPI path." });
  }
  if (entry.surfaces.tools.length) {
    actions.push({ action_key: "verify_tool_registry_binding", owner_hint: "runtime-registry-review", targets: entry.surfaces.tools.slice(0, 25), reason: "Tool-like surfaces need registry binding/readback evidence before promotion." });
  }
  if (entry.surfaces.policies.length) {
    actions.push({ action_key: "verify_policy_seed_readiness", owner_hint: "runtime-policy-review", targets: entry.surfaces.policies, reason: "Policy surfaces need active/blocking/valid-JSON readiness evidence." });
  }
  if (entry.surfaces.views.length) {
    actions.push({ action_key: "verify_readback_view", owner_hint: "db-readback-review", targets: entry.surfaces.views.slice(0, 25), reason: "Readback views should have parity/readiness documentation and smoke evidence." });
  }
  if (safetyGaps.length) {
    actions.push({ action_key: "add_explicit_safety_markers", owner_hint: "safety-contract-review", targets: safetyGaps, reason: "Migration text is missing one or more explicit no-execution/no-secret safety markers." });
  }
  return actions;
}

function scoreGap(entry, index, total) {
  if (!entry.coverage.requires_docs_review && !entry.coverage.route_coverage.missing_count && safetyGapsFor(entry).length === 0) return 0;
  const severity = entry.coverage.gap_severity;
  const recencyRank = total ? index / total : 0;
  let score = 0;
  if (severity === "high") score += 500;
  if (severity === "medium") score += 300;
  if (severity === "low") score += 150;
  score += entry.missing_docs.length * 20;
  score += entry.coverage.route_coverage.missing_count * 80;
  score += entry.surfaces.plugins.length * 120;
  score += entry.coverage.route_coverage.openapi_required_route_count * 100;
  score += entry.surfaces.tools.length * 18;
  score += entry.surfaces.policies.length * 40;
  score += entry.surfaces.views.length * 10;
  score += safetyGapsFor(entry).length * 12;
  score += Math.round(recencyRank * 100);
  return score;
}

function queueClassFor(score) {
  if (score >= 700) return "critical_review";
  if (score >= 420) return "high_review";
  if (score >= 220) return "medium_review";
  if (score > 0) return "low_review";
  return "covered";
}

function buildGapQueue(allMigrations) {
  const total = allMigrations.length || 1;
  const items = allMigrations.map((entry, index) => {
    const score = scoreGap(entry, index, total);
    return {
      migration_file: entry.migration_file,
      score,
      queue_class: queueClassFor(score),
      gap_severity: entry.coverage.gap_severity,
      documentation_complete: entry.documentation_complete,
      missing_docs: entry.missing_docs,
      missing_openapi_routes: entry.coverage.route_coverage.missing_routes,
      safety_marker_gaps: safetyGapsFor(entry),
      surface_counts: Object.fromEntries(SURFACE_TYPES.map((type) => [type, entry.surfaces[type].length])),
      remediation: remediationFor(entry),
      safety: { executes_provider_calls: false, reads_credentials: false, mutates_runtime: false, writes_database: false, external_sends: false, deploys: false, secrets_included: false },
    };
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.migration_file.localeCompare(b.migration_file));

  const classCounts = items.reduce((acc, item) => {
    acc[item.queue_class] = (acc[item.queue_class] || 0) + 1;
    return acc;
  }, {});
  return {
    ok: true,
    schema_version: "surface-contract-gap-queue-v1",
    total_items: items.length,
    class_counts: { critical_review: classCounts.critical_review || 0, high_review: classCounts.high_review || 0, medium_review: classCounts.medium_review || 0, low_review: classCounts.low_review || 0 },
    top_items: items.slice(0, 100),
    safety: { executes_provider_calls: false, reads_credentials: false, mutates_runtime: false, writes_database: false, external_sends: false, deploys: false, secrets_included: false },
  };
}

export function discoverSurfaces({ limit = 80 } = {}) {
  const docsByPath = Object.fromEntries(DOC_TARGETS.map((rel) => [rel, readFileIfExists(path.join(REPO_ROOT, rel))]));
  const openapi = collectOpenapiPaths();
  const openapiPathSet = new Set(openapi.paths.map(normalizePathForCoverage));
  const allMigrations = listMigrationFiles()
    .map((name) => {
      const source = readFileIfExists(path.join(MIGRATIONS_DIR, name));
      const legacyBacklogClosed = isLegacyBacklogClosed(name);
      const surfaces = extractSurfaces(source, name);
      const docs = docsCoverageFor(name, docsByPath);
      const missingDocs = Object.entries(docs).filter(([, covered]) => !covered).map(([target]) => target);
      return enrichEntry({ migration_file: name, legacy_backlog_closed: legacyBacklogClosed, surfaces, docs, missing_docs: missingDocs, documentation_complete: missingDocs.length === 0 }, openapiPathSet);
    })
    .filter((entry) => hasAnySurface(entry.surfaces));

  const latest = allMigrations.slice(-limit).reverse();
  return {
    ok: true,
    schema_version: "surface-contract-discovery-v3",
    migration_surface_count: allMigrations.length,
    reported_count: latest.length,
    openapi_operation_count: openapi.operations.length,
    openapi_path_count: openapi.paths.length,
    openapi_operations: openapi.operations,
    documentation_targets: DOC_TARGETS,
    legacy_backlog_closure: {
      ...LEGACY_BACKLOG_CLOSURE,
      closed_migration_count: allMigrations.filter((entry) => entry.legacy_backlog_closed).length,
    },
    coverage_summary: buildCoverageSummary({ allMigrations, openapiPaths: openapi.paths }),
    gap_queue: buildGapQueue(allMigrations),
    migrations: latest,
    all_migrations: allMigrations,
    safety: { executes_provider_calls: false, reads_credentials: false, mutates_runtime: false, writes_database: false, external_sends: false, deploys: false, secrets_included: false },
  };
}

function listOrNone(items = [], formatter = (x) => x) {
  if (!items.length) return "- none";
  return items.map((item) => `- ${formatter(item)}`).join("\n");
}
function boolIcon(value) { return value ? "yes" : "no"; }
function percent(value) { return `${Number(value || 0).toFixed(2)}%`; }

function renderCoverageSummary(summary) {
  const surfaceTotals = SURFACE_TYPES.map((type) => `| ${type} | ${summary.surface_totals[type]} | ${summary.migrations_by_surface_type[type]} |`).join("\n");
  const docsTargets = Object.entries(summary.missing_doc_target_counts).map(([target, count]) => `| \`${target}\` | ${count} |`).join("\n");
  const safetyRows = Object.entries(summary.safety_marker_counts).map(([marker, count]) => `| ${marker} | ${count} |`).join("\n");
  const routeClassRows = Object.entries(summary.route_coverage.route_class_counts || {}).map(([routeClass, count]) => `| ${routeClass} | ${count} |`).join("\n");
  return `## Coverage Summary\n\n- Documentation complete migrations: ${summary.docs_complete_count}/${summary.migrations_with_surfaces} (${percent(summary.docs_completion_percent)})\n- Documentation gap migrations: ${summary.docs_gap_count}\n- Gap severity: high=${summary.gap_severity_counts.high}, medium=${summary.gap_severity_counts.medium}, low=${summary.gap_severity_counts.low}\n- SQL route coverage in OpenAPI: ${summary.route_coverage.openapi_documented_sql_route_count}/${summary.route_coverage.sql_route_count} (${percent(summary.route_coverage.openapi_sql_route_coverage_percent)})\n- SQL route-like literals exempted from OpenAPI scoring: ${summary.route_coverage.openapi_exempt_sql_route_count}/${summary.route_coverage.total_sql_route_like_count}\n- SQL routes missing OpenAPI path coverage: ${summary.route_coverage.openapi_missing_sql_route_count}\n- Migrations without explicit \`secrets_included=false\` marker: ${summary.safety_marker_gap_migrations}\n\n### Surface Totals\n\n| Surface type | Discovered items | Migrations with type |\n|---|---:|---:|\n${surfaceTotals}\n\n### Documentation Target Gaps\n\n| Documentation target | Missing migration mentions |\n|---|---:|\n${docsTargets}\n\n### Safety Marker Coverage\n\n| Safety marker | Migrations with marker |\n|---|---:|\n${safetyRows}\n\n### Route Classification Coverage\n\n| Route class | SQL route-like literals |\n|---|---:|\n${routeClassRows}\n`;
}

function renderGapQueueSummary(queue) {
  const rows = queue.top_items.slice(0, 20).map((item) => `| \`${item.migration_file}\` | ${item.queue_class} | ${item.score} | ${item.gap_severity} | ${item.missing_docs.length} | ${item.missing_openapi_routes.length} | ${item.safety_marker_gaps.length} | ${item.remediation.map((r) => r.action_key).join(", ")} |`);
  return `## Actionable Gap Queue\n\nMachine-readable queue: \`docs/surface-contract-gap-queue.json\`. Human-readable queue: \`docs/surface-contract-gap-queue.md\`.\n\n- Total queue items: ${queue.total_items}\n- Critical review: ${queue.class_counts.critical_review}\n- High review: ${queue.class_counts.high_review}\n- Medium review: ${queue.class_counts.medium_review}\n- Low review: ${queue.class_counts.low_review}\n\n| Migration | Queue class | Score | Severity | Missing docs | OpenAPI gaps | Safety gaps | Remediation actions |\n|---|---:|---:|---:|---:|---:|---:|---|\n${rows.join("\n") || "| none | covered | 0 | none | 0 | 0 | 0 | none |"}\n`;
}

export function renderSurfaceContractMarkdown(report) {
  const rows = report.migrations.map((entry) => {
    const s = entry.surfaces;
    return `| \`${entry.migration_file}\` | ${entry.documentation_complete ? "complete" : "needs docs"} | ${entry.coverage.gap_severity} | ${s.plugins.length} | ${s.tools.length} | ${s.views.length} | ${s.policies.length} | ${s.routes.length} | ${entry.coverage.route_coverage.missing_count} |`;
  });
  const details = report.migrations.map((entry) => {
    const s = entry.surfaces;
    return `### \`${entry.migration_file}\`\n\n- Documentation complete: ${boolIcon(entry.documentation_complete)}\n- Gap severity: ${entry.coverage.gap_severity}\n- Missing docs: ${entry.missing_docs.length ? entry.missing_docs.map((d) => `\`${d}\``).join(", ") : "none"}\n- Surface count: ${entry.coverage.surface_count}\n- Plugins: ${s.plugins.length ? s.plugins.map((x) => `\`${x}\``).join(", ") : "none"}\n- Tools: ${s.tools.length ? s.tools.slice(0, 20).map((x) => `\`${x}\``).join(", ") : "none"}${s.tools.length > 20 ? `, ...and ${s.tools.length - 20} more` : ""}\n- Views: ${s.views.length ? s.views.map((x) => `\`${x}\``).join(", ") : "none"}\n- Policies: ${s.policies.length ? s.policies.map((x) => `\`${x}\``).join(", ") : "none"}\n- Routes: ${s.routes.length ? s.routes.map((x) => `\`${x}\``).join(", ") : "none"}\n- Route classifications: ${entry.coverage.route_coverage.route_classifications.length ? entry.coverage.route_coverage.route_classifications.map((x) => `\`${x.route}\`=${x.route_class}${x.openapi_required ? ":openapi" : ":exempt"}`).join(", ") : "none"}\n- OpenAPI route gaps: ${entry.coverage.route_coverage.missing_count ? entry.coverage.route_coverage.missing_routes.map((x) => `\`${x}\``).join(", ") : "none"}\n- Safety markers: no_provider_call=${boolIcon(s.safety.no_provider_call)}, no_credential_payload_read=${boolIcon(s.safety.no_credential_payload_read)}, no_raw_secrets=${boolIcon(s.safety.no_raw_secrets)}, no_external_send=${boolIcon(s.safety.no_external_send)}, no_external_write=${boolIcon(s.safety.no_external_write)}, secrets_included_false=${boolIcon(s.safety.secrets_included_false)}\n`;
  });
  return `# Surface Contract Discovery Status\n\n> Generated by \`http-generic-api/scripts/surface-contract-discovery.mjs\`. Do not hand-edit generated facts in this file; update migrations, OpenAPI, docs, or the discovery script instead. Machine-readable output is committed at \`docs/surface-contract-discovery-status.json\`; actionable queue output is committed at \`docs/surface-contract-gap-queue.json\`.\n\n## Purpose\n\nThis report automatically discovers new SQL-backed platform surfaces from migration files and checks whether the standard documentation targets mention the migration. It complements OpenAPI route autofill, which covers Express routes only.\n\n## Safety Contract\n\n- Executes provider calls: false\n- Reads credential payloads: false\n- Mutates runtime: false\n- Writes database: false\n- External sends: false\n- Deploys: false\n- Includes secrets: false\n- Output is documentation evidence only. It does not authorize tools, external sends, credential access, spend changes, provider calls, database writes, runtime mutation, or deployment.\n\n## Scope\n\n- Migrations with detected surfaces: ${report.migration_surface_count}\n- Migrations reported here: ${report.reported_count}\n- OpenAPI operations detected: ${report.openapi_operation_count}\n- OpenAPI paths detected: ${report.openapi_path_count}\n- Documentation targets checked:\n${listOrNone(report.documentation_targets, (target) => `\`${target}\``)}\n\n${renderCoverageSummary(report.coverage_summary)}\n\n${renderGapQueueSummary(report.gap_queue)}\n\n## Latest Surface Coverage\n\n| Migration | Docs | Severity | Plugins | Tools | Views | Policies | Routes | OpenAPI route gaps |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n${rows.join("\n") || "| none | complete | none | 0 | 0 | 0 | 0 | 0 | 0 |"}\n\n## High-Risk Documentation Gaps\n\n${listOrNone(report.coverage_summary.high_risk_missing_docs.slice(0, 40), (name) => `\`${name}\``)}${report.coverage_summary.high_risk_missing_docs.length > 40 ? `\n- ...and ${report.coverage_summary.high_risk_missing_docs.length - 40} more` : ""}\n\n## SQL Route OpenAPI Gaps\n\n${listOrNone(report.coverage_summary.route_coverage.route_openapi_gaps.slice(0, 40), (entry) => `\`${entry.migration_file}\`: ${entry.missing_routes.map((route) => `\`${route}\``).join(", ")}`)}${report.coverage_summary.route_coverage.route_openapi_gaps.length > 40 ? `\n- ...and ${report.coverage_summary.route_coverage.route_openapi_gaps.length - 40} more` : ""}\n\n## Details\n\n${details.join("\n") || "No SQL-backed surfaces detected."}\n\n## Automation Contract\n\n- \`repo-maintenance-sync.mjs --write\` regenerates this report, \`docs/surface-contract-discovery-status.json\`, \`docs/surface-contract-gap-queue.md\`, and \`docs/surface-contract-gap-queue.json\`.\n- \`openapi-auto-sync.yml\` opens a reviewable PR after route, migration, OpenAPI, docs, or surface-discovery script changes.\n- Autogenerated OpenAPI TODO stubs block auto-merge until a human contract review replaces them.\n- Docs-only report updates may auto-merge after CI if repository branch protection allows it.\n`;
}

export function renderGapQueueMarkdown(queue) {
  const details = queue.top_items.map((item, index) => `### ${index + 1}. \`${item.migration_file}\`\n\n- Queue class: ${item.queue_class}\n- Score: ${item.score}\n- Gap severity: ${item.gap_severity}\n- Missing docs: ${item.missing_docs.length ? item.missing_docs.map((d) => `\`${d}\``).join(", ") : "none"}\n- Missing OpenAPI routes: ${item.missing_openapi_routes.length ? item.missing_openapi_routes.map((d) => `\`${d}\``).join(", ") : "none"}\n- Safety marker gaps: ${item.safety_marker_gaps.length ? item.safety_marker_gaps.map((d) => `\`${d}\``).join(", ") : "none"}\n- Surface counts: plugins=${item.surface_counts.plugins}, tools=${item.surface_counts.tools}, views=${item.surface_counts.views}, policies=${item.surface_counts.policies}, routes=${item.surface_counts.routes}\n- Remediation actions:\n${listOrNone(item.remediation, (r) => `\`${r.action_key}\` → ${r.owner_hint}; targets: ${r.targets.slice(0, 12).map((t) => `\`${t}\``).join(", ")}${r.targets.length > 12 ? `, ...and ${r.targets.length - 12} more` : ""}`)}\n`);
  return `# Surface Contract Gap Queue\n\n> Generated by \`http-generic-api/scripts/surface-contract-discovery.mjs\`. This is an evidence-only remediation queue. It does not authorize provider calls, credential reads, runtime mutation, database writes, external sends, deployments, or secrets.\n\n## Summary\n\n- Total queue items: ${queue.total_items}\n- Critical review: ${queue.class_counts.critical_review}\n- High review: ${queue.class_counts.high_review}\n- Medium review: ${queue.class_counts.medium_review}\n- Low review: ${queue.class_counts.low_review}\n- Machine-readable queue: \`docs/surface-contract-gap-queue.json\`\n\n## Top Queue Items\n\n${details.join("\n") || "No actionable surface contract gaps detected."}\n`;
}

function writeGeneratedOutputs(report, markdown) {
  const gapQueueMarkdown = renderGapQueueMarkdown(report.gap_queue);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, markdown);
  fs.writeFileSync(JSON_OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(GAP_QUEUE_PATH, gapQueueMarkdown);
  fs.writeFileSync(GAP_QUEUE_JSON_PATH, `${JSON.stringify(report.gap_queue, null, 2)}\n`);
}

function checkGeneratedOutputs(report, markdown) {
  const expectedJson = `${JSON.stringify(report, null, 2)}\n`;
  const expectedGapQueueJson = `${JSON.stringify(report.gap_queue, null, 2)}\n`;
  const expectedGapQueueMarkdown = renderGapQueueMarkdown(report.gap_queue);
  const currentMarkdown = readFileIfExists(OUTPUT_PATH);
  const currentJson = readFileIfExists(JSON_OUTPUT_PATH);
  const currentGapQueueMarkdown = readFileIfExists(GAP_QUEUE_PATH);
  const currentGapQueueJson = readFileIfExists(GAP_QUEUE_JSON_PATH);
  const mismatches = [];
  if (currentMarkdown !== markdown) mismatches.push(path.relative(REPO_ROOT, OUTPUT_PATH));
  if (currentJson !== expectedJson) mismatches.push(path.relative(REPO_ROOT, JSON_OUTPUT_PATH));
  if (currentGapQueueMarkdown !== expectedGapQueueMarkdown) mismatches.push(path.relative(REPO_ROOT, GAP_QUEUE_PATH));
  if (currentGapQueueJson !== expectedGapQueueJson) mismatches.push(path.relative(REPO_ROOT, GAP_QUEUE_JSON_PATH));
  if (mismatches.length) {
    console.error(`surface-contract-discovery: generated outputs are not committed: ${mismatches.join(", ")}`);
    process.exit(1);
  }
}

function main() {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  const report = discoverSurfaces();
  const markdown = renderSurfaceContractMarkdown(report);
  if (write) writeGeneratedOutputs(report, markdown);
  if (check) checkGeneratedOutputs(report, markdown);
  console.log(JSON.stringify({
    ok: true,
    schema_version: report.schema_version,
    gap_queue_schema_version: report.gap_queue.schema_version,
    write,
    check,
    output: path.relative(REPO_ROOT, OUTPUT_PATH),
    json_output: path.relative(REPO_ROOT, JSON_OUTPUT_PATH),
    gap_queue_output: path.relative(REPO_ROOT, GAP_QUEUE_PATH),
    gap_queue_json_output: path.relative(REPO_ROOT, GAP_QUEUE_JSON_PATH),
    migration_surface_count: report.migration_surface_count,
    reported_count: report.reported_count,
    docs_completion_percent: report.coverage_summary.docs_completion_percent,
    high_risk_missing_docs: report.coverage_summary.gap_severity_counts.high,
    openapi_missing_sql_route_count: report.coverage_summary.route_coverage.openapi_missing_sql_route_count,
    gap_queue_items: report.gap_queue.total_items,
    critical_review_items: report.gap_queue.class_counts.critical_review,
    secrets_included: false,
  }, null, 2));
}

export function isDirectExecution(importMetaUrl, argvPath) {
  if (!argvPath) return false;
  return path.resolve(fileURLToPath(importMetaUrl)) === path.resolve(argvPath);
}

if (isDirectExecution(import.meta.url, process.argv[1])) main();
