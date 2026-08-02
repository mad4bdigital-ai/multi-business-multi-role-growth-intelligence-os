import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(
  new URL("../.github/workflows/frontend-surface-dispatch.yml", import.meta.url),
  "utf8",
);
const governedRefreshWorkflow = fs.readFileSync(
  new URL("../.github/workflows/governed-generated-artifact-refresh.yml", import.meta.url),
  "utf8",
);
const governedRefreshTool = fs.readFileSync(
  new URL("./scripts/maintenance-tools/generated-artifact-refresh.mjs", import.meta.url),
  "utf8",
);

const generationBlock = workflow.match(
  /- name: Generate source-pinned dispatch plan[\s\S]*?- name: Verify generator contract/,
)?.[0];

assert.ok(generationBlock, "dispatch generation workflow block must exist");
assert.match(
  generationBlock,
  /CANONICAL_BASELINE_REF:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\|\|\s*'main'\s*\}\}/,
  "committed dispatch evidence must be generated from the canonical default branch baseline",
);
assert.match(
  generationBlock,
  /TARGET_REF:\s*\$\{\{\s*github\.event\.pull_request\.base\.ref/,
  "the PR target may be retained only as diagnostic context",
);
assert.match(
  generationBlock,
  /--baseline-ref="\$\{CANONICAL_BASELINE_REF\}"/,
  "the generator must consume the canonical baseline ref",
);
assert.doesNotMatch(
  generationBlock,
  /--baseline-ref=.*TARGET_REF/,
  "promotion targets such as Production must not rewrite committed canonical evidence",
);

assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/, "PR verification must remain read-only");
assert.match(workflow, /persist-credentials:\s*false/, "PR checkout must not persist credentials");
for (const forbidden of ["contents: write", "refresh-generated:", "git commit ", "git push "]) {
  assert.doesNotMatch(workflow, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `PR verification must exclude ${forbidden}`);
}

assert.match(governedRefreshWorkflow, /workflow_dispatch:/, "generated mutation must require explicit dispatch");
assert.match(governedRefreshWorkflow, /expected_head_sha:/, "generated mutation must bind an exact expected head");
assert.match(governedRefreshWorkflow, /confirmation:[\s\S]*APPLY_GENERATED_ARTIFACT_REFRESH/, "generated mutation must require typed confirmation");
assert.match(governedRefreshWorkflow, /contents:\s*write/, "only the governed dispatched workflow may hold contents write");
assert.match(governedRefreshWorkflow, /TARGET_REF" == "main"[\s\S]*TARGET_REF" == "Production"/, "the governed writer must reject protected branches");
assert.match(governedRefreshWorkflow, /generated-artifact-refresh\.mjs/, "the dispatch must invoke the registered maintenance tool");
assert.match(governedRefreshTool, /--baseline-ref=main/, "the delegated tool must retain canonical main baseline semantics");
assert.match(governedRefreshTool, /preflight_expected_head/, "the delegated tool must verify expected head before mutation");
assert.match(governedRefreshTool, /prepush_expected_head/, "the delegated tool must verify expected head before push");
assert.match(governedRefreshTool, /PROTECTED_BRANCHES = new Set\(\["main", "Production"\]\)/, "the delegated tool must reject protected branches");

const structuredChecks = [
  ["Verify generator contract", "workflow_baseline", "node test-frontend-dispatch-workflow-baseline.mjs"],
  ["Verify operation governance generator", "operation_generator", "node test-frontend-operation-governance-generator.mjs"],
  ["Verify frontend surface dispatch", "surface_dispatch", "node test-frontend-surface-dispatch.mjs"],
  ["Verify frontend auth OpenAPI parity", "auth_openapi", "node test-frontend-auth-openapi-parity.mjs"],
  ["Verify OpenAPI route coverage", "route_coverage", "node test-openapi-route-coverage.mjs"],
  ["Verify OpenAPI auth synchronization", "openapi_auth", "npm run openapi:auth:check"],
];

for (const [name, id, command] of structuredChecks) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    workflow,
    new RegExp(`- name: ${escapedName}\\s+id: ${id}\\s+continue-on-error: true\\s+run: ${escapedCommand}`),
    `${id} must remain an independently reported non-short-circuiting contract check`,
  );
}

assert.match(
  workflow,
  /- name: Check committed deterministic output\s+id: deterministic_output\s+continue-on-error: true/,
  "deterministic output parity must be included in the structured check matrix",
);
assert.match(
  workflow,
  /contract: 'mad4b\.frontend-generator-contract-summary\.v1'/,
  "the workflow must emit the canonical structured generator-contract summary",
);
assert.match(
  workflow,
  /failed_check_ids: failed\.map\(\(check\) => check\.id\)/,
  "the structured summary must identify failed checks without relying on Job logs",
);
assert.match(
  workflow,
  /consult_job_logs: false[\s\S]*?repository_mutation: false[\s\S]*?secrets_included: false/,
  "the structured summary must remain no-log, read-only, and secret-free",
);
assert.match(
  workflow,
  /name: frontend-generator-contract-\$\{\{ github\.run_id \}\}/,
  "the structured summary Artifact must be run-bound",
);
assert.match(
  workflow,
  /- name: Enforce structured generator-contract decision[\s\S]*?\[\[ "\$\{outcome\}" == "success" \]\] \|\| exit 1/,
  "one final gate must enforce all independently captured outcomes",
);

console.log("frontend dispatch workflow baseline, delegated refresh, and structured evidence contract: ok");
