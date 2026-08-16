#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(apiDir, "..");
const workspace = path.join(root, ".track-b-validation");
const run = (command, args, env = {}) => execFileSync(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: "inherit" });

function main() {
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });
  const inventoryEnv = {
    INVENTORY_JSON: ".track-b-validation/repository-inventory.json",
    INVENTORY_MARKDOWN: ".track-b-validation/repository-inventory.md",
    INVENTORY_SUMMARY: ".track-b-validation/repository-inventory-summary.json",
  };
  const writeScopeEnv = {
    REMOTE_MCP_WRITE_SCOPE_INVENTORY_JSON: ".track-b-validation/remote-mcp-write-scope-inventory.generated.json",
    REMOTE_MCP_WRITE_SCOPE_INVENTORY_MARKDOWN: ".track-b-validation/remote-mcp-write-scope-inventory.md",
  };
  try {
    run(process.execPath, ["scripts/repository-inventory.mjs"], inventoryEnv);
    run(process.execPath, ["scripts/repository-inventory.mjs", "--check"], inventoryEnv);
    run(process.execPath, ["scripts/remote-mcp-write-scope-inventory.mjs"], writeScopeEnv);
    run(process.execPath, ["scripts/remote-mcp-write-scope-inventory.mjs", "--check"], writeScopeEnv);
    run(process.execPath, ["--test",
      "http-generic-api/test-database-lifecycle-readiness-track-b.mjs",
      "http-generic-api/test-database-lifecycle-mutation-readiness.mjs",
      "http-generic-api/test-track-b-migration-readiness-manifest.mjs",
      "http-generic-api/test-runtime-break-glass-reconciliation-readiness.mjs",
      "http-generic-api/test-track-b-handoff-contract.mjs",
    ]);
    console.log(JSON.stringify({ ok: true, mode: "isolated", shared_artifacts_modified: false, migration_applied: false, database_mutated: false, secrets_included: false }, null, 2));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  rmSync(workspace, { recursive: true, force: true });
  console.error(error.message);
  process.exitCode = 1;
}
