import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, "..");
const workflowPath = path.join(
  repositoryRoot,
  ".github",
  "workflows",
  "pr-generated-artifact-refresh.yml",
);
const workflowSource = fs.readFileSync(workflowPath, "utf8");

assert.doesNotMatch(
  workflowSource,
  /\$\{\{\s*runner\.temp\s*\}\}/u,
  "PR workflow must not evaluate runner.temp before runner allocation",
);
assert.match(
  workflowSource,
  /- name: Initialize bounded refresh report paths after runner allocation/u,
);
assert.match(
  workflowSource,
  /report_dir="\$\{RUNNER_TEMP\}\/pr-generated-artifact-refresh"/u,
);
assert.match(workflowSource, /rm -rf "\$\{report_dir\}"/u);
assert.match(workflowSource, /mkdir -p "\$\{report_dir\}"/u);
assert.match(
  workflowSource,
  /echo "REPORT_PATH=\$\{report_dir\}\/pr-generated-artifact-refresh-summary\.json" >> "\$\{GITHUB_ENV\}"/u,
);
assert.match(
  workflowSource,
  /echo "REPORT_MARKDOWN_PATH=\$\{report_dir\}\/pr-generated-artifact-refresh-summary\.md" >> "\$\{GITHUB_ENV\}"/u,
);
assert.match(workflowSource, /\$\{\{\s*env\.REPORT_PATH\s*\}\}/u);
assert.match(workflowSource, /\$\{\{\s*env\.REPORT_MARKDOWN_PATH\s*\}\}/u);
assert.doesNotMatch(workflowSource, /contents:\s*write/u);
assert.doesNotMatch(workflowSource, /actions:\s*write/u);
assert.doesNotMatch(workflowSource, /git\s+push/u);

const initializerIndex = workflowSource.indexOf(
  "Initialize bounded refresh report paths after runner allocation",
);
const validationIndex = workflowSource.indexOf("Validate exact candidate inputs");
assert.ok(initializerIndex >= 0 && validationIndex > initializerIndex);

console.log(JSON.stringify({
  contract: "mad4b.pr-generated-artifact-refresh-runner-context-regression.v1",
  ok: true,
  runner_context_bound_after_allocation: true,
  bounded_report_paths: true,
  pull_request_write_authority: false,
  secrets_included: false,
}));
