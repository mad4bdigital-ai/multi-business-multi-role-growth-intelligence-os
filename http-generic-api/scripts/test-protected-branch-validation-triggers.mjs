#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [ci, diagnostic, policyRaw] = await Promise.all([
  readFile("../.github/workflows/ci.yml", "utf8"),
  readFile("../.github/workflows/branch-test-diagnostic-shards.yml", "utf8"),
  readFile("../.github/repository-maintenance-tool-governance.json", "utf8"),
]);
const policy = JSON.parse(policyRaw);

assert.deepEqual(
  policy.protected_branches,
  ["main", "Production"],
  "repository governance must retain both protected branches",
);

assert.match(
  ci,
  /pull_request:\s*\n\s*branches:\s*\[main, Production\]/u,
  "CI must run for pull requests targeting main and Production",
);
assert.match(ci, /name:\s*Syntax Check/u);
assert.match(ci, /name:\s*Unit & Integration Tests/u);
assert.match(ci, /name:\s*Execution Resolver Gate/u);
assert.match(ci, /name:\s*Architecture Drift Detection/u);
assert.match(ci, /run:\s*npm test/u);
assert.match(ci, /test-server-startup-smoke\.mjs/u);
assert.doesNotMatch(ci, /permissions:\s*write-all|contents:\s*write/u);

const pullRequestBlock = diagnostic.match(/pull_request:[\s\S]*?workflow_dispatch:/u)?.[0] || "";
assert.match(pullRequestBlock, /- main/u);
assert.match(pullRequestBlock, /- Production/u);
assert.match(diagnostic, /permissions:\s*\n\s*contents:\s*read/u);
assert.match(diagnostic, /Sequential manifest order · full npm test/u);
assert.match(diagnostic, /run:\s*npm test/u);
assert.match(
  diagnostic,
  /path:\s*http-generic-api\/diagnostic-reports\/\$\{\{ matrix\.family_slug \}\}-\$\{\{ matrix\.shard_index \}\}\.json/u,
  "diagnostic artifact upload must use matrix expressions rather than literal shell variables",
);
assert.match(diagnostic, /contract:\s*'mad4b\.test-diagnostic-summary\.v2'/u);
assert.match(diagnostic, /secretsIncluded:\s*false/u);
assert.doesNotMatch(diagnostic, /permissions:\s*write-all|contents:\s*write/u);

const workBranchLiteral = /(?:^|[^A-Za-z0-9_.-])(?:gpt|fix|feat|chore|docs|release)\/[A-Za-z0-9._/-]+/iu;
assert.doesNotMatch(ci, workBranchLiteral);
assert.doesNotMatch(diagnostic, workBranchLiteral);

console.log("protected branch validation trigger contract passed");
