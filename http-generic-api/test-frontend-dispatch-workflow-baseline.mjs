import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(
  new URL("../.github/workflows/frontend-surface-dispatch.yml", import.meta.url),
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

const refreshBlock = workflow.match(
  /- name: Generate and commit bounded dispatch evidence[\s\S]*?git push origin "HEAD:\$\{TARGET_BRANCH\}"/,
)?.[0];
assert.ok(refreshBlock, "bounded refresh workflow block must exist");
assert.match(
  refreshBlock,
  /git fetch origin main --depth=1[\s\S]*?git branch -f main origin\/main[\s\S]*?BASE_REF="main"[\s\S]*?--baseline-ref="\$\{BASE_REF\}"/,
  "refresh and validation must resolve main from the same freshly fetched commit",
);

console.log("frontend dispatch workflow baseline contract: ok");
