import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.resolve(
  HERE,
  "../.github/workflows/governed-generated-artifact-refresh-pr-target-v3.yml",
);
const source = fs.readFileSync(WORKFLOW, "utf8");

assert.match(source, /^name: Governed Generated Artifact Refresh PR Target V3$/m);
assert.match(source, /^  pull_request_target:$/m);
assert.match(source, /types: \[labeled, synchronize, ready_for_review, reopened\]/);
assert.match(source, /^  actions: write$/m);
assert.match(source, /^  contents: read$/m);
assert.match(source, /^  pull-requests: read$/m);
assert.doesNotMatch(source, /^  contents: write$/m);
assert.doesNotMatch(source, /^  issues: write$/m);

assert.match(source, /head\.repo\.full_name == github\.repository/);
assert.match(source, /base\.ref == 'main'/);
assert.match(source, /pull_request\.draft == false/);
assert.match(source, /generated-artifact-refresh/);
assert.match(source, /EXPECTED_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
assert.match(source, /TARGET_REF: \$\{\{ github\.event\.pull_request\.head\.ref \}\}/);
assert.match(source, /\^\(gpt\|cert\|fix\|feat\|chore\|docs\|release\)\//);

assert.match(
  source,
  /actions\/workflows\/governed-generated-artifact-refresh-dispatch-v2\.yml\/dispatches/,
);
assert.match(source, /event=workflow_dispatch&branch=main/);
assert.match(source, /no V2 run was observed in the bounded window/);

assert.doesNotMatch(source, /actions\/checkout/);
assert.doesNotMatch(source, /governed-generated-artifact-refresh\.yml\/dispatches/);
assert.doesNotMatch(source, /git\s+push/);
assert.doesNotMatch(source, /pull-requests:\s*write/);
assert.doesNotMatch(source, /github\.event\.pull_request\.head\.ref\s*\}\}\s*\n\s*fetch-depth/);

console.log("governed generated-artifact PR-target V3 contract passed");
