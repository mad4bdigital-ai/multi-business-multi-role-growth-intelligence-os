#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

const retiredPaths = [
  ".github/scripts/governed-local-connector-production-closure.mjs",
  ".github/workflows/governed-local-connector-production-closure.yml",
  ".github/workflows/governed-local-connector-production-closure-push.yml",
  ".github/workflows/governed-local-connector-production-closure-pr-target.yml",
  ".github/workflows/local-connector-closure-v8-trigger.txt",
  ".github/local-connector-closure/trigger-3945-792ff63a.txt",
];

for (const relativePath of retiredPaths) {
  assert(!fs.existsSync(path.join(root, relativePath)), `${relativePath} must remain retired`);
}

const overlapPath = path.join(root, ".github/workflows/automation-overlap-guard.yml");
const overlap = fs.readFileSync(overlapPath, "utf8");
assert(overlap.includes("name: Automation Overlap Guard\n"), "overlap guard identity must remain stable");
assert(overlap.includes("permissions:\n  contents: read\n"), "overlap guard must remain read-only");
assert(!overlap.includes("pull-requests: write"), "overlap guard must not write pull requests");
assert(!overlap.includes("issues: write"), "overlap guard must not write issues");
assert(!overlap.includes("BACKEND_API_KEY"), "overlap guard must not receive the runtime backend secret");
assert(!overlap.includes("local-connector-production-closure"), "overlap guard must not embed the retired closure job");
assert(!overlap.includes("PR_3945_792FF63A"), "overlap guard must not retain the completed one-shot token");

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

const liveAutomationFiles = [
  ...walk(path.join(root, ".github/workflows")),
  ...walk(path.join(root, ".github/scripts")),
].filter((file) => /\.(?:ya?ml|mjs|txt)$/i.test(file));

const forbiddenMarkers = [
  "RUN_LOCAL_CONNECTOR_PRODUCTION_CLOSURE",
  "governed-local-connector-production-closure.mjs",
  "trigger-3945-792ff63a",
  "local-connector-production-closure:",
];

for (const file of liveAutomationFiles) {
  const content = fs.readFileSync(file, "utf8");
  for (const marker of forbiddenMarkers) {
    assert(!content.includes(marker), `${path.relative(root, file)} retains retired marker ${marker}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  tests: 18,
  retired_paths: retiredPaths,
  scanned_live_automation_files: liveAutomationFiles.length,
  automation_overlap_guard_read_only: true,
  runtime_secret_authority_removed: true,
  repository_write_authority_removed: true,
  secrets_included: false,
}));
