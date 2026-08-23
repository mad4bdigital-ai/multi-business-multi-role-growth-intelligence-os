import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync("../.github/workflows/derived-state-converged-automerge.yml", "utf8");

assert.match(
  workflow,
  /github\.event\.workflow_run\.name == 'Derived State Closure' && github\.event\.workflow_run\.event == 'pull_request'/,
  "main finalization must accept only pull-request Derived State Closure evidence",
);
assert.match(
  workflow,
  /github\.event\.workflow_run\.name == 'Governed Production Promotion Request Launcher' && github\.event\.workflow_run\.event == 'workflow_dispatch'/,
  "Production finalization must accept only governed workflow-dispatch evidence",
);
assert.match(workflow, /source_event="\$\(jq -r '\.event' "\$run"\)"/, "source event must be read back from the trusted run API");
assert.match(workflow, /test "\$source_event" = "pull_request"/, "main evidence must fail closed when its source event is not a pull request");
assert.match(workflow, /test "\$source_event" = "workflow_dispatch"/, "Production evidence must fail closed when its source event is not a workflow dispatch");
assert.match(workflow, /GH_TOKEN: \$\{\{ secrets\.REPO_AUTOSYNC_TOKEN \}\}/, "finalizer auto-merge must use the dedicated token");
assert.doesNotMatch(
  workflow,
  /GH_TOKEN: \$\{\{ secrets\.REPO_AUTOSYNC_TOKEN \|\| github\.token \}\}/,
  "finalizer auto-merge must not fall back to GITHUB_TOKEN",
);
assert.match(workflow, /REPO_AUTOSYNC_TOKEN is required so an auto-merge produces a normal push event/, "missing dedicated token must block automated merge");

console.log("derived state converged auto-merge source event tests passed");
