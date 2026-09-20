#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
const findings = [];
const inventory = [];

function git(...args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

export function migrationPathsFromDiff(output) {
  return [...new Set(String(output || "").split(/\r?\n/u)
    .map((item) => item.trim().replaceAll("\\", "/"))
    .filter((item) => /^http-generic-api\/migrations\/[^/]+\.sql$/u.test(item))
    .map((item) => path.posix.basename(item)))].sort();
}

if (process.argv.includes("--self-test")) {
  const selected = migrationPathsFromDiff([
    "http-generic-api/migrations/1053_numeric_runtime_authority.sql",
    "http-generic-api/migrations/20260920_dated_runtime_authority.sql",
    "http-generic-api/runtimeVerificationService.js",
  ].join("\n"));
  if (JSON.stringify(selected) !== JSON.stringify(["1053_numeric_runtime_authority.sql", "20260920_dated_runtime_authority.sql"])) {
    throw new Error("changed migration selection must be naming-convention agnostic");
  }
  console.log(JSON.stringify({ ok: true, numeric_and_dated_migrations_selected: true }));
  process.exit(0);
}

function resolveBaseSha() {
  const explicit = argument("--base-sha") || process.env.RUNTIME_DATA_LIFECYCLE_BASE_SHA;
  if (explicit && /^[0-9a-f]{40}$/iu.test(explicit)) return explicit.toLowerCase();
  try { return git("rev-parse", "HEAD^"); } catch { return null; }
}

const baseSha = resolveBaseSha();
let selectedFiles = [];
let selectionMode = "unresolved_base";
if (baseSha) {
  try {
    selectedFiles = migrationPathsFromDiff(git("diff", "--name-only", "--diff-filter=ACMR", `${baseSha}...HEAD`, "--", "http-generic-api/migrations/*.sql"));
    selectionMode = "git_diff";
  } catch (error) {
    findings.push({ category: "migration_selection_failed", base_sha: baseSha, detail: String(error?.message || error) });
  }
} else {
  findings.push({ category: "migration_base_sha_missing", detail: "A base commit is required for fail-closed changed-migration classification." });
}

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

for (const file of selectedFiles) {
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
  selection: { mode: selectionMode, base_sha: baseSha, files: selectedFiles },
  mutations_checked: inventory.length,
  inventory,
  findings,
  known_replay_gaps: Object.entries(contract.datasets || {}).filter(([, value]) => value.known_replay_gap === true).map(([table]) => table),
  safety: contract.safety,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
