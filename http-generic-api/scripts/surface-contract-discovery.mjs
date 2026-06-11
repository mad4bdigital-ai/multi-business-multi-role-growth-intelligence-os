#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const API_ROOT = process.cwd();
const REPO_ROOT = path.resolve(API_ROOT, "..");
const MIGRATIONS_DIR = path.join(API_ROOT, "migrations");
const OPENAPI_PATH = path.join(API_ROOT, "openapi.yaml");
const OUTPUT_PATH = path.join(REPO_ROOT, "docs", "surface-contract-discovery-status.md");
const DOC_TARGETS = [
  "Updating Registry Patch Index.md",
  "deployment_parity_checklist.md",
  "docs/ai-docs-agent-governance.md",
  "docs/auto-docs-agent/README.md",
  "docs/change-documentation-governance.md",
];
const METHODS = new Set(["get", "post", "put", "patch", "delete"]);

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

function collectOpenapiPaths() {
  if (!fs.existsSync(OPENAPI_PATH)) return [];
  try {
    const doc = YAML.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
    const out = [];
    for (const [pathKey, item] of Object.entries(doc.paths || {})) {
      for (const method of Object.keys(item || {})) {
        if (METHODS.has(method)) out.push(`${method.toUpperCase()} ${pathKey}`);
      }
    }
    return unique(out);
  } catch {
    return [];
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
  return surfaces.routes.length || surfaces.views.length || surfaces.policies.length || surfaces.plugins.length || surfaces.tools.length;
}

export function discoverSurfaces({ limit = 80 } = {}) {
  const docsByPath = Object.fromEntries(DOC_TARGETS.map((rel) => [rel, readFileIfExists(path.join(REPO_ROOT, rel))]));
  const openapiOps = collectOpenapiPaths();
  const migrations = listMigrationFiles()
    .map((name) => {
      const source = readFileIfExists(path.join(MIGRATIONS_DIR, name));
      const surfaces = extractSurfaces(source);
      const docs = docsCoverageFor(name, docsByPath);
      const missingDocs = Object.entries(docs).filter(([, covered]) => !covered).map(([target]) => target);
      return {
        migration_file: name,
        surfaces,
        docs,
        missing_docs: missingDocs,
        documentation_complete: missingDocs.length === 0,
      };
    })
    .filter((entry) => hasAnySurface(entry.surfaces));

  const latest = migrations.slice(-limit).reverse();
  return {
    ok: true,
    migration_surface_count: migrations.length,
    reported_count: latest.length,
    openapi_operation_count: openapiOps.length,
    openapi_operations: openapiOps,
    documentation_targets: DOC_TARGETS,
    migrations: latest,
    safety: {
      executes_provider_calls: false,
      reads_credentials: false,
      mutates_runtime: false,
      writes_database: false,
      secrets_included: false,
    },
  };
}

function listOrNone(items = [], formatter = (x) => x) {
  if (!items.length) return "- none";
  return items.map((item) => `- ${formatter(item)}`).join("\n");
}

function boolIcon(value) { return value ? "yes" : "no"; }

export function renderSurfaceContractMarkdown(report) {
  const rows = report.migrations.map((entry) => {
    const s = entry.surfaces;
    return `| \`${entry.migration_file}\` | ${entry.documentation_complete ? "complete" : "needs docs"} | ${s.plugins.length} | ${s.tools.length} | ${s.views.length} | ${s.policies.length} | ${s.routes.length} |`;
  });
  const details = report.migrations.map((entry) => {
    const s = entry.surfaces;
    return `### \`${entry.migration_file}\`\n\n- Documentation complete: ${boolIcon(entry.documentation_complete)}\n- Missing docs: ${entry.missing_docs.length ? entry.missing_docs.map((d) => `\`${d}\``).join(", ") : "none"}\n- Plugins: ${s.plugins.length ? s.plugins.map((x) => `\`${x}\``).join(", ") : "none"}\n- Tools: ${s.tools.length ? s.tools.slice(0, 20).map((x) => `\`${x}\``).join(", ") : "none"}${s.tools.length > 20 ? `, ...and ${s.tools.length - 20} more` : ""}\n- Views: ${s.views.length ? s.views.map((x) => `\`${x}\``).join(", ") : "none"}\n- Policies: ${s.policies.length ? s.policies.map((x) => `\`${x}\``).join(", ") : "none"}\n- Routes: ${s.routes.length ? s.routes.map((x) => `\`${x}\``).join(", ") : "none"}\n- Safety markers: no_provider_call=${boolIcon(s.safety.no_provider_call)}, no_credential_payload_read=${boolIcon(s.safety.no_credential_payload_read)}, no_raw_secrets=${boolIcon(s.safety.no_raw_secrets)}, no_external_send=${boolIcon(s.safety.no_external_send)}, no_external_write=${boolIcon(s.safety.no_external_write)}, secrets_included_false=${boolIcon(s.safety.secrets_included_false)}\n`;
  });
  return `# Surface Contract Discovery Status\n\n> Generated by \`http-generic-api/scripts/surface-contract-discovery.mjs\`. Do not hand-edit generated facts in this file; update migrations, OpenAPI, docs, or the discovery script instead.\n\n## Purpose\n\nThis report automatically discovers new SQL-backed platform surfaces from migration files and checks whether the standard documentation targets mention the migration. It complements OpenAPI route autofill, which covers Express routes only.\n\n## Safety Contract\n\n- Executes provider calls: false\n- Reads credential payloads: false\n- Mutates runtime: false\n- Writes database: false\n- Includes secrets: false\n- Output is documentation evidence only. It does not authorize tools, external sends, credential access, spend changes, provider calls, or deployment.\n\n## Scope\n\n- Migrations with detected surfaces: ${report.migration_surface_count}\n- Migrations reported here: ${report.reported_count}\n- OpenAPI operations detected: ${report.openapi_operation_count}\n- Documentation targets checked:\n${listOrNone(report.documentation_targets, (target) => `\`${target}\``)}\n\n## Latest Surface Coverage\n\n| Migration | Docs | Plugins | Tools | Views | Policies | Routes |\n|---|---:|---:|---:|---:|---:|---:|\n${rows.join("\n") || "| none | complete | 0 | 0 | 0 | 0 | 0 |"}\n\n## Details\n\n${details.join("\n") || "No SQL-backed surfaces detected."}\n\n## Automation Contract\n\n- \`repo-maintenance-sync.mjs --write\` regenerates this report.\n- \`openapi-auto-sync.yml\` opens a reviewable PR after route, migration, OpenAPI, docs, or surface-discovery script changes.\n- Autogenerated OpenAPI TODO stubs block auto-merge until a human contract review replaces them.\n- Docs-only report updates may auto-merge after CI if repository branch protection allows it.\n`;
}

function main() {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  const report = discoverSurfaces();
  const markdown = renderSurfaceContractMarkdown(report);
  if (write) {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, markdown);
  }
  if (check && fs.existsSync(OUTPUT_PATH)) {
    const current = fs.readFileSync(OUTPUT_PATH, "utf8");
    if (current !== markdown) {
      console.error("surface-contract-discovery: generated status is not committed.");
      process.exit(1);
    }
  }
  console.log(JSON.stringify({ ok: true, write, check, output: path.relative(REPO_ROOT, OUTPUT_PATH), migration_surface_count: report.migration_surface_count, reported_count: report.reported_count, secrets_included: false }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
