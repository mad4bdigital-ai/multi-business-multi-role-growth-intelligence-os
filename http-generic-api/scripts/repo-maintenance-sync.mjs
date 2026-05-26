#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const API_ROOT = process.cwd();
const REPO_ROOT = path.resolve(API_ROOT, "..");
const write = process.argv.includes("--write");
const check = process.argv.includes("--check");
const skipOpenapiAutofill = process.argv.includes("--skip-openapi-autofill");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || API_ROOT,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    const err = new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
    err.stdout = result.stdout;
    err.stderr = result.stderr;
    throw err;
  }
  return result;
}

function gitDiffNameOnly() {
  const result = run("git", ["diff", "--name-only"], { cwd: REPO_ROOT, capture: true });
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean).sort();
}

function fileExists(relPath) {
  return fs.existsSync(path.join(REPO_ROOT, relPath));
}

function main() {
  if (!write && !check) {
    console.error("Usage: node scripts/repo-maintenance-sync.mjs --write|--check [--skip-openapi-autofill]");
    process.exit(2);
  }

  const before = gitDiffNameOnly();
  const steps = [];

  if (!skipOpenapiAutofill) {
    run("node", ["scripts/openapi-autofill-missing-routes.mjs", write ? "--write" : "--check"].filter(Boolean));
    steps.push("openapi-autofill-missing-routes");
  }

  if (fileExists("http-generic-api/scripts/split-openapi.mjs")) {
    run("node", ["scripts/split-openapi.mjs"]);
    steps.push("split-openapi");
  }

  run("node", ["scripts/update-repo-planning-docs.mjs"]);
  steps.push("update-repo-planning-docs");

  const after = gitDiffNameOnly();
  const changed = after.filter((file) => !before.includes(file) || true);

  const report = {
    ok: true,
    mode: write ? "write" : "check",
    steps,
    changed_files: after,
    changed_count: after.length,
  };
  fs.writeFileSync(path.join(REPO_ROOT, "repo-maintenance-sync-result.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));

  if (check && after.length > before.length) {
    console.error("repo-maintenance-sync: generated files are not committed.");
    process.exit(1);
  }
}

main();
