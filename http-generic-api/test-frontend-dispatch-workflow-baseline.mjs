import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(
  new URL("../.github/workflows/frontend-surface-dispatch.yml", import.meta.url),
  "utf8",
);
const dispatcher = fs.readFileSync(
  new URL("../.github/workflows/frontend-parity-refresh-dispatch.yml", import.meta.url),
  "utf8",
);

const generationBlock = workflow.match(
  /- name: Generate source-pinned dispatch plan[\s\S]*?- name: Verify generator contract/,
)?.[0];

assert.ok(generationBlock, "dispatch generation workflow block must exist");
assert.match(
  generationBlock,
  /id:\s*generate_plan[\s\S]*?continue-on-error:\s*true/,
  "source generation must be captured without short-circuiting structured evidence",
);
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
  /contract: 'mad4b\.frontend-dispatch-verification-evidence\.v1'/,
  "the read-only source workflow must publish the trusted workflow_run evidence contract",
);
assert.match(
  workflow,
  /\['committed_generated_parity', process\.env\.DETERMINISTIC_OUTPUT\]/,
  "deterministic parity must remain the only refresh-eligible source stage",
);
assert.match(
  workflow,
  /workflow: 'Frontend surface dispatch'[\s\S]*?candidate_kind:[\s\S]*?candidate_sha:[\s\S]*?source_head_sha:[\s\S]*?head_ref:[\s\S]*?base_ref:/,
  "source evidence must bind workflow, candidate, source head, and branch identity",
);
assert.match(
  workflow,
  /delegated_writer: 'governed-generated-artifact-refresh\.yml'[\s\S]*?dispatch_workflow: 'frontend-parity-refresh-dispatch\.yml'/,
  "source evidence must delegate all writes through the governed dispatcher and writer",
);
assert.match(
  workflow,
  /name: frontend-dispatch-verification-evidence-\$\{\{ github\.run_id \}\}/,
  "the trusted source Artifact must be run-bound for workflow_run consumption",
);
assert.match(
  workflow,
  /direct_repository_mutation: false[\s\S]*?protected_branch_mutation: false[\s\S]*?force_push: false[\s\S]*?secrets_included: false/,
  "source evidence must explicitly preserve no-write, no-protected-branch, no-force, and no-secret boundaries",
);

assert.doesNotMatch(
  workflow,
  /contents:\s*write/,
  "pull-request Frontend verification must not receive contents-write permission",
);
assert.doesNotMatch(
  workflow,
  /\bgit\s+push\b/,
  "pull-request Frontend verification must not push repository contents",
);
assert.doesNotMatch(
  workflow,
  /refresh-generated:/,
  "the pull-request workflow must not retain an in-band generated-evidence writer job",
);
assert.doesNotMatch(
  workflow,
  /Generate and commit bounded dispatch evidence/,
  "generated-evidence commits must not occur inside the pull-request workflow",
);

assert.match(
  dispatcher,
  /workflows:\s*\n\s*- Frontend surface dispatch/,
  "the trusted dispatcher must consume the completed read-only source workflow",
);
assert.match(
  dispatcher,
  /name: frontend-dispatch-verification-evidence-\$\{\{ github\.event\.workflow_run\.id \}\}/,
  "the dispatcher must download the exact run-bound source Artifact",
);
assert.match(
  dispatcher,
  /source\.first_failure\?\.stage_id !== 'committed_generated_parity'/,
  "the dispatcher must skip all failures except committed generated parity",
);
assert.match(
  dispatcher,
  /targetBranch === 'main' \|\| targetBranch === 'Production'/,
  "the dispatcher must fail closed for protected branches",
);
assert.match(
  dispatcher,
  /expected_head_sha: expectedHeadSha/,
  "the delegated writer must receive the exact expected head SHA",
);
assert.match(
  dispatcher,
  /delegated_workflow = 'governed-generated-artifact-refresh\.yml'/,
  "the dispatcher must delegate to the registered governed writer",
);

assert.match(
  workflow,
  /- name: Enforce structured generator-contract decision[\s\S]*?\[\[ "\$\{outcome\}" == "success" \]\] \|\| exit 1/,
  "one final gate must enforce all independently captured outcomes after evidence upload",
);

console.log("frontend dispatch read-only verification and delegated refresh contract: ok");

// Temporary path-filter trigger for governed generated-artifact refresh; restore the main blob after writer completion.
