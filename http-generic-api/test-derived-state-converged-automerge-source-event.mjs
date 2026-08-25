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
assert.match(workflow, /Checkout governance readiness verifier/, "finalizer must checkout the exact-source readiness verifier before registration");
assert.match(workflow, /ref: \$\{\{ needs\.attest\.outputs\.source_head_sha \}\}/, "readiness verifier must come from the exact attested source head");
assert.match(workflow, /TARGET_BRANCH=main/, "main auto-merge readiness must be branch-bound");
assert.match(workflow, /REQUIRED_CHECK_CONTEXT="Derived State Closure"/, "main auto-merge readiness must require Derived State Closure");
assert.match(workflow, /EXPECTED_HEAD_SHA="\$BASE_SHA"/, "server readiness must be bound to the exact attested main base SHA");
assert.match(workflow, /node \.github\/ops\/github-followup-automerge-readiness\.mjs/, "finalizer must delegate live repository protection checks to the central verifier");
assert.match(workflow, /gh pr merge "\$PR_NUMBER" --auto --squash --delete-branch --match-head-commit "\$EXPECTED_HEAD_SHA"/, "auto-merge registration must stay bound to the exact unchanged PR head");
assert.match(workflow, /server_protection_verified=true/, "final attestation must record successful server protection verification");

const readinessIndex = workflow.indexOf("node .github/ops/github-followup-automerge-readiness.mjs");
const mergeIndex = workflow.indexOf('gh pr merge "$PR_NUMBER" --auto');
assert.ok(readinessIndex >= 0, "central readiness verifier invocation is required");
assert.ok(mergeIndex > readinessIndex, "server readiness must be proven before auto-merge registration");

console.log("derived state converged auto-merge source event tests passed");
