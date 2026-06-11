#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const API_ROOT = process.cwd();
const REPO_ROOT = path.resolve(API_ROOT, "..");
const MIGRATIONS_DIR = path.join(API_ROOT, "migrations");
const OPENAPI_PATH = path.join(API_ROOT, "openapi.yaml");
const OUTPUT_PATH = path.join(REPO_ROOT, "docs", "surface-contract-discovery-status.md");
const JSON_OUTPUT_PATH = path.join(REPO_ROOT, "docs", "surface-contract-discovery-status.json");
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

function extractSurfaces(source = "") {
  const routeMatches = [...source.matchAll(/['"`]((?:\/[A-Za-z0-9_{}:.-]+){2,})['"`]/g)].map((m) => m[1]);
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
    routes: unique(routeMatches),
    views: unique(views),
    policies: unique(policies),
    plugins: unique(plugins),
    tools: unique(tools),
    safety,
  };
}

function docsCoverageFor(fileName, docsByPath) {
  const shortName = fileName.replace(/\.sql$/i, "");
  const values = {};
  for (const target of DOC_TARGETS) {
    const body = docsByPath[target] || "";
    values[target] = body.includes(fileName) || body.includes(shortName);
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
  const documented = routes.filter((route) => openapiPathSet.has(normalizePathForCoverage(route)) || openapiPathSet.has(route));
  const missing = routes.filter((route) => !documented.includes(route));
  return {
    route_count: routes.length,
    documented_count: documented.length,
    missing_count: missing.length,
    documented_routes: documented,
    missing_routes: missing,
  };
}

function buildCoverageSummary({ allMigrations, openapiPaths }) {
  const openapiPathSet = new Set(openapiPaths.map(normalizePathForCoverage));
  const docsComplete = allMigrations.filter((entry) => entry.documentation_complete).length;
  const docsGap = allMigrations.length - docsComplete;
  const missingDocTargetCounts = Object.fromEntries(DOC_TARGETS.map((target) => [target, allMigrations.filter((entry) => entry.missing_docs.includes(target)).length]));
  const gapSeverityCounts = { high: 0, medium: 0, low: 0, none: 0 };
  const safetyMarkerCounts = Object.fromEntries(SAFETY_MARKERS.map((marker) => [marker, allMigrations.filter((entry) => entry.surfaces.safety[marker]).length]));
  const routeEntries = allMigrations.map((entry) => routeCoverageFor(entry, openapiPathSet));
  const routeCount = routeEntries.reduce((sum, entry) => sum + entry.route_count, 0);
  const documentedRouteCount = routeEntries.reduce((sum, entry) => sum + entry.documented_count, 0);
  const missingRouteCount = routeEntries.reduce((sum, entry) => sum + entry.missing_count, 0);
  const safetyMarkerGapMigrations = allMigrations.filter((entry) => !entry.surfaces.safety.secrets_included_false).length;
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

export function discoverSurfaces({ limit = 80 } = {}) {
  const docsByPath = Object.fromEntries(DOC_TARGETS.map((rel) => [rel, readFileIfExists(path.join(REPO_ROOT, rel))]));
  const openapi = collectOpenapiPaths();
  const openapiPathSet = new Set(openapi.paths.map(normalizePathForCoverage));
  const allMigrations = listMigrationFiles()
    .map((name) => {
      const source = readFileIfExists(path.join(MIGRATIONS_DIR, name));
      const surfaces = extractSurfaces(source);
      const docs = docsCoverageFor(name, docsByPath);
      const missingDocs = Object.entries(docs).filter(([, covered]) => !covered).map(([target]) => target);
      return enrichEntry({
        migration_file: name,
        surfaces,
        docs,
        missing_docs: missingDocs,
        documentation_complete: missingDocs.length === 0,
      }, openapiPathSet);
    })
    .filter((entry) => hasAnySurface(entry.surfaces));

  const latest = allMigrations.slice(-limit).reverse();
  return {
    ok: true,
    schema_version: "surface-contract-discovery-v2",
    migration_surface_count: allMigrations.length,
    reported_count: latest.length,
    openapi_operation_count: openapi.operations.length,
    openapi_path_count: openapi.paths.length,
    openapi_operations: openapi.operations,
    documentation_targets: DOC_TARGETS,
    coverage_summary: buildCoverageSummary({ allMigrations, openapiPaths: openapi.paths }),
    migrations: latest,
    all_migrations: allMigrations,
    safety: {
      executes_provider_calls: false,
      reads_credentials: false,
      mutates_runtime: false,
      writes_database: false,
      external_sends: false,
      deploys: false,
      secrets_included: false,
    },
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
  const docsTargets = Object.entries(summary.missing_doc_target_counts)
    .map(([target, count]) => `| \`${target}\` | ${count} |`).join("\n");
  const safetyRows = Object.entries(summary.safety_marker_counts)
    .map(([marker, count]) => `| ${marker} | ${count} |`).join("\n");
  return `## Coverage Summary\n\n- Documentation complete migrations: ${summary.docs_complete_count}/${summary.migrations_with_surfaces} (${percent(summary.docs_completion_percent)})\n- Documentation gap migrations: ${summary.docs_gap_count}\n- Gap severity: high=${summary.gap_severity_counts.high}, medium=${summary.gap_severity_counts.medium}, low=${summary.gap_severity_counts.low}\n- SQL route coverage in OpenAPI: ${summary.route_coverage.openapi_documented_sql_route_count}/${summary.route_coverage.sql_route_count} (${percent(summary.route_coverage.openapi_sql_route_coverage_percent)})\n- SQL routes missing OpenAPI path coverage: ${summary.route_coverage.openapi_missing_sql_route_count}\n- Migrations without explicit \`secrets_included=false\` marker: ${summary.safety_marker_gap_migrations}\n\n### Surface Totals\n\n| Surface type | Discovered items | Migrations with type |\n|---|---:|---:|\n${surfaceTotals}\n\n### Documentation Target Gaps\n\n| Documentation target | Missing migration mentions |\n|---|---:|\n${docsTargets}\n\n### Safety Marker Coverage\n\n| Safety marker | Migrations with marker |\n|---|---:|\n${safetyRows}\n`;
}

export function renderSurfaceContractMarkdown(report) {
  const rows = report.migrations.map((entry) => {
    const s = entry.surfaces;
    return `| \`${entry.migration_file}\` | ${entry.documentation_complete ? "complete" : "needs docs"} | ${entry.coverage.gap_severity} | ${s.plugins.length} | ${s.tools.length} | ${s.views.length} | ${s.policies.length} | ${s.routes.length} | ${entry.coverage.route_coverage.missing_count} |`;
  });
  const details = report.migrations.map((entry) => {
    const s = entry.surfaces;
    return `### \`${entry.migration_file}\`\n\n- Documentation complete: ${boolIcon(entry.documentation_complete)}\n- Gap severity: ${entry.coverage.gap_severity}\n- Missing docs: ${entry.missing_docs.length ? entry.missing_docs.map((d) => `\`${d}\``).join(", ") : "none"}\n- Surface count: ${entry.coverage.surface_count}\n- Plugins: ${s.plugins.length ? s.plugins.map((x) => `\`${x}\``).join(", ") : "none"}\n- Tools: ${s.tools.length ? s.tools.slice(0, 20).map((x) => `\`${x}\``).join(", ") : "none"}${s.tools.length > 20 ? `, ...and ${s.tools.length - 20} more` : ""}\n- Views: ${s.views.length ? s.views.map((x) => `\`${x}\``).join(", ") : "none"}\n- Policies: ${s.policies.length ? s.policies.map((x) => `\`${x}\``).join(", ") : "none"}\n- Routes: ${s.routes.length ? s.routes.map((x) => `\`${x}\``).join(", ") : "none"}\n- OpenAPI route gaps: ${entry.coverage.route_coverage.missing_count ? entry.coverage.route_coverage.missing_routes.map((x) => `\`${x}\``).join(", ") : "none"}\n- Safety markers: no_provider_call=${boolIcon(s.safety.no_provider_call)}, no_credential_payload_read=${boolIcon(s.safety.no_credential_payload_read)}, no_raw_secrets=${boolIcon(s.safety.no_raw_secrets)}, no_external_send=${boolIcon(s.safety.no_external_send)}, no_external_write=${boolIcon(s.safety.no_external_write)}, secrets_included_false=${boolIcon(s.safety.secrets_included_false)}\n`;
  });
  return `# Surface Contract Discovery Status\n\n> Generated by \`http-generic-api/scripts/surface-contract-discovery.mjs\`. Do not hand-edit generated facts in this file; update migrations, OpenAPI, docs, or the discovery script instead. Machine-readable output is committed at \`docs/surface-contract-discovery-status.json\`.\n\n## Purpose\n\nThis report automatically discovers new SQL-backed platform surfaces from migration files and checks whether the standard documentation targets mention the migration. It complements OpenAPI route autofill, which covers Express routes only.\n\n## Safety Contract\n\n- Executes provider calls: false\n- Reads credential payloads: false\n- Mutates runtime: false\n- Writes database: false\n- External sends: false\n- Deploys: false\n- Includes secrets: false\n- Output is documentation evidence only. It does not authorize tools, external sends, credential access, spend changes, provider calls, database writes, runtime mutation, or deployment.\n\n## Scope\n\n- Migrations with detected surfaces: ${report.migration_surface_count}\n- Migrations reported here: ${report.reported_count}\n- OpenAPI operations detected: ${report.openapi_operation_count}\n- OpenAPI paths detected: ${report.openapi_path_count}\n- Documentation targets checked:\n${listOrNone(report.documentation_targets, (target) => `\`${target}\``)}\n\n${renderCoverageSummary(report.coverage_summary)}\n\n## Latest Surface Coverage\n\n| Migration | Docs | Severity | Plugins | Tools | Views | Policies | Routes | OpenAPI route gaps |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n${rows.join("\n") || "| none | complete | none | 0 | 0 | 0 | 0 | 0 | 0 |"}\n\n## High-Risk Documentation Gaps\n\n${listOrNone(report.coverage_summary.high_risk_missing_docs.slice(0, 40), (name) => `\`${name}\``)}${report.coverage_summary.high_risk_missing_docs.length > 40 ? `\n- ...and ${report.coverage_summary.high_risk_missing_docs.length - 40} more` : ""}\n\n## SQL Route OpenAPI Gaps\n\n${listOrNone(report.coverage_summary.route_coverage.route_openapi_gaps.slice(0, 40), (entry) => `\`${entry.migration_file}\`: ${entry.missing_routes.map((route) => `\`${route}\``).join(", ")}`)}${report.coverage_summary.route_coverage.route_openapi_gaps.length > 40 ? `\n- ...and ${report.coverage_summary.route_coverage.route_openapi_gaps.length - 40} more` : ""}\n\n## Details\n\n${details.join("\n") || "No SQL-backed surfaces detected."}\n\n## Automation Contract\n\n- \`repo-maintenance-sync.mjs --write\` regenerates this report and \`docs/surface-contract-discovery-status.json\`.\n- \`openapi-auto-sync.yml\` opens a reviewable PR after route, migration, OpenAPI, docs, or surface-discovery script changes.\n- Autogenerated OpenAPI TODO stubs block auto-merge until a human contract review replaces them.\n- Docs-only report updates may auto-merge after CI if repository branch protection allows it.\n`;
}

function writeGeneratedOutputs(report, markdown) {
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, markdown);
  fs.writeFileSync(JSON_OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

function checkGeneratedOutputs(report, markdown) {
  const expectedJson = `${JSON.stringify(report, null, 2)}\n`;
  const currentMarkdown = readFileIfExists(OUTPUT_PATH);
  const currentJson = readFileIfExists(JSON_OUTPUT_PATH);
  const mismatches = [];
  if (currentMarkdown !== markdown) mismatches.push(path.relative(REPO_ROOT, OUTPUT_PATH));
  if (currentJson !== expectedJson) mismatches.push(path.relative(REPO_ROOT, JSON_OUTPUT_PATH));
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
    write,
    check,
    output: path.relative(REPO_ROOT, OUTPUT_PATH),
    json_output: path.relative(REPO_ROOT, JSON_OUTPUT_PATH),
    migration_surface_count: report.migration_surface_count,
    reported_count: report.reported_count,
    docs_completion_percent: report.coverage_summary.docs_completion_percent,
    high_risk_missing_docs: report.coverage_summary.gap_severity_counts.high,
    openapi_missing_sql_route_count: report.coverage_summary.route_coverage.openapi_missing_sql_route_count,
    secrets_included: false,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
