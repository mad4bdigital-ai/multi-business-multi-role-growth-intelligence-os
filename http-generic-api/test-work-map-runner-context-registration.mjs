import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.dirname(fileURLToPath(import.meta.url));
const workflowRoot = path.join(apiRoot, "..", ".github", "workflows");

const prRefresh = readFileSync(path.join(workflowRoot, "pr-generated-artifact-refresh.yml"), "utf8");
const recovery = readFileSync(path.join(workflowRoot, "spec-kit-work-map-autofix-recovery-dispatch.yml"), "utf8");
const integration = readFileSync(path.join(workflowRoot, "spec-kit-work-map-integration.yml"), "utf8");

for (const [name, workflow] of [
  ["PR Generated Artifact Refresh", prRefresh],
  ["Spec Kit Work Map Autofix Recovery Dispatch", recovery],
  ["Spec Kit Work Map Integration", integration],
]) {
  assert.doesNotMatch(
    workflow,
    /\$\{\{\s*runner\.temp\s*\}\}/u,
    `${name} must not evaluate runner.temp before runner allocation.`,
  );
}

assert.match(prRefresh, /Initialize bounded refresh report paths after runner allocation/u);
assert.match(prRefresh, /Initialize bounded activation report path after runner allocation/u);
assert.match(prRefresh, /report_dir="\$\{RUNNER_TEMP\}\/pr-generated-artifact-refresh"/u);
assert.match(prRefresh, /report_dir="\$\{RUNNER_TEMP\}\/work-map-recovery-activation"/u);
assert.match(prRefresh, /contents:\s*read/u);
assert.doesNotMatch(prRefresh, /contents:\s*write/u);
assert.doesNotMatch(prRefresh, /git\s+push/u);

assert.match(recovery, /Initialize bounded recovery report directory after runner allocation/u);
assert.match(recovery, /report_dir="\$\{RUNNER_TEMP\}\/spec-kit-work-map-autofix-recovery"/u);
assert.match(recovery, /echo "REPORT_DIR=\$\{report_dir\}" >> "\$\{GITHUB_ENV\}"/u);
assert.match(recovery, /path:\s*\$\{\{ env\.REPORT_DIR \}\}\//u);
assert.match(recovery, /RECOVER_SPEC_KIT_WORK_MAP_AUTOFIX/u);
assert.match(recovery, /authorization_consumed/u);
assert.match(recovery, /protected_branch_mutation:false/u);
assert.match(recovery, /force_push:false/u);

assert.match(integration, /Initialize bounded Work Map repair root after runner allocation/u);
assert.match(integration, /repair_root="\$\{RUNNER_TEMP\}\/work-map-repair-candidate"/u);
assert.match(integration, /echo "WORK_MAP_REPAIR_ROOT=\$\{repair_root\}" >> "\$\{GITHUB_ENV\}"/u);
assert.match(integration, /path:\s*\$\{\{ env\.WORK_MAP_REPAIR_ROOT \}\}/u);
assert.match(integration, /permissions:\s*\n\s*contents:\s*read/u);
assert.doesNotMatch(integration, /contents:\s*write/u);
assert.doesNotMatch(integration, /git\s+push/u);

console.log("Work Map runner-context registration tests passed");
