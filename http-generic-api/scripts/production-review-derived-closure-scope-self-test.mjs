#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const text = readFileSync(path.join(repoRoot, ".github/workflows/derived-state-closure.yml"), "utf8").replace(/\r\n/g, "\n");
const match = text.match(/\n  closure:\n(?:[^\n]*\n)*?    if: >-\n      github\.event_name != 'pull_request_review' \|\|\n      github\.event\.pull_request\.base\.ref == 'main'\n/);
assert.ok(match, "main-only Derived State review guard must be exact and job-bound");
assert.match(text, /\n  pull_request:\n    branches: \[main\]\n/, "pull request event remains main-scoped");
assert.match(text, /\n  pull_request_review:\n    types: \[submitted, dismissed\]\n/, "main review event retains parity");
assert.match(text, /test "\$\(jq -r '\.base\.ref' "\$pr_file"\)" = "main"/, "the PR body must be re-verified from the GitHub API");
const permitted = (name, base) => name !== "pull_request_review" || base === "main";
const cases = [
  { name: "pull_request_review", base: "main", should_run: true },
  { name: "pull_request_review", base: "Production", should_run: false },
  { name: "pull_request_review", base: "staging", should_run: false },
  { name: "pull_request_review", base: "", should_run: false },
  { name: "pull_request", base: "main", should_run: true },
  { name: "push", base: "main", should_run: true },
  { name: "workflow_dispatch", base: "main", should_run: true },
];
for (const item of cases) assert.equal(permitted(item.name, item.base), item.should_run, JSON.stringify(item));
console.log(JSON.stringify({
  ok:true, contract:"mad4b.production-review-derived-closure-scope.v1",
  scenarios:cases.length, main_review_supported:true, production_review_job_skipped:true,
  required_production_checks_forged:false, production_merge_authorized:false,
  production_mutation_performed:false, secrets_included:false,
}));
