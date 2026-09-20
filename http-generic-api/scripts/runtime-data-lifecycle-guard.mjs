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

function stripLeadingComments(statement) {
  return String(statement || "").replace(/^(?:(?:--[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/)|\s)*/u, "");
}

const operationPattern = [
  "INSERT(?:\\s+(?:LOW_PRIORITY|DELAYED|HIGH_PRIORITY|IGNORE))*\\s+INTO",
  "REPLACE(?:\\s+(?:LOW_PRIORITY|DELAYED))*\\s+INTO",
  "UPDATE(?:\\s+(?:LOW_PRIORITY|IGNORE))*",
  "DELETE(?:\\s+(?:LOW_PRIORITY|QUICK|IGNORE))*\\s+FROM",
  "TRUNCATE(?:\\s+TABLE)?",
].join("|");
const targetPattern = "(?:`([^`]+)`|([A-Za-z0-9_$]+))";
const directMutationPattern = new RegExp("^\\s*(" + operationPattern + ")\\s+" + targetPattern, "iu");
const cteMutationPattern = new RegExp("\\)\\s*(" + operationPattern + ")\\s+" + targetPattern, "iu");

export function mutationTarget(statement) {
  const normalized = stripLeadingComments(statement);
  let match = normalized.match(directMutationPattern);
  if (!match && /^WITH\b/iu.test(normalized)) match = normalized.match(cteMutationPattern);
  return match ? {
    operation: match[1].toUpperCase().replace(/\s+/gu, " "),
    table: String(match[2] || match[3]).toLowerCase(),
  } : null;
}

function hasUnparsedMutationIntent(statement) {
  const normalized = stripLeadingComments(statement);
  if (/^(?:INSERT|REPLACE|UPDATE|DELETE|TRUNCATE)\b/iu.test(normalized)) return true;
  return /^WITH\b/iu.test(normalized) && /\)\s*(?:INSERT|REPLACE|UPDATE|DELETE|TRUNCATE)\b/iu.test(normalized);
}

function classify(table) {
  if (contract.datasets?.[table]) return contract.datasets[table];
  for (const family of contract.table_families || []) {
    if (new RegExp(family.pattern, "u").test(table)) return family;
  }
  return null;
}

function stripSqlComments(statement) {
  const source = String(statement || "");
  let output = "";
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      output += char;
      if (char === "\\" && next) {
        output += next;
        index += 1;
        continue;
      }
      if (char === quote) {
        if (quote === "'" && next === "'") {
          output += next;
          index += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      output += char;
      continue;
    }
    if (char === "-" && next === "-") {
      while (index < source.length && source[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (char === "#") {
      while (index < source.length && source[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 1;
      output += " ";
      continue;
    }
    output += char;
  }
  return output;
}

function leadingCommentPrefix(statement) {
  return String(statement || "").match(/^(?:(?:\s*--[^\n]*(?:\n|$))|(?:\s*#[^\n]*(?:\n|$))|(?:\s*\/\*[\s\S]*?\*\/)|\s)*/u)?.[0] || "";
}

function escapeRegex(value) {
  return String(value).replace(/[\^$.*+?()[\]{}|\\]/gu, "\\$&");
}

function sqlLiteral(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

function equalityPredicatePresent(clause, column, value) {
  const columnPattern = "(?:`" + escapeRegex(column) + "`|" + escapeRegex(column) + ")";
  const literalPattern = escapeRegex(sqlLiteral(value));
  return new RegExp("(?:^|[^A-Za-z0-9_$])" + columnPattern + "\\s*=\\s*" + literalPattern + "(?=$|[^A-Za-z0-9_$])", "iu").test(clause);
}

function canonicalRowMutationMatches(statement, row, file, mutation) {
  const selector = row?.mutation_selector;
  if (!selector || selector.mode !== "seed_file_and_exact_selector") return false;
  if (!file || file !== row.seed_file) return false;
  const normalized = stripSqlComments(statement);
  const operation = String(mutation?.operation || "");

  if (operation.startsWith("UPDATE")) {
    const whereMatch = normalized.match(/\bWHERE\b([\s\S]*)$/iu);
    if (!whereMatch || /\bOR\b/iu.test(whereMatch[1])) return false;
    const requiredEquals = Object.entries(selector.update_where_equals || {});
    return requiredEquals.length > 0
      && requiredEquals.every(([column, value]) => equalityPredicatePresent(whereMatch[1], column, value));
  }

  if (operation.startsWith("INSERT")) {
    const guardIndex = normalized.search(/\bWHERE\s+NOT\s+EXISTS\s*\(/iu);
    if (guardIndex < 0) return false;
    const insertSegment = normalized.slice(0, guardIndex);
    const guardSegment = normalized.slice(guardIndex);
    if (/\bFROM\b/iu.test(insertSegment)) return false;
    if ((selector.insert_forbidden_tokens || []).some((token) => new RegExp("\\b" + escapeRegex(token) + "\\b", "iu").test(normalized))) return false;
    const columnsMatch = insertSegment.match(/^\s*INSERT(?:\s+(?:LOW_PRIORITY|DELAYED|HIGH_PRIORITY|IGNORE))*\s+INTO\s+`?workspace_registry`?\s*\(([^)]*)\)\s*SELECT\b/iu);
    if (!columnsMatch) return false;
    const columns = columnsMatch[1].split(",").map((value) => value.trim().replaceAll("`", ""));
    if (JSON.stringify(columns) !== JSON.stringify(selector.insert_columns || [])) return false;
    if (!(selector.insert_required_literals || []).every((value) => normalized.includes(sqlLiteral(value)))) return false;
    const guardEquals = Object.entries(selector.insert_guard_equals || {});
    return guardEquals.length > 0
      && guardEquals.every(([column, value]) => equalityPredicatePresent(guardSegment, column, value));
  }

  return false;
}

export function resolveMutationLifecycle(statement, dataset, { file = null, mutation = mutationTarget(statement) } = {}) {
  if (!dataset) return { lifecycle_class: null, resolution: "unclassified" };
  if (dataset.class !== "mixed") return { lifecycle_class: dataset.class, resolution: "dataset" };

  for (const row of dataset.canonical_rows || []) {
    if (canonicalRowMutationMatches(statement, row, file, mutation)) {
      return { lifecycle_class: "canonical_registry", resolution: "canonical_seed_exact_selector", canonical_row: row.key };
    }
  }

  const annotation = String(dataset.environment_annotation || "").trim();
  if (annotation && leadingCommentPrefix(statement).includes(annotation)) {
    return { lifecycle_class: "environment_state", resolution: "explicit_environment_annotation" };
  }

  return { lifecycle_class: "mixed_unresolved", resolution: "fail_closed" };
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

  const cte = mutationTarget("WITH x AS (SELECT 1) UPDATE workspace_registry SET bootstrap_status='ready' WHERE workspace_key='platform_repo_governance_zero'");
  const truncate = mutationTarget("TRUNCATE TABLE customer_sessions");
  const replace = mutationTarget("REPLACE INTO connected_systems (system_id) VALUES ('x')");
  if (cte?.table !== "workspace_registry" || truncate?.table !== "customer_sessions" || replace?.table !== "connected_systems") {
    throw new Error("mutation parser must classify CTE and destructive top-level mutations");
  }

  if (contract.enforcement?.operational_state_migration_mutation_forbidden !== true ||
      contract.enforcement?.environment_state_migration_mutation_forbidden !== true ||
      contract.enforcement?.destructive_mutation_fail_closed !== true) {
    throw new Error("state mutation safety policy must be fail-closed");
  }

  const mixed = contract.datasets.workspace_registry;
  const canonicalFile = mixed.canonical_rows[0].seed_file;
  const canonical = resolveMutationLifecycle(
    "UPDATE workspace_registry SET updated_at=NOW() WHERE workspace_id='b50db01b-617e-4b7a-8bda-6bf4876f754f' AND tenant_id='00000000-0000-0000-0000-000000000000' AND workspace_key='platform_repo_governance_zero' AND display_name='Platform Admin' AND workspace_type='brand' AND bootstrap_status='ready'",
    mixed,
    { file: canonicalFile },
  );
  const commentBypass = resolveMutationLifecycle("-- platform_repo_governance_zero\nUPDATE workspace_registry SET bootstrap_status='ready'", mixed, { file: canonicalFile });
  const wrongFile = resolveMutationLifecycle(
    "UPDATE workspace_registry SET updated_at=NOW() WHERE workspace_id='b50db01b-617e-4b7a-8bda-6bf4876f754f' AND tenant_id='00000000-0000-0000-0000-000000000000' AND workspace_key='platform_repo_governance_zero' AND display_name='Platform Admin' AND workspace_type='brand' AND bootstrap_status='ready'",
    mixed,
    { file: "20260920_unreviewed_workspace_mutation.sql" },
  );
  const broadSelector = resolveMutationLifecycle("UPDATE workspace_registry SET workspace_key='platform_repo_governance_zero'", mixed, { file: canonicalFile });
  const environment = resolveMutationLifecycle("-- lifecycle:environment_state\nUPDATE workspace_registry SET updated_at=NOW() WHERE workspace_id='tenant-workspace'", mixed, { file: "environment-state-change.sql" });
  const unresolved = resolveMutationLifecycle("UPDATE workspace_registry SET updated_at=NOW()", mixed, { file: canonicalFile });
  if (canonical.lifecycle_class !== "canonical_registry"
      || commentBypass.lifecycle_class !== "mixed_unresolved"
      || wrongFile.lifecycle_class !== "mixed_unresolved"
      || broadSelector.lifecycle_class !== "mixed_unresolved"
      || environment.lifecycle_class !== "environment_state"
      || unresolved.lifecycle_class !== "mixed_unresolved") {
    throw new Error("mixed-table lifecycle resolution must require the canonical seed file plus an exact selector and reject token/comment bypasses");
  }

  if (usableCommitSha("0".repeat(40))) {
    throw new Error("all-zero GitHub before SHA must never be treated as a usable base");
  }

  console.log(JSON.stringify({
    ok: true,
    numeric_and_dated_migrations_selected: true,
    cte_mutation_classified: true,
    truncate_mutation_classified: true,
    mixed_table_fail_closed: true,
    mixed_table_comment_token_bypass_rejected: true,
    mixed_table_wrong_file_canonical_rejected: true,
    mixed_table_broad_selector_rejected: true,
    zero_base_sha_rejected: true,
    migration_deletion_is_blocking: true,
    runtime_state_migration_mutation_forbidden: true,
    destructive_runtime_mutation_forbidden: true,
  }));
  process.exit(0);
}

function usableCommitSha(value) {
  return /^[0-9a-f]{40}$/iu.test(String(value || "")) && !/^0{40}$/u.test(String(value || ""));
}

function resolveBaseSha() {
  const explicit = argument("--base-sha") || process.env.RUNTIME_DATA_LIFECYCLE_BASE_SHA;
  if (usableCommitSha(explicit)) return String(explicit).toLowerCase();

  for (const candidate of [
    ["merge-base", "HEAD", "origin/main"],
    ["rev-parse", "HEAD^"],
  ]) {
    try {
      const resolved = git(...candidate);
      if (usableCommitSha(resolved)) return resolved.toLowerCase();
    } catch {
      // Keep resolving through the bounded local Git fallbacks.
    }
  }
  return null;
}

const baseSha = resolveBaseSha();
let selectedFiles = [];
let selectionMode = "unresolved_base";
if (baseSha) {
  try {
    selectedFiles = migrationPathsFromDiff(git("diff", "--name-only", "--diff-filter=ACMRD", `${baseSha}...HEAD`, "--", "http-generic-api/migrations/*.sql"));
    selectionMode = "git_diff";
  } catch (error) {
    findings.push({ category: "migration_selection_failed", base_sha: baseSha, detail: String(error?.message || error) });
  }
} else {
  findings.push({ category: "migration_base_sha_missing", detail: "A base commit is required for fail-closed changed-migration classification." });
}

if (contract.contract !== "mad4b.runtime-data-lifecycle.v1") findings.push({ category: "contract", detail: "unsupported lifecycle contract" });
if (contract.enforcement?.unclassified_mutation_is_blocking !== true) findings.push({ category: "contract", detail: "unclassified mutation gate is not fail-closed" });
if (contract.enforcement?.mixed_table_mutation_requires_resolution !== true) findings.push({ category: "contract", detail: "mixed-table mutation resolution is not fail-closed" });
if (contract.enforcement?.operational_state_migration_mutation_forbidden !== true) findings.push({ category: "contract", detail: "operational-state migration mutation guard is not fail-closed" });
if (contract.enforcement?.environment_state_migration_mutation_forbidden !== true) findings.push({ category: "contract", detail: "environment-state migration mutation guard is not fail-closed" });
if (contract.enforcement?.destructive_mutation_fail_closed !== true) findings.push({ category: "contract", detail: "destructive mutation guard is not fail-closed" });

for (const [table, dataset] of Object.entries(contract.datasets || {})) {
  for (const row of dataset.canonical_rows || []) {
    const seedPath = path.join(migrationsDir, row.seed_file || "");
    if (!seedFiles.has(row.seed_file)) findings.push({ category: "canonical_seed_not_replayable", table, file: row.seed_file });
    if (!fs.existsSync(seedPath)) findings.push({ category: "canonical_seed_missing", table, file: row.seed_file });
    else {
      const sql = fs.readFileSync(seedPath, "utf8");
      for (const token of row.selector_tokens || []) {
        if (!sql.includes(token)) findings.push({ category: "canonical_selector_missing", table, file: row.seed_file, token });
      }
    }
    if (row.cardinality !== "exactly_one" || !row.readback_token || !importer.includes(row.readback_token) || !importer.includes("Assert-CountExactly")) {
      findings.push({ category: "canonical_postcondition_missing", table, file: row.seed_file });
    }
    if (row.resolver_cardinality) {
      const resolver = row.resolver_cardinality;
      if (resolver.cardinality !== "exactly_one"
          || resolver.require_ready !== true
          || !resolver.readback_token
          || !importer.includes(resolver.readback_token)) {
        findings.push({ category: "canonical_resolver_postcondition_missing", table, file: row.seed_file });
      }
    }
  }
}

for (const file of selectedFiles) {
  const migrationPath = path.join(migrationsDir, file);
  if (!fs.existsSync(migrationPath)) {
    findings.push({ category: "migration_removed_from_history", file });
    continue;
  }
  const statements = splitStatements(fs.readFileSync(migrationPath, "utf8"));
  for (const statement of statements) {
    const mutation = mutationTarget(statement);
    if (!mutation) {
      if (hasUnparsedMutationIntent(statement)) {
        findings.push({ category: "unsupported_data_mutation_shape", file, statement_prefix: stripLeadingComments(statement).slice(0, 120) });
      }
      continue;
    }

    const dataset = classify(mutation.table);
    const lifecycle = resolveMutationLifecycle(statement, dataset, { file, mutation });
    inventory.push({ file, ...mutation, lifecycle_class: lifecycle.lifecycle_class, lifecycle_resolution: lifecycle.resolution, canonical_row: lifecycle.canonical_row || null });

    if (!dataset) {
      findings.push({ category: "unclassified_runtime_data_mutation", file, ...mutation });
      continue;
    }
    if (lifecycle.lifecycle_class === "mixed_unresolved") {
      findings.push({ category: "mixed_runtime_data_mutation_unresolved", file, ...mutation });
      continue;
    }
    if (contract.enforcement?.destructive_mutation_fail_closed === true &&
        /^(?:DELETE|TRUNCATE|REPLACE)/u.test(mutation.operation)) {
      findings.push({ category: "destructive_runtime_data_mutation_forbidden", file, ...mutation });
      continue;
    }
    if (lifecycle.lifecycle_class === "operational_state" && contract.enforcement?.operational_state_migration_mutation_forbidden === true) {
      findings.push({ category: "operational_state_migration_mutation_forbidden", file, ...mutation });
      continue;
    }
    if (lifecycle.lifecycle_class === "environment_state" && contract.enforcement?.environment_state_migration_mutation_forbidden === true) {
      findings.push({ category: "environment_state_migration_mutation_forbidden", file, ...mutation });
      continue;
    }
    if (dataset.reseed_forbidden === true && seedFiles.has(file)) {
      findings.push({ category: "operational_state_reseed_forbidden", file, ...mutation });
    }
    if (lifecycle.lifecycle_class === "canonical_registry" && !seedFiles.has(file)) {
      findings.push({ category: "canonical_runtime_data_not_replayable", file, ...mutation });
    }
  }
}

const knownReplayGapDatasets = Object.entries(contract.datasets || {})
  .filter(([, value]) => value.known_replay_gap === true)
  .map(([table]) => table);
const knownReplayGapFamilies = (contract.table_families || [])
  .filter((value) => value.known_replay_gap === true)
  .map((value) => value.pattern);
const knownReplayGaps = [
  ...knownReplayGapDatasets,
  ...knownReplayGapFamilies.map((pattern) => `family:${pattern}`),
];

const semanticDurabilityStatus = findings.length > 0
  ? "blocked"
  : knownReplayGaps.length > 0
    ? "partial_known_historical_replay_gaps"
    : "declared_contract_complete";

const report = {
  contract: "mad4b.runtime-data-lifecycle-guard.v1",
  ok: findings.length === 0,
  lifecycle_contract: contract.contract,
  semantic_durability_status: semanticDurabilityStatus,
  fresh_rebuild_semantic_complete: findings.length === 0 && knownReplayGaps.length === 0,
  selection: { mode: selectionMode, base_sha: baseSha, files: selectedFiles },
  mutations_checked: inventory.length,
  inventory,
  findings,
  known_replay_gaps: knownReplayGaps,
  known_replay_gap_datasets: knownReplayGapDatasets,
  known_replay_gap_families: knownReplayGapFamilies,
  safety: contract.safety,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
