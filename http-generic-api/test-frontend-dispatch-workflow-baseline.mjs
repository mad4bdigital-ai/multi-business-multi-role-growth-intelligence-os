import assert from "node:assert/strict";
import fs from "node:fs";

const validationWorkflow = fs.readFileSync(
  new URL("../.github/workflows/frontend-surface-dispatch.yml", import.meta.url),
  "utf8",
);
const refreshWorkflow = fs.readFileSync(
  new URL("../.github/workflows/frontend-surface-dispatch-refresh.yml", import.meta.url),
  "utf8",
);

const generationBlock = validationWorkflow.match(
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
  /git fetch origin "\$\{CANONICAL_BASELINE_REF\}" --depth=1[\s\S]*?git branch -f "\$\{CANONICAL_BASELINE_REF\}" "origin\/\$\{CANONICAL_BASELINE_REF\}"/,
  "validation must fetch the current canonical branch and move the local canonical ref before generation",
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
assert.match(validationWorkflow, /permissions:\s*\n\s*contents:\s*read/u, "pull-request verification must be read-only");
assert.doesNotMatch(validationWorkflow, /\bgit\s+push\b/u, "pull-request verification must not mutate the repository");
assert.doesNotMatch(validationWorkflow, /contents:\s*write/u, "pull-request verification must not request write permission");

assert.match(refreshWorkflow, /workflow_dispatch:/u, "refresh must require explicit workflow dispatch");
assert.doesNotMatch(refreshWorkflow, /\npull_request(?:_target)?:/u, "refresh must not run from pull-request events");
assert.doesNotMatch(refreshWorkflow, /\npush:/u, "refresh must not run from branch-push events");
assert.match(refreshWorkflow, /expected_head_sha:/u, "refresh must require an explicit expected head SHA");
assert.match(
  refreshWorkflow,
  /TARGET_BRANCH[\s\S]*?main[\s\S]*?Production[\s\S]*?exit 1/u,
  "refresh must reject protected branches before writing",
);
assert.match(
  refreshWorkflow,
  /CURRENT_HEAD_SHA="\$\(git rev-parse HEAD\)"[\s\S]*?EXPECTED_HEAD_SHA[\s\S]*?exit 1/u,
  "refresh must reject a stale checked-out head",
);
assert.match(
  refreshWorkflow,
  /git ls-remote --heads origin[\s\S]*?EXPECTED_HEAD_SHA[\s\S]*?git push origin "HEAD:\$\{TARGET_BRANCH\}"/u,
  "refresh must re-check the remote exact head before a bounded push",
);

const refreshBlock = refreshWorkflow.match(
  /- name: Generate bounded dispatch evidence[\s\S]*?- name: Commit and push exact-head refresh/,
)?.[0];
assert.ok(refreshBlock, "bounded refresh workflow block must exist");
assert.match(
  refreshBlock,
  /git fetch origin main --depth=1[\s\S]*?git branch -f main origin\/main[\s\S]*?BASE_REF="main"[\s\S]*?--baseline-ref="\$\{BASE_REF\}"/,
  "refresh and validation must resolve main from the same freshly fetched commit",
);

console.log("frontend dispatch workflow baseline contract: ok");
