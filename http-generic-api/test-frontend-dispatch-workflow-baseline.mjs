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
  /--baseline-ref="\$\{CANONICAL_BASELINE_REF\}"/,
  "the generator must consume the canonical baseline ref",
);
assert.doesNotMatch(
  generationBlock,
  /--baseline-ref=.*TARGET_REF/,
  "promotion targets such as Production must not rewrite committed canonical evidence",
);
assert.match(
  workflow,
  /BASE_REF="main"[\s\S]*?--baseline-ref="\$\{BASE_REF\}"/,
  "manual refresh and PR validation must share the same canonical baseline semantics",
);

console.log("frontend dispatch workflow baseline contract: ok");
