#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";
import {
  assessMigrationSqlPreflight,
  extractMigrationReadinessRequirementsFromSql,
} from "../releaseReadiness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(API_DIR, "migrations");

const ALLOWED_MIGRATIONS = new Set([
  "162_sprint66_cms_site_resource_access_grants.sql",
  "166_sprint65_ai_intelligence_runtime_governance.sql",
  "168_sprint65_database_table_lifecycle_governance.sql",
]);

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = { mode: "dry_run", migration: "", confirm: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (arg === "--dry-run") parsed.mode = "dry_run";
    else if (arg === "--apply") parsed.mode = "apply";
    else if (arg === "--migration") parsed.migration = String(argv[++i] || "");
    else if (arg.startsWith("--migration=")) parsed.migration = arg.slice("--migration=".length);
    else if (arg === "--confirm") parsed.confirm = String(argv[++i] || "");
    else if (arg.startsWith("--confirm=")) parsed.confirm = arg.slice("--confirm=".length);
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  return parsed;
}

function confirmationFor(filename = "") {
  return `APPLY_${String(filename).replace(/\.sql$/i, "").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
}

function stripSqlComments(sql = "") {
  return String(sql || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "");
}

function splitSqlStatements(sql = "") {
  const clean = stripSqlComments(sql);
  const statements = [];
  let start = 0;
  let inString = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inString) {
      if (ch === "'" && clean[i + 1] === "'") i += 1;
      else if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") {
      inString = true;
      continue;
    }
    if (ch === ";") {
      const statement = clean.slice(start, i).trim();
      if (statement) statements.push(statement);
      start = i + 1;
    }
  }
  const tail = clean.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

function artifactNames(requirements = {}) {
  return Object.fromEntries(
    Object.entries(requirements).map(([key, values]) => [key, Array.isArray(values) ? values.slice(0, 100) : []])
  );
}

async function existingSchemaObjects(names = []) {
  const wanted = [...new Set((names || []).filter(Boolean))];
  if (!wanted.length) return [];
  const [rows] = await getPool().query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?) ORDER BY table_name",
    [wanted]
  );
  return rows.map((row) => row.table_name);
}

async function applyStatements(statements = []) {
  const pool = getPool();
  const results = [];
  for (const statement of statements) {
    const [result] = await pool.query(statement);
    results.push({
      statement: statement.slice(0, 140),
      affectedRows: result?.affectedRows ?? null,
      changedRows: result?.changedRows ?? null,
      warningStatus: result?.warningStatus ?? null,
      insertId: result?.insertId ?? null,
    });
  }
  return results;
}

async function main() {
  const args = parseArgs();
  const migration = path.basename(args.migration || "");
  if (!migration) throw new Error("--migration is required.");
  if (!ALLOWED_MIGRATIONS.has(migration)) {
    throw new Error(`Migration is not allowlisted for governed runner: ${migration}`);
  }

  const migrationPath = path.join(MIGRATIONS_DIR, migration);
  const sql = await fs.readFile(migrationPath, "utf8");
  const preflight = assessMigrationSqlPreflight(migration, sql);
  const requirements = extractMigrationReadinessRequirementsFromSql(sql);
  const statements = splitSqlStatements(sql);
  const before_schema_objects = await existingSchemaObjects(requirements.schema_objects);

  if (preflight.status !== "pass") {
    console.log(JSON.stringify({
      ok: false,
      mode: args.mode,
      migration,
      blocked_reason: "preflight_not_pass",
      preflight,
      requirements: artifactNames(requirements),
      before_schema_objects,
      applies_sql: false,
      secrets_included: false,
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  if (args.mode !== "apply") {
    console.log(JSON.stringify({
      ok: true,
      mode: "dry_run",
      migration,
      applies_sql: false,
      preflight,
      statement_count: statements.length,
      requirements: artifactNames(requirements),
      before_schema_objects,
      required_confirmation: confirmationFor(migration),
      secrets_included: false,
    }, null, 2));
    return;
  }

  const requiredConfirm = confirmationFor(migration);
  if (args.confirm !== requiredConfirm) {
    throw new Error(`Apply requires --confirm=${requiredConfirm}`);
  }

  const results = await applyStatements(statements);
  const after_schema_objects = await existingSchemaObjects(requirements.schema_objects);

  console.log(JSON.stringify({
    ok: true,
    mode: "apply",
    migration,
    applies_sql: true,
    preflight,
    statements_executed: results.length,
    results,
    requirements: artifactNames(requirements),
    before_schema_objects,
    after_schema_objects,
    secrets_included: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error), secrets_included: false }, null, 2));
  process.exit(1);
});
