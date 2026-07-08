#!/usr/bin/env node

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");

const args = new Set(process.argv.slice(2));
const failOnRegression = args.has("--fail-on-regression");
const json = args.has("--json");
const maxRootEntries = Number(process.env.HTTP_GENERIC_API_MAX_ROOT_ENTRIES || 1000);
const regressionCeiling = Number(process.env.HTTP_GENERIC_API_ROOT_ENTRY_CEILING || 1016);

const keepRoot = new Set([
  ".gcloudignore",
  "Dockerfile",
  "README.md",
  "config.js",
  "db.js",
  "server.js",
  "package.json",
  "package-lock.json",
  "docker-compose.yml",
  "schema.sql",
  "openapi.yaml",
]);

function classify(entry) {
  if (keepRoot.has(entry.name)) return "root_entrypoint_or_manifest";
  if (entry.isDirectory) return "subdirectory";
  if (/^test-.*\.mjs$/i.test(entry.name)) return "test_candidate";
  if (/\.test\.|\.spec\./i.test(entry.name)) return "test_candidate";
  if (/^(migrate|patch|seed|smoke|audit|check|generate|get|recover|rotate|sanitize|sync|reauth|reconcile)-.*\.(mjs|js|ps1)$/i.test(entry.name)) return "script_candidate";
  if (/Service\.js$/.test(entry.name)) return "service_candidate";
  if (/Resolver\.js$/.test(entry.name)) return "resolver_candidate";
  if (/\.ya?ml$/i.test(entry.name) && entry.name !== "openapi.yaml") return "openapi_candidate";
  if (/\.json$/i.test(entry.name)) return "data_or_manifest_candidate";
  return "source_candidate";
}

const entries = readdirSync(apiRoot).map((name) => {
  const full = path.join(apiRoot, name);
  const stat = statSync(full);
  return {
    name,
    path: `http-generic-api/${name}`,
    type: stat.isDirectory() ? "directory" : "file",
    size: stat.isDirectory() ? null : stat.size,
    isDirectory: stat.isDirectory(),
  };
}).sort((a, b) => a.name.localeCompare(b.name));

const byClass = {};
for (const entry of entries) {
  const cls = classify(entry);
  byClass[cls] = (byClass[cls] || 0) + 1;
  entry.classification = cls;
}

const report = {
  ok: entries.length <= maxRootEntries,
  root: "http-generic-api",
  root_entry_count: entries.length,
  max_root_entries: maxRootEntries,
  regression_ceiling: regressionCeiling,
  github_web_ui_truncation_risk: entries.length > 1000,
  by_class: byClass,
  recommended_order: [
    "script_candidate -> scripts/legacy-root-tools or scripts/",
    "test_candidate -> tests/ with import rewrite",
    "openapi_candidate -> openapi/",
    "service_candidate -> services/ or src/application/",
    "resolver_candidate -> resolvers/ or src/application/",
    "source_candidate -> domain/application/infrastructure by ownership",
  ],
  sample_candidates: entries.filter((entry) => !["root_entrypoint_or_manifest", "subdirectory"].includes(entry.classification)).slice(0, 100),
  secrets_included: false,
};

if (json) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`http-generic-api root entries: ${report.root_entry_count}`);
  console.log(`GitHub UI truncation risk: ${report.github_web_ui_truncation_risk ? "yes" : "no"}`);
  console.log(JSON.stringify(report.by_class, null, 2));
}

if (failOnRegression && entries.length > regressionCeiling) {
  console.error(`Root fanout regression: ${entries.length} > ${regressionCeiling}`);
  process.exit(1);
}

if (entries.length > maxRootEntries) process.exitCode = 0;
