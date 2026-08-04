import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflowPath = "../.github/workflows/spec-kit-work-map-autofix-recovery-dispatch.yml";
const workflow = readFileSync(workflowPath, "utf8");

assert.doesNotMatch(
  workflow,
  /REPORT_DIR:\s*\$\{\{\s*runner\.temp\s*\}\}/u,
  "Recovery dispatch must not evaluate runner.temp in job-level env before runner allocation.",
);

const initializer = workflow.indexOf(
  "- name: Initialize bounded recovery report directory after runner allocation",
);
const resolver = workflow.indexOf(
  "- name: Resolve and validate exact same-repository target",
);
assert.ok(initializer >= 0, "Recovery dispatch must initialize its report directory at runtime.");
assert.ok(resolver > initializer, "Report initialization must run before exact target resolution.");

const initializationBlock = workflow.slice(initializer, resolver);
assert.match(
  initializationBlock,
  /report_dir="\$\{RUNNER_TEMP\}\/spec-kit-work-map-autofix-recovery"/u,
);
assert.match(initializationBlock, /echo "REPORT_DIR=\$\{report_dir\}" >> "\$\{GITHUB_ENV\}"/u);

assert.match(workflow, /github\.event\.comment\.body == '\/recover-work-maps'/u);
assert.match(workflow, /grep -Fq "\$\{AUTHORIZATION_MARKER\}"/u);
assert.match(workflow, /behind_by.*!= "0"/u);
assert.match(workflow, /authorization_consumed:\$\{AUTHORIZATION_CONSUMED:-false\}/u);
assert.match(workflow, /protected_branch_mutation:false/u);
assert.match(workflow, /force_push:false/u);
assert.match(workflow, /secrets_included:false/u);

console.log("Work Map recovery runner-allocation boundary tests passed");
