#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { attachRepoMaintenanceCoordination } from "./repo-maintenance-coordination.mjs";

const API_ROOT = process.cwd();
const REPO_ROOT = path.resolve(API_ROOT, "..");
const write = process.argv.includes("--write");
const check = process.argv.includes("--check");
const skipOpenapiAutofill = process.argv.includes("--skip-openapi-autofill");
const writeSplitSchemas = process.argv.includes("--write-split-schemas");
const reportFileIndex = process.argv.indexOf("--report-file");
const reportFile = reportFileIndex >= 0 ? process.argv[reportFileIndex + 1] : "";

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

  const steps = [];

  if (!skipOpenapiAutofill) {
    run("node", ["scripts/openapi-autofill-missing-routes.mjs", write ? "--write" : "--check"].filter(Boolean));
    steps.push("openapi-autofill-missing-routes");
  }

  if (fileExists("http-generic-api/scripts/split-openapi.mjs")) {
    if (writeSplitSchemas) {
      run("node", ["scripts/split-openapi.mjs"]);
      steps.push("split-openapi-write");
    } else {
      steps.push("split-openapi-write-skipped-explicit-flag-required");
    }
  }

  run("node", ["scripts/update-repo-planning-docs.mjs"]);
  steps.push("update-repo-planning-docs");

  if (fileExists("http-generic-api/scripts/platform-work-map-generator.mjs")) {
    run("node", ["scripts/platform-work-map-generator.mjs", write ? "--write" : "--check"].filter(Boolean));
    steps.push("platform-work-map-generator");
  }

  if (fileExists("http-generic-api/scripts/surface-contract-discovery.mjs")) {
    run("node", ["scripts/surface-contract-discovery.mjs", write ? "--write" : "--check"].filter(Boolean));
    steps.push("surface-contract-discovery");
  }

  if (fileExists("http-generic-api/scripts/surface-contract-gap-triage.mjs")) {
    run("node", ["scripts/surface-contract-gap-triage.mjs", write ? "--write" : "--check", "--enforce-new-gaps"].filter(Boolean));
    steps.push("surface-contract-gap-triage");
  }

  const after = gitDiffNameOnly();
  const report = attachRepoMaintenanceCoordination({
    ok: true,
    mode: write ? "write" : "check",
    steps,
    changed_files: after,
    changed_count: after.length,
  }, {
    changed_files: after,
    branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || "",
    repository_current_state: {
      base_sha: process.env.GITHUB_BASE_SHA || "",
      branch_sha: process.env.GITHUB_SHA || "",
    },
  });
  if (reportFile) {
    fs.mkdirSync(path.dirname(path.resolve(REPO_ROOT, reportFile)), { recursive: true });
    fs.writeFileSync(path.resolve(REPO_ROOT, reportFile), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));

  if (check && after.length > 0) {
    console.error("repo-maintenance-sync: generated files are not committed.");
    process.exit(1);
  }
}

main();
