import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const workflowPath = path.join(root, ".github", "workflows", "hostinger-storage-cleanup-guard.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");
const expectedChangedFile = "specs/014-governed-hostinger-storage-orchestration/work-map-integration.json";

const envMatch = workflow.match(/WORK_MAP_CHANGED_FILES_JSON:\s*'([^']+)'/);
assert.ok(envMatch, "storage workflow must declare an explicit Work Map changed-file scope");
const changedFiles = JSON.parse(envMatch[1]);
assert.deepEqual(changedFiles, [expectedChangedFile], "storage workflow must scope the gate to feature 014 only");

assert.match(
  workflow,
  /node http-generic-api\/scripts\/spec-kit-work-map-governance-gate\.mjs --ci --changed/,
  "storage workflow must continue using the exact changed-file fail-closed gate",
);
assert.doesNotMatch(
  workflow,
  /spec-kit-work-map-governance-gate\.mjs[^\n]*--all/,
  "storage workflow must not broaden the specialized gate to all Work Maps",
);
assert.doesNotMatch(
  workflow,
  /WORK_MAP_CHANGED_FILES_JSON[^\n]*\*\*|WORK_MAP_CHANGED_FILES_JSON[^\n]*specs\/\*\*/,
  "storage workflow must not use a wildcard changed-file scope",
);

console.log(JSON.stringify({
  ok: true,
  contract: "hostinger_storage_work_map_gate_scope",
  changed_files: changedFiles,
  fail_closed_gate: true,
  secrets_included: false,
}, null, 2));
