import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.join(API_ROOT, "..");
const workflowPath = path.join(
  REPOSITORY_ROOT,
  ".github",
  "workflows",
  "spec-kit-work-map-integration.yml",
);
const workflow = readFileSync(workflowPath, "utf8");

assert.match(workflow, /^name: Spec Kit Work Map Integration$/mu);
assert.match(workflow, /workflow_dispatch:/u);
assert.match(workflow, /^\s{4}runs-on: ubuntu-latest$/mu);
assert.doesNotMatch(
  workflow,
  /^\s{6}WORK_MAP_REPAIR_ROOT:\s*\$\{\{\s*runner\.temp\s*\}\}/mu,
  "runner.temp must not be evaluated in job-level env",
);
assert.match(
  workflow,
  /- name: Initialize bounded Work Map repair directory after runner allocation/u,
);
assert.match(
  workflow,
  /repair_root="\$\{RUNNER_TEMP\}\/work-map-repair-candidate"/u,
);
assert.match(
  workflow,
  /echo "WORK_MAP_REPAIR_ROOT=\$\{repair_root\}" >> "\$\{GITHUB_ENV\}"/u,
);
assert.match(workflow, /rm -rf "\$\{repair_root\}"/u);
assert.match(workflow, /mkdir -p "\$\{repair_root\}"/u);
assert.match(workflow, /rm -rf "\$\{WORK_MAP_REPAIR_ROOT\}"/u);
assert.match(workflow, /mkdir -p "\$\{WORK_MAP_REPAIR_ROOT\}\/docs"/u);
assert.match(
  workflow,
  /path: \$\{\{ runner\.temp \}\}\/work-map-repair-candidate/u,
  "runner.temp remains allowed in step-level action inputs",
);

console.log("Spec Kit Work Map Integration registration boundary passed");
