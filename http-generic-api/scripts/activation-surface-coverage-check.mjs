#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(API_DIR, "..");
const SURFACE_DIR = path.join(API_DIR, "activation-surfaces");
const EXCLUSION_DIR = path.join(SURFACE_DIR, "exclusions");
const MIGRATION_DIR = path.join(API_DIR, "migrations");
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SENSITIVE_PATTERN = /(secret|credential_ref|credential|token|password|private_key|cipher|api_key|value_ciphertext|value_sha|config_json)/i;
const CANDIDATE_NAME_PATTERN = /(membership|role_assignment|workspace|connected_system|installation|permission|grant|access|authorization|resource|entitlement|capability|connector|provider|tenant_tool|admin_tool|surface|binding)/i;
const CANDIDATE_COLUMN_PATTERN = /(^|_)(tenant_id|user_id|workspace_id|owner_id|resource_ref|resource_id|permission_key|installation_id|system_id|role|grant|scope)($|_)/i;

function parseArgs(argv = process.argv.slice(2)) {
  const args = { mode: "changed", strictGit: false, json: false };
  for (const arg of argv) {
    if (arg === "--all") args.mode = "all";
    else if (arg === "--changed") args.mode = "changed";
    else if (arg === "--strict-git") args.strictGit = true;
    else if (arg === "--json") args.json = true;
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function listJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => file.endsWith(".json")).sort().map((file) => path.join(dir, file));
}

function loadSurfaceIndex() {
  const bySurfaceKey = new Map();
  const bySourceTable = new Map();
  for (const filePath of listJsonFiles(SURFACE_DIR)) {
    const manifest = readJson(filePath);
    if (!SAFE_IDENTIFIER.test(String(manifest.surface_key || ""))) throw new Error(`Unsafe surface_key in ${filePath}`);
    if (!SAFE_IDENTIFIER.test(String(manifest.source_table || ""))) throw new Error(`Unsafe source_table in ${filePath}`);
    const coveredSourceTables = Array.isArray(manifest.covered_source_tables) ? manifest.covered_source_tables : [];
    for (const table of coveredSourceTables) {
      if (!SAFE_IDENTIFIER.test(String(table || ""))) throw new Error(`Unsafe covered_source_tables entry ${table} in ${filePath}`);
      if (SENSITIVE_PATTERN.test(String(table || ""))) throw new Error(`Sensitive covered source table name ${table} in ${filePath}`);
    }
    if (String(manifest.source_table || "").startsWith("v_activation_") && coveredSourceTables.length === 0) {
      throw new Error(`Activation view manifest ${manifest.surface_key} must declare covered_source_tables.`);
    }
    for (const column of manifest.result_columns || []) {
      if (!SAFE_IDENTIFIER.test(String(column || ""))) throw new Error(`Unsafe result column ${column} in ${filePath}`);
      if (SENSITIVE_PATTERN.test(String(column || ""))) throw new Error(`Sensitive result column ${column} in ${filePath}`);
    }
    if (manifest.include_for_tenant === true && !manifest.tenant_column && !manifest.user_column) {
      throw new Error(`Tenant-visible activation surface ${manifest.surface_key} requires tenant_column or user_column.`);
    }
    bySurfaceKey.set(manifest.surface_key, { filePath, manifest });
    bySourceTable.set(manifest.source_table, { filePath, manifest });
  }
  return { bySurfaceKey, bySourceTable };
}

function loadExclusionIndex() {
  const bySurfaceKey = new Map();
  const bySourceTable = new Map();
  for (const filePath of listJsonFiles(EXCLUSION_DIR)) {
    const exclusion = readJson(filePath);
    if (!exclusion.reason || String(exclusion.reason).trim().length < 20) throw new Error(`Activation exclusion ${filePath} requires a specific reason.`);
    if (!exclusion.owner) throw new Error(`Activation exclusion ${filePath} requires owner.`);
    if (SENSITIVE_PATTERN.test(JSON.stringify(exclusion))) throw new Error(`Activation exclusion ${filePath} contains sensitive-looking text.`);
    if (exclusion.surface_key) bySurfaceKey.set(exclusion.surface_key, { filePath, exclusion });
    if (exclusion.source_table) bySourceTable.set(exclusion.source_table, { filePath, exclusion });
  }
  return { bySurfaceKey, bySourceTable };
}

function tryGit(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function changedMigrationFiles(strictGit = false) {
  const bases = [];
  if (process.env.GITHUB_BASE_REF) bases.push(`origin/${process.env.GITHUB_BASE_REF}`);
  bases.push("origin/main", "main", "HEAD~1");
  for (const base of bases) {
    try {
      const output = tryGit(["diff", "--name-only", `${base}...HEAD`]);
      return output
        .split(/\r?\n/)
        .filter(Boolean)
        .filter((file) => file.startsWith("http-generic-api/migrations/") && file.endsWith(".sql"))
        .map((file) => path.join(REPO_ROOT, file));
    } catch {
      // try next base
    }
  }
  if (strictGit) throw new Error("Unable to compute changed migration files from git diff.");
  return [];
}

function allMigrationFiles() {
  return readdirSync(MIGRATION_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => path.join(MIGRATION_DIR, file));
}

function extractCreateTables(sql, filePath) {
  const tables = [];
  const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z_][A-Za-z0-9_]*)`?\s*\(([\s\S]*?)\)\s*(?:ENGINE|DEFAULT|;)/gi;
  let match;
  while ((match = regex.exec(sql)) !== null) {
    const table = match[1];
    const body = match[2] || "";
    const columns = [...body.matchAll(/^\s*`([A-Za-z_][A-Za-z0-9_]*)`\s+/gm)].map((m) => m[1]);
    tables.push({ table, columns, file: path.relative(REPO_ROOT, filePath) });
  }
  return tables;
}

function isCandidate(tableInfo) {
  if (CANDIDATE_NAME_PATTERN.test(tableInfo.table)) return true;
  return tableInfo.columns.some((column) => CANDIDATE_COLUMN_PATTERN.test(column));
}

function classifyCandidate(candidate, surfaces, exclusions) {
  if (surfaces.bySourceTable.has(candidate.table) || surfaces.bySurfaceKey.has(candidate.table)) return "manifested";
  if (exclusions.bySourceTable.has(candidate.table) || exclusions.bySurfaceKey.has(candidate.table)) return "excluded";
  return "missing_manifest_or_exclusion";
}

async function main() {
  const args = parseArgs();
  const surfaces = loadSurfaceIndex();
  const exclusions = loadExclusionIndex();
  const files = args.mode === "all" ? allMigrationFiles() : changedMigrationFiles(args.strictGit);
  const candidates = [];
  for (const filePath of files) {
    if (!existsSync(filePath)) continue;
    const sql = readFileSync(filePath, "utf8");
    for (const tableInfo of extractCreateTables(sql, filePath)) {
      if (!isCandidate(tableInfo)) continue;
      const classification = classifyCandidate(tableInfo, surfaces, exclusions);
      candidates.push({ ...tableInfo, classification });
    }
  }
  const missing = candidates.filter((candidate) => candidate.classification === "missing_manifest_or_exclusion");
  const summary = {
    ok: missing.length === 0,
    mode: args.mode,
    checked_migration_files: files.map((file) => path.relative(REPO_ROOT, file)),
    candidate_count: candidates.length,
    manifested_count: candidates.filter((candidate) => candidate.classification === "manifested").length,
    excluded_count: candidates.filter((candidate) => candidate.classification === "excluded").length,
    missing_count: missing.length,
    missing_candidates: missing.map((candidate) => ({ table: candidate.table, file: candidate.file, columns: candidate.columns.slice(0, 20) })),
    instruction: "Add http-generic-api/activation-surfaces/<surface_key>.json or an explicit exclusion under activation-surfaces/exclusions/.",
    external_provider_called: false,
    secrets_included: false,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.ok ? 0 : 2);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: { code: error.code || "activation_surface_coverage_check_failed", message: error.message }, secrets_included: false }, null, 2));
  process.exit(1);
});
