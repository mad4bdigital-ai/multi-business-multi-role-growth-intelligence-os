import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

function runGuard(root) {
  return spawnSync(process.execPath, ["scripts/migration-placement-guard.mjs", "--root", root], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

const cleanRoot = mkdtempSync(join(tmpdir(), "migration-placement-clean-"));
const badRoot = mkdtempSync(join(tmpdir(), "migration-placement-bad-"));

try {
  mkdirSync(join(cleanRoot, "http-generic-api", "migrations"), { recursive: true });
  writeFileSync(join(cleanRoot, "http-generic-api", "migrations", "1030_valid_seed.sql"), "SELECT 1;\n");
  const clean = runGuard(cleanRoot);
  assert.equal(clean.status, 0, clean.stderr || clean.stdout);
  assert.match(clean.stdout, /Migration placement guard passed/);

  writeFileSync(join(badRoot, "1030_misplaced_seed.sql"), "SELECT 1;\n");
  const bad = runGuard(badRoot);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Misplaced governed migration seed files detected/);
  assert.match(bad.stderr, /1030_misplaced_seed\.sql/);
  assert.match(bad.stderr, /http-generic-api\/migrations\//);

  const invalidArgs = spawnSync(process.execPath, ["scripts/migration-placement-guard.mjs", "--unexpected"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.notEqual(invalidArgs.status, 0);
  assert.match(invalidArgs.stderr, /Usage: node scripts\/migration-placement-guard\.mjs/);
} finally {
  rmSync(cleanRoot, { recursive: true, force: true });
  rmSync(badRoot, { recursive: true, force: true });
}

console.log("migration placement guard tests passed");
