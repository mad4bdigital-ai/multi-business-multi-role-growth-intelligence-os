#!/usr/bin/env node
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function parseRoot(argv) {
  if (argv.length === 0) return process.cwd();
  if (argv.length === 1 && argv[0].startsWith("--root=")) return argv[0].slice("--root=".length);
  if (argv.length === 2 && argv[0] === "--root") return argv[1];
  throw new Error("Usage: node scripts/migration-placement-guard.mjs [--root <repo-root>]");
}

const repoRoot = parseRoot(process.argv.slice(2));
const rootEntries = readdirSync(repoRoot);
const rootMigrationPattern = /^\d{4}_[A-Za-z0-9._-]+\.sql$/;
const misplaced = [];

for (const entry of rootEntries) {
  const fullPath = join(repoRoot, entry);
  if (!statSync(fullPath).isFile()) continue;
  if (rootMigrationPattern.test(entry)) {
    misplaced.push(entry);
  }
}

if (misplaced.length > 0) {
  console.error("Misplaced governed migration seed files detected at repository root:");
  for (const file of misplaced) {
    console.error(`- ${file}`);
  }
  console.error("");
  console.error("Move numbered SQL migration/seed files to http-generic-api/migrations/ so the governed migration runner can resolve them.");
  console.error("Root-level numbered SQL files cause post-merge migration authorization to fail with ENOENT.");
  process.exit(1);
}

console.log("Migration placement guard passed: no numbered SQL migration files at repository root.");
