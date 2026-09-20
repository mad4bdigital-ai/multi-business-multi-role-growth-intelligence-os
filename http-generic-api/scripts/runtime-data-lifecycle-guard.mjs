#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitStatements } from "./staging-sql-parser.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(apiRoot, "..");
const contractPath = path.join(apiRoot, "config", "runtime-data-lifecycle-contract.json");
const roleManifestPath = path.join(apiRoot, "config", "staging-database-role-migration-manifest.json");
const migrationsDir = path.join(apiRoot, "migrations");
const importerPath = path.join(repoRoot, "autopilot-portable-staging", "Clone-StagingDatabases.Legacy.ps1");

const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const roleManifest = JSON.parse(fs.readFileSync(roleManifestPath, "utf8"));
const importer = fs.readFileSync(importerPath, "utf8");
const seedFiles = new Set(roleManifest.canonical_seed_lifecycle?.seed_files || []);
const exclusions = new Set((contract.enforcement?.legacy_exclusions || []).map((item) => item.file));
const findings = [];
const inventory = [];

function classify(table) {
  if (contract.datasets?.[table]) return contract.datasets[table];
  for (const family of contract.table_families || []) {
    if (new RegExp(family.pattern, "u").test(table)) return family;
  }
  return null;
}

function mutationTarget(statement) {
  const normalized = statement.replace(/^(?:(?:--[^\n]*\n)|(?:\/\*[\s\S]*?\*\/)|\s)*/u, "");
  const match = normalized.match(/^\s*(INSERT(?:\s+IGNORE)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))/iu);
  return match ? { operation: match[1].toUpperCase().replace(/\s+/gu, " "), table: String(match[2] || match[3]).toLowerCase() } : null;
}

if (contract.contract !== "mad4b.runtime-data-lifecycle.v1") findings.push({ category: "contract", detail: "unsupported lifecycle contract" });
if (contract.enforcement?.unclassified_mutation_is_blocking !== true) findings.push({ category: "contract", detail: "unclassified mutation gate is not fail-closed" });

for (const [table, dataset] of Object.entries(contract.datasets || {})) {
  for (const row of dataset.canonical_rows || []) {
    const seedPath = path.join(migrationsDir, row.seed_file || "");
    if (!seedFiles.has(row.seed_file)) findings.push({ category: "canonical_seed_not_replayable", table, file: row.seed_file });
    if (!fs.existsSync(seedPath)) findings.push({ category: "canonical_seed_missing", table, file: row.seed_file });
    else {
      const sql = fs.readFileSync(seedPath, "utf8");
      for (const token of row.selector_tokens || []) if (!sql.includes(token)) findings.push({ category: "canonical_selector_missing", table, file: row.seed_file, token });
    }
    if (row.cardinality !== "exactly_one" || !row.readback_token || !importer.includes(row.readback_token) || !importer.includes("Assert-CountExactly")) {
      findings.push({ category: "canonical_postcondition_missing", table, file: row.seed_file });
    }
  }
}

const floor = String(contract.enforcement?.dated_migration_floor || "");
for (const file of fs.readdirSync(migrationsDir).filter((name) => /^20\d{6}_.+\.sql$/u.test(name)).sort()) {
  const date = file.slice(0, 8);
  if (date < floor || exclusions.has(file)) continue;
  const statements = splitStatements(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
  for (const statement of statements) {
    const mutation = mutationTarget(statement);
    if (!mutation) continue;
    const dataset = classify(mutation.table);
    inventory.push({ file, ...mutation, lifecycle_class: dataset?.class || null });
    if (!dataset) findings.push({ category: "unclassified_runtime_data_mutation", file, ...mutation });
    if (dataset?.reseed_forbidden === true && seedFiles.has(file)) findings.push({ category: "operational_state_reseed_forbidden", file, ...mutation });
    if (["canonical_registry", "mixed"].includes(dataset?.class) && !seedFiles.has(file)) findings.push({ category: "canonical_runtime_data_not_replayable", file, ...mutation });
  }
}

const report = {
  contract: "mad4b.runtime-data-lifecycle-guard.v1",
  ok: findings.length === 0,
  lifecycle_contract: contract.contract,
  dated_migration_floor: floor,
  mutations_checked: inventory.length,
  inventory,
  findings,
  known_replay_gaps: Object.entries(contract.datasets || {}).filter(([, value]) => value.known_replay_gap === true).map(([table]) => table),
  safety: contract.safety,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
